//! Il permesso Lettura non deve permettere di estrarre identita' e credenziali
//! passando una root arbitraria ai comandi filesystem della finestra locale.
use std::path::{Path, PathBuf};
use serde::Deserialize;
use serde_json::Value;

#[derive(Default)]
pub(super) struct Roots {
    declared: Vec<String>,
    canonical: Vec<PathBuf>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotRoots {
    project_root: String,
    projects: Vec<ProjectRoot>,
    lanes: Vec<LaneRoot>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectRoot {
    canonical_project_path: Option<String>,
    lane: LaneRoot,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaneRoot { workspace_path: Option<String> }

impl Roots {
    pub(super) fn update(&mut self, snapshot: &str) -> Result<(), String> {
        let snapshot: SnapshotRoots = serde_json::from_str(snapshot).map_err(|error| error.to_string())?;
        let mut declared = vec![snapshot.project_root];
        for project in snapshot.projects {
            declared.extend(project.canonical_project_path);
            declared.extend(project.lane.workspace_path);
        }
        for lane in snapshot.lanes { declared.extend(lane.workspace_path); }
        declared.retain(|path| !path.trim().is_empty());
        declared.sort_unstable();
        declared.dedup();
        if declared == self.declared { return Ok(()); }
        let canonical = declared.iter().filter_map(|path| {
            if !Path::new(path).is_absolute() { return None; }
            crate::projects::canonical_project_base(path).ok()
        }).collect();
        self.declared = declared;
        self.canonical = canonical;
        Ok(())
    }

    pub(super) fn authorize(&self, command: &str, args: &Value) -> Result<(), String> {
        self.walk(command, "", args)
    }

    fn walk(&self, command: &str, key: &str, value: &Value) -> Result<(), String> {
        match value {
            Value::Object(fields) => {
                for (key, value) in fields { self.walk(command, key, value)?; }
            }
            Value::Array(values) => {
                for value in values { self.walk(command, key, value)?; }
            }
            Value::String(value) if !value.is_empty() && path_key(key) => {
                if key == "resume" && !Path::new(value).is_absolute() { return Ok(()); }
                let path = Path::new(value);
                if !path.is_absolute() { return Err(format!("Remote path must be absolute: {key}")); }
                let resolved = resolve_destination(path)?;
                if self.canonical.iter().any(|root| resolved.starts_with(root)) { return Ok(()); }
                if matches!(key, "sessionFile" | "sessionPath" | "resume")
                    || (command == "read_historical_session_messages" && key == "path") {
                    if let Some(root) = crate::omp_ops::agent_dir().and_then(|root| root.join("sessions").canonicalize().ok()) {
                        if resolved.starts_with(root) { return Ok(()); }
                    }
                }
                return Err(format!("Remote path is outside the host's project roots: {key}"));
            }
            _ => {},
        }
        Ok(())
    }
}

fn path_key(key: &str) -> bool {
    !matches!(key, "rel" | "relativePath") && (key == "cwd" || key == "path" || key == "paths"
        || key == "root" || key == "resume" || key == "sessionFile"
        || key.ends_with("Path") || key.ends_with("Paths") || key.ends_with("Dir")
        || key.ends_with("Root") || key.ends_with("Roots"))
}

fn resolve_destination(path: &Path) -> Result<PathBuf, String> {
    let mut candidate = path;
    let mut missing = Vec::new();
    loop {
        match candidate.canonicalize() {
            Ok(mut resolved) => {
                for part in missing.into_iter().rev() { resolved.push(part); }
                return Ok(resolved);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing.push(candidate.file_name().ok_or("Invalid remote path")?.to_owned());
                candidate = candidate.parent().ok_or("Invalid remote path")?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_peer_cannot_turn_file_read_into_an_instance_key_or_credentials_export() {
        let temp = std::env::temp_dir().join(format!("studio-access-{}", uuid::Uuid::new_v4()));
        let project = temp.join("project");
        let private = temp.join("private");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&private).unwrap();
        std::fs::write(private.join("instances.json"), "secret").unwrap();
        let roots = Roots { declared: Vec::new(), canonical: vec![project.canonicalize().unwrap()] };
        assert!(roots.authorize("file_read", &serde_json::json!({ "projectPath": private, "rel": "instances.json" })).is_err());
        assert!(roots.authorize("file_write", &serde_json::json!({ "projectPath": project, "rel": "new.txt", "content": "/not/a/path/argument" })).is_ok());
        assert!(roots.authorize("file_write", &serde_json::json!({ "filePath": project.join("new.txt") })).is_ok());
        std::fs::remove_dir_all(temp).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn symlinked_roots_cannot_escape_the_granted_projects() {
        let temp = std::env::temp_dir().join(format!("studio-access-{}", uuid::Uuid::new_v4()));
        let project = temp.join("project");
        let private = temp.join("private");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&private).unwrap();
        std::os::unix::fs::symlink(&private, project.join("outside")).unwrap();
        let roots = Roots { declared: Vec::new(), canonical: vec![project.canonicalize().unwrap()] };
        assert!(roots.authorize("file_read", &serde_json::json!({ "projectPath": project.join("outside") })).is_err());
        std::fs::remove_dir_all(temp).unwrap();
    }
}
