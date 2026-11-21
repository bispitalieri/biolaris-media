use crate::{commands, models::QueueState};
use tracing_subscriber::{layer::SubscriberExt, EnvFilter};
use tauri::{
    menu::{Menu, MenuItemBuilder, SubmenuBuilder},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

#[tauri::command]
fn available_parallelism() -> usize {
  num_cpus::get().max(1)
}

/// File menu entries: (i18n_key, shortcut, menu_id, route)
/// PDF entries have no shortcuts (Shift+!@#$ is not supported).
/// Separators divide the categories: Media, Audio, PDF.
const FILE_MENU_MEDIA: &[(&str, Option<&str>, &str, &str)] = &[
    ("app.menu.convert", Some("CmdOrCtrl+1"), "nav-convert", "/convert"),
    ("app.menu.compress", Some("CmdOrCtrl+2"), "nav-compress", "/compress"),
    ("app.menu.crop", Some("CmdOrCtrl+3"), "nav-crop", "/crop"),
    ("app.menu.combine_videos", Some("CmdOrCtrl+4"), "nav-combine-videos", "/combine-videos"),
    ("app.menu.slideshow", Some("CmdOrCtrl+5"), "nav-slideshow", "/slideshow"),
    ("app.menu.app_icon", Some("CmdOrCtrl+6"), "nav-app-icon", "/app-icon"),
    ("app.menu.remove_background", Some("CmdOrCtrl+7"), "nav-remove-background", "/remove-background"),
    ("app.menu.vectorize", Some("CmdOrCtrl+8"), "nav-vectorize", "/vectorize"),
    ("app.menu.download_video", Some("CmdOrCtrl+9"), "nav-download-video", "/download-video"),
];

const FILE_MENU_AUDIO: &[(&str, Option<&str>, &str, &str)] = &[
    ("app.menu.merge_audio", Some("CmdOrCtrl+0"), "nav-merge-audio", "/merge-audio"),
    ("app.menu.split_by_chapter", Some("CmdOrCtrl+-"), "nav-split-by-chapter", "/split-by-chapter"),
];

const FILE_MENU_PDF: &[(&str, Option<&str>, &str, &str)] = &[
    ("app.menu.combine_pdfs", None, "nav-combine-pdfs", "/combine-pdfs"),
    ("app.menu.images_to_pdf", None, "nav-images-to-pdf", "/images-to-pdf"),
    ("app.menu.split_pdfs", None, "nav-split-pdfs", "/split-pdfs"),
    ("app.menu.organize_pages", None, "nav-organize-pages", "/organize-pages"),
];

fn menu_label(id: &str) -> String {
  match id {
    "nav-convert" => crate::t!("app.menu.convert"),
    "nav-compress" => crate::t!("app.menu.compress"),
    "nav-crop" => crate::t!("app.menu.crop"),
    "nav-combine-videos" => crate::t!("app.menu.combine_videos"),
    "nav-slideshow" => crate::t!("app.menu.slideshow"),
    "nav-app-icon" => crate::t!("app.menu.app_icon"),
    "nav-remove-background" => crate::t!("app.menu.remove_background"),
    "nav-vectorize" => crate::t!("app.menu.vectorize"),
    "nav-download-video" => crate::t!("app.menu.download_video"),
    "nav-merge-audio" => crate::t!("app.menu.merge_audio"),
    "nav-split-by-chapter" => crate::t!("app.menu.split_by_chapter"),
    "nav-combine-pdfs" => crate::t!("app.menu.combine_pdfs"),
    "nav-images-to-pdf" => crate::t!("app.menu.images_to_pdf"),
    "nav-split-pdfs" => crate::t!("app.menu.split_pdfs"),
    "nav-organize-pages" => crate::t!("app.menu.organize_pages"),
    _ => id.to_string(),
  }
}

fn build_native_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
  let file_label = crate::t!("app.menu.file");
  let edit_label = crate::t!("app.menu.edit");
  let settings_label = crate::t!("app.menu.settings");

  // --- App menu (macOS: About, Services, Hide, Quit) ---
  #[cfg(target_os = "macos")]
  let app_menu = SubmenuBuilder::new(app, "Biolaris Media")
      .about(Some(tauri::menu::AboutMetadata {
          ..Default::default()
      }))
      .separator()
      .services()
      .separator()
      .hide()
      .hide_others()
      .show_all()
      .separator()
      .quit()
      .build()?;

  // --- File menu with separate categories ---
  let mut file_menu = SubmenuBuilder::new(app, &file_label);

  // Media section
  for (_label, shortcut, id, _route) in FILE_MENU_MEDIA {
      let translated = menu_label(id);
      let mut builder = MenuItemBuilder::new(&translated).id(*id);
      if let Some(sc) = shortcut {
          builder = builder.accelerator(*sc);
      }
      let item = builder.build(app)?;
      file_menu = file_menu.item(&item);
  }

  // Separator + Audio section
  file_menu = file_menu.separator();
  for (_label, shortcut, id, _route) in FILE_MENU_AUDIO {
      let translated = menu_label(id);
      let mut builder = MenuItemBuilder::new(&translated).id(*id);
      if let Some(sc) = shortcut {
          builder = builder.accelerator(*sc);
      }
      let item = builder.build(app)?;
      file_menu = file_menu.item(&item);
  }

  // Separator + PDF section
  file_menu = file_menu.separator();
  for (_label, shortcut, id, _route) in FILE_MENU_PDF {
      let translated = menu_label(id);
      let mut builder = MenuItemBuilder::new(&translated).id(*id);
      if let Some(sc) = shortcut {
          builder = builder.accelerator(*sc);
      }
      let item = builder.build(app)?;
      file_menu = file_menu.item(&item);
  }

  // Separator + Settings
  file_menu = file_menu.separator();
  let settings_item = MenuItemBuilder::new(&settings_label)
      .id("open-settings")
      .accelerator("CmdOrCtrl+,")
      .build(app)?;
  file_menu = file_menu.item(&settings_item);
  let file_menu = file_menu.build()?;

  // --- Menu Edit ---
  let edit_menu = SubmenuBuilder::new(app, &edit_label)
      .undo()
      .redo()
      .separator()
      .cut()
      .copy()
      .paste()
      .select_all()
      .build()?;

  // --- Menu View ---
  let view_menu = SubmenuBuilder::new(app, "View")
      .item(&MenuItemBuilder::new("Refresh")
          .id("refresh")
          .accelerator("CmdOrCtrl+R")
          .build(app)?)
      .separator()
      .fullscreen()
      .build()?;

  // --- Assemble menu ---
  #[cfg(target_os = "macos")]
  {
    let menu = Menu::new(app)?;
    menu.append(&app_menu)?;
    menu.append(&file_menu)?;
    menu.append(&edit_menu)?;
    menu.append(&view_menu)?;
    Ok(menu)
  }

  #[cfg(not(target_os = "macos"))]
  {
    let menu = Menu::new(app)?;
    menu.append(&file_menu)?;
    menu.append(&edit_menu)?;
    menu.append(&view_menu)?;
    Ok(menu)
  }
}

fn open_settings_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
  if let Some(window) = app.get_webview_window("settings") {
    if let Err(error) = window.show() {
      tracing::error!("{}", crate::t!("app.error.show_settings", error = error.to_string()));
    }
    if let Err(error) = window.set_focus() {
      tracing::error!("{}", crate::t!("app.error.focus_settings", error = error.to_string()));
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
    tracing::error!("{}", crate::t!("app.error.open_settings", error = error.to_string()));
  }
}

pub fn run() {
  let subscriber = tracing_subscriber::registry()
    .with(tracing_subscriber::fmt::layer())
    .with(EnvFilter::from_default_env());
  if let Err(error) = tracing::subscriber::set_global_default(subscriber) {
    eprintln!("Failed to set global tracing subscriber: {error}");
  }

  tauri::Builder::default()
    .setup(|app| {
      crate::tools::prepare_runtime_aliases(app.handle()).map_err(std::io::Error::other)?;
      crate::crash_handler::install(app.handle());

      Ok(())
    })
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .menu(build_native_menu)
    .on_menu_event(|app, event| {
      match event.id().0.as_str() {
        "open-settings" => {
          open_settings_window(app);
        }
        "refresh" => {
          if let Some(window) = app.get_webview_window("main") {
            let _ = window.eval("window.location.reload();");
          }
        }
        _ => {
          // Navigation: find the route associated with the menu ID
          #[allow(clippy::type_complexity)]
          let all_items: &[&[(&str, Option<&str>, &str, &str)]] = &[
              FILE_MENU_MEDIA, FILE_MENU_AUDIO, FILE_MENU_PDF,
          ];
          let route = all_items.iter().flat_map(|items| items.iter()).find_map(
              |(_label, _shortcut, id, route)| {
                  if event.id().0.as_str() == *id {
                      Some(*route)
                  } else {
                      None
                  }
              }
          );

          if let Some(route) = route {
            if let Some(window) = app.get_webview_window("main") {
              let _ = window.eval(format!(
                r#"window.dispatchEvent(new CustomEvent('tauri-navigate', {{detail: {{path: '{}'}}}}));"#,
                route
              ));
            }
          }
        }
      }
    })
    .manage(QueueState::default())
    .invoke_handler(tauri::generate_handler![
      commands::conversion::enqueue_conversion,
      commands::compression::enqueue_compression,
      commands::crop::enqueue_crop,
      commands::slideshow::enqueue_slideshow,
      commands::combine_videos::enqueue_combine_videos,
      commands::combine_pdfs::probe_pdf_file,
      commands::combine_pdfs::enqueue_combine_pdfs,
      commands::split_pdfs::enqueue_split_pdfs,
      commands::organize_pdfs::render_pdf_pages,
      commands::organize_pdfs::render_pdf_page,
      commands::organize_pdfs::organize_pdf_pages,
      commands::images_to_pdf::preview_image_for_pdf,
      commands::images_to_pdf::enqueue_images_to_pdf,
      commands::merge_audio::probe_audio_file,
      commands::merge_audio::prepare_audio_preview,
      commands::merge_audio::enqueue_merge_audio,
      commands::split_by_chapter::probe_chapters,
      commands::split_by_chapter::enqueue_split_by_chapter,
      commands::open_output::open_output_file,
      commands::open_output::open_output_directory,
      commands::open_output::show_in_finder,
      commands::vectorize::enqueue_vectorize,
      commands::app_icon::create_app_icons,
      commands::remove_background::save_background_removed_png,
      commands::download_video::enqueue_video_download,
      available_parallelism
    ])
    .run(tauri::generate_context!())
    .unwrap_or_else(|error| {
      let message = crate::t!("app.error.startup", error = error.to_string());
      eprintln!("{}", message);
      // Show a native error dialog before exiting.
      // We use a minimal dialog via the system dialog API since the Tauri runtime
      // failed to initialize fully — the plugin may not be available.
      #[cfg(target_os = "macos")]
      {
        let _ = std::process::Command::new("osascript")
          .args([
            "-e", &format!(
              "display dialog \"{}\" buttons {{\"OK\"}} default button 1 with icon stop with title \"Biolaris Media\"",
              message.replace('"', "\\'")
            ),
          ])
          .status();
      }
      #[cfg(target_os = "windows")]
      {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = std::process::Command::new("cmd")
          .creation_flags(CREATE_NO_WINDOW)
          .args([
            "/c", "powershell", "-Command",
            &format!(
              "[System.Windows.MessageBox]::Show('{}', 'Biolaris Media', 'OK', 'Error')",
              message.replace('"', "'")
            ),
          ])
          .status();
      }
      #[cfg(target_os = "linux")]
      {
        let _ = std::process::Command::new("zenity")
          .args([
            "--error",
            "--title", "Biolaris Media",
            "--text", &message,
          ])
          .status();
      }
      std::process::exit(1);
    });
}

