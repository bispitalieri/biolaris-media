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

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use tempfile::TempDir;

  #[test]
  fn canonical_existing_file_rejects_directory() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().to_str().unwrap();
    let result = canonical_existing_file(path);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("regular file") || err.contains("must be"));
  }

  #[test]
  fn canonical_existing_file_accepts_file() {
    let dir = TempDir::new().unwrap();
    let file_path = dir.path().join("test.txt");
    fs::write(&file_path, "hello").unwrap();
    let result = canonical_existing_file(file_path.to_str().unwrap());
    assert!(result.is_ok());
  }

  #[test]
  fn canonical_existing_file_rejects_nonexistent() {
    let result = canonical_existing_file("/nonexistent/path/file.txt");
    assert!(result.is_err());
  }

  #[test]
  fn validate_output_rejects_wrong_extension() {
    let result = validate_output("output.txt", "png", false);
    assert!(result.is_err());
  }

  #[test]
  fn validate_output_accepts_new_file() {
    let dir = TempDir::new().unwrap();
    let output = dir.path().join("new.png");
    let result = validate_output(output.to_str().unwrap(), "png", false);
    assert!(result.is_ok());
    assert_eq!(result.unwrap().file_name().unwrap(), "new.png");
  }

  #[test]
  fn validate_output_auto_rename_when_exists() {
    let dir = TempDir::new().unwrap();
    let output = dir.path().join("existing.png");
    fs::write(&output, "data").unwrap();
    let result = validate_output(output.to_str().unwrap(), "png", true);
    assert!(result.is_ok());
    let renamed = result.unwrap();
    assert!(renamed.file_name().unwrap().to_str().unwrap().starts_with("existing_"));
    assert!(renamed.file_name().unwrap().to_str().unwrap().ends_with(".png"));
  }

  #[test]
  fn validate_output_rejects_existing_when_no_auto_rename() {
    let dir = TempDir::new().unwrap();
    let output = dir.path().join("existing.png");
    fs::write(&output, "data").unwrap();
    let result = validate_output(output.to_str().unwrap(), "png", false);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("exists") || err.contains("already"));
  }

  #[test]
  fn validate_output_rejects_invalid_parent() {
    let result = validate_output("/nonexistent/dir/output.png", "png", false);
    assert!(result.is_err());
  }

  #[test]
  fn validate_output_accepts_case_insensitive_extension() {
    let dir = TempDir::new().unwrap();
    let output = dir.path().join("test.PNG");
    let result = validate_output(output.to_str().unwrap(), "png", false);
    assert!(result.is_ok());
  }
}
