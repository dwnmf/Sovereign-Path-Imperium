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
