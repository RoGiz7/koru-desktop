/** La VENTANA del minimapa: una caja cuadrada, sin bordes, siempre encima y arrastrable, que
 *  dibuja TU REGIÓN y lo que está cantando el intel dentro de ella.
 *
 *  La geometría NO está aquí: está en `minimapa.ts`, un módulo puro verificado contra el catálogo
 *  de verdad (`scripts/verificar_minimapa.mjs`). Aquí solo hay fontanería y pintura, que es justo
 *  lo que no se puede verificar en node. Si algo coloca mal, mira allí primero.
 *
 * ★ DE DÓNDE SALEN LOS DATOS. Tres fuentes y ni una más, porque cada canal es algo que se puede
 *   desincronizar:
 *
 *   - Los AVISOS, del evento `intel-alert` que YA emite el hilo de Rust. En Tauri v2 un
 *     `app.emit` llega a TODAS las ventanas, así que esta los oye igual que el overlay. Trae
 *     `sys_id`, `ts_ms`, `jumps` y su referencia — todo lo que hace falta, ya calculado.
 *   - Las ANCLAS, de `koru-intel-anchors` en localStorage. Son del intel, no del minimapa.
 *   - Los PILOTOS, que App publica en `koru-pilotos` con la regla del intel (encendidos y
 *     conectados). Es lo único que no estaba ya en algún sitio.
 *
 * ★★ ESTA VENTANA NO TIENE EL ESTADO DE APP, y no es un detalle menor: todo lo que necesita viaja
 *    por eventos o por localStorage, y hay que VOLVER A LEERLO cuando cambia. Nada de suponer que
 *    un ajuste leído al montar sigue siendo el de ahora.
 *
 * ★★★ EN REPOSO TIENE QUE PODER IGNORARSE. Sin avisos se queda como un fantasma; en cuanto salta
 *     uno, recupera el cuerpo. Un recuadro que grita cuando no pasa nada se acaba tapando, y
 *     entonces tampoco está el día que hace falta.
 */
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadNewEden } from "./neweden";
import { planoRegion, proyectar, type RefMini, type SistemaMini } from "./minimapa";
import "./minimapa.css";

/** Un aviso tal y como llega. La edad se calcula al pintar, no al recibir — así envejece aunque
 *  no llegue ninguno nuevo. `desde` y `saltos` son los de Rust, con su misma prioridad: el ancla
 *  más cercana si hay anclas, y si no, el piloto más cercano. No se recalculan aquí NUNCA. */
type Marca = { sys: number; ts: number; desde: number | null; saltos: number | null };
type Piloto = { sys: number; nombre: string };

/** La ventana de vida la pone el INTEL: la misma que decide qué es «reciente» en el mapa, en
 *  minutos. Decisión deliberada: el minimapa no tiene la suya. Un ajuste menos que explicar y,
 *  sobre todo, uno menos que puede contradecir al mapa grande. */
function ventanaMs(): number {
  const m = Number(localStorage.getItem("koru-intel-recency") ?? 30);
  return Number.isFinite(m) && m > 0 ? m * 60_000 : 30 * 60_000;
}
function conFondo(): boolean {
  return localStorage.getItem("koru-minimapa-fondo") !== "0";
}
function leerJSON<T>(clave: string, porDefecto: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(clave) || "null");
    return v ?? porDefecto;
  } catch {
    return porDefecto;
  }
}

/** Rampa de color por edad: recién cantado QUEMA, viejo se apaga hacia el gris del fondo. El
 *  color es la única forma de poner «hace cuánto» en un punto de cinco píxeles. */
function colorEdad(edad: number): string {
  const a = [255, 77, 61];
  const b = [110, 125, 145];
  const t = Math.min(1, Math.max(0, edad));
  const c = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}
/** `rgb(1, 2, 3)` → `rgba(1, 2, 3, a)`, para reusar el color de la edad con transparencia. */
function conAlfa(col: string, a: number): string {
  return col.replace("rgb(", "rgba(").replace(")", `, ${a})`);
}

/** Rectángulo redondeado a mano. `ctx.roundRect` existe en los WebView modernos, pero esta es la
 *  ventana que menos ganas tengo de depurar en la máquina de otro: diez líneas evitan el «en mi
 *  Linux no se ve el fondo». */
function marco(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** EL FONDO, CEÑIDO A LO QUE HAYA DENTRO y no a la ventana entera: con el mapa apagado y dos
 *  frentes en línea, lo demás sería cristal oscuro tapando juego para nada. Se sigue arrastrando
 *  desde cualquier punto, porque el lienzo ocupa la ventana aunque no pinte nada ahí. */
function panel(
  g: CanvasRenderingContext2D,
  caja: { x1: number; y1: number; x2: number; y2: number },
  lado: number,
  reposo: boolean,
) {
  const p = 11;
  const ax = Math.max(0.5, caja.x1 - p);
  const ay = Math.max(0.5, caja.y1 - p);
  const bx = Math.min(lado - 0.5, caja.x2 + p);
  const by = Math.min(lado - 0.5, caja.y2 + p);
  marco(g, ax, ay, Math.max(1, bx - ax), Math.max(1, by - ay), 10);
  g.fillStyle = reposo ? "rgba(10, 14, 20, 0.26)" : "rgba(10, 14, 20, 0.62)";
  g.fill();
  g.strokeStyle = reposo ? "rgba(255, 255, 255, 0.045)" : "rgba(255, 255, 255, 0.10)";
  g.lineWidth = 1;
  g.stroke();
}

/** Texto con reborde oscuro. Encima del juego el fondo es cualquier cosa: sin el reborde, un
 *  nombre sobre una nebulosa clara desaparece. */
function etiqueta(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string) {
  g.lineWidth = 3;
  g.strokeStyle = "rgba(0, 0, 0, 0.75)";
  g.strokeText(s, x, y);
  g.fillStyle = color;
  g.fillText(s, x, y);
}

/** Un aviso de texto centrado, con su fondo a medida. Para los estados en los que no hay nada que
 *  dibujar. Decirlo siempre es mejor que quedarse en blanco, que en una ventana transparente se
 *  lee como «esto no funciona». */
function mensaje(
  g: CanvasRenderingContext2D,
  lado: number,
  lineas: { texto: string; font: string; color: string }[],
) {
  let an = 0;
  for (const l of lineas) {
    g.font = l.font;
    an = Math.max(an, g.measureText(l.texto).width);
  }
  const alto = lineas.length * 15;
  const c = lado / 2;
  panel(g, { x1: c - an / 2, y1: c - alto / 2, x2: c + an / 2, y2: c + alto / 2 }, lado, true);
  let y = c - alto / 2 + 7.5;
  for (const l of lineas) {
    g.font = l.font;
    etiqueta(g, l.texto, c, y, l.color);
    y += 15;
  }
}

export function MinimapaVentana() {
  const lienzo = useRef<HTMLCanvasElement | null>(null);
  const [mapa, setMapa] = useState<{
    sistemas: Map<number, SistemaMini>;
    ady: Map<number, number[]>;
  } | null>(null);
  const [pilotos, setPilotos] = useState<Piloto[]>(() => leerJSON<Piloto[]>("koru-pilotos", []));
  const marcas = useRef<Marca[]>([]);
  const [tic, setTic] = useState(0);
  const repinta = () => setTic((t) => t + 1);

  /** 1 = el marco entero (el tope: no se puede alejar más). Hasta 4x acercando. */
  const [zoom, setZoom] = useState(() => {
    const v = Number(localStorage.getItem("koru-minimapa-zoom"));
    return Number.isFinite(v) && v >= 1 && v <= 4 ? v : 1;
  });
  /** En píxeles. En un ref y no en estado: cambia en cada `mousemove` y no hace falta un render
   *  de React por cada uno — el repintado se pide a mano. */
  const pan = useRef({ x: 0, y: 0 });
  const tirando = useRef<{ x0: number; y0: number; px0: number; py0: number } | null>(null);

  // EL MAPA, una vez. `loadNewEden` ya cachea: si la ventana principal lo pidió antes, esto no
  // vuelve a bajar nada.
  useEffect(() => {
    let vivo = true;
    loadNewEden().then(
      (ne) => {
        if (!vivo) return;
        const sistemas = new Map<number, SistemaMini>();
        for (const s of ne.systems) sistemas.set(s.id, { x: s.x, y: s.y, n: s.n, s: s.s, r: s.r });
        const ady = new Map<number, number[]>();
        for (const par of ne.jumps) {
          const [a, b] = par;
          let la = ady.get(a);
          if (!la) { la = []; ady.set(a, la); }
          let lb = ady.get(b);
          if (!lb) { lb = []; ady.set(b, lb); }
          la.push(b);
          lb.push(a);
        }
        setMapa({ sistemas, ady });
      },
      // Sin `.catch(() => {})`: si el mapa no carga quiero verlo en consola, no una ventana en
      // blanco sin explicación.
      (e) => console.error("[minimapa] no se pudo cargar neweden.json:", e),
    );
    return () => {
      vivo = false;
    };
  }, []);

  // LOS AVISOS: el MISMO evento que escucha el overlay, emitido por Rust.
  useEffect(() => {
    const un = listen<{
      sys_id: number;
      ts_ms: number;
      /** Tus pilotos ordenados por cercanía AL SISTEMA DEL AVISO. Solo mandan si NO hay anclas. */
      pilots?: { system_id: number; jumps: number }[];
      /** El ancla más cercana. Si hay anclas puestas, ES ESTO lo que mide el panel de intel. */
      anchor?: { name: string; system_id: number; jumps: number } | null;
    }>("intel-alert", (e) => {
      const { sys_id, ts_ms, pilots, anchor } = e.payload;
      // Clave estable sistema+ts, igual que en el overlay: es la que usa Rust para no repetir
      // avisos, así que si por lo que sea llega dos veces, aquí tampoco se duplica.
      if (marcas.current.some((m) => m.sys === sys_id && m.ts === ts_ms)) return;
      // El ancla manda sobre el piloto, igual que en Rust (`if cfg.anchors.is_empty()`).
      const ref = anchor ?? (pilots && pilots.length ? pilots[0] : null);
      marcas.current = [
        ...marcas.current,
        { sys: sys_id, ts: ts_ms, desde: ref?.system_id ?? null, saltos: ref?.jumps ?? null },
      ];
      repinta();
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // LOS PILOTOS, que publica App con la regla del intel.
  useEffect(() => {
    const un = listen<Piloto[]>("koru-pilotos", (e) => setPilotos(e.payload ?? []));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // LATIDO. Se reprograma solo y el periodo depende de si hay algo que envejecer: con avisos, un
  // segundo (el color cambia); en reposo, cinco. Un `setInterval` de 1 s eterno para dibujar
  // siempre lo mismo es gasto en una ventana que está abierta toda la sesión.
  useEffect(() => {
    const periodo = marcas.current.length ? 1000 : 5000;
    const id = window.setTimeout(repinta, periodo);
    return () => window.clearTimeout(id);
  }, [tic]);

  // LA RUEDA ACERCA, como en el mapa grande. `passive: false` y `preventDefault` porque si no, la
  // rueda hace scroll de la ventana — y una ventana sin bordes con el contenido desplazado no hay
  // forma de arreglarla a ojo.
  useEffect(() => {
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      setZoom((z) => {
        const n = Math.min(4, Math.max(1, z * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
        localStorage.setItem("koru-minimapa-zoom", String(n));
        // Al volver al tope, el desplazamiento deja de tener sentido: se borra para no dejarlo
        // guardado y que reaparezca torcido al acercar otra vez.
        if (n === 1) pan.current = { x: 0, y: 0 };
        return n;
      });
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // ★★ EL GESTO DEL RATÓN DEPENDE DEL ZOOM, y eso no es un capricho:
  //
  //    A ZOOM 1 cabe todo, así que no hay nada a donde desplazarse y permitirlo rompería la regla
  //    que da sentido al tope: podrías sacar un frente de la vista tirando del ratón. Entonces la
  //    superficie entera MUEVE LA VENTANA, que es como funcionaba antes de existir el zoom.
  //
  //    ACERCANDO, el interior DESPLAZA la vista y la ventana se mueve desde el asa (✋), igual
  //    que el aviso flotante. El asa está siempre, apagada: si solo apareciera al pasar por
  //    encima, quien acerque sin querer pensaría que el minimapa ya no se puede mover.
  //
  // ⚠️ SIN `.catch(() => {})`. Un catch vacío aquí es EXACTAMENTE lo que escondió que al overlay
  //    le faltaba `allow-start-dragging`: el permiso se rechaza en la promesa, el catch se lo
  //    come, y el síntoma es «no pasa nada» sin una línea en consola.
  const moverVentana = () =>
    getCurrentWindow()
      .startDragging()
      .catch((e) => console.error("[minimapa] arrastre rechazado (¿falta allow-start-dragging?):", e));

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      if ((ev.target as HTMLElement | null)?.dataset?.asa === "1") return; // el asa va por su lado
      if (zoom <= 1) {
        moverVentana();
        return;
      }
      tirando.current = { x0: ev.clientX, y0: ev.clientY, px0: pan.current.x, py0: pan.current.y };
    };
    // El repintado del arrastre va a UN FOTOGRAMA, no a cada `mousemove`. El raton puede mandar
    // bastantes mas eventos que fotogramas tiene la pantalla, y cada repintado proyecta los 5.485
    // sistemas del catalogo para decidir el fondo: sin esta brida se hace trabajo que nadie llega
    // a ver, encima del juego y mientras el jugador esta peleando, que es el peor momento.
    let pendiente = 0;
    const onMove = (ev: MouseEvent) => {
      const t = tirando.current;
      if (!t) return;
      pan.current = { x: t.px0 + (ev.clientX - t.x0), y: t.py0 + (ev.clientY - t.y0) };
      if (pendiente) return;
      pendiente = requestAnimationFrame(() => {
        pendiente = 0;
        repinta();
      });
    };
    const onUp = () => {
      tirando.current = null;
      if (pendiente) {
        cancelAnimationFrame(pendiente);
        pendiente = 0;
      }
      repinta(); // el ultimo movimiento, que puede haberse quedado en la brida
    };
    // Volver al principio. Hace falta una salida de un gesto: sin esto, un arrastre torpe te deja
    // mirando un rincón vacío sin saber cómo volver.
    const onDoble = () => {
      setZoom(1);
      localStorage.setItem("koru-minimapa-zoom", "1");
      pan.current = { x: 0, y: 0 };
      repinta();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("dblclick", onDoble);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("dblclick", onDoble);
    };
  }, [zoom]);

  // DÓNDE QUEDÓ LA VENTANA. Se apunta al MOVERSE y no al soltar el ratón: `startDragging()`
  // devuelve el control en cuanto el sistema operativo coge la ventana, no cuando termina el
  // arrastre, así que leer la posición justo después daría la de ANTES de moverla. `onMoved` es
  // un listener, que `core:default` sí cubre. En físicas, como `set_position` en Rust.
  useEffect(() => {
    let t = 0;
    const un = getCurrentWindow().onMoved(({ payload }) => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        localStorage.setItem("koru-minimapa-pos", JSON.stringify({ x: payload.x, y: payload.y }));
      }, 400);
    });
    return () => {
      window.clearTimeout(t);
      void un.then((f) => f());
    };
  }, []);

  // PINTAR. Un solo sitio dibuja, y va en DOS FASES: primero se mide todo, después se pinta. El
  // orden importa porque el recuadro se ciñe a lo que haya, y para ceñirse hay que saber antes
  // dónde cae cada cosa.
  useEffect(() => {
    const c = lienzo.current;
    if (!c) return;
    const lado = Math.round(c.clientWidth);
    if (lado <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const pix = Math.round(lado * dpr);
    if (c.width !== pix || c.height !== pix) {
      c.width = pix;
      c.height = pix;
    }
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, lado, lado);
    g.textAlign = "center";
    g.textBaseline = "middle";
    const ETIQ = "10px system-ui, -apple-system, sans-serif";

    if (!mapa) {
      mensaje(g, lado, [
        { texto: "cargando mapa…", font: "11px system-ui, sans-serif", color: "rgba(220, 230, 240, 0.7)" },
      ]);
      return;
    }

    // Caducar lo viejo y calcular la edad AHORA. La ventana de vida se relee en cada pintado
    // porque el jugador puede cambiarla en Ajustes con el minimapa abierto.
    const ahora = Date.now();
    const vida = ventanaMs();
    marcas.current = marcas.current.filter((m) => ahora - m.ts < vida);
    const avisos = marcas.current.map((m) => ({
      sys: m.sys,
      edad: Math.min(1, Math.max(0, (ahora - m.ts) / vida)),
      saltos: m.saltos,
      desde: m.desde,
    }));
    const reposo = avisos.length === 0;

    // LAS REFERENCIAS: anclas (un sitio que defiendes) y pilotos (alguien que se mueve). Se
    // dibujan distinto porque cuentan cosas distintas.
    const anclas = leerJSON<number[]>("koru-intel-anchors", []);
    const referencias: RefMini[] = [
      ...anclas.map((sys) => ({ sys, nombre: mapa.sistemas.get(sys)?.n ?? "", tipo: "ancla" as const })),
      ...pilotos.map((p) => ({ sys: p.sys, nombre: p.nombre, tipo: "piloto" as const })),
    ];
    if (!referencias.length) {
      mensaje(g, lado, [
        { texto: "sin referencias", font: "11px system-ui, sans-serif", color: "rgba(220, 230, 240, 0.7)" },
        { texto: "pon un ancla o conecta un personaje", font: "9px system-ui, sans-serif", color: "rgba(190, 205, 220, 0.55)" },
      ]);
      return;
    }

    // LA REGIÓN DEL MARCO. La elige el jugador en Ajustes; «auto» sigue a tu primera ancla y, si
    // no tienes ninguna, al primer piloto. Fijarla es lo que permite que el marco NO SE MUEVA
    // cuando tus personajes están en regiones distintas.
    const elegida = localStorage.getItem("koru-minimapa-region") ?? "auto";
    const region =
      elegida !== "auto" && Number.isFinite(Number(elegida))
        ? Number(elegida)
        : (mapa.sistemas.get(referencias[0].sys)?.r ?? -1);

    const plano = planoRegion({
      sistemas: mapa.sistemas,
      ady: mapa.ady,
      region,
      referencias,
      avisos,
      px: lado,
      zoom,
      pan: pan.current,
    });

    // ── FASE 1: MEDIR. Aquí no se pinta nada todavía. ──
    type Et = { texto: string; x: number; y: number; color: string };
    type Flecha = { x: number; y: number; ang: number; color: string };
    const etiquetas: Et[] = [];
    const flechas: Flecha[] = [];
    const rayos: { x: number; y: number; dx: number; dy: number; color: string }[] = [];

    /** Dónde tocaría el borde del lienzo algo que está fuera. */
    const alBorde = (x: number, y: number) => {
      const dx = x - lado / 2;
      const dy = y - lado / 2;
      const m = Math.max(Math.abs(dx), Math.abs(dy), 1e-9);
      const lim = lado / 2 - 13;
      return { x: lado / 2 + (dx / m) * lim, y: lado / 2 + (dy / m) * lim, ang: Math.atan2(dy, dx) };
    };

    const posRef = new Map(plano.refs.map((r) => [r.id, r]));

    for (const f of plano.frentes) {
      const col = colorEdad(f.edad);
      const dest = f.fuera ? alBorde(f.x, f.y) : { x: f.x, y: f.y, ang: 0 };
      if (f.fuera) flechas.push({ x: dest.x, y: dest.y, ang: alBorde(f.x, f.y).ang, color: col });
      // EL RAYO DE DIRECCIÓN sale de SU referencia, no de un centro elegido: con varias anclas o
      // varios personajes, cada frente apunta desde el sitio que de verdad lo mide.
      const o = f.desde != null ? posRef.get(f.desde) : undefined;
      if (o) rayos.push({ x: o.x, y: o.y, dx: dest.x, dy: dest.y, color: col });
      const etq = `${f.nombre}${f.saltos != null ? ` ${f.saltos}j` : ""}`;
      etiquetas.push({
        texto: etq,
        x: f.fuera ? dest.x - Math.cos(alBorde(f.x, f.y).ang) * 16 : f.x,
        y: f.fuera ? dest.y - Math.sin(alBorde(f.x, f.y).ang) * 16 : f.y + 15,
        color: col,
      });
    }

    // EL NOMBRE DE LAS ANCLAS. Va APAGADO y el ULTIMO en la cola a proposito: si pelea por un
    // hueco con el nombre de un frente, gana el frente. Un ancla es contexto — saber desde donde
    // se esta midiendo— y un frente es el motivo por el que estas mirando la ventana.
    for (const r of plano.refs) {
      if (r.fuera || r.tipo !== "ancla" || !r.nombre) continue;
      etiquetas.push({
        texto: r.nombre,
        x: r.x,
        y: r.y + 16,
        color: reposo ? "rgba(225, 238, 250, 0.4)" : "rgba(225, 238, 250, 0.68)",
      });
    }

    // COLOCAR LAS ETIQUETAS: para cada una se prueban unos huecos y gana el primero libre. Dos
    // frentes cercanos comparten sitio y sus nombres se pisaban. Si no hay hueco se pinta igual
    // en el primero: tapada es malo, invisible es peor.
    g.font = ETIQ;
    const ocupado: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const puestas: { et: Et; x: number; y: number }[] = [];
    for (const et of etiquetas) {
      const an = g.measureText(et.texto).width;
      const medio = an / 2 + 3;
      const huecos: [number, number][] = [
        [et.x, et.y], [et.x, et.y - 26],
        [et.x + medio + 6, et.y], [et.x - medio - 6, et.y],
        [et.x + medio + 6, et.y - 26], [et.x - medio - 6, et.y - 26],
        [et.x, et.y + 12], [et.x, et.y - 38],
      ];
      let puesto: [number, number] | null = null;
      let caja = { x1: 0, y1: 0, x2: 0, y2: 0 };
      for (const [hx, hy] of huecos) {
        const x = Math.min(Math.max(hx, medio + 5), lado - medio - 5);
        const y = Math.min(Math.max(hy, 11), lado - 11);
        const cand = { x1: x - medio, y1: y - 6, x2: x + medio, y2: y + 6 };
        const choca = ocupado.some((o) => !(cand.x2 < o.x1 || cand.x1 > o.x2 || cand.y2 < o.y1 || cand.y1 > o.y2));
        if (!puesto) caja = cand;
        if (!choca) { puesto = [x, y]; caja = cand; break; }
      }
      const [px2, py2] = puesto ?? [
        Math.min(Math.max(et.x, medio + 5), lado - medio - 5),
        Math.min(Math.max(et.y, 11), lado - 11),
      ];
      ocupado.push(caja);
      puestas.push({ et, x: px2, y: py2 });
    }

    const notas: string[] = [];
    if (plano.recortados > 0) notas.push(`+${plano.recortados}`);
    if (plano.inalcanzables > 0) notas.push(`${plano.inalcanzables} sin ruta`);

    // LA CAJA de lo dibujable, que es lo que el recuadro tiene que cubrir.
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const meter = (ax: number, ay: number, bx: number, by: number) => {
      x1 = Math.min(x1, ax); y1 = Math.min(y1, ay);
      x2 = Math.max(x2, bx); y2 = Math.max(y2, by);
    };
    const fondoOn = conFondo();
    if (fondoOn) for (const id of plano.fondo) {
      const s = mapa.sistemas.get(id)!;
      const [x, y] = proyectar(plano.proy, s.x, s.y);
      meter(x - 2, y - 2, x + 2, y + 2);
    }
    for (const r of plano.refs) if (!r.fuera) meter(r.x - 8, r.y - 8, r.x + 8, r.y + 8);
    for (const f of plano.frentes) if (!f.fuera) meter(f.x - 10, f.y - 10, f.x + 10, f.y + 10);
    for (const m of flechas) meter(m.x - 8, m.y - 8, m.x + 8, m.y + 8);
    for (const o of ocupado) meter(o.x1, o.y1, o.x2, o.y2);
    if (!Number.isFinite(x1)) { x1 = y1 = lado / 2 - 20; x2 = y2 = lado / 2 + 20; }

    let notaX = 0, notaY = 0;
    if (notas.length) {
      g.font = "9px system-ui, sans-serif";
      const an = g.measureText(notas.join("  ·  ")).width;
      notaX = Math.min(Math.max((x1 + x2) / 2, an / 2 + 3), lado - an / 2 - 3);
      notaY = Math.min(y2 + 12, lado - 8);
      meter(notaX - an / 2, notaY - 6, notaX + an / 2, notaY + 6);
    }

    // ── FASE 2: PINTAR ──
    panel(g, { x1, y1, x2, y2 }, lado, reposo);

    // EL MAPA, debajo de todo y muy apagado: está para dar SITIO, no para leerse.
    if (fondoOn) {
      const enMarco = new Set(plano.fondo);
      const pos = new Map<number, [number, number]>();
      for (const id of plano.fondo) {
        const s = mapa.sistemas.get(id)!;
        pos.set(id, proyectar(plano.proy, s.x, s.y));
      }
      g.lineWidth = 1;
      g.strokeStyle = "rgba(150, 190, 230, 0.13)";
      g.beginPath();
      for (const id of plano.fondo) {
        const a = pos.get(id)!;
        for (const v of mapa.ady.get(id) ?? []) {
          if (v <= id || !enMarco.has(v)) continue; // cada puerta una sola vez
          const b = pos.get(v)!;
          g.moveTo(a[0], a[1]);
          g.lineTo(b[0], b[1]);
        }
      }
      g.stroke();
      g.fillStyle = "rgba(175, 195, 215, 0.3)";
      for (const [, p] of pos) {
        g.beginPath();
        g.arc(p[0], p[1], 1.3, 0, Math.PI * 2);
        g.fill();
      }
    }

    // LA RUTA, resaltada SOBRE las puertas del fondo: el fondo dice qué hay, esto dice por dónde
    // vendrían. Antes era una línea aparte; ahora que el fondo pinta todas las puertas, resaltar
    // las de la ruta cuenta lo mismo y ensucia la mitad.
    if (plano.rutas.length) {
      g.lineWidth = 2;
      g.strokeStyle = "rgba(190, 215, 240, 0.45)";
      g.beginPath();
      for (const a of plano.rutas) {
        g.moveTo(a.ax, a.ay);
        g.lineTo(a.bx, a.by);
      }
      g.stroke();
    }

    // LOS RAYOS: de cada referencia a su frente, en degradado — invisibles donde salen y con
    // color al llegar, para que apunten sin ensuciar.
    g.lineCap = "round";
    for (const r of rayos) {
      const grad = g.createLinearGradient(r.x, r.y, r.dx, r.dy);
      grad.addColorStop(0, conAlfa(r.color, 0));
      grad.addColorStop(0.5, conAlfa(r.color, 0.1));
      grad.addColorStop(1, conAlfa(r.color, 0.5));
      g.strokeStyle = grad;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(r.x, r.y);
      g.lineTo(r.dx, r.dy);
      g.stroke();
    }
    g.lineCap = "butt";

    // LAS REFERENCIAS. El ancla es un rombo (un sitio) y el piloto un anillo (alguien). No es
    // decoración: son dos cosas distintas y mezclarlas sería perder la mitad de lo que dicen.
    for (const r of plano.refs) {
      if (r.fuera) continue;
      const col = reposo ? "rgba(235, 245, 255, 0.5)" : "rgba(235, 245, 255, 0.95)";
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath();
      if (r.tipo === "ancla") {
        g.moveTo(r.x, r.y - 6);
        g.lineTo(r.x + 6, r.y);
        g.lineTo(r.x, r.y + 6);
        g.lineTo(r.x - 6, r.y);
        g.closePath();
      } else {
        g.arc(r.x, r.y, 5, 0, Math.PI * 2);
      }
      g.stroke();
    }

    // LOS FRENTES: EL COLOR CUENTA LA EDAD Y EL TAMAÑO CUENTA LA CERCANÍA. Son dos datos y
    // necesitan dos canales. Con uno solo, un frente a 2 saltos de hace nueve minutos parecía un
    // punto de paso mientras el ojo se iba a otro a 6 por ser rojo.
    for (const f of plano.frentes) {
      if (f.fuera) continue;
      const col = colorEdad(f.edad);
      const r = 8 - Math.min(10, Math.max(0, f.saltos ?? 10)) * 0.35; // 8 px encima, 4,5 a 10+
      if (f.edad < 0.35) {
        g.beginPath();
        g.arc(f.x, f.y, r + 4, 0, Math.PI * 2);
        g.fillStyle = "rgba(255, 77, 61, 0.16)";
        g.fill();
      }
      g.beginPath();
      g.arc(f.x, f.y, r, 0, Math.PI * 2);
      g.fillStyle = col;
      g.fill();
      g.strokeStyle = "rgba(240, 248, 255, 0.6)";
      g.lineWidth = 1.4;
      g.stroke();
    }

    // LAS FLECHAS del borde. Los tres vértices a mano, sin `save/rotate/restore`: con la versión
    // rotada una de las marcas salió al doble de ancho que las otras y el tamaño está escrito
    // fijo, así que apuntaba a transformación heredada. Sin transformación que heredar, el
    // triángulo mide lo que dicen estos números y punto.
    for (const m of flechas) {
      const ca = Math.cos(m.ang), sa = Math.sin(m.ang);
      const P = (dx: number, dy: number): [number, number] => [
        m.x + dx * ca - dy * sa,
        m.y + dx * sa + dy * ca,
      ];
      const [ax, ay] = P(7, 0);
      const [bx, by] = P(-5, 5);
      const [cx3, cy3] = P(-5, -5);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.lineTo(cx3, cy3);
      g.closePath();
      g.fillStyle = m.color;
      g.fill();
      g.strokeStyle = "rgba(240, 248, 255, 0.6)";
      g.lineWidth = 1.2;
      g.stroke();
    }

    g.font = ETIQ;
    for (const p of puestas) etiqueta(g, p.et.texto, p.x, p.y, p.et.color);

    if (notas.length) {
      g.font = "9px system-ui, sans-serif";
      etiqueta(g, notas.join("  ·  "), notaX, notaY, "rgba(200, 215, 230, 0.65)");
    }
  }, [mapa, pilotos, tic, zoom]);

  return (
    <>
      <canvas ref={lienzo} className="mm-lienzo" />
      {/* EL ASA. Siempre visible aunque apagada: si solo apareciera al pasar por encima, quien
          acerque sin querer pensaría que el minimapa ya no se puede mover. Mismo gesto que el
          aviso flotante, para no tener que aprender dos. */}
      <button
        type="button"
        className="mm-asa"
        data-asa="1"
        title="Mover el minimapa"
        onMouseDown={(e) => {
          e.preventDefault();
          moverVentana();
        }}
      >
        ✋
      </button>
    </>
  );
}
