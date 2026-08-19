//! Aether Mail desktop shell.
//!
//! The window is the product. Mail I/O still lives in `aether-cli` (Rust), and
//! the Node API remains a temporary UI host — but the user must never see a
//! terminal, so we start it as a managed child process and kill it on exit.
//!
//! Security posture: the API binds 127.0.0.1 only. Nothing here opens a network
//! surface, and no secret is passed on argv (aether-cli reads the OS keyring).

use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Handle to the sidecar so we can shut it down with the window.
struct ApiProcess(std::sync::Mutex<Option<CommandChild>>);

/// Where the UI should talk to. Kept as a command so the frontend never
/// hardcodes a port that the shell might change later.
#[tauri::command]
fn api_base() -> String {
    "http://127.0.0.1:8787".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ApiProcess(std::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![api_base])
        .setup(|app| {
            // Start the bundled API sidecar. If it is missing we still open the
            // window: the UI shows its own "API unreachable" state, which is a
            // better failure than a silent blank screen.
            match app.shell().sidecar("aether-api") {
                Ok(cmd) => match cmd.spawn() {
                    Ok((_rx, child)) => {
                        let state = app.state::<ApiProcess>();
                        *state.0.lock().unwrap() = Some(child);
                    }
                    Err(e) => eprintln!("aether: could not start api sidecar: {e}"),
                },
                Err(e) => eprintln!("aether: api sidecar not bundled: {e}"),
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window must not orphan the API process.
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<ApiProcess>();
                // Bind the guard so the MutexGuard temporary is dropped before
                // `state` goes out of scope at the end of this block.
                let child = state.0.lock().unwrap().take();
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Aether Mail");
}
