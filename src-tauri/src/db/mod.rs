pub mod history;
pub mod migrations;

use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};

pub fn db_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    let dir = home.join("symview");

    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app directory: {e}"))?;
    }

    Ok(dir.join("history.db"))
}

pub fn open_connection() -> Result<Connection, String> {
    let path = db_path()?;

    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| format!("Failed to open DB: {e}"))?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to set WAL mode: {e}"))?;

    migrations::run(&conn)?;

    Ok(conn)
}
