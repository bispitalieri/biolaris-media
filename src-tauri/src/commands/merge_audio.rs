use crate::{
  constants::CONVERSION_PROGRESS_EVENT,
  formats::{get_file_ext, is_audio_ext},
  models::{AudioFileInfo, JobUpdate, MergeAudioRequest, QueueState},
  paths::{canonical_existing_file, validate_output},
  tools::{append_stderr_tail, ffmpeg_failure_message, tool_command},
};
use serde::Deserialize;
use std::{
  fs::{self, OpenOptions},
  io::Write,
  path::{Path, PathBuf},
};
use tauri::{Emitter, State};
use tauri_plugin_shell::process::CommandEvent;
use uuid::Uuid;

const OUTPUT_FORMATS: &[&str] = &[
  "mp3", "m4a", "m4b", "aac", "wav", "aiff", "flac", "ogg", "opus", "ac3",
];

#[derive(Deserialize)]
struct ProbeOutput {
  streams: Vec<ProbeStream>,
  format: ProbeFormat,
}

#[derive(Deserialize)]
struct ProbeStream {
  codec_name: Option<String>,
  sample_rate: Option<String>,
  channels: Option<u32>,
  channel_layout: Option<String>,
  profile: Option<String>,
  duration: Option<String>,
}

#[derive(Deserialize)]
struct ProbeFormat {
  duration: Option<String>,
}

async fn probe(app: &tauri::AppHandle, path: &Path) -> Result<AudioFileInfo, String> {
  let result = tool_command(app, "ffprobe")
    .args([
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,sample_rate,channels,channel_layout,profile,duration:format=duration",
      "-of",
      "json",
    ])
    .arg(path.as_os_str())
    .output()
    .await
    .map_err(|error| format!("Avvio ffprobe non riuscito: {error}"))?;

  if !result.status.success() {
    return Err(format!(
      "Impossibile leggere l'audio di {}",
      path.file_name().and_then(|name| name.to_str()).unwrap_or("file")
    ));
  }
  let probe: ProbeOutput = serde_json::from_slice(&result.stdout)
    .map_err(|_| "Impossibile leggere i dati audio del file selezionato".to_owned())?;
  let stream = probe
    .streams
    .first()
    .ok_or("Il file selezionato non contiene una traccia audio")?;
  let codec_name = stream
    .codec_name
    .clone()
    .filter(|value| !value.is_empty())
    .ok_or("Codec audio non riconosciuto")?;
  let sample_rate = stream
    .sample_rate
    .as_deref()
    .and_then(|value| value.parse::<u32>().ok())
    .filter(|value| (1..=768_000).contains(value))
    .ok_or("Frequenza di campionamento audio non valida")?;
  let channels = stream
    .channels
    .filter(|value| (1..=64).contains(value))
    .ok_or("Numero di canali audio non valido")?;
  let duration = stream
    .duration
    .as_deref()
    .or(probe.format.duration.as_deref())
    .and_then(|value| value.parse::<f64>().ok())
    .filter(|value| value.is_finite() && *value > 0.0)
    .ok_or("Durata audio non valida")?;

  Ok(AudioFileInfo {
    codec_name,
    sample_rate,
    channels,
    channel_layout: stream.channel_layout.clone(),
    profile: stream.profile.clone(),
    duration,
  })
}

#[tauri::command]
pub(crate) async fn probe_audio_file(
  app: tauri::AppHandle,
  path: String,
) -> Result<AudioFileInfo, String> {
  let input = canonical_existing_file(&path)?;
  if !is_audio_ext(&get_file_ext(&input)) {
    return Err("Il file selezionato non è un formato audio supportato".into());
  }
  probe(&app, &input).await
}

fn normalized_format(ext: &str) -> &str {
  match ext {
    "oga" => "ogg",
    "aif" => "aiff",
    "m4r" | "alac" => "m4a",
    "adts" => "aac",
    other => other,
  }
}

fn output_path(first: &Path, requested: &str, format: &str) -> Result<PathBuf, String> {
  let parent = first.parent().ok_or("Cartella audio non valida")?;
  let default = format!(
    "{} (merged)",
    first.file_stem().and_then(|stem| stem.to_str()).unwrap_or("audio")
  );
  let name = requested.trim();
  let stem = if name.is_empty() {
    default.as_str()
  } else {
    name.strip_suffix(&format!(".{format}"))
      .or_else(|| name.strip_suffix(&format!(".{}", format.to_ascii_uppercase())))
      .unwrap_or(name)
  };
  if stem.is_empty()
    || stem.len() > 240
    || stem == "."
    || stem == ".."
    || stem.ends_with('.')
    || stem
      .chars()
      .any(|character| character.is_control() || matches!(character, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
  {
    return Err("Inserisci un nome audio valido (massimo 240 byte)".into());
  }
  let device = stem.split('.').next().unwrap_or(stem).to_ascii_uppercase();
  if matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
    || (1..=9).any(|number| device == format!("COM{number}") || device == format!("LPT{number}"))
  {
    return Err("Questo nome non può essere usato come file audio".into());
  }
  Ok(parent.join(format!("{stem}.{format}")))
}

#[tauri::command]
pub(crate) async fn enqueue_merge_audio(
  app: tauri::AppHandle,
  state: State<'_, QueueState>,
  request: MergeAudioRequest,
) -> Result<String, String> {
  if request.audio_paths.len() < 2 {
    return Err("Seleziona almeno due file audio da unire".into());
  }
  if !OUTPUT_FORMATS.contains(&request.format.as_str()) {
    return Err("Formato audio di output non valido".into());
  }
  if request.add_chapter_markers && request.format != "m4b" {
    return Err("I capitoli sono disponibili solo per il formato M4B".into());
  }

  let inputs = request
    .audio_paths
    .iter()
    .map(|path| canonical_existing_file(path))
    .collect::<Result<Vec<_>, _>>()?;
  let mut infos = Vec::with_capacity(inputs.len());
  for input in &inputs {
    if !is_audio_ext(&get_file_ext(input)) {
      return Err(format!(
        "Il file selezionato non è un formato audio supportato: {}",
        input.file_name().and_then(|name| name.to_str()).unwrap_or("file")
      ));
    }
    infos.push(probe(&app, input).await?);
  }

  let requested = output_path(&inputs[0], &request.output_name, &request.format)?;
  let output = validate_output(
    &requested.to_string_lossy(),
    &request.format,
    request.auto_rename_outputs,
  )?;
  let id = Uuid::new_v4().to_string();
  let task_id = id.clone();
  let semaphore = state.slots.clone();
  let format = request.format;
  let add_chapter_markers = request.add_chapter_markers;

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
      &inputs,
      &infos,
      &output,
      &format,
      add_chapter_markers,
    )
    .await;
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
    let _ = app.emit(CONVERSION_PROGRESS_EVENT, update);
  });
  Ok(id)
}

struct TemporaryFile(PathBuf);

impl TemporaryFile {
  fn create(prefix: &str, extension: &str, contents: &[u8]) -> Result<Self, String> {
    for _ in 0..5 {
      let path = std::env::temp_dir().join(format!(
        ".biolaris-{prefix}-{}.{}",
        Uuid::new_v4(),
        extension
      ));
      match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
          if let Err(error) = file.write_all(contents) {
            let _ = fs::remove_file(&path);
            return Err(format!("Impossibile preparare la fusione audio: {error}"));
          }
          return Ok(Self(path));
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
        Err(error) => return Err(format!("Impossibile preparare la fusione audio: {error}")),
      }
    }
    Err("Impossibile creare i file temporanei per la fusione audio".into())
  }
}

impl Drop for TemporaryFile {
  fn drop(&mut self) {
    let _ = fs::remove_file(&self.0);
  }
}

fn concat_manifest(inputs: &[PathBuf]) -> Result<Vec<u8>, String> {
  let mut manifest = String::from("ffconcat version 1.0\n");
  for input in inputs {
    let path = input
      .to_str()
      .ok_or("Un percorso audio non è rappresentabile come testo")?;
    if path.chars().any(char::is_control) {
      return Err("Un percorso audio contiene caratteri non supportati per la fusione senza ricodifica".into());
    }
    let escaped = path.replace('\'', "'\\''");
    manifest.push_str(&format!("file '{escaped}'\n"));
  }
  Ok(manifest.into_bytes())
}

fn metadata_escape(value: &str) -> String {
  let mut escaped = String::with_capacity(value.len());
  for character in value.chars() {
    match character {
      '\\' => escaped.push_str("\\\\"),
      '=' => escaped.push_str("\\="),
      ';' => escaped.push_str("\\;"),
      '#' => escaped.push_str("\\#"),
      '\n' => escaped.push_str("\\n"),
      '\r' => escaped.push_str("\\r"),
      character if character.is_control() => escaped.push(' '),
      _ => escaped.push(character),
    }
  }
  escaped
}

fn chapter_metadata(inputs: &[PathBuf], infos: &[AudioFileInfo]) -> Result<Vec<u8>, String> {
  let mut metadata = String::from(";FFMETADATA1\n");
  let mut start = 0u64;
  for (input, info) in inputs.iter().zip(infos) {
    let duration = (info.duration * 1000.0).round() as u64;
    let end = start.saturating_add(duration.max(1));
    let title = input
      .file_stem()
      .and_then(|stem| stem.to_str())
      .ok_or("Nome di un capitolo audio non valido")?;
    metadata.push_str(&format!(
      "[CHAPTER]\nTIMEBASE=1/1000\nSTART={start}\nEND={end}\ntitle={}\n",
      metadata_escape(title)
    ));
    start = end;
  }
  Ok(metadata.into_bytes())
}

fn can_copy_streams(
  inputs: &[PathBuf],
  infos: &[AudioFileInfo],
  output_format: &str,
) -> bool {
  let Some(first) = infos.first() else {
    return false;
  };
  let first_ext = get_file_ext(&inputs[0]);
  let first_format = normalized_format(&first_ext);
  first_format == output_format
    && inputs
      .iter()
      .all(|input| normalized_format(&get_file_ext(input)) == output_format)
    && infos.iter().all(|info| {
      info.codec_name == first.codec_name
        && info.sample_rate == first.sample_rate
        && info.channels == first.channels
        && info.channel_layout == first.channel_layout
        && info.profile == first.profile
    })
}

fn append_codec_args(args: &mut Vec<String>, format: &str) {
  let codec: &[&str] = match format {
    "mp3" => &["-c:a", "libmp3lame", "-q:a", "2"],
    "m4a" | "m4b" => &["-c:a", "aac", "-b:a", "192k"],
    "aac" => &["-c:a", "aac", "-b:a", "192k"],
    "wav" => &["-c:a", "pcm_s16le"],
    "aiff" => &["-c:a", "pcm_s16be"],
    "flac" => &["-c:a", "flac"],
    "ogg" => &["-c:a", "libvorbis", "-q:a", "5"],
    "opus" => &["-c:a", "libopus", "-b:a", "160k"],
    "ac3" => &["-c:a", "ac3", "-b:a", "192k"],
    _ => &[],
  };
  args.extend(codec.iter().map(|value| (*value).to_owned()));
}

async fn run(
  app: &tauri::AppHandle,
  id: &str,
  inputs: &[PathBuf],
  infos: &[AudioFileInfo],
  output: &Path,
  format: &str,
  add_chapter_markers: bool,
) -> Result<(), String> {
  let total_duration = infos.iter().map(|info| info.duration).sum::<f64>();
  let copy_streams = can_copy_streams(inputs, infos, format);
  let manifest = if copy_streams {
    Some(TemporaryFile::create(
      "merge",
      "ffconcat",
      &concat_manifest(inputs)?,
    )?)
  } else {
    None
  };
  let mut args = vec!["-hide_banner".to_owned(), "-n".to_owned()];
  if copy_streams {
    let manifest = manifest
      .as_ref()
      .ok_or("Impossibile preparare la lista dei file audio")?;
    args.extend([
      "-f".into(),
      "concat".into(),
      "-safe".into(),
      "0".into(),
      "-i".into(),
      manifest.0.to_string_lossy().into_owned(),
    ]);
  } else {
    for input in inputs {
      args.extend(["-i".into(), input.to_string_lossy().into_owned()]);
    }
  }
  let chapter_file = if add_chapter_markers {
    let chapter_file = TemporaryFile::create(
      "chapters",
      "ffmeta",
      &chapter_metadata(inputs, infos)?,
    )?;
    args.extend([
      "-i".into(),
      chapter_file.0.to_string_lossy().into_owned(),
    ]);
    Some(chapter_file)
  } else {
    None
  };

  if copy_streams {
    args.extend(["-map".into(), "0:a:0".into(), "-c:a".into(), "copy".into()]);
  } else {
    let maximum_input_rate = infos
      .iter()
      .map(|info| info.sample_rate)
      .max()
      .unwrap_or(48_000)
      .min(match format {
        "mp3" | "opus" | "ac3" => 48_000,
        "m4a" | "m4b" | "aac" => 96_000,
        _ => 192_000,
      });
    let sample_rate = [
      8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 88_200,
      96_000, 176_400, 192_000,
    ]
    .into_iter()
    .filter(|rate| *rate <= maximum_input_rate)
    .max()
    .unwrap_or(8_000);
    let channel_layout = if infos.iter().all(|info| info.channels == 1) {
      "mono"
    } else {
      "stereo"
    };
    let mut filters = Vec::with_capacity(inputs.len() + 1);
    let mut concat_inputs = String::new();
    for (index, _) in inputs.iter().enumerate() {
      filters.push(format!(
        "[{index}:a:0]aresample={sample_rate},aformat=sample_fmts=fltp:channel_layouts={channel_layout},asetpts=PTS-STARTPTS[a{index}]"
      ));
      concat_inputs.push_str(&format!("[a{index}]"));
    }
    filters.push(format!(
      "{concat_inputs}concat=n={}:v=0:a=1[outa]",
      inputs.len()
    ));
    args.extend([
      "-filter_complex".into(),
      filters.join(";"),
      "-map".into(),
      "[outa]".into(),
    ]);
    append_codec_args(&mut args, format);
  }

  if chapter_file.is_some() {
    let metadata_input = if copy_streams {
      "1".to_owned()
    } else {
      inputs.len().to_string()
    };
    args.extend([
      "-map_metadata".into(),
      metadata_input.clone(),
      "-map_chapters".into(),
      metadata_input,
    ]);
  } else {
    args.extend(["-map_chapters".into(), "-1".into()]);
  }

  let temporary = output.with_file_name(format!(".biolaris-merge-{}.{}", Uuid::new_v4(), format));
  args.extend([
    "-progress".into(),
    "pipe:1".into(),
    "-nostats".into(),
    temporary.to_string_lossy().into_owned(),
  ]);
  let cleanup = TemporaryFile(temporary);
  let _chapter_file = chapter_file;
  let (mut events, _child) = tool_command(app, "ffmpeg")
    .args(args)
    .spawn()
    .map_err(|error| format!("Avvio ffmpeg non riuscito: {error}"))?;
  let mut exit = None;
  let mut stderr = Vec::new();
  let mut pending = Vec::new();
  let mut last_progress = 0;
  while let Some(event) = events.recv().await {
    match event {
      CommandEvent::Stdout(bytes) => {
        pending.extend_from_slice(&bytes);
        while let Some(position) = pending.iter().position(|byte| *byte == b'\n') {
          let line: Vec<u8> = pending.drain(..=position).collect();
          if let Some(microseconds) = String::from_utf8_lossy(&line)
            .trim()
            .strip_prefix("out_time_us=")
            .and_then(|value| value.parse::<u64>().ok())
          {
            let progress = ((microseconds as f64 / (total_duration * 1_000_000.0))
              .clamp(0.0, 0.99)
              * 100.0)
              .round() as u8;
            if progress > last_progress {
              last_progress = progress;
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
          }
        }
      }
      CommandEvent::Stderr(bytes) => append_stderr_tail(&mut stderr, &bytes),
      CommandEvent::Terminated(payload) => exit = payload.code,
      CommandEvent::Error(error) => append_stderr_tail(&mut stderr, error.as_bytes()),
      _ => {}
    }
  }
  if exit != Some(0) {
    return Err(ffmpeg_failure_message(exit, &stderr));
  }
  fs::hard_link(&cleanup.0, output).map_err(|error| {
    if error.kind() == std::io::ErrorKind::AlreadyExists {
      "Il file di destinazione esiste già".into()
    } else {
      format!("Salvataggio dell'audio non riuscito: {error}")
    }
  })?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn audio_info() -> AudioFileInfo {
    AudioFileInfo {
      codec_name: "aac".into(),
      sample_rate: 44_100,
      channels: 2,
      channel_layout: Some("stereo".into()),
      profile: Some("LC".into()),
      duration: 1.25,
    }
  }

  #[test]
  fn concat_manifest_escapes_quotes_in_paths() {
    let input = PathBuf::from("Chapter 'One'.m4a");
    let manifest = concat_manifest(&[input]).expect("manifest should be valid UTF-8");
    assert_eq!(
      String::from_utf8(manifest).expect("manifest should be valid UTF-8"),
      "ffconcat version 1.0\nfile 'Chapter '\\''One'\\''.m4a'\n"
    );
  }

  #[test]
  fn chapter_metadata_escapes_metadata_syntax() {
    let input = PathBuf::from("Chapter =;#\\ One.m4a");
    let metadata = chapter_metadata(&[input], &[audio_info()]).expect("chapter name should be valid");
    let metadata = String::from_utf8(metadata).expect("metadata should be valid UTF-8");
    assert!(metadata.contains(r"title=Chapter \=\;\#\\ One"));
    assert!(metadata.contains("START=0\nEND=1250"));
  }

  #[test]
  fn stream_copy_requires_matching_format_and_audio_parameters() {
    let inputs = vec![PathBuf::from("one.m4b"), PathBuf::from("two.m4b")];
    let infos = vec![audio_info(), audio_info()];
    assert!(can_copy_streams(&inputs, &infos, "m4b"));
    assert!(!can_copy_streams(&inputs, &infos, "m4a"));

    let mut different_rate = audio_info();
    different_rate.sample_rate = 48_000;
    assert!(!can_copy_streams(
      &inputs,
      &[audio_info(), different_rate],
      "m4b"
    ));
  }
}
