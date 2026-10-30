use crate::{constants::CONVERSION_PROGRESS_EVENT, formats::{get_file_ext, is_video_ext}, models::{CombineVideosRequest, JobUpdate, QueueState}, paths::{canonical_existing_file, validate_output}, tools::{append_stderr_tail, ffmpeg_failure_message, tool_command}};
use std::path::{Path, PathBuf};
use tauri::{Emitter, State};
use tauri_plugin_shell::process::CommandEvent;
use uuid::Uuid;

const FORMATS: &[&str] = &["mp4", "webm", "mkv", "avi", "mov"];
struct VideoInfo { duration: f64, width: u32, height: u32, has_audio: bool }

async fn probe(app: &tauri::AppHandle, path: &Path) -> Result<VideoInfo, String> {
  let result = tool_command(app, "ffprobe").args(["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "default=noprint_wrappers=1"]).arg(path.as_os_str()).output().await.map_err(|error| format!("Avvio ffprobe non riuscito: {error}"))?;
  if !result.status.success() { return Err(format!("Impossibile leggere il video {}", path.file_name().and_then(|n| n.to_str()).unwrap_or("selezionato"))); }
  let (mut video, mut has_video, mut has_audio) = (false, false, false);
  let (mut width, mut height, mut duration) = (None, None, None);
  for line in String::from_utf8_lossy(&result.stdout).lines() {
    if let Some(kind) = line.strip_prefix("codec_type=") { video = kind == "video" && !has_video; has_video |= kind == "video"; has_audio |= kind == "audio"; }
    else if video && line.starts_with("width=") { width = line[6..].parse::<u32>().ok(); }
    else if video && line.starts_with("height=") { height = line[7..].parse::<u32>().ok(); }
    else if let Some(value) = line.strip_prefix("duration=") { duration = value.parse::<f64>().ok(); }
  }
  if !has_video { return Err("Un file selezionato non contiene una traccia video".into()); }
  let duration = duration.filter(|n| n.is_finite() && *n > 0.0).ok_or("Durata video non valida")?;
  let width = width.filter(|n| *n > 0 && *n <= 16_384).ok_or("Larghezza video non supportata")?;
  let height = height.filter(|n| *n > 0 && *n <= 16_384).ok_or("Altezza video non supportata")?;
  Ok(VideoInfo { duration, width: width + width % 2, height: height + height % 2, has_audio })
}

fn output_path(first: &Path, requested: &str, format: &str) -> Result<PathBuf, String> {
  let parent = first.parent().ok_or("Cartella video non valida")?;
  let default = format!("{}-combined", first.file_stem().and_then(|s| s.to_str()).unwrap_or("video"));
  let name = requested.trim();
  let stem = if name.is_empty() { default.as_str() } else { name.strip_suffix(&format!(".{format}")).or_else(|| name.strip_suffix(&format!(".{}", format.to_ascii_uppercase()))).unwrap_or(name) };
  if stem.is_empty() || stem.len() > 240 || stem == "." || stem == ".." || stem.ends_with('.') || stem.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')) { return Err("Inserisci un nome video valido (massimo 240 byte)".into()); }
  let device = stem.split('.').next().unwrap_or(stem).to_ascii_uppercase();
  if matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL") || (1..=9).any(|n| device == format!("COM{n}") || device == format!("LPT{n}")) { return Err("Questo nome non può essere usato come file video".into()); }
  Ok(parent.join(format!("{stem}.{format}")))
}

#[tauri::command]
pub(crate) async fn enqueue_combine_videos(app: tauri::AppHandle, state: State<'_, QueueState>, request: CombineVideosRequest) -> Result<String, String> {
  if request.video_paths.len() < 2 { return Err("Seleziona almeno due video da combinare".into()); }
  if !FORMATS.contains(&request.format.as_str()) { return Err("Formato video di output non valido".into()); }
  let inputs = request.video_paths.iter().map(|p| canonical_existing_file(p)).collect::<Result<Vec<_>, _>>()?;
  for input in &inputs { if !is_video_ext(&get_file_ext(input)) { return Err(format!("Il file selezionato non è un video supportato: {}", input.file_name().and_then(|n| n.to_str()).unwrap_or("video"))); } }
  let mut infos = Vec::with_capacity(inputs.len());
  for input in &inputs { infos.push(probe(&app, input).await?); }
  let requested = output_path(&inputs[0], &request.output_name, &request.format)?;
  let output = validate_output(&requested.to_string_lossy(), &request.format, request.auto_rename_outputs)?;
  let id = Uuid::new_v4().to_string(); let task_id = id.clone(); let semaphore = state.slots.clone(); let format = request.format;
  tauri::async_runtime::spawn(async move {
    let Ok(_permit) = semaphore.acquire_owned().await else { return; };
    let _ = app.emit(CONVERSION_PROGRESS_EVENT, JobUpdate { id: task_id.clone(), status: "running".into(), progress: 0, output_path: None, error: None });
    let result = run(&app, &task_id, &inputs, &infos, &output, &format).await;
    let update = match result { Ok(()) => JobUpdate { id: task_id, status: "completed".into(), progress: 100, output_path: Some(output.to_string_lossy().into_owned()), error: None }, Err(error) => JobUpdate { id: task_id, status: "failed".into(), progress: 0, output_path: None, error: Some(error) } };
    let _ = app.emit(CONVERSION_PROGRESS_EVENT, update);
  });
  Ok(id)
}

struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile { fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); } }

async fn run(app: &tauri::AppHandle, id: &str, inputs: &[PathBuf], infos: &[VideoInfo], output: &Path, format: &str) -> Result<(), String> {
  let canvas_width = infos.iter().map(|info| info.width).max().ok_or("Seleziona almeno due video")?;
  let canvas_height = infos.iter().map(|info| info.height).max().ok_or("Seleziona almeno due video")?;
  let total: f64 = infos.iter().map(|info| info.duration).sum();
  let mut args = vec!["-hide_banner".into(), "-n".into()];
  for input in inputs { args.extend(["-i".into(), input.to_string_lossy().into_owned()]); }
  for info in infos.iter().filter(|info| !info.has_audio) { args.extend(["-f".into(), "lavfi".into(), "-t".into(), format!("{:.6}", info.duration), "-i".into(), "anullsrc=channel_layout=stereo:sample_rate=48000".into()]); }
  let mut filters = Vec::new(); let mut concat = String::new(); let mut next_silence = inputs.len();
  for (i, info) in infos.iter().enumerate() {
    // Padding creates a common canvas without scaling or dropping source pixels.
    // yuv444p avoids introducing chroma subsampling during the filter graph.
    filters.push(format!("[{i}:v:0]pad={canvas_width}:{canvas_height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv444p,setpts=PTS-STARTPTS[v{i}]"));
    let audio = if info.has_audio { i } else { let audio = next_silence; next_silence += 1; audio };
    filters.push(format!("[{audio}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration={:.6},asetpts=PTS-STARTPTS[a{i}]", info.duration));
    concat.push_str(&format!("[v{i}][a{i}]"));
  }
  filters.push(format!("{concat}concat=n={}:v=1:a=1[outv][outa]", inputs.len()));
  args.extend(["-filter_complex".into(), filters.join(";"), "-map".into(), "[outv]".into(), "-map".into(), "[outa]".into()]);
  match format {
    // Each selected container gets a lossless video encoder. WebM's audio
    // codec remains Opus; this setting is specifically for video quality.
    "webm" => args.extend(["-c:v".into(), "libvpx-vp9".into(), "-lossless".into(), "1".into(), "-b:v".into(), "0".into(), "-c:a".into(), "libopus".into()]),
    "avi" => args.extend(["-c:v".into(), "ffv1".into(), "-level".into(), "3".into(), "-c:a".into(), "pcm_s16le".into()]),
    _ => args.extend(["-c:v".into(), "libx264".into(), "-preset".into(), "medium".into(), "-crf".into(), "0".into(), "-c:a".into(), "aac".into()]),
  }
  let temporary = output.with_file_name(format!(".biolaris-combine-{}.{}", Uuid::new_v4(), format));
  // passthrough keeps every frame timestamp; output is variable-frame-rate
  // when the sources use different frame rates instead of forcing 30 fps.
  args.extend(["-pix_fmt".into(), "yuv444p".into(), "-fps_mode".into(), "passthrough".into(), "-progress".into(), "pipe:1".into(), "-nostats".into(), temporary.to_string_lossy().into_owned()]);
  let cleanup = TemporaryFile(temporary);
  let (mut events, _child) = tool_command(app, "ffmpeg").args(args).spawn().map_err(|error| format!("Avvio ffmpeg non riuscito: {error}"))?;
  let mut exit = None; let mut stderr = Vec::new(); let mut pending = Vec::new(); let mut last = 0;
  while let Some(event) = events.recv().await { match event {
    CommandEvent::Stdout(bytes) => { pending.extend_from_slice(&bytes); while let Some(pos) = pending.iter().position(|b| *b == b'\n') { let line: Vec<u8> = pending.drain(..=pos).collect(); if let Some(us) = String::from_utf8_lossy(&line).trim().strip_prefix("out_time_us=").and_then(|v| v.parse::<u64>().ok()) { let progress = ((us as f64 / (total * 1_000_000.0)).clamp(0.0, 0.99) * 100.0).round() as u8; if progress > last { last = progress; let _ = app.emit(CONVERSION_PROGRESS_EVENT, JobUpdate { id: id.into(), status: "running".into(), progress, output_path: None, error: None }); } } } },
    CommandEvent::Stderr(bytes) => append_stderr_tail(&mut stderr, &bytes), CommandEvent::Terminated(payload) => exit = payload.code, CommandEvent::Error(error) => append_stderr_tail(&mut stderr, error.as_bytes()), _ => {}
  }}
  if exit != Some(0) { return Err(ffmpeg_failure_message(exit, &stderr)); }
  std::fs::hard_link(&cleanup.0, output).map_err(|error| if error.kind() == std::io::ErrorKind::AlreadyExists { "Il file di destinazione esiste già".into() } else { format!("Salvataggio del video non riuscito: {error}") })?;
  Ok(())
}
