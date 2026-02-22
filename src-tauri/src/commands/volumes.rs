use std::process::Command;

use serde::Deserialize;

use crate::types::VolumeInfo;

#[derive(Debug, Deserialize)]
struct PsVolume {
    letter: String,
    label: String,
    fs: String,
    total_bytes: u64,
    free_bytes: u64,
}

fn parse_json_or_array<T: for<'a> serde::Deserialize<'a>>(json: &str) -> Result<Vec<T>, String> {
    if json.trim().is_empty() {
        return Ok(Vec::new());
    }

    match serde_json::from_str::<Vec<T>>(json) {
        Ok(value) => Ok(value),
        Err(_) => serde_json::from_str::<T>(json)
            .map(|single| vec![single])
            .map_err(|e| format!("Failed to parse JSON output: {e}")),
    }
}

#[tauri::command]
pub fn list_volumes() -> Result<Vec<VolumeInfo>, String> {
    let script = r#"
      $ErrorActionPreference='Stop'
      $volumes = Get-Volume | Where-Object { $_.DriveLetter -and $_.FileSystem -eq 'NTFS' }
      $result = foreach ($v in $volumes) {
        [pscustomobject]@{
          letter = ([string]$v.DriveLetter + ':')
          label = [string]$v.FileSystemLabel
          fs = [string]$v.FileSystem
          total_bytes = [uint64]$v.Size
          free_bytes = [uint64]$v.SizeRemaining
        }
      }
      $result | Sort-Object letter | ConvertTo-Json -Compress
    "#;

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| format!("Failed to execute volume command: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let payload = String::from_utf8_lossy(&output.stdout).to_string();
    let rows = parse_json_or_array::<PsVolume>(&payload)?;

    Ok(rows
        .into_iter()
        .map(|row| VolumeInfo {
            letter: row.letter,
            label: row.label,
            fs: row.fs,
            total_bytes: row.total_bytes,
            free_bytes: row.free_bytes,
        })
        .collect())
}
