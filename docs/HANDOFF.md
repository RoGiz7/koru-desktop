# Dónde estamos — actualizado 2026-11-28 (v0.58.0 publicada; el plan de escalaciones, sin publicar)

> Léelo ANTES de empezar nada. Y **actualízalo al terminar**: este fichero existe para que una
> sesión nueva arranque sin que nadie le recuente la historia. Si miente, hace más daño que bien.
> Las reglas que no se negocian están en `CLAUDE.md` (raíz).

## Estado

- **`main` lleva TREINTA Y OCHO commits por encima del tag `v0.58.0` (`a3b330a`). SIN
  PUBLICAR.** Hasta `9a48dc7` está empujado; los CUATRO siguientes están **solo en local, sin
  push**: los nombres de «Cómo viajas» (`f0065d3`), los fallos de la 3a que destapó el paso 0
  (`49d7081`: el aviso de siempre suelta al plan, el plan ve a todos, las skills dicen si faltan),
  los retoques vistos en pantalla (`57704be`) y la parte B (el último, con este fichero).
  ⚠️ Cuenta sacada de git el 28-11 (`git rev-list --count`): en los informes, de git, nunca de memoria. Ni versión, ni changelog,
  ni release: el plan no se anuncia todavía. Además del plan de escalaciones (abajo): `FaltaScope`
  (`0981590`), el salto (`dff63d9`), los huérfanos de `public/`, el skill-check y la lista de
  personajes.
- **Publicado: v0.58.0** (2026-11-26) = tag `v0.58.0` = **`a3b330a`**.
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

## 🧭 EN CURSO: el plan de escalaciones («rutas encadenando escalaciones», idea de usuario)

Varias escalaciones a la vez, ordenadas para salvar las que se puedan. Vive en el panel del plan,
dentro de Navegación del mapa (`src/planNav.tsx`); el cálculo es puro y está en `src/plan.ts`, el
almacén en `src-tauri/src/db/plan.rs` (tablas `plan` y `plan_stop`; las paradas por `kind`, hoy
solo `escalacion`, y nada se copia de la escalación a la parada).

- **Fase 1** (`a07d7f6`, `ad011c1`) — **probada en pantalla.** Orden propuesto por fuerza bruta
  hasta 8 paradas (por caducidad por encima, y lo dice), margen por parada, el orden manual
  comparado con el propuesto. Una parada que no se salva ni yendo directo sale del recorrido a
  una lista aparte; una perdida por TU orden se queda dentro. A puertas: saltos × «Minutos por
  salto», con el mismo buscador y filtros que la línea amarilla.
- **Fase 2** (`598c0bb`, `9f3035b`, `d1eb4f6`) — **nadie la ha visto avisar en vivo.**
  - Por tramo: sistemas con muertes en la última hora y el peor; la misma ruta por la segura y
    qué escalaciones te cuesta ir seguro («No hay ruta por alta seguridad» si la segura aún cruza
    baja o nula: `findRoute` en modo seguro nunca sale vacío).
  - El intel mira el camino: los tramos que faltan son orígenes de un BFS APARTE
    (`src-tauri/src/plan_intel.rs`), nunca de `cfg.origins`. Se marcan todos; solo AVISA el
    empezado («▶ Voy» con la run abierta), y el silencio se dice.
  - La vigilancia depende de la RUN ABIERTA, no del panel: con el panel cerrado el mapa (siempre
    montado) manda las paradas empezadas de cualquier plan (`plan_paradas_empezadas`). Solo
    paradas de un plan: una escalación suelta NO enciende nada (decidido el 26-11).
  - Si el vigilante no recibe el camino, la pastilla de Intel en vivo dice «Camino: fallo»
    (`src/saludIntel.ts`).
  - Las muertes se refrescan cada 5 min con el plan abierto; si el dato pasa de 75 min la frase
    deja de decir «en la última hora».
  - ⏳ Sin ver: la cadena en vivo (hostil en el camino → notificación, sonido, aviso flotante),
    cómo se ven los recuadros, y el fallo real de `plan_intel_set` en la pastilla.
- **Fase 3a** (`337afb5`, `56aa788`) — **sin ver en pantalla y sin un salto real.** Briefs en
  `documentacion/brief-cadena-fase3a.md` y `…-fase3a-decisiones.md` (la de DENTRO; manda el
  segundo).
  - La «forma de viajar» (tabla `forma_viaje`, `plan.forma_id`; vacía = a puertas como antes) y los
    papeles quién salta / quién pone el cyno (`plan_papeles`). Sin selector de «ojos» a propósito.
  - UN solo `evaluar`: la forma va como argumento opcional (`formaPuertas` / `formaSalto`). Con
    `formaSalto`, cada pata sale cuando acaba el sitio, el cooldown y llega el cyno, y dice cuál
    mandó. El `path` de una pata de salto es la ruta a puertas del CYNO, y de ahí comen las muertes,
    «ir seguro» y el intel (que avisa «en el camino de X a …»).
  - `llega()` en `plan.ts` es el ÚNICO predicado de «tu forma llega», con `switch` exhaustivo: un
    estado nuevo no compila hasta decidirlo.
  - En el mapa: la línea amarilla sale de donde está el cyno y los saltos van en violeta discontinuo.
  - 🚨 **Fórmulas del salto según lo PUBLICADO, no validadas.** El autor va a hacer un salto con la
    Black Ops y traer los años luz y los dos timers: entra como una fila más en
    `scripts/verificar_plan.mjs` («Salto — cooldown y fatiga»).
- **Fase 3b** (`ed3a932`, `b31fb44`, `5a77802`) — **SIN VER EN PANTALLA, SOLO EN LOCAL.** Hecha
  antes de que nadie vea la 3a, a propósito (RoGiz7 apenas hace ese contenido; la probará un piloto
  tras publicar). Brief `documentacion/brief-cadena-fase3b.md` (la de DENTRO); su sección final,
  «Decisiones del paso 0», manda sobre lo de arriba.
  - Una parada fuera de alcance puede pasar por UN salto intermedio, y **solo si el piloto lo
    acepta** (`plan_stop.via_system_id`, comando `plan_via`). No es un `kind` ni una parada.
  - `probarIntermedio` (plan.ts) es la ÚNICA función que dice si un sistema sirve: la usan la
    búsqueda, el «Otro…» y el intermedio guardado. El guardado se revalida en CADA pata desde donde
    está el que salta, también dentro de la fuerza bruta: destino a tiro → directo y se dice
    («ahora no hace falta»); no sirve → «fuera de alcance» con el motivo y su número.
  - Los dos saltos pasan por el mismo `saltar()` que el directo. La espera es POR SALTO
    (`SaltoHecho.espera`, con `en`: dónde esperas), no por pata: ver `ed3a932`.
  - **La propuesta NO se calcula sola** (paso 0, medido el 28-11 con `neweden.json`: hasta 58
    candidatos y ~1,1 s en baja densa con la ruta segura, casi todo en `findRoute`). Botón «Buscar
    intermedio»; generador por lotes de 5 (peor lote medido: 170 ms); sin tope de candidatos y sin
    los saltables sin salidas en el grafo (217 en el mapa). Se ata a una clave: si cambia el grafo,
    el modo, la ficha, el orden… desaparece y vuelve el botón.
  - Mapa: la línea del cyno pasa por el intermedio; los saltos, en el trazo violeta de la 3a.
  - ⏳ **Sin probar**: todo en pantalla (cómo se ve la fila, el «buscando…», que no congele la
    ventana, que la propuesta desaparezca al cambiar el modo), el `ALTER` sobre una BD real ya
    creada, y un intermedio de verdad en el juego.
  - El camino vigilado de una parada EMPEZADA pasa por el intermedio mientras el que salta no esté
    en él (y si no se sabe dónde está, también: vigilar de más es el lado seguro). Una regla,
    `caminoVigilado`, para el panel abierto y el cerrado. Hasta el 28-11 se lo saltaban LOS DOS:
    aquí ponía que con el panel abierto sí pasaba por él, y era falso.
    ⚠️ Con el panel cerrado el intermedio guardado se usa TAL CUAL, sin revalidar: el mapa no tiene
    ni el casco ni las skills de salto para el alcance.
  - La caché de rutas del cyno ya no caduca cada minuto (`cacheSalto`): se ata a `calcTramo`.
- **El plan y el aviso de siempre ya no comparten el «ya avisado»** (28-11, `plan_intel::Vistos`).
  El de siempre es exactamente el de antes del plan: ni lee ni escribe nada del plan. El plan LEE el
  suyo (si ya sonó por tus personajes, el plan solo marca) y apunta en un conjunto propio.
  ⚠️ **El único doble aviso, a propósito:** suena el plan por un reporte lejos de tus pilotos y, más
  tarde, uno de tus pilotos entra en su radio y suena el de siempre. Son dos noticias distintas.
  Antes compartían conjunto, y el plan callaba avisos de siempre según por dónde fuera su camino.
- **El plan recibe a TODOS los personajes** (`pilotosPlan`, con sus permisos), elijas a quien elijas
  arriba. Hasta el 28-11, con uno elegido el plan no sabía dónde estaba el cyno y vigilaba el camino
  desde donde estabas tú, sin decirlo (también con el panel cerrado). `charLocations` no se tocó.
- **`get_jump_profile` dice «no se sabe»** (`null` y el motivo, por separado skills y naves). Sin
  permiso de skills el plan supone V y nombra el permiso. ⏳ El planificador de salto del mapa sigue
  traduciéndolo a 0 a propósito (`useJumpPlanner.ts`): que lo diga está sin hacer.
- **Los guiones del cálculo están en el repo** (`866f77d`): `scripts/verificar_plan.mjs` y
  `scripts/verificar_salud_intel.mjs`, puerta en `CLAUDE.md` si se tocan `plan.ts` o `saludIntel.ts`.

- **«Cómo viajas» y lo que se carga solo** (28-11, brief `documentacion/brief-plan-nombres-autocarga.md`
  con sus «Decisiones del paso 0», que mandan). **SIN VER EN PANTALLA.**
  - Nombres: «Cómo viajas», «Por puertas», «+ Salto con cyno», «Nave que salta», «Tipo de cyno», y
    «puerta» donde «salto» era puerta. «Ficha» solo queda en el código.
  - **El cyno dura lo que dice el casco de QUIEN LO ENCIENDE** (`duracionCyno`): la base del tipo
    (`jumpships.json`) × 0,5 si es Force Recon o Black Ops. Del SDE con `extract_cyno_fit.py` →
    `public/cyno_fit.json` (qué casco monta qué cyno y los 15 con bono). El salto guarda el TIPO
    (`forma_viaje.tipo_cyno`); sin tipo = «a mano» con su número, que es como se leen las de antes.
    Sin saber el casco del cyno, la base sin bono, y se dice.
  - Naves que posee y nivel de Cynosural Field Theory de TODOS los personajes con CERO peticiones a
    ESI (`plan_datos_salto`, de `asset_stack` y `skill_seen`). Sin permiso o sin sincronizar = «no se
    sabe», nunca «no tiene».
  - Nave propuesta al crear (la que lleva si es de salto), aviso «"X" dice A; está en B» con «Usar B»,
    y papeles preseleccionados SOLO con un único candidato y en un papel vacío (se guarda y se dice;
    una vez por plan y papel, para no pisar al piloto). «Puede encender» = skill Y casco de ahora.
  - ⏳ Qué cyno lleva montado: NO se lee (hora y media de retraso y sin probar con datos reales).
  - ⚠️ «Usar B» cambia la nave del salto guardado, y un salto lo pueden usar varios planes: el botón
    lo dice en su título, no pide confirmación.

## 🐛 ABIERTO: las posiciones se quedan viejas sin decirlo (visto el 28-11)

`poll_positions` corre cada 30 s. Si falla la llamada entera, `App.tsx` se queda con las posiciones
que tenía, y hasta el 28-11 el fallo se tragaba con `.catch(() => {})`. Ahora solo deja rastro en
consola; la pantalla sigue sin decir nada. Y dentro de Rust, si falla UN personaje (su `/location/`
o su `/ship/`), llega `null` y la app conserva el dato anterior, también en silencio.
Lo que ve el piloto: sus personajes en el último sistema bueno, en el mapa, en el minimapa y en lo
que mide la proximidad del intel, **sin límite de tiempo**: nadie más vuelve a traer posiciones
(`refresh()` solo corre al arrancar, al iniciar sesión y al quitar o borrar un personaje). Hasta
reiniciar Koru o que el sondeo vuelva a funcionar. Rediseñarlo es otra sesión.

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
⚠️ Esas cuentas son de antes del plan y no sé reproducirlas: contando líneas con
`grep -c ".catch(() => {})"` sobre `src/` salen **84 en el tag y 82 en `d1eb4f6`**. Las dos que se
fueron son las de `get_system_kills` en `map.tsx` (fase 2), y una corría al montar el mapa.
⚠️ **Sin números de línea a propósito**: `3b87551` ya movió los de `map.tsx` unas 55 líneas el mismo
día en que se apuntaron. Se buscan por contenido —`.catch(() => {})` en efectos que corren al montar
la ventana principal—, nunca por número.

## 📋 Pendientes

0. **La ronda de `FaltaScope` por los demás paneles.** Desde `0981590` el permiso que falta es un
   error propio (`AppError::FaltaScope`, texto «Falta permiso: …», ayudante `esFaltaPermiso` en
   `src/errores.ts`), pero SOLO lo distinguen el panel de fatiga y el plan. El resto sigue
   enseñándolo crudo o tratando cualquier error igual. Comandos que lo devuelven: los 24 que pasan
   por `token_with_scope` (wallet, skills, assets, industria, mercado, PI, standings, contactos,
   factional, abyssals, minería, fittings, blueprints, perfil de salto…) y `sync_killmails`. Crudo
   se ve sobre todo en el cartel general de `App.tsx` (`tb-error`) y en importar fittings.
1. **Las 16 llamadas a `/universe` de ESI** → al catálogo local. Es la sesión grande y **la que
   abre SKINR**: coger SKINR obliga a subir la fecha de compatibilidad, y eso retira esas rutas.
   **Migrar primero, subir la fecha después. Nunca al revés.**
2. **Los huérfanos de `public/`: NINGUNO desde el 26-11.** Los siete tienen ya su
   `extract_<fichero>.py` (`jumpships`, `ores`, `skill_names`, `npc_corp_systems`, `module_slots`,
   `skill_reqs`, `agents`), cada uno con su vara en la cabecera y un `--medir` para repetirla.
   ✅ Base del guardián fijada (26-11, `sde_check.py --guardar-base`, SDE 3749835) tras revisar la
   regeneración: entran `agentsInSpace`, `npcCharacters`, `npcCorporations` y `npcStations`, y el
   guardián deja de avisar de tablas sin versión.
   ✅ **Tercer tiempo hecho, SIN VER EN PANTALLA** (brief `documentacion/brief-skillcheck-desconocido.md`):
   el skill-check distingue «no lo conozco» de «no pide nada». `skill_reqs.json` lleva `[]` para
   lo que se fitea y no pide nada (1.632 tipos); la regla está en `src/skillCheck.ts`, probada con
   `scripts/verificar_skillcheck.mjs`. Solo lo MONTADO (nave y ranuras) deja el veredicto en «no se
   sabe»; lo que no se conoce en drones y bodega va en una línea discreta, sin ⚠ (decidido con
   RoGiz7: la bodega lleva mineral, combustible, PLEX…). Fiteos y Assets pasan por el mismo
   componente, y es el único sitio que lee `skill_reqs.json`.
   ⏳ **El requisito de nivel 0, por decidir**: hoy una skill que no tienes cuenta como nivel 0, así
   que un requisito de nivel 0 nunca sale. En el SDE 3749835 hay 73 en 56 tipos, y de esos solo UNO
   publicado (Citizen Miner); el resto son los «Academy» sin publicar. Briefs en `documentacion/`
   (`brief-huerfanos-public.md` y `…-decisiones.md`, manda el segundo).
   **Para el changelog de la próxima release** (lo que el piloto nota al regenerar, contado):
   - Encargos de minería, filtro «Mineral»: 8 menas nuevas que antes no se encontraban (las
     Z-Grade), y 5 con su nombre de hoy («Flawed Raspite» y compañía, antes «X-Grade»).
   - Fiteos, assets y plan de estudios: 2 skills que salían como un número ahora tienen nombre
     (Synchronization Rigging y Hybrid Drone Specialization).
   - Mapa, capa «Mis corps NPC»: el Starkmanir Council, que faltaba, ya pinta su sistema si tienes
     LP con él.
   - Fiteos, visor de fits: 96 módulos que se pintaban en «extra» vuelven a su anillo, y el
     Countermeasure Launcher I pasa de la ranura alta a la media.
   - Fiteos y assets, «¿puedes volarlo?»: el skill-check mira ahora 259 tipos que antes no conocía
     (y que contaba como «no pide nada»), entre ellos 7 naves, 23 módulos y 66 implantes
     publicados, y 11 drones T2 piden la skill nueva que les faltaba.
   - Fiteos y assets: si el fit lleva algo montado que Koru no conoce, ya no dice «puedes
     pilotarlo»: dice cuántas cosas no conoce y cuáles. Y mientras carga el catálogo, no dice nada
     (antes decía «puedes pilotarlo» con el catálogo aún vacío).
3. **Mensaje a testers** — el de la 0.57.0 nunca se envió, así que ahora acumula dos versiones.
   Titulares: *tu sesión nunca se perdió* (0.57.0) y *el intel vuelve a avisar* (0.58.0).
4. **Fuentes Rajdhani**: o se commitean (la OFL lo permite) o se quitan los `@font-face`. Hoy son
   decorativas: ninguna release las ha llevado nunca.
5. **Las notas de la release 0.57.0 en GitHub** siguen con la frase falsa; se editan a mano.
6. **Reintento en `apt-get update`** del workflow: el tope de 45 min es el tope, no la cura.
7. **Cuatro ideas llegadas de usuarios**:
   - clonar el perfil de interfaz de un personaje a los demás — sin tocar;
   - un planificador industrial web como referencia (es una app JS, hace falta navegador para
     verla) — sin tocar;
   - ★ **rutas de salto encadenando escalaciones** — EN CURSO, ver «el plan de escalaciones»
     arriba (fases 1, 2, 3a y 3b hechas; 3a y 3b sin ver);
   - **la lista de personajes de arriba, ilegible pasados ~10** — **HECHA, SIN VER EN PANTALLA**
     (26-11, brief `documentacion/brief-lista-personajes.md`). El nombre del elegido siempre a la
     vista; con más de `UMBRAL_RECOGER` (10) la fila lleva solo los conectados y el elegido, y el
     resto va tras un «+N» con buscador. `online: null` no cuenta como conectado; el «!» de un
     recogido lo lleva el botón. Regla pura en `src/listaPersonajes.ts`, probada con
     `scripts/verificar_lista_personajes.mjs`. Para el changelog de la próxima release.

## Mapa del terreno

- **Intel**: `src-tauri/src/commands.rs` (el hilo vigilante, `spawn_intel_thread`) ·
  `src-tauri/src/chatlog.rs` (lectura de los logs) · `src/useIntel.ts` (orquesta) ·
  `src/intel.ts` (troceo) · `src/map.tsx`, `src/overlay.tsx`, `src/minimapaVentana.tsx` (pintan).
- **Ventanas**: tres, con etiquetas `main`, `overlay` y `minimapa`. En Tauri v2 **las capacidades
  van POR VENTANA**.
- **Datos del SDE**: 30 scripts en `scripts/extract_*.py` → 36 JSON en `public/`, más siete
  embebidos en el binario. El SDE entra SOLO por esos scripts: nada se pide en caliente.
