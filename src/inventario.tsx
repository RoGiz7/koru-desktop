// Transporte → «Qué tienes y dónde» (T1b del pilar de transporte).
//
// La pregunta gemela de «Tus naves». Allí sabes qué naves tienes y cuánto mueven; aquí, qué COSAS
// tienes y dónde están, con sus m³. Juntando las dos sale la tercera —cuántos viajes—, que es T3.
//
// Lo que hace útil a esto y no lo hace el juego: EVE te enseña un hangar cada vez. Aquí se ven
// TODAS tus ubicaciones a la vez, ordenadas por lo que costaría moverlas, que es exactamente el
// criterio para decidir qué merece un viaje.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, typeIcon } from "./format";
import { NotasAncla } from "./notas";

type AssetRow = {
  type_id: number;
  type_name: string | null;
  quantity: number;
  system_id: number;
  system_name: string | null;
  location_id: number;
  location_name: string;
  container: string | null;
  category: string;
  assembled: boolean;
};

type Volumenes = { packed: Record<string, number>; asm: Record<string, number> };

// ---- Caché de MÓDULO (vive lo que la app, muere al cerrarla) ----
// La sección se desmonta al salir de la pestaña, así que cada visita arrancaba EN BLANCO esperando
// las 7.000+ pilas del backend. Con 9 personajes se nota; con 2 no — lo cazó RoGiz7 (2026-08-22).
// El trato: al entrar se PINTA al instante la última respuesta conocida, y se re-pide DETRÁS
// exactamente igual que antes. Misma fidelidad (cada visita relee), cero espera en blanco.
const cacheAssets = new Map<string, AssetRow[]>();
// Los volúmenes son estáticos por sesión (JSON del SDE): una promesa cacheada, como loadNewEden.
let volsPromise: Promise<Volumenes> | null = null;
function loadVols(): Promise<Volumenes> {
  if (!volsPromise)
    volsPromise = Promise.all([
      fetch("/type_volumes.json").then((r) => r.json()),
      fetch("/type_volumes_assembled.json").then((r) => r.json()),
    ]).then(([packed, asm]) => ({ packed, asm }));
  return volsPromise;
}

/** m³ de una pila. Montado ocupa su volumen real; empaquetado, el reempaquetado. `null` = no
 *  sabemos el volumen de ese tipo, y eso se propaga en vez de contarlo como cero. */
function m3De(r: AssetRow, v: Volumenes): number | null {
  const k = String(r.type_id);
  const base = r.assembled ? v.asm[k] ?? v.packed[k] : v.packed[k];
  return base == null ? null : base * r.quantity;
}

/** ¿Esto es CARGA ahora mismo, o hay que reempaquetarlo antes de poder moverlo?
 *
 *  La regla sale del dato, no de una lista: `type_volumes_assembled.json` contiene EXACTAMENTE los
 *  tipos cuyo volumen montado difiere del empaquetado — o sea, naves y contenedores. Si una pila
 *  está montada y su tipo está ahí, no es carga: es flota aparcada o un contenedor anclado.
 *
 *  Importa porque si no, el total miente a lo grande: un Moros Navy Issue montado son 17,5 millones
 *  de m³ y jamás vas a meterlo en un carguero — lo vuelas. Sumarlo a «lo que costaría mover esto»
 *  convierte el número en un adorno. */
function esCarga(r: AssetRow, v: Volumenes): boolean {
  return !(r.assembled && v.asm[String(r.type_id)] != null);
}

type Ubicacion = {
  location_id: number;
  location_name: string;
  system_name: string | null;
  system_id: number;
  filas: AssetRow[];
  /** m³ de lo que SÍ es carga. Es el número que manda: el que decide viajes. */
  m3: number;
  /** m³ de naves y contenedores montados. Se enseña aparte, nunca sumado. */
  m3Flota: number;
  isk: number;
  sinVolumen: number;
};

export function InventarioView({
  subject,
  onVerEnMapa,
}: {
  subject: number | "global";
  /** «Ver en el mapa»: centra el sistema en la pestaña Mapa (fase 2 del centrado). */
  onVerEnMapa?: (sysId: number) => void;
}) {
  // 0 = Global, igual que en el resto de la app. Lo usan las notas de cada ubicación.
  const subjectId = typeof subject === "number" ? subject : 0;
  const [rows, setRows] = useState<AssetRow[] | null>(null);
  const [vols, setVols] = useState<Volumenes>({ packed: {}, asm: {} });
  const [precios, setPrecios] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [busca, setBusca] = useState("");
  /** Esconde lo que está DENTRO de una nave o contenedor. Puesto de fábrica: para decidir un viaje
   *  interesa el hangar, no el fiteo de cada nave — eso ya se ve en «Tus naves». */
  const [soloHangar, setSoloHangar] = useState(true);

  // Los assets se piden POR PERSONAJE cuando hay uno elegido. `get_assets_detail_global` funde a
  // todos y no marca de quién es cada pila, así que filtrar después era imposible: la vista
  // enseñaba lo de los nueve aunque seleccionaras uno.
  useEffect(() => {
    let vivo = true;
    const clave = String(subject);
    // Lo último conocido, al instante; null (esqueleto) solo si es la primera vez de verdad.
    setRows(cacheAssets.get(clave) ?? null);
    const p =
      subject === "global"
        ? invoke<AssetRow[]>("get_assets_detail_global")
        : invoke<AssetRow[]>("get_assets_detail", { characterId: subject });
    p.then((v) => {
      cacheAssets.set(clave, v); // la caché se actualiza AUNQUE la vista ya no esté montada
      if (vivo) setRows(v);
    }).catch((e) => vivo && setError(String(e)));
    return () => {
      vivo = false;
    };
  }, [subject]);

  useEffect(() => {
    loadVols()
      .then(setVols)
      .catch(() => {});
  }, []);

  // Precios en una sola llamada, y SOLO de los tipos que tienes: `get_type_prices` los quiere
  // enumerados. Es el precio medio de mercado, el mismo que usa el patrimonio — una referencia
  // para ordenar, no una tasación.
  useEffect(() => {
    if (!rows?.length) return;
    const ids = [...new Set(rows.map((r) => r.type_id))];
    invoke<Record<number, number>>("get_type_prices", { ids })
      .then(setPrecios)
      .catch(() => {});
  }, [rows]);

  const ubicaciones = useMemo<Ubicacion[]>(() => {
    const q = busca.trim().toLowerCase();
    const m = new Map<number, Ubicacion>();
    for (const r of rows ?? []) {
      if (soloHangar && r.container) continue;
      if (q && !(r.type_name ?? "").toLowerCase().includes(q)) continue;
      let u = m.get(r.location_id);
      if (!u) {
        u = {
          location_id: r.location_id,
          location_name: r.location_name,
          system_name: r.system_name,
          system_id: r.system_id,
          filas: [],
          m3: 0,
          m3Flota: 0,
          isk: 0,
          sinVolumen: 0,
        };
        m.set(r.location_id, u);
      }
      u.filas.push(r);
      const v = m3De(r, vols);
      if (v == null) u.sinVolumen += 1;
      else if (esCarga(r, vols)) u.m3 += v;
      else u.m3Flota += v;
      u.isk += (precios[r.type_id] ?? 0) * r.quantity;
    }
    // Por m³ DE CARGA, de mayor a menor: lo que más cuesta mover es la primera decisión que hay
    // que tomar. Ordenar por el total pondría arriba el sitio donde tienes aparcada la flota, que
    // es justo lo que no vas a mover.
    const out = [...m.values()];
    for (const u of out) {
      u.filas.sort((a, b) => {
        const ca = esCarga(a, vols) ? 0 : 1;
        const cb = esCarga(b, vols) ? 0 : 1;
        return ca - cb || (m3De(b, vols) ?? 0) - (m3De(a, vols) ?? 0);
      });
    }
    return out.sort((a, b) => b.m3 - a.m3);
  }, [rows, vols, precios, busca, soloHangar]);

  if (error) return <div className="error">{error}</div>;
  if (!rows) return <div className="muted">{tr("Cargando…")}</div>;

  const totalM3 = ubicaciones.reduce((s, u) => s + u.m3, 0);
  const totalFlota = ubicaciones.reduce((s, u) => s + u.m3Flota, 0);
  const totalIsk = ubicaciones.reduce((s, u) => s + u.isk, 0);
  const sinVol = ubicaciones.reduce((s, u) => s + u.sinVolumen, 0);

  return (
    <div className="inv">
      <div className="naves-filtros">
        <label className="intel-chk">
          <input
            type="checkbox"
            checked={soloHangar}
            onChange={(e) => setSoloHangar(e.target.checked)}
          />
          {tr("Solo lo suelto en el hangar")}
        </label>
        <input
          type="search"
          placeholder={tr("Buscar objeto…")}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      <p className="muted small">
        {fmtSp(ubicaciones.length)} {tr("ubicaciones")} · <b>{fmtSp(Math.round(totalM3))} m³</b>{" "}
        {tr("de carga")} · {fmtIsk(totalIsk)}
        {totalFlota > 0 && (
          <>
            {" · "}
            <span
              title={tr(
                "Naves y contenedores MONTADOS. No son carga: se vuelan o hay que reempaquetarlos antes de moverlos.",
              )}
            >
              + {fmtSp(Math.round(totalFlota))} m³ {tr("en flota montada")}
            </span>
          </>
        )}
        {sinVol > 0 && (
          <>
            {" · "}
            <span title={tr("El SDE no publica el volumen de estos tipos")}>
              {fmtSp(sinVol)} {tr("sin volumen conocido")}
            </span>
          </>
        )}
      </p>

      {ubicaciones.length === 0 && <div className="muted">{tr("Nada que enseñar aquí.")}</div>}

      <div className="inv-lista">
        {ubicaciones.map((u) => {
          const open = abierta === u.location_id;
          return (
            <div key={u.location_id} className="inv-ubi">
              <div
                className="inv-ubi-cab"
                onClick={() => setAbierta(open ? null : u.location_id)}
                title={tr("Ver lo que hay aquí")}
              >
                <span className="inv-ubi-nom">
                  {u.location_name || tr("ubicación desconocida")}
                </span>
                {/* span y no button: la cabecera entera YA es un botón (plegar/desplegar) y un
                    botón dentro de otro es HTML inválido. El stopPropagation evita plegar. */}
                {u.system_id && onVerEnMapa ? (
                  <span
                    className="muted small ver-mapa"
                    title={tr("Ver en el mapa")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onVerEnMapa(u.system_id);
                    }}
                  >
                    {u.system_name ?? `#${u.system_id}`}
                  </span>
                ) : (
                  <span className="muted small">{u.system_name ?? ""}</span>
                )}
                <span className="inv-ubi-m3">{fmtSp(Math.round(u.m3))} m³</span>
                <span className="muted small">
                  {u.m3Flota > 0 ? `+${fmtSp(Math.round(u.m3Flota))} ${tr("flota")}` : ""}
                </span>
                <span className="muted small">{fmtIsk(u.isk)}</span>
                <span className="muted small">
                  {fmtSp(u.filas.length)} {tr("pilas")}
                </span>
                {/* Notas de ESTA ubicación (N1) y, dentro, el disparador «avisarme cuando lleguen
                    X aquí» (N2b). El clic no debe plegar la ubicación. */}
                <span onClick={(e) => e.stopPropagation()}>
                  <NotasAncla
                    kind="location"
                    anchorId={u.location_id}
                    subject={subjectId}
                    anchorName={u.location_name || undefined}
                  />
                </span>
              </div>
              {open && (
                <div className="inv-filas">
                  {u.filas.slice(0, 200).map((r, i) => {
                    const v = m3De(r, vols);
                    return (
                      <div key={`${r.type_id}-${i}`} className="inv-fila">
                        <img src={typeIcon(r.type_id, 32)} alt="" loading="lazy" />
                        <span className="inv-nom">{r.type_name ?? `#${r.type_id}`}</span>
                        {r.assembled && (
                          <span className="nave-badge" title={tr("Montado: ocupa más que empaquetado")}>
                            {tr("montado")}
                          </span>
                        )}
                        <span className="muted small">×{fmtSp(r.quantity)}</span>
                        {/* Sin volumen conocido se dice, en vez de poner un 0 que parece un dato. */}
                        <span className="inv-m3">
                          {v == null ? tr("m³ desconocido") : `${fmtSp(Math.round(v))} m³`}
                        </span>
                      </div>
                    );
                  })}
                  {u.filas.length > 200 && (
                    <div className="muted small">
                      {tr("y")} {fmtSp(u.filas.length - 200)} {tr("pilas más")}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
