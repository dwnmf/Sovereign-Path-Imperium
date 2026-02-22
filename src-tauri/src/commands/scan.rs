use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::config::load_config;
use crate::types::{LinkEntry, LinkStatus, LinkType, ScanProgress};

fn normalize_drive(drive: &str) -> String {
    let trimmed = drive.trim();

    if trimmed.ends_with('\\') {
        trimmed.to_string()
    } else if trimmed.ends_with(':') {
        format!("{trimmed}\\")
    } else {
        format!("{trimmed}:\\")
    }
}

fn should_exclude(path: &Path, excluded: &[String]) -> bool {
    let text = path.to_string_lossy().to_lowercase();
    excluded
        .iter()
        .any(|item| !item.trim().is_empty() && text.starts_with(&item.to_lowercase()))
}

fn map_symlink_type(path: &Path, target: &str) -> LinkType {
    let resolved = if Path::new(target).is_absolute() {
        PathBuf::from(target)
    } else {
        path.parent()
            .unwrap_or_else(|| Path::new(""))
            .join(target)
    };

    if resolved.is_dir() {
        LinkType::Junction
    } else {
        LinkType::Symlink
    }
}

fn find_hardlink_target(path: &Path) -> String {
    let path_str = path.to_string_lossy().to_string();

    let output = Command::new("fsutil")
        .args(["hardlink", "list", &path_str])
        .output();

    match output {
        Ok(value) if value.status.success() => {
            let stdout = String::from_utf8_lossy(&value.stdout).to_string();
            let mut lines = stdout
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>();

            if lines.is_empty() {
                return path_str;
            }

            if let Some(candidate) = lines.iter().find(|item| item.to_lowercase() != path_str.to_lowercase()) {
                return (*candidate).to_string();
            }

            lines.remove(0).to_string()
        }
        _ => path_str,
    }
}

fn scan_with_walkdir(drive: &str, app: &AppHandle) -> Result<Vec<LinkEntry>, String> {
    let config = load_config()?;
    let root = normalize_drive(drive);
    let root_path = PathBuf::from(&root);

    if !root_path.exists() {
        return Err(format!("Volume path does not exist: {root}"));
    }

    let mut scanned = 0_u64;
    let mut found = 0_u64;
    let mut entries: Vec<LinkEntry> = Vec::new();

    for item in WalkDir::new(&root_path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = item.path().to_path_buf();

        if should_exclude(&path, &config.scan.excluded_paths) {
            continue;
        }

        scanned += 1;

        let metadata = match fs::symlink_metadata(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let file_type = metadata.file_type();

        if file_type.is_symlink() {
            let target = fs::read_link(&path)
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default();
            let link_type = map_symlink_type(&path, &target);

            entries.push(LinkEntry {
                path: path.to_string_lossy().to_string(),
                target,
                link_type,
                status: LinkStatus::Ok,
            });

            found += 1;
        } else {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;

                if !metadata.is_dir() && metadata.number_of_links() > 1 {
                    entries.push(LinkEntry {
                        path: path.to_string_lossy().to_string(),
                        target: find_hardlink_target(&path),
                        link_type: LinkType::Hardlink,
                        status: LinkStatus::Ok,
                    });

                    found += 1;
                }
            }
        }

        if scanned % 500 == 0 {
            let _ = app.emit(
                "scan:progress",
                ScanProgress {
                    scanned,
                    found,
                    current_path: path.to_string_lossy().to_string(),
                },
            );
        }
    }

    Ok(entries)
}

#[derive(Debug, Deserialize)]
struct JournalProbe {
    available: bool,
}

fn scan_with_usn(drive: &str, _app: &AppHandle) -> Result<Vec<LinkEntry>, String> {
    if !crate::elevation::is_elevated() {
        return Err("USN Journal requires elevated privileges".to_string());
    }

    let script = format!(
        "$vol='\\\\.\\{}'; try {{ fsutil usn queryjournal $vol | Out-Null; [pscustomobject]@{{available=$true}} }} catch {{ [pscustomobject]@{{available=$false}} }} | ConvertTo-Json -Compress",
        drive.trim_end_matches(':')
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| format!("Failed to probe USN journal: {e}"))?;

    if !output.status.success() {
        return Err("USN Journal probe failed".to_string());
    }

    let payload = String::from_utf8_lossy(&output.stdout).to_string();
    let probe = serde_json::from_str::<JournalProbe>(&payload)
        .map_err(|e| format!("Failed to parse USN probe output: {e}"))?;

    if !probe.available {
        return Err("USN Journal unavailable on this volume".to_string());
    }

    Err("USN Journal scanner is not enabled in this build, using walkdir fallback".to_string())
}

#[tauri::command]
pub async fn scan_volume(drive: String, app: AppHandle) -> Result<Vec<LinkEntry>, String> {
    let drive_for_scan = drive.clone();
    let app_for_scan = app.clone();

    let try_usn = tokio::task::spawn_blocking(move || scan_with_usn(&drive_for_scan, &app_for_scan))
        .await
        .map_err(|e| format!("USN task join error: {e}"))?;

    match try_usn {
        Ok(entries) => Ok(entries),
        Err(_) => {
            let drive_fallback = drive;
            tokio::task::spawn_blocking(move || scan_with_walkdir(&drive_fallback, &app))
                .await
                .map_err(|e| format!("walkdir task join error: {e}"))?
        }
    }
}
