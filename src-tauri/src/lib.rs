mod pty;
use pty::{PtyManager, pty_open, pty_write, pty_resize, pty_close};
mod projects;
use projects::{tree_read, file_read, file_write, file_git_head, project_git_status};
mod omp_ops;
use omp_ops::{usage_snapshot, sessions_list, sessions_search, get_omp_version, check_omp_update, run_omp_update, theme_apply, omp_user_theme, provider_hosts};



// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PtyManager::new())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.get_webview_window("main").expect("no main window").set_focus();
        }))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::DECORATIONS)
                .build()
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            pty_open,
            pty_write,
            pty_resize,
            pty_close,
            tree_read,
            file_read,
            file_write,
            file_git_head,
            project_git_status,
            usage_snapshot,
            sessions_list,
            sessions_search,
            get_omp_version,
            check_omp_update,
            run_omp_update,
            theme_apply,
            omp_user_theme,
            provider_hosts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
