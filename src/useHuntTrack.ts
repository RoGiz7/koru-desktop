// Rastro histórico persistente de un piloto (modo cazador): consulta la tabla intel_sightings
// vía backend y expone el rastro para pintarlo en el mapa. Sub-feature autónomo (no toca la
// selección ni el sonido del intel) → hook propio, mismo patrón que useJumpPlanner/useRoutePlanner.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useHuntTrack(openTrack?: { name: string; nonce: number } | null) {
  const [huntPilot, setHuntPilot] = useState<string | null>(null);
  const [huntTrack, setHuntTrack] = useState<{ system_id: number; ts_ms: number }[] | null>(null);

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

  return { huntPilot, huntTrack, loadHuntTrack, clearHuntTrack };
}
