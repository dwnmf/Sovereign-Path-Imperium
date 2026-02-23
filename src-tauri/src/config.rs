use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const CONFIG_FILE_NAME: &str = "config.toml";
const CONFIG_PREVIOUS_FILE_NAME: &str = "config.toml.prev";
const CONFIG_TEMP_FILE_NAME: &str = "config.toml.tmp";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub scan: ScanConfig,
    pub ui: UiConfig,
    pub shell: ShellConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ScanConfig {
    pub default_volume: String,
    pub excluded_paths: Vec<String>,
    pub auto_scan_on_start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UiConfig {
    pub remember_filters: bool,
    pub last_filter_type: String,
    pub last_filter_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ShellConfig {
    pub context_menu_registered: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            scan: ScanConfig::default(),
            ui: UiConfig::default(),
            shell: ShellConfig::default(),
        }
    }
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            default_volume: default_system_drive(),
            excluded_paths: vec!["C:\\Windows\\WinSxS".to_string()],
            auto_scan_on_start: false,
        }
    }
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            remember_filters: true,
            last_filter_type: "All".to_string(),
            last_filter_status: "All".to_string(),
        }
    }
}

impl Default for ShellConfig {
    fn default() -> Self {
        Self {
            context_menu_registered: false,
        }
    }
}

fn default_system_drive() -> String {
    std::env::var("SystemDrive")
        .ok()
        .map(|value| value.trim().trim_end_matches('\\').to_string())
        .filter(|value| value.len() == 2 && value.ends_with(':'))
        .unwrap_or_else(|| "C:".to_string())
}

fn default_config() -> Config {
    Config::default()
}

fn symview_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    let dir = home.join("symview");

    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config directory: {e}"))?;

    Ok(dir)
}

fn config_path() -> Result<PathBuf, String> {
    Ok(symview_dir()?.join(CONFIG_FILE_NAME))
}

fn previous_config_path() -> Result<PathBuf, String> {
    Ok(symview_dir()?.join(CONFIG_PREVIOUS_FILE_NAME))
}

fn temp_config_path() -> Result<PathBuf, String> {
    Ok(symview_dir()?.join(CONFIG_TEMP_FILE_NAME))
}

fn read_config_file(path: &Path) -> Result<Config, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read config from {}: {e}", path.display()))?;

    toml::from_str::<Config>(&content)
        .map_err(|e| format!("Failed to parse config from {}: {e}", path.display()))
}

fn write_temp_config(path: &Path, content: &str) -> Result<(), String> {
    let mut file =
        fs::File::create(path).map_err(|e| format!("Failed to create temp config: {e}"))?;

    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write temp config: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync temp config: {e}"))?;

    Ok(())
}

fn stash_corrupt_config(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let corrupt_path = path.with_file_name(format!("config.toml.corrupt-{timestamp}.toml"));

    fs::rename(path, &corrupt_path).map_err(|e| {
        format!(
            "Failed to preserve corrupt config {} as {}: {e}",
            path.display(),
            corrupt_path.display()
        )
    })
}

pub fn load_config() -> Result<Config, String> {
    let path = config_path()?;
    let previous_path = previous_config_path()?;

    if path.exists() {
        if let Ok(config) = read_config_file(&path) {
            return Ok(config);
        }

        if previous_path.exists() {
            if let Ok(config) = read_config_file(&previous_path) {
                let _ = stash_corrupt_config(&path);
                save_config(config.clone())?;
                return Ok(config);
            }
        }

        let _ = stash_corrupt_config(&path);

        let config = default_config();
        save_config(config.clone())?;
        return Ok(config);
    }

    if previous_path.exists() {
        if let Ok(config) = read_config_file(&previous_path) {
            save_config(config.clone())?;
            return Ok(config);
        }
    }

    let config = default_config();
    save_config(config.clone())?;
    Ok(config)
}

pub fn save_config(config: Config) -> Result<(), String> {
    let serialized = toml::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;

    let path = config_path()?;
    let previous_path = previous_config_path()?;
    let temp_path = temp_config_path()?;

    write_temp_config(&temp_path, &serialized)?;

    if path.exists() {
        if previous_path.exists() {
            fs::remove_file(&previous_path)
                .map_err(|e| format!("Failed to rotate previous config backup: {e}"))?;
        }

        fs::rename(&path, &previous_path)
            .map_err(|e| format!("Failed to create previous config backup: {e}"))?;
    }

    if let Err(rename_error) = fs::rename(&temp_path, &path) {
        if previous_path.exists() {
            let _ = fs::rename(&previous_path, &path);
        }
        let _ = fs::remove_file(&temp_path);

        return Err(format!("Failed to finalize config write: {rename_error}"));
    }

    Ok(())
}

#[tauri::command]
pub fn load_config_command() -> Result<Config, String> {
    load_config()
}

#[tauri::command]
pub fn save_config_command(config: Config) -> Result<(), String> {
    save_config(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_roundtrip() {
        let config = default_config();
        let serialized = toml::to_string(&config).expect("serialize");
        let parsed = toml::from_str::<Config>(&serialized).expect("parse");
        assert_eq!(parsed.scan.default_volume, config.scan.default_volume);
    }

    #[test]
    fn partial_config_uses_defaults() {
        let input = r#"
            [scan]
            default_volume = "D:"
        "#;

        let parsed = toml::from_str::<Config>(input).expect("parse partial config");

        assert_eq!(parsed.scan.default_volume, "D:");
        assert_eq!(parsed.scan.excluded_paths, vec!["C:\\Windows\\WinSxS".to_string()]);
        assert!(!parsed.scan.auto_scan_on_start);
        assert!(parsed.ui.remember_filters);
        assert_eq!(parsed.ui.last_filter_type, "All");
        assert_eq!(parsed.ui.last_filter_status, "All");
        assert!(!parsed.shell.context_menu_registered);
    }
}
