# Dónde estamos — actualizado 2026-11-26 (release v0.58.0 publicada)

> Léelo ANTES de empezar nada. Y **actualízalo al terminar**: este fichero existe para que una
> sesión nueva arranque sin que nadie le recuente la historia. Si miente, hace más daño que bien.
> Las reglas que no se negocian están en `CLAUDE.md` (raíz).

## Estado

- **Publicado: v0.58.0** (2026-11-26). `main` = tag `v0.58.0` = **`a3b330a`**, arbol limpio.
  Verificado desde fuera, no por un «listo»: `releases/latest/download/latest.json` dice
  `version: 0.58.0` con **7 plataformas y las 7 firmadas**, y la release esta publicada
  (`draft=false`, marcada *latest*) con **11 assets**.
- **Quince commits** entraron en ella. Las cinco viñetas del changelog: el intel vuelve a avisar ·
  y si no puede avisar, lo dice · al dia con el juego dos veces (SDE 3720952 y 3749835) · nueve
  naves cambian de nombre en chino · la correccion de la 0.57.0. **Fuera a proposito**: el guardian
  del SDE, `CLAUDE.md`, este fichero, el tope del CI y el arreglo del extractor — fontaneria que al
  piloto no le dice nada.
  ⏳ **El arreglo del intel sigue sin probarse en el `.exe` de release**; se comprobo en dev.
  ⚠️ La app en ingles cambio una palabra: la pastilla dice **«Not alerting»**, no «No alerts»
  (`src/i18n.ts:328`). «No alerts» se leia como «ahora no hay avisos», que es la lectura benigna
  que esa release venia a quitar.

- **SDE**: base en **`3749835`** (26-11), integrado y con el guardián en código 0. El 3744011 se
  saltó a propósito: el guardián da el acumulado contra la base.
  ⚠️ El zip va a la `documentacion/` **HERMANA** (`../documentacion/sde-source/`), que es la que leen
  los extractores. Una ruta relativa lanzada desde el repo cae en la de DENTRO, y la comprobación del
  glob, lanzada desde el mismo sitio, sale en verde mientras ellos usan el zip viejo.
  ⚠️ El guardián **avisa de más**: compara un hash de versión de la API, y en la 3749835 marcó cinco
  tablas idénticas byte a byte (`mapSolarSystems` entre ellas). Una tabla marcada no prueba nada:
  se mira el diff.

## 🐛 ABIERTO: el intel deja de avisar (diagnosticado el 26-11, niveles 1 y 2 hechos, falta la raíz)

**Síntoma**, reproducido por el autor y reportado por usuarios: el mapa grande sigue perfecto —el
feed entra— pero **el minimapa flotante no marca nada y el aviso flotante no se abre ni suena**.
Cerrar y volver a abrir Koru lo arregla a veces.

**Causa probable** (consistente con todo lo observado, no probada en campo):

- Las DOS ventanas flotantes cuelgan del mismo evento, `intel-alert`. El feed del mapa (`intel-lines`)
  se emite aparte y **no** depende de él. Por eso el mapa parece sano.
- Para que se emita `intel-alert`, el vigilante de Rust entra en `if !g.name_to_id.is_empty()`.
  **Con el grafo vacío se salta el matching entero, en silencio.**
- El grafo se manda desde `src/useIntel.ts` con `invoke("set_intel_graph", …).catch(() => {})`
  **una sola vez** (deps `[geo, ne]`, que ya no vuelven a cambiar). **Si esa única llamada falla,
  no se reintenta y nadie se entera.**
- Falla por la **carrera de arranque** ya conocida (el backend aún no ha registrado su estado
  cuando la pantalla pregunta). Es la misma que en la 0.57.0 dejaba la lista de personajes vacía
  para siempre, y muerde más fuerte **justo después de una autoactualización**.
- Y mientras tanto **el badge del vigilante sale verde diciendo «Activo»**, porque el estado que
  publica no mira si hay grafo.

**El arreglo, en tres niveles** (del barato al definitivo):

1. `set_intel_graph` con reintento y **sin catch vacío**, igual que se hizo con `refresh()`.
2. Que el estado del vigilante confiese «sin grafo» y que las ventanas flotantes puedan distinguir
   **«no hay intel» de «estoy rota»**. Hoy no pueden, y por eso costó cuatro mensajes acotarlo.
3. Raíz: que el `setup()` de Rust registre el estado de la app **antes** del trabajo pesado. Eso
   cierra la familia entera, no este caso.

**Hecho (`d7443aa`, sin release, sin probar en el `.exe` de release):** niveles 1 y 2. Además
`set_intel_graph` ya no devuelve `Ok` sin guardar el grafo si el mutex está envenenado, y un grafo
vacío (fallback de `loadJson` si `neweden.json` no carga) acaba en el mismo badge rojo «sin mapa de
sistemas».

**Nivel 3, PARADO a propósito: no es mover una línea.** Todo lo que lleva `AppState` sale del
trabajo pesado: `db` necesita la mudanza de carpeta, la restauración pendiente y `Db::open`, y
`esi` el cliente HTTP. Registrarlo antes obliga a rediseñar: o un estado que se rellena después y
que cada comando tiene que esperar, o sacar a un `manage()` propio, y temprano, lo que no dependa
de la BD (`intel`, `tokens`, `cancel`). Es decisión de diseño, no un arreglo.

**DECIDIDO el 26-11: no se hace todavía, y el motivo es concreto — no sabemos provocar la carrera a
voluntad.** Cualquier rediseño del arranque sería imposible de demostrar, y es un cambio que llega a
todos los usuarios solo, por autoactualización.
➡️ **Lo que va ANTES: un retardo artificial en `setup()` detrás de una bandera de depuración**, para
poder provocar la carrera cuando queramos. Con eso se podría demostrar el arreglo de `d7443aa` —que
hoy tampoco está probado en campo— y cualquier rediseño futuro.
📌 Y hay una tercera opción además de las dos de arriba: **un solo `AppState` con la BD perezosa**,
de modo que `manage()` ocurra al instante y solo esperen los comandos que tocan BD. Toca menos
firmas que partir el estado en dos.

**Los 12 `.catch(() => {})` vacíos del arranque** (misma familia, fuera de `d7443aa` a propósito):
**5 en `App.tsx`, 5 en `map.tsx` y 2 en `whatsnew.tsx`**; en todo `src/` hay **77**.
⚠️ **Sin números de línea a propósito**: `3b87551` ya movió los de `map.tsx` unas 55 líneas el mismo
día en que se apuntaron. Se buscan por contenido —`.catch(() => {})` en efectos que corren al montar
la ventana principal—, nunca por número.

## 📋 Pendientes

1. **Las 16 llamadas a `/universe` de ESI** → al catálogo local. Es la sesión grande y **la que
   abre SKINR**: coger SKINR obliga a subir la fecha de compatibilidad, y eso retira esas rutas.
   **Migrar primero, subir la fecha después. Nunca al revés.**
2. **Auditar los 7 huérfanos de `public/`**: `agents`, `jumpships`, `module_slots`,
   `npc_corp_systems`, `ores`, `skill_names`, `skill_reqs`. Siguen sin generador.
3. **Mensaje a testers** — el de la 0.57.0 nunca se envió, así que ahora acumula dos versiones.
   Titulares: *tu sesión nunca se perdió* (0.57.0) y *el intel vuelve a avisar* (0.58.0).
4. **Fuentes Rajdhani**: o se commitean (la OFL lo permite) o se quitan los `@font-face`. Hoy son
   decorativas: ninguna release las ha llevado nunca.
5. **Las notas de la release 0.57.0 en GitHub** siguen con la frase falsa; se editan a mano.
6. **Reintento en `apt-get update`** del workflow: el tope de 45 min es el tope, no la cura.
7. **Cuatro ideas llegadas de usuarios**, sin tocar y aplazadas varias veces el 26-11:
   clonar el perfil de interfaz de un personaje a los demás · la lista de personajes de arriba se
   hace ilegible pasados ~10 · un planificador industrial web como referencia (es una app JS, hace
   falta navegador para verla) · ★ **rutas de salto encadenando escalaciones**: varios destinos
   arrastrables, con el cálculo de isótopos que YA existe y teniendo en cuenta el tiempo que le
   queda a cada escalación. La última junta dos secciones ya hechas; es la más redonda.

## Mapa del terreno

- **Intel**: `src-tauri/src/commands.rs` (el hilo vigilante, `spawn_intel_thread`) ·
  `src-tauri/src/chatlog.rs` (lectura de los logs) · `src/useIntel.ts` (orquesta) ·
  `src/intel.ts` (troceo) · `src/map.tsx`, `src/overlay.tsx`, `src/minimapaVentana.tsx` (pintan).
- **Ventanas**: tres, con etiquetas `main`, `overlay` y `minimapa`. En Tauri v2 **las capacidades
  van POR VENTANA**.
- **Datos del SDE**: 22 scripts en `scripts/extract_*.py` → 35 JSON en `public/`, más siete
  embebidos en el binario. El SDE entra SOLO por esos scripts: nada se pide en caliente.
