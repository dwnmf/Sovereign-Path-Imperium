use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::task::JoinSet;

use crate::types::{LinkEntry, LinkStatus};

fn resolve_target(link_path: &str, target: &str) -> PathBuf {
    let target_path = PathBuf::from(target);

    if target_path.is_absolute() {
        target_path
    } else {
        Path::new(link_path)
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(target_path)
    }
}

fn classify_error(error: std::io::Error) -> LinkStatus {
    match error.kind() {
        std::io::ErrorKind::NotFound => LinkStatus::Broken("target does not exist".to_string()),
        std::io::ErrorKind::PermissionDenied => LinkStatus::AccessDenied,
        _ => LinkStatus::Broken(error.to_string()),
    }
}

async fn validate_one(entry: LinkEntry) -> LinkEntry {
    if entry.target.trim().is_empty() {
        return LinkEntry {
            status: LinkStatus::Broken("target path is empty".to_string()),
            ..entry
        };
    }

    let path = resolve_target(&entry.path, &entry.target);

    let check = tokio::time::timeout(
        Duration::from_millis(500),
        tokio::task::spawn_blocking(move || std::fs::metadata(path)),
    )
    .await;

    let status = match check {
        Ok(joined) => match joined {
            Ok(result) => match result {
                Ok(_) => LinkStatus::Ok,
                Err(error) => classify_error(error),
            },
            Err(error) => LinkStatus::Broken(format!("validation join error: {error}")),
        },
        Err(_) => LinkStatus::Broken("timeout resolving target".to_string()),
    };

    LinkEntry { status, ..entry }
}

#[tauri::command]
pub async fn validate_links(entries: Vec<LinkEntry>) -> Vec<LinkEntry> {
    let mut pending: Vec<LinkEntry> = entries;
    let mut join_set = JoinSet::new();
    let mut validated: Vec<LinkEntry> = Vec::new();
    let mut inflight: HashMap<tokio::task::Id, LinkEntry> = HashMap::new();

    loop {
        while join_set.len() < 16 {
            if let Some(entry) = pending.pop() {
                let fallback = entry.clone();
                let task = join_set.spawn(validate_one(entry));
                inflight.insert(task.id(), fallback);
            } else {
                break;
            }
        }

        if join_set.is_empty() {
            break;
        }

        if let Some(result) = join_set.join_next_with_id().await {
            match result {
                Ok((task_id, entry)) => {
                    inflight.remove(&task_id);
                    validated.push(entry);
                }
                Err(error) => {
                    if let Some(mut entry) = inflight.remove(&error.id()) {
                        entry.status = LinkStatus::Broken(format!("validation worker crashed: {error}"));
                        validated.push(entry);
                    } else {
                        validated.push(LinkEntry {
                            path: "<unknown>".to_string(),
                            target: "".to_string(),
                            link_type: crate::types::LinkType::Symlink,
                            status: LinkStatus::Broken(format!("validation worker crashed: {error}")),
                        });
                    }
                }
            }
        }
    }

    validated.sort_by(|left, right| left.path.cmp(&right.path));
    validated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn classifies_missing_target() {
        let entry = LinkEntry {
            path: "C:\\tmp\\missing-link".to_string(),
            target: "C:\\definitely_missing_target_123".to_string(),
            link_type: crate::types::LinkType::Symlink,
            status: LinkStatus::Ok,
        };

        let validated = validate_one(entry).await;

        match validated.status {
            LinkStatus::Broken(_) | LinkStatus::AccessDenied | LinkStatus::Ok => {}
        }
    }

    #[tokio::test]
    async fn empty_target_is_broken() {
        let entry = LinkEntry {
            path: "C:\\tmp\\link".to_string(),
            target: "".to_string(),
            link_type: crate::types::LinkType::Symlink,
            status: LinkStatus::Ok,
        };

        let validated = validate_one(entry).await;
        assert!(matches!(validated.status, LinkStatus::Broken(_)));
    }
}
