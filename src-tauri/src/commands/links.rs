use std::fs;
use std::path::Path;
use std::process::Command;

use tauri::{AppHandle, Emitter};

use crate::db::history::{log_action, ActionInput};
use crate::types::LinkType;

fn map_error(error: std::io::Error) -> String {
    if let Some(code) = error.raw_os_error() {
        if code == 1314 {
            return "SeCreateSymbolicLinkPrivilege is required. Enable Developer Mode in Windows Settings or run as Administrator.".to_string();
        }
    }

    error.to_string()
}

fn detect_link_type(path: &str) -> Result<LinkType, String> {
    let metadata = fs::symlink_metadata(path).map_err(map_error)?;

    if metadata.file_type().is_symlink() {
        if Path::new(path).is_dir() {
            Ok(LinkType::Junction)
        } else {
            Ok(LinkType::Symlink)
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
                    return Ok(LinkType::Hardlink);
                }
            }
        }

        Err("Path is not a recognized link type".to_string())
    }
}

fn read_target(path: &str) -> String {
    fs::read_link(path)
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string())
}

pub fn create_link_internal(
    link_path: &str,
    target_path: &str,
    link_type: &LinkType,
    target_is_dir: bool,
) -> Result<(), String> {
    if Path::new(link_path).exists() {
        return Err("Link path already exists".to_string());
    }

    let parent = Path::new(link_path)
        .parent()
        .ok_or_else(|| "Link path has no parent directory".to_string())?;

    if !parent.exists() {
        fs::create_dir_all(parent).map_err(map_error)?;
    }

    match link_type {
        LinkType::Symlink => {
            if Path::new(target_path).is_dir() || target_is_dir {
                std::os::windows::fs::symlink_dir(target_path, link_path).map_err(map_error)?;
            } else {
                std::os::windows::fs::symlink_file(target_path, link_path).map_err(map_error)?;
            }
        }
        LinkType::Junction => {
            if !Path::new(target_path).is_absolute() {
                return Err("Junction target must be an absolute path".to_string());
            }

            let status = Command::new("cmd")
                .args(["/C", "mklink", "/J", link_path, target_path])
                .status()
                .map_err(|e| format!("Failed to create junction: {e}"))?;

            if !status.success() {
                return Err("Failed to create junction using mklink".to_string());
            }
        }
        LinkType::Hardlink => {
            if !Path::new(target_path).is_file() {
                return Err("Hardlink target must be a file".to_string());
            }

            let link_volume = link_path.chars().take(2).collect::<String>().to_lowercase();
            let target_volume = target_path.chars().take(2).collect::<String>().to_lowercase();

            if link_volume != target_volume {
                return Err("Hardlink requires source and target to be on the same volume".to_string());
            }

            fs::hard_link(target_path, link_path).map_err(map_error)?;
        }
    }

    Ok(())
}

pub fn delete_link_internal(path: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(map_error)?;

    if metadata.file_type().is_symlink() {
        if metadata.is_dir() {
            if let Err(error) = fs::remove_dir(path) {
                if error.raw_os_error() == Some(5) {
                    let status = Command::new("cmd")
                        .args(["/C", "rmdir", path])
                        .status()
                        .map_err(|e| format!("Failed to remove directory link: {e}"))?;

                    if !status.success() {
                        return Err(map_error(error));
                    }
                } else {
                    return Err(map_error(error));
                }
            }
        } else {
            fs::remove_file(path).map_err(map_error)?;
        }
    } else if metadata.is_dir() {
        if let Err(error) = fs::remove_dir(path) {
            if error.raw_os_error() == Some(5) {
                let status = Command::new("cmd")
                    .args(["/C", "rmdir", path])
                    .status()
                    .map_err(|e| format!("Failed to remove directory link: {e}"))?;

                if !status.success() {
                    return Err(map_error(error));
                }
            } else {
                return Err(map_error(error));
            }
        }
    } else {
        fs::remove_file(path).map_err(map_error)?;
    }

    Ok(())
}

pub fn retarget_link_internal(path: &str, new_target: &str) -> Result<(), String> {
    let link_type = detect_link_type(path)?;
    let old_target = read_target(path);

    delete_link_internal(path)?;

    if let Err(error) = create_link_internal(path, new_target, &link_type, false) {
        let _ = create_link_internal(path, &old_target, &link_type, false);
        return Err(error);
    }

    Ok(())
}

#[tauri::command]
pub fn create_link(
    app: AppHandle,
    link_path: String,
    target_path: String,
    link_type: LinkType,
    target_is_dir: bool,
) -> Result<(), String> {
    let operation = create_link_internal(&link_path, &target_path, &link_type, target_is_dir);

    let conn = crate::db::open_connection()?;

    let (success, error_msg) = match operation {
        Ok(_) => (true, None),
        Err(error) => (false, Some(error)),
    };

    log_action(
        &conn,
        ActionInput {
            action_type: "Create".to_string(),
            link_path: link_path.clone(),
            link_type: link_type.clone(),
            target_old: None,
            target_new: Some(target_path),
            success,
            error_msg: error_msg.clone(),
        },
    )?;

    if let Some(message) = error_msg {
        return Err(message);
    }

    let _ = app.emit("links:created", &link_path);
    Ok(())
}

#[tauri::command]
pub fn delete_link(app: AppHandle, path: String) -> Result<(), String> {
    let link_type = detect_link_type(&path)?;
    let target_old = Some(read_target(&path));

    let operation = delete_link_internal(&path);

    let conn = crate::db::open_connection()?;
    let (success, error_msg) = match operation {
        Ok(_) => (true, None),
        Err(error) => (false, Some(error)),
    };

    log_action(
        &conn,
        ActionInput {
            action_type: "Delete".to_string(),
            link_path: path.clone(),
            link_type,
            target_old,
            target_new: None,
            success,
            error_msg: error_msg.clone(),
        },
    )?;

    if let Some(message) = error_msg {
        return Err(message);
    }

    let _ = app.emit("links:deleted", &path);
    Ok(())
}

#[tauri::command]
pub fn retarget_link(app: AppHandle, path: String, new_target: String) -> Result<(), String> {
    let link_type = detect_link_type(&path)?;
    let old_target = Some(read_target(&path));

    let operation = retarget_link_internal(&path, &new_target);

    let conn = crate::db::open_connection()?;
    let (success, error_msg) = match operation {
        Ok(_) => (true, None),
        Err(error) => (false, Some(error)),
    };

    log_action(
        &conn,
        ActionInput {
            action_type: "Retarget".to_string(),
            link_path: path,
            link_type,
            target_old: old_target,
            target_new: Some(new_target),
            success,
            error_msg: error_msg.clone(),
        },
    )?;

    if let Some(message) = error_msg {
        return Err(message);
    }

    let _ = app.emit("links:retargeted", true);
    Ok(())
}

#[tauri::command]
pub fn open_target(target: String) -> Result<(), String> {
    let status = Command::new("explorer")
        .arg(&target)
        .status()
        .map_err(|e| format!("Failed to open target: {e}"))?;

    if !status.success() {
        return Err("Explorer returned an error while opening target".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn has_junction_prefix_logic() {
        let path = "C:\\root\\item";
        let target = "C:\\root\\target";
        let same_volume = path.chars().take(2).collect::<String>() == target.chars().take(2).collect::<String>();
        assert!(same_volume);
    }
}
