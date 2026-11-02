use crate::{
  constants::CONVERSION_PROGRESS_EVENT,
  formats::{get_file_ext, is_audio_ext, is_video_ext},
  models::{ChapterFileInfo, ChapterInfo, JobUpdate, QueueState, SplitByChapterRequest},
  paths::canonical_existing_file,
  tools::{append_stderr_tail, ffmpeg_failure_message, tool_command},
};
use serde_json::Value;
use std::{
  collections::HashSet,
  path::{Path, PathBuf},
};
use tauri::{Emitter, State};
use tauri_plugin_shell::process::CommandEvent;
use uuid::Uuid;

const AUDIO_FORMATS: &[&str] = &["mp3", "m4a", "wav", "flac", "ogg", "aac", "opus"];
const VIDEO_FORMATS: &[&str] = &["mp4", "mkv", "mov", "webm", "avi"];
const MAX_CHAPTERS: usize = 10_000;

fn parse_probe_result(document: &Value, original_format: String) -> Result<ChapterFileInfo, String> {
  let streams = document["streams"].as_array().ok_or_else(|| {
    "Impossibile leggere le tracce audio o video del file".to_string()
  })?;
  let has_audio = streams
    .iter()
    .any(|stream| stream["codec_type"].as_str() == Some("audio"));
  let has_video = streams.iter().any(|stream| {
    stream["codec_type"].as_str() == Some("video")
      && stream["disposition"]["attached_pic"].as_i64() != Some(1)
  });
  if !has_audio && !has_video {
    return Err("Il file non contiene una traccia audio o video supportata".into());
  }

  let raw_chapters = document["chapters"]
    .as_array()
    .ok_or_else(|| "Nessun capitolo trovato nel file selezionato".to_string())?;
  if raw_chapters.is_empty() {
    return Err("Nessun capitolo trovato nel file selezionato".into());
  }
  if raw_chapters.len() > MAX_CHAPTERS {
    return Err(format!("Il file supera il limite di {MAX_CHAPTERS} capitoli"));
  }
  let mut chapters = Vec::with_capacity(raw_chapters.len());
  for (index, chapter) in raw_chapters.iter().enumerate() {
    let start = chapter["start_time"]
      .as_str()
      .and_then(|value| value.parse::<f64>().ok())
      .filter(|value| value.is_finite() && *value >= 0.0)
      .ok_or_else(|| format!("Inizio non valido per il capitolo {}", index + 1))?;
    let end = chapter["end_time"]
      .as_str()
      .and_then(|value| value.parse::<f64>().ok())
      .filter(|value| value.is_finite() && *value > start)
      .ok_or_else(|| format!("Fine non valida per il capitolo {}", index + 1))?;
    let title = chapter["tags"]["title"]
      .as_str()
      .filter(|value| !value.trim().is_empty())
      .map(str::to_owned)
      .unwrap_or_else(|| format!("Chapter {}", index + 1));
    chapters.push(ChapterInfo { title, start, end });
  }
  Ok(ChapterFileInfo {
    chapters,
    has_audio,
    has_video,
    original_format,
  })
}

fn validate_format(info: &ChapterFileInfo, format: &str) -> Result<(), String> {
  if format == "original" {
    return if info.original_format.is_empty() {
      Err("Il file originale non ha un'estensione utilizzabile".into())
    } else {
      Ok(())
    };
  }
  if (info.has_video && VIDEO_FORMATS.contains(&format))
    || (!info.has_video && AUDIO_FORMATS.contains(&format))
  {
    Ok(())
  } else {
    Err("Formato di output non valido per questo file".into())
  }
}

async fn inspect(app: &tauri::AppHandle, input: &Path) -> Result<ChapterFileInfo, String> {
  let result = tool_command(app, "ffprobe")
    .args([
      "-v",
      "error",
      "-show_streams",
      "-show_chapters",
      "-show_entries",
      "stream=codec_type:stream_disposition=attached_pic:chapter=start_time,end_time:chapter_tags=title",
      "-of",
      "json",
    ])
    .arg(input.as_os_str())
    .output()
    .await
    .map_err(|error| format!("Avvio ffprobe non riuscito: {error}"))?;
  if !result.status.success() {
    return Err(format!(
      "Impossibile leggere il file {}",
      input.file_name().and_then(|name| name.to_str()).unwrap_or("selezionato")
    ));
  }
  let document: Value = serde_json::from_slice(&result.stdout)
    .map_err(|_| "ffprobe ha restituito informazioni non valide".to_string())?;
  parse_probe_result(&document, get_file_ext(input))
}

#[tauri::command]
pub(crate) async fn probe_chapters(
  app: tauri::AppHandle,
  path: String,
) -> Result<ChapterFileInfo, String> {
  let input = canonical_existing_file(&path)?;
  let extension = get_file_ext(&input);
  if !is_audio_ext(&extension) && !is_video_ext(&extension) {
    return Err("Scegli un file audio o video supportato".into());
  }
  inspect(&app, &input).await
}

#[tauri::command]
pub(crate) async fn enqueue_split_by_chapter(
  app: tauri::AppHandle,
  state: State<'_, QueueState>,
  request: SplitByChapterRequest,
) -> Result<String, String> {
  let input = canonical_existing_file(&request.input_path)?;
  let extension = get_file_ext(&input);
  if !is_audio_ext(&extension) && !is_video_ext(&extension) {
    return Err("Scegli un file audio o video supportato".into());
  }
  let info = inspect(&app, &input).await?;
  let format = request.format.to_ascii_lowercase();
  validate_format(&info, &format)?;

  let id = Uuid::new_v4().to_string();
  let task_id = id.clone();
  let semaphore = state.slots.clone();
  let auto_rename_outputs = request.auto_rename_outputs;
  tauri::async_runtime::spawn(async move {
    let Ok(_permit) = semaphore.acquire_owned().await else {
      return;
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
    let result = run(
      &app,
      &task_id,
      &input,
      &info,
      &format,
      auto_rename_outputs,
    )
    .await;
    let update = match result {
      Ok(directory) => JobUpdate {
        id: task_id,
        status: "completed".into(),
        progress: 100,
        output_path: Some(directory.to_string_lossy().into_owned()),
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
    let _ = app.emit(CONVERSION_PROGRESS_EVENT, update);
  });
  Ok(id)
}

fn safe_title(title: &str, fallback: &str) -> String {
  let mut clean = String::new();
  for character in title.trim().chars() {
    let character = if character.is_control() || matches!(character, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
      '_'
    } else {
      character
    };
    if clean.len() + character.len_utf8() > 120 {
      break;
    }
    clean.push(character);
  }
  let clean = clean
    .trim()
    .trim_start_matches('.')
    .trim_end_matches('.')
    .trim()
    .to_owned();
  let stem = if clean.is_empty() { fallback } else { &clean };
  let device = stem.split('.').next().unwrap_or(stem).to_ascii_uppercase();
  if matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
    || (1..=9).any(|number| device == format!("COM{number}") || device == format!("LPT{number}"))
  {
    format!("_{stem}")
  } else {
    stem.to_owned()
  }
}

fn chapter_output_paths(
  input: &Path,
  chapters: &[ChapterInfo],
  format: &str,
  auto_rename_outputs: bool,
) -> Result<Vec<PathBuf>, String> {
  let parent = input.parent().ok_or("Cartella del file non valida")?;
  let base = safe_title(
    input.file_stem().and_then(|stem| stem.to_str()).unwrap_or("media"),
    "media",
  );
  let mut planned = HashSet::new();
  let mut outputs = Vec::with_capacity(chapters.len());
  for (index, chapter) in chapters.iter().enumerate() {
    let title = safe_title(&chapter.title, &format!("Chapter {}", index + 1));
    let stem = format!("{base} - {:02} - {title}", index + 1);
    let mut suffix = 0u64;
    loop {
      let suffix_text = if suffix == 0 { String::new() } else { format!("_{suffix}") };
      let candidate = parent.join(format!("{stem}{suffix_text}.{format}"));
      let key = candidate
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_lowercase();
      let exists = match std::fs::symlink_metadata(&candidate) {
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(format!("Percorso output non accessibile: {error}")),
      };
      if !exists && !planned.contains(&key) {
        planned.insert(key);
        outputs.push(candidate);
        break;
      }
      if !auto_rename_outputs {
        return Err("Il file di destinazione esiste già".into());
      }
      suffix = suffix.saturating_add(1);
    }
  }
  Ok(outputs)
}

fn append_audio_video_stream_maps(args: &mut Vec<String>) {
  args.extend([
    "-map".into(),
    "0:v?".into(),
    "-map".into(),
    "0:a?".into(),
  ]);
}

async fn run(
  app: &tauri::AppHandle,
  id: &str,
  input: &Path,
  info: &ChapterFileInfo,
  format: &str,
  auto_rename_outputs: bool,
) -> Result<PathBuf, String> {
  let extension = if format == "original" {
    info.original_format.as_str()
  } else {
    format
  };
  let outputs = chapter_output_paths(input, &info.chapters, extension, auto_rename_outputs)?;
  for (index, (chapter, output)) in info.chapters.iter().zip(&outputs).enumerate() {
    let temporary = output.with_file_name(format!(
      ".biolaris-split-{}.{}",
      Uuid::new_v4(),
      extension
    ));
    let args = vec![
      "-hide_banner".into(),
      "-n".into(),
      "-ss".into(),
      format!("{:.6}", chapter.start),
      "-i".into(),
    ];
    let mut after_input = vec![
      "-t".into(),
      format!("{:.6}", chapter.end - chapter.start),
    ];
    if format == "original" {
      append_audio_video_stream_maps(&mut after_input);
      after_input.extend([
        "-map_metadata".into(),
        "0".into(),
        "-c".into(),
        "copy".into(),
      ]);
    } else if info.has_video {
      after_input.extend([
        "-map".into(),
        "0:v?".into(),
        "-map".into(),
        "0:a?".into(),
      ]);
      match format {
        "webm" => after_input.extend([
          "-c:v".into(),
          "libvpx-vp9".into(),
          "-c:a".into(),
          "libopus".into(),
        ]),
        "avi" => after_input.extend([
          "-c:v".into(),
          "libx264".into(),
          "-c:a".into(),
          "mp3".into(),
        ]),
        _ => after_input.extend([
          "-c:v".into(),
          "libx264".into(),
          "-c:a".into(),
          "aac".into(),
        ]),
      }
      after_input.extend(["-map_metadata".into(), "0".into()]);
    } else {
      after_input.extend([
        "-map".into(),
        "0:a?".into(),
        "-vn".into(),
        "-map_metadata".into(),
        "0".into(),
      ]);
      match format {
        "mp3" => after_input.extend(["-c:a".into(), "libmp3lame".into()]),
        "m4a" | "aac" => after_input.extend(["-c:a".into(), "aac".into()]),
        "wav" => after_input.extend(["-c:a".into(), "pcm_s16le".into()]),
        "flac" => after_input.extend(["-c:a".into(), "flac".into()]),
        "ogg" => after_input.extend(["-c:a".into(), "libvorbis".into()]),
        "opus" => after_input.extend(["-c:a".into(), "libopus".into()]),
        _ => return Err("Formato audio non supportato".into()),
      }
    }
    let metadata_title = chapter
      .title
      .chars()
      .map(|character| if character.is_control() { ' ' } else { character })
      .collect::<String>();
    after_input.extend([
      "-map_chapters".into(),
      "-1".into(),
      "-metadata".into(),
      format!("title={metadata_title}"),
    ]);

    let command = tool_command(app, "ffmpeg")
      .args(args)
      .arg(input.as_os_str())
      .args(after_input)
      .arg(temporary.as_os_str());
    let (mut events, _child) = command
      .spawn()
      .map_err(|error| format!("Avvio ffmpeg non riuscito: {error}"))?;
    let mut exit = None;
    let mut stderr = Vec::new();
    while let Some(event) = events.recv().await {
      match event {
        CommandEvent::Stderr(bytes) => append_stderr_tail(&mut stderr, &bytes),
        CommandEvent::Terminated(payload) => exit = payload.code,
        CommandEvent::Error(error) => append_stderr_tail(&mut stderr, error.as_bytes()),
        _ => {}
      }
    }
    if exit != Some(0) {
      let _ = std::fs::remove_file(&temporary);
      return Err(ffmpeg_failure_message(exit, &stderr));
    }
    if let Err(error) = std::fs::hard_link(&temporary, output) {
      let _ = std::fs::remove_file(&temporary);
      return Err(if error.kind() == std::io::ErrorKind::AlreadyExists {
        "Un file di destinazione esiste già".into()
      } else {
        format!("Salvataggio del capitolo non riuscito: {error}")
      });
    }
    let _ = std::fs::remove_file(&temporary);
    let progress = (((index + 1) as f64 / outputs.len() as f64) * 99.0).round() as u8;
    let _ = app.emit(
      CONVERSION_PROGRESS_EVENT,
      JobUpdate {
        id: id.into(),
        status: "running".into(),
        progress,
        output_path: None,
        error: None,
      },
    );
  }
  input
    .parent()
    .map(Path::to_path_buf)
    .ok_or_else(|| "Cartella del file non valida".to_string())
}

#[cfg(test)]
mod tests {
  use super::{
    append_audio_video_stream_maps, chapter_output_paths, parse_probe_result, safe_title,
    validate_format,
  };
  use crate::models::{ChapterFileInfo, ChapterInfo};
  use std::path::Path;
  use uuid::Uuid;

  #[test]
  fn reads_chapter_titles_and_reports_files_without_chapters() {
    let document = serde_json::json!({
      "streams": [{"codec_type": "audio"}],
      "chapters": [
        {"start_time": "0.000", "end_time": "12.5", "tags": {"title": "Intro"}},
        {"start_time": "12.5", "end_time": "30.0"}
      ]
    });
    let parsed = parse_probe_result(&document, "m4b".into());
    assert!(parsed.is_ok());
    if let Ok(parsed) = parsed {
      assert_eq!(parsed.chapters[0].title, "Intro");
      assert_eq!(parsed.chapters[1].title, "Chapter 2");
      assert_eq!(parsed.chapters[1].start, 12.5);
      assert!(!parsed.has_video);
    }

    let no_chapters = serde_json::json!({"streams": [{"codec_type": "audio"}], "chapters": []});
    assert_eq!(
      parse_probe_result(&no_chapters, "m4b".into()).err().as_deref(),
      Some("Nessun capitolo trovato nel file selezionato")
    );
  }

  #[test]
  fn validates_output_format_against_media_streams() {
    let audio = ChapterFileInfo {
      chapters: Vec::new(),
      has_audio: true,
      has_video: false,
      original_format: "m4b".into(),
    };
    let video = ChapterFileInfo {
      has_video: true,
      ..audio.clone()
    };
    assert!(validate_format(&audio, "flac").is_ok());
    assert!(validate_format(&audio, "mp4").is_err());
    assert!(validate_format(&video, "mp4").is_ok());
    assert!(validate_format(&video, "mp3").is_err());
    assert!(validate_format(&audio, "original").is_ok());
  }

  #[test]
  fn original_output_maps_audio_and_video_but_not_data_or_subtitle_streams() {
    let mut args = Vec::new();
    append_audio_video_stream_maps(&mut args);

    assert_eq!(args, ["-map", "0:v?", "-map", "0:a?"]);
    assert!(!args.iter().any(|arg| arg == "0"));
  }

  #[test]
  fn sanitizes_chapter_titles_for_file_names() {
    assert_eq!(safe_title("../A:B?\n", "fallback"), "_A_B_");
    assert_eq!(safe_title("CON", "fallback"), "_CON");
    assert_eq!(safe_title("   ", "Chapter 1"), "Chapter 1");
  }

  #[test]
  fn output_names_keep_titles_and_chapter_order() {
    let chapters = vec![
      ChapterInfo { title: "Opening".into(), start: 0.0, end: 10.0 },
      ChapterInfo { title: "The End".into(), start: 10.0, end: 20.0 },
    ];
    let parent = std::env::current_dir();
    assert!(parent.is_ok());
    let Ok(parent) = parent else { return; };
    let basename = format!("Book-{}.m4b", Uuid::new_v4());
    let paths = chapter_output_paths(&parent.join(&basename), &chapters, "m4b", true);
    assert!(paths.is_ok());
    if let Ok(paths) = paths {
      let base = basename.trim_end_matches(".m4b");
      assert_eq!(paths[0].file_name(), Path::new(&format!("{base} - 01 - Opening.m4b")).file_name());
      assert_eq!(paths[1].file_name(), Path::new(&format!("{base} - 02 - The End.m4b")).file_name());
    }
  }
}
