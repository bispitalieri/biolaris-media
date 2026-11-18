use std::path::{Path, PathBuf};

pub(crate) fn canonical_existing_file(path: &str) -> Result<PathBuf, String> {
  let path = Path::new(path)
    .canonicalize()
    .map_err(|e| crate::t!("paths.invalid_input", error = e.to_string()))?;
  if !path.is_file() {
    return Err(crate::t!("paths.must_be_file"));
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
    .ok_or(crate::t!("paths.invalid_output"))?
    .canonicalize()
    .map_err(|e| crate::t!("paths.invalid_output_dir", error = e.to_string()))?;
  let filename = output.file_name().ok_or(crate::t!("paths.invalid_output_filename"))?;
  if output
    .extension()
    .and_then(|v| v.to_str())
    .map(|v| v.eq_ignore_ascii_case(expected_ext))
    != Some(true)
  {
    return Err(crate::t!("paths.invalid_extension", ext = expected_ext.to_string()));
  }
  let result = parent.join(filename);
  match std::fs::symlink_metadata(&result) {
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(result),
    Err(error) => return Err(crate::t!("paths.output_not_accessible", error = error.to_string())),
    Ok(_) if !auto_rename_outputs => return Err(crate::t!("paths.file_exists")),
    Ok(_) => {}
  }
  let stem = output
    .file_stem()
    .and_then(|value| value.to_str())
    .ok_or(crate::t!("paths.invalid_output_filename"))?;
  let ext = output
    .extension()
    .and_then(|value| value.to_str())
    .ok_or(crate::t!("paths.invalid_output_ext"))?;

  for suffix in 1u64.. {
    let candidate = parent.join(format!("{stem}_{suffix}.{ext}"));
    match std::fs::symlink_metadata(&candidate) {
      Ok(_) => continue,
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(candidate),
      Err(error) => return Err(crate::t!("paths.output_not_accessible", error = error.to_string())),
    }
  }
  Err(crate::t!("paths.cannot_find_free_name"))
}
