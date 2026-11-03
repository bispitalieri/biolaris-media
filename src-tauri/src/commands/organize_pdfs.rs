use crate::{
  commands::combine_pdfs::materialize_page_attributes,
  formats::get_file_ext,
  models::{OrganizePdfPagesRequest, PdfPagePreview},
  paths::canonical_existing_file,
  tools::tool_command,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use lopdf::{Document, Object, ObjectId};
use std::{
  collections::HashSet,
  fs::{self, OpenOptions},
  path::{Path, PathBuf},
};
use tauri::AppHandle;
use uuid::Uuid;

struct TemporaryDirectory(PathBuf);

impl Drop for TemporaryDirectory {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.0);
  }
}

fn display_name(path: &Path) -> &str {
  path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("PDF")
}

fn checked_pdf(path: &str) -> Result<PathBuf, String> {
  let input = canonical_existing_file(path)?;
  if get_file_ext(&input) != "pdf" {
    return Err("Il file selezionato non è un PDF".into());
  }
  Ok(input)
}

fn inspect_unlocked_pdf(path: &Path) -> Result<usize, String> {
  let document = Document::load(path)
    .map_err(|error| format!("Impossibile leggere {}: {error}", display_name(path)))?;
  if document.is_encrypted() {
    return Err(format!(
      "{} è protetto da password. Sbloccalo in Anteprima e aggiungilo di nuovo.",
      display_name(path)
    ));
  }
  let page_count = document.get_pages().len();
  if page_count == 0 {
    return Err(format!("{} non contiene pagine PDF", display_name(path)));
  }
  u32::try_from(page_count)
    .map_err(|_| format!("{} contiene troppe pagine", display_name(path)))?;
  Ok(page_count)
}

async fn render_pages(
  app: &AppHandle,
  input: &Path,
  first_page: u32,
  last_page: u32,
  scale: u32,
) -> Result<Vec<PdfPagePreview>, String> {
  let temporary = std::env::temp_dir().join(format!("biolaris-pdf-preview-{}", Uuid::new_v4()));
  fs::create_dir(&temporary)
    .map_err(|error| format!("Impossibile creare la cartella delle anteprime: {error}"))?;
  let _cleanup = TemporaryDirectory(temporary.clone());
  let prefix = temporary.join("page");
  let mut command = tool_command(app, "pdftoppm")
    .args(["-png", "-scale-to"])
    .arg(scale.to_string())
    .arg("-f")
    .arg(first_page.to_string())
    .arg("-l")
    .arg(last_page.to_string());
  if first_page == last_page {
    command = command.arg("-singlefile");
  }
  let output = command
    .arg(input.as_os_str())
    .arg(prefix.as_os_str())
    .output()
    .await
    .map_err(|error| format!("Avvio del rendering PDF non riuscito: {error}"))?;
  if !output.status.success() {
    let details = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    return Err(if details.is_empty() {
      format!(
        "Rendering delle pagine PDF non riuscito (codice {:?})",
        output.status.code()
      )
    } else {
      format!("Rendering delle pagine PDF non riuscito: {details}")
    });
  }

  let mut files = Vec::new();
  for entry in fs::read_dir(&temporary)
    .map_err(|error| format!("Impossibile leggere le anteprime PDF: {error}"))?
  {
    let path = entry
        .map_err(|error| format!("Impossibile leggere un file di anteprima PDF: {error}"))?
        .path();
    if path.extension().is_some_and(|ext| ext == "png") {
        files.push(path);
    }
  }
  files.sort_by_key(|path| {
    path
      .file_stem()
      .and_then(|stem| stem.to_str())
      .and_then(|stem| stem.rsplit_once('-').map(|(_, suffix)| suffix))
      .and_then(|suffix| suffix.parse::<u32>().ok())
      .unwrap_or(first_page)
  });

  let mut previews = Vec::with_capacity(files.len());
  for path in files {
    let page_number = if first_page == last_page {
      first_page
    } else {
      path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .and_then(|stem| stem.rsplit_once('-').map(|(_, suffix)| suffix))
        .and_then(|suffix| suffix.parse::<u32>().ok())
        .ok_or("Numero pagina non valido nell'anteprima PDF")?
    };
    if page_number < first_page || page_number > last_page {
      continue;
    }
    let image =
      fs::read(&path).map_err(|error| format!("Impossibile leggere un'anteprima PDF: {error}"))?;
    previews.push(PdfPagePreview {
      page_number,
      data_url: format!("data:image/png;base64,{}", STANDARD.encode(image)),
    });
  }
  if previews.len() != (last_page - first_page + 1) as usize {
    return Err("Non è stato possibile generare tutte le anteprime PDF".into());
  }
  Ok(previews)
}

#[tauri::command]
pub(crate) async fn render_pdf_pages(
  app: AppHandle,
  path: String,
) -> Result<Vec<PdfPagePreview>, String> {
  let input = checked_pdf(&path)?;
  let inspection_path = input.clone();
  let page_count =
    tauri::async_runtime::spawn_blocking(move || inspect_unlocked_pdf(&inspection_path))
      .await
      .map_err(|error| format!("Lettura del PDF non riuscita: {error}"))??;
  render_pages(&app, &input, 1, page_count as u32, 320).await
}

#[tauri::command]
pub(crate) async fn render_pdf_page(
  app: AppHandle,
  path: String,
  page_number: u32,
) -> Result<String, String> {
  let input = checked_pdf(&path)?;
  let inspection_path = input.clone();
  let page_count =
    tauri::async_runtime::spawn_blocking(move || inspect_unlocked_pdf(&inspection_path))
      .await
      .map_err(|error| format!("Lettura del PDF non riuscita: {error}"))??;
  if page_number == 0 || page_number as usize > page_count {
    return Err("Numero pagina fuori dai limiti del PDF".into());
  }
  render_pages(&app, &input, page_number, page_number, 1600)
    .await?
    .into_iter()
    .next()
    .map(|preview| preview.data_url)
    .ok_or_else(|| "Impossibile generare l'anteprima della pagina PDF".into())
}

fn organized_output_candidate(input: &Path, suffix: u64) -> Result<PathBuf, String> {
  let parent = input.parent().ok_or("Cartella PDF non valida")?;
  let stem = input
    .file_stem()
    .and_then(|value| value.to_str())
    .ok_or("Nome del PDF non valido")?;
  let suffix = if suffix == 1 {
    "(organized)".to_owned()
  } else {
    format!("(organized) {suffix}")
  };
  Ok(parent.join(format!("{stem} {suffix}.pdf")))
}

fn save_without_overwrite(document: &mut Document, input: &Path) -> Result<PathBuf, String> {
  let parent = input.parent().ok_or("Cartella PDF non valida")?;
  let temporary = parent.join(format!(".biolaris-organized-{}.pdf", Uuid::new_v4()));
  let cleanup = TemporaryFile(temporary.clone());
  let mut file = OpenOptions::new()
    .write(true)
    .create_new(true)
    .open(&temporary)
    .map_err(|error| format!("Impossibile creare il PDF temporaneo: {error}"))?;
  document
    .save_to(&mut file)
    .map_err(|error| format!("Impossibile preparare il PDF organizzato: {error}"))?;
  file
    .sync_all()
    .map_err(|error| format!("Impossibile salvare il PDF organizzato: {error}"))?;
  drop(file);

  for suffix in 1u64.. {
    let output = organized_output_candidate(input, suffix)?;
    match fs::hard_link(&temporary, &output) {
      Ok(()) => {
        drop(cleanup);
        return Ok(output);
      }
      Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
      Err(error) => {
        return Err(format!(
          "Salvataggio del PDF organizzato non riuscito: {error}"
        ))
      }
    }
  }
  Err("Impossibile trovare un nome libero per il PDF organizzato".into())
}

struct TemporaryFile(PathBuf);

impl Drop for TemporaryFile {
  fn drop(&mut self) {
    let _ = fs::remove_file(&self.0);
  }
}

fn organize_pdf(input: &Path, page_numbers: &[u32]) -> Result<PathBuf, String> {
  if page_numbers.is_empty() {
    return Err("Il PDF deve contenere almeno una pagina".into());
  }
  let mut unique = HashSet::with_capacity(page_numbers.len());
  if page_numbers.iter().any(|page| !unique.insert(*page)) {
    return Err("La selezione contiene pagine duplicate".into());
  }

  let mut document = Document::load(input)
    .map_err(|error| format!("Impossibile leggere {}: {error}", display_name(input)))?;
  if document.is_encrypted() {
    return Err(format!(
      "{} è protetto da password. Sbloccalo in Anteprima e aggiungilo di nuovo.",
      display_name(input)
    ));
  }
  let pages = document.get_pages();
  if page_numbers.iter().any(|page| !pages.contains_key(page)) {
    return Err("La selezione contiene un numero di pagina fuori dai limiti".into());
  }

  let catalog_id = document
    .trailer
    .get(b"Root")
    .map_err(|error| format!("Catalogo PDF non valido: {error}"))?
    .as_reference()
    .map_err(|error| format!("Catalogo PDF non valido: {error}"))?;
  let pages_root_id = document
    .get_dictionary(catalog_id)
    .map_err(|error| format!("Catalogo PDF non valido: {error}"))?
    .get(b"Pages")
    .map_err(|error| format!("Struttura delle pagine PDF non valida: {error}"))?
    .as_reference()
    .map_err(|error| format!("Struttura delle pagine PDF non valida: {error}"))?;

  let mut page_ids = Vec::<ObjectId>::with_capacity(page_numbers.len());
  for page_number in page_numbers {
    let page_id = *pages.get(page_number).ok_or("Numero pagina non valido")?;
    let mut page = materialize_page_attributes(&document, page_id)?;
    page.set("Parent", Object::Reference(pages_root_id));
    document.objects.insert(page_id, Object::Dictionary(page));
    page_ids.push(page_id);
  }
  let pages_root = document
    .get_dictionary_mut(pages_root_id)
    .map_err(|error| format!("Struttura delle pagine PDF non valida: {error}"))?;
  pages_root.remove(b"Parent");
  pages_root.set("Count", page_ids.len() as i64);
  pages_root.set(
    "Kids",
    page_ids
      .into_iter()
      .map(Object::Reference)
      .collect::<Vec<_>>(),
  );
  document.prune_objects();
  save_without_overwrite(&mut document, input)
}

#[tauri::command]
pub(crate) async fn organize_pdf_pages(request: OrganizePdfPagesRequest) -> Result<String, String> {
  let input = checked_pdf(&request.pdf_path)?;
  tauri::async_runtime::spawn_blocking(move || {
    organize_pdf(&input, &request.page_numbers).map(|output| output.to_string_lossy().into_owned())
  })
  .await
  .map_err(|error| format!("Organizzazione del PDF non riuscita: {error}"))?
}

#[cfg(test)]
mod tests {
  use super::{organize_pdf, organized_output_candidate};
  use lopdf::{Dictionary, Document, Object};
  use std::{
    fs,
    path::{Path, PathBuf},
  };
  use uuid::Uuid;

  fn test_pdf(page_count: u32) -> Document {
    let mut document = Document::with_version("1.7");
    let pages_id = document.new_object_id();
    let mut page_ids = Vec::new();
    for index in 0..page_count {
      let page_id = document.new_object_id();
      let mut page = Dictionary::new();
      page.set("Type", "Page");
      page.set("TestPage", Object::Integer(index as i64 + 1));
      page.set("Parent", Object::Reference(pages_id));
      document.objects.insert(page_id, Object::Dictionary(page));
      page_ids.push(page_id);
    }

    let mut pages = Dictionary::new();
    pages.set("Type", "Pages");
    pages.set("Count", page_count);
    pages.set(
      "Kids",
      page_ids
        .into_iter()
        .map(Object::Reference)
        .collect::<Vec<_>>(),
    );
    pages.set("MediaBox", vec![0.into(), 0.into(), 612.into(), 792.into()]);
    document.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog_id = document.new_object_id();
    let mut catalog = Dictionary::new();
    catalog.set("Type", "Catalog");
    catalog.set("Pages", Object::Reference(pages_id));
    document
      .objects
      .insert(catalog_id, Object::Dictionary(catalog));
    document.trailer.set("Root", Object::Reference(catalog_id));
    document
  }

  #[test]
  fn organized_output_names_are_numbered_without_overwriting() {
    let input = Path::new("/documents/report.pdf");
    assert_eq!(
      organized_output_candidate(input, 1).expect("first name should be valid"),
      PathBuf::from("/documents/report (organized).pdf")
    );
    assert_eq!(
      organized_output_candidate(input, 2).expect("numbered name should be valid"),
      PathBuf::from("/documents/report (organized) 2.pdf")
    );
  }

  #[test]
  fn organizing_keeps_only_requested_pages_in_requested_order() {
    let directory = std::env::temp_dir().join(format!("biolaris-pdf-test-{}", Uuid::new_v4()));
    fs::create_dir(&directory).expect("temporary test directory should be created");
    let input = directory.join("report.pdf");
    test_pdf(4).save(&input).expect("input PDF should be saved");

    let output = organize_pdf(&input, &[4, 2]).expect("valid page order should save");
    let document = Document::load(&output).expect("organized PDF should be readable");
    let pages = document.get_pages();
    assert_eq!(pages.len(), 2);
    assert_eq!(pages.keys().copied().collect::<Vec<_>>(), [1, 2]);
    let order = pages
      .values()
      .map(|page_id| {
        document
          .get_dictionary(*page_id)
          .expect("page dictionary should exist")
          .get(b"TestPage")
          .expect("test marker should exist")
          .as_i64()
          .expect("test marker should be an integer")
      })
      .collect::<Vec<_>>();
    assert_eq!(order, [4, 2]);
    fs::remove_dir_all(directory).expect("temporary test directory should be removed");
  }

  #[test]
  fn organizing_rejects_empty_duplicate_and_out_of_range_selections() {
    let directory = std::env::temp_dir().join(format!("biolaris-pdf-test-{}", Uuid::new_v4()));
    fs::create_dir(&directory).expect("temporary test directory should be created");
    let input = directory.join("report.pdf");
    test_pdf(2).save(&input).expect("input PDF should be saved");

    assert!(organize_pdf(&input, &[]).is_err());
    assert!(organize_pdf(&input, &[1, 1]).is_err());
    assert!(organize_pdf(&input, &[3]).is_err());
    fs::remove_dir_all(directory).expect("temporary test directory should be removed");
  }
}
