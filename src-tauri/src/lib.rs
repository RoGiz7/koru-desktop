// Structs que mapean respuestas de ESI/JWT y helpers de reserva (p. ej. get_cached_paged):
// se conservan a propósito aunque ahora no se lean todos los campos. Silenciamos el aviso
// mientras el proyecto está en desarrollo.
#![allow(dead_code)]

mod chatlog;
mod commands;
mod config;
mod db;
mod error;
mod esi;
mod gamelog;
mod medals;
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // BD en el directorio de datos de la app.
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("no se pudo resolver app_data_dir");
            let db_path = data_dir.join("koru-desktop.sqlite3");

            // Restauración pendiente: si existe un archivo .restore (dejado por restore_db),
            // lo aplicamos AHORA, con la BD aún cerrada. Reemplazamos la BD vigente y
            // borramos los sidecar -wal/-shm para que no "revivan" datos antiguos.
            let staging = commands::restore_staging_path(&db_path);
            if staging.exists() {
                let _ = std::fs::remove_file(&db_path);
                let _ = std::fs::remove_file(db_path.with_extension("sqlite3-wal"));
                let _ = std::fs::remove_file(db_path.with_extension("sqlite3-shm"));
                if std::fs::rename(&staging, &db_path).is_err() {
                    // rename puede fallar entre volúmenes distintos → copia + borrado.
                    let _ = std::fs::copy(&staging, &db_path);
                    let _ = std::fs::remove_file(&staging);
                }
            }

            let db = Db::open(db_path.clone()).expect("no se pudo abrir la BD");
            // Reintentar resoluciones de ubicación fallidas (estructuras de jugador que antes
            // no se pudieron resolver, p. ej. por faltar el scope read_structures).
            let _ = db.location_system_clear_negative();

            let http = sso::http_client().expect("no se pudo crear el cliente HTTP");
            let esi = EsiClient::new(http);

            app.manage(AppState {
                db,
                db_path,
                tokens: TokenManager::new(),
                esi,
                cancel: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                intel: std::sync::Arc::new(commands::IntelWatch::default()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::login,
            commands::cancel_login,
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
            commands::get_pvp_top_series,
            commands::get_ticker,
            commands::get_bitacora,
            commands::get_achievement_series,
            commands::get_personal_projects,
            commands::create_personal_project,
            commands::delete_personal_project,
            commands::get_logi_summary,
            commands::get_logi_series,
            commands::get_logi_pilots,
            commands::get_logi_breakdown,
            commands::get_gamelog_status,
            commands::get_logi_reparse_pending,
            commands::get_gamelog_recon,
            commands::get_gamelog_mining_valued,
            commands::get_gamelog_weapons,
            commands::get_gamelog_pvp,
            commands::get_gamelog_pvp_series,
            commands::get_gamelog_dps,
            commands::get_gamelog_quality,
            commands::get_gamelog_salvage,
            commands::get_gamelog_boosts,
            commands::get_kill_victims,
            commands::get_corp_history,
            commands::get_medals,
            commands::get_loyalty,
            commands::get_freelance_jobs,
            commands::get_corp_projects,
            commands::get_pvp_periods,
            commands::get_pvp_periods_global,
            commands::get_pvp_activity,
            commands::get_pvp_activity_global,
            commands::get_ratting,
            commands::get_ratting_global,
            commands::get_special_rats,
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
            commands::get_wallet_series,
            commands::get_wallet_series_global,
            commands::get_skills,
            commands::get_character_detail,
            commands::get_factional,
            commands::get_abyssals,
            commands::get_paper_series,
            commands::get_paper_series_global,
            commands::get_contacts,
            commands::get_standings,
            commands::get_assets,
            commands::get_assets_detail,
            commands::get_assets_detail_global,
            commands::get_market_orders,
            commands::get_market_orders_global,
            commands::get_trading_pnl,
            commands::get_trading_pnl_global,
            commands::get_watchlist,
            commands::get_arbitrage,
            commands::watch_add,
            commands::watch_remove,
            commands::scan_opportunities,
            commands::get_planets,
            commands::get_planets_global,
            commands::get_industry,
            commands::get_mining,
            commands::get_mining_periods,
            commands::get_mining_periods_global,
            commands::get_mining_detail,
            commands::get_mining_detail_global,
            commands::get_mining_series,
            commands::get_mining_series_global,
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
            commands::backup_db,
            commands::restore_db,
            commands::db_info,
            commands::auto_backup,
            commands::get_jump_profile,
            commands::get_fatigue,
            commands::save_fit,
            commands::list_fits,
            commands::delete_fit,
            commands::import_fittings,
            commands::get_char_skill_levels,
            commands::get_thera_connections,
            commands::default_chatlogs_dir,
            commands::default_gamelogs_dir,
            commands::scan_gamelogs,
            medals::default_sharedcache_dir,
            medals::extract_medal_textures,
            medals::medal_textures_ready,
            medals::get_medal_texture,
            commands::read_audio_file,
            commands::intel_channels,
            commands::read_intel,
            commands::resolve_intel_entities,
            commands::intel_record_sightings,
            commands::get_habitual_hostiles,
            commands::get_pilot_track,
            commands::get_pilot_profile,
            commands::import_wallet_csv,
            commands::set_intel_graph,
            commands::start_intel_watch,
            commands::stop_intel_watch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
