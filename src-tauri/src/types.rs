use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkEntry {
    pub path: String,
    pub target: String,
    pub link_type: LinkType,
    pub status: LinkStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LinkType {
    Symlink,
    Junction,
    Hardlink,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LinkStatus {
    Ok,
    Broken(String),
    AccessDenied,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkDetails {
    pub path: String,
    pub target_real: String,
    pub target_stored: String,
    pub link_type: LinkType,
    pub object_type: ObjectType,
    pub created_at: String,
    pub modified_at: String,
    pub owner: String,
    pub attributes: Vec<String>,
    pub status: LinkStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ObjectType {
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub scanned: u64,
    pub found: u64,
    pub current_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanBatch {
    pub entries: Vec<LinkEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ScanMode {
    UsnJournal,
    WalkdirFallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub entries: Vec<LinkEntry>,
    pub mode: ScanMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeInfo {
    pub letter: String,
    pub label: String,
    pub fs: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExportFormat {
    Csv,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionRecord {
    pub id: i64,
    pub action_type: String,
    pub link_path: String,
    pub link_type: LinkType,
    pub target_old: Option<String>,
    pub target_new: Option<String>,
    pub timestamp: String,
    pub success: bool,
    pub error_msg: Option<String>,
}
