// Changelog in-app para el modal "Novedades". Bilingüe (ES/EN). Mantener en cada release:
// añade una entrada nueva ARRIBA con la versión, fecha y viñetas (reutiliza las notas de release).
import { getLang } from "./i18n";

export type ChangelogEntry = { version: string; date: string; es: string[]; en: string[] };

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.23.0",
    date: "2026-07-10",
    es: [
      "🎖️ Ocho medallas nuevas del gamelog, con desbloqueo retroactivo: Capataz y Voz de mando (módulos de mando), Filón (crítico minero), Chatarrero (salvage), Prospector (sistemas distintos minados), Trotamundos (saltos), Demoledor (golpes wrecking) y Artillero (daño total).",
      "🎯 Rateo gana dos magnitudes: Calidad del golpe (seis escalones de Roza a Destruye, dados o recibidos) y Salvage (restos recuperados e intentos fallidos), de todo tu histórico.",
      "⛏️ Minería: tabla «Residuo por mena» (la mena que tu módulo destruyó, con su % perdido calculado solo contra la época en que el log lo detalla) y «Bonificaciones de mando» (pulsos de foreman y a cuántos llegaron).",
      "✨ El aviso de logros nuevos usa los mismos iconos de EVE que el medallero.",
      "📝 Este modal de Novedades recupera las entradas de la 0.21.0 y la 0.22.0 que faltaban.",
      "🐛 Arreglado: la misma condecoración otorgada dos veces rompía el medallero de corp; y retirado un resto de «Escanear» huérfano en Trabajos y proyectos (el escaneo vive en Configuración).",
    ],
    en: [
      "🎖️ Eight new gamelog medals, retroactively unlocked: Foreman and Voice of Command (command bursts), Motherlode (mining crits), Scrapper (salvage), Prospector (distinct systems mined), Globetrotter (jumps), Wrecker (wrecking hits) and Gunner (total damage).",
      "🎯 Ratting gains two magnitudes: Hit quality (six steps from Grazes to Wrecks, given or taken) and Salvage (wrecks recovered and failed attempts), across your whole history.",
      "⛏️ Mining: “Residue by ore” table (the ore your module destroyed, with its % lost computed only against the era the log details it) and “Command bursts” (foreman pulses and how many they reached).",
      "✨ The new-achievements banner now uses the same EVE icons as the medal case.",
      "📝 This What's-new dialog recovers the missing 0.21.0 and 0.22.0 entries.",
      "🐛 Fixed: the same decoration awarded twice broke the corp medal case; and removed an orphaned “Scan” leftover in Jobs & projects (scanning lives in Settings).",
    ],
  },
  {
    version: "0.22.0",
    date: "2026-07-10",
    es: [
      "⛏️ Minería «Por sistema» desde 2019: el desglose se empalma con el gamelog más allá de la ventana de ESI, valorado en el modo que tengas puesto (m³, bruto, comprimido, 85%), con el % del extraído que pudo situarse.",
      "💰 Rateo: columna «Bruto (gamelog)» en el detalle por sistema + sistemas anteriores a tu histórico de wallet. Donde el dato no existe va un guion, nunca un cero — y la vista advierte que cobrado y bruto no son comparables.",
      "🎯 Daño y Fallos por arma, de todo tu histórico: cuánto pegaste con cada arma o dron y cuántas veces fallaste, desde 2019. (Con qué arma mataste no se inventa: el gamelog registra daño, no muertes.)",
      "👑 Ratas especiales (oficiales, capitales, faction) con magnitud y eje propios — junto a miles de ratas normales eran una línea plana en el cero.",
      "🐛 Fin de seis años de ceros falsos en Ratas e ISK/rata: el eje se recorta a donde el dato existe. Un cero afirma «no ocurrió»; el hueco dice «no se sabe».",
      "📈 Las cuentas van rectas de punto a punto (la curva dibujaba 8,2 ratas donde hubo 8); los ISK, continuos, siguen suavizados.",
      "⚡ El intel lee solo lo que el log ha crecido, en vez de releer el fichero entero cada tres segundos.",
    ],
    en: [
      "⛏️ Mining “By system” since 2019: the breakdown splices with the gamelog beyond ESI's window, valued in your current mode (m³, raw, compressed, 85%), showing the % of extraction that could be placed.",
      "💰 Ratting: “Gross (gamelog)” column in the per-system detail + systems older than your wallet history. Missing data shows a dash, never a zero — and the view warns that earned and gross aren't comparable.",
      "🎯 Damage and Misses per weapon, across your whole history: how hard you hit with each weapon or drone and how often you missed, since 2019. (Which weapon got the kill isn't invented: the gamelog records damage, not deaths.)",
      "👑 Special rats (officers, capitals, faction) get their own magnitude and axis — next to thousands of normal rats they were a flat line at zero.",
      "🐛 End of six years of false zeros in Rats and ISK/rat: the axis now trims to where data exists. A zero claims “it didn't happen”; a gap says “unknown”.",
      "📈 Counts now go straight from point to point (the curve drew 8.2 rats where there were 8); ISK, being continuous, stays smoothed.",
      "⚡ Intel reads only what the log has grown, instead of re-reading the whole file every three seconds.",
    ],
  },
  {
    version: "0.21.0",
    date: "2026-07-10",
    es: [
      "📍 Nuevo bloque «Dónde» en Reconstrucción: dónde rateaste, minaste y peleaste, por sistema y desde 2019, cruzando cada evento del gamelog con el canal Local. Cada ranking muestra su % de cobertura real.",
      "🗂️ 596 gamelogs huérfanos rescatados (2019–2021, 294 MB): los anteriores a feb-2021 no llevan el ID del personaje y se descartaban; su dueño estaba en el chatlog de la misma sesión. Si hay duda, no se adivina.",
      "🐛 Ratas que salían en español (una sola línea invertida en 6,6 GB envenenaba el diccionario; ahora manda el catálogo oficial: 6.192 NPC), «Veldspar*» como mena fantasma y «PS-94K*» partiendo su sistema en dos — los tres se corrigen solos, sin reescanear.",
      "📈 Eje Y con números redondos (adiós a etiquetas como 438.300,75) y el desperdicio de minería pintado bajo cero: es mena destruida, se lee como la pérdida que es.",
    ],
    en: [
      "📍 New “Where” block in Reconstruction: where you ratted, mined and fought, per system since 2019, by crossing each gamelog event with the Local channel. Each ranking shows its real coverage %.",
      "🗂️ 596 orphan gamelogs rescued (2019–2021, 294 MB): files before Feb 2021 lack the character ID and were discarded; their owner was in the same session's chatlog. When in doubt, no guessing.",
      "🐛 Rat names showing in Spanish (a single reversed line in 6.6 GB poisoned the dictionary; the official catalogue now rules: 6,192 NPCs), “Veldspar*” as a ghost ore, and “PS-94K*” splitting its system in two — all three self-heal, no re-scan needed.",
      "📈 Round numbers on the Y axis (goodbye to labels like 438,300.75) and mining waste drawn below zero: it's destroyed ore, read as the loss it is.",
    ],
  },
  {
    version: "0.20.1",
    date: "2026-07-07",
    es: [
      "📊 Apartado Logis: tabla con columnas Personaje · Nave · Módulo y HP por escudo/blindaje/casco (con iconos reales de los módulos de rep), mostrando solo jugadores reales.",
      "📈 Gráfica con desglose por Personaje / Nave / Módulo (top 8) cruzando fecha y HP, con selector Dado/Recibido — ve quién te repó, con qué nave y qué módulo, a lo largo del tiempo.",
      "🎨 Navegación rediseñada como pestañas con iconos de EVE (Comercio, PvE, Industria, Personaje) y Logis con su propio espacio.",
      "🤝 Curación fiel a jugadores: los reps de drones/NPC/estructuras ya no inflan los totales.",
      "🛡️ Datos a prueba de borrados: tu histórico ya escaneado sobrevive aunque borres o muevas la carpeta de logs (o cambies de PC); el reprocesado solo ocurre al reescanear.",
      "🗑️ Panel de Logi retirado de Bitácora: su sitio es el apartado Logis.",
    ],
    en: [
      "📊 Logis section: table with Character · Ship · Module columns and HP by shield/armor/hull (with the actual rep-module icons), showing real players only.",
      "📈 Breakdown chart by Character / Ship / Module (top 8) across date and HP, with a Given/Received toggle — see who repaired you, with which ship and module, over time.",
      "🎨 Redesigned navigation as tabs with EVE icons (Trade, PvE, Industry, Character) and Logis with its own space.",
      "🤝 Player-faithful healing: drone/NPC/structure reps no longer inflate the totals.",
      "🛡️ Deletion-proof data: your already-scanned history survives even if you delete or move the logs folder (or switch PCs); reprocessing only happens on re-scan.",
      "🗑️ Logi panel removed from the Logbook: its home is the Logis section.",
    ],
  },
  {
    version: "0.20.0",
    date: "2026-07-06",
    es: [
      "🏥 Logi (Fase B): lee tu reparación remota (escudo/blindaje/casco) del log de combate del juego — dato que ESI no expone.",
      "Nuevo dominio de medallas «Apoyo»: Escudero / Chapista / Soldador — medallas para quien da reps (escudo/blindaje/casco).",
      "Apartado «Logis»: gráfica con filtros día/semana/mes/año + líneas Total dado/recibido y por tipo (activables) + histórico de a quién curaste y de quién recibiste, con retrato del piloto e icono de su nave.",
      "El escaneo lee también la subcarpeta «old» de Gamelogs → años de histórico, no solo lo reciente.",
      "⚙️ Pasa por Configuración: confirma la carpeta de logs de EVE (un clic la deja lista para Intel y gamelogs) y pulsa Escanear. Te dice si ya está escaneado o pendiente.",
      "Nuevas métricas de proyecto: curación dada y reps recibidas (escudo/blindaje/casco). Elige la carpeta de gamelogs y pulsa Escanear.",
      "Lector incremental: los gamelogs se leen una sola vez; después solo lo nuevo (rendimiento).",
    ],
    en: [
      "🏥 Logi (Phase B): reads your remote repairs (shield/armor/hull) from the game combat log — data ESI doesn't expose.",
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
