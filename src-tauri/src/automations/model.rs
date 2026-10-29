use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Piattaforme supportate per l'esecuzione di comandi.
pub type AutomationPlatform = String; // "windows" | "macos" | "linux"

/// Stato di una definizione di automazione.
pub type AutomationState = String; // "draft" | "enabled" | "disabled" | "suspended" | "archived"

/// Stato di esecuzione di un'occorrenza o di un singolo target.
pub type ExecutionState = String; // "waiting" | "running" | "needsInput" | "completed" | "error" | "timeout" | "interrupted" | "skipped" | "unknown" | "superseded"

/// Famiglia del trigger.
pub type AutomationTriggerKind = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommandVariant {
    pub mode: String, // "shell" | "executable" | "script"
    pub command: String,
    pub args: Vec<String>,
    pub interpreter: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandAction {
    pub mode: String,
    pub command: String,
    pub args: Vec<String>,
    pub interpreter: String,
    #[serde(default)]
    pub platforms: Vec<AutomationPlatform>,
    #[serde(default)]
    pub variants: HashMap<AutomationPlatform, CommandVariant>,
    #[serde(default)]
    pub environment: HashMap<String, String>,
    #[serde(default)]
    pub secret_refs: HashMap<String, String>,
    #[serde(default = "default_script_policy")]
    pub script_policy: String, // "review" | "follow"
    #[serde(default)]
    pub approved_files: HashMap<String, String>,
    #[serde(default)]
    pub watched_files: Vec<String>,
}

fn default_script_policy() -> String {
    "review".to_string()
}

impl CommandAction {
    /// Restituisce la variante effettiva in base al sistema operativo corrente.
    pub fn effective_variant(&self, os_name: &str) -> CommandVariant {
        if let Some(v) = self.variants.get(os_name) {
            return v.clone();
        }
        CommandVariant {
            mode: self.mode.clone(),
            command: self.command.clone(),
            args: self.args.clone(),
            interpreter: self.interpreter.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PromptAction {
    pub prompt: String,
    #[serde(default = "default_model_mode")]
    pub model_mode: String, // "role" | "model"
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub allow_pay_as_you_go: bool,
    #[serde(default)]
    pub max_cost_usd: Option<f64>,
}

fn default_model_mode() -> String {
    "role".to_string()
}

fn default_model() -> String {
    "smol".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AutomationAction {
    #[serde(rename = "command")]
    Command(CommandAction),
    #[serde(rename = "prompt")]
    Prompt(PromptAction),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TargetFilter {
    pub kind: String,   // "dirty" | "activity" | "commit"
    pub period: String, // "today" | "24h" | "7d"
    #[serde(default)]
    pub authors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationTargets {
    pub source: String, // "selected" | "open" | "registered" | "studio" | "directory"
    #[serde(default)]
    pub project_paths: Vec<String>,
    #[serde(default)]
    pub exclude_paths: Vec<String>,
    #[serde(default)]
    pub include_studio: bool,
    #[serde(default = "default_target_mode")]
    pub mode: String, // "each" | "aggregate"
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub filters: Vec<TargetFilter>,
}

fn default_target_mode() -> String {
    "each".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationTrigger {
    pub id: String,
    pub kind: AutomationTriggerKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
    #[serde(default)]
    pub weekdays: Vec<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval_minutes: Option<u64>,
    #[serde(default)]
    pub roots: Vec<String>,
    #[serde(default)]
    pub include_patterns: Vec<String>,
    #[serde(default)]
    pub exclude_patterns: Vec<String>,
    #[serde(default)]
    pub changes: Vec<String>, // "create" | "modify" | "remove"
    #[serde(default)]
    pub branches: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationQuotaPolicy {
    pub short_pct: f64,
    pub weekly_pct: f64,
    pub other_pct: f64,
    #[serde(default)]
    pub windows: HashMap<String, f64>,
}

impl Default for AutomationQuotaPolicy {
    fn default() -> Self {
        Self {
            short_pct: 10.0,
            weekly_pct: 10.0,
            other_pct: 10.0,
            windows: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationPolicy {
    pub timezone: String,
    #[serde(default = "default_max_wait_minutes")]
    pub max_wait_minutes: u64,
    #[serde(default = "default_timeout_minutes")]
    pub timeout_minutes: u64,
    #[serde(default = "default_human_wait_minutes")]
    pub human_wait_minutes: u64,
    #[serde(default = "default_missed")]
    pub missed: String, // "notify" | "ignore" | "recover"
    #[serde(default = "default_recovery_minutes")]
    pub recovery_minutes: u64,
    #[serde(default = "default_overlap")]
    pub overlap: String, // "coalesce" | "skip"
    #[serde(default)]
    pub quota: AutomationQuotaPolicy,
    #[serde(default)]
    pub notify_success: bool,
    #[serde(default = "default_file_quiet_seconds")]
    pub file_quiet_seconds: u64,
    #[serde(default = "default_file_max_wait_seconds")]
    pub file_max_wait_seconds: u64,
}

fn default_max_wait_minutes() -> u64 {
    60
}
fn default_timeout_minutes() -> u64 {
    60
}
fn default_human_wait_minutes() -> u64 {
    60
}
fn default_missed() -> String {
    "notify".to_string()
}
fn default_recovery_minutes() -> u64 {
    15
}
fn default_overlap() -> String {
    "coalesce".to_string()
}
fn default_file_quiet_seconds() -> u64 {
    2
}
fn default_file_max_wait_seconds() -> u64 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationProjectRequest {
    pub request_id: String,
    pub operation: String, // "open" | "close"
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_id: Option<String>,
    pub status: String, // "requested" | "deferred" | "completed" | "error"
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDefinition {
    pub id: String,
    pub revision: u64,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub state: AutomationState,
    pub action: AutomationAction,
    pub targets: AutomationTargets,
    #[serde(default)]
    pub triggers: Vec<AutomationTrigger>,
    #[serde(default)]
    pub branches: Vec<String>,
    pub policy: AutomationPolicy,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default = "default_origin")]
    pub origin: String,
}

fn default_origin() -> String {
    "user".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantMessage {
    pub id: String,
    pub role: String, // "user" | "assistant"
    pub text: String,
    pub at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDraft {
    pub id: String,
    pub definition: AutomationDefinition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_revision: Option<u64>,
    #[serde(default)]
    pub conversation: Vec<AssistantMessage>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default = "default_draft_source")]
    pub source: String,
}

fn default_draft_source() -> String {
    "user".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationProject {
    pub id: String,
    pub path: String,
    pub name: String,
    pub open: bool,
    #[serde(default)]
    pub workspace_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAutomationTarget {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub path: String,
    pub name: String,
    pub kind: String, // "project" | "studio" | "directory"
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationEvent {
    pub kind: AutomationTriggerKind,
    pub at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>, // "interactive" | "automation" | "external"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationExecution {
    pub id: String,
    pub run_id: String,
    pub targets: Vec<ResolvedAutomationTarget>,
    pub state: ExecutionState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question: Option<String>,
    #[serde(default)]
    pub output_truncated: bool,
    #[serde(default)]
    pub active_duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_since: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub human_deadline: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationOccurrence {
    pub id: String,
    pub automation_id: String,
    pub revision: u64,
    pub name: String,
    pub scheduled_at: i64,
    pub created_at: i64,
    pub deadline: i64,
    pub state: ExecutionState,
    #[serde(default)]
    pub reasons: Vec<AutomationEvent>,
    #[serde(default)]
    pub targets: Vec<ResolvedAutomationTarget>,
    #[serde(default)]
    pub executions: Vec<AutomationExecution>,
    pub definition: AutomationDefinition,
    #[serde(default)]
    pub acknowledged: bool,
    #[serde(default)]
    pub requires_review: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSettings {
    pub max_ai: u32,
    pub max_commands: u32,
    pub retention_days: u32,
    pub output_per_run_bytes: u64,
    pub output_total_bytes: u64,
    pub assistant_model_mode: String, // "role" | "model"
    pub assistant_model: String,
    pub assistant_allow_pay_as_you_go: bool,
}

impl Default for AutomationSettings {
    fn default() -> Self {
        Self {
            max_ai: 1,
            max_commands: 1,
            retention_days: 90,
            output_per_run_bytes: 10 * 1024 * 1024,
            output_total_bytes: 200 * 1024 * 1024,
            assistant_model_mode: "role".to_string(),
            assistant_model: "smol".to_string(),
            assistant_allow_pay_as_you_go: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSnapshot {
    pub definitions: Vec<AutomationDefinition>,
    pub drafts: Vec<AutomationDraft>,
    pub runs: Vec<AutomationOccurrence>,
    pub settings: AutomationSettings,
    pub projects: Vec<AutomationProject>,
    pub monitoring_since: i64,
    pub errors: Vec<String>,
    pub next_runs: HashMap<String, Option<i64>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub project_requests: Vec<AutomationProjectRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutomationContext {
    pub projects: Vec<AutomationProject>,
    #[serde(default)]
    pub busy_paths: Vec<String>,
    #[serde(default)]
    pub interactive_agent_count: usize,
    #[serde(default)]
    pub max_agent_count: usize,
    #[serde(default)]
    pub interactive_waiting: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationAiRequest {
    pub execution_id: String,
    pub run_id: String,
    pub definition: AutomationDefinition,
    pub targets: Vec<ResolvedAutomationTarget>,
    pub context_path: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationAiUpdate {
    pub execution_id: String,
    pub state: ExecutionState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationOutput {
    pub text: String,
    pub next_offset: u64,
    pub truncated: bool,
    pub end: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationPreview {
    pub targets: Vec<ResolvedAutomationTarget>,
    pub next_runs: Vec<i64>,
    pub issues: Vec<String>,
    pub file_hashes: HashMap<String, String>,
}
