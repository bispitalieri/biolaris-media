use crate::{
  constants::CONVERSION_PROGRESS_EVENT,
  formats::{get_file_ext, is_image_ext},
  images::run_crop_image_magick,
  models::{CropRequest, JobUpdate, QueueState},
  paths::{canonical_existing_file, validate_output_with_suffix},
};
use tauri::{Emitter, State};
use uuid::Uuid;

#[tauri::command]
pub(crate) async fn enqueue_crop(
  app: tauri::AppHandle,
  state: State<'_, QueueState>,
  request: CropRequest,
) -> Result<String, String> {
  if request.width == 0 || request.height == 0 {
    return Err("L'area di ritaglio deve avere dimensioni maggiori di zero".into());
  }
  if request.x.checked_add(request.width).is_none()
    || request.y.checked_add(request.height).is_none()
  {
    return Err("Le coordinate di ritaglio non sono valide".into());
  }

  let input = canonical_existing_file(&request.input_path)?;
  let ext = get_file_ext(&input);
  if !is_image_ext(&ext) {
    return Err("Il ritaglio è disponibile solo per le immagini".into());
  }
  let output = validate_output_with_suffix(&request.output_path, &ext)?;
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
        progress: 0,
        output_path: None,
        error: None,
      },
    );
    let result = run_crop_image_magick(&app, &input, &output, &request).await;
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
