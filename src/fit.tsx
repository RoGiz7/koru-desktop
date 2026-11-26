import { type ReactNode, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fmtSp, typeIcon, typeRender } from "./format";
import { getLang, tr } from "./i18n";
import { comprobarSkills, type Catalogo, type Informe } from "./skillCheck";
import type { Fit, AssetDetail } from "./types";
import { loadJson } from "./staticJson";

// ---- Visor de fit circular (estilo ventana de fitting del juego) ----
/** `montado`: va en una ranura (o es la nave). Solo lo montado puede dejar el skill-check en «no se
 *  sabe»: ver `skillCheck.ts`. No sale de `fam`, a propósito: un módulo montado que aún no está en
 *  `module_slots.json` cae en «extra», y no por eso deja de estar montado. */
type WheelMod = { type_id: number; name: string; qty: number; fam: string; montado: boolean };
const RING_FAMS = ["high", "mid", "low", "rig", "sub"];
const FAM_LABEL: Record<string, string> = {
  high: "Slot alto",
  mid: "Slot medio",
  low: "Slot bajo",
  rig: "Rig",
  sub: "Subsistema",
  extra: "Drones / Carga",
};

// La nave en el centro y los módulos en círculo alrededor (altos→medios→bajos→rigs→subs).
// Drones/carga van en un panel lateral. Al pasar el ratón por un módulo se ve su info.
function FitWheel({
  shipTypeId,
  shipName,
  mods,
  charSkills,
  reqs,
  skillNames,
}: {
  shipTypeId: number;
  shipName: string;
  mods: WheelMod[];
  charSkills?: Record<number, number> | null;
  reqs?: Catalogo | null;
  skillNames?: Record<string, string>;
}) {
  const [hover, setHover] = useState<WheelMod | null>(null);
  // Skill-check: ¿puede el personaje activo pilotar este fit? ¿qué le falta?
  // La regla vive en `skillCheck.ts` y la prueba `scripts/verificar_skillcheck.mjs`.
  const skillReport: Informe | null = useMemo(
    () =>
      comprobarSkills(
        [{ type_id: shipTypeId, name: shipName, montado: true }, ...mods.map((m) => ({ type_id: m.type_id, name: m.name, montado: m.montado }))],
        reqs,
        charSkills,
        (sid) => skillNames?.[String(sid)] ?? `#${sid}`,
      ),
    [charSkills, reqs, skillNames, shipTypeId, shipName, mods],
  );
  const ring = mods
    .filter((m) => RING_FAMS.includes(m.fam))
    .sort((a, b) => RING_FAMS.indexOf(a.fam) - RING_FAMS.indexOf(b.fam));
  const extra = mods.filter((m) => !RING_FAMS.includes(m.fam));
  const SIZE = 460;
  const C = SIZE / 2;
  const R = 190;
  // Como en el juego: los slots se agrupan por familia en arcos con HUECOS entre grupos
  // (altos arriba → medios → bajos → rigs → subs, en sentido horario desde arriba).
  const placed: { m: WheelMod; ang: number }[] = [];
  {
    const groups = RING_FAMS.map((f) => ring.filter((m) => m.fam === f)).filter((g) => g.length > 0);
    const total = ring.length;
    const GAP = total > 0 ? Math.min(22, 130 / total) : 0; // hueco angular entre grupos
    const step = total > 0 ? (360 - groups.length * GAP) / total : 0;
    let ang = -90 + GAP / 2; // arranca arriba
    for (const g of groups) {
      for (const m of g) {
        placed.push({ m, ang });
        ang += step;
      }
      ang += GAP;
    }
  }
  return (
    <div className="fitw">
      <div className="fitw-wheel" style={{ width: SIZE, height: SIZE }}>
        <div className="fitw-ring" />
        <img className="fitw-ship" src={typeRender(shipTypeId, 512)} alt={shipName} />
        <div className="fitw-name">{shipName}</div>
        {placed.map(({ m, ang: deg }, i) => {
          const ang = (deg * Math.PI) / 180;
          const x = C + R * Math.cos(ang);
          const y = C + R * Math.sin(ang);
          return (
            <div
              key={i}
              className={`fitw-slot fam-${m.fam} ${hover === m ? "hl" : ""}`}
              style={{ left: `${x}px`, top: `${y}px` }}
              onMouseEnter={() => setHover(m)}
              onMouseLeave={() => setHover(null)}
            >
              <img src={typeIcon(m.type_id, 32)} alt="" loading="lazy" />
              {m.qty > 1 && <span className="fitw-qty">{m.qty > 99 ? "99+" : m.qty}</span>}
            </div>
          );
        })}
      </div>
      <div className="fitw-side">
        <div className="fitw-info">
          {hover ? (
            <>
              <img src={typeIcon(hover.type_id, 64)} alt="" />
              <div>
                <strong>{hover.name}</strong>
                {hover.qty > 1 && <span className="muted"> ×{fmtSp(hover.qty)}</span>}
                <div className="small muted">{tr(FAM_LABEL[hover.fam] ?? hover.fam)}</div>
              </div>
            </>
          ) : (
            <span className="small muted">{tr("Pasa el ratón por un módulo para ver su info.")}</span>
          )}
        </div>
        {skillReport && <InformeSkills r={skillReport} />}
        {extra.length > 0 && (
          <div className="fitw-extra">
            <div className="fit-group-h">{tr("Drones / Carga")}</div>
            {extra.map((m, i) => (
              <div className="fit-mod" key={i} title={m.name}>
                <img className="type-ico" src={typeIcon(m.type_id)} alt="" loading="lazy" />
                <span className="fit-mod-name">{m.name}</span>
                {m.qty > 1 && <span className="fit-mod-qty">×{fmtSp(m.qty)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** El veredicto del skill-check, con un `switch` exhaustivo: un veredicto nuevo no compila hasta
 *  tener su pantalla. Lo que no se sabe NUNCA sale como «puedes pilotarlo». */
function InformeSkills({ r }: { r: Informe }) {
  const en = getLang() === "en";
  const listaFaltan = r.faltan.map((s) => (
    <div className="fitw-skill" key={s.skill}>
      <span>{s.name}</span>
      <span className="muted small">
        {s.have} → {s.need}
      </span>
    </div>
  ));
  let cuerpo: ReactNode;
  let cls: string;
  switch (r.veredicto) {
    case "puede":
      cls = "ok";
      cuerpo = <span>✅ {tr("Puedes pilotar este fit con tus skills.")}</span>;
      break;
    case "faltan":
      cls = "no";
      cuerpo = (
        <>
          <div className="fitw-skills-h">⚠ {tr("Te faltan")} {r.faltan.length} skills:</div>
          {listaFaltan}
        </>
      );
      break;
    case "no_se_sabe": {
      cls = "nose";
      const n = r.desconocidos.length;
      cuerpo = (
        <>
          <div className="fitw-skills-h">
            ❓{" "}
            {en
              ? `Koru doesn't know the requirements of ${n} ${n === 1 ? "item" : "items"} in this fit, so it can't say whether you can fly it:`
              : `Koru no conoce los requisitos de ${n} ${n === 1 ? "cosa" : "cosas"} de este fit, así que no puede decir si puedes pilotarlo:`}
          </div>
          {r.desconocidos.map((d) => (
            <div className="fitw-skill" key={d.type_id}>
              <span>{d.name}</span>
            </div>
          ))}
          {r.faltan.length > 0 && (
            <>
              <div className="fitw-skills-h">
                {en
                  ? `And of what it does know, you're missing ${r.faltan.length} ${r.faltan.length === 1 ? "skill" : "skills"}:`
                  : `Y de lo que sí conoce, te ${r.faltan.length === 1 ? "falta 1 skill" : `faltan ${r.faltan.length} skills`}:`}
              </div>
              {listaFaltan}
            </>
          )}
        </>
      );
      break;
    }
    default: {
      const nunca: never = r.veredicto;
      return nunca;
    }
  }
  const n = r.sinComprobar.length;
  return (
    <div className={`fitw-skills ${cls}`}>
      {cuerpo}
      {/* DISCRETA a propósito, sin ⚠: sale en casi cualquier nave con carga (mineral, combustible,
          PLEX…), y el aviso fuerte se reserva para lo que cambia el veredicto. */}
      {n > 0 && (
        <div className="muted small fitw-sincomprobar" title={r.sinComprobar.map((x) => x.name).join(", ")}>
          {en
            ? `${n} ${n === 1 ? "item" : "items"} in the drone bay or cargo ${n === 1 ? "isn't" : "aren't"} in the requirements catalogue and ${n === 1 ? "wasn't" : "weren't"} checked.`
            : `${n} ${n === 1 ? "cosa" : "cosas"} de los drones o la bodega no ${n === 1 ? "está" : "están"} en el catálogo de requisitos y no se ${n === 1 ? "ha" : "han"} mirado.`}
        </div>
      )}
    </div>
  );
}

// Visor de un fit guardado (Fiteos): slot de cada módulo vía module_slots.json.
function FitDisplay({
  fit,
  slots,
  charSkills,
  reqs,
  skillNames,
}: {
  fit: Fit;
  slots: Record<string, string>;
  charSkills?: Record<number, number> | null;
  reqs?: Catalogo | null;
  skillNames?: Record<string, string>;
}) {
  const mods: WheelMod[] = fit.modules.map((m) => ({
    type_id: m.type_id,
    name: m.name,
    qty: m.qty,
    fam: m.fitted ? slots[String(m.type_id)] ?? "extra" : "extra",
    montado: m.fitted,
  }));
  return (
    <FitWheel
      shipTypeId={fit.ship_type_id}
      shipName={fit.ship_name}
      mods={mods}
      charSkills={charSkills}
      reqs={reqs}
      skillNames={skillNames}
    />
  );
}

// ---- Caché de MÓDULO (vive lo que la app, muere al cerrarla) ----
// El trato de siempre (ver inventario.tsx). `list_fits` no lleva argumentos → una sola caché;
// las skills van por personaje, que es su único argumento. Los tres JSON del SDE (huecos de
// módulo, requisitos y nombres de skill) van por `staticJson.ts` — nacieron con una caché LOCAL
// de este fichero, antes de que ese módulo existiera, y así no compartían nada con Assets, que
// usa los mismos dos de skills.
let cacheFits: Fit[] | null = null;
const cacheSkills = new Map<string, Record<number, number>>();

export function FitsView({ charId, charName }: { charId: number | null; charName: string | null }) {
  const [fits, setFits] = useState<Fit[]>([]);
  const [slots, setSlots] = useState<Record<string, string>>({});
  // `null` hasta que llega: un catálogo CARGANDO no es un catálogo vacío. Con `{}` el visor decía
  // «puedes pilotarlo» mientras bajaba el fichero.
  const [reqs, setReqs] = useState<Catalogo | null>(null);
  const [skillNames, setSkillNames] = useState<Record<string, string>>({});
  const [charSkills, setCharSkills] = useState<Record<number, number> | null>(null);
  const [eft, setEft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<Fit | null>(null);
  useEffect(() => {
    if (cacheFits) setFits(cacheFits);
    invoke<Fit[]>("list_fits")
      .then((d) => {
        cacheFits = d; // se guarda aunque la vista ya no esté montada
        setFits(d);
      })
      .catch(() => {});
    // Los tres JSON del SDE, una vez por SESIÓN en vez de una por visita.
    loadJson<Record<string, string>>("/module_slots.json", {}).then(setSlots);
    loadJson<Record<string, [number, number][]>>("/skill_reqs.json", {}).then(setReqs);
    loadJson<Record<string, string>>("/skill_names.json", {}).then(setSkillNames);
  }, []);
  useEffect(() => {
    if (charId == null) {
      setCharSkills(null);
      return;
    }
    const clave = String(charId);
    setCharSkills(cacheSkills.get(clave) ?? null);
    invoke<Record<number, number>>("get_char_skill_levels", { characterId: charId })
      .then((d) => {
        cacheSkills.set(clave, d);
        setCharSkills(d);
      })
      .catch(() => setCharSkills(null));
  }, [charId]);
  async function importGame() {
    if (charId == null) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const imported = await invoke<Fit[]>("import_fittings", { characterId: charId });
      setFits((prev) => [...imported, ...prev]);
      setNotice(
        imported.length > 0
          ? `${tr("Importados")} ${imported.length} ${tr("fits de")} ${charName ?? tr("tu personaje")}.`
          : tr("No hay fits nuevos que importar.")
      );
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!eft.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const f = await invoke<Fit>("save_fit", { eft });
      setFits((prev) => [f, ...prev]);
      setEft("");
      setOpen(f);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function del(id: number) {
    try {
      await invoke("delete_fit", { id });
      setFits((prev) => prev.filter((f) => f.id !== id));
      if (open?.id === id) setOpen(null);
    } catch (e) {
      setErr(String(e));
    }
  }
  return (
    <div className="fits-view">
      <div className="fits-import">
        <textarea
          className="fits-eft"
          value={eft}
          onChange={(e) => setEft(e.target.value)}
          placeholder={tr("Pega aquí un fit en formato EFT:") + "\n\n[Thanatos, Mi fit]\nDrone Damage Amplifier II\n..."}
          rows={5}
        />
        <div className="fits-actions">
          <button className="fits-save" onClick={save} disabled={busy || !eft.trim()}>
            {busy ? "…" : tr("Importar fit (EFT)")}
          </button>
          <button
            className="fits-import-game"
            onClick={importGame}
            disabled={busy || charId == null}
            title={
              charId == null
                ? tr("Selecciona un personaje arriba para importar sus fits del juego")
                : tr("Trae tus fits guardados en EVE")
            }
          >
            🚀 {tr("Importar fits del juego")}
          </button>
        </div>
        {err && <span className="fits-err small">{err}</span>}
        {notice && <span className="small muted">{notice}</span>}
      </div>
      {fits.length > 0 && (
        <div className="fits-list">
          {fits.map((f) => (
            <div
              key={f.id}
              className={`fits-card ${open?.id === f.id ? "active" : ""}`}
              onClick={() => setOpen(f)}
            >
              <img className="type-ico" src={typeIcon(f.ship_type_id)} alt="" loading="lazy" />
              <span className="fits-card-tx">
                <strong>{f.name}</strong>
                <span className="small muted">{f.ship_name}</span>
              </span>
              <button
                className="fits-del"
                title={tr("Borrar fit")}
                onClick={(e) => {
                  e.stopPropagation();
                  del(f.id);
                }}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
      {open ? (
        <FitDisplay
          fit={open}
          slots={slots}
          charSkills={charSkills}
          reqs={reqs}
          skillNames={skillNames}
        />
      ) : (
        fits.length === 0 && (
          <p className="muted small">
            {tr("Aún no hay fiteos. Pega un EFT (en EVE: clic derecho en el fitting → Copiar al portapapeles) y pulsa Importar.")}
          </p>
        )
      )}
    </div>
  );
}

// location_flag de EVE → familia de slot del visor circular.
function flagFamily(flag: string): string {
  if (flag.startsWith("HiSlot")) return "high";
  if (flag.startsWith("MedSlot")) return "mid";
  if (flag.startsWith("LoSlot")) return "low";
  if (flag.startsWith("RigSlot")) return "rig";
  if (flag.startsWith("SubSystem")) return "sub";
  return "extra"; // DroneBay, Cargo, Fighter, bodegas…
}
export const FIT_SLOTS_RE = /^(HiSlot|MedSlot|LoSlot|RigSlot|SubSystem)/;

// Fit de una nave abierta en Assets: reusa el visor circular.
export function ShipFit(props: {
  rows: AssetDetail[];
  typeId: number;
  name: string;
  charSkills?: Record<number, number> | null;
  reqs?: Catalogo | null;
  skillNames?: Record<string, string>;
}) {
  const { rows, typeId, name, charSkills, reqs, skillNames } = props;
  const mods: WheelMod[] = rows.map((r) => ({
    type_id: r.type_id,
    name: r.type_name ?? `#${r.type_id}`,
    qty: r.quantity,
    fam: flagFamily(r.slot),
    montado: FIT_SLOTS_RE.test(r.slot),
  }));
  return (
    <FitWheel
      shipTypeId={typeId}
      shipName={name}
      mods={mods}
      charSkills={charSkills}
      reqs={reqs}
      skillNames={skillNames}
    />
  );
}
