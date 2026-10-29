use std::path::{Path, PathBuf};

pub(crate) fn canonical_existing_file(path: &str) -> Result<PathBuf, String> {
  let path = Path::new(path)
    .canonicalize()
    .map_err(|e| format!("Percorso input non valido: {e}"))?;
  if !path.is_file() {
    return Err("L'input deve essere un file regolare".into());
  }
  Ok(path)
}
pub(crate) fn validate_output(
  path: &str,
  expected_ext: &str,
  auto_rename_outputs: bool,
) -> Result<PathBuf, String> {
  let output = PathBuf::from(path);
  let parent = output
    .parent()
    .ok_or("Percorso output non valido")?
    .canonicalize()
    .map_err(|e| format!("Cartella output non valida: {e}"))?;
  let filename = output.file_name().ok_or("Nome file output non valido")?;
  if output
    .extension()
    .and_then(|v| v.to_str())
    .map(|v| v.eq_ignore_ascii_case(expected_ext))
    != Some(true)
  {
    return Err(format!("L'estensione deve essere .{expected_ext}"));
  }
  let result = parent.join(filename);
  match std::fs::symlink_metadata(&result) {
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(result),
    Err(error) => return Err(format!("Percorso output non accessibile: {error}")),
    Ok(_) if !auto_rename_outputs => return Err("Il file di destinazione esiste già".into()),
    Ok(_) => {}
  }
  let stem = output
    .file_stem()
    .and_then(|value| value.to_str())
    .ok_or("Nome file output non valido")?;
  let ext = output
    .extension()
    .and_then(|value| value.to_str())
    .ok_or("Estensione file output non valida")?;

  for suffix in 1u64.. {
    let candidate = parent.join(format!("{stem}_{suffix}.{ext}"));
    match std::fs::symlink_metadata(&candidate) {
      Ok(_) => continue,
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(candidate),
      Err(error) => return Err(format!("Percorso output non accessibile: {error}")),
    }
  }
  Err("Impossibile trovare un nome libero per il file di destinazione".into())
}
