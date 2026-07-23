// Sección EXPLORACIÓN: tus firmas del escáner de sondas por sistema, agrupadas por combate, minado,
// exploración y wormholes. Vive aquí (sección propia) y NO en Ajustes —donde sí se queda Ansiblex,
// que es casi configuración fija— porque las firmas CAMBIAN cada día: enterrarlas en ajustes era
// poco intuitivo. RoGiz7, 2026-07-23.
//
// El grueso (pegar → revisar → confirmar + anotar + agrupar) vive en `SignaturesControl`, que se
// reutiliza tal cual: aquí solo se le pone el marco de sección y, si el personaje activo tiene
// ubicación conocida, se le pasa como sistema por defecto para no tener que buscarlo a mano.
import { SignaturesControl } from "./signaturesControl";
import { tr } from "./i18n";

type Props = {
  /** Sistema donde está el personaje ahora, si se conoce: sistema por defecto del pegado. */
  hereSystemId?: number | null;
  hereSystemName?: string | null;
};

export function ExplorationView({ hereSystemId, hereSystemName }: Props) {
  return (
    <div className="exploration-view">
      <p className="muted small explo-intro">
        {tr(
          "Selecciona las firmas en el escáner de sondas del juego (Ctrl+A), cópialas y pégalas aquí. El sistema lo pones tú: el pegado no lo trae. Anota el destino de un wormhole y se convierte en atajo de ruta en el mapa."
        )}
      </p>
      <SignaturesControl initialSystemId={hereSystemId} initialSystemName={hereSystemName} />
    </div>
  );
}
