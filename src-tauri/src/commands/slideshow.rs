use crate::{
  constants::CONVERSION_PROGRESS_EVENT,
  formats::{get_file_ext, is_ffmpeg_image_ext, is_image_ext},
  images::run_convert_image_magick,
  models::{JobUpdate, QueueState, SlideshowRequest},
  paths::{canonical_existing_file, validate_output_with_suffix},
  tools::{append_stderr_tail, ffmpeg_failure_message, tool_command},
};
use std::path::{Path, PathBuf};
use tauri::{Emitter, State};
use tauri_plugin_shell::process::CommandEvent;
use uuid::Uuid;

pub(crate) fn slideshow_dimensions(resolution: &str) -> Result<Option<(u32, u32)>, String> {
  match resolution {
    "720p" => Ok(Some((1280, 720))),
    "1080p" => Ok(Some((1920, 1080))),
    "4k" => Ok(Some((3840, 2160))),
    "match-image" => Ok(None),
    _ => Err("Risoluzione slideshow non valida".into()),
  }
}

pub(crate) fn slideshow_output_path(
  first_image: &Path,
  requested_name: &str,
) -> Result<PathBuf, String> {
  let parent = first_image.parent().ok_or("Cartella immagine non valida")?;
  let requested_name = requested_name.trim();
  let generated_name = if requested_name.is_empty() {
    format!(
      "{}-slideshow",
      first_image
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("slideshow")
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
    character.is_control()
      || matches!(
                character,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            )
  }) || name.ends_with('.')
  {
    return Err("Il nome del video contiene caratteri non validi".into());
  }

  let windows_device_name = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
  if matches!(windows_device_name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
    || (1..=9).any(|number| {
    windows_device_name == format!("COM{number}")
      || windows_device_name == format!("LPT{number}")
  })
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

pub(crate) fn publish_slideshow_file(temporary: &Path, output: &Path) -> Result<(), String> {
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
        .map_err(|error| {
          format!("Creazione del video di destinazione non riuscita: {error}")
        })?;
      if let Err(error) =
        std::io::copy(&mut source, &mut destination).and_then(|_| destination.sync_all())
      {
        let _ = std::fs::remove_file(output);
        return Err(format!("Scrittura del video non riuscita: {error}"));
      }
      Ok(())
    }
  }
}

#[tauri::command]
pub(crate) async fn enqueue_slideshow(
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
    return Err(
      "La durata di ogni immagine deve essere da 1 a 30 secondi, a incrementi di 0,5".into(),
    );
  }
  let dimensions = slideshow_dimensions(&request.resolution)?;
  let inputs = request
    .image_paths
    .iter()
    .map(|path| canonical_existing_file(path))
    .collect::<Result<Vec<_>, _>>()?;
  for input in &inputs {
    if !is_image_ext(&get_file_ext(input)) {
      let filename = input
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("immagine");
      return Err(format!(
        "Il file selezionato non è un'immagine supportata: {filename}"
      ));
    }
  }
  let first_input = inputs
    .first()
    .ok_or("Seleziona almeno un'immagine per creare lo slideshow")?;
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
      CONVERSION_PROGRESS_EVENT,
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
    )
      .await;
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

pub(crate) async fn probe_image_dimensions(
  app: &tauri::AppHandle,
  input: &Path,
) -> Result<(u32, u32), String> {
  let output = tool_command(app, "ffprobe")
    .args([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=s=x:p=0",
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
  let (width, height) = dimensions
    .trim()
    .split_once('x')
    .ok_or("Dimensioni della prima immagine non valide")?;
  let width = width
    .parse::<u32>()
    .map_err(|_| "Larghezza immagine non valida")?;
  let height = height
    .parse::<u32>()
    .map_err(|_| "Altezza immagine non valida")?;
  if width < 2 || height < 2 || width > 16_384 || height > 16_384 {
    return Err("Le dimensioni della prima immagine non sono supportate".into());
  }
  // H.264 with yuv420p requires even dimensions.
  Ok((
    width.saturating_add(width % 2),
    height.saturating_add(height % 2),
  ))
}

pub(crate) async fn run_slideshow(
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
    let temp_dir = temporary_directory
      .as_ref()
      .ok_or("Cartella temporanea non disponibile")?;
    let converted = temp_dir.0.join(format!("slide-{index}.png"));
    run_convert_image_magick(app, input, &converted, "png", 100, true).await?;
    slideshow_inputs.push(converted);
  }

  let (width, height) = match requested_dimensions {
    Some(dimensions) => dimensions,
    None => {
      probe_image_dimensions(
        app,
        slideshow_inputs
          .first()
          .ok_or("Seleziona almeno un'immagine")?,
      )
        .await?
    }
  };
  let mut args = vec!["-hide_banner".to_owned(), "-n".to_owned()];
  let slide_duration = format!("{seconds_per_slide:.1}");
  for input in &slideshow_inputs {
    args.extend([
      "-f".into(),
      "image2".into(),
      "-loop".into(),
      "1".into(),
      "-pattern_type".into(),
      "none".into(),
      "-framerate".into(),
      "30".into(),
      "-t".into(),
      slide_duration.clone(),
      "-i".into(),
      input.to_string_lossy().into_owned(),
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
  filters.push(format!(
    "{concat_inputs}concat=n={}:v=1:a=0[outv]",
    slideshow_inputs.len()
  ));
  let filter_graph = filters.join(";");
  let total_duration = seconds_per_slide * slideshow_inputs.len() as f64;
  let temporary_output =
    TemporaryFile(output.with_file_name(format!(".biolaris-slideshow-{}.mp4", Uuid::new_v4())));
  args.extend([
    "-filter_complex".into(),
    filter_graph,
    "-map".into(),
    "[outv]".into(),
    "-r".into(),
    "30".into(),
    "-t".into(),
    format!("{total_duration:.1}"),
    "-c:v".into(),
    "libx264".into(),
    "-preset".into(),
    "medium".into(),
    "-crf".into(),
    "18".into(),
    "-pix_fmt".into(),
    "yuv420p".into(),
    "-movflags".into(),
    "+faststart".into(),
    "-progress".into(),
    "pipe:1".into(),
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
          if let Some(microseconds) = value
            .trim()
            .strip_prefix("out_time_us=")
            .and_then(|time| time.parse::<u64>().ok())
          {
            let ratio =
              (microseconds as f64 / (total_duration * 1_000_000.0)).clamp(0.0, 0.99);
            let progress = (ratio * 100.0).round() as u8;
            if progress > last_progress {
              last_progress = progress;
              let _ = app.emit(
                CONVERSION_PROGRESS_EVENT,
                JobUpdate {
                  id: id.to_owned(),
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
