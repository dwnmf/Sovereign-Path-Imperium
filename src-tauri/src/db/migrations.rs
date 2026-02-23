use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension};

const TARGET_USER_VERSION: i64 = 1;

pub fn run(conn: &Connection) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start migration transaction: {e}"))?;

    if !table_exists(&tx, "actions")? {
        create_actions_table(&tx)?;
    } else {
        ensure_actions_schema(&tx)?;
    }

    tx.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_actions_success_id ON actions(success, id DESC);
        ",
    )
    .map_err(|e| format!("Migration failed while creating indexes: {e}"))?;

    tx.pragma_update(None, "user_version", TARGET_USER_VERSION)
        .map_err(|e| format!("Migration failed while updating schema version: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit migrations: {e}"))
}

fn table_exists(conn: &Connection, table_name: &str) -> Result<bool, String> {
    conn.query_row(
        "
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = ?1
        LIMIT 1
        ",
        [table_name],
        |_| Ok(()),
    )
    .optional()
    .map(|result| result.is_some())
    .map_err(|e| format!("Migration failed while checking tables: {e}"))
}

fn create_actions_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE actions (
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
    .map_err(|e| format!("Migration failed while creating actions table: {e}"))
}

fn ensure_actions_schema(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(actions)")
        .map_err(|e| format!("Migration failed while reading actions schema: {e}"))?;

    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Migration failed while decoding actions schema: {e}"))?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(|e| format!("Migration failed while collecting actions schema: {e}"))?;

    if !columns.contains("id") {
        return Err("Migration failed: existing actions table is missing required id column".to_string());
    }

    add_column_if_missing(
        conn,
        &columns,
        "action_type",
        "TEXT NOT NULL DEFAULT 'Unknown'",
    )?;
    add_column_if_missing(conn, &columns, "link_path", "TEXT NOT NULL DEFAULT ''")?;
    add_column_if_missing(
        conn,
        &columns,
        "link_type",
        "TEXT NOT NULL DEFAULT 'Symlink'",
    )?;
    add_column_if_missing(conn, &columns, "target_old", "TEXT")?;
    add_column_if_missing(conn, &columns, "target_new", "TEXT")?;
    add_column_if_missing(conn, &columns, "timestamp", "TEXT NOT NULL DEFAULT ''")?;
    add_column_if_missing(conn, &columns, "success", "INTEGER NOT NULL DEFAULT 1")?;
    add_column_if_missing(conn, &columns, "error_msg", "TEXT")?;

    Ok(())
}

fn add_column_if_missing(
    conn: &Connection,
    columns: &HashSet<String>,
    column_name: &str,
    column_definition: &str,
) -> Result<(), String> {
    if columns.contains(column_name) {
        return Ok(());
    }

    let sql = format!("ALTER TABLE actions ADD COLUMN {column_name} {column_definition}");
    conn.execute(&sql, [])
        .map_err(|e| format!("Migration failed while adding actions.{column_name}: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrades_legacy_actions_table_with_missing_columns() {
        let conn = Connection::open_in_memory().expect("in-memory DB");

        conn.execute_batch(
            "
            CREATE TABLE actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_type TEXT NOT NULL,
                link_path TEXT NOT NULL,
                link_type TEXT NOT NULL,
                target_old TEXT,
                target_new TEXT,
                timestamp TEXT NOT NULL
            );

            INSERT INTO actions (action_type, link_path, link_type, target_old, target_new, timestamp)
            VALUES ('Create', 'C:\\\\tmp\\\\a', 'Symlink', NULL, 'C:\\\\tmp\\\\b', '2025-01-01T00:00:00Z');
            ",
        )
        .expect("create legacy schema");

        run(&conn).expect("run migrations");

        let mut stmt = conn
            .prepare("PRAGMA table_info(actions)")
            .expect("prepare table_info query");
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .expect("read schema rows")
            .collect::<Result<HashSet<_>, _>>()
            .expect("collect schema rows");

        assert!(columns.contains("success"));
        assert!(columns.contains("error_msg"));

        let success: i64 = conn
            .query_row("SELECT success FROM actions WHERE id = 1", [], |row| row.get(0))
            .expect("read migrated success flag");
        assert_eq!(success, 1);
    }
}
