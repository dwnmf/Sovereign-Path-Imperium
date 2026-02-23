use chrono::Utc;
use rusqlite::{params, Connection};
use tauri::AppHandle;

use crate::commands::links::{create_link_internal, delete_link_internal, retarget_link_internal};
use crate::types::{ActionRecord, LinkType};

const MAX_HISTORY_LIMIT: u32 = 1_000;

#[derive(Debug, Clone)]
pub struct ActionInput {
    pub action_type: String,
    pub link_path: String,
    pub link_type: LinkType,
    pub target_old: Option<String>,
    pub target_new: Option<String>,
    pub success: bool,
    pub error_msg: Option<String>,
}

fn link_type_to_text(link_type: &LinkType) -> &'static str {
    match link_type {
        LinkType::Symlink => "Symlink",
        LinkType::Junction => "Junction",
        LinkType::Hardlink => "Hardlink",
    }
}

fn link_type_from_text(value: &str) -> LinkType {
    match value {
        "Junction" => LinkType::Junction,
        "Hardlink" => LinkType::Hardlink,
        _ => LinkType::Symlink,
    }
}

pub fn log_action(conn: &Connection, action: ActionInput) -> Result<i64, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start transaction: {e}"))?;

    tx.execute(
        "
        INSERT INTO actions (
          action_type, link_path, link_type, target_old, target_new, timestamp, success, error_msg
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ",
        params![
            action.action_type,
            action.link_path,
            link_type_to_text(&action.link_type),
            action.target_old,
            action.target_new,
            Utc::now().to_rfc3339(),
            if action.success { 1 } else { 0 },
            action.error_msg
        ],
    )
    .map_err(|e| format!("Failed to insert action: {e}"))?;

    let id = tx.last_insert_rowid();

    tx.commit()
        .map_err(|e| format!("Failed to commit transaction: {e}"))?;

    Ok(id)
}

#[tauri::command]
pub fn get_history(limit: u32, offset: u32) -> Result<Vec<ActionRecord>, String> {
    let conn = crate::db::open_connection()?;
    let safe_limit = limit.min(MAX_HISTORY_LIMIT) as i64;
    let safe_offset = offset as i64;

    let mut stmt = conn
        .prepare(
            "
            SELECT id, action_type, link_path, link_type, target_old, target_new, timestamp, success, error_msg
            FROM actions
            ORDER BY id DESC
            LIMIT ?1 OFFSET ?2
            ",
        )
        .map_err(|e| format!("Failed to prepare history query: {e}"))?;

    let rows = stmt
        .query_map(params![safe_limit, safe_offset], |row| {
            Ok(ActionRecord {
                id: row.get::<_, i64>(0)?,
                action_type: row.get::<_, String>(1)?,
                link_path: row.get::<_, String>(2)?,
                link_type: link_type_from_text(&row.get::<_, String>(3)?),
                target_old: row.get::<_, Option<String>>(4)?,
                target_new: row.get::<_, Option<String>>(5)?,
                timestamp: row.get::<_, String>(6)?,
                success: row.get::<_, i64>(7)? == 1,
                error_msg: row.get::<_, Option<String>>(8)?,
            })
        })
        .map_err(|e| format!("Failed to query history: {e}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to decode history rows: {e}"))
}

type UndoCandidate = (String, String, String, Option<String>, Option<String>);

fn latest_undo_candidate(conn: &Connection) -> Result<Option<UndoCandidate>, String> {
    let mut stmt = conn
        .prepare(
            "
            SELECT action_type, link_path, link_type, target_old, target_new
            FROM actions
            WHERE success = 1
            ORDER BY id DESC
            ",
        )
        .map_err(|e| format!("Failed to prepare undo query: {e}"))?;

    let mut rows = stmt
        .query([])
        .map_err(|e| format!("Failed to execute undo query: {e}"))?;

    let mut pending_undo_count = 0_u32;

    while let Some(row) = rows
        .next()
        .map_err(|e| format!("Failed to decode undo query row: {e}"))?
    {
        let action_type = row
            .get::<_, String>(0)
            .map_err(|e| format!("Failed to read undo action type: {e}"))?;

        if action_type == "Undo" {
            pending_undo_count = pending_undo_count.saturating_add(1);
            continue;
        }

        if pending_undo_count > 0 {
            pending_undo_count -= 1;
            continue;
        }

        return Ok(Some((
            action_type,
            row.get::<_, String>(1)
                .map_err(|e| format!("Failed to read undo link path: {e}"))?,
            row.get::<_, String>(2)
                .map_err(|e| format!("Failed to read undo link type: {e}"))?,
            row.get::<_, Option<String>>(3)
                .map_err(|e| format!("Failed to read undo old target: {e}"))?,
            row.get::<_, Option<String>>(4)
                .map_err(|e| format!("Failed to read undo new target: {e}"))?,
        )));
    }

    Ok(None)
}

#[tauri::command]
pub fn undo_last(_app: AppHandle) -> Result<(), String> {
    let conn = crate::db::open_connection()?;

    let row = latest_undo_candidate(&conn)?.ok_or_else(|| "Nothing to undo".to_string())?;

    let link_type = link_type_from_text(&row.2);
    let result = match row.0.as_str() {
        "Delete" => {
            let target = row
                .3
                .clone()
                .ok_or_else(|| "Delete action is missing previous target".to_string())?;

            create_link_internal(&row.1, &target, &link_type, false)
        }
        "Create" => delete_link_internal(&row.1),
        "Retarget" => {
            let old_target = row
                .3
                .clone()
                .ok_or_else(|| "Retarget action is missing old target".to_string())?;
            retarget_link_internal(&row.1, &old_target)
        }
        other => Err(format!("Undo is not supported for action: {other}")),
    };

    let (success, error_msg) = match result {
        Ok(_) => (true, None),
        Err(error) => (false, Some(error)),
    };

    log_action(
        &conn,
        ActionInput {
            action_type: "Undo".to_string(),
            link_path: row.1,
            link_type,
            target_old: row.3,
            target_new: row.4,
            success,
            error_msg: error_msg.clone(),
        },
    )?;

    if let Some(message) = error_msg {
        return Err(message);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn action(action_type: &str, link_path: &str, success: bool) -> ActionInput {
        ActionInput {
            action_type: action_type.to_string(),
            link_path: link_path.to_string(),
            link_type: LinkType::Symlink,
            target_old: Some("C:\\tmp\\old".to_string()),
            target_new: Some("C:\\tmp\\new".to_string()),
            success,
            error_msg: None,
        }
    }

    #[test]
    fn insert_and_query_in_memory() {
        let conn = Connection::open_in_memory().expect("in-memory DB");
        crate::db::migrations::run(&conn).expect("run migrations");

        log_action(
            &conn,
            ActionInput {
                action_type: "Create".to_string(),
                link_path: "C:\\tmp\\a".to_string(),
                link_type: LinkType::Symlink,
                target_old: None,
                target_new: Some("C:\\tmp\\b".to_string()),
                success: true,
                error_msg: None,
            },
        )
        .expect("log action");

        let mut stmt = conn
            .prepare("SELECT COUNT(*) FROM actions")
            .expect("prepare count query");
        let count: i64 = stmt.query_row([], |row| row.get(0)).expect("read count");

        assert_eq!(count, 1);
    }

    #[test]
    fn undo_candidate_skips_actions_already_consumed_by_undo() {
        let conn = Connection::open_in_memory().expect("in-memory DB");
        crate::db::migrations::run(&conn).expect("run migrations");

        log_action(&conn, action("Create", "C:\\tmp\\first", true)).expect("insert first action");
        log_action(&conn, action("Create", "C:\\tmp\\second", true)).expect("insert second action");
        log_action(&conn, action("Undo", "C:\\tmp\\second", true)).expect("insert undo action");

        let candidate = latest_undo_candidate(&conn)
            .expect("load undo candidate")
            .expect("candidate exists");

        assert_eq!(candidate.0, "Create");
        assert_eq!(candidate.1, "C:\\tmp\\first");
    }

    #[test]
    fn undo_candidate_ignores_failed_undo_rows() {
        let conn = Connection::open_in_memory().expect("in-memory DB");
        crate::db::migrations::run(&conn).expect("run migrations");

        log_action(&conn, action("Create", "C:\\tmp\\first", true)).expect("insert action");
        log_action(&conn, action("Undo", "C:\\tmp\\first", false)).expect("insert failed undo");

        let candidate = latest_undo_candidate(&conn)
            .expect("load undo candidate")
            .expect("candidate exists");

        assert_eq!(candidate.0, "Create");
        assert_eq!(candidate.1, "C:\\tmp\\first");
    }
}
