use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{Emitter, State};
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
    pub format: OutputFormat,
    /// FFmpeg CRF range; smaller values mean higher quality.
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

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    Mp4,
    Webm,
    Mp3,
    Wav,
    Flac,
}
impl OutputFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
            Self::Webm => "webm",
            Self::Mp3 => "mp3",
            Self::Wav => "wav",
            Self::Flac => "flac",
        }
    }
    fn codec_args(self) -> &'static [&'static str] {
        match self {
            Self::Mp4 => &["-c:v", "libx264", "-c:a", "aac"],
            Self::Webm => &["-c:v", "libvpx-vp9", "-c:a", "libopus"],
            Self::Mp3 => &["-vn", "-c:a", "libmp3lame"],
            Self::Wav => &["-vn", "-c:a", "pcm_s16le"],
            Self::Flac => &["-vn", "-c:a", "flac"],
        }
    }
    fn is_video(self) -> bool {
        matches!(self, Self::Mp4 | Self::Webm)
    }
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
    if result.exists() {
        return Err("Il file di destinazione esiste già".into());
    }
    Ok(result)
}

#[tauri::command]
async fn enqueue_conversion(
    app: tauri::AppHandle,
    state: State<'_, QueueState>,
    request: ConversionRequest,
) -> Result<String, String> {
    if request.quality > 51 {
        return Err("La qualità CRF deve essere compresa tra 0 e 51".into());
    }
    let input = canonical_existing_file(&request.input_path)?;
    let output = validate_output(&request.output_path, request.format.extension())?;
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
        let result = run_ffmpeg_convert(&app, &task_id, &input, &output, request).await;
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
    let ext = input.extension().and_then(|v| v.to_str()).unwrap_or("").to_lowercase();
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

async fn run_ffmpeg_convert(
    app: &tauri::AppHandle,
    id: &str,
    input: &Path,
    output: &Path,
    request: ConversionRequest,
) -> Result<(), String> {
    let input_text = input.to_string_lossy().into_owned();
    let output_text = output.to_string_lossy().into_owned();
    // Probe duration first, so FFmpeg's machine-readable out_time can be converted to %.
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
        .await
        .map_err(|e| format!("Avvio ffprobe non riuscito: {e}"))?;
    if !probe.status.success() {
        return Err("ffprobe non riconosce il file di input".into());
    }
    let duration_secs: f64 = String::from_utf8_lossy(&probe.stdout)
        .trim()
        .parse()
        .map_err(|_| "Durata del file non leggibile")?;
    if !duration_secs.is_finite() || duration_secs <= 0.0 {
        return Err("Durata del file non valida".into());
    }

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-n".into(),
        "-i".into(),
        input_text.clone(),
        "-progress".into(),
        "pipe:1".into(),
    ];
    args.extend(request.format.codec_args().iter().map(|s| (*s).to_owned()));
    if request.format.is_video() {
        args.extend(["-crf".into(), request.quality.to_string()]);
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

async fn run_ffmpeg_compress(
    app: &tauri::AppHandle,
    id: &str,
    input: &Path,
    output: &Path,
    request: CompressionRequest,
) -> Result<(), String> {
    let input_text = input.to_string_lossy().into_owned();
    let output_text = output.to_string_lossy().into_owned();
    let ext = input.extension().and_then(|v| v.to_str()).unwrap_or("").to_lowercase();
    
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
    
    // Compression strategy based on file type
    if ["mp4", "mov", "m4v", "avi", "mkv"].contains(&ext.as_str()) {
        // For video: use CRF based on quality (30-70 maps to CRF)
        let crf = ((100 - request.quality as u32) * 51 / 70).max(0).min(51);
        args.extend(["-c:v".into(), "libx264".into(), "-crf".into(), crf.to_string(), "-c:a".into(), "aac".into(), "-b:a".into(), "128k".into()]);
    } else if ["webm"].contains(&ext.as_str()) {
        let crf = ((100 - request.quality as u32) * 63 / 70).max(0).min(63);
        args.extend(["-c:v".into(), "libvpx-vp9".into(), "-crf".into(), crf.to_string(), "-b:v".into(), "0".into(), "-c:a".into(), "libopus".into()]);
    } else if ["mp3"].contains(&ext.as_str()) {
        // For MP3, adjust bitrate
        let bitrate = if request.quality >= 60 { "192k" } else if request.quality >= 50 { "128k" } else { "96k" };
        args.extend(["-vn".into(), "-c:a".into(), "libmp3lame".into(), "-b:a".into(), bitrate.into()]);
    } else if ["jpg", "jpeg"].contains(&ext.as_str()) {
        args.extend(["-c:v".into(), "mjpeg".into(), "-q:v".into(), ((100 - request.quality as u32) / 2).max(2).min(31).to_string()]);
    } else if ["png"].contains(&ext.as_str()) {
        args.extend(["-c:v".into(), "png".into(), "-compression_level".into(), ((70 - request.quality as u32) / 10).max(0).min(9).to_string()]);
    } else {
        // Generic compression
        args.extend(["-c:v".into(), "libx264".into(), "-crf".into(), "28".into(), "-c:a".into(), "aac".into()]);
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(QueueState::default())
        .invoke_handler(tauri::generate_handler![
            enqueue_conversion,
            enqueue_compression,
            available_parallelism
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio di Biolaris");
}

