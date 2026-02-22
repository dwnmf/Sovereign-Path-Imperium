use std::process::Command;

#[tauri::command]
pub fn is_elevated() -> bool {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
        ])
        .output();

    match output {
        Ok(result) => String::from_utf8_lossy(&result.stdout)
            .trim()
            .eq_ignore_ascii_case("true"),
        Err(_) => false,
    }
}

#[tauri::command]
pub fn relaunch_as_admin() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("Unable to resolve current exe: {e}"))?;
    let exe_str = exe
        .to_str()
        .ok_or_else(|| "Invalid executable path".to_string())?
        .replace('"', "\\\"");

    let command = format!(
        "Start-Process -FilePath \"{exe_str}\" -Verb RunAs -ArgumentList $env:SYMVIEW_RELAUNCH_ARGS"
    );

    Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &command])
        .status()
        .map_err(|e| format!("Failed to relaunch as admin: {e}"))?;

    std::process::exit(0);
}
