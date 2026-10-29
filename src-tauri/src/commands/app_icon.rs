use image::{imageops::FilterType, DynamicImage, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

const MAX_INPUT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppIconPlatforms {
  windows: bool,
  macos: bool,
  ios: bool,
  android: bool,
  web: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppIconRequest {
  /// The UI rasterizes SVG safely to PNG; all other accepted images are sent as bytes.
  image_bytes: Vec<u8>,
  output_directory: String,
  platforms: AppIconPlatforms,
  source_svg: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppIconResult {
  output_directories: Vec<String>,
}

#[tauri::command]
pub(crate) async fn create_app_icons(request: AppIconRequest) -> Result<AppIconResult, String> {
  tauri::async_runtime::spawn_blocking(move || create_app_icons_sync(request))
    .await
    .map_err(|error| format!("Elaborazione AppIcon non riuscita: {error}"))?
}

fn create_app_icons_sync(request: AppIconRequest) -> Result<AppIconResult, String> {
  if request.image_bytes.is_empty() || request.image_bytes.len() > MAX_INPUT_BYTES {
    return Err("Immagine non valida o più grande di 32 MiB".into());
  }
  let chosen = [
    request.platforms.windows,
    request.platforms.macos,
    request.platforms.ios,
    request.platforms.android,
    request.platforms.web,
  ]
  .iter()
  .any(|selected| *selected);
  if !chosen {
    return Err("Seleziona almeno una piattaforma".into());
  }

  let decoded = image::load_from_memory(&request.image_bytes)
    .map_err(|error| format!("Impossibile leggere l'immagine: {error}"))?;
  let (width, height) = (decoded.width(), decoded.height());
  if width != height {
    return Err("L'immagine deve essere quadrata (rapporto 1:1)".into());
  }
  if width < 512 {
    return Err("Risoluzione insufficiente: servono almeno 512×512 px".into());
  }

  let parent = Path::new(&request.output_directory)
    .canonicalize()
    .map_err(|error| format!("Cartella di destinazione non valida: {error}"))?;
  if !parent.is_dir() {
    return Err("La destinazione deve essere una cartella".into());
  }
  let pixels = decoded.to_rgba8();
  let mut output_directories = Vec::new();

  for (enabled, system) in [
    (request.platforms.windows, "windows"),
    (request.platforms.macos, "macos"),
    (request.platforms.ios, "ios"),
    (request.platforms.android, "android"),
    (request.platforms.web, "web"),
  ] {
    if !enabled {
      continue;
    }
    let root = parent.join(format!("biolaris-appicon-{system}"));
    fs::create_dir_all(&root).map_err(io_error)?;
    let platform_dir = root.join(system);
    fs::create_dir_all(&platform_dir).map_err(io_error)?;
    match system {
      "windows" => write_ico(&pixels, &platform_dir.join("app.ico"))?,
      "macos" => write_iconset(&pixels, &platform_dir.join("app.iconset"))?,
      "ios" => write_ios(&pixels, &platform_dir.join("AppIcon.appiconset"))?,
      "android" => write_android(&pixels, &platform_dir)?,
      "web" => write_web(&pixels, &platform_dir, request.source_svg.as_deref())?,
      _ => return Err("Piattaforma AppIcon non supportata".into()),
    }
    output_directories.push(platform_dir.to_string_lossy().into_owned());
  }
  Ok(AppIconResult { output_directories })
}

fn resized(image: &RgbaImage, size: u32) -> RgbaImage {
  DynamicImage::ImageRgba8(image.clone())
    .resize_exact(size, size, FilterType::Lanczos3)
    .to_rgba8()
}

fn write_png(image: &RgbaImage, path: &Path, size: u32) -> Result<(), String> {
  resized(image, size)
    .save_with_format(path, ImageFormat::Png)
    .map_err(io_error)
}

fn write_ico(image: &RgbaImage, path: &Path) -> Result<(), String> {
  let mut icon = ico::IconDir::new(ico::ResourceType::Icon);
  for size in [16, 32, 48, 64, 128, 256] {
    let rgba = resized(image, size);
    let data = ico::IconImage::from_rgba_data(size, size, rgba.into_raw());
    let entry = ico::IconDirEntry::encode(&data).map_err(|error| error.to_string())?;
    icon.add_entry(entry);
  }
  let mut file = fs::File::create(path).map_err(io_error)?;
  icon.write(&mut file).map_err(|error| error.to_string())
}

fn write_iconset(image: &RgbaImage, dir: &Path) -> Result<(), String> {
  fs::create_dir_all(dir).map_err(io_error)?;
  for (name, size) in [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
  ] {
    write_png(image, &dir.join(name), size)?;
  }
  Ok(())
}

fn write_ios(image: &RgbaImage, dir: &Path) -> Result<(), String> {
  fs::create_dir_all(dir).map_err(io_error)?;
  // Preserve every requested pixel dimension. size/scale describe the matching
  // point-size variant to Xcode; repeated sizes are permitted for distinct idioms.
  let entries: [(u32, &str, &str, &str); 13] = [
    (20, "20x20", "20x20", "1x"),
    (29, "29x29", "29x29", "1x"),
    (40, "40x40", "40x40", "1x"),
    (58, "58x58", "29x29", "2x"),
    (60, "60x60", "60x60", "1x"),
    (76, "76x76", "76x76", "1x"),
    (80, "80x80", "40x40", "2x"),
    (87, "87x87", "29x29", "3x"),
    (120, "120x120", "60x60", "2x"),
    (152, "152x152", "76x76", "2x"),
    (167, "167x167", "83.5x83.5", "2x"),
    (180, "180x180", "60x60", "3x"),
    (1024, "AppStore", "1024x1024", "1x"),
  ];
  let mut images_json = Vec::new();
  for (size, stem, point_size, scale) in entries {
    let filename = format!("AppIcon-{stem}.png");
    write_png(image, &dir.join(&filename), size)?;
    let idiom = if size == 1024 {
      "ios-marketing"
    } else if size == 76 || size == 152 || size == 167 {
      "ipad"
    } else {
      "iphone"
    };
    images_json
      .push(serde_json::json!({"filename":filename,"idiom":idiom,"scale":scale,"size":point_size}));
  }
  let contents = serde_json::json!({"images":images_json,"info":{"author":"xcode","version":1}});
  fs::write(
    dir.join("Contents.json"),
    serde_json::to_vec_pretty(&contents).map_err(|e| e.to_string())?,
  )
  .map_err(io_error)
}

fn write_android(image: &RgbaImage, dir: &Path) -> Result<(), String> {
  for (density, size) in [
    ("mdpi", 48),
    ("hdpi", 72),
    ("xhdpi", 96),
    ("xxhdpi", 144),
    ("xxxhdpi", 192),
  ] {
    let mipmap = dir.join("res").join(format!("mipmap-{density}"));
    fs::create_dir_all(&mipmap).map_err(io_error)?;
    write_png(image, &mipmap.join("ic_launcher.png"), size)?;
  }
  write_png(image, &dir.join("google-play-icon.png"), 512)
}

fn write_web(image: &RgbaImage, dir: &Path, source_svg: Option<&str>) -> Result<(), String> {
  write_png(image, &dir.join("apple-touch-icon.png"), 180)?;
  write_png(image, &dir.join("icon-192.png"), 192)?;
  write_png(image, &dir.join("icon-512.png"), 512)?;
  if let Some(svg) = source_svg {
    if svg.len() <= 2 * 1024 * 1024 && svg.to_ascii_lowercase().contains("<svg") {
      fs::write(dir.join("favicon.svg"), svg).map_err(io_error)?;
    }
  }
  write_ico(image, &dir.join("favicon.ico"))
}

fn io_error(error: impl std::fmt::Display) -> String {
  format!("Errore durante la scrittura AppIcon: {error}")
}
