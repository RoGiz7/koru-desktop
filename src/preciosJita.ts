// Precio de VENTA en Jita para valorar botín, con un reintento y diciendo qué faltó.
//
// ★ POR QUÉ EXISTE (2026-10-24): un tester cerró una escalación y el botín se guardó con TODAS las
//   líneas en «—». La consulta falló justo entonces y nadie lo supo: el modal hacía `.catch(() => {})`.
//   Y hay una trampa más: `get_hub_buy_prices` casi nunca devuelve error — si ESI falla, Rust cae a
//   la media de mercado y, si tampoco la tiene, simplemente NO incluye ese tipo en el mapa. Así que
//   «falló» no se ve como excepción: se ve como **tipos pedidos que no vuelven**. Eso es lo que se
//   mira aquí, y lo que se reintenta.
import { invoke } from "@tauri-apps/api/core";

export type PreciosJita = {
  /** typeID → precio UNITARIO (mejor compra en Jita, o la media si no hay órdenes). */
  precios: Record<number, number>;
  /** Tipos pedidos que no han vuelto con precio, tras el reintento. */
  faltan: number[];
  /** La consulta entera falló (excepción), no solo algunos tipos. */
  error: string | null;
};

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pedir(ids: number[]): Promise<Record<number, number>> {
  return invoke<Record<number, number>>("get_hub_buy_prices", { ids, regionId: null });
}

/** Pide los precios; lo que no vuelva se pide UNA vez más tras una pausa corta (un corte de ESI de
 *  un momento no debería dejar un botín sin valorar). */
export async function preciosJita(ids: number[]): Promise<PreciosJita> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return { precios: {}, faltan: [], error: null };
  let precios: Record<number, number> = {};
  let error: string | null = null;
  try {
    precios = await pedir(unicos);
  } catch (e) {
    error = String(e);
  }
  let faltan = unicos.filter((t) => !precios[t]);
  if (faltan.length > 0) {
    await espera(1500);
    try {
      const otra = await pedir(faltan);
      precios = { ...precios, ...otra };
      error = null;
    } catch (e) {
      error = error ?? String(e);
    }
    faltan = unicos.filter((t) => !precios[t]);
  }
  return { precios, faltan, error };
}
