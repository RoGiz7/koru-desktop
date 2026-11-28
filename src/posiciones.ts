// ★ POSICIONES QUE SE QUEDAN VIEJAS SIN DECIRLO — la regla, pura y aparte para poder probarla.
//
// `poll_positions` corre cada 30 s. Cuando no podía confirmar dónde estaba un personaje, Koru seguía
// enseñando el último sistema bueno SIN LÍMITE y sin decirlo, y de ahí cuelgan los puntos del mapa,
// el minimapa y los saltos que mide el intel. No daba error: daba un número creíble.
//
// Lo decidido (brief `documentacion/brief-posiciones-viejas.md` y sus «Decisiones del paso 0»):
//  · El dato NO se quita: el intel sigue midiendo desde la última posición conocida. Se DICE.
//  · «Confirmado» = saber algo cierto: una respuesta buena de `/location/`, o `online == false` con
//    certeza. Lo pida el sondeo o el `refresh()` del arranque.
//  · Sin confirmar = personaje CON permiso de posición del que no se sabe nada cierto desde hace más
//    de `CORTE_POSICION_MS`. Sin permiso no cuenta: eso es «falta permiso», no un fallo.
//  · Dos clases: «vieja» (se sabe un sistema, pero de hace rato) y «sin posición» (ninguno).
//  · Quien nunca se ha confirmado cuenta desde que Koru tiene su tarjeta.
import type { CharacterCard, PositionUpdate } from "./types";

export const SCOPE_UBICACION = "esi-location.read_location.v1";
/** Tres sondeos de 30 s: el mismo corte que ya usa el recorrido (`CORTE_MS` en `poll_positions`).
 *  Aguanta un tirón de red sin avisar de más. */
export const CORTE_POSICION_MS = 90_000;

/** Lo que el frontend añade a una tarjeta para saber cuándo se supo algo cierto. Rust no lo manda. */
export type ConfirmacionPos = {
  /** Última vez que se confirmó su posición (ms). `null` = nunca desde que Koru tiene su tarjeta. */
  pos_confirmada_ms?: number | null;
  /** Desde cuándo tiene Koru su tarjeta (ms): el plazo de quien nunca se confirmó cuenta desde aquí. */
  tarjeta_desde_ms?: number;
  /** Por qué no se confirmó en el último sondeo, como literal del código (lo trae Rust). */
  pos_motivo?: string | null;
};
export type TarjetaPos = CharacterCard & ConfirmacionPos;

/** ★ `refresh()` (el `get_character_cards` del arranque, iniciar sesión, quitar un personaje).
 *  · Confirma a quien llega con sistema, o desconectado con certeza.
 *  · ⚠️ Si la tarjeta nueva llega SIN sistema y la anterior de ESE personaje lo tenía, se conserva
 *    la posición anterior (sistema, nombre y nave) y su hora: el dato no se quita, solo deja de
 *    estar confirmado. Antes se perdía hasta el siguiente sondeo y el personaje desaparecía del
 *    mapa y de los orígenes del intel sin decirlo.
 *  · Solo para quien sigue en la lista nueva: uno quitado o borrado desaparece, como siempre. */
export function fusionarRefresh(prev: Record<number, TarjetaPos>, nuevas: CharacterCard[], ahoraMs: number): Record<number, TarjetaPos> {
  const m: Record<number, TarjetaPos> = {};
  for (const c of nuevas) {
    const p = prev[c.character_id];
    const confirma = c.system_id != null || c.online === false;
    const desde = p?.tarjeta_desde_ms ?? ahoraMs;
    const motivo = confirma ? null : p?.pos_motivo ?? null;
    if (c.system_id == null && p?.system_id != null) {
      m[c.character_id] = {
        ...c,
        system_id: p.system_id,
        system_name: p.system_name,
        ship_type_id: p.ship_type_id,
        ship_type_name: p.ship_type_name,
        ship_name: p.ship_name,
        pos_confirmada_ms: confirma ? ahoraMs : p.pos_confirmada_ms ?? null,
        tarjeta_desde_ms: desde,
        pos_motivo: motivo,
      };
    } else {
      m[c.character_id] = {
        ...c,
        pos_confirmada_ms: confirma ? ahoraMs : p?.pos_confirmada_ms ?? null,
        tarjeta_desde_ms: desde,
        pos_motivo: motivo,
      };
    }
  }
  return m;
}

/** ★ Lo que trae un sondeo de `poll_positions`, sobre las tarjetas. Lo de siempre (el sistema nuevo
 *  si lo hay, y nunca el nombre del sistema viejo pegado a uno nuevo) más la confirmación.
 *  Si falla la llamada ENTERA no se llama a esto, y nadie queda confirmado en esa vuelta. */
export function aplicarSondeo(prev: Record<number, TarjetaPos>, ps: PositionUpdate[], ahoraMs: number): Record<number, TarjetaPos> {
  const next = { ...prev };
  for (const p of ps) {
    const card = next[p.character_id];
    if (!card) continue; // aún no cargado por `refresh()`: el sondeo no inventa tarjetas
    next[p.character_id] = {
      ...card,
      system_id: p.system_id ?? card.system_id,
      // Si el sistema CAMBIÓ y no pudimos resolver su nombre, se queda vacío — nunca se hereda el
      // anterior. Etiquetar el sistema nuevo con el nombre del viejo sería un dato falso con toda
      // la pinta de bueno; un hueco, al menos, se ve.
      system_name: p.system_id != null && p.system_id !== card.system_id ? p.system_name : card.system_name,
      ship_type_id: p.ship_type_id ?? card.ship_type_id,
      ship_type_name: p.ship_type_name ?? card.ship_type_name,
      online: p.online,
      pos_confirmada_ms: p.confirmado ? ahoraMs : card.pos_confirmada_ms ?? null,
      pos_motivo: p.confirmado ? null : p.motivo ?? card.pos_motivo ?? null,
    };
  }
  return next;
}

export type SinConfirmar = {
  id: number;
  name: string;
  /** `vieja`: se sabe un sistema, pero de hace rato · `sin_posicion`: no se sabe ninguno. */
  clase: "vieja" | "sin_posicion";
  /** Desde cuándo no se sabe nada cierto: la última confirmación, o la llegada de su tarjeta. */
  desdeMs: number;
  motivo: string | null;
};

/** ★ Quién está sin confirmar AHORA, desde cuándo y por qué. Por id, para que el orden no baile. */
export function sinConfirmar(cards: TarjetaPos[], ahoraMs: number): SinConfirmar[] {
  const out: SinConfirmar[] = [];
  for (const c of cards) {
    if (!c.scopes.includes(SCOPE_UBICACION)) continue;
    const ref = c.pos_confirmada_ms ?? c.tarjeta_desde_ms ?? ahoraMs;
    if (ahoraMs - ref <= CORTE_POSICION_MS) continue;
    out.push({ id: c.character_id, name: c.name, clase: c.system_id != null ? "vieja" : "sin_posicion", desdeMs: ref, motivo: c.pos_motivo ?? null });
  }
  return out.sort((a, b) => a.id - b.id);
}
