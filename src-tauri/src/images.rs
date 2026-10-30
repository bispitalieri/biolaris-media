use crate::{
  models::CropRequest,
  tools::{append_stderr_tail, tool_command},
};
use std::{fs::OpenOptions, io::Write, path::Path};
use tauri_plugin_shell::process::CommandEvent;

pub(crate) fn save_background_png(output: &Path, bytes: &[u8]) -> Result<(), String> {
  let png_signature = b"\x89PNG\r\n\x1a\n";
  if bytes.get(..8) != Some(png_signature) || bytes.get(12..16) != Some(b"IHDR") || bytes.len() < 24 {
    return Err("Il risultato non è un PNG valido".into());
  }
  let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
  let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
  let pixels = u64::from(width) * u64::from(height);
  if width == 0 || height == 0 || pixels > 100_000_000 {
    return Err("Le dimensioni del PNG non sono valide o superano il limite supportato".into());
  }

  if output.file_name().is_none() {
    return Err("Nome file output non valido".into());
  }
  let temporary = output.with_file_name(format!(".biolaris-{}.tmp", uuid::Uuid::new_v4()));
  let result = (|| {
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)
      .map_err(|error| format!("Impossibile creare il PNG temporaneo: {error}"))?;
    file.write_all(bytes).map_err(|error| format!("Impossibile scrivere il PNG: {error}"))?;
    file.sync_all().map_err(|error| format!("Impossibile completare il PNG: {error}"))?;
    std::fs::rename(&temporary, output).map_err(|error| format!("Impossibile salvare il PNG: {error}"))
  })();
  if result.is_err() { let _ = std::fs::remove_file(&temporary); }
  result
}

pub(crate) async fn run_crop_image_magick(
  app: &tauri::AppHandle,
  input: &Path,
  output: &Path,
  request: &CropRequest,
) -> Result<(), String> {
  let args = vec![
    input.to_string_lossy().into_owned(),
    "-auto-orient".into(),
    "-crop".into(),
    format!(
      "{}x{}+{}+{}",
      request.width, request.height, request.x, request.y
    ),
    "+repage".into(),
    output.to_string_lossy().into_owned(),
  ];
  if try_run_magick(app, args).await? {
    Ok(())
  } else {
    Err("Nessun convertitore immagine disponibile (magick/convert)".into())
  }
}

async fn try_run_magick(app: &tauri::AppHandle, args: Vec<String>) -> Result<bool, String> {
  // Try ImageMagick 7 first, then its legacy `convert` command alias.
  let mut diagnostics = Vec::new();
  for (name, command_args) in [("magick", args.clone()), ("convert", args)] {
    match tool_command(app, name).args(command_args).spawn() {
      Ok((mut rx, _child)) => {
        let mut exit_code = None;
        let mut stderr_tail = Vec::new();
        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stderr(bytes) => append_stderr_tail(&mut stderr_tail, &bytes),
            CommandEvent::Terminated(payload) => exit_code = payload.code,
            CommandEvent::Error(error) => diagnostics.push(format!("{name}: {error}")),
            _ => {}
          }
        }
        if exit_code == Some(0) {
          return Ok(true);
        }

        let details = String::from_utf8_lossy(&stderr_tail).trim().to_owned();
        if !details.is_empty() {
          diagnostics.push(format!("{name}: {details}"));
        } else if let Some(code) = exit_code {
          diagnostics.push(format!("{name} è terminato con codice {code}"));
        }
      }
      Err(error) => diagnostics.push(format!("{name}: {error}")),
    }
  }

  if diagnostics.is_empty() {
    Ok(false)
  } else {
    Err(format!(
      "Conversione ImageMagick non riuscita: {}",
      diagnostics.join("; ")
    ))
  }
}

pub(crate) async fn run_convert_image_magick(
  app: &tauri::AppHandle,
  input: &Path,
  output: &Path,
  out_ext: &str,
  quality: u8,
  preserve_metadata: bool,
) -> Result<(), String> {
  let input_text = input.to_string_lossy().into_owned();
  let output_text = output.to_string_lossy().into_owned();
  let q = quality.clamp(1, 100);

  // Try ImageMagick first for all image-like formats (especially RAW, HEIC, etc.)
  let mut args: Vec<String> = vec![input_text.clone()];
  if !preserve_metadata {
    args.push("-strip".into());
  }
  // Quality setting varies by format
  match out_ext {
    "jpg" | "jpeg" => args.extend(["-quality".into(), q.to_string()]),
    "webp" => args.extend(["-quality".into(), q.to_string()]),
    "avif" => args.extend(["-quality".into(), q.to_string()]),
    "png" => {
      // For PNG, use compression level
      let comp = ((100 - q) * 9 / 100).min(9);
      args.extend(["-quality".into(), format!("{}00", comp)]);
    }
    "tif" | "tiff" => args.extend(["-compress".into(), "lzw".into()]),
    "ico" => {}
    _ => args.extend(["-quality".into(), q.to_string()]),
  }
  args.push(output_text.clone());

  if try_run_magick(app, args).await? {
    return Ok(());
  }
  Err("Nessun convertitore immagine disponibile (magick/convert)".into())
}
