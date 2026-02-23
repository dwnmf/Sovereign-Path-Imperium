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

fn decode_utf16le_if_applicable(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return Some(String::new());
    }

    let mut body = bytes;
    let has_bom = body.starts_with(&[0xFF, 0xFE]);
    if has_bom {
        body = &body[2..];
    }

    if body.len() % 2 != 0 {
        return None;
    }

    let looks_utf16 = has_bom
        || body
            .iter()
            .skip(1)
            .step_by(2)
            .take(64)
            .all(|byte| *byte == 0);

    if !looks_utf16 {
        return None;
    }

    let utf16: Vec<u16> = body
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();

    Some(String::from_utf16_lossy(&utf16))
}

fn decode_powershell_text(bytes: &[u8]) -> String {
    decode_utf16le_if_applicable(bytes).unwrap_or_else(|| String::from_utf8_lossy(bytes).to_string())
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
        let stderr = decode_powershell_text(&output.stderr);
        let message = stderr.trim();
        if message.is_empty() {
            return Err(format!(
                "Volume command failed with status code {:?}",
                output.status.code()
            ));
        }

        return Err(format!("Volume command failed: {message}"));
    }

    let payload = decode_powershell_text(&output.stdout);
    let payload = payload.trim_start_matches('\u{feff}');
    let rows = parse_json_or_array::<PsVolume>(payload)?;

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
