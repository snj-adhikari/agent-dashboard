#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use agent_cuckoo_lib::{api, island, settings};
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(agent_cuckoo_lib::opener())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let path = app.path().app_config_dir()?.join("settings.json");
            app.manage(settings::SettingsStore::load(path));
            let hit = island::HitRect::default();
            app.manage(hit.clone());
            if let Some(win) = app.get_webview_window("island") {
                island::place(&win);
                island::start_cursor_poll(win, hit);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api::cuckoo_get,
            api::cuckoo_post,
            settings::get_settings,
            settings::save_settings,
            settings::add_recent,
            island::set_hit_rect
        ])
        .run(tauri::generate_context!())
        .expect("agent-cuckoo failed to start");
}
