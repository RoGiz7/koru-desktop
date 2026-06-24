# Koru Desktop — Scopes ESI (verificado)

**Fecha:** 2026-06-22 · Verificado contra la lista oficial de scopes ESI (route→scope).
Principio rector de CCP: **privilegio mínimo** — pedir solo los scopes que la app realmente usa, y
**consentimiento granular** — no obligar a un usuario que solo quiere PvP a ceder su wallet.

## 1. Cómo estructura CCP los scopes

- Formato: `esi-<dominio>.<acción>_<recurso>.v1` (p. ej. `esi-wallet.read_character_wallet.v1`).
- Cada **ruta** de ESI declara qué scope exige (visible en el API Explorer).
- Un scope cubre **varias rutas** (p. ej. `read_character_wallet` da balance + journal + transactions).
- Hay rutas **públicas** sin scope (detalle de killmail con id+hash, `/universe/*`, info pública).
- Los scopes se **declaran en el registro de la app**; en cada login puedes pedir un **subconjunto**.
  Añadir un scope después = re-lanzar el flujo pidiéndolo (consentimiento incremental).

## 2. Scopes que necesita Koru Desktop (v1) — solo lectura

### Grupo PvP (Fase 2)
| Scope | Rutas |
|-------|-------|
| `esi-killmails.read_killmails.v1` | `/characters/{id}/killmails/recent/` |

> El **detalle** del killmail (`/killmails/{killmail_id}/{hash}/`) es **público**.
> El histórico se complementa con **zKillboard** (público, sin scope).

### Grupo Wallet / economía (Fase 3)
| Scope | Rutas |
|-------|-------|
| `esi-wallet.read_character_wallet.v1` | `/wallet/`, `/wallet/journal/`, `/wallet/transactions/` |

> Opcional: `esi-markets.read_character_orders.v1` (`/orders/`, `/orders/history/`).

### Grupo Skills / training (Fase 3)
| Scope | Rutas |
|-------|-------|
| `esi-skills.read_skills.v1` | `/skills/`, `/attributes/` |
| `esi-skills.read_skillqueue.v1` | `/skillqueue/` |

> Contexto opcional: `esi-clones.read_implants.v1`, `esi-clones.read_clones.v1`.

### Grupo Assets / industria (Fase 4)
| Scope | Rutas |
|-------|-------|
| `esi-assets.read_assets.v1` | `/assets/`, `/assets/locations/`, `/assets/names/` |
| `esi-industry.read_character_jobs.v1` | `/industry/jobs/` |
| `esi-industry.read_character_mining.v1` | `/mining/` |

> Opcional: `esi-characters.read_blueprints.v1` (`/blueprints/`).

### Grupo "estado en vivo" (opcional, transversal)
| Scope | Ruta |
|-------|------|
| `esi-location.read_location.v1` | `/location/` |
| `esi-location.read_ship_type.v1` | `/ship/` |
| `esi-location.read_online.v1` | `/online/` |

## 3. Conjunto a declarar en el registro de la app

**Mínimo v1 (núcleo de las 4 features):**

```
esi-killmails.read_killmails.v1
esi-wallet.read_character_wallet.v1
esi-skills.read_skills.v1
esi-skills.read_skillqueue.v1
esi-assets.read_assets.v1
esi-industry.read_character_jobs.v1
esi-industry.read_character_mining.v1
```

**Recomendado añadir (opcionales), para no re-registrar la app más adelante:**

```
esi-markets.read_character_orders.v1
esi-clones.read_implants.v1
esi-clones.read_clones.v1
esi-characters.read_blueprints.v1
esi-location.read_location.v1
esi-location.read_ship_type.v1
esi-location.read_online.v1
```

> Declarar un scope **no** lo concede: solo permite *poder pedirlo*. El usuario consiente aparte.

## 4. Estrategia de consentimiento (recomendación CCP aplicada)

1. **Login base = identidad sin scopes** (solo `sub`/`name` del JWT).
2. **Activación por feature:** al abrir PvP/Wallet/Skills/Assets por primera vez, se re-lanza el
   flujo pidiendo **solo** ese scope.
3. **Guardar qué scopes tiene cada personaje** (claim `scp` → `characters.scopes`); la UI atenúa
   features sin scope con un botón "Conceder acceso".
4. **Re-auth para ampliar:** repetir el flujo con la lista ampliada.

> Alternativa simple: pedir el set mínimo v1 completo en el primer login (menos clics, más cesión
> de golpe). Implementado: el desplegable permite ambas vías ("Solo identidad" … "Set completo v1").

## 4b. Scope base `publicData`

Aunque endpoints como `/characters/{id}/` se consideran "públicos", CCP exige el scope mínimo
**`publicData`** en el token para poder llamarlos desde la app (info pública del personaje: corp,
alianza, etc.). Marcar `publicData` en el registro de la app. Sin él, las tarjetas no muestran
corporación/alianza.

## 5. Lo que deliberadamente NO pedimos

- **Ningún `write_*`** (no escribimos en la cuenta).
- **Ningún `*_corporation_*` ni de director.** Koru Desktop es **personal**; datos de corp siguen
  siendo terreno de `koru_auditor`/corptools con tokens de director.
- **Mail, calendar, contacts, fleets, PI, fittings:** no aportan a las stats v1.

## 6. Endpoints públicos (sin scope) que sí usaremos

- `GET /killmails/{killmail_id}/{killmail_hash}/` — detalle verificado.
- `GET /universe/...` y/o **SDE** — resolver `type_id`, `system_id`, nombres.
- Info pública de personaje/corp/alianza.
- **zKillboard API** — histórico de killmails (id+hash).

---
_Fuente verificada: lista oficial de scopes ESI (route→scope)._
