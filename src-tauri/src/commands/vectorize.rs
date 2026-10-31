use crate::{
  constants::CONVERSION_PROGRESS_EVENT,
  formats::{get_file_ext, is_vectorize_input_ext},
  models::{JobUpdate, QueueState, VectorizeRequest},
  paths::{canonical_existing_file, validate_output},
};
use tauri::{Emitter, State};
use uuid::Uuid;

pub(crate) fn config_for_style(style: &str) -> vtracer::Config {
  match style.to_lowercase().as_str() {
    "photo" => vtracer::Config::from_preset(vtracer::Preset::Photo),
    "bw" | "b&w" | "black_and_white" => vtracer::Config::from_preset(vtracer::Preset::Bw),
    _ => {
      // "logo": Logos, icons, and flat color art. Traces smooth, filled color shapes.
      let mut config = vtracer::Config::from_preset(vtracer::Preset::Poster);
      config.hierarchical = vtracer::Hierarchical::Cutout;
      config.filter_speckle = 4;
      config.color_precision = 8;
      config
    }
  }
}

#[tauri::command]
pub(crate) async fn enqueue_vectorize(
  app: tauri::AppHandle,
  state: State<'_, QueueState>,
  request: VectorizeRequest,
) -> Result<String, String> {
  let input = canonical_existing_file(&request.input_path)?;
  let ext = get_file_ext(&input);
  if !is_vectorize_input_ext(&ext) {
    return Err("Formato non supportato per la vettorizzazione. Usa PNG, JPG, GIF, BMP, TIFF o WebP.".into());
  }

  let output = validate_output(&request.output_path, "svg", request.auto_rename_outputs)?;
  let id = Uuid::new_v4().to_string();
  let semaphore = state.slots.clone();
  let task_id = id.clone();

  tauri::async_runtime::spawn(async move {
    let _permit = match semaphore.acquire_owned().await {
      Ok(p) => p,
      Err(_) => return,
    };

    let _ = app.emit(
      CONVERSION_PROGRESS_EVENT,
      JobUpdate {
        id: task_id.clone(),
        status: "running".into(),
        progress: 10,
        output_path: None,
        error: None,
      },
    );

    let input_path = input.clone();
    let output_path = output.clone();
    let style = request.style.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
      let reader = image::ImageReader::open(&input_path)
        .map_err(|e| format!("Impossibile aprire il file immagine: {e}"))?;
      let dyn_img = reader
        .with_guessed_format()
        .map_err(|e| format!("Formato immagine non supportato: {e}"))?
        .decode()
        .map_err(|e| format!("Impossibile decodificare l'immagine: {e}"))?;

      let rgba = dyn_img.to_rgba8();
      let (width, height) = (rgba.width() as usize, rgba.height() as usize);
      let color_img = vtracer::ColorImage {
        pixels: rgba.into_raw(),
        width,
        height,
      };

      let config = config_for_style(&style);
      let svg = vtracer::convert(color_img, config)
        .map_err(|e| format!("Errore durante la vettorizzazione: {e}"))?;

      std::fs::write(&output_path, svg.to_string())
        .map_err(|e| format!("Impossibile scrivere il file SVG: {e}"))?;

      Ok(())
    })
    .await
    .map_err(|e| format!("Task di vettorizzazione fallito: {e}"))
    .and_then(|res| res);

    match result {
      Ok(()) => {
        let _ = app.emit(
          CONVERSION_PROGRESS_EVENT,
          JobUpdate {
            id: task_id,
            status: "completed".into(),
            progress: 100,
            output_path: Some(output.to_string_lossy().into_owned()),
            error: None,
          },
        );
      }
      Err(error) => {
        let _ = app.emit(
          CONVERSION_PROGRESS_EVENT,
          JobUpdate {
            id: task_id,
            status: "failed".into(),
            progress: 0,
            output_path: None,
            error: Some(error),
          },
        );
      }
    }
  });

  Ok(id)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_config_for_styles() {
    let logo_cfg = config_for_style("logo");
    assert!(matches!(logo_cfg.hierarchical, vtracer::Hierarchical::Cutout));

    let photo_cfg = config_for_style("photo");
    assert!(matches!(photo_cfg.hierarchical, vtracer::Hierarchical::Stacked));

    let bw_cfg = config_for_style("bw");
    assert!(matches!(bw_cfg.color_mode, vtracer::ColorMode::Binary));
  }

  #[test]
  fn test_vectorize_sample_image() {
    let icon_path = std::path::Path::new("icons/icon.png");
    if !icon_path.exists() {
      return;
    }
    let reader = image::ImageReader::open(icon_path)
      .expect("failed to open icon")
      .with_guessed_format()
      .expect("failed to guess format")
      .decode()
      .expect("failed to decode icon");

    let rgba = reader.to_rgba8();
    let (width, height) = (rgba.width() as usize, rgba.height() as usize);
    let color_img = vtracer::ColorImage {
      pixels: rgba.into_raw(),
      width,
      height,
    };

    let config = config_for_style("logo");
    let svg = vtracer::convert(color_img, config).expect("vectorization failed");
    let svg_str = svg.to_string();

    assert!(svg_str.contains("<svg"));
    assert!(svg_str.contains("path"));
    assert!(svg_str.contains("</svg>"));
  }
}
