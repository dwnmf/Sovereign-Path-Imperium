use std::env;

use winreg::enums::HKEY_CLASSES_ROOT;
use winreg::RegKey;

fn shell_key_paths() -> [&'static str; 2] {
    ["*\\shell\\symview", "Directory\\shell\\symview"]
}

#[tauri::command]
pub fn register_shell_integration() -> Result<(), String> {
    let exe = env::current_exe().map_err(|e| format!("Failed to resolve current executable: {e}"))?;
    let exe_text = exe
        .to_str()
        .ok_or_else(|| "Executable path contains invalid UTF-8".to_string())?
        .replace('"', "\\\"");

    let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);

    for key_path in shell_key_paths() {
        let (key, _) = hkcr
            .create_subkey(key_path)
            .map_err(|e| format!("Failed to create key {key_path}: {e}"))?;

        key.set_value("", &"Open in symview")
            .map_err(|e| format!("Failed to set menu text for {key_path}: {e}"))?;
        key.set_value("Icon", &format!("{exe_text},0"))
            .map_err(|e| format!("Failed to set icon for {key_path}: {e}"))?;

        let command_path = format!("{key_path}\\command");
        let (command_key, _) = hkcr
            .create_subkey(&command_path)
            .map_err(|e| format!("Failed to create command key {command_path}: {e}"))?;

        command_key
            .set_value("", &format!("\"{exe_text}\" --path \"%1\""))
            .map_err(|e| format!("Failed to set command for {command_path}: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn unregister_shell_integration() -> Result<(), String> {
    let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);

    for key_path in shell_key_paths() {
        let _ = hkcr.delete_subkey_all(key_path);
    }

    Ok(())
}

#[tauri::command]
pub fn is_shell_integration_registered() -> Result<bool, String> {
    let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);

    for key_path in shell_key_paths() {
        if hkcr.open_subkey(key_path).is_err() {
            return Ok(false);
        }
    }

    Ok(true)
}
