"use client";

import { useRef, useState } from "react";

/**
 * Campo de solo lectura con botón "Copiar". Se usa para los enlaces que el
 * dueño tiene que pegar en otro lado: la página pública de reservas y el
 * calendario (iCal).
 *
 * Es un componente CLIENTE a propósito: la página /agenda es de servidor y no
 * puede llevar manejadores de eventos directamente.
 *
 * Usa una referencia y NO un id fijo: en la misma pantalla hay más de uno, y
 * con ids repetidos el botón de uno seleccionaba el texto del otro.
 */
export default function CampoCopiar({ valor }: { valor: string }) {
  const campoRef = useRef<HTMLInputElement>(null);
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
    } catch {
      // Navegadores sin permiso de portapapeles (o sin HTTPS): al menos se
      // deja el texto seleccionado para copiar a mano.
      campoRef.current?.select();
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="mt-2 flex gap-2">
      <input
        ref={campoRef}
        readOnly
        value={valor}
        onClick={(e) => e.currentTarget.select()}
        className="campo font-mono text-[12.5px]"
      />
      <button type="button" onClick={copiar} className="btn-suave shrink-0 px-3 py-2 text-[13px]">
        {copiado ? "¡Copiado!" : "Copiar"}
      </button>
    </div>
  );
}
