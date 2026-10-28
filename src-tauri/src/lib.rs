use serde::{Deserialize, Serialize};
use std::{
  ffi::{OsStr, OsString},
  path::{Path, PathBuf},
  sync::Arc,
};
use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_shell::{process::{Command, CommandEvent}, ShellExt};
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

fn binary_target_triple() -> Option<&'static str> {
  match (std::env::consts::OS, std::env::consts::ARCH) {
    ("windows", "x86_64") => Some("x86_64-pc-windows-msvc"),
    ("macos", "x86_64") => Some("x86_64-apple-darwin"),
    ("macos", "aarch64") => Some("aarch64-apple-darwin"),
    ("linux", "x86_64") => Some("x86_64-unknown-linux-gnu"),
    ("linux", "aarch64") => Some("aarch64-unknown-linux-gnu"),
    _ => None,
  }
}

fn bundled_tool_prefix(app: &tauri::AppHandle) -> Option<PathBuf> {
  let target = binary_target_triple()?;
  let mut candidates = Vec::new();
  if let Ok(resource_dir) = app.path().resource_dir() {
    candidates.push(resource_dir.join("runtime").join(target));
  }
  candidates.push(
    Path::new(env!("CARGO_MANIFEST_DIR"))
      .join("binaries")
      .join("runtime-current")
      .join(target),
  );
  candidates.into_iter().find(|path| path.is_dir())
}

fn prepend_search_paths(prefix_paths: &[PathBuf], variable: &str) -> Option<OsString> {
  let mut paths: Vec<PathBuf> = prefix_paths
    .iter()
    .filter(|path| path.is_dir())
    .cloned()
    .collect();
  if let Some(existing) = std::env::var_os(variable) {
    paths.extend(std::env::split_paths(&existing));
  }
  std::env::join_paths(paths).ok()
}

fn tool_command(app: &tauri::AppHandle, name: &str) -> Command {
  if let Some(prefix) = bundled_tool_prefix(app) {
    let executable_dirs = if cfg!(target_os = "windows") {
      vec![prefix.join("Library").join("bin"), prefix.join("bin")]
    } else {
      vec![prefix.join("bin")]
    };
    let executable_name = if cfg!(target_os = "windows") {
      format!("{name}.exe")
    } else {
      name.to_owned()
    };
    if let Some(executable) = executable_dirs
      .iter()
      .map(|directory| directory.join(&executable_name))
      .find(|path| path.is_file())
    {
      let mut command = app.shell().command(executable.as_os_str());
      if let Some(path) = prepend_search_paths(&executable_dirs, "PATH") {
        command = command.env("PATH", path);
      }

      #[cfg(target_os = "linux")]
      if let Some(path) = prepend_search_paths(
        &[prefix.join("lib"), prefix.join("lib64")],
        "LD_LIBRARY_PATH",
      ) {
        command = command.env("LD_LIBRARY_PATH", path);
      }
      #[cfg(target_os = "macos")]
      {
        let library_dirs = [prefix.join("lib"), prefix.join("lib64")];
        if let Some(path) = prepend_search_paths(&library_dirs, "DYLD_LIBRARY_PATH") {
          command = command.env("DYLD_LIBRARY_PATH", path);
        }
        if let Some(path) = prepend_search_paths(&library_dirs, "DYLD_FALLBACK_LIBRARY_PATH") {
          command = command.env("DYLD_FALLBACK_LIBRARY_PATH", path);
        }
      }

      #[cfg(target_os = "linux")]
      if name == "magick" || name == "convert" {
        command = command.env("APPIMAGE_EXTRACT_AND_RUN", "1");
      }
      if cfg!(target_os = "windows") {
        if let Some(path) = prefix.to_str() {
          command = command.env("MAGICK_HOME", path).env("VIPSHOME", path);
        }
      }
      return command;
    }
  }

  // Keep development convenient when a developer has installed the tools globally.
  app.shell().command(OsStr::new(name))
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropRequest {
  pub input_path: String,
  pub output_path: String,
  pub x: u32,
  pub y: u32,
  pub width: u32,
  pub height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideshowRequest {
  pub image_paths: Vec<String>,
  pub output_name: String,
  pub resolution: String,
  pub seconds_per_slide: f64,
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

fn validate_output_with_suffix(path: &str, expected_ext: &str) -> Result<PathBuf, String> {
  let output = PathBuf::from(path);
  let parent = output
    .parent()
    .ok_or("Percorso output non valido")?
    .canonicalize()
    .map_err(|e| format!("Cartella output non valida: {e}"))?;
  if output
    .extension()
    .and_then(|value| value.to_str())
    .map(|value| value.eq_ignore_ascii_case(expected_ext))
    != Some(true)
  {
    return Err(format!("L'estensione deve essere .{expected_ext}"));
  }

  let stem = output
    .file_stem()
    .and_then(|value| value.to_str())
    .ok_or("Nome file output non valido")?;
  let ext = output
    .extension()
    .and_then(|value| value.to_str())
    .ok_or("Estensione file output non valida")?;

  for suffix in 1u32.. {
    let filename = if suffix == 1 {
      format!("{stem}.{ext}")
    } else {
      format!("{stem}-{suffix}.{ext}")
    };
    let candidate = parent.join(filename);
    match std::fs::symlink_metadata(&candidate) {
      Ok(_) => continue,
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(candidate),
      Err(error) => return Err(format!("Percorso output non accessibile: {error}")),
    }
  }
  Err("Impossibile trovare un nome per il file ritagliato".into())
}

fn slideshow_dimensions(resolution: &str) -> Result<Option<(u32, u32)>, String> {
  match resolution {
    "720p" => Ok(Some((1280, 720))),
    "1080p" => Ok(Some((1920, 1080))),
    "4k" => Ok(Some((3840, 2160))),
    "match-image" => Ok(None),
    _ => Err("Risoluzione slideshow non valida".into()),
  }
}

fn slideshow_output_path(first_image: &Path, requested_name: &str) -> Result<PathBuf, String> {
  let parent = first_image.parent().ok_or("Cartella immagine non valida")?;
  let requested_name = requested_name.trim();
  let generated_name = if requested_name.is_empty() {
    format!(
      "{}-slideshow",
      first_image.file_stem().and_then(|stem| stem.to_str()).unwrap_or("slideshow")
    )
  } else {
    requested_name.to_owned()
  };
  let name = if generated_name.to_ascii_lowercase().ends_with(".mp4") {
    &generated_name[..generated_name.len() - 4]
  } else {
    &generated_name
  };

  if name.is_empty() || name == "." || name == ".." || name.len() > 240 {
    return Err("Inserisci un nome video valido (massimo 240 byte)".into());
  }
  if name.chars().any(|character| {
    character.is_control() || matches!(character, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
  }) || name.ends_with('.')
  {
    return Err("Il nome del video contiene caratteri non validi".into());
  }

  let windows_device_name = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
  if matches!(windows_device_name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
    || (1..=9).any(|number| windows_device_name == format!("COM{number}") || windows_device_name == format!("LPT{number}"))
  {
    return Err("Questo nome non può essere usato come file video".into());
  }

  Ok(parent.join(format!("{name}.mp4")))
}

struct TemporaryDirectory(PathBuf);

impl Drop for TemporaryDirectory {
  fn drop(&mut self) {
    let _ = std::fs::remove_dir_all(&self.0);
  }
}

struct TemporaryFile(PathBuf);

impl Drop for TemporaryFile {
  fn drop(&mut self) {
    let _ = std::fs::remove_file(&self.0);
  }
}

fn publish_slideshow_file(temporary: &Path, output: &Path) -> Result<(), String> {
  match std::fs::hard_link(temporary, output) {
    Ok(()) => Ok(()),
    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
      Err("Il file di destinazione esiste già".into())
    }
    Err(_) => {
      let mut source = std::fs::File::open(temporary)
        .map_err(|error| format!("Apertura del video temporaneo non riuscita: {error}"))?;
      let mut destination = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)
        .map_err(|error| format!("Creazione del video di destinazione non riuscita: {error}"))?;
      if let Err(error) = std::io::copy(&mut source, &mut destination)
        .and_then(|_| destination.sync_all())
      {
        let _ = std::fs::remove_file(output);
        return Err(format!("Scrittura del video non riuscita: {error}"));
      }
      Ok(())
    }
  }
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

fn append_stderr_tail(stderr: &mut Vec<u8>, chunk: &[u8]) {
  const MAX_STDERR_BYTES: usize = 16 * 1024;
  if chunk.len() >= MAX_STDERR_BYTES {
    stderr.clear();
    stderr.extend_from_slice(&chunk[chunk.len() - MAX_STDERR_BYTES..]);
    return;
  }

  let overflow = stderr
    .len()
    .saturating_add(chunk.len())
    .saturating_sub(MAX_STDERR_BYTES);
  if overflow > 0 {
    stderr.drain(..overflow);
  }
  stderr.extend_from_slice(chunk);
}

fn ffmpeg_failure_message(exit_code: Option<i32>, stderr: &[u8]) -> String {
  let code = exit_code
    .map(|code| code.to_string())
    .unwrap_or_else(|| "sconosciuto".into());
  let details = String::from_utf8_lossy(stderr).trim().to_owned();
  if details.is_empty() {
    format!("ffmpeg è terminato con codice {code}")
  } else {
    format!("ffmpeg è terminato con codice {code}: {details}")
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
  let video_output = matches!(output, "mp4" | "webm" | "mkv" | "avi" | "mov");
  (image_output && (is_image_ext(input) || input == "pdf"))
    || (audio_output && is_audio_ext(input))
    || (video_output && (is_video_ext(input) || is_audio_ext(input)))
    || (output == "gif" && is_video_ext(input))
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

#[tauri::command]
async fn enqueue_crop(
  app: tauri::AppHandle,
  state: State<'_, QueueState>,
  request: CropRequest,
) -> Result<String, String> {
  if request.width == 0 || request.height == 0 {
    return Err("L'area di ritaglio deve avere dimensioni maggiori di zero".into());
  }
  if request.x.checked_add(request.width).is_none() || request.y.checked_add(request.height).is_none() {
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
      "conversion-progress",
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
async fn enqueue_slideshow(
  app: tauri::AppHandle,
  state: State<'_, QueueState>,
  request: SlideshowRequest,
) -> Result<String, String> {
  if request.image_paths.is_empty() {
    return Err("Seleziona almeno un'immagine per creare lo slideshow".into());
  }
  if !request.seconds_per_slide.is_finite()
    || !(1.0..=30.0).contains(&request.seconds_per_slide)
    || (request.seconds_per_slide * 2.0).fract().abs() > 0.0001
  {
    return Err("La durata di ogni immagine deve essere da 1 a 30 secondi, a incrementi di 0,5".into());
  }
  let dimensions = slideshow_dimensions(&request.resolution)?;
  let inputs = request.image_paths.iter()
    .map(|path| canonical_existing_file(path))
    .collect::<Result<Vec<_>, _>>()?;
  for input in &inputs {
    if !is_image_ext(&get_file_ext(input)) {
      let filename = input.file_name().and_then(|name| name.to_str()).unwrap_or("immagine");
      return Err(format!("Il file selezionato non è un'immagine supportata: {filename}"));
    }
  }
  let first_input = inputs.first().ok_or("Seleziona almeno un'immagine per creare lo slideshow")?;
  let requested_output = slideshow_output_path(first_input, &request.output_name)?;
  let output = validate_output_with_suffix(&requested_output.to_string_lossy(), "mp4")?;
  let seconds_per_slide = request.seconds_per_slide;
  let id = Uuid::new_v4().to_string();
  let semaphore = state.slots.clone();
  let task_id = id.clone();
  tauri::async_runtime::spawn(async move {
    let _permit = match semaphore.acquire_owned().await {
      Ok(permit) => permit,
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
    let result = run_slideshow(
      &app,
      &task_id,
      &inputs,
      &output,
      dimensions,
      seconds_per_slide,
    ).await;
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

async fn probe_image_dimensions(app: &tauri::AppHandle, input: &Path) -> Result<(u32, u32), String> {
  let output = tool_command(app, "ffprobe")
    .args([
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
      "-of", "csv=s=x:p=0",
    ])
    .arg(input.as_os_str())
    .output()
    .await
    .map_err(|error| format!("Avvio ffprobe non riuscito: {error}"))?;
  if !output.status.success() {
    let details = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    return Err(if details.is_empty() {
      "Impossibile leggere le dimensioni della prima immagine".into()
    } else {
      format!("Impossibile leggere le dimensioni della prima immagine: {details}")
    });
  }

  let dimensions = String::from_utf8_lossy(&output.stdout);
  let (width, height) = dimensions.trim().split_once('x')
    .ok_or("Dimensioni della prima immagine non valide")?;
  let width = width.parse::<u32>().map_err(|_| "Larghezza immagine non valida")?;
  let height = height.parse::<u32>().map_err(|_| "Altezza immagine non valida")?;
  if width < 2 || height < 2 || width > 16_384 || height > 16_384 {
    return Err("Le dimensioni della prima immagine non sono supportate".into());
  }
  // H.264 with yuv420p requires even dimensions.
  Ok((width.saturating_add(width % 2), height.saturating_add(height % 2)))
}

async fn run_slideshow(
  app: &tauri::AppHandle,
  id: &str,
  inputs: &[PathBuf],
  output: &Path,
  requested_dimensions: Option<(u32, u32)>,
  seconds_per_slide: f64,
) -> Result<(), String> {
  let mut temporary_directory: Option<TemporaryDirectory> = None;
  let mut slideshow_inputs = Vec::with_capacity(inputs.len());
  for (index, input) in inputs.iter().enumerate() {
    let extension = get_file_ext(input);
    if is_ffmpeg_image_ext(&extension) && extension != "gif" {
      slideshow_inputs.push(input.clone());
      continue;
    }

    if temporary_directory.is_none() {
      let path = std::env::temp_dir().join(format!("biolaris-slideshow-{}", Uuid::new_v4()));
      std::fs::create_dir(&path)
        .map_err(|error| format!("Creazione cartella temporanea non riuscita: {error}"))?;
      temporary_directory = Some(TemporaryDirectory(path));
    }
    let temp_dir = temporary_directory.as_ref().ok_or("Cartella temporanea non disponibile")?;
    let converted = temp_dir.0.join(format!("slide-{index}.png"));
    run_convert_image_magick(app, input, &converted, "png", 100, true).await?;
    slideshow_inputs.push(converted);
  }

  let (width, height) = match requested_dimensions {
    Some(dimensions) => dimensions,
    None => probe_image_dimensions(app, slideshow_inputs.first().ok_or("Seleziona almeno un'immagine")?).await?,
  };
  let mut args = vec!["-hide_banner".to_owned(), "-n".to_owned()];
  let slide_duration = format!("{seconds_per_slide:.1}");
  for input in &slideshow_inputs {
    args.extend([
      "-f".into(), "image2".into(),
      "-loop".into(), "1".into(),
      "-pattern_type".into(), "none".into(),
      "-framerate".into(), "30".into(),
      "-t".into(), slide_duration.clone(),
      "-i".into(), input.to_string_lossy().into_owned(),
    ]);
  }

  let mut filters = Vec::with_capacity(slideshow_inputs.len() + 1);
  let mut concat_inputs = String::new();
  for index in 0..slideshow_inputs.len() {
    let label = format!("slide{index}");
    filters.push(format!(
      "[{index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[{label}]"
    ));
    concat_inputs.push_str(&format!("[{label}]"));
  }
  filters.push(format!("{concat_inputs}concat=n={}:v=1:a=0[outv]", slideshow_inputs.len()));
  let filter_graph = filters.join(";");
  let total_duration = seconds_per_slide * slideshow_inputs.len() as f64;
  let temporary_output = TemporaryFile(output.with_file_name(format!(
    ".biolaris-slideshow-{}.mp4",
    Uuid::new_v4()
  )));
  args.extend([
    "-filter_complex".into(), filter_graph,
    "-map".into(), "[outv]".into(),
    "-r".into(), "30".into(),
    "-t".into(), format!("{total_duration:.1}"),
    "-c:v".into(), "libx264".into(),
    "-preset".into(), "medium".into(),
    "-crf".into(), "18".into(),
    "-pix_fmt".into(), "yuv420p".into(),
    "-movflags".into(), "+faststart".into(),
    "-progress".into(), "pipe:1".into(),
    "-nostats".into(),
    temporary_output.0.to_string_lossy().into_owned(),
  ]);

  let (mut events, _child) = tool_command(app, "ffmpeg")
    .args(args)
    .spawn()
    .map_err(|error| format!("Avvio ffmpeg non riuscito: {error}"))?;
  let mut exit_code = None;
  let mut stderr_tail = Vec::new();
  let mut stdout_pending = Vec::new();
  let mut last_progress = 0u8;
  while let Some(event) = events.recv().await {
    match event {
      CommandEvent::Stdout(bytes) => {
        stdout_pending.extend_from_slice(&bytes);
        while let Some(newline) = stdout_pending.iter().position(|byte| *byte == b'\n') {
          let line: Vec<u8> = stdout_pending.drain(..=newline).collect();
          let value = String::from_utf8_lossy(&line);
          if let Some(microseconds) = value.trim().strip_prefix("out_time_us=").and_then(|time| time.parse::<u64>().ok()) {
            let ratio = (microseconds as f64 / (total_duration * 1_000_000.0)).clamp(0.0, 0.99);
            let progress = (ratio * 100.0).round() as u8;
            if progress > last_progress {
              last_progress = progress;
              let _ = app.emit("conversion-progress", JobUpdate {
                id: id.to_owned(),
                status: "running".into(),
                progress,
                output_path: None,
                error: None,
              });
            }
          }
        }
      }
      CommandEvent::Stderr(bytes) => append_stderr_tail(&mut stderr_tail, &bytes),
      CommandEvent::Terminated(payload) => exit_code = payload.code,
      CommandEvent::Error(error) => append_stderr_tail(&mut stderr_tail, error.as_bytes()),
      _ => {}
    }
  }
  if exit_code == Some(0) {
    publish_slideshow_file(&temporary_output.0, output)
  } else {
    Err(ffmpeg_failure_message(exit_code, &stderr_tail))
  }
}

async fn run_crop_image_magick(
  app: &tauri::AppHandle,
  input: &Path,
  output: &Path,
  request: &CropRequest,
) -> Result<(), String> {
  let args = vec![
    input.to_string_lossy().into_owned(),
    "-auto-orient".into(),
    "-crop".into(),
    format!("{}x{}+{}+{}", request.width, request.height, request.x, request.y),
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
  let still_image_to_gif = out_ext == "gif"
    && is_image_ext(&in_ext)
    && in_ext != "gif"
    && !is_video_ext(&in_ext);

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
            enqueue_crop,
            enqueue_slideshow,
            available_parallelism
        ])
    .run(tauri::generate_context!())
    .expect("errore durante l'avvio di Biolaris");
}
