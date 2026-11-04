/** La VENTANA del minimapa: una caja cuadrada, sin bordes, siempre encima y arrastrable, que
 *  dibuja POR DÓNDE VIENE lo que está cantando el intel.
 *
 *  La geometría NO está aquí: está en `minimapa.ts`, un módulo puro ya verificado contra los datos
 *  de verdad (`scripts/verificar_minimapa.mjs`, 22 comprobaciones en verde). Aquí solo hay
 *  fontanería y pintura, que es justo lo que no se puede verificar en node.
 *
 * ★ DE DÓNDE SALEN LOS DATOS. Esto es lo que decidió el diseño y conviene leerlo antes de tocar:
 *
 *   - Los AVISOS vienen del evento `intel-alert` que YA emite el hilo de Rust. En Tauri v2 un
 *     `app.emit` llega a TODAS las ventanas, así que esta ventana lo escucha igual que el overlay
 *     y App.tsx no se toca para esto. El evento trae `sys_id` y `ts_ms`: qué sistema y cuándo, que
 *     es exactamente lo que hace falta. Un canal menos que inventar y uno menos que se puede
 *     desincronizar del overlay.
 *
 *   - DÓNDE ESTOY YO no lo publicaba nadie, así que App.tsx lo publica ahora: el evento `koru-yo`
 *     para lo vivo, y `koru-yo-sistema` en localStorage para cuando esta ventana abre después.
 *
 *   - EL MAPA sale de `loadNewEden()`, el mismo cargador cacheado que usa la app: ese 1 MB se
 *     comparte en vez de pedirse aparte.
 *
 * ★★ ESTA VENTANA NO TIENE EL ESTADO DE APP, y no es un detalle menor: todo lo que necesita viaja
 *    por eventos o por localStorage, y hay que VOLVER A LEERLO cuando cambia. Nada de suponer que
 *    un ajuste leído al montar sigue siendo el de ahora.
 *
 * ★★★ EN REPOSO TIENE QUE PODER IGNORARSE. Sin avisos, `planoAmenaza` devuelve un solo nodo —tu
 *     sistema, centrado— y eso se pinta apagado, sin un color de alarma. Un minimapa que grita
 *     cuando no pasa nada se acaba tapando, y entonces tampoco sirve cuando sí pasa.
 */
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadNewEden } from "./neweden";
import { planoAmenaza, type SistemaMini } from "./minimapa";
import "./minimapa.css";

/** Un aviso tal y como llega. La edad se calcula al pintar, no al recibir — así un aviso
 *  envejece aunque no llegue ninguno nuevo.
 *
 *  `desde` y `saltos` salen del propio evento, y con la MISMA PRIORIDAD que usa Rust: el ANCLA
 *  más cercana si hay anclas puestas, y solo si no hay ninguna, el piloto más cercano
 *  (`pilots[0]`, que vienen ordenados por cercanía al sistema del aviso). Esa prioridad es la de
 *  `contexto_cerca` en commands.rs —`if cfg.anchors.is_empty() { origins } else { anchors }`— y
 *  copiarla es lo que mantiene al minimapa diciendo el mismo número que el panel de intel. */
type Marca = { sys: number; ts: number; desde: number | null; saltos: number | null };

/** La ventana de vida la pone el INTEL: la misma que decide qué es «reciente» en el mapa, en
 *  minutos (`recencyMinutes`). Decisión deliberada: el minimapa NO tiene la suya. Es un ajuste
 *  menos que explicar y, sobre todo, uno menos que puede contradecir al mapa grande. */
function ventanaMs(): number {
  const m = Number(localStorage.getItem("koru-intel-recency") ?? 30);
  return Number.isFinite(m) && m > 0 ? m * 60_000 : 30 * 60_000;
}

function leerYo(): number | null {
  const v = Number(localStorage.getItem("koru-yo-sistema"));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Rampa de color por edad: recién cantado QUEMA, viejo se apaga hacia el gris azulado del
 *  fondo. El color es la única forma de poner «hace cuánto» en un punto de 5 px. */
function colorEdad(edad: number): string {
  const a = [255, 77, 61];
  const b = [110, 125, 145];
  const t = Math.min(1, Math.max(0, edad));
  const c = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

/** Rectángulo redondeado a mano. `ctx.roundRect` existe en los WebView modernos, pero esta ventana
 *  es la que menos ganas tengo de depurar en la máquina de otro: diez líneas evitan el «en mi
 *  Linux no se ve el fondo». */
function panel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

/** EL FONDO, CEÑIDO A LO QUE HAYA DENTRO y no a la ventana entera.
 *
 *  La ventana es un cuadrado fijo, pero la amenaza casi nunca lo es: con dos frentes en línea el
 *  dibujo ocupa una banda y el resto era cristal oscuro tapando mapa para nada (captura suya del
 *  2026-11-04, en tamaño Enorme). Así el recuadro solo cubre lo que usa y lo demás queda
 *  transparente del todo. En reposo es poco más que una pastilla alrededor de tu punto.
 *
 *  Se sigue arrastrando desde cualquier sitio: el lienzo ocupa la ventana entera aunque no pinte
 *  nada ahí, así que la zona transparente también recibe el ratón.
 *
 *  El precio, asumido: el recuadro cambia de forma según entran y caducan avisos. */
function fondo(
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
  panel(g, ax, ay, Math.max(1, bx - ax), Math.max(1, by - ay), 10);
  g.fillStyle = reposo ? "rgba(10, 14, 20, 0.26)" : "rgba(10, 14, 20, 0.62)";
  g.fill();
  g.strokeStyle = reposo ? "rgba(255, 255, 255, 0.045)" : "rgba(255, 255, 255, 0.10)";
  g.lineWidth = 1;
  g.stroke();
}

/** Un aviso de texto centrado, con su fondo a medida. Para los estados en los que no hay nada que
 *  dibujar: sin mapa, sin posición, fuera del grafo. Decirlo siempre es mejor que quedarse en
 *  blanco, que en una ventana transparente se lee como «esto no funciona». */
function mensaje(
  g: CanvasRenderingContext2D,
  lado: number,
  reposo: boolean,
  lineas: { texto: string; font: string; color: string }[],
) {
  let an = 0;
  for (const l of lineas) {
    g.font = l.font;
    an = Math.max(an, g.measureText(l.texto).width);
  }
  const alto = lineas.length * 15;
  const cx = lado / 2;
  const cy = lado / 2;
  fondo(g, { x1: cx - an / 2, y1: cy - alto / 2, x2: cx + an / 2, y2: cy + alto / 2 }, lado, reposo);
  let y = cy - alto / 2 + 7.5;
  for (const l of lineas) {
    g.font = l.font;
    etiqueta(g, l.texto, cx, y, l.color);
    y += 15;
  }
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

export function MinimapaVentana() {
  const lienzo = useRef<HTMLCanvasElement | null>(null);
  const [mapa, setMapa] = useState<{ sistemas: Map<number, SistemaMini>; ady: Map<number, number[]> } | null>(null);
  const [yo, setYo] = useState<number | null>(() => leerYo());
  /** Los avisos van en un ref y NO en estado: el pintado los envejece y los caduca en el mismo
   *  sitio donde los lee, y meterlos en estado solo añadiría un render por aviso. */
  const marcas = useRef<Marca[]>([]);
  const [tic, setTic] = useState(0);

  // EL MAPA, una vez. `loadNewEden` ya cachea, así que si la ventana principal lo pidió antes,
  // esto no vuelve a bajar nada.
  useEffect(() => {
    let vivo = true;
    loadNewEden().then(
      (ne) => {
        if (!vivo) return;
        const sistemas = new Map<number, SistemaMini>();
        for (const s of ne.systems) sistemas.set(s.id, { x: s.x, y: s.y, n: s.n, s: s.s });
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
      // Sin `.catch(() => {})`: si el mapa no carga, quiero verlo en consola y no una ventana
      // en blanco sin explicación.
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
      // El ancla manda sobre el piloto, igual que en Rust. Si no hay ninguna de las dos, el aviso
      // entra sin referencia y el origen lo pondrá `koru-yo`.
      const ref = anchor ?? (pilots && pilots.length ? pilots[0] : null);
      marcas.current = [
        ...marcas.current,
        { sys: sys_id, ts: ts_ms, desde: ref?.system_id ?? null, saltos: ref?.jumps ?? null },
      ];
      setTic((t) => t + 1);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // DÓNDE ESTOY YO: evento para lo vivo, localStorage ya leído en el estado inicial.
  useEffect(() => {
    const un = listen<{ sys: number | null }>("koru-yo", (e) => setYo(e.payload?.sys ?? null));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // LATIDO. Se reprograma solo y el periodo depende de si hay algo que envejecer: con avisos, un
  // segundo (el color cambia); en reposo, cinco (no hay nada que mover). Un `setInterval` de 1 s
  // eterno para dibujar siempre lo mismo es gasto en una ventana que está abierta toda la sesión.
  useEffect(() => {
    const periodo = marcas.current.length ? 1000 : 5000;
    const id = window.setTimeout(() => setTic((t) => t + 1), periodo);
    return () => window.clearTimeout(id);
  }, [tic]);

  // ARRASTRE. Toda la superficie: dentro no hay nada que pulsar.
  //
  // ⚠️ SIN `.catch(() => {})`, Y A PROPÓSITO. Un catch vacío aquí es EXACTAMENTE lo que escondió
  // que al overlay le faltaba `allow-start-dragging`: el permiso se rechaza en la promesa, el
  // catch se lo come, y el síntoma es «el asa no hace nada» sin una línea en consola.
  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      getCurrentWindow()
        .startDragging()
        .catch((e) => console.error("[minimapa] arrastre rechazado (¿falta allow-start-dragging?):", e));
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  // DÓNDE QUEDÓ. Se apunta al MOVERSE y no al soltar el ratón: `startDragging()` devuelve el
  // control en cuanto el sistema operativo coge la ventana, no cuando termina el arrastre, así que
  // leer la posición justo después daría la de ANTES de moverla. `onMoved` es un listener, que
  // `core:default` sí cubre. Se guarda en físicas, las mismas que usa `set_position` en Rust.
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
  // orden importa porque el fondo se ciñe a lo que haya (ver `fondo`), y para ceñirse hay que
  // saber antes dónde cae cada cosa. Antes el fondo era lo primero y llenaba la ventana entera.
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

    // Caducar lo viejo y calcular la edad AHORA. La ventana se vuelve a leer en cada pintado
    // porque el jugador puede cambiarla en Ajustes con el minimapa abierto.
    const ahora = Date.now();
    const vida = ventanaMs();
    marcas.current = marcas.current.filter((m) => ahora - m.ts < vida);
    const avisos = marcas.current.map((m) => ({
      sys: m.sys,
      edad: Math.min(1, Math.max(0, (ahora - m.ts) / vida)),
      // Los saltos que dijo Rust. Deciden quien entra cuando hay mas frentes que sitio.
      saltos: m.saltos,
    }));

    // ★ EN REPOSO SE APAGA CASI DEL TODO. Quedó decidido que el minimapa NO se esconde solo
    //   —«se queda en un punto con la posición»— y eso sigue igual. Pero un recuadro plantado
    //   sobre el juego durante horas sin nada que contar se acaba tapando, y entonces tampoco
    //   está el día que hace falta. Que se vea no es lo mismo que que moleste.
    const reposo = avisos.length === 0;

    if (!mapa) {
      mensaje(g, lado, reposo, [
        { texto: "cargando mapa…", font: "11px system-ui, sans-serif", color: "rgba(220, 230, 240, 0.7)" },
      ]);
      return;
    }

    // ★★ EL ORIGEN NO ES «EL PERSONAJE QUE ESTÁS MIRANDO», y esto se aprendió en la primera
    //    prueba en vivo (2026-11-04): el minimapa marcaba «21 saltos» en un frente que el panel
    //    de intel, en la misma pantalla, daba a «9». Dos números para lo mismo. La causa era que
    //    yo medía desde el personaje activo, y Rust mide desde la referencia del intel.
    //
    //    Y la referencia NO es siempre un piloto: con 3 personajes y un ancla puesta (su
    //    configuración real), Rust mide desde EL ANCLA —`if cfg.anchors.is_empty() { origins }
    //    else { anchors }`— y por eso el panel decía «3 saltos» donde el minimapa decía 23.
    //
    //    El arreglo no es recalcularlo aquí —eso duplicaría la lógica de Rust y acabaría
    //    desviandose— sino USAR LO QUE YA VIENE en el evento, con su misma prioridad (ver
    //    `Marca`). De los avisos vivos se coge el de menos saltos, que es el más urgente. Así el
    //    camino dibujado y el número del panel miden lo mismo desde el mismo sitio.
    //
    //    En reposo no hay avisos y no hay pilotos que ordenar: ahí manda `koru-yo`, que es el
    //    personaje que tienes delante. Es lo único que se puede saber sin un aviso.
    let origen = yo;
    let masCerca = Infinity;
    for (const m of marcas.current) {
      if (m.desde == null || m.saltos == null) continue;
      if (m.saltos < masCerca) {
        masCerca = m.saltos;
        origen = m.desde;
      }
    }

    if (origen == null) {
      mensaje(g, lado, reposo, [
        { texto: "sin posición", font: "11px system-ui, sans-serif", color: "rgba(220, 230, 240, 0.7)" },
        { texto: "Koru no sabe dónde estás", font: "9px system-ui, sans-serif", color: "rgba(190, 205, 220, 0.55)" },
      ]);
      return;
    }

    const plano = planoAmenaza({ sistemas: mapa.sistemas, ady: mapa.ady, yo: origen, avisos, px: lado });
    if (!plano.nodos.length) {
      // Pasa si tu sistema no está en el grafo (abisal, por ejemplo).
      mensaje(g, lado, reposo, [
        { texto: "fuera del mapa", font: "11px system-ui, sans-serif", color: "rgba(220, 230, 240, 0.7)" },
      ]);
      return;
    }

    // ── FASE 1: MEDIR. Aquí no se pinta nada todavía. ──
    type Circulo = { x: number; y: number; r: number; relleno: string | null; aro: string | null; grosor: number; halo: number };
    type Et = { texto: string; x: number; y: number; color: string };
    const circulos: Circulo[] = [];
    const etiquetas: Et[] = [];
    let etiquetaCentro: Et | null = null;

    // `planoAmenaza` devuelve los calientes AL FINAL, así que recorrerlos en orden los deja
    // encima de los de paso sin ordenar nada aquí.
    for (const n of plano.nodos) {
      if (n.yo) {
        // EL CENTRO: un anillo claro, sin relleno. No compite por atención con la amenaza.
        circulos.push({
          x: n.px, y: n.py, r: 5, relleno: null,
          aro: reposo ? "rgba(235, 245, 255, 0.5)" : "rgba(235, 245, 255, 0.95)", grosor: 2, halo: 0,
        });
        // Y su nombre, apagado. Cuando el centro es un ANCLA y no el personaje que llevas
        // delante, no hay forma de adivinar desde dónde se está midiendo. Va el último a la cola
        // de etiquetas a propósito: si hay pelea por el hueco, gana la amenaza.
        etiquetaCentro = {
          texto: n.nombre, x: n.px, y: n.py + 14,
          color: reposo ? "rgba(225, 238, 250, 0.35)" : "rgba(225, 238, 250, 0.6)",
        };
        continue;
      }
      if (!n.caliente) {
        // De PASO: un punto pequeño y apagado. Está para que se vea la dirección, no para leerlo.
        circulos.push({ x: n.px, y: n.py, r: 2.5, relleno: "rgba(170, 190, 210, 0.5)", aro: null, grosor: 0, halo: 0 });
        continue;
      }
      // ★★ CALIENTE: EL COLOR CUENTA LA EDAD Y EL TAMAÑO CUENTA LA CERCANÍA. Son dos datos y
      //    necesitan dos canales. Con uno solo pasaba esto (captura suya del 2026-11-04): un
      //    frente a 2 SALTOS de hace nueve minutos era el punto más apagado de la ventana, casi
      //    indistinguible de uno de paso, mientras el ojo se iba a otro a 6 saltos por ser rojo.
      //    Lo viejo puede dejar de quemar, pero lo que tienes encima no puede dejar de verse.
      //
      //    Y el ARO NO SE PIERDE NUNCA, por apagado que esté el relleno: es lo que impide que un
      //    aviso caducando se lea como un punto del camino.
      const col = colorEdad(n.edad);
      const r = 8 - Math.min(10, Math.max(0, n.saltos)) * 0.35; // 8 px encima de ti, 4,5 a 10+
      circulos.push({
        x: n.px, y: n.py, r, relleno: col, aro: "rgba(240, 248, 255, 0.6)", grosor: 1.4,
        halo: n.edad < 0.35 ? r + 4 : 0,
      });
      // El nombre y los saltos. Los saltos los sabe el aviso de texto; el nombre junto a la
      // DIRECCIÓN es lo que el texto no sabe contar.
      etiquetas.push({ texto: `${n.nombre} ${n.saltos}j`, x: n.px, y: n.py + r + 9, color: col });
    }

    // ★ COLOCAR LAS ETIQUETAS. Dos frentes cercanos comparten trozo de camino, así que sus
    //   nombres se pisaban —y el de la derecha se salía del cuadro—. Para cada una se prueban
    //   unos cuantos huecos y gana el primero libre; además se mete a la fuerza dentro del
    //   lienzo, porque una etiqueta cortada no se puede leer. Si no hay hueco se pinta igual en
    //   el primero: tapada es malo, invisible es peor.
    g.font = ETIQ;
    if (etiquetaCentro) etiquetas.push(etiquetaCentro);
    const ocupado: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const puestas: { et: Et; x: number; y: number }[] = [];
    for (const et of etiquetas) {
      const an = g.measureText(et.texto).width;
      const medio = an / 2 + 3;
      const huecos: [number, number][] = [
        [et.x, et.y],
        [et.x, et.y - 26],
        [et.x + medio + 6, et.y],
        [et.x - medio - 6, et.y],
        [et.x + medio + 6, et.y - 26],
        [et.x - medio - 6, et.y - 26],
        [et.x, et.y + 12],
        [et.x, et.y - 38],
      ];
      let puesto: [number, number] | null = null;
      let cajaPuesta = { x1: 0, y1: 0, x2: 0, y2: 0 };
      for (const [hx, hy] of huecos) {
        const x = Math.min(Math.max(hx, medio), lado - medio);
        const y = Math.min(Math.max(hy, 8), lado - 8);
        const caja = { x1: x - medio, y1: y - 6, x2: x + medio, y2: y + 6 };
        const choca = ocupado.some(
          (o) => !(caja.x2 < o.x1 || caja.x1 > o.x2 || caja.y2 < o.y1 || caja.y1 > o.y2),
        );
        if (!choca) {
          puesto = [x, y];
          cajaPuesta = caja;
          break;
        }
        if (!puesto) cajaPuesta = caja; // la primera, por si ninguna queda libre
      }
      const [px, py] = puesto ?? [
        Math.min(Math.max(et.x, medio), lado - medio),
        Math.min(Math.max(et.y, 8), lado - 8),
      ];
      // La caja se apunta SIEMPRE, se haya encontrado hueco o no: si no, el fondo no cubriría
      // una etiqueta que sí se va a pintar.
      ocupado.push(cajaPuesta);
      puestas.push({ et, x: px, y: py });
    }

    // Lo que NO cabe se cuenta, no se esconde.
    const notas: string[] = [];
    if (plano.recortados > 0) notas.push(`+${plano.recortados}`);
    if (plano.inalcanzables > 0) notas.push(`${plano.inalcanzables} sin ruta`);

    // LA CAJA de todo lo dibujable, que es lo que el fondo tiene que cubrir.
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const meter = (ax: number, ay: number, bx: number, by: number) => {
      x1 = Math.min(x1, ax); y1 = Math.min(y1, ay);
      x2 = Math.max(x2, bx); y2 = Math.max(y2, by);
    };
    for (const cir of circulos) {
      const rr = Math.max(cir.r + cir.grosor, cir.halo);
      meter(cir.x - rr, cir.y - rr, cir.x + rr, cir.y + rr);
    }
    for (const o of ocupado) meter(o.x1, o.y1, o.x2, o.y2);
    for (const a of plano.aristas) {
      meter(Math.min(a.ax, a.bx), Math.min(a.ay, a.by), Math.max(a.ax, a.bx), Math.max(a.ay, a.by));
    }

    // Las notas van DEBAJO de todo lo demás, así que se colocan ahora que ya se sabe dónde
    // termina, y entran en la caja para que el fondo también las cubra.
    let notaY = 0;
    let notaX = 0;
    if (notas.length) {
      g.font = "9px system-ui, sans-serif";
      const an = g.measureText(notas.join("  ·  ")).width;
      notaX = Math.min(Math.max((x1 + x2) / 2, an / 2 + 3), lado - an / 2 - 3);
      notaY = Math.min(y2 + 12, lado - 8);
      meter(notaX - an / 2, notaY - 6, notaX + an / 2, notaY + 6);
    }

    // ── FASE 2: PINTAR, ahora sí, y el fondo el primero. ──
    fondo(g, { x1, y1, x2, y2 }, lado, reposo);

    g.lineWidth = 1.5;
    g.strokeStyle = "rgba(150, 190, 230, 0.33)";
    for (const a of plano.aristas) {
      g.beginPath();
      g.moveTo(a.ax, a.ay);
      g.lineTo(a.bx, a.by);
      g.stroke();
    }

    for (const cir of circulos) {
      if (cir.halo > 0) {
        g.beginPath();
        g.arc(cir.x, cir.y, cir.halo, 0, Math.PI * 2);
        g.fillStyle = "rgba(255, 77, 61, 0.16)";
        g.fill();
      }
      g.beginPath();
      g.arc(cir.x, cir.y, cir.r, 0, Math.PI * 2);
      if (cir.relleno) {
        g.fillStyle = cir.relleno;
        g.fill();
      }
      if (cir.aro) {
        g.strokeStyle = cir.aro;
        g.lineWidth = cir.grosor;
        g.stroke();
      }
    }

    g.font = ETIQ;
    for (const p of puestas) etiqueta(g, p.et.texto, p.x, p.y, p.et.color);

    if (notas.length) {
      g.font = "9px system-ui, sans-serif";
      etiqueta(g, notas.join("  ·  "), notaX, notaY, "rgba(200, 215, 230, 0.65)");
    }
  }, [mapa, yo, tic]);

  return <canvas ref={lienzo} className="mm-lienzo" />;
}
