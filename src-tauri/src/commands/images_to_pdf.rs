use crate::{
    constants::CONVERSION_PROGRESS_EVENT,
    formats::get_file_ext,
    models::{ImageToPdfPreview, ImagesToPdfRequest, JobUpdate, QueueState},
    paths::{canonical_existing_file, validate_output},
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{
    codecs::jpeg::JpegEncoder, DynamicImage, ExtendedColorType, ImageDecoder, ImageReader,
};
use lopdf::{
    Dictionary, Document, EncryptionState, EncryptionVersion, Object, Permissions, Stream,
};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{Emitter, State};
use uuid::Uuid;

const MAX_IMAGE_PIXELS: u64 = 100_000_000;
const MAX_IMAGES: usize = 10_000;
const SUPPORTED_IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "jfif", "png", "webp", "gif", "bmp", "tif", "tiff",
];

struct DecodedImage {
    image: DynamicImage,
    width: u32,
    height: u32,
}

fn display_name(path: &Path) -> &str {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("immagine")
}

fn checked_image(path: &str) -> Result<PathBuf, String> {
    let input = canonical_existing_file(path)?;
    let extension = get_file_ext(&input);
    if !SUPPORTED_IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!(
            "Formato immagine non supportato: {}",
            display_name(&input)
        ));
    }
    Ok(input)
}

fn decode_image(path: &Path) -> Result<DecodedImage, String> {
    let reader = ImageReader::open(path)
        .map_err(|error| format!("Impossibile aprire {}: {error}", display_name(path)))?
        .with_guessed_format()
        .map_err(|error| {
            format!(
                "Formato immagine non valido in {}: {error}",
                display_name(path)
            )
        })?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|error| format!("Impossibile decodificare {}: {error}", display_name(path)))?;
    let orientation = decoder.orientation().map_err(|error| {
        format!(
            "Orientamento immagine non valido in {}: {error}",
            display_name(path)
        )
    })?;
    let mut image = DynamicImage::from_decoder(decoder)
        .map_err(|error| format!("Impossibile decodificare {}: {error}", display_name(path)))?;
    image.apply_orientation(orientation);

    let (width, height) = (image.width(), image.height());
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err(format!(
            "{} supera il limite di 100 megapixel",
            display_name(path)
        ));
    }
    Ok(DecodedImage {
        image,
        width,
        height,
    })
}

fn encode_jpeg(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, String> {
    let rgba = image.to_rgba8();
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for pixel in rgba.pixels() {
        let alpha = u32::from(pixel[3]);
        for channel in &pixel.0[..3] {
            let blended = (u32::from(*channel) * alpha + 255 * (255 - alpha) + 127) / 255;
            rgb.push(blended as u8);
        }
    }
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, quality)
        .encode(&rgb, image.width(), image.height(), ExtendedColorType::Rgb8)
        .map_err(|error| format!("Codifica JPEG non riuscita: {error}"))?;
    Ok(jpeg)
}

#[tauri::command]
pub(crate) async fn preview_image_for_pdf(path: String) -> Result<ImageToPdfPreview, String> {
    let input = checked_image(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let decoded = decode_image(&input)?;
        let thumbnail = decoded.image.thumbnail(160, 120);
        let jpeg = encode_jpeg(&thumbnail, 65)?;
        Ok(ImageToPdfPreview {
            data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg)),
            width: decoded.width,
            height: decoded.height,
        })
    })
    .await
    .map_err(|error| format!("Generazione dell'anteprima non riuscita: {error}"))?
}

#[derive(Clone, Copy)]
enum PageSize {
    FitToImage,
    A4,
    Letter,
    Custom(f64, f64),
}

fn parse_page_size(request: &ImagesToPdfRequest) -> Result<PageSize, String> {
    match request.page_size.as_str() {
        "fit-to-image" => Ok(PageSize::FitToImage),
        "a4" => Ok(PageSize::A4),
        "letter" => Ok(PageSize::Letter),
        "custom" => {
            let width = request
                .custom_width_mm
                .ok_or("Larghezza pagina non valida")?;
            let height = request
                .custom_height_mm
                .ok_or("Altezza pagina non valida")?;
            if !width.is_finite()
                || !height.is_finite()
                || !(10.0..=2000.0).contains(&width)
                || !(10.0..=2000.0).contains(&height)
            {
                return Err(
                    "Le dimensioni personalizzate devono essere comprese tra 10 e 2000 mm".into(),
                );
            }
            Ok(PageSize::Custom(width, height))
        }
        _ => Err("Formato pagina non valido".into()),
    }
}

fn page_layout(
    size: PageSize,
    image_width: u32,
    image_height: u32,
) -> (f64, f64, f64, f64, f64, f64) {
    let image_width = f64::from(image_width);
    let image_height = f64::from(image_height);
    let (mut page_width, mut page_height) = match size {
        PageSize::FitToImage => (image_width, image_height),
        PageSize::A4 => (210.0, 297.0),
        PageSize::Letter => (215.9, 279.4),
        PageSize::Custom(width, height) => (width, height),
    };
    if !matches!(size, PageSize::FitToImage)
        && (image_width > image_height) != (page_width > page_height)
    {
        std::mem::swap(&mut page_width, &mut page_height);
    }
    if !matches!(size, PageSize::FitToImage) {
        page_width *= 72.0 / 25.4;
        page_height *= 72.0 / 25.4;
    }

    let scale = (page_width / image_width).min(page_height / image_height);
    let drawn_width = image_width * scale;
    let drawn_height = image_height * scale;
    (
        page_width,
        page_height,
        (page_width - drawn_width) / 2.0,
        (page_height - drawn_height) / 2.0,
        drawn_width,
        drawn_height,
    )
}

fn build_pdf(inputs: &[PathBuf], size: PageSize, quality: u8) -> Result<Document, String> {
    let mut document = Document::with_version("1.7");
    document.reference_table.cross_reference_type = lopdf::xref::XrefType::CrossReferenceTable;
    let pages_id = document.new_object_id();
    let catalog_id = document.new_object_id();
    let mut page_ids = Vec::with_capacity(inputs.len());

    for (index, input) in inputs.iter().enumerate() {
        let decoded = decode_image(input)?;
        let jpeg = encode_jpeg(&decoded.image, quality)?;
        let (page_width, page_height, image_x, image_y, image_width, image_height) =
            page_layout(size, decoded.width, decoded.height);
        let mut image_dictionary = Dictionary::new();
        image_dictionary.set("Type", "XObject");
        image_dictionary.set("Subtype", "Image");
        image_dictionary.set("Width", decoded.width as i64);
        image_dictionary.set("Height", decoded.height as i64);
        image_dictionary.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
        image_dictionary.set("BitsPerComponent", 8);
        image_dictionary.set("Filter", Object::Name(b"DCTDecode".to_vec()));
        let image_id = document.add_object(Stream::new(image_dictionary, jpeg));

        let resource_name = format!("Im{index}");
        let content = format!(
            "q\n{image_width:.5} 0 0 {image_height:.5} {image_x:.5} {image_y:.5} cm\n/{resource_name} Do\nQ\n"
        );
        let content_id = document.add_object(Stream::new(Dictionary::new(), content.into_bytes()));
        let mut xobjects = Dictionary::new();
        xobjects.set(resource_name, Object::Reference(image_id));
        let mut resources = Dictionary::new();
        resources.set("XObject", Object::Dictionary(xobjects));

        let page_id = document.new_object_id();
        let mut page = Dictionary::new();
        page.set("Type", "Page");
        page.set("Parent", Object::Reference(pages_id));
        page.set(
            "MediaBox",
            vec![
                Object::Integer(0),
                Object::Integer(0),
                Object::Real(page_width as f32),
                Object::Real(page_height as f32),
            ],
        );
        page.set("Resources", Object::Dictionary(resources));
        page.set("Contents", Object::Reference(content_id));
        document.objects.insert(page_id, Object::Dictionary(page));
        page_ids.push(page_id);
    }

    let mut pages = Dictionary::new();
    pages.set("Type", "Pages");
    pages.set("Count", page_ids.len() as i64);
    pages.set(
        "Kids",
        page_ids
            .iter()
            .copied()
            .map(Object::Reference)
            .collect::<Vec<_>>(),
    );
    document.objects.insert(pages_id, Object::Dictionary(pages));

    let mut catalog = Dictionary::new();
    catalog.set("Type", "Catalog");
    catalog.set("Pages", Object::Reference(pages_id));
    document
        .objects
        .insert(catalog_id, Object::Dictionary(catalog));
    document.trailer.set("Root", Object::Reference(catalog_id));
    Ok(document)
}

fn protect_pdf(document: &mut Document, password: &str) -> Result<(), String> {
    let filter: Arc<dyn lopdf::encryption::crypt_filters::CryptFilter> =
        Arc::new(lopdf::encryption::crypt_filters::Aes128CryptFilter);
    let crypt_filters = BTreeMap::from([(b"StdCF".to_vec(), filter)]);
    let first_id = Uuid::new_v4();
    let second_id = Uuid::new_v4();
    document.trailer.set(
        "ID",
        Object::Array(vec![
            Object::string_literal(first_id.as_bytes()),
            Object::string_literal(second_id.as_bytes()),
        ]),
    );
    let owner_password = Uuid::new_v4().to_string();
    let encryption = EncryptionState::try_from(EncryptionVersion::V4 {
        document,
        encrypt_metadata: true,
        crypt_filters,
        stream_filter: b"StdCF".to_vec(),
        string_filter: b"StdCF".to_vec(),
        owner_password: &owner_password,
        user_password: password,
        permissions: Permissions::all(),
    })
    .map_err(|error| format!("Configurazione della password PDF non riuscita: {error}"))?;
    document
        .encrypt(&encryption)
        .map_err(|error| format!("Protezione del PDF non riuscita: {error}"))
}

struct TemporaryFile(PathBuf);

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn save_pdf(
    document: &mut Document,
    requested_output: &Path,
    auto_rename_outputs: bool,
) -> Result<PathBuf, String> {
    let parent = requested_output
        .parent()
        .ok_or("Cartella di output non valida")?;
    let temporary = parent.join(format!(".biolaris-images-to-pdf-{}.tmp", Uuid::new_v4()));
    let cleanup = TemporaryFile(temporary.clone());
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("Impossibile creare il PDF temporaneo: {error}"))?;
    document
        .save_to(&mut file)
        .map_err(|error| format!("Impossibile preparare il PDF: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Impossibile salvare il PDF: {error}"))?;
    drop(file);

    loop {
        let output = validate_output(
            &requested_output.to_string_lossy(),
            "pdf",
            auto_rename_outputs,
        )?;
        match fs::hard_link(&temporary, &output) {
            Ok(()) => {
                drop(cleanup);
                return Ok(output);
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::AlreadyExists && auto_rename_outputs =>
            {
                continue;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err("Il file di destinazione esiste già".into());
            }
            Err(error) => return Err(format!("Salvataggio del PDF non riuscito: {error}")),
        }
    }
}

#[tauri::command]
pub(crate) async fn enqueue_images_to_pdf(
    app: tauri::AppHandle,
    state: State<'_, QueueState>,
    request: ImagesToPdfRequest,
) -> Result<String, String> {
    if request.image_paths.is_empty() || request.image_paths.len() > MAX_IMAGES {
        return Err(format!("Seleziona da 1 a {MAX_IMAGES} immagini"));
    }
    if !(40..=100).contains(&request.quality) {
        return Err("La qualità deve essere compresa tra 40 e 100".into());
    }
    let page_size = parse_page_size(&request)?;
    if request
        .password
        .as_deref()
        .is_some_and(|password| password.is_empty() || password.len() > 32)
    {
        return Err("La password deve contenere da 1 a 32 byte".into());
    }
    let inputs = request
        .image_paths
        .iter()
        .map(|path| checked_image(path))
        .collect::<Result<Vec<_>, _>>()?;
    let first = inputs.first().ok_or("Seleziona almeno un'immagine")?;
    let requested_output = first.with_extension("pdf");
    validate_output(
        &requested_output.to_string_lossy(),
        "pdf",
        request.auto_rename_outputs,
    )?;

    let id = Uuid::new_v4().to_string();
    let task_id = id.clone();
    let semaphore = state.slots.clone();
    let quality = request.quality;
    let password = request.password;
    let auto_rename_outputs = request.auto_rename_outputs;
    tauri::async_runtime::spawn(async move {
        let _permit = match semaphore.acquire_owned().await {
            Ok(permit) => permit,
            Err(error) => {
                let _ = app.emit(
                    CONVERSION_PROGRESS_EVENT,
                    failed_update(
                        task_id,
                        format!("Coda di elaborazione non disponibile: {error}"),
                    ),
                );
                return;
            }
        };
        let _ = app.emit(
            CONVERSION_PROGRESS_EVENT,
            JobUpdate {
                id: task_id.clone(),
                status: "running".into(),
                progress: 0,
                output_path: None,
                error: None,
            },
        );
        let result = tauri::async_runtime::spawn_blocking(move || {
            let mut document = build_pdf(&inputs, page_size, quality)?;
            if let Some(password) = password.as_deref() {
                protect_pdf(&mut document, password)?;
            }
            save_pdf(&mut document, &requested_output, auto_rename_outputs)
        })
        .await
        .map_err(|error| format!("Creazione del PDF non riuscita: {error}"))
        .and_then(|result| result);
        let update = match result {
            Ok(output) => JobUpdate {
                id: task_id,
                status: "completed".into(),
                progress: 100,
                output_path: Some(output.to_string_lossy().into_owned()),
                error: None,
            },
            Err(error) => failed_update(task_id, error),
        };
        let _ = app.emit(CONVERSION_PROGRESS_EVENT, update);
    });
    Ok(id)
}

fn failed_update(id: String, error: String) -> JobUpdate {
    JobUpdate {
        id,
        status: "failed".into(),
        progress: 0,
        output_path: None,
        error: Some(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};
    use std::fs;

    #[test]
    fn paper_pages_rotate_and_fit_images_without_borders() {
        let (width, height, x, y, image_width, image_height) = page_layout(PageSize::A4, 1600, 900);
        assert!(width > height);
        assert_eq!(x, 0.0);
        assert!(y > 0.0);
        assert_eq!(image_width, width);
        assert!((image_height - 900.0 * width / 1600.0).abs() < 0.0001);

        let (width, height, x, y, image_width, image_height) =
            page_layout(PageSize::FitToImage, 1600, 900);
        assert_eq!(
            (width, height, x, y, image_width, image_height),
            (1600.0, 900.0, 0.0, 0.0, 1600.0, 900.0)
        );
    }

    #[test]
    fn generated_pdf_preserves_input_order_and_requires_password() {
        let directory =
            std::env::temp_dir().join(format!("biolaris-images-pdf-{}", Uuid::new_v4()));
        fs::create_dir(&directory).expect("temporary folder should be created");
        let first = directory.join("first.png");
        let second = directory.join("second.png");
        ImageBuffer::from_pixel(2, 1, Rgb([255u8, 0, 0]))
            .save(&first)
            .expect("first image should be written");
        ImageBuffer::from_pixel(1, 2, Rgb([0u8, 0, 255]))
            .save(&second)
            .expect("second image should be written");

        let mut document =
            build_pdf(&[first, second], PageSize::FitToImage, 85).expect("PDF should be generated");
        assert_eq!(document.get_pages().len(), 2);
        let page_sizes = document
            .get_pages()
            .values()
            .map(|page_id| {
                let page = document
                    .get_dictionary(*page_id)
                    .expect("page should exist");
                let media_box = page.get(b"MediaBox").expect("page should have dimensions");
                media_box.as_array().expect("media box should be an array")
            })
            .map(|media_box| {
                (
                    media_box[2].as_float().expect("width should be numeric"),
                    media_box[3].as_float().expect("height should be numeric"),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(page_sizes, [(2.0, 1.0), (1.0, 2.0)]);
        protect_pdf(&mut document, "session-only").expect("password should be applied");
        assert_eq!(document.get_pages().len(), 2);
        let output = directory.join("first.pdf");
        let mut file = fs::File::create(&output).expect("PDF output should be created");
        document
            .save_to(&mut file)
            .expect("PDF should be saved in the production format");
        drop(file);

        let mut protected =
            Document::load(&output).expect("encrypted PDF structure should be readable");
        assert!(protected.is_encrypted());
        assert!(protected.decrypt("wrong-password").is_err());
        protected
            .decrypt("session-only")
            .expect("correct password should unlock PDF");
        assert!(!protected.is_encrypted());
        fs::remove_dir_all(directory).expect("temporary folder should be removed");
    }

    #[test]
    fn output_names_are_uniquified_without_overwriting() {
        let directory =
            std::env::temp_dir().join(format!("biolaris-images-pdf-{}", Uuid::new_v4()));
        fs::create_dir(&directory).expect("temporary folder should be created");
        let requested = directory.join("photo.pdf");
        fs::write(&requested, b"keep existing").expect("existing output should be written");
        let mut document = Document::with_version("1.7");
        let output =
            save_pdf(&mut document, &requested, true).expect("output should be uniquified");
        assert_eq!(
            output,
            directory
                .canonicalize()
                .expect("folder should resolve")
                .join("photo_1.pdf")
        );
        assert_eq!(
            fs::read(&requested).expect("original output should remain"),
            b"keep existing"
        );
        fs::remove_dir_all(directory).expect("temporary folder should be removed");
    }

    #[test]
    fn jpeg_exif_orientation_is_applied_before_page_layout() {
        let directory =
            std::env::temp_dir().join(format!("biolaris-images-pdf-{}", Uuid::new_v4()));
        fs::create_dir(&directory).expect("temporary folder should be created");
        let input = directory.join("sideways.jpg");
        let mut encoded = Vec::new();
        JpegEncoder::new_with_quality(&mut encoded, 100)
            .encode(&[255, 0, 0, 0, 0, 255], 2, 1, ExtendedColorType::Rgb8)
            .expect("JPEG should be encoded");
        let exif = b"Exif\0\0II*\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
        let segment_length = u16::try_from(exif.len() + 2).expect("EXIF segment should be small");
        let mut jpeg = encoded[..2].to_vec();
        jpeg.extend_from_slice(&[0xff, 0xe1]);
        jpeg.extend_from_slice(&segment_length.to_be_bytes());
        jpeg.extend_from_slice(exif);
        jpeg.extend_from_slice(&encoded[2..]);
        fs::write(&input, jpeg).expect("oriented JPEG should be written");

        let decoded = decode_image(&input).expect("JPEG should decode");
        assert_eq!((decoded.width, decoded.height), (1, 2));
        fs::remove_dir_all(directory).expect("temporary folder should be removed");
    }
}
