use rusqlite::Connection;

pub fn run(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action_type TEXT NOT NULL,
            link_path TEXT NOT NULL,
            link_type TEXT NOT NULL,
            target_old TEXT,
            target_new TEXT,
            timestamp TEXT NOT NULL,
            success INTEGER NOT NULL,
            error_msg TEXT
        );
        ",
    )
    .map_err(|e| format!("Migration failed: {e}"))
}
