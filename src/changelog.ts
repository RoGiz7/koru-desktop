// Changelog in-app para el modal "Novedades". Bilingüe (ES/EN). Mantener en cada release:
// añade una entrada nueva ARRIBA con la versión, fecha y viñetas (reutiliza las notas de release).
import { getLang } from "./i18n";

export type ChangelogEntry = { version: string; date: string; es: string[]; en: string[] };

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.20.0",
    date: "2026-07-06",
    es: [
      "🏥 Logi (Fase B): lee tu reparación remota (escudo/blindaje/casco) del log de combate del juego — dato que ESI no expone.",
      "Panel de Logi en Logros: curación dada vs recibida, de todo tu histórico (¡con logis la vida es más larga!).",
      "Nuevo dominio de medallas «Apoyo»: Escudero / Chapista / Soldador — medallas para quien da reps (escudo/blindaje/casco).",
      "Apartado «Logis»: gráfica con filtros día/semana/mes/año + líneas Total dado/recibido y por tipo (activables) + histórico de a quién curaste y de quién recibiste, con retrato del piloto e icono de su nave.",
      "El escaneo lee también la subcarpeta «old» de Gamelogs → años de histórico, no solo lo reciente.",
      "⚙️ Pasa por Configuración: confirma la carpeta de logs de EVE (un clic la deja lista para Intel y gamelogs) y pulsa Escanear. Te dice si ya está escaneado o pendiente.",
      "Nuevas métricas de proyecto: curación dada y reps recibidas (escudo/blindaje/casco). Elige la carpeta de gamelogs y pulsa Escanear.",
      "Lector incremental: los gamelogs se leen una sola vez; después solo lo nuevo (rendimiento).",
    ],
    en: [
      "🏥 Logi (Phase B): reads your remote repairs (shield/armor/hull) from the game combat log — data ESI doesn't expose.",
      "Logi panel in Achievements: healing given vs received, from your whole history.",
      "New “Support” medal domain: Shield Warden / Field Mender / Welder — medals for those who give reps (shield/armor/hull).",
      "“Logi” section: chart with day/week/month/year filters + Total given/received and per-type lines (toggleable) + who-you-healed / who-healed-you history with each pilot's portrait and ship icon.",
      "New project metrics: healing given and reps received (shield/armor/hull). Pick your gamelogs folder and hit Scan.",
      "Incremental reader: gamelogs are read once, then only new content (performance).",
      "⚙️ Head to Settings: confirm your EVE logs folder (one click sets it up for Intel and gamelogs) and hit Scan. It shows whether it's already scanned or pending.",
    ],
  },
  {
    version: "0.19.0",
    date: "2026-07-06",
    es: [
      "✨ Novedades: este mismo aviso — al actualizar verás de un vistazo los cambios de cada versión.",
      "🖼️ Iconos EVE por carrera en los trabajos por libre (Explorer, Industrialist, Enforcer, Soldier of Fortune).",
    ],
    en: [
      "✨ What's new: this very dialog — see each version's changes at a glance on update.",
      "🖼️ EVE icons per career in freelance jobs (Explorer, Industrialist, Enforcer, Soldier of Fortune).",
    ],
  },
  {
    version: "0.18.4",
    date: "2026-07-06",
    es: [
      "🎯 Proyectos personales con filtros: nave, mineral, sistema, personaje o corporación.",
      "Multi-selección y familias (p. ej. todo el Mercoxit); objetivo con unidad (Miles/Millones/B).",
      "Cuentan desde su creación; modos de minería: valor, unidades, volumen (m³) o ISK reproceso 85%.",
      "🏆 Al completar: fanfarria, notificación y archivo en «Completados» con fecha.",
      "🎯 Caza selectiva: proyectos para cazar a un personaje o corporación de tu historial.",
      "🖼️ Iconografía EVE en proyectos personales, de corporación y trabajos por libre.",
    ],
    en: [
      "🎯 Personal projects with filters: ship, ore, system, character or corporation.",
      "Multi-select and families (e.g. all Mercoxit); target with unit (Thousands/Millions/B).",
      "Count from creation; mining modes: value, units, volume (m³) or reprocess ISK 85%.",
      "🏆 On completion: fanfare, notification and archive in “Completed” with date.",
      "🎯 Selective hunt: projects to hunt a character or corp from your history.",
      "🖼️ EVE iconography in personal, corporation and freelance projects.",
    ],
  },
];

// Compara "0.18.4" vs "0.18.3" numéricamente por segmentos. >0 si a>b.
export function cmpVer(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Entradas con lastSeen < versión <= current, de más nueva a más vieja.
export function entriesSince(current: string, lastSeen: string): ChangelogEntry[] {
  return CHANGELOG.filter((e) => cmpVer(e.version, lastSeen) > 0 && cmpVer(e.version, current) <= 0).sort(
    (a, b) => cmpVer(b.version, a.version),
  );
}

// La entrada exacta de una versión (para mostrar en el primer arranque con la feature).
export function entryFor(version: string): ChangelogEntry[] {
  return CHANGELOG.filter((e) => cmpVer(e.version, version) === 0);
}

// Viñetas en el idioma actual de la app.
export function bullets(e: ChangelogEntry): string[] {
  return getLang() === "en" ? e.en : e.es;
}
