//! Un solo catalogo per il confine IPC della finestra e quello di rete.
use std::{collections::HashMap, sync::LazyLock};
use serde::{Deserialize, Serialize};

static COMMANDS: LazyLock<HashMap<String, (String, String)>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../src/lib/backend/commands.json"))
        .expect("invalid backend command catalogue")
});

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Permissions {
    pub agents: bool,
    pub files: bool,
    pub terminal: bool,
}

impl Default for Permissions {
    fn default() -> Self { Self { agents: true, files: true, terminal: true } }
}

/// Ambito di permesso di un comando del catalogo (`read`, `agents`, `files`,
/// `terminal`, `local`); serve al registro delle azioni remote (R-MI-39),
/// che registra tutto cio' che non e' Lettura.
pub(crate) fn permission(command: &str) -> Option<&'static str> {
    COMMANDS.get(command).map(|(_, permission)| permission.as_str())
}

impl Permissions {
    pub(crate) fn authorize(&self, command: &str) -> Result<&'static str, String> {
        let (scope, permission) = COMMANDS.get(command)
            .ok_or_else(|| format!("Unknown remote command: {command}"))?;
        if scope == "local" {
            return Err(format!("Command belongs to the viewing machine: {command}"));
        }
        let allowed = match permission.as_str() {
            "read" => true,
            "agents" => self.agents,
            "files" => self.files,
            "terminal" => self.terminal,
            _ => false,
        };
        if !allowed { return Err(format!("Permission denied: {permission}")); }
        Ok(scope.as_str())
    }

    /// I percorsi dei comandi vanno tenuti nelle radici dichiarate dell'host
    /// (A5)? Agenti e Terminale equivalgono a una shell sulla macchina
    /// (R-MI-09: gli ambiti non sono una sandbox): con uno dei due il
    /// confinamento non protegge nulla e romperebbe letture legittime fuori
    /// dalle radici (Laboratorio, progetti chiusi). Senza nessuno dei due
    /// ogni percorso resta nelle radici, File e Git compresi: prima il
    /// confinamento scattava solo con tutti gli ambiti spenti, e un peer con il
    /// solo File e Git poteva scrivere ovunque sul disco.
    pub(crate) fn confines_paths(&self) -> bool {
        !self.agents && !self.terminal
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn read_only_peer_cannot_write_execute_or_escape_the_catalogue() {
        let permissions = Permissions { agents: false, files: false, terminal: false };
        assert_eq!(permissions.authorize("file_read").unwrap(), "routed");
        assert_eq!(permissions.authorize("pty_session_info").unwrap(), "routed");
        for command in ["file_write", "rpc_send", "pty_write", "start_studio_update", "desktop_presence_request_exit", "plugin:shell|execute", "link_invoke"] {
            assert!(permissions.authorize(command).is_err(), "{command}");
        }
    }
    #[test]
    fn revoking_one_scope_leaves_other_scopes_available() {
        let permissions = Permissions { files: false, ..Permissions::default() };
        assert!(permissions.authorize("file_write").is_err());
        assert!(permissions.authorize("rpc_open").is_ok());
        assert!(permissions.authorize("pty_open").is_ok());
        assert!(permissions.authorize("file_read").is_ok());
    }

    #[test]
    fn only_shell_equivalent_grants_lift_the_path_confinement() {
        let none = Permissions { agents: false, files: false, terminal: false };
        let files_only = Permissions { agents: false, files: true, terminal: false };
        assert!(none.confines_paths());
        assert!(files_only.confines_paths(), "File e Git da solo non deve scrivere fuori dai progetti");
        assert!(!Permissions { agents: true, ..files_only }.confines_paths());
        assert!(!Permissions { terminal: true, ..files_only }.confines_paths());
    }
}
