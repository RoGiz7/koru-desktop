# Koru Desktop — reglas de la casa

App de escritorio para EVE Online. **Tauri v2 + React/TypeScript + Rust**, local-first, sin
servidor propio, con autoactualización. La usan unas veinte personas a diario, así que **una
release mala llega a todas las máquinas sola**: las puertas de abajo son lo único que lo separa.

El autor público del repo es **RoGiz7**. Úsalo en código, comentarios, documentación y commits.

**Habla y escribe en castellano**: con el autor, en los comentarios, en la documentación y en
los mensajes de commit. El proyecto entero está en español. (Los commits, sin acentos — ver
ESTILO al final.) La app es bilingüe ES/EN de cara al usuario, pero eso es otra cosa: son las
cadenas de `src/i18n.ts`, no la forma de trabajar.


## 📍 ALCANCE — este repo es SOLO la app de escritorio

En la carpeta de al lado conviven **otros proyectos distintos que comparten nombre y nada de
código**: un módulo en Python/Django para Alliance Auth (estadísticas de corporación, lunas,
impuestos, auditor), la web de la corporación, y unos flujos de automatización con n8n y Baserow
para los tickets.

➡️ **Nada de eso se toca desde aquí.** Si una tarea habla de tickets, del auditor, de lunas, de
PAPs o del servidor de Alliance Auth, **no es de este repo**: dilo y pregunta antes de tocar nada.

⚠️ Y ojo con `documentacion/`: es una carpeta compartida con material de todos esos proyectos.
Encontrar algo ahí dentro **no significa** que pertenezca a koru-desktop.

---

## 🔒 PRIVACIDAD — lo primero, y no se negocia

1. **Nunca el nombre real del autor.** En nada que vaya al repo. El alias es RoGiz7.
2. **`documentacion/` NUNCA sube.** Está gitignorada y contiene datos de juego personales. Es una
   carpeta HERMANA de este repo, no está dentro.
3. **Nada de los logs reales en texto público**: ni sistemas, ni nombres de piloto, ni
   corporaciones, ni canales de intel, ni fechas de actividad. Vale para código, comentarios,
   changelog, notas de release y mensajes de commit. Para ejemplos, usa sistemas genéricos (Jita).
4. **Antes de publicar: `python scripts/check_privacidad.py`.** Mira prosa Y código fuente.
5. **Koru no tiene telemetría, y es una decisión**, no un olvido: la comunidad de EVE es sensible
   al opsec y Koru es local-first. No propongas añadirla.

---

## 🚨 LA REGLA QUE ATRAVIESA TODO

> **Lo que falla en silencio, falla dos veces.**

Este proyecto ha pagado esa lección muchas veces y siempre igual: **el fallo daba VERDE**.
`Finished` sin `Compiling` · un comprobador que miraba 3 ficheros de 13 · un badge diciendo
«Activo» con el motor parado · un grep que no miraba los ficheros nuevos.

De ahí tres hábitos obligatorios:

- **Nada de `.catch(() => {})` vacío ni de `unwrap_or(false)` sobre un error.** Un catch vacío
  escondió durante días que a una ventana le faltaba una capacidad. Si falla, que se vea.
- **Un comprobador que no puede fallar no está comprobando.** Si añades una guarda, prueba también
  que salta cuando debe saltar.
- **Al arreglar, ataca la CAUSA, no el mensaje.** Un cartel que explica mejor un fallo que sigue
  ahí retira la señal que llevaba a la causa, y el fallo vuelve meses después.

---

## ✅ PUERTAS antes de entregar

```
npx tsc --noEmit -p tsconfig.json        # siempre
cargo check                              # si tocaste Rust
python scripts/audit_i18n.py             # si tocaste textos: 0 cadenas sin inglés
python scripts/check_privacidad.py       # siempre antes de publicar
```

- ⚠️ **`Finished` sin `Compiling` NO es un build verde.** Si cargo no recompiló, no probaste nada.
- ⚠️ **dev ≠ release.** Hay fallos que solo salen en la build de producción. Lo que se afirma de
  una release se comprueba en el `.exe` de release.
- ⚠️ `audit_i18n.py` es puerta, no opcional: saltársela ya hizo salir 17 cadenas solo en español.

## 📦 SDE — antes de integrar uno nuevo

```
python scripts/sde_check.py      # ¿nos importa esta release? qué tablas y qué extractores
```

1. **Comprueba el NOMBRE del zip.** 19 de los 22 extractores hacen
   `sorted(glob("documentacion/sde-source/*jsonl.zip"))[-1]`. Un zip bajado como
   `...-jsonl (1).zip` **no encaja en el glob** y usarán el viejo EN SILENCIO.
2. **Orden de regeneración** (no hay lanzador, se lanzan a mano):
   `extract_ships` → `extract_neweden` → `extract_industry_sde` → `extract_bp_tree` →
   `extract_industry_rigs` → `extract_rig_targets` → `extract_places_i18n` /
   `extract_ship_names_i18n` / `extract_ship_cargo` → el resto.
   Solo `bp_tree`, `industry_rigs` e `industry_sde` reciben `<zip> <public>`; los demás, nada.
3. **LA PRUEBA DE ORO para cualquier cambio en un generador**: ejecútalo con el SDE **ANTERIOR** y
   exige que reproduzca **byte a byte** el fichero que ya existía. Si no lo reproduce, el que está
   mal es el generador.
4. **Revisa el diff CLAVE POR CLAVE, no por líneas**: casi todos esos JSON son una sola línea
   minificada y `git diff` no dice nada útil de ellos.
5. **`sde_check.py --guardar-base` solo AL FINAL**, con la regeneración ya revisada.

## 🏷️ RELEASE

- **La versión va en SEIS sitios**: `package.json` · `package-lock.json` (×2) ·
  `src-tauri/tauri.conf.json` · `src-tauri/Cargo.toml` · `src-tauri/Cargo.lock`.
- 🚨 **Cámbialos POR NÚMERO DE LÍNEA, nunca con un reemplazo global**: un reemplazo global destroza
  la entrada del changelog de la versión anterior, que debe quedarse como está.
- `releaseDraft: true`: CI sube a un BORRADOR. Nada llega a nadie hasta publicarlo a mano.
- **El repaso del changelog es obligatorio.** Ha cazado cifras falsas en cuatro releases seguidas.
  **No afirmes un número que no hayas contado.** Si no lo has medido, no se escribe.

## ✍️ ESTILO

- **Comentarios que explican la TRAMPA y el PORQUÉ**, no lo que hace la línea. Si algo está escrito
  de una forma rara, el comentario dice qué pasó cuando se escribió de la forma obvia.
- **Mensajes de commit**: en español SIN acentos (compatibilidad de terminal), título corto, y
  cuerpo que cuenta qué estaba mal, por qué, y con qué se comprobó. Terminan con los trailers de
  atribución que ya usan los commits anteriores — míralos con `git log -1`.
- No reescribas historia publicada. Si algo publicado está mal, se corrige con un commit nuevo que
  lo diga.
