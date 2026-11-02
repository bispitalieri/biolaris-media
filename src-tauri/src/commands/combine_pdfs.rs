use crate::{
  constants::CONVERSION_PROGRESS_EVENT,
  formats::get_file_ext,
  models::{CombinePdfsRequest, JobUpdate, PdfFileInfo, QueueState},
  paths::canonical_existing_file,
};
use lopdf::{Dictionary, Document, Object, ObjectId};
use std::{
  collections::{BTreeMap, HashSet},
  fs::{self, OpenOptions},
  path::{Path, PathBuf},
};
use tauri::{Emitter, State};
use uuid::Uuid;

#[tauri::command]
pub(crate) async fn probe_pdf_file(path: String) -> Result<PdfFileInfo, String> {
  let input = canonical_existing_file(&path)?;
  if get_file_ext(&input) != "pdf" {
    return Err("Il file selezionato non è un PDF".into());
  }
  tauri::async_runtime::spawn_blocking(move || inspect_pdf(&input))
    .await
    .map_err(|error| format!("Lettura del PDF non riuscita: {error}"))?
}

fn inspect_pdf(path: &Path) -> Result<PdfFileInfo, String> {
  let document = Document::load(path)
    .map_err(|error| format!("Impossibile leggere {}: {error}", display_name(path)))?;
  let locked = document.is_encrypted();
  let page_count = if locked {
    locked_page_count(&document)
  } else {
    Some(document.get_pages().len())
  };
  if !locked && page_count == Some(0) {
    return Err(format!("{} non contiene pagine PDF", display_name(path)));
  }
  let size_bytes = fs::metadata(path)
    .map_err(|error| {
      format!(
        "Impossibile leggere le dimensioni di {}: {error}",
        display_name(path)
      )
    })?
    .len();
  Ok(PdfFileInfo {
    page_count,
    size_bytes,
    locked,
  })
}

fn locked_page_count(document: &Document) -> Option<usize> {
  let catalog_id = document.trailer.get(b"Root").ok()?.as_reference().ok()?;
  let catalog = document.get_dictionary(catalog_id).ok()?;
  let pages_id = catalog.get(b"Pages").ok()?.as_reference().ok()?;
  let pages = document.get_dictionary(pages_id).ok()?;
  let count = pages.get(b"Count").ok()?.as_i64().ok()?;
  usize::try_from(count).ok()
}

fn display_name(path: &Path) -> &str {
  path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("PDF")
}

#[tauri::command]
pub(crate) async fn enqueue_combine_pdfs(
  app: tauri::AppHandle,
  state: State<'_, QueueState>,
  request: CombinePdfsRequest,
) -> Result<String, String> {
  if request.pdf_paths.len() < 2 {
    return Err("Seleziona almeno due PDF da unire".into());
  }
  let inputs = request
    .pdf_paths
    .iter()
    .map(|path| canonical_existing_file(path))
    .collect::<Result<Vec<_>, _>>()?;
  for input in &inputs {
    if get_file_ext(input) != "pdf" {
      return Err(format!(
        "Il file selezionato non è un PDF: {}",
        display_name(input)
      ));
    }
  }
  let files_to_inspect = inputs.clone();
  let infos = tauri::async_runtime::spawn_blocking(move || {
    files_to_inspect
      .iter()
      .map(|path| inspect_pdf(path))
      .collect::<Result<Vec<_>, _>>()
  })
  .await
  .map_err(|error| format!("Lettura dei PDF non riuscita: {error}"))??;
  if let Some((path, _)) = inputs.iter().zip(&infos).find(|(_, info)| info.locked) {
    return Err(format!(
      "{} è protetto da password. Sbloccalo in Anteprima e aggiungilo di nuovo.",
      display_name(path)
    ));
  }

  let id = Uuid::new_v4().to_string();
  let task_id = id.clone();
  let semaphore = state.slots.clone();
  tauri::async_runtime::spawn(async move {
    let permit = match semaphore.acquire_owned().await {
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
    let _permit = permit;
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
    let paths = inputs;
    let result = tauri::async_runtime::spawn_blocking(move || combine_pdfs(&paths))
      .await
      .map_err(|error| format!("Unione dei PDF non riuscita: {error}"))
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

fn combine_pdfs(inputs: &[PathBuf]) -> Result<PathBuf, String> {
  let mut documents = Vec::with_capacity(inputs.len());
  for path in inputs {
    let document = Document::load(path)
      .map_err(|error| format!("Impossibile leggere {}: {error}", display_name(path)))?;
    if document.is_encrypted() {
      return Err(format!(
        "{} è protetto da password. Sbloccalo in Anteprima e aggiungilo di nuovo.",
        display_name(path)
      ));
    }
    documents.push(document);
  }
  let mut merged = merge_documents(documents)?;
  save_without_overwrite(&mut merged, &inputs[0])
}

fn inherited_page_attribute(
  document: &Document,
  page_id: ObjectId,
  key: &[u8],
) -> Result<Option<Object>, String> {
  let mut current = page_id;
  let mut visited = HashSet::new();
  loop {
    if !visited.insert(current) {
      return Err("La struttura delle pagine PDF contiene un riferimento ciclico".into());
    }
    let node = document
      .get_dictionary(current)
      .map_err(|error| format!("Struttura delle pagine PDF non valida: {error}"))?;
    if let Ok(value) = node.get(key) {
      return Ok(Some(value.clone()));
    }
    match node.get(b"Parent") {
      Err(_) | Ok(Object::Null) => return Ok(None),
      Ok(parent) => {
        current = parent
          .as_reference()
          .map_err(|error| format!("Struttura delle pagine PDF non valida: {error}"))?;
      }
    }
  }
}

fn materialize_page_attributes(
  document: &Document,
  page_id: ObjectId,
) -> Result<Dictionary, String> {
  let mut page = document
    .get_dictionary(page_id)
    .map_err(|error| format!("Pagina PDF non valida: {error}"))?
    .clone();
  let media_box = inherited_page_attribute(document, page_id, b"MediaBox")?
    .ok_or("Pagina PDF senza dimensioni MediaBox")?;
  let crop_box =
    inherited_page_attribute(document, page_id, b"CropBox")?.unwrap_or_else(|| media_box.clone());
  let resources = inherited_page_attribute(document, page_id, b"Resources")?
    .unwrap_or_else(|| Object::Dictionary(Dictionary::new()));
  let rotation =
    inherited_page_attribute(document, page_id, b"Rotate")?.unwrap_or(Object::Integer(0));
  page.set("MediaBox", media_box);
  page.set("CropBox", crop_box);
  page.set("Resources", resources);
  page.set("Rotate", rotation);
  Ok(page)
}

fn merge_documents(documents: Vec<Document>) -> Result<Document, String> {
  if documents.len() < 2 {
    return Err("Seleziona almeno due PDF da unire".into());
  }
  let version = documents
    .iter()
    .map(|document| document.version.as_str())
    .max()
    .unwrap_or("1.5")
    .to_owned();
  let mut output = Document::with_version(&version);
  let mut page_ids = Vec::new();
  let mut page_objects = BTreeMap::new();
  let mut other_objects = BTreeMap::new();
  let mut catalog = None;
  let mut pages_root = None;
  let mut info = None;
  let mut next_id = 1u32;

  for mut document in documents {
    let source_pages = document.get_pages().into_values().collect::<Vec<_>>();
    if source_pages.is_empty() {
      return Err("Un PDF selezionato non contiene pagine".into());
    }
    for page_id in &source_pages {
      let page = materialize_page_attributes(&document, *page_id)?;
      document.objects.insert(*page_id, Object::Dictionary(page));
    }

    document.renumber_objects_with(next_id);
    next_id = document
      .max_id
      .checked_add(1)
      .ok_or("Il PDF contiene troppi oggetti")?;
    if info.is_none() {
      info = document.trailer.get(b"Info").ok().cloned();
    }

    for page_id in document.get_pages().into_values() {
      page_ids.push(page_id);
    }
    for (object_id, object) in document.objects {
      match object.type_name().unwrap_or(b"") {
        b"Catalog" if catalog.is_none() => {
          catalog = Some(
            object
              .as_dict()
              .map_err(|error| format!("Catalogo PDF non valido: {error}"))?
              .clone(),
          );
        }
        b"Page" => {
          page_objects.insert(object_id, object);
        }
        b"Pages" if pages_root.is_none() => {
          pages_root = Some(
            object
              .as_dict()
              .map_err(|error| format!("Struttura delle pagine PDF non valida: {error}"))?
              .clone(),
          );
        }
        b"Catalog" | b"Pages" => {}
        _ => {
          other_objects.insert(object_id, object);
        }
      }
    }
  }

  let page_count =
    u32::try_from(page_ids.len()).map_err(|_| "Il PDF combinato contiene troppe pagine")?;
  output.objects = other_objects;
  output.objects.extend(page_objects);
  output.max_id = next_id.saturating_sub(1);
  let pages_id = output.new_object_id();
  let catalog_id = output.new_object_id();

  for page_id in &page_ids {
    let page = output
      .objects
      .get_mut(page_id)
      .ok_or("Pagina PDF non valida")?
      .as_dict_mut()
      .map_err(|error| format!("Pagina PDF non valida: {error}"))?;
    page.set("Parent", Object::Reference(pages_id));
  }

  let mut pages = pages_root.ok_or("Struttura delle pagine PDF non valida")?;
  pages.remove(b"Parent");
  for key in [b"MediaBox".as_slice(), b"CropBox", b"Resources", b"Rotate"] {
    pages.remove(key);
  }
  pages.set("Type", "Pages");
  pages.set("Count", page_count);
  pages.set(
    "Kids",
    page_ids
      .into_iter()
      .map(Object::Reference)
      .collect::<Vec<_>>(),
  );
  output.objects.insert(pages_id, Object::Dictionary(pages));

  let mut catalog = catalog.ok_or("Catalogo PDF non valido")?;
  catalog.set("Pages", Object::Reference(pages_id));
  output
    .objects
    .insert(catalog_id, Object::Dictionary(catalog));
  output.trailer.set("Root", Object::Reference(catalog_id));
  if let Some(info) = info {
    output.trailer.set("Info", info);
  }
  Ok(output)
}

struct TemporaryFile(PathBuf);

impl Drop for TemporaryFile {
  fn drop(&mut self) {
    let _ = fs::remove_file(&self.0);
  }
}

fn output_candidate(first: &Path, number: u64) -> Result<PathBuf, String> {
  let parent = first.parent().ok_or("Cartella PDF non valida")?;
  let stem = first
    .file_stem()
    .and_then(|value| value.to_str())
    .ok_or("Nome del PDF non valido")?;
  let suffix = if number == 1 {
    "(combined)".to_owned()
  } else {
    format!("(combined) {number}")
  };
  Ok(parent.join(format!("{stem} {suffix}.pdf")))
}

fn save_without_overwrite(document: &mut Document, first: &Path) -> Result<PathBuf, String> {
  let parent = first.parent().ok_or("Cartella PDF non valida")?;
  let mut temporary_path = None;
  for _ in 0..5 {
    let candidate = parent.join(format!(".biolaris-combined-{}.pdf", Uuid::new_v4()));
    match OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&candidate)
    {
      Ok(mut file) => {
        let cleanup = TemporaryFile(candidate.clone());
        document
          .save_to(&mut file)
          .map_err(|error| format!("Impossibile preparare il PDF combinato: {error}"))?;
        file
          .sync_all()
          .map_err(|error| format!("Impossibile salvare il PDF combinato: {error}"))?;
        drop(file);
        temporary_path = Some((candidate, cleanup));
        break;
      }
      Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
      Err(error) => return Err(format!("Impossibile creare il PDF combinato: {error}")),
    }
  }
  let (temporary_path, _cleanup) =
    temporary_path.ok_or("Impossibile creare il file temporaneo per il PDF combinato")?;

  for number in 1u64.. {
    let output = output_candidate(first, number)?;
    match fs::hard_link(&temporary_path, &output) {
      Ok(()) => return Ok(output),
      Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
      Err(error) => {
        return Err(format!(
          "Salvataggio del PDF combinato non riuscito: {error}"
        ))
      }
    }
  }
  Err("Impossibile trovare un nome libero per il PDF combinato".into())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn test_pdf(page_count: u32) -> Document {
    let mut document = Document::with_version("1.7");
    let pages_id = document.new_object_id();
    let mut page_ids = Vec::new();
    for _ in 0..page_count {
      let page_id = document.new_object_id();
      let mut page = Dictionary::new();
      page.set("Type", "Page");
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
        .iter()
        .copied()
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
  fn output_names_match_the_combined_numbering() {
    let first = Path::new("/documents/report.pdf");
    assert_eq!(
      output_candidate(first, 1).expect("first name should be valid"),
      PathBuf::from("/documents/report (combined).pdf")
    );
    assert_eq!(
      output_candidate(first, 2).expect("numbered name should be valid"),
      PathBuf::from("/documents/report (combined) 2.pdf")
    );
  }

  #[test]
  fn merge_preserves_page_order_and_inherited_attributes() {
    let merged =
      merge_documents(vec![test_pdf(2), test_pdf(1)]).expect("valid documents should merge");
    assert_eq!(merged.get_pages().len(), 3);

    let catalog_id = merged
      .trailer
      .get(b"Root")
      .expect("catalog reference should exist")
      .as_reference()
      .expect("catalog should be an indirect reference");
    let pages_id = merged
      .get_dictionary(catalog_id)
      .expect("catalog should exist")
      .get(b"Pages")
      .expect("page tree reference should exist")
      .as_reference()
      .expect("page tree should be an indirect reference");
    for page_id in merged.get_pages().into_values() {
      let page = merged
        .get_dictionary(page_id)
        .expect("merged page should exist");
      assert_eq!(
        page
          .get(b"Parent")
          .expect("page parent should exist")
          .as_reference()
          .expect("page parent should be a reference"),
        pages_id
      );
      assert!(page.get(b"MediaBox").is_ok());
    }
  }

  #[test]
  fn saving_uses_a_numbered_name_without_overwriting() {
    let directory = std::env::temp_dir().join(format!("biolaris-pdf-test-{}", Uuid::new_v4()));
    fs::create_dir(&directory).expect("temporary test directory should be created");
    let first = directory.join("report.pdf");
    let existing = output_candidate(&first, 1).expect("first output name should be valid");
    fs::write(&existing, b"keep existing file").expect("existing output should be written");

    let mut document =
      merge_documents(vec![test_pdf(1), test_pdf(1)]).expect("valid documents should merge");
    let output =
      save_without_overwrite(&mut document, &first).expect("merged document should be saved");
    assert_eq!(
      output,
      output_candidate(&first, 2).expect("numbered output should be valid")
    );
    assert_eq!(
      fs::read(&existing).expect("existing output should remain"),
      b"keep existing file"
    );
    assert_eq!(
      Document::load(&output)
        .expect("saved output should be readable")
        .get_pages()
        .len(),
      2
    );
    fs::remove_dir_all(directory).expect("temporary test directory should be removed");
  }

  #[test]
  fn inspection_reports_password_protected_pdfs_as_locked() {
    let directory = std::env::temp_dir().join(format!("biolaris-pdf-test-{}", Uuid::new_v4()));
    fs::create_dir(&directory).expect("temporary test directory should be created");
    let path = directory.join("locked.pdf");
    let mut document = test_pdf(1);
    document.trailer.set(
      "ID",
      Object::Array(vec![
        Object::string_literal(b"0123456789abcdef"),
        Object::string_literal(b"fedcba9876543210"),
      ]),
    );
    let encryption = lopdf::EncryptionState::try_from(lopdf::EncryptionVersion::V2 {
      document: &mut document,
      owner_password: "owner",
      user_password: "user",
      key_length: 128,
      permissions: lopdf::Permissions::all(),
    })
    .expect("encryption settings should be valid");
    document
      .encrypt(&encryption)
      .expect("document should be encrypted");
    document.save(&path).expect("encrypted PDF should be saved");

    let info = inspect_pdf(&path).expect("encrypted PDF should be inspectable");
    assert!(info.locked);
    assert_eq!(info.page_count, None);
    assert_eq!(
      info.size_bytes,
      fs::metadata(&path).expect("PDF should exist").len()
    );
    fs::remove_dir_all(directory).expect("temporary test directory should be removed");
  }
}
