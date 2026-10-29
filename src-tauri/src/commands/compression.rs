use crate::{
  constants::CONVERSION_PROGRESS_EVENT,
  formats::{get_file_ext, is_compressible, is_image_ext},
  images::run_convert_image_magick,
  models::{CompressionRequest, JobUpdate, QueueState},
  paths::{canonical_existing_file, validate_output},
  tools::{append_stderr_tail, ffmpeg_failure_message, tool_command},
};
use std::path::Path;
use tauri::{Emitter, State};
use tauri_plugin_shell::process::CommandEvent;
use uuid::Uuid;

#[tauri::command]
pub(crate) async fn enqueue_compression(
  app: tauri::AppHandle,
  state: State<'_, QueueState>,
  request: CompressionRequest,
) -> Result<String, String> {
  if request.quality < 30 || request.quality > 70 {
    return Err("La qualità deve essere compresa tra 30 e 70".into());
  }
  let input = canonical_existing_file(&request.input_path)?;
  let ext = get_file_ext(&input);
  if !is_compressible(&ext) {
    return Err("Compressione non supportata per questo formato".into());
  }
  let output = validate_output(&request.output_path, &ext, request.auto_rename_outputs)?;
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
    let result = run_ffmpeg_compress(&app, &task_id, &input, &output, request).await;
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

async fn run_ffmpeg_compress(
  app: &tauri::AppHandle,
  id: &str,
  input: &Path,
  output: &Path,
  request: CompressionRequest,
) -> Result<(), String> {
  let input_text = input.to_string_lossy().into_owned();
  let output_text = output.to_string_lossy().into_owned();
  let ext = get_file_ext(input);

  // Try ImageMagick for images
  if is_image_ext(&ext) {
    // Map compression quality 30-70 to 0-100 scale
    let q = ((request.quality as u32) * 100 / 70).max(10).min(95) as u8;
    return run_convert_image_magick(app, input, output, &ext, q, request.preserve_metadata)
      .await;
  }

  // Probe duration first for progress
  let probe = tool_command(app, "ffprobe")
    .args([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      &input_text,
    ])
    .output()
    .await;
  let duration_secs: f64 = if let Ok(probe_res) = probe {
    if probe_res.status.success() {
      String::from_utf8_lossy(&probe_res.stdout)
        .trim()
        .parse()
        .unwrap_or(1.0)
    } else {
      1.0
    }
  } else {
    1.0
  };

  let mut args: Vec<String> = vec![
    "-hide_banner".into(),
    "-nostats".into(),
    "-n".into(),
    "-i".into(),
    input_text,
    "-progress".into(),
    "pipe:1".into(),
  ];

  if ["mp4", "mov", "m4v", "avi", "mkv"].contains(&ext.as_str()) {
    let crf = 51 - ((request.quality as u32 - 30) * 33 / 40);
    args.extend([
      "-c:v".into(),
      "libx264".into(),
      "-crf".into(),
      crf.to_string(),
      "-c:a".into(),
      "aac".into(),
      "-b:a".into(),
      "128k".into(),
    ]);
  } else if ["webm"].contains(&ext.as_str()) {
    let crf = 63 - ((request.quality as u32 - 30) * 45 / 40);
    args.extend([
      "-c:v".into(),
      "libvpx-vp9".into(),
      "-crf".into(),
      crf.to_string(),
      "-b:v".into(),
      "0".into(),
      "-c:a".into(),
      "libopus".into(),
    ]);
  } else if ["mp3"].contains(&ext.as_str()) {
    let bitrate = if request.quality >= 60 {
      "192k"
    } else if request.quality >= 50 {
      "128k"
    } else {
      "96k"
    };
    args.extend([
      "-vn".into(),
      "-c:a".into(),
      "libmp3lame".into(),
      "-b:a".into(),
      bitrate.into(),
    ]);
  } else if ["ogg", "oga"].contains(&ext.as_str()) {
    let qv = ((request.quality as u32) as i32 - 30) / 5; // rough mapping
    args.extend([
      "-vn".into(),
      "-c:a".into(),
      "libvorbis".into(),
      "-q:a".into(),
      qv.to_string(),
    ]);
  } else if ["jpg", "jpeg"].contains(&ext.as_str()) {
    args.extend([
      "-c:v".into(),
      "mjpeg".into(),
      "-q:v".into(),
      ((100 - request.quality as u32) / 2)
        .max(2)
        .min(31)
        .to_string(),
    ]);
  } else if ["png"].contains(&ext.as_str()) {
    args.extend([
      "-c:v".into(),
      "png".into(),
      "-compression_level".into(),
      ((70 - request.quality as u32) / 10)
        .max(0)
        .min(9)
        .to_string(),
    ]);
  } else if ["webp"].contains(&ext.as_str()) {
    args.extend([
      "-c:v".into(),
      "libwebp".into(),
      "-quality".into(),
      request.quality.to_string(),
    ]);
  } else {
    args.extend([
      "-c:v".into(),
      "libx264".into(),
      "-crf".into(),
      "28".into(),
      "-c:a".into(),
      "aac".into(),
    ]);
  }

  if !request.preserve_metadata {
    args.extend(["-map_metadata".into(), "-1".into()]);
  }
  args.push(output_text);
  let (mut rx, _child) = tool_command(app, "ffmpeg")
    .args(args)
    .spawn()
    .map_err(|e| format!("Avvio ffmpeg non riuscito: {e}"))?;
  let mut exit_code = None;
  let mut stderr_tail = Vec::new();
  while let Some(event) = rx.recv().await {
    match event {
      CommandEvent::Stdout(bytes) => {
        let line = String::from_utf8_lossy(&bytes);
        if let Some(value) = line
          .trim()
          .strip_prefix("out_time_ms=")
          .and_then(|n| n.parse::<f64>().ok())
        {
          if duration_secs > 0.0 {
            let pct =
              ((value / 1_000_000.0 / duration_secs) * 100.0).clamp(0.0, 99.0) as u8;
            let _ = app.emit(
              CONVERSION_PROGRESS_EVENT,
              JobUpdate {
                id: id.into(),
                status: "running".into(),
                progress: pct,
                output_path: None,
                error: None,
              },
            );
          }
        }
      }
      CommandEvent::Stderr(bytes) => append_stderr_tail(&mut stderr_tail, &bytes),
      CommandEvent::Terminated(payload) => exit_code = payload.code,
      CommandEvent::Error(error) => {
        return Err(format!("Errore del processo ffmpeg: {error}"))
      }
      _ => {}
    }
  }
  if exit_code == Some(0) {
    Ok(())
  } else {
    Err(ffmpeg_failure_message(exit_code, &stderr_tail))
  }
}
