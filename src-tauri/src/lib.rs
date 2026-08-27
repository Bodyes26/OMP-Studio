mod diagrams;
mod previews;
mod pty;
use pty::{pty_close, pty_open, pty_resize, pty_session_info, pty_write, PtyManager};
mod rpc;
use rpc::{rpc_close, rpc_open, rpc_protocol, rpc_send, rpc_stderr, RpcManager};
mod projects;
use projects::{
    file_git_head, file_git_rev, file_read, file_write, git_branch_checkout, git_branch_create,
    git_branch_list, git_branch_merge, git_current_branch, git_last_commit, git_recent_commits,
    git_working_numstat, path_create_directory, path_create_file, path_rename, path_trash,
    preview_file, project_git_status, project_tasks_read, project_tasks_unwatch,
    project_tasks_watch, project_tasks_write, resolve_project_file, tree_read,
};
mod omp_ops;
use omp_ops::{
    check_omp_update, get_omp_version, omp_user_theme, provider_hosts, run_omp_update,
    sessions_list, sessions_search, theme_apply, usage_snapshot,
};
mod studio_updater;
use studio_updater::{
    cancel_studio_update_download, check_studio_update, get_studio_version,
    install_studio_update_and_restart, start_studio_update_download, StudioUpdaterState,
};
mod models_ops;
use models_ops::{
    apply_model_upgrades, check_model_upgrades, get_auth_providers_summary, get_custom_providers,
    get_model_config, get_models_catalog, get_role_suggestions, refresh_models_catalog,
    save_custom_providers, save_model_config,
};
mod setup;
use setup::{detect_project_roots, install_nerd_font, install_omp, setup_status};
mod alerts;
use alerts::{clear_app_attention, init_windows_aumid, set_app_attention};
mod external;
use external::open_project_external;

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
        .manage(RpcManager::new())
        .manage(StudioUpdaterState::new())
        .manage(diagrams::DiagramWatcherState::new())
        .manage(projects::ProjectTasksState::new())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app
                .get_webview_window("main")
                .expect("no main window")
                .set_focus();
        }))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            pty_open,
            pty_write,
            pty_resize,
            pty_close,
            pty_session_info,
            rpc_open,
            rpc_send,
            rpc_close,
            rpc_stderr,
            rpc_protocol,
            tree_read,
            path_create_file,
            path_create_directory,
            path_rename,
            path_trash,
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
            project_tasks_read,
            project_tasks_write,
            project_tasks_watch,
            project_tasks_unwatch,
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
            get_role_suggestions,
            setup_status,
            install_omp,
            install_nerd_font,
            detect_project_roots,
            set_app_attention,
            clear_app_attention,
            open_project_external
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    if let Some(pty_manager) = window.try_state::<PtyManager>() {
                        pty_manager.close_all();
                    }
                }
            }
        })
        .setup(|app| {
            init_windows_aumid();
            // Il watcher dei diagrammi parte subito dopo il setup: ascolta
            // la cartella di scambio e notifica il frontend via
            // `diagram://new`.
            diagrams::spawn_watcher(app.handle().clone());
            previews::spawn_watcher(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                if let Some(pty_manager) = app_handle.try_state::<PtyManager>() {
                    pty_manager.close_all();
                }
            }
        });
}
