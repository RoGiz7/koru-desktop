// Overlay de avisos: una ventanita sin bordes que flota sobre el juego.
//
// POR QUÉ EXISTE. Sugerencia de un jugador (Sir Rayl, 2026-08-05): con dos Ishtars y el monitor
// central lleno de pestañas, le saltaba la notificación de Windows del intel y al pincharla no
// pasaba nada. Y sobre todo: prefería el aviso EN la ventana del juego, no perdido en el escritorio.
//
// POR QUÉ UNA VENTANA PROPIA Y NO LA NOTIFICACIÓN DEL SISTEMA:
//   1. Fenris NO expone ninguna API para dibujar dentro del cliente de EVE, y modificar el cliente
//      está prohibido explícitamente. Lo que hacen todas las herramientas que "parecen del juego"
//      es exactamente esto: una ventana externa siempre encima. Cae en los «overlays de comodidad»
//      que el blog de seguridad nombra como tolerados (los de chat, Steam, TeamSpeak).
//   2. El clic lo controlamos al 100%. `onAction()` del plugin de notificaciones es de móvil y en
//      Windows puede no dispararse nunca; aquí es un clic normal de webview.
//   3. Podemos poner el contexto que solo Koru tiene: no «hostil a 3 saltos», sino «a 3 saltos de
//      Vera, que va en Venture». Ese es el motivo de que esto valga la pena.
//
// ⚠️ EL FORMATO, EN DOS CORRECCIONES (las dos en vivo, 2026-08-05).
//   1ª · Empezó siendo UNA tarjeta con «manda el más cercano»: los demás avisos solo subían un
//        contador «+N». Zigor lo vio con «5 saltos +7» — la tarjeta se congeló en el primero y los
//        SIETE siguientes fueron invisibles. Un banner único vale para una alarma; el intel es un
//        FLUJO y lo nuevo tiene que verse.
//   2ª · Pasó a pila completa… y con reportes en cadena se comía la pantalla, que es peor que no
//        avisar: tapa el juego justo cuando hay que mirarlo.
// FORMATO ACTUAL: **una tarjeta abierta + el resto en renglones de una línea**. Cuatro avisos pasan
// de ~340 px a ~150 px y ninguno se esconde. Se descartaron las pestañas a propósito: en pleno
// combate nadie pincha una pestaña, así que lo que hay detrás de un clic es invisible en la
// práctica — el mismo error del «+N» con otra cara.
//
// Abierta va la MÁS CERCANA (menos saltos a un piloto tuyo), no la más reciente: es la que puede
// matarte antes. Pulsar un renglón lo abre a él.
//
// REGLAS ANTI-RUIDO (decididas con Zigor antes de escribir una línea): tope de avisos a la vez ·
// nada se repite · todo caduca solo · y el criterio para merecer salir aquí: **¿el jugador haría
// algo distinto en los próximos 30 segundos si lo supiera?** Si no, va a la app. Por eso en la v1
// solo sale el intel: PI, logros y trabajos de industria son cosas de cuando atracas.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { tr, setLang, getLang, type Lang } from "./i18n";
import { typeIcon } from "./format";
import "./overlay.css";

/** Un piloto tuyo y su proximidad al sistema del aviso. Lo calcula Rust con un BFS desde el
 *  sistema hostil, así que es distancia REAL de saltos, no una estimación. */
type PilotProximity = { name: string; jumps: number; ship: string | null; ship_type_id: number | null };

/** Quien viene. `character_id` solo si Koru ya le había visto antes (tabla de avistamientos), y
 *  entonces se puede pintar su retrato sin llamar a ESI. */
type Hostil = { name: string; character_id: number | null };
type NaveCitada = { type_id: number; name: string };
/** Lo que Rust ha sacado en limpio de la línea del chat. Ver `analizar_intel` en commands.rs. */
type IntelParse = { hostiles: Hostil[]; ships: NaveCitada[]; count: number | null };

type IntelAlert = {
  sys_id: number;
  system: string;
  jumps: number;
  author: string;
  message: string;
  ts_ms: number;
  pilots?: PilotProximity[];
  parse?: IntelParse;
};

/** Un aviso en la pila: el evento + su identidad propia y cuándo le toca irse. */
type Aviso = IntelAlert & { key: string; expira: number };

/** Tope de avisos simultáneos. Cuatro es lo que cabe sin tapar media pantalla; a partir de ahí, el
 *  más viejo cae para dejar sitio al nuevo — que es justo el orden de prioridad correcto. */
const TOPE = 4;

/** Cuánto vive cada aviso. `0` = hasta que lo cierres tú. Ajustes → Avisos. */
function vidaMs(): number {
  const v = Number(localStorage.getItem("koru-overlay-vida") ?? 20);
  return Number.isFinite(v) && v >= 0 ? v * 1000 : 20_000;
}

/** «hace 12 s» / «12 s ago». Corto a propósito: es un vistazo, no una lectura.
 *  El idioma no se resuelve con `tr()` porque el ORDEN cambia —en español va delante y en inglés
 *  detrás—, y una clave vacía de prefijo dejaría un espacio suelto en inglés. */
function edad(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  const cant = s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
  return getLang() === "en" ? `${cant} ago` : `hace ${cant}`;
}

/** Saltos al piloto tuyo más cercano; si no hay pilotos, la distancia a los orígenes. */
function saltosDe(a: IntelAlert): number {
  const c = (a.pilots ?? []).slice().sort((x, y) => x.jumps - y.jumps)[0];
  return c ? c.jumps : a.jumps;
}

export function Overlay() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  /** Renglón que el jugador ha abierto a mano. `null` = manda el criterio automático (el más
   *  cercano). Se limpia solo cuando ese aviso caduca. */
  const [abiertoManual, setAbiertoManual] = useState<string | null>(null);
  /** Reloj de 1 s: refresca las edades y retira lo caducado. */
  const [, tick] = useState(0);
  const stackRef = useRef<HTMLDivElement>(null);

  // El idioma no viaja entre ventanas: esta webview es un proceso aparte y no ve el estado de App.
  // Se lee del mismo localStorage (compartido por origen) para que el aviso hable como la app.
  useEffect(() => {
    setLang((localStorage.getItem("koru-lang") as Lang) || "es");
  }, []);

  const quitar = useCallback((key: string) => {
    setAvisos((prev) => prev.filter((a) => a.key !== key));
    setAbiertoManual((k) => (k === key ? null : k));
  }, []);

  useEffect(() => {
    const un = listen<IntelAlert>("intel-alert", (e) => {
      const v = vidaMs();
      const p = e.payload;
      // Clave estable: sistema + marca de tiempo. Es la misma que usa Rust para no repetir avisos,
      // así que si por lo que sea llega dos veces, aquí tampoco se duplica.
      const key = `${p.sys_id}-${p.ts_ms}`;
      setAvisos((prev) => {
        if (prev.some((a) => a.key === key)) return prev;
        const nuevo: Aviso = { ...p, key, expira: v > 0 ? Date.now() + v : Infinity };
        // El más NUEVO arriba, y el tope recorta por abajo: cuando hay avalancha, lo que se pierde
        // es lo más viejo, nunca lo que acaba de cantarse.
        return [nuevo, ...prev].slice(0, TOPE);
      });
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Un ÚNICO reloj para toda la pila: refresca las edades y retira lo caducado. Un timer por aviso
  // sería más "limpio" en apariencia y una fuente de fugas: al recortar por el tope, los timers de
  // los descartados quedarían sueltos.
  //
  // ⚠️ SOLO CORRE SI HAY ALGO EN PANTALLA. Antes latía siempre, y eso es un despertar por segundo
  // para toda la vida del proceso en una ventana que el 99% del tiempo está vacía: impide que el
  // sistema deje la app en reposo y se nota en el portátil. Sin avisos no hay nada que refrescar.
  useEffect(() => {
    if (avisos.length === 0) return;
    const i = window.setInterval(() => {
      tick((n) => n + 1);
      setAvisos((prev) => {
        const vivos = prev.filter((a) => a.expira > Date.now());
        return vivos.length === prev.length ? prev : vivos;
      });
    }, 1000);
    return () => window.clearInterval(i);
  }, [avisos.length === 0]);

  // Ajustar la VENTANA al contenido. Es lo que evita que quede una zona invisible pero sólida
  // encima del juego: una ventana transparente sigue capturando los clics del ratón a nivel de
  // sistema, así que el hueco vacío se comería pulsaciones destinadas a EVE.
  //
  // Se MIDE el alto real en vez de calcularlo: con textos de largo variable y escalados de pantalla
  // distintos, cualquier fórmula acaba desajustada.
  const ajustar = useCallback(() => {
    const h = Math.ceil(stackRef.current?.getBoundingClientRect().height ?? 0);
    if (h <= 0) return;
    void invoke("overlay_fit", {
      height: h,
      monitor: Number(localStorage.getItem("koru-overlay-mon") ?? 0),
      corner: localStorage.getItem("koru-overlay-corner") ?? "tr",
      margin: Number(localStorage.getItem("koru-overlay-margin") ?? 24),
    }).catch(() => {});
  }, []);

  useLayoutEffect(() => {
    if (avisos.length === 0) {
      void invoke("overlay_hide").catch(() => {});
      return;
    }
    ajustar();
  }, [avisos, ajustar]);

  // ⚠️ Y ADEMÁS un observador de tamaño, porque medir UNA vez no basta: la fuente puede acabar de
  // cargar, un icono de nave puede llegar tarde y el texto puede recolocarse después del primer
  // paint. Con una sola medida, la última tarjeta de la pila salía CORTADA — pasó en vivo. Esto
  // reajusta la ventana cada vez que el contenido cambie de alto, venga de donde venga.
  useEffect(() => {
    const el = stackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => ajustar());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ajustar]);

  // Sin avisos NO se devuelve `null`, y es a propósito. Un `null` en una ventana sin bordes pinta un
  // rectángulo vacío, y un rectángulo vacío es ambiguo: puede significar «React no montó» o «montó
  // pero no llegó el evento». Con este cartel, ver el texto ya demuestra que el componente vive.
  if (avisos.length === 0) {
    return (
      <div className="ov-stack" ref={stackRef}>
        <div className="ov ov-idle">
          <div className="ov-bar" />
          <div className="ov-body">
            <span className="ov-idle-tx">Koru · {tr("esperando avisos")}</span>
          </div>
        </div>
      </div>
    );
  }

  // La ABIERTA: la que el jugador haya elegido, o si no la más CERCANA (menos saltos a un piloto
  // tuyo). No la más reciente: un hostil a 9 saltos no puede tapar a uno a 2 solo por llegar
  // después. Los renglones van por cercanía también, así el peligro sube solo.
  const orden = [...avisos].sort((x, y) => saltosDe(x) - saltosDe(y) || y.ts_ms - x.ts_ms);
  const abierta = orden.find((a) => a.key === abiertoManual) ?? orden[0];
  const resto = orden.filter((a) => a.key !== abierta.key);

  const tarjeta = (a: Aviso) => {
    const cerca = (a.pilots ?? []).slice().sort((x, y) => x.jumps - y.jumps)[0];
    const saltos = saltosDe(a);
    const nivel = saltos <= 0 ? "aqui" : saltos <= 2 ? "cerca" : "lejos";
    const restante = a.expira - Date.now();
    // Quién viene: el primer hostil citado, su nave y cuántos son. Si el chat no dio nombre, la
    // tarjeta lo dice en vez de fingir que sabe algo.
    const hostil = a.parse?.hostiles?.[0] ?? null;
    const nave = a.parse?.ships?.[0] ?? null;
    const cuantos = a.parse?.count ?? a.parse?.hostiles?.length ?? 1;
    return (
      <div
        key={a.key}
        className={`ov ov-${nivel}`}
        onClick={() => {
          // OJO: `overlay_open_main` pide los CINCO campos del aviso, no solo el sistema — con
          // ellos reconstruye la ficha de detalle en el mapa. Mandando solo `sysId`, Tauri
          // rechazaba la llamada por argumentos inválidos y el `.catch` se comía el error: el
          // clic no hacía absolutamente nada y no había ni un fallo que mirar.
          // Por eso este catch AVISA por consola en vez de callar.
          void invoke("overlay_open_main", {
            sysId: a.sys_id,
            system: a.system,
            tsMs: a.ts_ms,
            author: a.author,
            message: a.message,
          }).catch((e) => console.error("overlay_open_main:", e));
          quitar(a.key);
        }}
        title={tr("Abrir Koru en el mapa")}
      >
        <div className="ov-bar" />
        <div className="ov-body">
          <div className="ov-top">
            <span className="ov-sys">{a.system}</span>
            <span className="ov-jumps">
              {saltos <= 0 ? tr("EN TU SISTEMA") : `${saltos} ${saltos === 1 ? tr("salto") : tr("saltos")}`}
            </span>
            {/* DE QUIÉN son esos saltos, pegado al número. Antes iba en una línea propia abajo, y
                era la que menos peso tenía de las tres: aquí ocupa cero y se lee mejor, porque el
                número y el nombre van juntos. Mi nave se queda en el tooltip — ya me la sé. */}
            {cerca && (
              <span className="ov-de" title={cerca.ship ? `${cerca.name} · ${cerca.ship}` : cerca.name}>
                {tr("de")} {cerca.name}
              </span>
            )}
            <button
              className="ov-x"
              title={tr("Descartar")}
              onClick={(e) => {
                e.stopPropagation();
                quitar(a.key);
              }}
            >
              ✕
            </button>
          </div>

          {/* EL PROTAGONISTA: quién viene y en qué. Va antes y con más peso que mi propio piloto —
              lo que decide si huyes o peleas es SU nave, no la tuya, que ya te la sabes. */}
          <div className="ov-hostil">
            {hostil?.character_id != null ? (
              <img
                className="ov-cara"
                src={`https://images.evetech.net/characters/${hostil.character_id}/portrait?size=64`}
                alt=""
                loading="lazy"
              />
            ) : (
              <span className="ov-cara ov-cara-x">?</span>
            )}
            <span className="ov-hnombre">{hostil?.name ?? tr("hostil sin identificar")}</span>
            {nave && (
              <span className="ov-hnave">
                <img className="ov-hnave-ic" src={typeIcon(nave.type_id, 32)} alt="" loading="lazy" />
                {nave.name}
              </span>
            )}
            {cuantos > 1 && (
              <span className="ov-cuantos" title={tr("Posible flota")}>
                ×{cuantos}
              </span>
            )}
            {/* La EDAD es lo que permite que un aviso dure mucho —o para siempre— sin mentir. */}
            <span className="ov-age">{edad(a.ts_ms)}</span>
          </div>
        </div>

        {Number.isFinite(a.expira) && (
          <div
            className="ov-life"
            style={{ animationDuration: `${vidaMs()}ms`, animationDelay: `-${vidaMs() - restante}ms` }}
          />
        )}
      </div>
    );
  };

  /** Renglón de una línea: sistema, saltos y quién. Cuesta ~22 px en vez de ~80, y sigue diciendo
   *  lo esencial — que es lo que permite darse cuenta de que se están encendiendo tres sistemas a
   *  tu alrededor sin tener que abrir nada. */
  const renglon = (a: Aviso) => {
    const saltos = saltosDe(a);
    const nivel = saltos <= 0 ? "aqui" : saltos <= 2 ? "cerca" : "lejos";
    const quien = a.parse?.hostiles?.[0]?.name ?? a.author;
    return (
      <div
        key={a.key}
        className={`ovr ovr-${nivel}`}
        onClick={() => setAbiertoManual(a.key)}
        title={tr("Ver este aviso")}
      >
        <i className="ovr-dot" />
        <span className="ovr-sys">{a.system}</span>
        <span className="ovr-j">{saltos <= 0 ? "0" : saltos}</span>
        <span className="ovr-quien">{quien}</span>
        <span className="ovr-age">{edad(a.ts_ms)}</span>
        <button
          className="ov-x"
          title={tr("Descartar")}
          onClick={(e) => {
            e.stopPropagation();
            quitar(a.key);
          }}
        >
          ✕
        </button>
      </div>
    );
  };

  return (
    <div className="ov-stack" ref={stackRef}>
      {tarjeta(abierta)}
      {resto.map(renglon)}
    </div>
  );
}
