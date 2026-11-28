// Estado y lógica del planificador de saltos de capital (jump drive), encapsulado en un hook
// reutilizable: naves/skills del SDE, personaje, fatiga y rango efectivo. NO depende de `geo`
// (así puede llamarse arriba del componente); los cálculos que sí lo necesitan (fuel, alcance,
// fatiga estimada) se quedan en MapView llamando a jumpCalc con `selShip`/`curFatMin` de aquí.
// Primer paso hacia una arquitectura por-feature: mañana esto se promociona a context sin tocar
// los sitios de uso (MapView desestructura el resultado con los mismos nombres de siempre).
import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { JumpShip } from "./types";
import { esFaltaPermiso } from "./errores";
import { loadJson } from "./staticJson";

export function useJumpPlanner() {
  const [jumpActive, setJumpActive] = useState(false);
  const [jumpOrigin, setJumpOrigin] = useState<number | null>(null);
  const [jumpDest, setJumpDest] = useState<number | null>(null);
  const [jumpRange, setJumpRange] = useState(5);
  // Naves de salto (del SDE: rango base, fuel/LY, isótopo) + skills del piloto.
  const [jumpShips, setJumpShips] = useState<JumpShip[]>([]);
  const [jumpShip, setJumpShip] = useState<string>(""); // nombre de la nave elegida
  const [jdcLevel, setJdcLevel] = useState(5); // Jump Drive Calibration → +20% rango/nivel (×2 a V)
  const [jfcLevel, setJfcLevel] = useState(5); // Jump Fuel Conservation → −10% fuel/nivel
  const [jumpChar, setJumpChar] = useState<number | null>(null); // pj del que cargar skills/naves
  const [jumpOwned, setJumpOwned] = useState<Set<number>>(new Set()); // type_ids de naves propias
  const [jumpFatigue, setJumpFatigue] = useState<{ expire: string | null } | null>(null);
  const [jumpFatMissing, setJumpFatMissing] = useState(false); // falta el scope de fatiga
  // Cualquier OTRO fallo al leer la fatiga (ESI 502, red…). Antes caía en `jumpFatMissing` y la
  // pantalla mandaba a reloguear ante un 502.
  const [jumpFatError, setJumpFatError] = useState("");
  const [fatNow, setFatNow] = useState(Date.now()); // tick para el contador de fatiga

  // Catálogo de naves de salto (rango/fuel/isótopo) extraído del SDE.
  useEffect(() => {
    loadJson<{ ships?: JumpShip[] }>("/jumpships.json", {}).then((d) => setJumpShips(d.ships || []));
  }, []);

  // Al elegir personaje: cargar sus niveles JDC/JFC, naves que posee y la fatiga actual.
  useEffect(() => {
    if (jumpChar == null) {
      setJumpOwned(new Set());
      setJumpFatigue(null);
      setJumpFatMissing(false);
      setJumpFatError("");
      return;
    }
    invoke<{ jdc: number | null; jfc: number | null; owned: number[] | null }>("get_jump_profile", {
      characterId: jumpChar,
    })
      .then((p) => {
        // ⚠️ El planificador de salto del mapa se queda EXACTAMENTE como estaba (sin datos = 0 y
        //    lo ajustas a mano): desde el 28-11 `get_jump_profile` dice «no se sabe» con `null`, y
        //    aquí se traduce a lo de antes a propósito. Que lo diga es trabajo pendiente, no de hoy.
        setJdcLevel(p.jdc ?? 0);
        setJfcLevel(p.jfc ?? 0);
        setJumpOwned(new Set(p.owned ?? []));
      })
      .catch(() => setJumpOwned(new Set()));
    invoke<{ jump_fatigue_expire_date: string | null }>("get_fatigue", { characterId: jumpChar })
      .then((f) => {
        setJumpFatigue({ expire: f.jump_fatigue_expire_date });
        setJumpFatMissing(false);
        setJumpFatError("");
      })
      .catch((e) => {
        setJumpFatigue(null);
        // «Falta el acceso» SOLO cuando falta el acceso: lo dice `AppError::FaltaScope`.
        const falta = esFaltaPermiso(e);
        setJumpFatMissing(falta);
        setJumpFatError(falta ? "" : String(e));
      });
  }, [jumpChar]);

  // Contador de fatiga: refresca cada 30 s mientras el modo salto está activo.
  useEffect(() => {
    if (!jumpActive) return;
    const id = window.setInterval(() => setFatNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [jumpActive]);

  // Nave seleccionada (del catálogo del SDE).
  const selShip = useMemo(
    () => jumpShips.find((s) => s.name === jumpShip) || null,
    [jumpShips, jumpShip]
  );

  // Rango efectivo = base × (1 + 20%·Jump Drive Calibration). A nivel V se dobla (SDE: attr 870
  // jumpDriveRangeBonus = 20/nivel). Autorrellena la burbuja LY.
  useEffect(() => {
    if (selShip) setJumpRange(+(selShip.range * (1 + 0.2 * jdcLevel)).toFixed(2));
  }, [selShip, jdcLevel]);

  // Fatiga actual del personaje (minutos restantes del timer azul).
  const curFatMin = useMemo(() => {
    if (!jumpFatigue?.expire) return 0;
    const ms = Date.parse(jumpFatigue.expire) - fatNow;
    return ms > 0 ? ms / 60000 : 0;
  }, [jumpFatigue, fatNow]);

  return {
    jumpActive,
    setJumpActive,
    jumpOrigin,
    setJumpOrigin,
    jumpDest,
    setJumpDest,
    jumpRange,
    setJumpRange,
    jumpShips,
    jumpShip,
    setJumpShip,
    jdcLevel,
    setJdcLevel,
    jfcLevel,
    setJfcLevel,
    jumpChar,
    setJumpChar,
    jumpOwned,
    jumpFatMissing,
    jumpFatError,
    selShip,
    curFatMin,
  };
}
