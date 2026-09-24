//! Tipi condivisi del modulo Laboratorio prototipi.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LabPrototypeStatus {
    Active,
    Closed,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LabRevision {
    pub sha: String,
    pub message: String,
    /// ISO 8601 date.
    pub date: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LabIndexEntry {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub status: LabPrototypeStatus,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
    pub workspace_path: String,
    pub last_revision: Option<LabRevision>,
    pub duplicated_from: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LabIndexFile {
    pub version: u32,
    pub prototypes: Vec<LabIndexEntry>,
}

impl Default for LabIndexFile {
    fn default() -> Self {
        Self {
            version: 1,
            prototypes: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LabIndexPatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub status: Option<LabPrototypeStatus>,
    #[serde(default)]
    pub last_revision: Option<Option<LabRevision>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LabPaths {
    pub root: String,
    pub drafts_index: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LabFile {
    pub path: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LabMeta {
    pub title: String,
    pub summary: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LabChangedEvent {
    pub key: String,
    pub paths: Vec<String>,
}
