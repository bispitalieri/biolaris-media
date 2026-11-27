use crate::{constants::CONVERSION_PROGRESS_EVENT, models::{self, JobUpdate, QueueState}, tools::{append_stderr_tail, tool_command}};
use std::path::PathBuf;
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use uuid::Uuid;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadVideoRequest {
  pub urls: Vec<String>,
  pub output_directory: Option<String>,
}

fn destination(app: &tauri::AppHandle, requested: Option<String>) -> Result<PathBuf, String> {
  let path = match requested {
    Some(value) if !value.trim().is_empty() => PathBuf::from(value),
    _ => app.path().download_dir().map_err(|error| crate::t!("download.folder_unavailable", error = error.to_string()))?,
  };
  let path = path.canonicalize().map_err(|error| crate::t!("download.invalid_destination", error = error.to_string()))?;
  if !path.is_dir() { return Err(crate::t!("download.must_be_folder")); }
  Ok(path)
}

fn valid_url(value: &str) -> bool {
  let value = value.trim();
  let Some((scheme, rest)) = value.split_once("://") else { return false; };
  if !(scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https")) {
    return false;
  }
  if rest.is_empty() {
    return false;
  }
  // Reject whitespace, control characters, and shell metacharacters that could enable injection
  if rest.chars().any(|c| {
    c.is_whitespace()
      || c.is_control()
      || matches!(c, '|' | '&' | ';' | '`' | '$' | '(' | ')' | '{' | '}' | '<' | '>' | '!')
  }) {
    return false;
  }
  // Reject URLs with '@' in the host part (user:pass@host pattern)
  let host = rest.split('/').next().unwrap_or("");
  !(host.is_empty() || host.contains('@'))
}

#[tauri::command]
pub(crate) async fn enqueue_video_download(app: tauri::AppHandle, state: State<'_, QueueState>, request: DownloadVideoRequest) -> Result<String, String> {
  let urls = request.urls.into_iter().map(|url| url.trim().to_owned()).filter(|url| !url.is_empty()).collect::<Vec<_>>();
  if urls.is_empty() { return Err(crate::t!("download.no_urls")); }
  if urls.len() > 100 { return Err(crate::t!("download.too_many_urls")); }
  if let Some(url) = urls.iter().find(|url| !valid_url(url)) { return Err(crate::t!("download.invalid_url", url = url.to_string())); }
  let directory = destination(&app, request.output_directory)?;
  let _queue_permit = state.queue_limit.clone().try_acquire_owned().map_err(|_| {
    crate::t!("conversion.queue_full", count = crate::constants::MAX_QUEUE_SIZE.to_string())
  })?;
  let id = Uuid::new_v4().to_string(); let task_id = id.clone(); let slots = state.slots.clone();
  tauri::async_runtime::spawn(async move {
    let Ok(_permit) = slots.acquire_owned().await else { return; };
    let _ = app.emit(CONVERSION_PROGRESS_EVENT, JobUpdate { id: task_id.clone(), status: "running".into(), progress: 0, output_path: None, error: None });
    let result = run(&app, &task_id, &urls, &directory).await;
    let update = match result {
      Ok(()) => JobUpdate { id: task_id, status: "completed".into(), progress: 100, output_path: Some(directory.to_string_lossy().into_owned()), error: None },
      Err(error) => JobUpdate { id: task_id, status: "failed".into(), progress: 0, output_path: None, error: Some(error) },
    };
    models::emit_job_update(&app, CONVERSION_PROGRESS_EVENT, update);
  });
  Ok(id)
}

async fn run(app: &tauri::AppHandle, id: &str, urls: &[String], directory: &std::path::Path) -> Result<(), String> {
  for (index, url) in urls.iter().enumerate() {
    let output = directory.join("%(title).200B [%(id)s].%(ext)s");
    let (mut events, _child) = tool_command(app, "yt-dlp")
      .args(["--newline", "--no-overwrites", "--no-playlist", "--progress", "--extractor-args", "generic:impersonate", "--output"])
      .arg(output.as_os_str()).args(["--", url]).spawn()
      .map_err(|error| crate::t!("download.yt_dlp_start_failed", error = error.to_string()))?;
    let mut exit = None; let mut stderr = Vec::new(); let mut pending = Vec::new(); let mut pending_error = Vec::new(); let mut last = 0;
    while let Some(event) = events.recv().await {
      match event {
        CommandEvent::Stdout(bytes) => {
          pending.extend_from_slice(&bytes);
          while let Some(pos) = pending.iter().position(|byte| *byte == b'\n' || *byte == b'\r') {
            let line: Vec<u8> = pending.drain(..=pos).collect();
            if let Some(percent) = parse_percent(&String::from_utf8_lossy(&line)) {
              let total = (((index as u32 + percent as u32) * 100) / urls.len() as u32).min(99) as u8;
              if total > last { last = total; let _ = app.emit(CONVERSION_PROGRESS_EVENT, JobUpdate { id: id.into(), status: "running".into(), progress: total, output_path: None, error: None }); }
            }
          }
        }
        CommandEvent::Stderr(bytes) => {
          append_stderr_tail(&mut stderr, &bytes);
          pending_error.extend_from_slice(&bytes);
          while let Some(pos) = pending_error.iter().position(|byte| *byte == b'\n' || *byte == b'\r') {
            let line: Vec<u8> = pending_error.drain(..=pos).collect();
            if let Some(percent) = parse_percent(&String::from_utf8_lossy(&line)) {
              let total = (((index as u32 + percent as u32) * 100) / urls.len() as u32).min(99) as u8;
              if total > last { last = total; let _ = app.emit(CONVERSION_PROGRESS_EVENT, JobUpdate { id: id.into(), status: "running".into(), progress: total, output_path: None, error: None }); }
            }
          }
        },
        CommandEvent::Terminated(payload) => exit = payload.code,
        CommandEvent::Error(error) => append_stderr_tail(&mut stderr, error.as_bytes()),
        _ => {}
      }
    }
    if exit != Some(0) {
      let details = String::from_utf8_lossy(&stderr).trim().to_owned();
      let idx = (index + 1).to_string();
      return Err(if details.is_empty() { crate::t!("download.failed", index = idx) } else { crate::t!("download.failed_details", index = idx, details = details) });
    }
    let progress = (((index as u32 + 1) * 100) / urls.len() as u32).min(99) as u8;
    let _ = app.emit(CONVERSION_PROGRESS_EVENT, JobUpdate { id: id.into(), status: "running".into(), progress, output_path: None, error: None });
  }
  Ok(())
}

fn parse_percent(line: &str) -> Option<u8> {
  let percent_end = line.find('%')?;
  let start = line[..percent_end].rfind(|character: char| !character.is_ascii_digit() && character != '.')? + 1;
  line[start..percent_end].parse::<f32>().ok().filter(|value| value.is_finite()).map(|value| value.clamp(0.0, 100.0).round() as u8)
}
