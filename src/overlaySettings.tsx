// Ajustes del overlay de avisos (la ventanita que flota sobre el juego). Ver `overlay.tsx` para
// el porqué de la función y las reglas anti-ruido.
//
// Dos decisiones que están aquí a propósito:
//   · APAGADO DE FÁBRICA. Un aviso flotante que aparece sin que nadie lo haya pedido es motivo de
//     desinstalación. Se enciende a mano, una vez.
//   · LISTA BLANCA, no negra. Hoy solo el intel. Cuando haya más avisos, el jugador AÑADE los que
//     quiera en vez de tener que ir apagando los que le sobran.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { ALERT_SOUNDS, playAlertChoice, beep } from "./sound";
import type { IntelConfig } from "./types";

/** Config del intel que se pone UNA VEZ y no se vuelve a tocar: de dónde se lee, qué canales,
 *  cuánto dura un avistamiento y qué suena. Vivía en el panel de 280 px del mapa, donde no cabía
 *  y competía por sitio con lo que sí se toca volando (umbral de saltos, pilotos, anclas).
 *  Aquí hay ancho de sobra: los canales pasan de un desplegable a una lista que se ve entera. */
export function IntelSettings({ intel }: { intel: IntelConfig }) {
  return (
    <>
      <div className="tb-settings-title small muted">{tr("Lectura de los chats de intel")}</div>

      <div className="tb-settings-item">
        <span className="tb-si-ic">📁</span>
        <span className="tb-si-tx">
          <strong>{tr("Carpeta de logs de EVE")}</strong>
          <span className="small muted">
            {tr("Donde el juego escribe los chats. Sin esto el intel no puede leer nada.")}
          </span>
          <div className="ovs-row">
            <span className={`ovs-path${intel.folder ? "" : " ovs-path-vacio"}`} title={intel.folder}>
              {intel.folder || tr("(sin definir)")}
            </span>
            <button onClick={intel.onPickFolder}>{tr("Elegir…")}</button>
          </div>
        </span>
      </div>

      <div className="tb-settings-item">
        <span className="tb-si-ic">💬</span>
        <span className="tb-si-tx">
          <strong>{tr("Canales que se vigilan")}</strong>
          <span className="small muted">
            {intel.availChannels.length === 0
              ? tr("No se encontraron canales en la carpeta.")
              : `${intel.channels.length} / ${intel.availChannels.length} ${tr("vigilados")}`}
          </span>
          <div className="ovs-chans">
            {intel.availChannels.map((c) => (
              <label key={c} className="ovs-chan">
                <input
                  type="checkbox"
                  checked={intel.channels.includes(c)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...intel.channels, c]
                      : intel.channels.filter((x) => x !== c);
                    intel.onConfig({ channels: next });
                  }}
                />
                {c}
              </label>
            ))}
          </div>
        </span>
      </div>

      <div className="tb-settings-item">
        <span className="tb-si-ic">⏱️</span>
        <span className="tb-si-tx">
          <strong>{tr("Cuánto vive un avistamiento")}</strong>
          <span className="small muted">
            {tr("Recencia: qué se considera «pasando ahora». Rastro: cuánto queda pintado en el mapa.")}
          </span>
          <div className="ovs-row">
            <label className="ovs-num">
              <span className="muted small">{tr("Recencia (min)")}</span>
              <input
                type="number"
                min={1}
                max={180}
                value={intel.recency}
                onChange={(e) => intel.onConfig({ recency: Math.max(1, Number(e.target.value)) })}
              />
            </label>
            <label className="ovs-num">
              <span className="muted small">{tr("Rastro (min)")}</span>
              <input
                type="number"
                min={0}
                max={720}
                value={intel.trailMin}
                title={tr("Antigüedad máxima de un avistamiento en el rastro. 0 = sin límite.")}
                onChange={(e) => intel.onConfig({ trailMin: Math.max(0, Number(e.target.value)) })}
              />
            </label>
          </div>
        </span>
      </div>

      <div className="tb-settings-item">
        <span className="tb-si-ic">🔊</span>
        <span className="tb-si-tx">
          <strong>{tr("Sonido al detectar algo cerca")}</strong>
          <span className="small muted">
            {tr("Suena solo cuando el aviso entra en tu umbral de saltos.")}
          </span>
          <div className="ovs-row">
            <label className="ovs-chk">
              <input
                type="checkbox"
                checked={intel.sound}
                onChange={(e) => {
                  if (e.target.checked) beep(); // gesto del usuario → desbloquea el audio
                  intel.onConfig({ sound: e.target.checked });
                }}
              />
              {tr("Activado")}
            </label>
            <select
              value={intel.soundChoice}
              disabled={!intel.sound}
              onChange={(e) => {
                if (e.target.value === "custom" && !intel.soundFile) {
                  intel.onPickSound();
                } else {
                  intel.onConfig({ soundChoice: e.target.value });
                }
              }}
            >
              {ALERT_SOUNDS.map((s) => (
                <option key={s.key} value={s.key}>
                  {tr(s.label)}
                </option>
              ))}
            </select>
            <button disabled={!intel.sound} onClick={() => playAlertChoice(intel.soundChoice)}>
              {tr("Probar")}
            </button>
          </div>
          {intel.soundChoice === "custom" && (
            <div className="ovs-row">
              <span className="ovs-path" title={intel.soundFile}>
                {intel.soundFile ? intel.soundFile.split(/[\\/]/).pop() : tr("(ningún archivo)")}
              </span>
              <button onClick={intel.onPickSound}>{tr("Elegir…")}</button>
            </div>
          )}
        </span>
      </div>
    </>
  );
}

type OverlayDebug = {
  exists: boolean;
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  on_screen: boolean;
  monitors: MonitorInfo[];
};

type MonitorInfo = {
  index: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  is_primary: boolean;
};

/** Posiciones posibles, en orden de lectura (arriba de izquierda a derecha, luego abajo).
 *  El centro lo pidió RoGiz7: arriba en medio queda sobre una zona del HUD de EVE que casi siempre
 *  está despejada, así que es buen sitio para un aviso. */
const ESQUINAS = [
  { k: "tl", label: "Arriba izquierda" },
  { k: "tc", label: "Arriba centro" },
  { k: "tr", label: "Arriba derecha" },
  { k: "bl", label: "Abajo izquierda" },
  { k: "bc", label: "Abajo centro" },
  { k: "br", label: "Abajo derecha" },
] as const;

export function OverlaySettings() {
  const [on, setOn] = useState(() => localStorage.getItem("koru-overlay") === "1");
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [mon, setMon] = useState(() => Number(localStorage.getItem("koru-overlay-mon") ?? 0));
  const [corner, setCorner] = useState(() => localStorage.getItem("koru-overlay-corner") ?? "tr");
  const [margin, setMargin] = useState(() => Number(localStorage.getItem("koru-overlay-margin") ?? 24));
  const [dbg, setDbg] = useState<OverlayDebug | null>(null);
  const [vida, setVida] = useState(() => Number(localStorage.getItem("koru-overlay-vida") ?? 20));

  useEffect(() => {
    invoke<MonitorInfo[]>("overlay_monitors").then(setMonitors).catch(() => setMonitors([]));
  }, []);

  /** Guarda y aplica de golpe: la posición se ve al instante con el botón de prueba. */
  const aplicar = (m = mon, c = corner, g = margin) => {
    localStorage.setItem("koru-overlay-mon", String(m));
    localStorage.setItem("koru-overlay-corner", c);
    localStorage.setItem("koru-overlay-margin", String(g));
    void invoke("overlay_place", { monitor: m, corner: c, margin: g }).catch(() => {});
  };

  /** Encender CREA la ventana; apagar la DESTRUYE. No basta con esconderla: una webview oculta
   *  cuesta memoria igual, y esta función viene apagada de fábrica. */
  const encender = (v: boolean) =>
    void invoke("overlay_enable", { enabled: v, monitor: mon, corner, margin }).catch(() => {});

  return (
    <>
      <div className="tb-settings-title small muted">{tr("Avisos sobre el juego")}</div>

      <label className="tb-settings-item" style={{ cursor: "pointer" }}>
        <span className="tb-si-ic">🔔</span>
        <span className="tb-si-tx">
          <strong>{tr("Mostrar los avisos flotando sobre el juego")}</strong>
          <span className="small muted">
            {tr(
              "Una ventanita sin bordes en la esquina que elijas. Al pulsarla, Koru se pone delante y abre el mapa en ese sistema.",
            )}
          </span>
        </span>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const v = e.target.checked;
            setOn(v);
            localStorage.setItem("koru-overlay", v ? "1" : "0");
            // localStorage no notifica a nadie dentro de la MISMA ventana (el evento `storage` solo
            // salta entre pestañas). Sin este aviso, el vigilante de Rust seguiría con el valor
            // viejo hasta que cambiara cualquier otra cosa del intel: el interruptor "no haría nada"
            // durante un rato, que es la peor clase de fallo.
            window.dispatchEvent(new Event("koru-overlay-changed"));
            encender(v);
          }}
        />
      </label>

      {on && (
        <>
          {/* Elegir monitor y esquina, en vez de perseguir la ventana de EVE. Con multibox hay
              varios clientes y rastrearlos es frágil: cambian de tamaño, se minimizan, cambian de
              pantalla. Que el jugador señale un hueco libre no se rompe nunca. */}
          <div className="tb-settings-item">
            <span className="tb-si-ic">🖥️</span>
            <span className="tb-si-tx">
              <strong>{tr("Dónde aparece")}</strong>
              <span className="small muted">
                {tr("Elige un hueco que no te tape nada del juego.")}
              </span>
              <div className="ovs-row">
                <select
                  value={mon}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setMon(v);
                    aplicar(v);
                  }}
                >
                  {monitors.length === 0 && <option value={0}>{tr("Monitor principal")}</option>}
                  {monitors.map((m) => (
                    <option key={m.index} value={m.index}>
                      {m.index + 1}. {m.width}×{m.height}
                      {m.is_primary ? ` · ${tr("principal")}` : ""}
                    </option>
                  ))}
                </select>
                <select
                  value={corner}
                  onChange={(e) => {
                    setCorner(e.target.value);
                    aplicar(mon, e.target.value);
                  }}
                >
                  {ESQUINAS.map((c) => (
                    <option key={c.k} value={c.k}>
                      {tr(c.label)}
                    </option>
                  ))}
                </select>
                <label className="small muted ovs-margin">
                  {tr("Margen")}
                  <input
                    type="number"
                    min={0}
                    max={400}
                    value={margin}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setMargin(v);
                      aplicar(mon, corner, v);
                    }}
                  />
                </label>
              </div>
            </span>
          </div>

          {/* Duración. «Hasta cerrarlo» es seguro porque el aviso lleva la EDAD en vivo: un intel
              fijo de hace diez minutos ya no es información, es ruido peligroso, y sin la edad no
              habría forma de notarlo. */}
          <div className="tb-settings-item">
            <span className="tb-si-ic">⏱️</span>
            <span className="tb-si-tx">
              <strong>{tr("Cuánto dura en pantalla")}</strong>
              <span className="small muted">
                {tr("El aviso enseña siempre cuánto tiempo hace que se cantó, así que no engaña por mucho que dure.")}
              </span>
              <div className="ovs-row">
                <select
                  value={vida}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVida(v);
                    localStorage.setItem("koru-overlay-vida", String(v));
                  }}
                >
                  <option value={12}>12 {tr("segundos")}</option>
                  <option value={20}>20 {tr("segundos")}</option>
                  <option value={45}>45 {tr("segundos")}</option>
                  <option value={90}>90 {tr("segundos")}</option>
                  <option value={0}>{tr("Hasta que lo cierre o lo pulse")}</option>
                </select>
              </div>
            </span>
          </div>

          {/* Sin esto, colocar la ventana sería imposible salvo esperando a que aparezca un hostil. */}
          <button
            className="tb-settings-item"
            onClick={() => {
              // Se asegura la ventana ANTES de probar: ahora se crea bajo demanda y su construcción
              // se encola en el hilo principal, así que justo tras encender puede no existir todavía.
              // Sin esto, el primer clic al botón de prueba no haría nada y parecería roto.
              encender(true);
              // Los textos del aviso de prueba se mandan YA TRADUCIDOS: el diccionario vive aquí,
              // en el frontend, y el Rust no tiene forma de saber en qué idioma está la app.
              window.setTimeout(
                () =>
                  void invoke("overlay_test", {
                    mensaje: tr("Aviso de prueba: así se verá el intel sobre el juego."),
                    alt: tr("Alt de prueba"),
                    hostil: tr("Piloto de prueba"),
                  }).catch(() => {}),
                220,
              );
              // La radiografía se pide DESPUÉS de mostrar, para leer el estado real ya visible.
              window.setTimeout(() => {
                invoke<OverlayDebug>("overlay_debug").then(setDbg).catch(() => setDbg(null));
              }, 600);
            }}
          >
            <span className="tb-si-ic">👁️</span>
            <span className="tb-si-tx">
              <strong>{tr("Ver un aviso de prueba")}</strong>
              <span className="small muted">
                {tr("Lanza uno de mentira para colocarlo sin esperar a que salte de verdad.")}
              </span>
            </span>
          </button>

          {/* Radiografía de la ventana. Una ventana transparente y sin bordes que no se ve puede ser
              cuatro cosas distintas —no existe, está fuera de pantalla, está detrás, o existe y no
              pinta— y a ojo las cuatro son idénticas: nada. Esto las separa. */}
          {dbg && (
            <div className="small muted ovs-dbg">
              {!dbg.exists ? (
                <b className="bad">{tr("La ventana del aviso no existe. Es un problema de configuración, no de pintado.")}</b>
              ) : !dbg.on_screen ? (
                <b className="bad">
                  {tr("La ventana existe pero está FUERA de la pantalla")} — {dbg.x},{dbg.y} · {dbg.w}×{dbg.h}
                </b>
              ) : !dbg.visible ? (
                <b className="bad">{tr("La ventana existe y está colocada, pero oculta.")}</b>
              ) : (
                <span>
                  {tr("La ventana está visible y en pantalla")} — {dbg.x},{dbg.y} · {dbg.w}×{dbg.h} ·{" "}
                  {tr("escala")} {dbg.scale}×.{" "}
                  {tr("Si aun así no la ves, el problema es el pintado (transparencia).")}
                </span>
              )}
              <div>
                {dbg.monitors.length} {tr("monitores")}:{" "}
                {dbg.monitors.map((m) => `${m.width}×${m.height} @${m.x},${m.y}`).join(" · ")}
              </div>
            </div>
          )}

          <div className="tb-settings-title small muted" style={{ marginTop: ".6rem" }}>
            {tr("Qué avisos salen aquí")}
          </div>
          <div className="tb-settings-item">
            <span className="tb-si-ic">📡</span>
            <span className="tb-si-tx">
              <strong>{tr("Intel de proximidad")}</strong>
              <span className="small muted">
                {tr(
                  "De momento el único. El criterio: solo sale aquí lo que te haría actuar en los próximos segundos — lo demás (planetología, logros, trabajos) vive en la app, que son cosas de cuando atracas.",
                )}
              </span>
            </span>
          </div>

          <div className="small muted" style={{ padding: "0 .2rem .4rem" }}>
            {tr(
              "Si juegas en pantalla completa exclusiva no se verá: EVE tapa cualquier ventana. Cambia a ventana o ventana sin bordes.",
            )}
          </div>
        </>
      )}
    </>
  );
}
