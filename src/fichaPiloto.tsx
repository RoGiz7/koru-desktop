// LA FICHA DE PILOTO — la pieza que une los seis sitios donde Koru habla de gente.
// Idea de RoGiz7 al cerrar Social: «las flotas necesitarán de social… algo que una todos
// los personajes». Se abre desde cualquier sitio con un nombre (y un id si el llamante lo
// tiene); el Rust hace el JOIN y aquí SOLO se pintan los bloques que traen datos — la ficha
// jamás rellena con ceros lo que no vio. Enlaces externos ARRIBA junto al nombre, como en
// las tarjetas del mapa (el lenguaje que ya se acordó); las acciones de Koru, abajo.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { typeIcon } from "./format";
import { loadShipNames } from "./flotas";
import { loadNewEden } from "./neweden";
import { openExternal } from "./openExternal";

type CountItem = { id: number; count: number };
export type FichaPilotoData = {
  name: string;
  character_id: number | null;
  kills_juntos: number;
  dias_juntos: number;
  primer_kill: string | null;
  ultimo_kill: string | null;
  sus_naves: CountItem[];
  ops_juntas: number;
  minutos_op: number;
  ultima_op: string | null;
  naves_op: CountItem[];
  msgs: number;
  convos: number;
  primer_msg_ts: number | null;
  ultimo_msg_ts: number | null;
  avistamientos: number;
  ultimo_avist_ms: number | null;
  sistema_favorito: number | null;
  notas: string[];
};

function año(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}
function hace(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return tr("hoy");
  if (d === 1) return tr("ayer");
  // Plantilla con N, no fragmentos sueltos: en inglés el orden cambia («N days ago»).
  return tr("hace N días").replace("N", String(d));
}

/** EL NOMBRE DE UN PILOTO, clicable hacia su ficha — el MISMO aspecto esté donde esté
 *  (subrayado punteado + tooltip), como los sistemas tienen el suyo con «ver en el mapa».
 *  Un solo componente a propósito: si cada sitio pintara el suyo, divergirían sin que nadie
 *  lo viera. stopPropagation SIEMPRE: muchos nombres viven dentro de filas que ya clican. */
export function PilotoNombre({
  nombre,
  id,
  onFicha,
}: {
  nombre: string;
  id?: number | null;
  onFicha?: (name: string, id?: number | null) => void;
}) {
  if (!onFicha) return <>{nombre}</>;
  return (
    <span
      className="piloto-link"
      title={tr("Abrir la ficha del piloto")}
      onClick={(e) => {
        e.stopPropagation();
        onFicha(nombre, id);
      }}
    >
      {nombre}
    </span>
  );
}

/** Chips de naves con icono real + nombre (si el catálogo lo conoce). */
function Naves({ items, ships }: { items: CountItem[]; ships: Map<number, string> | null }) {
  return (
    <span className="fp-naves">
      {items.map((n) => (
        <span key={n.id} className="fp-nave" title={`×${n.count}`}>
          <img src={typeIcon(n.id, 32) ?? undefined} alt="" width={18} height={18} loading="lazy" />
          {ships?.get(n.id) ?? `#${n.id}`}
          {n.count > 1 && <span className="muted"> ×{n.count}</span>}
        </span>
      ))}
    </span>
  );
}

export function FichaPiloto({
  name,
  characterId,
  onClose,
  onVerMapa,
  onIrA,
}: {
  name: string;
  characterId?: number | null;
  onClose: () => void;
  /** Centrar el mapa en un sistema (el puente que ya existe). */
  onVerMapa?: (sysId: number) => void;
  /** Saltar a una sección (Social) — el detalle vive en su casa, no aquí. */
  onIrA?: (tab: string) => void;
}) {
  const [data, setData] = useState<FichaPilotoData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ships, setShips] = useState<Map<number, string> | null>(null);
  const [sysNames, setSysNames] = useState<Map<number, string> | null>(null);

  useEffect(() => {
    setData(null);
    setErr(null);
    invoke<FichaPilotoData>("pilot_ficha", { name, characterId: characterId ?? null })
      .then(setData)
      .catch((e) => setErr(String(e)));
    loadShipNames().then(setShips).catch(() => {});
    loadNewEden()
      .then((ne) => setSysNames(new Map(ne.systems.map((s) => [s.id, s.n]))))
      .catch(() => {});
  }, [name, characterId]);

  // Cerrar con Escape: una ficha es una consulta, no un estado — debe irse sin ceremonia.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const cid = data?.character_id ?? characterId ?? null;
  const vacia =
    data &&
    data.kills_juntos === 0 &&
    data.ops_juntas === 0 &&
    data.msgs === 0 &&
    data.avistamientos === 0 &&
    data.notas.length === 0;

  return (
    <div className="fp-overlay" onClick={onClose}>
      <div className="fp-card" onClick={(e) => e.stopPropagation()}>
        <div className="fp-head">
          {cid ? (
            <img
              className="fp-retrato"
              src={`https://images.evetech.net/characters/${cid}/portrait?size=64`}
              alt=""
            />
          ) : (
            <span className="fp-inicial">{name.slice(0, 1).toUpperCase()}</span>
          )}
          <div className="fp-quien">
            <strong>{data?.name ?? name}</strong>
            <span className="fp-links">
              {cid && (
                <button
                  className="ops-link"
                  onClick={() => openExternal(`https://zkillboard.com/character/${cid}/`)}
                >
                  zKillboard ↗
                </button>
              )}
              {!cid && data && (
                <span className="muted small" title={tr("El nombre no resuelve a un personaje (¿renombrado o biomasado?). Lo local se enseña igual.")}>
                  {tr("sin identificar")}
                </span>
              )}
            </span>
          </div>
          <button className="fp-cerrar" onClick={onClose} title={tr("Cerrar")}>
            ✕
          </button>
        </div>

        {err && <p className="error small">{err}</p>}
        {!data && !err && <p className="muted small">{tr("Cargando…")}</p>}

        {data && vacia && (
          <p className="muted">
            {tr("Tu histórico no dice nada de esta persona todavía: ni kills compartidos, ni ops, ni conversaciones, ni intel.")}
          </p>
        )}

        {data && data.kills_juntos > 0 && (
          <div className="fp-bloque">
            <div className="fp-titulo">⚔ {tr("Habéis volado juntos")}</div>
            <div className="fp-dato">
              <strong>{data.kills_juntos}</strong> {tr("kills juntos")} ·{" "}
              <strong>{data.dias_juntos}</strong> {tr("días distintos")}
              {data.primer_kill && (
                <span className="muted">
                  {" "}
                  · {data.primer_kill.slice(0, 4)} → {data.ultimo_kill?.slice(0, 4)}
                </span>
              )}
            </div>
            {data.sus_naves.length > 0 && (
              <div className="fp-dato small">
                {tr("Sus naves en esos kills")}: <Naves items={data.sus_naves} ships={ships} />
              </div>
            )}
            <div className="fp-alcance">{tr("De tus killmails guardados — quien comparte killmail contigo estaba contigo.")}</div>
          </div>
        )}

        {data && data.ops_juntas > 0 && (
          <div className="fp-bloque">
            <div className="fp-titulo">🛰 {tr("En tus ops grabadas")}</div>
            <div className="fp-dato">
              <strong>{data.ops_juntas}</strong> {tr("ops")} ·{" "}
              {/* Horas con un decimal a partir de 60 min — redondear 45 min a «1 h» mentiría. */}
              <strong>{data.minutos_op >= 60 ? `${(data.minutos_op / 60).toFixed(1)} h` : `${data.minutos_op} min`}</strong>{" "}
              {tr("a bordo contigo")}
              {data.ultima_op && (
                <span className="muted"> · {tr("última")}: {data.ultima_op.slice(0, 10)}</span>
              )}
            </div>
            {data.naves_op.length > 0 && (
              <div className="fp-dato small">
                {tr("Con qué ha volado")}: <Naves items={data.naves_op} ships={ships} />
              </div>
            )}
            <div className="fp-alcance">{tr("Del grabador de flotas — solo las ops que grabaste.")}</div>
          </div>
        )}

        {data && data.msgs > 0 && (
          <div className="fp-bloque">
            <div className="fp-titulo">💬 {tr("Os habéis hablado")}</div>
            <div className="fp-dato">
              <strong>{data.msgs}</strong> {tr("mensajes en")}{" "}
              <strong>{data.convos}</strong> {tr("conversaciones")}
              {data.primer_msg_ts && data.ultimo_msg_ts && (
                <span className="muted">
                  {" "}
                  · {año(data.primer_msg_ts).slice(0, 4)} → {año(data.ultimo_msg_ts).slice(0, 4)}
                </span>
              )}
              {onIrA && (
                <>
                  {" "}
                  <button className="ops-link" onClick={() => onIrA("social")}>
                    {tr("Abrir Social")}
                  </button>
                </>
              )}
            </div>
            <div className="fp-alcance">{tr("De tus chatlogs — cuentan los dos lados de cada conversación.")}</div>
          </div>
        )}

        {data && data.avistamientos > 0 && (
          <div className="fp-bloque">
            <div className="fp-titulo">🚨 {tr("Cantado en el intel")}</div>
            <div className="fp-dato">
              <strong>{data.avistamientos}</strong> {tr("avistamientos")}
              {data.ultimo_avist_ms && (
                <span className="muted"> · {tr("último")}: {hace(data.ultimo_avist_ms)}</span>
              )}
              {data.sistema_favorito && (
                <>
                  {" "}
                  · {tr("donde más")}:{" "}
                  {onVerMapa ? (
                    <button className="ops-link" onClick={() => onVerMapa(data.sistema_favorito!)}>
                      {sysNames?.get(data.sistema_favorito) ?? `#${data.sistema_favorito}`}
                    </button>
                  ) : (
                    <span>{sysNames?.get(data.sistema_favorito) ?? `#${data.sistema_favorito}`}</span>
                  )}
                </>
              )}
            </div>
            <div className="fp-alcance">{tr("De los canales de intel que vigilas.")}</div>
          </div>
        )}

        {data && data.notas.length > 0 && (
          <div className="fp-bloque">
            <div className="fp-titulo">📌 {tr("Tus notas sobre este piloto")}</div>
            {data.notas.map((n, i) => (
              <div key={i} className="fp-nota">{n}</div>
            ))}
          </div>
        )}

        <div className="fp-pie muted small">
          {tr("Todo sale de TU histórico local — nada se pregunta a nadie.")}
        </div>
      </div>
    </div>
  );
}
