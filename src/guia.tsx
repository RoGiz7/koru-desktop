// GUÍA DE INICIO — lo que alguien necesita saber ANTES de preguntarle a nadie.
//
// ★ QUÉ ES Y QUÉ NO ES. No es un tour ni un manual: es lo previo a una wiki. Contesta **qué hay,
//   dónde está y para qué sirve**, para que nadie tenga que volverse loco ni abrir un hilo por
//   algo que se resuelve en un clic. Idea de RoGiz7 (2026-09-01).
//
// ★★ LAS TRES REGLAS QUE LA MANTIENEN ÚTIL. Si se rompen, esto se convierte en documentación
//    dentro de la aplicación y deja de leerla exactamente la persona para la que se hizo:
//
//    1. UNA ENTRADA SOLO EXISTE SI TERMINA EN UN BOTÓN. «Ajustes → Intel» es una instrucción:
//       obliga a leer, recordar y navegar. Un botón que abre ese panel ya lo ha resuelto. Lo que
//       no tenga a dónde llevar, no entra — así se quedó fuera el modo gráfico compatible, que se
//       aplica solo y no tiene pantalla que abrir.
//    2. UNA LÍNEA POR ENTRADA. Si necesita un párrafo, es una página de wiki disfrazada.
//    3. SEIS COMO MUCHO EN «QUÉ PUEDES HACER». Si todo está destacado, no hay nada destacado.
//
// ★ Las entradas de «Si algo no va» NO son inventadas: cada una es una incidencia que ya le pasó
//   a alguien de verdad (los testers de Linux, el despiste de la carpeta, el permiso de Flotas).
//
// ⚠️ Y lo que aquí NO se hace: prometer lo que otros no pueden. Se describe lo que Koru hace. Es
//   la regla que salió de que un CSM nos corrigiera en público una frase sobre el juego.
import { useState } from "react";
import { tr } from "./i18n";
import type { MapOverlay, Tab } from "./constants";

export type AjustesTab = "inicio" | "copias" | "logs" | "mapa" | "medallas" | "intel";

type Props = {
  /** Lleva a una sección, y opcionalmente deja puesta una capa del mapa. */
  onIr: (tab: Tab, overlay?: MapOverlay) => void;
  /** Abre el panel de Ajustes por una pestaña concreta. */
  onAjustes: (t: AjustesTab) => void;
  /** Abre la ficha de un piloto. */
  onFicha: (name: string, id: number) => void;
  /** Despliega «＋ Conceder acceso» de la barra superior. */
  onConcederAcceso: () => void;
  /** Lanza el login de EVE (el MISMO de la barra, no una copia). */
  onLogin: () => void;
  busy: boolean;
  /** Un personaje cualquiera, para que la ficha se pueda enseñar con datos de verdad. */
  primero: { name: string; character_id: number } | null;
  /** `null` cuando se ve por ser el primer arranque: entonces no se puede cerrar. */
  onCerrar: (() => void) | null;
};

/** Una entrada: título, una línea, y el botón que la resuelve. */
function Fila({
  ic,
  titulo,
  linea,
  accion,
  onClick,
  disabled,
}: {
  ic: string;
  titulo: string;
  linea: string;
  accion: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="guia-fila">
      <span className="guia-ic">{ic}</span>
      <div className="guia-tx">
        <strong>{titulo}</strong>
        <span className="muted small">{linea}</span>
      </div>
      <button className="guia-btn" onClick={onClick} disabled={disabled}>
        {accion} ▸
      </button>
    </div>
  );
}

export function GuiaInicio({
  onIr,
  onAjustes,
  onFicha,
  onConcederAcceso,
  onLogin,
  busy,
  primero,
  onCerrar,
}: Props) {
  // ★ EL VALOR POR DEFECTO ES LA DECISIÓN, no las pestañas. Separar en pestañas gana sitio pero
  // esconde dos tercios, y esto se hace justo para quien no lee. Se compensa abriendo por donde
  // toca según la situación:
  //   · sin personajes (primer arranque) → «Empieza aquí»: es lo ÚNICO que importa sin nada;
  //   · con personajes (abierta desde Ajustes) → «Qué puedes hacer»: no vienes a configurar,
  //     vienes a curiosear, y la configuración ya la hiciste.
  // «Si algo no va» no necesita ayuda para encontrarse: quien está atascado busca esas palabras.
  const [bloque, setBloque] = useState<"empezar" | "hacer" | "problemas">(
    primero ? "hacer" : "empezar",
  );
  return (
    <div className="bienvenida">
      <div className="bienv-cab">
        <h3>{tr("Bienvenido a Koru")}</h3>
        {/* El aspa solo cuando la has pedido tú. En el primer arranque NO se puede cerrar:
            cerrarla dejaría la aplicación vacía y sin una sola pista, que es el problema que
            esto viene a resolver. */}
        {onCerrar && (
          <button className="bienv-cerrar" onClick={onCerrar} title={tr("Cerrar la guía")}>
            ×
          </button>
        )}
      </div>

      <div className="guia-tabs" role="tablist">
        {(
          [
            { k: "empezar", ic: "🚀", label: tr("Empieza aquí") },
            { k: "hacer", ic: "✨", label: tr("Qué puedes hacer") },
            { k: "problemas", ic: "🛟", label: tr("Si algo no va") },
          ] as const
        ).map((t) => (
          <button
            key={t.k}
            role="tab"
            className={`guia-tab${bloque === t.k ? " active" : ""}`}
            onClick={() => setBloque(t.k)}
          >
            {t.ic} {t.label}
          </button>
        ))}
      </div>

      {/* ---- 1. EMPIEZA AQUÍ — qué necesita Koru, y POR QUÉ ---- */}
      {bloque === "empezar" && (
      <div className="guia-bloque">
        <Fila
          ic="1"
          titulo={tr("Conecta tu personaje de EVE")}
          linea={tr(
            "Koru pide acceso de SOLO LECTURA a tu personaje. Es lo que llena el mapa, tus assets, la industria y tu histórico de combate. Nunca puede actuar por ti.",
          )}
          accion={busy ? tr("Esperando login…") : tr("Iniciar sesión")}
          onClick={onLogin}
          disabled={busy}
        />
        <Fila
          ic="2"
          titulo={tr("Dile dónde guarda EVE sus registros")}
          linea={tr(
            "El intel del chat, tus conversaciones privadas y las runs abisales salen de ficheros que EVE ya escribe en tu disco. Sin esa carpeta, esas tres secciones se quedan vacías.",
          )}
          accion={tr("Elegir carpeta")}
          onClick={() => onAjustes("logs")}
        />
      </div>
      )}

      {/* ---- 2. QUÉ PUEDES HACER — seis, ni una más (regla 3) ---- */}
      {bloque === "hacer" && (
      <div className="guia-bloque">
        <Fila
          ic="🚨"
          titulo={tr("El intel del chat, pintado en el mapa")}
          linea={tr(
            "Lo que se canta en tus canales aparece en el sistema donde se dijo y a su hora: ves de dónde viene el peligro y decides si esquivas o si vas a cazar.",
          )}
          accion={tr("Abrir el mapa")}
          onClick={() => onIr("mapa", "intel")}
        />
        <Fila
          ic="🛰"
          titulo={tr("Vuelve a ver la op que mandaste")}
          linea={tr(
            "Graba la flota mientras la comandas y después la reproduces sobre el mapa: quién entró, quién saltó, quién cayó y qué se cantó por el camino.",
          )}
          accion={tr("Ir a Flotas")}
          onClick={() => onIr("flotas")}
        />
        <Fila
          ic="💬"
          titulo={tr("Tus conversaciones privadas, cosidas")}
          linea={tr(
            "EVE parte cada chat privado en cientos de ficheros de sesión. Koru los junta y te devuelve el historial completo, agrupado por persona.",
          )}
          accion={tr("Ir a Social")}
          onClick={() => onIr("social")}
        />
        <Fila
          ic="🧭"
          titulo={tr("Rutas con tus Ansiblex")}
          linea={tr(
            "El planificador usa la red de puentes que tú declaras, así que la ruta que calcula es la que puedes volar de verdad, no la teórica.",
          )}
          accion={tr("Planificar una ruta")}
          onClick={() => onIr("mapa")}
        />
        <Fila
          ic="📦"
          titulo={tr("Qué tienes y dónde")}
          linea={tr(
            "Todo tu inventario de todos tus personajes en una lista, con lo que vale y en qué estación duerme.",
          )}
          accion={tr("Ver el inventario")}
          onClick={() => onIr("inventario")}
        />
        <Fila
          ic="👤"
          titulo={tr("Quién es esa persona para ti")}
          linea={tr(
            "Pincha el nombre de cualquiera —en una op, en un chat, en tus kills— y sale su ficha: si volasteis juntos, si os matasteis, de qué hablasteis.",
          )}
          accion={tr("Ver una ficha")}
          onClick={() => primero && onFicha(primero.name, primero.character_id)}
          // Sin ningún personaje no hay ficha que enseñar. Se deja visible y apagado a propósito:
          // esconder la fila haría que la guía cambiase de forma según el día.
          disabled={!primero}
        />
      </div>
      )}

      {/* ---- 3. SI ALGO NO VA — solo incidencias que ya han ocurrido ---- */}
      {bloque === "problemas" && (
      <div className="guia-bloque">
        <Fila
          ic="📡"
          titulo={tr("Dice que no encuentra canales de intel")}
          linea={tr(
            "Casi siempre es la carpeta: hay que elegir la de Chatlogs, no la de logs que la contiene. El panel te cuenta qué vio dentro para que lo veas al instante.",
          )}
          accion={tr("Revisar el intel")}
          onClick={() => onAjustes("intel")}
        />
        <Fila
          ic="📁"
          titulo={tr("No sé dónde está esa carpeta")}
          linea={tr(
            "Si juegas por Steam puede estar en otro disco. Koru la busca por ti, incluidas las bibliotecas de Steam fuera del disco principal.",
          )}
          accion={tr("Buscarla")}
          onClick={() => onAjustes("logs")}
        />
        <Fila
          ic="🔑"
          titulo={tr("No puedo grabar una flota")}
          linea={tr(
            "Grabar pide un permiso aparte, y solo lo necesita quien MANDA la flota. Si tu personaje inició sesión antes, hay que volver a entrar concediéndolo.",
          )}
          accion={tr("Conceder acceso")}
          onClick={onConcederAcceso}
        />
        <Fila
          ic="🩺"
          titulo={tr("Algo falla y quiero pedir ayuda")}
          linea={tr(
            "Koru prepara un informe técnico de tu equipo y te lo ENSEÑA antes de copiar nada. No se envía a ningún sitio: lo pegas tú donde quieras.",
          )}
          accion={tr("Ver el diagnóstico")}
          onClick={() => onAjustes("copias")}
        />
      </div>
      )}

      {/* Lo que un piloto de EVE quiere saber en los primeros diez segundos, contestado antes de
          que lo pregunte. Va al final y no arriba: arriba estorba, aquí cierra. */}
      <p className="bienv-privacidad">
        {tr(
          "🔒 Todo se queda en tu ordenador. Koru guarda lo que lee en una base de datos local y no envía tus datos a ningún sitio.",
        )}
      </p>
    </div>
  );
}
