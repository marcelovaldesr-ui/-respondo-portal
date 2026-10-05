"use client";

import { useState, useTransition } from "react";
import { conectarConTokenSistema } from "@/app/(marketing)/marketing/integraciones/acciones";

/**
 * Pegar el token de usuario del sistema (solo tenant Respondo). El campo es de
 * tipo contraseña, se limpia al guardar y el token nunca vuelve al navegador.
 */
export default function FormTokenSistema() {
  const [pendiente, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  return (
    <form
      className="mt-3 space-y-2"
      action={(fd) =>
        iniciar(async () => {
          const r = await conectarConTokenSistema(fd);
          setOk(r.ok);
          setMensaje(r.ok ? "Cuenta conectada." : (r.motivo ?? "No se pudo conectar."));
        })
      }
    >
      <div style={{ fontSize: "var(--t-menor)", fontWeight: 600 }}>Cuenta propia de Respondo</div>
      <p style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
        Meta no deja conectar con el botón las cuentas del portafolio dueño de la app. Pega aquí el token del
        usuario del sistema «Respondo Portal Lectura». Se guarda cifrado y no se vuelve a mostrar.
      </p>
      <input name="token" type="password" autoComplete="off" required className="campo w-full" placeholder="Token de usuario del sistema" />
      <button type="submit" className="btn-primario" disabled={pendiente}>
        {pendiente ? "Verificando con Meta…" : "Conectar con token"}
      </button>
      {mensaje && (
        <p style={{ fontSize: "var(--t-micro)", color: ok ? "var(--ok)" : "var(--alerta)" }}>{mensaje}</p>
      )}
    </form>
  );
}
