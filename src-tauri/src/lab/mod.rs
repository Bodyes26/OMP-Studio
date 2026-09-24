//! Modulo Laboratorio prototipi (Lab) di OMP Studio.
//!
//! Fornisce gestione dei workspace prototipo isolati, template standard Vite + React + Tailwind v4,
//! git interno con commit per revisione, indici persistenti atomici e watcher con debounce.

pub mod git;
pub mod index;
pub mod meta;
pub mod paths;
pub mod preview_server;
pub mod types;
pub mod util;
pub mod watcher;
pub mod workspace;

pub use git::{lab_git_commit, lab_git_files_at, lab_git_log, lab_git_restore};
pub use index::{lab_index_list, lab_index_remove, lab_index_update, lab_prototype_associate};
pub use meta::{lab_meta_read, lab_preview_status_write};
pub use paths::lab_paths;
pub use watcher::{lab_watch_start, lab_watch_stop};
pub use workspace::{
    lab_export, lab_prototype_create, lab_prototype_duplicate, lab_workspace_exists,
    lab_workspace_snapshot,
};
pub use preview_server::{
    lab_preview_publish, lab_preview_publish_shared, lab_preview_unpublish,
};
