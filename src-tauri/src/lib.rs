mod diagrams;
mod previews;
mod pty;
use pty::{PtyManager, pty_open, pty_write, pty_resize, pty_close};
mod projects;
use projects::{tree_read, file_read, file_write, file_git_head, project_git_status, resolve_project_file, git_last_commit, git_recent_commits, git_current_branch, git_working_numstat, file_git_rev, git_branch_list, git_branch_checkout, git_branch_create, git_branch_merge, preview_file};
mod omp_ops;
use omp_ops::{usage_snapshot, sessions_list, sessions_search, get_omp_version, check_omp_update, run_omp_update, theme_apply, omp_user_theme, provider_hosts};
mod studio_updater;
use studio_updater::{
    get_studio_version, check_studio_update, start_studio_update_download,
    cancel_studio_update_download, install_studio_update_and_restart, StudioUpdaterState,
};
mod models_ops;
use models_ops::{
    get_model_config, save_model_config, get_models_catalog, refresh_models_catalog,
    get_custom_providers, save_custom_providers, get_auth_providers_summary,
    check_model_upgrades, apply_model_upgrades, get_role_suggestions,
};



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
        .manage(StudioUpdaterState::new())
        .manage(diagrams::DiagramWatcherState::new())
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
            git_last_commit,
            git_recent_commits,
            git_current_branch,
            git_working_numstat,
            file_git_rev,
            git_branch_list,
            git_branch_checkout,
            git_branch_create,
            git_branch_merge,
            preview_file,
            resolve_project_file,
            usage_snapshot,
            sessions_list,
            sessions_search,
            get_omp_version,
            check_omp_update,
            run_omp_update,
            theme_apply,
            omp_user_theme,
            provider_hosts,
            get_studio_version,
            check_studio_update,
            start_studio_update_download,
            cancel_studio_update_download,
            install_studio_update_and_restart,
            get_model_config,
            save_model_config,
            get_models_catalog,
            refresh_models_catalog,
            get_custom_providers,
            save_custom_providers,
            get_auth_providers_summary,
            check_model_upgrades,
            apply_model_upgrades,
            get_role_suggestions
        ])
        .setup(|app| {
            // Il watcher dei diagrammi parte subito dopo il setup: ascolta
            // la cartella di scambio e notifica il frontend via
            // `diagram://new`.
            diagrams::spawn_watcher(app.handle().clone());
            previews::spawn_watcher(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
