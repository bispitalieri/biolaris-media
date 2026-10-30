use crate::{
  images::save_background_png,
  models::SaveBackgroundPngRequest,
  paths::validate_output,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};

const MAX_ENCODED_PNG_BYTES: usize = 700 * 1024 * 1024;

#[tauri::command]
pub(crate) async fn save_background_removed_png(
  request: SaveBackgroundPngRequest,
) -> Result<String, String> {
  let output = validate_output(&request.output_path, "png", request.auto_rename_outputs)?;
  let encoded = request.png_base64.strip_prefix("data:image/png;base64,")
    .unwrap_or(&request.png_base64);
  if encoded.len() > MAX_ENCODED_PNG_BYTES {
    return Err("Il PNG generato supera la dimensione massima supportata".into());
  }
  let bytes = STANDARD.decode(encoded)
    .map_err(|error| format!("Dati PNG non validi: {error}"))?;

  tauri::async_runtime::spawn_blocking(move || {
    save_background_png(&output, &bytes)?;
    Ok::<_, String>(output.to_string_lossy().into_owned())
  })
  .await
  .map_err(|error| format!("Salvataggio PNG non riuscito: {error}"))?
}
