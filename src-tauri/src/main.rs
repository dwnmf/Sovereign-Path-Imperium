#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod db;
mod elevation;
mod types;

use tauri::Emitter;

fn startup_path_arg() -> Option<String> {
    let mut args = std::env::args();

    while let Some(arg) = args.next() {
        if arg == "--path" {
            return args.next();
        }
    }

    None
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            db::open_connection()?;

            if let Some(path) = startup_path_arg() {
                let _ = app.emit("startup:path", path);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::volumes::list_volumes,
            commands::scan::scan_volume,
            commands::validate::validate_links,
            commands::links::create_link,
            commands::links::delete_link,
            commands::links::retarget_link,
            commands::links::open_target,
            commands::details::get_link_details,
            commands::export::export_links,
            commands::shell::register_shell_integration,
            commands::shell::unregister_shell_integration,
            commands::shell::is_shell_integration_registered,
            config::load_config_command,
            config::save_config_command,
            elevation::is_elevated,
            elevation::relaunch_as_admin,
            db::history::get_history,
            db::history::undo_last,
        ])
        .run(tauri::generate_context!())
        .expect("error while running symview application");
}
