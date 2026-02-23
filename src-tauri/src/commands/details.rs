use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

use chrono::{DateTime, Utc};

use crate::types::{LinkDetails, LinkStatus, LinkType, ObjectType};

fn iso_time(value: Result<SystemTime, std::io::Error>) -> String {
    value
        .ok()
        .map(|time| DateTime::<Utc>::from(time).to_rfc3339())
        .unwrap_or_default()
}

fn detect_link_type(path: &str) -> LinkType {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                if metadata.is_dir() {
                    LinkType::Junction
                } else {
                    LinkType::Symlink
                }
            } else {
                let output = Command::new("fsutil")
                    .args(["hardlink", "list", path])
                    .output();

                if let Ok(value) = output {
                    if value.status.success() {
                        let count = String::from_utf8_lossy(&value.stdout)
                            .lines()
                            .map(str::trim)
                            .filter(|line| !line.is_empty())
                            .count();

                        if count > 1 {
                            return LinkType::Hardlink;
                        }
                    }
                }

                LinkType::Symlink
            }
        }
        Err(_) => LinkType::Symlink,
    }
}

fn resolve_target(path: &str, stored_target: &str) -> String {
    let stored_path = PathBuf::from(stored_target);
    let absolute = if stored_path.is_absolute() {
        stored_path
    } else {
        Path::new(path)
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(stored_path)
    };

    let resolved = absolute.canonicalize().unwrap_or(absolute);
    normalize_display_path(&resolved)
}

fn normalize_display_path(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }

        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }

    value
}

fn resolve_owner(path: &str) -> String {
    let script = "(Get-Acl -LiteralPath $args[0]).Owner";

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .arg(path)
        .output();

    match output {
        Ok(value) if value.status.success() => String::from_utf8_lossy(&value.stdout).trim().to_string(),
        _ => String::new(),
    }
}

fn map_attributes(path: &str) -> Vec<String> {
    let mut result = Vec::new();

    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.permissions().readonly() {
            result.push("READONLY".to_string());
        }

        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;

            let attr = metadata.file_attributes();

            if attr & 0x2 != 0 {
                result.push("HIDDEN".to_string());
            }
            if attr & 0x4 != 0 {
                result.push("SYSTEM".to_string());
            }
            if attr & 0x20 != 0 {
                result.push("ARCHIVE".to_string());
            }
            if attr & 0x400 != 0 {
                result.push("REPARSE_POINT".to_string());
            }
        }
    }

    if result.is_empty() {
        result.push("NORMAL".to_string());
    }

    result
}

fn classify_status(target_real: &str) -> LinkStatus {
    match fs::metadata(target_real) {
        Ok(_) => LinkStatus::Ok,
        Err(error) => match error.kind() {
            std::io::ErrorKind::PermissionDenied => LinkStatus::AccessDenied,
            std::io::ErrorKind::NotFound => LinkStatus::Broken("target does not exist".to_string()),
            _ => LinkStatus::Broken(error.to_string()),
        },
    }
}

#[tauri::command]
pub fn get_link_details(path: String) -> Result<LinkDetails, String> {
    let metadata = fs::symlink_metadata(&path).map_err(|e| format!("Failed to read metadata: {e}"))?;

    let target_stored = fs::read_link(&path)
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.clone());
    let target_real = resolve_target(&path, &target_stored);

    Ok(LinkDetails {
        path: path.clone(),
        target_real: target_real.clone(),
        target_stored,
        link_type: detect_link_type(&path),
        object_type: if metadata.is_dir() {
            ObjectType::Directory
        } else {
            ObjectType::File
        },
        created_at: iso_time(metadata.created()),
        modified_at: iso_time(metadata.modified()),
        owner: resolve_owner(&path),
        attributes: map_attributes(&path),
        status: classify_status(&target_real),
    })
}
