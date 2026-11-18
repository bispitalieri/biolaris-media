use crate::{
  constants::CONVERSION_PROGRESS_EVENT,
  formats::{get_file_ext, is_image_ext},
  images::run_crop_image_magick,
  models::{self, CropRequest, JobUpdate, QueueState},
  paths::{canonical_existing_file, validate_output},
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
    return Err(crate::t!("crop.zero_dimensions"));
  }
  if request.x.checked_add(request.width).is_none()
    || request.y.checked_add(request.height).is_none()
  {
    return Err(crate::t!("crop.invalid_coordinates"));
  }

  let input = canonical_existing_file(&request.input_path)?;
  let ext = get_file_ext(&input);
  if !is_image_ext(&ext) {
    return Err(crate::t!("crop.images_only"));
  }
  let output = validate_output(&request.output_path, &ext, request.auto_rename_outputs)?;
  let _queue_permit = state.queue_limit.clone().try_acquire_owned().map_err(|_| {
    crate::t!("conversion.queue_full", count = crate::constants::MAX_QUEUE_SIZE.to_string())
  })?;
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
    let update = match result {
      Ok(()) => JobUpdate {
        id: task_id,
        status: "completed".into(),
        progress: 100,
        output_path: Some(output.to_string_lossy().into_owned()),
        error: None,
      },
      Err(error) => JobUpdate {
        id: task_id,
        status: "failed".into(),
        progress: 0,
        output_path: None,
        error: Some(error),
      },
    };
    models::emit_job_update(&app, CONVERSION_PROGRESS_EVENT, update);
  });
  Ok(id)
}
