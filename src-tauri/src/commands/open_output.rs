use tauri_plugin_shell::ShellExt;

#[tauri::command]
#[allow(deprecated)]
pub(crate) fn open_output_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
  let file = std::path::PathBuf::from(path)
    .canonicalize()
    .map_err(|error| format!("File di output non accessibile: {error}"))?;

  if !file.is_file() {
    return Err("Il percorso di output non è un file valido".into());
  }

  app.shell()
    .open(file.to_string_lossy().into_owned(), None)
    .map_err(|error| format!("Impossibile aprire il file: {error}"))
}

#[tauri::command]
#[allow(deprecated)]
pub(crate) fn open_output_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
  let file = std::path::PathBuf::from(path)
    .canonicalize()
    .map_err(|error| format!("File di output non accessibile: {error}"))?;
  let directory = file
    .parent()
    .ok_or("Cartella di output non valida")?;

  if !file.is_file() || !directory.is_dir() {
    return Err("Il percorso di output non è un file valido".into());
  }

  app.shell()
    .open(directory.to_string_lossy().into_owned(), None)
    .map_err(|error| format!("Impossibile aprire la cartella: {error}"))
}
