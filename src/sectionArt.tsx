// Fondo de nave insignia por sección (patrón "carta de la Agencia"): render 3D tenue en la esquina
// inferior derecha, con viñeta radial + scrim + brillo (CSS en App.css, .sec-art). Reutilizable en
// cualquier sección ALTA — NO detrás de charts ni tablas densas. Acepta un typeID (render del Image
// Server) o un `src` propio (p.ej. una imagen local, como un interior de estación). RoGiz7, 2026-07-24.
import { typeRender } from "./format";

export function SectionArt({ typeId, src, size = 1024 }: { typeId?: number; src?: string; size?: number }) {
  const url = src ?? (typeId != null ? typeRender(typeId, size) : null);
  if (!url) return null;
  return (
    <div className="sec-art" aria-hidden="true">
      <img src={url} alt="" loading="lazy" />
    </div>
  );
}
