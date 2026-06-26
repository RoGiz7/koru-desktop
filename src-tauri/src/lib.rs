// Structs que mapean respuestas de ESI/JWT y helpers de reserva (p. ej. get_cached_paged):
// se conservan a propósito aunque ahora no se lean todos los campos. Silenciamos el aviso
// mientras el proyecto está en desarrollo.
#![allow(dead_code)]

mod commands;
mod config;
mod db;
mod error;
mod esi;
mod sso;

use commands::AppState;
use db::Db;
use esi::EsiClient;
use sso::TokenManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Instancia única: si se intenta abrir una 2ª, enfocamos la ventana existente.
        // Debe registrarse ANTES que el resto de plugins.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // BD en el directorio de datos de la app.
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("no se pudo resolver app_data_dir");
            let db_path = data_dir.join("koru-desktop.sqlite3");
            let db = Db::open(db_path).expect("no se pudo abrir la BD");

            let http = sso::http_client().expect("no se pudo crear el cliente HTTP");
            let esi = EsiClient::new(http);

            app.manage(AppState {
                db,
                tokens: TokenManager::new(),
                esi,
                cancel: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::login,
            commands::list_characters,
            commands::get_character_cards,
            commands::logout,
            commands::whoami,
            commands::sync_killmails,
            commands::sync_killmails_full,
            commands::cancel_sync,
            commands::auto_sync,
            commands::sync_market,
            commands::get_networth,
            commands::get_networth_global,
            commands::reprocess_killmails,
            commands::get_pvp_stats,
            commands::get_pvp_trend,
            commands::get_pvp_trend_global,
            commands::get_pvp_periods,
            commands::get_pvp_periods_global,
            commands::get_pvp_activity,
            commands::get_pvp_activity_global,
            commands::get_ratting,
            commands::get_ratting_global,
            commands::inspect_ratting_journal,
            commands::get_summary,
            commands::get_summary_global,
            commands::get_summary_periods,
            commands::get_summary_periods_global,
            commands::get_killmails,
            commands::get_rivals,
            commands::get_battles,
            commands::export_pvp_csv,
            commands::sync_wallet,
            commands::get_wallet,
            commands::get_wallet_trend,
            commands::get_wallet_trend_global,
            commands::get_skills,
            commands::get_character_detail,
            commands::get_factional,
            commands::get_abyssals,
            commands::get_contacts,
            commands::get_standings,
            commands::get_assets,
            commands::get_assets_detail,
            commands::get_assets_detail_global,
            commands::get_market_orders,
            commands::get_market_orders_global,
            commands::get_planets,
            commands::get_planets_global,
            commands::get_industry,
            commands::get_mining,
            commands::get_mining_periods,
            commands::get_mining_periods_global,
            commands::get_mining_detail,
            commands::get_mining_detail_global,
            commands::sync_mining,
            commands::get_pvp_stats_global,
            commands::get_wallet_global,
            commands::get_skills_global,
            commands::get_assets_global,
            commands::get_industry_global,
            commands::get_mining_global,
            commands::get_pvp_map,
            commands::get_pvp_map_global,
            commands::get_system_kills,
            commands::get_system_jumps,
            commands::get_sov_systems,
            commands::get_fw_systems,
            commands::get_incursions,
            commands::get_server_status,
            commands::get_assets_map,
            commands::get_assets_map_global,
            commands::get_mining_map,
            commands::get_mining_map_global,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
