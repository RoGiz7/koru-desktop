// ★ VIGÍA DE CAMPAÑAS MILITARES (2026-09-22).
//
// Campañas ya enseña el estado vivo de ESI, pero solo mientras la pestaña está abierta. Cradle of
// War acaba de meter 12 objetivos nuevos y «El bendito intercambio» iba 28/30 el día del parche:
// lo que un piloto quiere saber es «se completó» o «hay una nueva» SIN tener Koru delante. Esto
// vigila desde App.tsx con el mismo camino que ya usan los proyectos personales (notificación
// nativa desde el front + sonido): cero Rust, y la petición ya está cacheada en `get_cached`
// (respeta el Expires de ESI, así que sondear cada media hora no cuesta nada de más).
//
// Lo que se recuerda es el ÚLTIMO ESTADO por UUID en localStorage. La primera vez que se ve una
// campaña NO se avisa: se siembra en silencio, como hace la Bitácora con un medallero virgen —
// si no, instalar Koru te daría «cuatro campañas nuevas» que llevan meses ahí.
//
// ⚠️ Los títulos salen del JSON del SDE (`military_campaigns.json`). Una campaña puede existir
// en ESI antes que en el SDE: entonces se avisa igual, pero sin nombre. Se dice, no se esconde.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { tr, getLang } from "./i18n";
import { loadJson } from "./staticJson";
import { ensureNotifPerm, playUnlock } from "./sound";
import type { MilitaryCampaign } from "./types";

const CLAVE = "koru-campanas-estado";
const CADA_MS = 30 * 60_000;

type Defs = { camps: Record<string, { t: { es: string; en: string } }> };

function leer(): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, string>) : null;
  } catch {
    return null;
  }
}
function guardar(m: Record<string, string>) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(m));
  } catch {
    /* sin almacén: se sembrará otra vez la próxima; nunca avisa dos veces en la misma sesión */
  }
}

/** Compara el estado nuevo con el recordado. Devuelve los avisos a dar (vacío si es la siembra). */
export function cambiosCampanas(
  previo: Record<string, string> | null,
  ahora: MilitaryCampaign[],
): { id: string; tipo: "nueva" | "estado"; estado: string }[] {
  if (!previo) return [];
  const out: { id: string; tipo: "nueva" | "estado"; estado: string }[] = [];
  for (const c of ahora) {
    const antes = previo[c.id];
    if (antes === undefined) out.push({ id: c.id, tipo: "nueva", estado: c.state });
    else if (antes !== c.state) out.push({ id: c.id, tipo: "estado", estado: c.state });
  }
  return out;
}

function estadoTexto(state: string): string {
  switch (state) {
    case "Active":
      return tr("activa");
    case "Completed":
      return tr("completada");
    case "Failed":
      return tr("fallida");
    case "Expired":
      return tr("expirada");
    default:
      return state;
  }
}

export function useVigiaCampanas() {
  useEffect(() => {
    let vivo = true;
    // Una sola vez por sesión y por campaña: si el guardado falla, no repetimos el aviso en bucle.
    const avisadas = new Set<string>();
    const vuelta = async () => {
      let camps: MilitaryCampaign[];
      try {
        camps = await invoke<MilitaryCampaign[]>("get_military_campaigns");
      } catch {
        return; // sin red o ESI caído: se prueba en la siguiente vuelta, sin ruido
      }
      if (!vivo || camps.length === 0) return;
      const previo = leer();
      const ahora: Record<string, string> = {};
      for (const c of camps) ahora[c.id] = c.state;
      const cambios = cambiosCampanas(previo, camps).filter((c) => !avisadas.has(`${c.id}:${c.estado}`));
      guardar({ ...(previo ?? {}), ...ahora });
      if (cambios.length === 0) return;
      const defs = await loadJson<Defs | null>("/military_campaigns.json", null).catch(() => null);
      const es = getLang() === "es";
      const nombre = (id: string) => {
        const d = defs?.camps[id]?.t;
        return d ? (es ? d.es : d.en) : tr("una campaña sin definición en el SDE todavía");
      };
      for (const c of cambios) {
        avisadas.add(`${c.id}:${c.estado}`);
        const titulo =
          c.tipo === "nueva"
            ? `🏛️ ${tr("Campaña militar nueva")}`
            : c.estado === "Completed"
              ? `🏛️ ${tr("Campaña militar completada")}`
              : `🏛️ ${tr("Campaña militar")}: ${estadoTexto(c.estado)}`;
        const cuerpo =
          c.tipo === "nueva"
            ? `${nombre(c.id)} · ${tr("mírala en Bitácora → Campañas")}`
            : `${nombre(c.id)} · ${tr("ahora")} ${estadoTexto(c.estado)}`;
        if (await ensureNotifPerm()) {
          try {
            sendNotification({ title: titulo, body: cuerpo });
          } catch {
            /* sin permiso o plugin no disponible: el sonido sigue */
          }
        }
      }
      playUnlock();
    };
    void vuelta();
    const id = window.setInterval(() => void vuelta(), CADA_MS);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, []);
}
