use crate::{
  constants::CONVERSION_PROGRESS_EVENT,
  formats::get_file_ext,
  models::{JobUpdate, QueueState, SplitPdfsRequest},
  paths::canonical_existing_file,
};
use lopdf::Document;
use std::{
  fs::{self, OpenOptions},
  path::{Path, PathBuf},
};
use tauri::{Emitter, State};
use uuid::Uuid;

const MAX_PAGE_RANGES: usize = 10_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PageRange {
  first: u32,
  last: u32,
}

fn display_name(path: &Path) -> &str {
  path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("PDF")
}

fn parse_page_ranges(value: &str, page_count: u32) -> Result<Vec<PageRange>, String> {
  if page_count == 0 {
    return Err("Il PDF non contiene pagine".into());
  }
  if value.trim().is_empty() {
    if page_count as usize > MAX_PAGE_RANGES {
      return Err(format!(
        "Il PDF supera il limite di {MAX_PAGE_RANGES} pagine"
      ));
    }
    return Ok(
      (1..=page_count)
        .map(|page| PageRange {
          first: page,
          last: page,
        })
        .collect(),
    );
  }

  let parts = value.split(',').map(str::trim).collect::<Vec<_>>();
  if parts.len() > MAX_PAGE_RANGES {
    return Err(format!(
      "Sono consentiti al massimo {MAX_PAGE_RANGES} intervalli"
    ));
  }
  parts
    .iter()
    .map(|part| {
      let invalid = || format!("Intervallo di pagine non valido: “{part}”");
      if part.is_empty() {
        return Err(invalid());
      }
      let (first, last) = match part.split_once('-') {
        None => {
          let page = part.parse::<u32>().map_err(|_| invalid())?;
          (page, page)
        }
        Some((first, last)) => {
          if first.trim().is_empty() && last.trim().is_empty() {
            return Err(invalid());
          }
          let first = if first.trim().is_empty() {
            1
          } else {
            first.trim().parse::<u32>().map_err(|_| invalid())?
          };
          let last = if last.trim().is_empty() {
            page_count
          } else {
            last.trim().parse::<u32>().map_err(|_| invalid())?
          };
          (first, last)
        }
      };
      if first == 0 || last == 0 || first > last || last > page_count {
        return Err(format!(
          "Intervallo “{part}” fuori dai limiti: il PDF contiene {page_count} pagine"
        ));
      }
      Ok(PageRange { first, last })
    })
    .collect()
}

fn split_output_candidate(
  input: &Path,
  range_number: usize,
  suffix: u64,
) -> Result<PathBuf, String> {
  let parent = input.parent().ok_or("Cartella PDF non valida")?;
  let stem = input
    .file_stem()
    .and_then(|value| value.to_str())
    .ok_or("Nome del PDF non valido")?;
  let suffix = if suffix == 0 {
    String::new()
  } else {
    format!("_{suffix}")
  };
  Ok(parent.join(format!("{stem}-{range_number}{suffix}.pdf")))
}

fn next_output_path(
  input: &Path,
  range_number: usize,
  suffix: &mut u64,
) -> Result<PathBuf, String> {
  loop {
    let candidate = split_output_candidate(input, range_number, *suffix)?;
    match fs::symlink_metadata(&candidate) {
      Ok(_) => *suffix = suffix.saturating_add(1),
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(candidate),
      Err(error) => return Err(format!("Percorso output non accessibile: {error}")),
    }
  }
}

struct TemporaryFile(PathBuf);

impl Drop for TemporaryFile {
  fn drop(&mut self) {
    let _ = fs::remove_file(&self.0);
  }
}

fn save_split_page_set(
  document: &mut Document,
  input: &Path,
  range_number: usize,
) -> Result<PathBuf, String> {
  let parent = input.parent().ok_or("Cartella PDF non valida")?;
  let temporary = parent.join(format!(".biolaris-split-{}.pdf", Uuid::new_v4()));
  let cleanup = TemporaryFile(temporary.clone());
  let mut file = OpenOptions::new()
    .write(true)
    .create_new(true)
    .open(&temporary)
    .map_err(|error| format!("Impossibile creare il PDF temporaneo: {error}"))?;
  document
    .save_to(&mut file)
    .map_err(|error| format!("Impossibile preparare il PDF diviso: {error}"))?;
  file
    .sync_all()
    .map_err(|error| format!("Impossibile salvare il PDF diviso: {error}"))?;
  drop(file);

  let mut suffix = 0;
  loop {
    let output = next_output_path(input, range_number, &mut suffix)?;
    match fs::hard_link(&temporary, &output) {
      Ok(()) => {
        drop(cleanup);
        return Ok(output);
      }
      Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
        suffix = suffix.saturating_add(1);
      }
      Err(error) => return Err(format!("Salvataggio del PDF diviso non riuscito: {error}")),
    }
  }
}

fn split_pdf(input: &Path, ranges: &[PageRange]) -> Result<Vec<PathBuf>, String> {
  let document = Document::load(input)
    .map_err(|error| format!("Impossibile leggere {}: {error}", display_name(input)))?;
  if document.is_encrypted() {
    return Err(format!(
      "{} è protetto da password. Sbloccalo in Anteprima e aggiungilo di nuovo.",
      display_name(input)
    ));
  }
  let pages = document.get_pages();
  let mut outputs = Vec::with_capacity(ranges.len());
  for (index, range) in ranges.iter().enumerate() {
    let page_numbers = pages
      .keys()
      .filter(|page| **page >= range.first && **page <= range.last)
      .collect::<Vec<_>>();
    if page_numbers.len() != (range.last - range.first + 1) as usize {
      return Err(format!(
        "Impossibile leggere tutte le pagine dell'intervallo {}-{} in {}",
        range.first,
        range.last,
        display_name(input)
      ));
    }
    let pages_to_delete = pages
      .keys()
      .filter(|page| **page < range.first || **page > range.last)
      .copied()
      .collect::<Vec<_>>();
    let mut output = document.clone();
    output.delete_pages(&pages_to_delete);
    output.prune_objects();
    outputs.push(save_split_page_set(&mut output, input, index + 1)?);
  }
  Ok(outputs)
}

#[tauri::command]
pub(crate) async fn enqueue_split_pdfs(
  app: tauri::AppHandle,
  state: State<'_, QueueState>,
  request: SplitPdfsRequest,
) -> Result<String, String> {
  if request.pdf_paths.is_empty() {
    return Err("Seleziona almeno un PDF da dividere".into());
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
  let ranges_text = request.page_ranges;
  let inspected_inputs = inputs.clone();
  let ranges_by_input = tauri::async_runtime::spawn_blocking(move || {
    inspected_inputs
      .iter()
      .map(|input| {
        let document = Document::load(input)
          .map_err(|error| format!("Impossibile leggere {}: {error}", display_name(input)))?;
        if document.is_encrypted() {
          return Err(format!(
            "{} è protetto da password. Sbloccalo in Anteprima e aggiungilo di nuovo.",
            display_name(input)
          ));
        }
        let page_count = u32::try_from(document.get_pages().len())
          .map_err(|_| format!("{} contiene troppe pagine", display_name(input)))?;
        parse_page_ranges(&ranges_text, page_count)
          .map_err(|error| format!("{}: {error}", display_name(input)))
      })
      .collect::<Result<Vec<_>, String>>()
  })
  .await
  .map_err(|error| format!("Lettura dei PDF non riuscita: {error}"))??;

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
    let result = tauri::async_runtime::spawn_blocking(move || {
      let mut outputs = Vec::new();
      for (input, ranges) in inputs.iter().zip(&ranges_by_input) {
        outputs.extend(split_pdf(input, ranges)?);
      }
      Ok::<_, String>(outputs)
    })
    .await
    .map_err(|error| format!("Divisione dei PDF non riuscita: {error}"))
    .and_then(|result| result);
    let update = match result {
      Ok(outputs) => JobUpdate {
        id: task_id,
        status: "completed".into(),
        progress: 100,
        output_path: outputs
          .first()
          .and_then(|path| path.parent())
          .map(|path| path.to_string_lossy().into_owned()),
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
  use super::{parse_page_ranges, split_output_candidate, split_pdf, PageRange};
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
  fn parses_single_closed_open_and_blank_ranges() {
    assert_eq!(
      parse_page_ranges("1-3, 5, 8-", 10).expect("ranges should parse"),
      [
        PageRange { first: 1, last: 3 },
        PageRange { first: 5, last: 5 },
        PageRange { first: 8, last: 10 },
      ]
    );
    assert_eq!(
      parse_page_ranges("-3", 5).expect("open start should parse"),
      [PageRange { first: 1, last: 3 }]
    );
    assert_eq!(
      parse_page_ranges("", 3).expect("blank range should split every page"),
      [
        PageRange { first: 1, last: 1 },
        PageRange { first: 2, last: 2 },
        PageRange { first: 3, last: 3 },
      ]
    );
  }

  #[test]
  fn rejects_malformed_and_out_of_bounds_ranges() {
    for ranges in ["0", "4-2", "1,,3", "1-11", "-0", "-", "1-2-3"] {
      assert!(
        parse_page_ranges(ranges, 10).is_err(),
        "{ranges} should fail"
      );
    }
  }

  #[test]
  fn generated_names_keep_range_number_and_increment_collisions() {
    let input = Path::new("/documents/report.pdf");
    assert_eq!(
      split_output_candidate(input, 1, 0).expect("name should be valid"),
      PathBuf::from("/documents/report-1.pdf")
    );
    assert_eq!(
      split_output_candidate(input, 1, 1).expect("numbered name should be valid"),
      PathBuf::from("/documents/report-1_1.pdf")
    );
  }

  #[test]
  fn split_outputs_contain_only_the_requested_pages_and_do_not_overwrite() {
    let directory = std::env::temp_dir().join(format!("biolaris-split-test-{}", Uuid::new_v4()));
    fs::create_dir(&directory).expect("temporary test directory should be created");
    let input = directory.join("report.pdf");
    test_pdf(4)
      .save(&input)
      .expect("source PDF should be saved");
    let expected = parse_page_ranges("1-2, 4", 4).expect("ranges should parse");

    let outputs = split_pdf(&input, &expected).expect("PDF should be split");
    assert_eq!(outputs.len(), 2);
    assert_eq!(
      outputs[0].file_name(),
      Path::new("report-1.pdf").file_name()
    );
    assert_eq!(
      outputs[1].file_name(),
      Path::new("report-2.pdf").file_name()
    );
    assert_eq!(
      Document::load(&outputs[0])
        .expect("first output should load")
        .get_pages()
        .len(),
      2
    );
    assert_eq!(
      Document::load(&outputs[1])
        .expect("second output should load")
        .get_pages()
        .len(),
      1
    );

    fs::write(&outputs[0], b"keep existing output")
      .expect("existing output should be overwritten for the check");
    let repeated = split_pdf(&input, &expected).expect("repeat split should succeed");
    assert_eq!(
      fs::read(&outputs[0]).expect("first output should remain"),
      b"keep existing output"
    );
    assert_eq!(
      repeated[0].file_name(),
      Path::new("report-1_1.pdf").file_name()
    );
    fs::remove_dir_all(directory).expect("temporary test directory should be removed");
  }
}
