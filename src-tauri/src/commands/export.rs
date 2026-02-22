use std::fs::File;
use std::io::{BufWriter, Write};

use tauri::{AppHandle, Emitter};
use tokio::task::JoinSet;

use crate::commands::details::get_link_details;
use crate::types::{ExportFormat, LinkEntry};

fn status_to_string(status: &crate::types::LinkStatus) -> String {
    match status {
        crate::types::LinkStatus::Ok => "Ok".to_string(),
        crate::types::LinkStatus::AccessDenied => "AccessDenied".to_string(),
        crate::types::LinkStatus::Broken(reason) => format!("Broken({reason})"),
    }
}

#[tauri::command]
pub async fn export_links(
    app: AppHandle,
    entries: Vec<LinkEntry>,
    format: ExportFormat,
    path: String,
) -> Result<(), String> {
    match format {
        ExportFormat::Csv => {
            let file = File::create(&path).map_err(|e| format!("Failed to create CSV file: {e}"))?;
            let mut writer = csv::Writer::from_writer(BufWriter::new(file));

            writer
                .write_record([
                    "link_path",
                    "target_stored",
                    "target_real",
                    "link_type",
                    "status",
                    "object_type",
                    "created_at",
                    "owner",
                ])
                .map_err(|e| format!("Failed to write CSV header: {e}"))?;

            for entry in entries {
                let details = get_link_details(entry.path.clone())?;

                writer
                    .write_record([
                        details.path,
                        details.target_stored,
                        details.target_real,
                        format!("{:?}", details.link_type),
                        status_to_string(&details.status),
                        format!("{:?}", details.object_type),
                        details.created_at,
                        details.owner,
                    ])
                    .map_err(|e| format!("Failed to write CSV row: {e}"))?;
            }

            writer
                .flush()
                .map_err(|e| format!("Failed to flush CSV writer: {e}"))?;
        }
        ExportFormat::Json => {
            let file = File::create(&path).map_err(|e| format!("Failed to create JSON file: {e}"))?;
            let mut writer = BufWriter::new(file);
            let total = entries.len() as u64;
            let mut processed = 0_u64;
            let mut first = true;

            writer
                .write_all(b"[")
                .map_err(|e| format!("Failed to start JSON array: {e}"))?;

            let mut pending = entries;
            let mut set = JoinSet::new();

            loop {
                while set.len() < 8 {
                    if let Some(entry) = pending.pop() {
                        set.spawn(async move { get_link_details(entry.path) });
                    } else {
                        break;
                    }
                }

                if set.is_empty() {
                    break;
                }

                if let Some(result) = set.join_next().await {
                    let details = result
                        .map_err(|e| format!("Export worker join error: {e}"))??;

                    if !first {
                        writer
                            .write_all(b",")
                            .map_err(|e| format!("Failed to write JSON separator: {e}"))?;
                    }

                    let json = serde_json::to_vec(&details)
                        .map_err(|e| format!("Failed to serialize JSON details: {e}"))?;
                    writer
                        .write_all(&json)
                        .map_err(|e| format!("Failed to write JSON row: {e}"))?;

                    first = false;
                    processed += 1;

                    let _ = app.emit("export:progress", serde_json::json!({
                        "processed": processed,
                        "total": total,
                    }));
                }
            }

            writer
                .write_all(b"]")
                .map_err(|e| format!("Failed to close JSON array: {e}"))?;
            writer
                .flush()
                .map_err(|e| format!("Failed to flush JSON writer: {e}"))?;
        }
    }

    Ok(())
}
