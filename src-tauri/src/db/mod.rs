pub mod history;
pub mod migrations;

use std::path::PathBuf;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};

pub fn db_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    let dir = home.join("symview");

    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app directory: {e}"))?;

    Ok(dir.join("history.db"))
}

pub fn open_connection() -> Result<Connection, String> {
    let path = db_path()?;

    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )
    .map_err(|e| format!("Failed to open DB: {e}"))?;

    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("Failed to set DB busy timeout: {e}"))?;

    migrations::run(&conn)?;

    if let Err(wal_error) = conn.pragma_update(None, "journal_mode", "WAL") {
        conn.pragma_update(None, "journal_mode", "DELETE")
            .map_err(|delete_error| {
                format!(
                    "Failed to set journal mode (WAL error: {wal_error}; DELETE fallback error: {delete_error})"
                )
            })?;
    }

    Ok(conn)
}
