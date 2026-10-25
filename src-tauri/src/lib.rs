use serde::{Deserialize, Serialize};
use std::{
  path::{Path, PathBuf},
  sync::Arc,
};
use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tokio::sync::Semaphore;
use uuid::Uuid;

/// Number of simultaneous encoders is capped to avoid saturating the machine.
pub struct QueueState {
  slots: Arc<Semaphore>,
}
impl Default for QueueState {
  fn default() -> Self {
    Self {
      slots: Arc::new(Semaphore::new(num_cpus::get().max(1))),
    }
  }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionRequest {
  pub input_path: String,
  pub output_path: String,
  pub format: String,
  pub quality: u8,
  pub preserve_metadata: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionRequest {
  pub input_path: String,
  pub output_path: String,
  pub quality: u8,
  pub preserve_metadata: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobUpdate {
  pub id: String,
  pub status: String,
  pub progress: u8,
  pub output_path: Option<String>,
  pub error: Option<String>,
}

fn canonical_existing_file(path: &str) -> Result<PathBuf, String> {
  let path = Path::new(path)
    .canonicalize()
    .map_err(|e| format!("Percorso input non valido: {e}"))?;
  if !path.is_file() {
    return Err("L'input deve essere un file regolare".into());
  }
  Ok(path)
}
fn validate_output(path: &str, expected_ext: &str) -> Result<PathBuf, String> {
  let output = PathBuf::from(path);
  let parent = output
    .parent()
    .ok_or("Percorso output non valido")?
    .canonicalize()
    .map_err(|e| format!("Cartella output non valida: {e}"))?;
  let filename = output.file_name().ok_or("Nome file output non valido")?;
  if output
    .extension()
    .and_then(|v| v.to_str())
    .map(|v| v.eq_ignore_ascii_case(expected_ext))
    != Some(true)
  {
    return Err(format!("L'estensione deve essere .{expected_ext}"));
  }
  let result = parent.join(filename);
  if std::fs::symlink_metadata(&result).is_ok() {
    return Err("Il file di destinazione esiste già".into());
  }
  Ok(result)
}

fn get_file_ext(path: &Path) -> String {
  path.extension()
    .and_then(|v| v.to_str())
    .unwrap_or("")
    .to_lowercase()
}

fn is_image_ext(ext: &str) -> bool {
  matches!(
        ext,
        "jpg"
            | "jpeg"
            | "png"
            | "webp"
            | "webp2"
            | "heic"
            | "heif"
            | "avif"
            | "jxl"
            | "bpg"
            | "gif"
            | "bmp"
            | "tiff"
            | "tif"
            | "svg"
            | "ico"
            | "icns"
            | "jfif"
            | "pjpeg"
            | "pjpg"
            | "psd"
            | "ai"
            | "xcf"
            | "tga"
            | "dds"
            | "hdr"
            | "exr"
            | "wmf"
            | "emf"
            | "eps"
            | "pcx"
            | "dcx"
            | "pbm"
            | "pgm"
            | "ppm"
            | "pnm"
            | "cr2"
            | "cr3"
            | "nef"
            | "arw"
            | "sr2"
            | "dng"
            | "rw2"
            | "orf"
            | "pef"
            | "raf"
            | "mrw"
            | "x3f"
            | "erf"
            | "3fr"
            | "fff"
    )
}

fn is_video_ext(ext: &str) -> bool {
  matches!(
        ext,
        "mp4"
            | "mkv"
            | "avi"
            | "mov"
            | "webm"
            | "wmv"
            | "flv"
            | "f4v"
            | "vob"
            | "ogv"
            | "ogm"
            | "qt"
            | "m4v"
            | "mpg"
            | "mpeg"
            | "m2v"
            | "3gp"
            | "3g2"
            | "ts"
            | "mts"
            | "m2ts"
            | "m2t"
            | "asf"
            | "rm"
            | "rmvb"
            | "divx"
            | "xvid"
            | "dv"
            | "amv"
            | "mjpeg"
            | "mjpg"
            | "roq"
            | "yuv"
            | "nut"
    )
}

fn is_audio_ext(ext: &str) -> bool {
  matches!(
        ext,
        "mp3"
            | "wav"
            | "ogg"
            | "oga"
            | "mka"
            | "flac"
            | "m4a"
            | "m4r"
            | "aac"
            | "adts"
            | "wma"
            | "alac"
            | "aiff"
            | "aif"
            | "ape"
            | "pcm"
            | "opus"
            | "spx"
            | "amr"
            | "gsm"
            | "mid"
            | "midi"
            | "m4b"
            | "m4p"
            | "mpc"
            | "wv"
            | "dsf"
            | "dff"
            | "caf"
            | "tak"
            | "tta"
            | "ra"
            | "ram"
            | "au"
            | "snd"
            | "voc"
    )
}

/// Formats commonly supported by FFmpeg's image2 pipeline and its bundled codecs.
/// Less common image formats are delegated to ImageMagick, whose delegates vary
/// by installation (for example HEIC and JPEG XL support).
fn is_ffmpeg_image_ext(ext: &str) -> bool {
  matches!(
        ext,
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif" | "tif" | "tiff"
    )
}

fn ffmpeg_codec_args_for_format(fmt: &str) -> Vec<String> {
  match fmt {
    "mp4" => vec!["-c:v".into(), "libx264".into(), "-c:a".into(), "aac".into()],
    "webm" => vec![
      "-c:v".into(),
      "libvpx-vp9".into(),
      "-c:a".into(),
      "libopus".into(),
    ],
    "mkv" => vec!["-c:v".into(), "libx264".into(), "-c:a".into(), "aac".into()],
    "avi" => vec!["-c:v".into(), "libx264".into(), "-c:a".into(), "mp3".into()],
    "mov" => vec!["-c:v".into(), "libx264".into(), "-c:a".into(), "aac".into()],
    "gif" => vec!["-vf".into(), "fps=10,scale=320:-1:flags=lanczos".into()],
    "mp3" => vec!["-vn".into(), "-c:a".into(), "libmp3lame".into()],
    "wav" => vec!["-vn".into(), "-c:a".into(), "pcm_s16le".into()],
    "flac" => vec!["-vn".into(), "-c:a".into(), "flac".into()],
    "ogg" => vec!["-vn".into(), "-c:a".into(), "libvorbis".into()],
    "m4a" => vec!["-vn".into(), "-c:a".into(), "aac".into()],
    "aac" => vec!["-vn".into(), "-c:a".into(), "aac".into()],
    "opus" => vec!["-vn".into(), "-c:a".into(), "libopus".into()],
    _ => vec![],
  }
}

fn ffmpeg_audio_quality_args(fmt: &str, quality: u8) -> Vec<String> {
  let quality = quality.clamp(1, 100) as u32;
  match fmt {
    // LAME VBR uses 0 for its highest quality and 9 for its lowest.
    "mp3" => vec!["-q:a".into(), (((100 - quality) * 9) / 100).to_string()],
    // Vorbis quality is expressed from 0 to 10.
    "ogg" => vec!["-q:a".into(), format!("{:.1}", quality as f32 / 10.0)],
    // AAC and Opus use bitrate-based quality settings.
    "m4a" | "aac" => vec!["-b:a".into(), format!("{}k", 64 + (quality * 256 / 100))],
    "opus" => vec!["-b:a".into(), format!("{}k", 32 + (quality * 224 / 100))],
    // FLAC remains lossless; higher settings spend more time compressing.
    "flac" => vec![
      "-compression_level".into(),
      (quality * 12 / 100).to_string(),
    ],
    // WAV is lossless. At the top of the range, export at 24-bit depth.
    "wav" if quality >= 90 => vec!["-c:a".into(), "pcm_s24le".into()],
    _ => Vec::new(),
  }
}

fn is_video_out(fmt: &str) -> bool {
  matches!(fmt, "mp4" | "webm" | "mkv" | "avi" | "mov")
}

fn video_crf(quality: u8) -> u8 {
  // The UI uses 0..100 where a larger value means better quality.
  (51.0 - (quality.min(100) as f32 * 0.33))
    .round()
    .clamp(18.0, 51.0) as u8
}

fn valid_conversion_pair(input: &str, output: &str) -> bool {
  let image_output = matches!(
        output,
        "jpg"
            | "jpeg"
            | "png"
            | "webp"
            | "avif"
            | "heic"
            | "heif"
            | "jxl"
            | "bmp"
            | "tif"
            | "tiff"
            | "ico"
            | "gif"
            | "tga"
            | "dds"
            | "hdr"
            | "exr"
            | "pcx"
            | "pbm"
            | "pgm"
            | "ppm"
            | "pnm"
    );
  let audio_output = matches!(
        output,
        "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aac" | "opus"
    );
  let video_output = matches!(output, "mp4" | "webm" | "mkv" | "avi" | "mov" | "gif");
  (image_output && (is_image_ext(input) || input == "pdf"))
    || (audio_output && is_audio_ext(input))
    || (video_output && (is_video_ext(input) || is_audio_ext(input)))
}

fn is_compressible(ext: &str) -> bool {
  (is_image_ext(ext) && ext != "pdf")
    || matches!(ext, "mp4" | "mov" | "m4v" | "avi" | "mkv" | "webm")
    || matches!(ext, "mp3" | "ogg" | "oga")
}

#[tauri::command]
async fn enqueue_conversion(
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
  let output = validate_output(&request.output_path, &format)?;
  let id = Uuid::new_v4().to_string();
  let semaphore = state.slots.clone();
  let task_id = id.clone();
  tauri::async_runtime::spawn(async move {
    let _permit = match semaphore.acquire_owned().await {
      Ok(p) => p,
      Err(_) => return,
    };
    let _ = app.emit(
      "conversion-progress",
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
          "conversion-progress",
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
          "conversion-progress",
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

#[tauri::command]
async fn enqueue_compression(
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
  let output = validate_output(&request.output_path, &ext)?;
  let id = Uuid::new_v4().to_string();
  let semaphore = state.slots.clone();
  let task_id = id.clone();
  tauri::async_runtime::spawn(async move {
    let _permit = match semaphore.acquire_owned().await {
      Ok(p) => p,
      Err(_) => return,
    };
    let _ = app.emit(
      "conversion-progress",
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
          "conversion-progress",
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
          "conversion-progress",
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

async fn try_run_magick(app: &tauri::AppHandle, args: Vec<String>) -> Result<bool, String> {
  // Try magick sidecar first (ImageMagick 7), then convert (IM6)
  if let Ok(sidecar) = app.shell().sidecar("magick") {
    if let Ok((mut rx, _child)) = sidecar.args(args.clone()).spawn() {
      let mut exit_code = None;
      while let Some(event) = rx.recv().await {
        match event {
          CommandEvent::Terminated(payload) => exit_code = payload.code,
          CommandEvent::Error(_) => break,
          _ => {}
        }
      }
      if exit_code == Some(0) {
        return Ok(true);
      }
    }
  }
  if let Ok(sidecar) = app.shell().sidecar("convert") {
    if let Ok((mut rx, _child)) = sidecar.args(args).spawn() {
      let mut exit_code = None;
      while let Some(event) = rx.recv().await {
        match event {
          CommandEvent::Terminated(payload) => exit_code = payload.code,
          CommandEvent::Error(_) => break,
          _ => {}
        }
      }
      if exit_code == Some(0) {
        return Ok(true);
      }
    }
  }
  Ok(false)
}

async fn run_convert_image_magick(
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

  // Use ImageMagick when either side is outside FFmpeg's common image formats.
  if (is_image_ext(&in_ext) || in_ext == "pdf")
    && (!is_ffmpeg_image_ext(&in_ext) || !is_ffmpeg_image_ext(&out_ext))
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
      "conversion-progress",
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
    let probe = app
      .shell()
      .sidecar("ffprobe")
      .map_err(|e| e.to_string())?
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
    let (mut rx, _child) = app
      .shell()
      .sidecar("ffmpeg")
      .map_err(|e| e.to_string())?
      .args(args)
      .spawn()
      .map_err(|e| format!("Avvio ffmpeg non riuscito: {e}"))?;
    let mut exit_code = None;
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
                "conversion-progress",
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
      return Err(format!("ffmpeg è terminato con codice {:?}", exit_code));
    }
  }

  Err("Formato non supportato o nessun convertitore disponibile".into())
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
  let probe = app
    .shell()
    .sidecar("ffprobe")
    .map_err(|e| e.to_string())?
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
  let (mut rx, _child) = app
    .shell()
    .sidecar("ffmpeg")
    .map_err(|e| e.to_string())?
    .args(args)
    .spawn()
    .map_err(|e| format!("Avvio ffmpeg non riuscito: {e}"))?;
  let mut exit_code = None;
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
              "conversion-progress",
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
    Err(format!("ffmpeg è terminato con codice {:?}", exit_code))
  }
}

#[tauri::command]
fn available_parallelism() -> usize {
  num_cpus::get().max(1)
}

fn build_native_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
  let menu = Menu::default(app)?;
  let settings_item =
    MenuItem::with_id(app, "open-settings", "Settings…", true, Some("CmdOrCtrl+,"))?;

  #[cfg(target_os = "macos")]
  {
    if let Some(app_menu) = menu
      .items()?
      .into_iter()
      .find_map(|item| item.as_submenu().cloned())
    {
      app_menu.insert(&settings_item, 2)?;
      let separator = PredefinedMenuItem::separator(app)?;
      app_menu.insert(&separator, 3)?;
    }
  }

  #[cfg(not(target_os = "macos"))]
  {
    let submenus = menu
      .items()?
      .into_iter()
      .filter_map(|item| item.as_submenu().cloned())
      .collect::<Vec<_>>();
    let target_menu = submenus
      .iter()
      .find(|submenu| {
        submenu
          .text()
          .is_ok_and(|text| text.eq_ignore_ascii_case("Edit"))
      })
      .or_else(|| submenus.first());

    if let Some(target_menu) = target_menu {
      target_menu.append(&PredefinedMenuItem::separator(app)?)?;
      target_menu.append(&settings_item)?;
    }
  }

  Ok(menu)
}

fn open_settings_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
  if let Some(window) = app.get_webview_window("settings") {
    if let Err(error) = window.show() {
      eprintln!("Impossibile mostrare la finestra Impostazioni: {error}");
    }
    if let Err(error) = window.set_focus() {
      eprintln!("Impossibile attivare la finestra Impostazioni: {error}");
    }
    return;
  }

  if let Err(error) =
    WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("/?window=settings".into()))
      .title("Biolaris Media — Settings")
      .inner_size(940.0, 780.0)
      .min_inner_size(800.0, 620.0)
      .decorations(false)
      .center()
      .build()
  {
    eprintln!("Impossibile aprire la finestra Impostazioni: {error}");
  }
}

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .plugin(tauri_plugin_shell::init())
    .menu(|app| build_native_menu(app))
    .on_menu_event(|app, event| {
      if event.id() == "open-settings" {
        open_settings_window(app);
      }
    })
    .manage(QueueState::default())
    .invoke_handler(tauri::generate_handler![
            enqueue_conversion,
            enqueue_compression,
            available_parallelism
        ])
    .run(tauri::generate_context!())
    .expect("errore durante l'avvio di Biolaris");
}
