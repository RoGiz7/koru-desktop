// Selector de tema visual con los ESCUDOS DE FACCIÓN de verdad.
//
// POR QUÉ EXISTE Y NO ES UN `<select>`: petición de RoGiz7 (2026-08-11) — *«poner logos de cada raza
// propiamente»*. **Un `<select>` nativo no admite `<img>`**, así que con el desplegable del sistema
// los escudos eran imposibles; ahí solo cabía un emoji. Es el mismo límite que ya estaba anotado
// para los `<select>` en la regla de iconografía de la casa.
//
// Los escudos salen del Image Server por el ID de facción, la misma vía sancionada que usa el resto
// de la app (`images.evetech.net/corporations/{id}/logo`), **verificada en vivo** el 2026-07-24.
// Con `onError` que cae al emoji: si el servidor no responde, se ve un icono, no un hueco roto.
//
// ⚠️ Nebulosa, Ambiente y Abismo NO son facciones y no tienen escudo — se quedan con su emoji, y no
// se fuerza un logo donde no lo hay.
import { useEffect, useRef, useState } from "react";
import { tr } from "./i18n";

/** ID de facción en el Image Server. Verificados: 500001 Caldari · 500002 Minmatar ·
 *  500003 Amarr · 500004 Gallente. */
type Tema = {
  key: string;
  label: string;
  emoji: string;
  faction?: number;
  /** Imagen propia (no de facción). El tema de Koru usa el icono de la app. */
  img?: string;
  grupo?: string;
};

const TEMAS: Tema[] = [
  // EL DE KORU: el único que no es de nadie más, porque **se pinta con TUS datos** — cambia de color
  // según la seguridad del sistema donde esté tu personaje. Va primero por eso: los demás son de
  // facciones de EVE, este es de la app. (Antes se llamaba «Ambiente (donde estás)».)
  { key: "ambiente", label: "Koru (según dónde estés)", emoji: "📍", img: "/koru-icon.svg" },
  { key: "amarr", label: "Amarr", emoji: "👑", faction: 500003 },
  { key: "caldari", label: "Caldari", emoji: "❄️", faction: 500001 },
  { key: "gallente", label: "Gallente", emoji: "🌿", faction: 500004 },
  { key: "minmatar", label: "Minmatar", emoji: "🔥", faction: 500002 },
  // EDENCOM y Triglaviano, juntos y en este orden a propósito: son **las dos caras del mismo
  // conflicto**, y leerlos seguidos lo cuenta sin escribir una línea de ayuda.
  // «Nebulosa» era un nombre sin dueño y unos azules genéricos de app; ahora es EDENCOM (500027)
  // con los MISMOS colores —el azul ya era el suyo— pero con escudo y con un porqué.
  { key: "nebula", label: "EDENCOM", emoji: "🛡️", faction: 500027 },
  // Y «Abismo» pasa a ser el Colectivo Triglaviano (500026), que es de quien ES el abismo: el morado
  // no venía de ningún sitio, el rojo sobre negro sí.
  { key: "abismo", label: "Triglaviano", emoji: "🌀", faction: 500026 },
  // Las cinco PIRATAS, con sus colores del SDE igual que las armadas. Van en su propio grupo: con
  // doce temas, una lista plana deja de leerse de un vistazo.
  { key: "guristas", label: "Guristas", emoji: "☠️", faction: 500010, grupo: "Piratas" },
  { key: "angel", label: "Angel Cartel", emoji: "☠️", faction: 500011, grupo: "Piratas" },
  { key: "blood", label: "Blood Raiders", emoji: "☠️", faction: 500012, grupo: "Piratas" },
  { key: "sansha", label: "Sansha", emoji: "☠️", faction: 500019, grupo: "Piratas" },
  { key: "serpentis", label: "Serpentis", emoji: "☠️", faction: 500020, grupo: "Piratas" },
];

/** En el BOTÓN va el nombre corto: «Koru (según dónde estés)» es útil dentro de la lista, donde hay
 *  sitio para explicarse, pero en la barra superior ocuparía media pantalla. */
function nombreCorto(t: Tema): string {
  const l = tr(t.label);
  const i = l.indexOf(" (");
  return i > 0 ? l.slice(0, i) : l;
}

/** El icono del tema: el de la app si es el de Koru, el escudo de la facción si no, y el emoji
 *  de reserva si la imagen no carga. */
function Escudo({ t, size = 18 }: { t: Tema; size?: number }) {
  const [roto, setRoto] = useState(false);
  const src = t.img ?? (t.faction ? `https://images.evetech.net/corporations/${t.faction}/logo?size=32` : null);
  if (!src || roto) return <span className="th-emoji">{t.emoji}</span>;
  return (
    <img
      className="th-logo"
      src={src}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      onError={() => setRoto(true)}
    />
  );
}

export function ThemePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (k: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const actual = TEMAS.find((t) => t.key === value) ?? TEMAS[0];

  // Cerrar al pinchar fuera y con Escape. Sin esto, un desplegable propio se queda abierto para
  // siempre — es lo primero que se echa de menos al dejar el `<select>` nativo.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierto]);

  return (
    <div className="th-wrap" ref={caja}>
      <button
        className="th-btn"
        onClick={() => setAbierto((v) => !v)}
        title={tr("Tema visual")}
        aria-haspopup="listbox"
        aria-expanded={abierto}
      >
        <Escudo t={actual} />
        {/* El nombre del tema solo dice «Amarr» o «Guristas», y eso no cuenta que sea un selector
            de ASPECTO: sin la etiqueta parecía un filtro de facción. Idea de RoGiz7. */}
        <span className="th-lbl">{nombreCorto(actual)}</span>
        <span className="th-tag">{tr("Tema")}</span>
        <span className="th-caret">▾</span>
      </button>
      {abierto && (
        <div className="th-menu" role="listbox">
          {TEMAS.map((t, i) => (
            <div key={t.key}>
              {/* Cabecera al empezar un grupo nuevo. Sin esto, doce entradas seguidas son una
                  pared: los imperios y las piratas se leen igual y hay que buscarlas de una en una. */}
              {t.grupo && TEMAS[i - 1]?.grupo !== t.grupo && (
                <div className="th-grupo">{tr(t.grupo)}</div>
              )}
              <button
                className={`th-item${t.key === value ? " on" : ""}`}
                role="option"
                aria-selected={t.key === value}
                onClick={() => {
                  onChange(t.key);
                  setAbierto(false);
                }}
              >
                <Escudo t={t} />
                <span>{tr(t.label)}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
