use std::panic::{self, PanicHookInfo};
use std::sync::Arc;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// Install the global panic handler.
///
/// This function should be called once during app startup, after the Tauri context is
/// available.  It replaces the default panic hook with one that:
///
/// 1. Captures the panic message (file, line, or raw message).
/// 2. Shows a native error dialog via `tauri-plugin-dialog`.
/// 3. Delegates to the original panic hook so the default logging behaviour is preserved.
pub fn install(app: &AppHandle) {
    let app = Arc::new(app.clone());

    let original_hook = panic::take_hook();
    let app = Arc::clone(&app);

    panic::set_hook(Box::new(move |info: &PanicHookInfo<'_>| {
        // --- 1. Capture the panic message -----------------------------------------
        let message = format_panic_message(info);

        // --- 2. Log the panic (original hook) ------------------------------------
        original_hook(info);

        // --- 3. Show a friendly error dialog -------------------------------------
        let app = Arc::clone(&app);
        // We use `std::thread::spawn` because the panic hook runs on the panicking
        // thread, which may be in an inconsistent state.  Spawning a new thread
        // gives us a clean stack for the dialog call.
        std::thread::spawn(move || {
            show_crash_dialog(&app, &message);
        });
    }));
}

// -- Message formatting -----------------------------------------------------------

fn format_panic_message(info: &PanicHookInfo<'_>) -> String {
    let payload = info.payload();

    let base = if let Some(msg) = payload.downcast_ref::<&str>() {
        msg.to_string()
    } else if let Some(msg) = payload.downcast_ref::<String>() {
        msg.clone()
    } else {
        "Application error".to_string()
    };

    if let Some(location) = info.location() {
        format!(
            "{}\n\n({}:{}:{})",
            base, location.file(), location.line(), location.column()
        )
    } else {
        base
    }
}

// -- Dialog -----------------------------------------------------------------------

fn show_crash_dialog(app: &AppHandle, message: &str) {
    // Try to use the Tauri runtime to show the dialog.
    // If the runtime is already shutting down, we fall back to eprintln.
    let message = message.to_string();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // Use i18n for the dialog title and message
        let title = crate::t!("app.crash.title");
        let body = crate::t!("app.crash.message", details = message.as_str());

        // Use tauri-plugin-dialog's DialogExt to show an error dialog
        app.dialog()
            .message(&body)
            .kind(MessageDialogKind::Error)
            .title(&title)
            .blocking_show()
    }));

    if result.is_err() {
        // The app is likely in the process of terminating — the dialog couldn't be
        // shown.  Fall back to stderr logging.
        eprintln!("Biolaris Media crashed:\n{}", message);
    }
}
