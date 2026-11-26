# Dónde estamos — actualizado 2026-11-26

> Léelo ANTES de empezar nada. Y **actualízalo al terminar**: este fichero existe para que una
> sesión nueva arranque sin que nadie le recuente la historia. Si miente, hace más daño que bien.
> Las reglas que no se negocian están en `CLAUDE.md` (raíz).

## Estado

- **Publicado: v0.57.0** (2026-11-11).
- **`main` va SEIS commits por delante y no hay release cortada.** Lo que lleva sin llegar a nadie:
  - `fdd5ed6` corrige una frase falsa del changelog de la 0.57.0.
  - `5376b5c` `extract_industry_sde` deja de leer un campo que el SDE borró.
  - `fea20d7` `release.yml`: tope de 45 minutos por job.
  - `440784b` + `9b9acef` **`scripts/sde_check.py`**, el guardián del SDE.
  - `cc33845` al día con el SDE **3720952** y base del guardián fijada.
- **SDE**: base en `3720952`. Hay uno nuevo sin integrar, el **3744011**
  (`20261125T110706Z`): **cero cambios de esquema** y **10 de 24 tablas con datos nuevos**.

## 🐛 ABIERTO: el intel deja de avisar (diagnosticado el 26-11, SIN arreglar)

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

## 📋 Pendientes

1. **Las 16 llamadas a `/universe` de ESI** → al catálogo local. Es la sesión grande y **la que
   abre SKINR**: coger SKINR obliga a subir la fecha de compatibilidad, y eso retira esas rutas.
   **Migrar primero, subir la fecha después. Nunca al revés.**
2. **Integrar el SDE 3744011** (10 tablas movidas, ningún riesgo de esquema).
3. **Auditar los 7 huérfanos de `public/`**: `agents`, `jumpships`, `module_slots`,
   `npc_corp_systems`, `ores`, `skill_names`, `skill_reqs`. Siguen sin generador.
4. **Mensaje a testers de la 0.57.0** — nunca se envió.
5. **Fuentes Rajdhani**: o se commitean (la OFL lo permite) o se quitan los `@font-face`. Hoy son
   decorativas: ninguna release las ha llevado nunca.
6. **Las notas de la release 0.57.0 en GitHub** siguen con la frase falsa; se editan a mano.
7. **Reintento en `apt-get update`** del workflow: el tope de 45 min es el tope, no la cura.

## Mapa del terreno

- **Intel**: `src-tauri/src/commands.rs` (el hilo vigilante, `spawn_intel_thread`) ·
  `src-tauri/src/chatlog.rs` (lectura de los logs) · `src/useIntel.ts` (orquesta) ·
  `src/intel.ts` (troceo) · `src/map.tsx`, `src/overlay.tsx`, `src/minimapaVentana.tsx` (pintan).
- **Ventanas**: tres, con etiquetas `main`, `overlay` y `minimapa`. En Tauri v2 **las capacidades
  van POR VENTANA**.
- **Datos del SDE**: 22 scripts en `scripts/extract_*.py` → 35 JSON en `public/`, más siete
  embebidos en el binario. El SDE entra SOLO por esos scripts: nada se pide en caliente.
