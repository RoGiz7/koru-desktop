// Rastro histórico persistente de VARIOS pilotos (modo cazador): consulta la tabla intel_sightings
// vía backend y expone sus rastros para pintarlos en el mapa. Sub-feature autónomo (no toca la
// selección ni el sonido del intel) → hook propio, mismo patrón que useJumpPlanner/useRoutePlanner.
//
// MULTI-PILOTO a propósito: en una caza real vigilas a varios a la vez (el tackle, el logi, el que
// va con la nave gorda). Sus avistamientos se destacan en el mapa frente a las demás alertas, así
// que la lista tiene que admitir más de uno. La INTERCEPCIÓN, en cambio, sigue apuntando a UNO —
// solo puedes volar hacia un sitio— y de eso se encarga el mapa, no este hook.
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export type HuntPoint = { system_id: number; ts_ms: number };

/**
 * @param refreshSignal Un número que cambia cuando llega intel nuevo (p.ej. el nº de líneas). Al
 *   cambiar se re-consultan los rastros de TODOS los seguidos sin togglear a ninguno. Esto es lo que
 *   hace viva la interceptación: si el perseguido salta de sistema y lo cantan, su último
 *   avistamiento se actualiza y la ruta se re-traza sola.
 */
export function useHuntTrack(
  openTrack?: { name: string; nonce: number } | null,
  refreshSignal?: number
) {
  const [huntPilots, setHuntPilots] = useState<string[]>([]);
  // nombre → rastro. `undefined` para un seguido = todavía cargando.
  const [huntTracks, setHuntTracks] = useState<Map<string, HuntPoint[]>>(new Map());
  // Espejo de la lista para el efecto de refresco: si metiéramos `huntPilots` en sus deps, cada
  // follow dispararía una consulta doble.
  const pilotsRef = useRef<string[]>([]);
  useEffect(() => {
    pilotsRef.current = huntPilots;
  }, [huntPilots]);

  async function fetchTrack(name: string) {
    try {
      const pts = await invoke<HuntPoint[]>("get_pilot_track", { name, limit: 200 });
      setHuntTracks((prev) => new Map(prev).set(name, pts));
    } catch {
      setHuntTracks((prev) => new Map(prev).set(name, []));
    }
  }

  /** Añade un piloto al seguimiento (sin toggle). Usado por el puente desde la sección Cazador. */
  async function activateHuntTrack(name: string) {
    setHuntPilots((prev) => (prev.includes(name) ? prev : [...prev, name]));
    await fetchTrack(name);
  }

  /** Toggle: si ya lo sigues, lo sueltas; si no, lo añades. */
  function loadHuntTrack(name: string) {
    if (pilotsRef.current.includes(name)) {
      setHuntPilots((prev) => prev.filter((p) => p !== name));
      setHuntTracks((prev) => {
        const m = new Map(prev);
        m.delete(name);
        return m;
      });
      return;
    }
    void activateHuntTrack(name);
  }

  /** Suelta a uno concreto. */
  function dropHuntPilot(name: string) {
    setHuntPilots((prev) => prev.filter((p) => p !== name));
    setHuntTracks((prev) => {
      const m = new Map(prev);
      m.delete(name);
      return m;
    });
  }

  /** Suelta a todos. */
  function clearHuntTrack() {
    setHuntPilots([]);
    setHuntTracks(new Map());
  }

  // Puente desde la sección Cazador: cuando cambia la petición, añadir ese rastro al mapa.
  useEffect(() => {
    if (openTrack?.name) void activateHuntTrack(openTrack.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTrack?.nonce]);

  // Refresco por intel nuevo: re-consulta el rastro de todos los seguidos.
  useEffect(() => {
    if (!refreshSignal) return;
    for (const name of pilotsRef.current) void fetchTrack(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  return { huntPilots, huntTracks, loadHuntTrack, dropHuntPilot, clearHuntTrack };
}
