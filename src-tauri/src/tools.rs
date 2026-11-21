use crate::constants::MAX_STDERR_BYTES;
use std::{
  ffi::{OsStr, OsString},
  fs,
  path::{Path, PathBuf},
};
use tauri::Manager;
use tauri_plugin_shell::{process::Command, ShellExt};

pub(crate) fn binary_target_triple() -> Option<&'static str> {
  match (std::env::consts::OS, std::env::consts::ARCH) {
    ("windows", "x86_64") => Some("x86_64-pc-windows-msvc"),
    ("macos", "x86_64") => Some("x86_64-apple-darwin"),
    ("macos", "aarch64") => Some("aarch64-apple-darwin"),
    ("linux", "x86_64") => Some("x86_64-unknown-linux-gnu"),
    ("linux", "aarch64") => Some("aarch64-unknown-linux-gnu"),
    _ => None,
  }
}

pub(crate) fn bundled_tool_prefix(app: &tauri::AppHandle) -> Option<PathBuf> {
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

fn aliased_tool(name: &str) -> Option<&'static str> {
  match name {
    "ffprobe" => Some("ffmpeg"),
    "convert" => Some("magick"),
    "pdfunite" => Some("pdftoppm"),
    _ => None,
  }
}

fn runtime_alias_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let target =
    binary_target_triple().ok_or(crate::t!("tools.platform_unsupported"))?;
  app
    .path()
    .app_cache_dir()
    .map(|path| path.join("runtime-aliases").join(target).join("bin"))
    .map_err(|error| crate::t!("tools.cache_not_found", error = error.to_string()))
}

fn ensure_runtime_alias(source: &Path, alias: &Path) -> Result<(), String> {
  if let Ok(existing) = fs::read_link(alias) {
    if existing == source {
      return Ok(());
    }
  } else if let (Ok(source_metadata), Ok(alias_metadata)) =
    (fs::metadata(source), fs::metadata(alias))
  {
    if source_metadata.len() == alias_metadata.len()
      && source_metadata.modified().ok() == alias_metadata.modified().ok()
    {
      return Ok(());
    }
  }

  match fs::remove_file(alias) {
    Ok(()) => {}
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
    Err(error) => {
      return Err(crate::t!("tools.alias_replace_failed", alias = alias.display().to_string(), error = error.to_string()))
    }
  }
  fs::create_dir_all(alias.parent().ok_or(crate::t!("tools.alias_path_invalid"))?)
    .map_err(|error| crate::t!("tools.alias_dir_create_failed", error = error.to_string()))?;

  #[cfg(unix)]
  std::os::unix::fs::symlink(source, alias).map_err(|error| {
    crate::t!("tools.alias_create_failed", alias = alias.display().to_string(), error = error.to_string())
  })?;

  #[cfg(windows)]
  {
    if std::os::windows::fs::symlink_file(source, alias).is_err() {
      fs::hard_link(source, alias)
        .or_else(|_| fs::copy(source, alias).map(|_| ()))
        .map_err(|error| {
          crate::t!("tools.alias_create_failed", alias = alias.display().to_string(), error = error.to_string())
        })?;
    }
  }

  Ok(())
}

pub(crate) fn prepare_runtime_aliases(app: &tauri::AppHandle) -> Result<(), String> {
  let Some(prefix) = bundled_tool_prefix(app) else {
    return Ok(());
  };
  let bin_dir = prefix.join("bin");
  let extension = if cfg!(target_os = "windows") {
    ".exe"
  } else {
    ""
  };
  let alias_dir = runtime_alias_dir(app)?;

  for alias_name in ["ffprobe", "convert", "pdfunite"] {
    let alias_file = format!("{alias_name}{extension}");
    if bin_dir.join(&alias_file).is_file() {
      continue;
    }
    let Some(executable_name) = aliased_tool(alias_name) else {
      continue;
    };
    let executable = bin_dir.join(format!("{executable_name}{extension}"));
    if executable.is_file() {
      ensure_runtime_alias(&executable, &alias_dir.join(alias_file))?;
    }
  }

  Ok(())
}

pub(crate) fn prepend_search_paths(prefix_paths: &[PathBuf], variable: &str) -> Option<OsString> {
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

pub(crate) fn tool_command(app: &tauri::AppHandle, name: &str) -> Command {
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
    let executable = executable_dirs
      .iter()
      .map(|directory| directory.join(&executable_name))
      .find(|path| path.is_file())
      .or_else(|| {
        aliased_tool(name).and_then(|_| {
          runtime_alias_dir(app)
            .ok()
            .map(|directory| directory.join(&executable_name))
            .filter(|path| path.is_file())
        })
      });
    if let Some(executable) = executable {
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
  tracing::warn!(
    "Bundled runtime tool '{}' not found, falling back to global command. \
     This is expected in development but may fail in production if the tool is not installed.",
    name
  );
  app.shell().command(OsStr::new(name))
}

pub(crate) fn append_stderr_tail(stderr: &mut Vec<u8>, chunk: &[u8]) {
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

pub(crate) fn ffmpeg_failure_message(exit_code: Option<i32>, stderr: &[u8]) -> String {
  let code = exit_code
    .map(|code| code.to_string())
    .unwrap_or_else(|| crate::t!("tools.ffmpeg_unknown_code"));
  let details = String::from_utf8_lossy(stderr).trim().to_owned();
  if details.is_empty() {
    crate::t!("tools.ffmpeg_exit_code", code = code)
  } else {
    crate::t!("tools.ffmpeg_exit_code_details", code = code, details = details)
  }
}

#[cfg(test)]
mod tests {
  use super::{aliased_tool, append_stderr_tail, binary_target_triple, ensure_runtime_alias, ffmpeg_failure_message};
  use crate::constants::MAX_STDERR_BYTES;
  use std::{fs, path::PathBuf};

  #[test]
  fn aliased_tool_returns_correct_mappings() {
    assert_eq!(aliased_tool("ffprobe"), Some("ffmpeg"));
    assert_eq!(aliased_tool("convert"), Some("magick"));
    assert_eq!(aliased_tool("pdfunite"), Some("pdftoppm"));
    assert_eq!(aliased_tool("ffmpeg"), None);
    assert_eq!(aliased_tool("magick"), None);
    assert_eq!(aliased_tool("unknown"), None);
  }

  #[test]
  fn binary_target_triple_returns_known_targets() {
    // The current platform should always return a known target
    assert!(binary_target_triple().is_some() || !["macos", "windows", "linux"].contains(&std::env::consts::OS));
  }

  #[test]
  fn append_stderr_tail_keeps_last_bytes() {
    let mut stderr = Vec::new();
    // Fill beyond MAX_STDERR_BYTES
    let chunk = vec![b'A'; MAX_STDERR_BYTES + 100];
    append_stderr_tail(&mut stderr, &chunk);
    assert!(stderr.len() <= MAX_STDERR_BYTES);
    assert_eq!(stderr, vec![b'A'; MAX_STDERR_BYTES]);
  }

  #[test]
  fn append_stderr_tail_accumulates_small_chunks() {
    let mut stderr = Vec::new();
    append_stderr_tail(&mut stderr, b"hello");
    append_stderr_tail(&mut stderr, b" world");
    assert_eq!(stderr, b"hello world");
  }

  #[test]
  fn append_stderr_tail_clears_on_large_chunk() {
    let mut stderr = vec![b'B'; MAX_STDERR_BYTES];
    let chunk = vec![b'C'; MAX_STDERR_BYTES];
    append_stderr_tail(&mut stderr, &chunk);
    assert_eq!(stderr, vec![b'C'; MAX_STDERR_BYTES]);
  }

  #[test]
  fn ffmpeg_failure_message_with_stderr() {
    let msg = ffmpeg_failure_message(Some(1), b"error: file not found");
    assert!(msg.contains("1"));
    assert!(msg.contains("file not found"));
  }

  #[test]
  fn ffmpeg_failure_message_without_stderr() {
    let msg = ffmpeg_failure_message(Some(2), b"");
    assert!(msg.contains("2"));
  }

  #[test]
  fn ffmpeg_failure_message_unknown_code() {
    let msg = ffmpeg_failure_message(None, b"");
    assert!(msg.contains("unknown"));
  }

  #[test]
  fn runtime_alias_reuses_the_source_executable() -> Result<(), Box<dyn std::error::Error>> {
    let root =
      std::env::temp_dir().join(format!("biolaris-runtime-alias-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root)?;
    let source = root.join("ffmpeg");
    let alias = root.join("cache").join("ffprobe");
    fs::write(&source, b"test executable")?;

    ensure_runtime_alias(&source, &alias).map_err(std::io::Error::other)?;
    assert_eq!(fs::read(&alias)?, b"test executable");
    #[cfg(unix)]
    assert_eq!(fs::read_link(&alias)?, PathBuf::from(&source));
    ensure_runtime_alias(&source, &alias).map_err(std::io::Error::other)?;

    fs::remove_dir_all(root)?;
    Ok(())
  }
}
