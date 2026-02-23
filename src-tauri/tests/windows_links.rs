#![cfg(target_os = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use symview::commands::links::{create_link_internal, delete_link_internal};
use symview::commands::scan::scan_path_with_walkdir_for_tests;
use symview::commands::shell::{
    is_shell_integration_registered, register_shell_integration, unregister_shell_integration,
};
use symview::commands::validate::validate_links;
use symview::elevation::is_elevated;
use symview::types::{LinkStatus, LinkType};

fn temp_root(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();

    path.push(format!("symview_it_{name}_{nonce}_{}", std::process::id()));
    path
}

fn remove_if_exists(path: &Path) {
    if path.exists() {
        let _ = fs::remove_dir_all(path);
    }
}

fn find_entry(path: &Path, entries: &[symview::types::LinkEntry]) -> Option<symview::types::LinkEntry> {
    let expected = path.to_string_lossy().to_string();
    entries
        .iter()
        .find(|entry| entry.path.eq_ignore_ascii_case(&expected))
        .cloned()
}

fn is_access_denied(error: &str) -> bool {
    error.contains("os error 5")
        || error.to_ascii_lowercase().contains("access is denied")
        || error.contains("Отказано в доступе")
}

fn is_broken_status(status: &LinkStatus) -> bool {
    matches!(status, LinkStatus::Broken(_))
}

fn same_path(path: &Path, expected: &Path) -> bool {
    path.to_string_lossy()
        .eq_ignore_ascii_case(&expected.to_string_lossy())
}

#[tokio::test]
async fn symlink_scan_validate_delete_cycle() -> Result<(), Box<dyn std::error::Error>> {
    let root = temp_root("symlink_cycle");
    fs::create_dir_all(&root)?;

    let target = root.join("target.txt");
    let link = root.join("link.txt");
    fs::write(&target, b"symview integration test")?;

    let link_text = link.to_string_lossy().to_string();
    let target_text = target.to_string_lossy().to_string();

    match create_link_internal(&link_text, &target_text, &LinkType::Symlink, false) {
        Ok(()) => {}
        Err(error) if error.contains("SeCreateSymbolicLinkPrivilege") => {
            eprintln!("Skipping symlink integration test: {error}");
            remove_if_exists(&root);
            return Ok(());
        }
        Err(error) => {
            remove_if_exists(&root);
            return Err(error.into());
        }
    }

    let scanned = scan_path_with_walkdir_for_tests(root.to_string_lossy().as_ref())?;
    let link_entry = find_entry(&link, &scanned).ok_or("Created symlink was not found by walkdir scan")?;

    let validated = validate_links(vec![link_entry]).await;
    assert_eq!(validated.len(), 1, "Expected a single validation result");
    assert!(
        matches!(validated[0].status, LinkStatus::Ok),
        "Expected validation status Ok, got {:?}",
        validated[0].status
    );

    delete_link_internal(&link_text)?;
    assert!(!link.exists(), "Link path should be removed after delete");
    assert!(target.exists(), "Target path should remain after delete");

    remove_if_exists(&root);
    Ok(())
}

#[tokio::test]
async fn junction_scan_validate_delete_cycle() -> Result<(), Box<dyn std::error::Error>> {
    let root = temp_root("junction_cycle");
    fs::create_dir_all(&root)?;

    let target_dir = root.join("target-dir");
    let link_dir = root.join("junction-link");

    fs::create_dir_all(&target_dir)?;
    fs::write(target_dir.join("inside.txt"), b"junction target")?;

    let link_text = link_dir.to_string_lossy().to_string();
    let target_text = target_dir.to_string_lossy().to_string();

    create_link_internal(&link_text, &target_text, &LinkType::Junction, false)
        .map_err(|e| format!("create junction failed: {e}"))?;

    let scanned = scan_path_with_walkdir_for_tests(root.to_string_lossy().as_ref())
        .map_err(|e| format!("scan failed: {e}"))?;
    let link_entry =
        find_entry(&link_dir, &scanned).ok_or("Created junction was not found by walkdir scan")?;
    assert!(
        matches!(link_entry.link_type, LinkType::Junction),
        "Expected junction type from scan, got {:?}",
        link_entry.link_type
    );

    let validated = validate_links(vec![link_entry]).await;
    assert_eq!(validated.len(), 1, "Expected a single validation result");
    assert!(
        matches!(validated[0].status, LinkStatus::Ok),
        "Expected validation status Ok, got {:?}",
        validated[0].status
    );

    let marker = target_dir.join("inside.txt");
    if marker.exists() {
        fs::remove_file(&marker).map_err(|e| format!("cleanup marker failed: {e}"))?;
    }

    if let Err(error) = delete_link_internal(&link_text) {
        if is_access_denied(&error) {
            eprintln!("Skipping junction delete assertion due access restrictions: {error}");
            remove_if_exists(&root);
            return Ok(());
        }

        remove_if_exists(&root);
        return Err(format!("delete junction failed: {error}").into());
    }
    assert!(!link_dir.exists(), "Junction path should be removed after delete");
    assert!(
        target_dir.exists(),
        "Junction target directory should remain after deleting junction"
    );

    remove_if_exists(&root);
    Ok(())
}

#[tokio::test]
async fn broken_symlink_is_scanned_and_marked_broken() -> Result<(), Box<dyn std::error::Error>> {
    let root = temp_root("broken_symlink_cycle");
    fs::create_dir_all(&root)?;

    let target = root.join("target.txt");
    let link = root.join("broken-link.txt");
    fs::write(&target, b"symview broken symlink integration test")?;

    let link_text = link.to_string_lossy().to_string();
    let target_text = target.to_string_lossy().to_string();

    match create_link_internal(&link_text, &target_text, &LinkType::Symlink, false) {
        Ok(()) => {}
        Err(error) if error.contains("SeCreateSymbolicLinkPrivilege") => {
            eprintln!("Skipping broken symlink integration test: {error}");
            remove_if_exists(&root);
            return Ok(());
        }
        Err(error) => {
            remove_if_exists(&root);
            return Err(error.into());
        }
    }

    fs::remove_file(&target)?;

    let scanned = scan_path_with_walkdir_for_tests(root.to_string_lossy().as_ref())?;
    let link_entry =
        find_entry(&link, &scanned).ok_or("Broken symlink was not found by walkdir scan")?;

    assert!(
        matches!(link_entry.link_type, LinkType::Symlink),
        "Expected symlink type from scan, got {:?}",
        link_entry.link_type
    );

    let validated = validate_links(vec![link_entry]).await;
    assert_eq!(validated.len(), 1, "Expected a single validation result");
    assert!(
        is_broken_status(&validated[0].status),
        "Expected validation status Broken, got {:?}",
        validated[0].status
    );

    delete_link_internal(&link_text)?;
    assert!(!link.exists(), "Symlink path should be removed after delete");

    remove_if_exists(&root);
    Ok(())
}

#[tokio::test]
async fn hardlink_scan_validate_delete_cycle() -> Result<(), Box<dyn std::error::Error>> {
    let root = temp_root("hardlink_cycle");
    fs::create_dir_all(&root)?;

    let original = root.join("original.txt");
    let sibling = root.join("sibling-hardlink.txt");
    fs::write(&original, b"symview hardlink integration test")?;

    let sibling_text = sibling.to_string_lossy().to_string();
    let original_text = original.to_string_lossy().to_string();

    create_link_internal(&sibling_text, &original_text, &LinkType::Hardlink, false)?;

    let scanned = scan_path_with_walkdir_for_tests(root.to_string_lossy().as_ref())?;
    let hardlink_entry = scanned
        .iter()
        .find(|entry| {
            matches!(entry.link_type, LinkType::Hardlink)
                && (entry.path.eq_ignore_ascii_case(&original_text)
                    || entry.path.eq_ignore_ascii_case(&sibling_text))
        })
        .cloned()
        .ok_or("Hardlink entry was not found by walkdir scan")?;

    let validated = validate_links(vec![hardlink_entry.clone()]).await;
    assert_eq!(validated.len(), 1, "Expected a single validation result");
    assert!(
        matches!(validated[0].status, LinkStatus::Ok),
        "Expected validation status Ok, got {:?}",
        validated[0].status
    );

    let deleted_path = PathBuf::from(&hardlink_entry.path);
    let counterpart = if same_path(&deleted_path, &original) {
        sibling.clone()
    } else {
        original.clone()
    };

    delete_link_internal(&hardlink_entry.path)?;
    assert!(
        !deleted_path.exists(),
        "Deleted hardlink path should be removed after delete"
    );
    assert!(
        counterpart.exists(),
        "Companion hardlink should remain after deleting one link"
    );

    remove_if_exists(&root);
    Ok(())
}

#[tokio::test]
async fn broken_junction_keeps_type_and_reports_broken() -> Result<(), Box<dyn std::error::Error>> {
    let root = temp_root("broken_junction_cycle");
    fs::create_dir_all(&root)?;

    let target_dir = root.join("target-dir");
    let link_dir = root.join("broken-junction-link");

    fs::create_dir_all(&target_dir)?;
    fs::write(target_dir.join("inside.txt"), b"junction target")?;

    let link_text = link_dir.to_string_lossy().to_string();
    let target_text = target_dir.to_string_lossy().to_string();

    create_link_internal(&link_text, &target_text, &LinkType::Junction, false)
        .map_err(|e| format!("create junction failed: {e}"))?;

    fs::remove_dir_all(&target_dir)?;

    let scanned = scan_path_with_walkdir_for_tests(root.to_string_lossy().as_ref())
        .map_err(|e| format!("scan failed: {e}"))?;
    let link_entry = find_entry(&link_dir, &scanned)
        .ok_or("Broken junction was not found by walkdir scan")?;

    assert!(
        matches!(link_entry.link_type, LinkType::Junction),
        "Expected broken junction to keep Junction type, got {:?}",
        link_entry.link_type
    );

    let validated = validate_links(vec![link_entry]).await;
    assert_eq!(validated.len(), 1, "Expected a single validation result");
    assert!(
        is_broken_status(&validated[0].status),
        "Expected validation status Broken, got {:?}",
        validated[0].status
    );

    if let Err(error) = delete_link_internal(&link_text) {
        if is_access_denied(&error) {
            eprintln!("Skipping broken junction delete assertion due access restrictions: {error}");
            remove_if_exists(&root);
            return Ok(());
        }

        remove_if_exists(&root);
        return Err(format!("delete broken junction failed: {error}").into());
    }

    assert!(!link_dir.exists(), "Broken junction path should be removed after delete");

    remove_if_exists(&root);
    Ok(())
}

struct ShellIntegrationRestore {
    initially_registered: bool,
}

impl Drop for ShellIntegrationRestore {
    fn drop(&mut self) {
        if !is_elevated() {
            return;
        }

        if self.initially_registered {
            let _ = register_shell_integration();
        } else {
            let _ = unregister_shell_integration();
        }
    }
}

#[test]
fn shell_integration_roundtrip_if_elevated() -> Result<(), Box<dyn std::error::Error>> {
    if !is_elevated() {
        eprintln!("Skipping shell integration test: process is not elevated.");
        return Ok(());
    }

    let guard = ShellIntegrationRestore {
        initially_registered: is_shell_integration_registered()?,
    };

    unregister_shell_integration()?;
    assert!(
        !is_shell_integration_registered()?,
        "Shell integration should be removed after unregister"
    );

    register_shell_integration()?;
    assert!(
        is_shell_integration_registered()?,
        "Shell integration should be present after register"
    );

    unregister_shell_integration()?;
    assert!(
        !is_shell_integration_registered()?,
        "Shell integration should be removed after second unregister"
    );

    drop(guard);
    Ok(())
}
