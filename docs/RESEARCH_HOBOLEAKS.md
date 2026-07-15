# Hoboleaks: la tercera fuente de datos

*Investigación del 2026-07-15. Autor de la idea: RoGiz7 — «quizá hay cosas que no sabíamos que
podíamos».*

Este documento explica **qué es Hoboleaks, por qué existe, qué nos sirve, qué NO nos sirve (y por
qué), y qué riesgos asume Koru al usarlo**. Está escrito para leerse dentro de dos años, cuando ya
nadie recuerde cómo llegamos aquí.

---

## 1. El problema que nos llevó ahí

Koru necesitaba saber **a qué productos aplica cada rig de industria** de una estructura Upwell. Sin
eso, el árbol BOM no puede decidir si el rig de naves de tu Sotiyo abarata el crucero que estás
fabricando o no.

Buscamos el dato **y agotamos las fuentes oficiales**. Esto es lo que se comprobó, no lo que se
supuso:

| Dónde miramos | Qué encontramos |
| --- | --- |
| Atributos dogma del rig | `canFitShipGroup01/02/03` = dónde se **monta** el rig (Citadel / Engineering Complex / Refinery). **No** a qué afecta. |
| `typeLists.jsonl` (460 listas) | Ninguna es de industria. |
| Efectos dogma del rig | Solo el **nombre**: `rigAllShipManufactureMaterialBonus` → alcance «AllShipManufacture». Un nombre, no una lista de productos. |
| Descripción del ítem | Prosa de CCP: «any ship», «cruisers, battlecruisers, industrial ships and mining barges»… Útil para explicar, **inservible para calcular**. |
| ESI | No lo expone. |

**Conclusión: el mapeo alcance→producto NO está en el SDE ni en ESI.** Está en los ficheros del
**cliente** de EVE, y CCP/FC no los exporta.

## 2. Qué es Hoboleaks

`https://sde.hoboleaks.space/tq/` publica en JSON datos que están en el cliente de EVE pero no en el
SDE ni en ESI. Los extraen del cliente; no los inventan. Se actualiza **minutos después de cada
parche de TQ**.

Su propia página marca los ficheros con dos símbolos que conviene entender:

- `*` → **«el SDE/ESI lo trae, pero mal o desactualizado; aquí está el bueno»**. Ojo con estos: son
  una acusación explícita a la fuente oficial.
- `**` → «altamente experimental, puede no estar al día».

## 3. Estatus real de estas fuentes (importante, y no es lo que parece)

**EVE Ref, zKillboard y EVE Workbench están listadas y promocionadas en la documentación oficial de
desarrolladores** (`developers.eveonline.com/docs/community/`). Eso es real y significa que el
ecosistema está bendecido.

**Pero NO están patrocinadas ni respaldadas.** La nota legal de EVE Ref dice literalmente que se le
ha concedido permiso para usar la marca «*but does not endorse, and is not in any way affiliated
with*». El Partnership Program de EVE es para **creadores de contenido**, no para herramientas.

Traducción para nosotros: **ecosistema sancionado, cero garantía y cero compromiso de servicio.**

## 4. Cómo encaja EVE Ref

EVE Ref **no es una fuente**: es una fusión de tres (SDE + ESI + Hoboleaks) servida en un formato
común. Su propia documentación (`docs.everef.net/datasets/reference-data`) trae una tabla de
procedencia que dice de dónde sale cada cosa. Ahí es donde aparece:

```
Industry modifier sources  →  industrymodifiersources.json   (Hoboleaks)
Industry target filters    →  industrytargetfilters.json     (Hoboleaks)
```

Además avisan de que su Reference Data está *«currently in development... changes may occur at any
time»*.

**Regla que sale de aquí: ir a Hoboleaks (la fuente) y usar EVE Ref como CONTRASTE (el derivado).**
No al revés.

## 5. Qué nos sirve, por orden de valor

### 5.1 `industrytargetfilters.json` + `industrymodifiersources.json` — **confirmado**

El mapeo rig→producto. EVE Ref lo sirve ya resuelto por ítem:

```json
// ref-data.everef.net/types/37181  (Standup XL-Set Ship Manufacturing Efficiency II)
"engineering_rig_affected_category_ids": { "manufacturing": [6, 32] }

// ref-data.everef.net/types/43705  (Standup XL-Set Structure and Component Manufacturing Eff. II)
"engineering_rig_affected_category_ids": { "manufacturing": [23, 39, 40, 65, 66] },
"engineering_rig_affected_group_ids":    { "manufacturing": [332,334,536,716,873,913,964,1136,4736] }
```

**Validado contra la realidad**: la categoría 6 (Ship) **está** en el 37181 y **no está** en el
43705. Eso reproduce exactamente las cantidades de un job real de EVE, al ítem. El dato de Hoboleaks
coincide con lo que hace el servidor.

**Y nos corrigió**: nuestro mapeo escrito a mano decía que el rig de naves aplica a la categoría 6.
Son **[6, 32]** — la 32 es **Subsystem**. El rig de naves también abarata los subsistemas T3, y la
descripción de CCP («any ship») no lo menciona. Estábamos cobrando de más.

**Bonus**: cada ítem trae también el índice inverso `engineering_rig_source_type_ids` = *qué rigs
afectan a fabricar ESTO*. Es la pregunta del BOM formulada del derecho.

### 5.2 `repackagedvolumes.json` — lleva el asterisco

**Hoboleaks afirma que el volumen del SDE está mal.** El m³ es la pieza central de **F4 (transporte
integrado en el build-vs-buy)**, que es el hueco que ninguna herramienta de la comunidad cubre. Si la
ventaja de Koru se va a construir sobre un número, más vale que sea el correcto. **Siguiente a
investigar.**

### 5.3 Otros candidatos

| Fichero | Para qué |
| --- | --- |
| `compressibletypes.json` | Qué mena comprime en qué. Minería no lo tiene. |
| `industryinstallationtypes.json`, `industryassemblylines.json` | Hoy Koru **deduce** dónde se puede fabricar del `canFitShipGroupNN` de la planta. Quizá esto lo diga directo. |
| `dynamicitemattributes.json` | Mutaplásmidos / abyssals. |
| `clonestates.json`, `skillplans.json` | Skills. |

### 5.4 `meta.json` — el que hace seguros a todos los demás

Trae, por fichero: timestamp, **md5** y una bandera **`stale`**.

- El **md5** permite detectar cambios *reales* (una revisión nueva no implica contenido nuevo).
- La bandera **`stale`** dice que la actualización falló tras un parche — normalmente porque CCP
  cambió la estructura del dato. **Un fichero stale está podrido.**

**Usar `meta.json` SIEMPRE que se consuma Hoboleaks.** Es la lección del intel aplicada a un fichero:
lo que falla en silencio, falla dos veces.

## 6. Qué NO nos sirve — `accountingentrytypes.json`

Se descarta **con datos**, y se documenta para que nadie lo vuelva a investigar.

La idea era arreglar el cajón «Otros» del wallet: `categorize_income/expense` (en `db/mod.rs`) tiene
~42 `ref_type` escritos a mano y todo lo demás cae en «Otros». Hoboleaks publica **218** tipos.
Parecía la solución. **No lo es:**

1. **La unión no casa.** ESI manda `ref_type` en snake_case (`bounty_prizes`); Hoboleaks indexa por
   ID numérico con nombre humano («Bounty Prizes»). El puente obvio —snake-casear el nombre— **falla
   en 7 de los 42** que ya usamos: `ess_escrow_transfer`, `asset_safety`, `reaction`,
   `market_provider_tax`, `daily_goal_payouts`, `milestone_reward_payment`, `structure_gate_jump`.
   Un puente que falla el 17 % no es un puente.
2. **No hay traducción.** `entryTypeNameTranslated` devuelve el mismo inglés. Cero para el bilingüe.
3. **Los 218 son un espejismo.** Los 181 que no cubrimos son fósiles: `atm_withdraw`,
   `gm_cash_transfer`, `backward_compatible`, `agents_temporary` («TEMP»). No aparecerán jamás en un
   wallet moderno.

**Y la forma correcta de arreglar «Otros» estaba en casa**: preguntarle al propio SQLite qué
`ref_type` han caído en «Otros» a lo largo del histórico. Eso es la realidad del usuario; un fichero
de terceros no la conoce. *(Pendiente, y es barato.)*

## 7. Riesgos — van al código, no a la cabeza

1. **Relojes distintos.** Hoboleaks se actualiza con el parche de TQ; el SDE se publica después.
   Mezclar dos fuentes desincronizadas es **una forma nueva de mentir**. Hay que decidir cuál manda
   y decirlo en voz alta.
2. **Terceros sin compromiso.** Ni Hoboleaks ni EVE Ref deben nada a nadie, y la Reference Data se
   declara «in development».
   **Mitigación real**: los extractores solo corren cuando sale un SDE nuevo, y su resultado **se
   congela** en `public/*.json`. Si mañana desaparecen los dos, **la app no se rompe** — se rompe la
   *regeneración*. Eso es asumible; lo que no es asumible es descubrirlo dentro de dos años.
3. **`stale` existe por algo.** Ver §5.4.

## 8. Reglas que salen de esta investigación

- **Tres fuentes, siempre confrontadas**: la fuente (Hoboleaks/SDE/ESI) + el derivado (EVE Ref) + la
  realidad (un job real del juego). Si las tres coinciden, el dato deja de ser una opinión.
- **Un resumen de buscador no es una fuente.** Ir al dato, al devblog o al foro.
- **La descripción de CCP explica; no calcula.** Se queda corta (no menciona Skyhook, Infrastructure
  Upgrades ni Sovereignty Structures, que son de Equinox) y a veces contradice a los efectos: el rig
  XL de Equipment tiene efectos de munición y drones que su texto no menciona, porque es un
  copia-pega del rig L. **Cuando descripción y efectos chocan, mandan los efectos** — es lo que lee
  el servidor.
- **Agotar la fuente oficial antes de ir a terceros**, y dejar escrito que se agotó. Media tarde se
  fue en buscar en el SDE algo que nunca estuvo ahí; que el siguiente no la pierda.

## 9. Fuentes

- Hoboleaks — SDE Complements: <https://sde.hoboleaks.space/>
- EVE Ref — Reference Data (tabla de procedencia): <https://docs.everef.net/datasets/reference-data>
- EVE Ref — ejemplo de tipo: <https://everef.net/types/43705> · <https://ref-data.everef.net/types/43705>
- EVE Developer Documentation — Community tools: <https://developers.eveonline.com/docs/community/>
- EVE University — Upwell structure: <https://wiki.eveuniversity.org/Upwell_structure>
  *(cubre bonos de estructura y servicios; **no** tiene el alcance de cada rig — se consultó y no
  servía para esto.)*
