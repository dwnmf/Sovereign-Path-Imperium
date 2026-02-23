use std::process::Command;

fn ps_single_quoted(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn ps_argument_list(args: &[String]) -> String {
    if args.is_empty() {
        return String::new();
    }

    let escaped = args
        .iter()
        .map(|arg| ps_single_quoted(arg))
        .collect::<Vec<_>>()
        .join(", ");

    format!(" -ArgumentList @({escaped})")
}

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
        .ok_or_else(|| "Invalid executable path".to_string())?;
    let current_args: Vec<String> = std::env::args().skip(1).collect();
    let command = format!(
        "$ErrorActionPreference = 'Stop'; Start-Process -FilePath {} -Verb RunAs{}",
        ps_single_quoted(exe_str),
        ps_argument_list(&current_args)
    );

    let status = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &command])
        .status()
        .map_err(|e| format!("Failed to relaunch as admin: {e}"))?;

    if !status.success() {
        return Err(format!(
            "Failed to relaunch as admin (PowerShell exit code: {})",
            status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        ));
    }

    std::process::exit(0);
}
