// Rastro histórico persistente de un piloto (modo cazador): consulta la tabla intel_sightings
// vía backend y expone el rastro para pintarlo en el mapa. Sub-feature autónomo (no toca la
// selección ni el sonido del intel) → hook propio, mismo patrón que useJumpPlanner/useRoutePlanner.
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * @param refreshSignal  Un número que cambia cuando llega intel nuevo (p.ej. el nº de líneas). Al
 *   cambiar, se vuelve a consultar el rastro del piloto activo SIN togglearlo. Esto es lo que hace
 *   que la interceptación sea viva: si el perseguido salta de sistema y lo cantan, su último
 *   avistamiento se actualiza y la ruta se re-traza sola.
 */
export function useHuntTrack(
  openTrack?: { name: string; nonce: number } | null,
  refreshSignal?: number
) {
  const [huntPilot, setHuntPilot] = useState<string | null>(null);
  const [huntTrack, setHuntTrack] = useState<{ system_id: number; ts_ms: number }[] | null>(null);
  // Espejo del piloto activo para poder refrescar sin meter huntPilot en las deps del efecto de
  // refresco (si no, cada follow dispararía una consulta doble).
  const pilotRef = useRef<string | null>(null);
  useEffect(() => {
    pilotRef.current = huntPilot;
  }, [huntPilot]);

  // Activa el rastro de un piloto (sin toggle). Usado por el botón del mapa y el puente desde Cazador.
  async function activateHuntTrack(name: string) {
    setHuntPilot(name);
    setHuntTrack(null);
    try {
      const pts = await invoke<{ system_id: number; ts_ms: number }[]>("get_pilot_track", {
        name,
        limit: 200,
      });
      setHuntTrack(pts);
    } catch {
      setHuntTrack([]);
    }
  }
  function loadHuntTrack(name: string) {
    if (huntPilot === name) {
      // Toggle: si ya está activo, lo apagamos.
      setHuntPilot(null);
      setHuntTrack(null);
      return;
    }
    void activateHuntTrack(name);
  }
  // Quita el rastro activo (botón ✕).
  function clearHuntTrack() {
    setHuntPilot(null);
    setHuntTrack(null);
  }
  // Puente desde la sección Cazador: cuando cambia la petición, activar ese rastro en el mapa.
  useEffect(() => {
    if (openTrack?.name) void activateHuntTrack(openTrack.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTrack?.nonce]);

  // Refresco por intel nuevo: re-consulta el rastro del piloto que ya estás siguiendo.
  useEffect(() => {
    if (refreshSignal && pilotRef.current) void activateHuntTrack(pilotRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  return { huntPilot, huntTrack, loadHuntTrack, clearHuntTrack };
}
