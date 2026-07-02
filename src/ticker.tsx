// Ticker "de bolsa" del dock: datos vivos con deltas (▲/▼), estilo teletipo financiero.
// TODO sale de la BD local (comando get_ticker, cero ESI) + estado ya en memoria
// (stats del sujeto, estado de Tranquility). La animación es CSS puro por transform
// (composición en GPU, coste ~nulo), se pausa al pasar el ratón y respeta
// prefers-reduced-motion (queda estática con scroll manual).
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk, fmtSp } from "./format";
import type { PvpStats, ServerStatus, TickerData } from "./types";

/** Flecha de variación estilo bolsa: verde sube, rojo baja. `pct` = mostrar en %. */
function Delta({ cur, prev, pct = false }: { cur: number; prev: number; pct?: boolean }) {
  const d = cur - prev;
  if (d === 0) return null;
  const up = d > 0;
  const txt =
    pct && prev !== 0 ? `${((Math.abs(d) / Math.abs(prev)) * 100).toFixed(1)}%` : fmtSp(Math.abs(d));
  return (
    <span className={up ? "tk-up" : "tk-down"}>
      {up ? "▲" : "▼"} {txt}
    </span>
  );
}

type Item = { icon: string; label: string; value: string; extra?: ReactNode };

export function Ticker({
  subject,
  stats,
  server,
  refreshKey,
}: {
  subject: number | "global";
  stats: PvpStats | null;
  server: ServerStatus | null;
  /** Cambia tras cada auto-sync → recarga los datos del ticker. */
  refreshKey: number;
}) {
  const [data, setData] = useState<TickerData | null>(null);
  useEffect(() => {
    let alive = true;
    invoke<TickerData>("get_ticker", { characterId: subject === "global" ? null : subject })
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [subject, refreshKey]);

  const items: Item[] = [];
  if (stats) {
    items.push({
      icon: "⚔️",
      label: "Kills",
      value: fmtSp(stats.kills),
      extra: data ? <Delta cur={data.kills_week} prev={data.kills_prev_week} /> : null,
    });
    items.push({ icon: "☠️", label: "Losses", value: fmtSp(stats.losses) });
    items.push({
      icon: "🎯",
      label: tr("Eficacia"),
      value: `${stats.efficiency.toFixed(1)}%`,
    });
    items.push({ icon: "💥", label: tr("ISK destruido"), value: fmtIsk(stats.isk_destroyed) });
    items.push({ icon: "🕳️", label: tr("ISK perdido"), value: fmtIsk(stats.isk_lost) });
  }
  if (data) {
    if (data.kills_week > 0)
      items.push({
        icon: "📅",
        label: tr("Esta semana"),
        value: `${fmtSp(data.kills_week)} kills · ${fmtIsk(data.isk_destroyed_week)}`,
      });
    if (data.networth != null)
      items.push({
        icon: "💰",
        label: tr("Patrimonio"),
        value: fmtIsk(data.networth),
        extra:
          data.networth_prev != null ? (
            <Delta cur={data.networth} prev={data.networth_prev} pct />
          ) : null,
      });
    if (data.month_net != null)
      items.push({
        icon: "📊",
        label: tr("Balance del mes"),
        value: fmtIsk(data.month_net),
        extra:
          data.prev_month_net != null ? (
            <Delta cur={data.month_net} prev={data.prev_month_net} pct />
          ) : null,
      });
    if (data.plex_price != null)
      items.push({ icon: "💎", label: "PLEX", value: fmtIsk(data.plex_price) });
  }
  if (server)
    items.push({
      icon: "🛰️",
      label: "Tranquility",
      value: `${fmtSp(server.players)} ${tr("pilotos")}`,
    });

  if (items.length === 0) return null;
  // Duración proporcional al contenido para que la velocidad sea constante.
  const dur = Math.max(28, items.length * 7);

  const group = (k: string) => (
    <div className="ticker-group" aria-hidden={k === "b"} key={k}>
      {items.map((it, i) => (
        <span className="ticker-item" key={`${k}${i}`}>
          <span className="tk-icon">{it.icon}</span>
          <span className="tk-label">{it.label}</span>
          <span className="tk-value">{it.value}</span>
          {it.extra}
          <span className="tk-sep">·</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="ticker" title={tr("Datos de tu histórico local · pasa el ratón para pausar")}>
      <div className="ticker-track" style={{ "--ticker-dur": `${dur}s` } as CSSProperties}>
        {group("a")}
        {group("b")}
      </div>
    </div>
  );
}
