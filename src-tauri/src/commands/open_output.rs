use tauri_plugin_shell::ShellExt;

#[tauri::command]
#[allow(deprecated)]
pub(crate) fn open_output_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
  let file = std::path::PathBuf::from(path)
    .canonicalize()
    .map_err(|error| crate::t!("open_output.output_not_accessible", error = error.to_string()))?;

  if !file.is_file() {
    return Err(crate::t!("open_output.not_valid_file"));
  }

  app.shell()
    .open(file.to_string_lossy().into_owned(), None)
    .map_err(|error| crate::t!("open_output.cannot_open_file", error = error.to_string()))
}

#[tauri::command]
#[allow(deprecated)]
pub(crate) fn open_output_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
  let file = std::path::PathBuf::from(path)
    .canonicalize()
    .map_err(|error| crate::t!("open_output.output_not_accessible", error = error.to_string()))?;
  let directory = if file.is_dir() { file.as_path() } else { file.parent().ok_or(crate::t!("open_output.invalid_output_dir"))? };

  if !directory.is_dir() { return Err(crate::t!("open_output.not_valid_path")); }

  app.shell()
    .open(directory.to_string_lossy().into_owned(), None)
    .map_err(|error| crate::t!("open_output.cannot_open_folder", error = error.to_string()))
}

#[tauri::command]
#[allow(deprecated)]
pub(crate) fn show_in_finder(app: tauri::AppHandle, path: String) -> Result<(), String> {
  let file = std::path::PathBuf::from(&path);
  if file.exists() {
    let parent = file.parent().unwrap_or(file.as_path());
    return open_output_directory(app, parent.to_string_lossy().into_owned());
  }
  open_output_directory(app, path)
}
