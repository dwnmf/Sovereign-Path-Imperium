use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub scan: ScanConfig,
    pub ui: UiConfig,
    pub shell: ShellConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanConfig {
    pub default_volume: String,
    pub excluded_paths: Vec<String>,
    pub auto_scan_on_start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    pub remember_filters: bool,
    pub last_filter_type: String,
    pub last_filter_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellConfig {
    pub context_menu_registered: bool,
}

fn default_config() -> Config {
    Config {
        scan: ScanConfig {
            default_volume: "C:".to_string(),
            excluded_paths: vec!["C:\\Windows\\WinSxS".to_string()],
            auto_scan_on_start: true,
        },
        ui: UiConfig {
            remember_filters: true,
            last_filter_type: "All".to_string(),
            last_filter_status: "All".to_string(),
        },
        shell: ShellConfig {
            context_menu_registered: false,
        },
    }
}

fn symview_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    let dir = home.join("symview");

    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config directory: {e}"))?;
    }

    Ok(dir)
}

fn config_path() -> Result<PathBuf, String> {
    Ok(symview_dir()?.join("config.toml"))
}

pub fn load_config() -> Result<Config, String> {
    let path = config_path()?;

    if !path.exists() {
        let config = default_config();
        save_config(config.clone())?;
        return Ok(config);
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {e}"))?;
    toml::from_str::<Config>(&content).map_err(|e| format!("Failed to parse config: {e}"))
}

pub fn save_config(config: Config) -> Result<(), String> {
    let serialized = toml::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;

    let path = config_path()?;
    fs::write(path, serialized).map_err(|e| format!("Failed to write config: {e}"))
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
        assert_eq!(parsed.scan.default_volume, "C:");
    }
}
