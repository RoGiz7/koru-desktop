# Koru Desktop v0.17.0 — notas de release (borrador para GitHub)

## ⚔️ PvP renovado (vista única)

- **Gráfica de Actividad PvP unificada**: tendencia (Kills/Losses) + evolución semanal de tus
  **top-5 naves** y **top-5 sistemas** en una sola multilínea. Leyenda de chips por grupo:
  combina las series que quieras (p. ej. "Kills + Raven Navy Issue + SR-KBB").
- Conmutador de naves: **con las que vuelas** o **las que destruyes**.
- Selección de rango unificada con el resto de la app (90 días · Este año · Todo · Año… +
  Desde/Hasta), por defecto los **últimos 90 días**. Los tops se rankean **dentro del rango**.
- Adiós al toggle Tabla/Gráfica: todo integrado en una sola vista.
- **Columna Nave** de killmails: en kills muestra la **nave víctima** (como zKill); tu nave, en
  el tooltip. En losses, tu nave.
- **Región + enlace Dotlan** en "Kills más caros" y en la tabla de killmails (región desde el
  SDE local, sin llamadas a ESI).

## 📟 Ticker de datos vivos (nuevo dock)

- La franja de KPIs bajo el mapa ahora es un **teletipo estilo bolsa**: Kills (▲ delta de la
  semana), Losses, Eficacia, ISK destruido/perdido, resumen de la semana, **Patrimonio** (▲/▼ %
  vs snapshot anterior), **Balance del mes** (vs mes anterior), **precio del PLEX** y pilotos
  online en Tranquility.
- Coste ~cero: todos los datos salen de tu BD local (una consulta ligera por sync) y la
  animación es CSS por transform (GPU). Se pausa al pasar el ratón y respeta
  `prefers-reduced-motion`.

## 🐛 Killmails completos (fix importante)

- **Las kills de participación ya se sincronizan solas**: un killmail solo "pertenece" a la
  víctima y a quien da el golpe final, y ESI solo devuelve esos. Ahora cada auto-sync consulta
  además la página 1 de zKillboard por personaje (1 petición ligera / 30 min, respetando su API).
- El sync de ESI ahora **pagina** (hasta ~1.000 kills) y rellena huecos históricos.
- "Sincronizar recientes" fuerza datos frescos (ignora caché de la lista).
- El auto-sync **ya no traga errores**: se reportan por personaje y paso (visibles en consola).
- Defensa anti-congelación: un `Expires` anómalo de ESI ya no puede dejar un endpoint parado
  (revalidación por ETag pasada 1 hora).

## 🌌 Inmersión (lote N1)

- **Tipografía display Rajdhani** (SIL OFL, empaquetada en local) en títulos y KPIs + cifras
  tabulares que no "bailan" al refrescar. *Requiere copiar los TTF a `public/fonts/` (ver
  `LEEME-FUENTE.md`); si faltan, cae a Inter sin romperse.*
- **Tu nave actual** junto al retrato (mini-render en el chip + detalle en la tarjeta).
- **Tema "📍 Ambiente"**: la app se tiñe según dónde estás — azul highsec, ámbar lowsec, rojo
  nullsec, púrpura wormhole.
- **Cuenta atrás de downtime** (⏻ DT 2h 14m) junto al reloj EVE.
- Micro-transiciones (fade de vista, hover en KPIs) con respeto a `prefers-reduced-motion`.
- Fix: nombre de nave con tildes ya no sale como `u'C\xe1psula...'` (quirk del endpoint /ship/).

## 🔒 Hardening

- **CSP** definida en Tauri (antes desactivada).
- **User-Agent** con versión dinámica del build.
- Ventana por defecto 1280×800 (mín. 960×600), centrada.

---

**Checklist de publicación** (recordatorio):
1. ✅ Versión subida en los 3 ficheros (package.json / tauri.conf.json / Cargo.toml) → 0.17.0.
2. Commit de todo + push.
3. Tag `v0.17.0` → el workflow compila, firma y publica `latest.json` (auto-update).
4. Copiar estas notas a la Release de GitHub.
