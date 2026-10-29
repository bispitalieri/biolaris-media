use crate::{
  constants::CONVERSION_PROGRESS_EVENT,
  formats::{
    ffmpeg_audio_quality_args, ffmpeg_codec_args_for_format, get_file_ext, is_audio_ext,
    is_ffmpeg_image_ext, is_image_ext, is_video_ext, is_video_out, valid_conversion_pair,
    video_crf,
  },
  images::run_convert_image_magick,
  models::{ConversionRequest, JobUpdate, QueueState},
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
    return Err("La qualità deve essere valida".into());
  }
  let input = canonical_existing_file(&request.input_path)?;
  let format = request.format.to_lowercase();
  if !valid_conversion_pair(&get_file_ext(&input), &format) {
    return Err("Conversione non supportata per questo formato di input e output".into());
  }
  let output = validate_output(&request.output_path, &format, request.auto_rename_outputs)?;
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
      input_text.clone(),
      "-progress".into(),
      "pipe:1".into(),
    ];
    args.extend(ffmpeg_codec_args_for_format(&out_ext));
    args.extend(ffmpeg_audio_quality_args(&out_ext, request.quality));
    if is_ffmpeg_image_ext(&in_ext) && is_ffmpeg_image_ext(&out_ext) {
      let quality_input = request.quality as u32;

      // 2. Limitiamo la qualità in ingresso tra 1 e 100
      let clean_quality = quality_input.clamp(1, 100);

      // 3. Calcoliamo la scala FFmpeg (da 1 a 31)
      let ffmpeg_q = ((100 - clean_quality) * 31) / 100;

      // 4. FFmpeg -q:v per le immagini non dovrebbe essere 0, forziamo un minimo di 1
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
          return Err(format!("Errore del processo ffmpeg: {error}"))
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

  Err("Formato non supportato o nessun convertitore disponibile".into())
}
