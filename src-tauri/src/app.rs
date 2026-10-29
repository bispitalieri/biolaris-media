use crate::{commands, models::QueueState};
use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  Manager, WebviewUrl, WebviewWindowBuilder,
};

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
      commands::conversion::enqueue_conversion,
      commands::compression::enqueue_compression,
      commands::crop::enqueue_crop,
      commands::slideshow::enqueue_slideshow,
      commands::open_output::open_output_file,
      commands::open_output::open_output_directory,
      commands::app_icon::create_app_icons,
      available_parallelism
    ])
    .run(tauri::generate_context!())
    .expect("errore durante l'avvio di Biolaris");
}
