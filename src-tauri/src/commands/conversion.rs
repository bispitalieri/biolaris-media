use crate::{
  constants::CONVERSION_PROGRESS_EVENT,
  formats::{
    ffmpeg_audio_quality_args, ffmpeg_codec_args_for_format, get_file_ext, is_audio_ext,
    is_ffmpeg_image_ext, is_image_ext, is_video_ext, is_video_out, valid_conversion_pair,
    video_crf,
  },
  images::run_convert_image_magick,
  models::{self, ConversionRequest, JobUpdate, QueueState},
  paths::{canonical_existing_file, validate_output},
  tools::{append_stderr_tail, ffmpeg_failure_message, tool_command},
};
use std::path::Path;
use tauri::{Emitter, State};
use tauri_plugin_shell::process::CommandEvent;
use uuid::Uuid;

#[tauri::command]
pub(crate) async fn enqueue_conversion(
  app: tauri::AppHandle,
  state: State<'_, QueueState>,
  request: ConversionRequest,
) -> Result<String, String> {
  if request.quality > 100 {
    return Err(crate::t!("conversion.quality_invalid"));
  }
  let input = canonical_existing_file(&request.input_path)?;
  let format = request.format.to_lowercase();
  if !valid_conversion_pair(&get_file_ext(&input), &format) {
    return Err(crate::t!("conversion.unsupported_pair"));
  }
  let output = validate_output(&request.output_path, &format, request.auto_rename_outputs)?;
  // Acquire a queue slot immediately to enforce backpressure.
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
    let result = run_convert(&app, &task_id, &input, &output, request).await;
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

async fn run_convert(
  app: &tauri::AppHandle,
  id: &str,
  input: &Path,
  output: &Path,
  request: ConversionRequest,
) -> Result<(), String> {
  let in_ext = get_file_ext(input);
  let out_ext = request.format.to_lowercase();
  let input_text = input.to_string_lossy().into_owned();
  let output_text = output.to_string_lossy().into_owned();
  let still_image_to_gif =
    out_ext == "gif" && is_image_ext(&in_ext) && in_ext != "gif" && !is_video_ext(&in_ext);

  // Use ImageMagick when either side is outside FFmpeg's common image formats.
  // Still images do not need the video-only fps filter used for animated GIFs.
  if still_image_to_gif
    || ((is_image_ext(&in_ext) || in_ext == "pdf")
    && (!is_ffmpeg_image_ext(&in_ext) || !is_ffmpeg_image_ext(&out_ext)))
  {
    run_convert_image_magick(
      app,
      input,
      output,
      &out_ext,
      request.quality,
      request.preserve_metadata,
    )
      .await?;
    let _ = app.emit(
      CONVERSION_PROGRESS_EVENT,
      JobUpdate {
        id: id.into(),
        status: "running".into(),
        progress: 99,
        output_path: None,
        error: None,
      },
    );
    return Ok(());
  }

  // FFmpeg handles audio/video and common raster image conversions.
  if is_audio_ext(&in_ext)
    || is_video_ext(&in_ext)
    || (is_ffmpeg_image_ext(&in_ext) && is_ffmpeg_image_ext(&out_ext))
    || matches!(
            out_ext.as_str(),
            "mp4"
                | "webm"
                | "mkv"
                | "avi"
                | "mov"
                | "gif"
                | "mp3"
                | "wav"
                | "flac"
                | "ogg"
                | "m4a"
                | "aac"
                | "opus"
        )
  {
    // Probe duration for progress
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
        let raw = String::from_utf8_lossy(&probe_res.stdout).trim().to_string();
        raw.parse::<f64>().unwrap_or_else(|_| {
          tracing::warn!("ffprobe returned invalid duration: '{}', falling back to 1.0", raw);
          1.0
        })
      } else {
        tracing::warn!("ffprobe failed to probe duration for '{}', falling back to 1.0", input_text);
        1.0
      }
    } else {
      tracing::warn!("ffprobe process failed for '{}', falling back to 1.0", input_text);
      1.0
    };

    let mut args: Vec<String> = vec![
      "-hide_banner".into(),
      "-nostats".into(),
      "-n".into(),
      "-i".into(),
      input_text.clone(),
      "-progress".into(),
      "pipe:1".into(),
    ];
    args.extend(ffmpeg_codec_args_for_format(&out_ext));
    args.extend(ffmpeg_audio_quality_args(&out_ext, request.quality));
    if is_ffmpeg_image_ext(&in_ext) && is_ffmpeg_image_ext(&out_ext) {
      let quality_input = request.quality as u32;

      // 2. Clamp input quality between 1 and 100
      let clean_quality = quality_input.clamp(1, 100);

      // 3. Calculate FFmpeg scale (1 to 31)
      let ffmpeg_q = ((100 - clean_quality) * 31) / 100;

      // 4. FFmpeg -q:v for images should not be 0, enforce a minimum of 1
      let final_q = ffmpeg_q.max(1);

      args.extend(["-q:v".into(), final_q.to_string()]);
      // args.extend(["-q:v".into(), ((100 - request.quality.min(100)) * 31 / 100).to_string()]);
    }
    if is_video_out(&out_ext) {
      args.extend(["-crf".into(), video_crf(request.quality).to_string()]);
    }
    if !request.preserve_metadata {
      args.extend(["-map_metadata".into(), "-1".into()]);
    }
    args.push(output_text);
    let (mut rx, _child) = tool_command(app, "ffmpeg")
      .args(args)
      .spawn()
      .map_err(|e| crate::t!("conversion.ffmpeg_start_failed", error = e.to_string()))?;
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
              let pct = ((value / 1_000_000.0 / duration_secs) * 100.0)
                .clamp(0.0, 99.0) as u8;
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
          return Err(crate::t!("conversion.ffmpeg_process_error", error = error.to_string()))
        }
        _ => {}
      }
    }
    if exit_code == Some(0) {
      return Ok(());
    } else {
      return Err(ffmpeg_failure_message(exit_code, &stderr_tail));
    }
  }

  Err(crate::t!("conversion.no_converter"))
}
