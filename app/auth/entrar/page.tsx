"use client";

import { useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabaseNavegador";

/**
 * Destino del enlace de acceso (flujo IMPLICIT). Supabase redirige acá con la
 * sesión en el fragmento de la URL (#access_token=...). El cliente del navegador
 * la detecta (detectSessionInUrl), la guarda en cookies y recién ahí entramos al
 * portal con una navegación COMPLETA (window.location) para que el servidor lea
 * la cookie recién escrita.
 *
 * A diferencia del PKCE, esto NO depende del dispositivo donde se pidió el
 * enlace: funciona desde el celular, el navegador del correo, etc.
 */
export default function Entrar() {
  const [estado, setEstado] = useState<"entrando" | "error">("entrando");

  useEffect(() => {
    const supa = supabaseNavegador();
    let hecho = false;

    const ir = () => {
      if (hecho) return;
      hecho = true;
      // Navegación completa: garantiza que la cookie de sesión viaje al servidor.
      window.location.replace("/inicio");
    };

    const { data: sub } = supa.auth.onAuthStateChange((_evento, session) => {
      if (session) ir();
    });

    // Chequeo inmediato por si la sesión ya se procesó al instanciar el cliente.
    supa.auth.getSession().then(({ data }) => {
      if (data.session) ir();
    });

    // Red de seguridad: si en 6s no hubo sesión, mostrar error con salida.
    const t = setTimeout(async () => {
      const { data } = await supa.auth.getSession();
      if (data.session) ir();
      else if (!hecho) {
        hecho = true;
        setEstado("error");
      }
    }, 6000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  return (
    <div
      className="flex min-h-screen items-center justify-center px-6"
      style={{ background: "var(--fondo)" }}
    >
      <div className="text-center">
        {estado === "entrando" ? (
          <>
            <div className="titular text-[19px] font-bold">Entrando a tu portal…</div>
            <p className="mt-2 text-[14.5px]" style={{ color: "var(--muted)" }}>
              Validando tu enlace de acceso, un segundo.
            </p>
          </>
        ) : (
          <>
            <div className="titular text-[19px] font-bold">No pudimos validar el enlace</div>
            <p className="mt-2 text-[14.5px]" style={{ color: "var(--muted)" }}>
              El enlace pudo expirar o ya se usó (son de un solo uso). Pide uno nuevo.
            </p>
            <a
              href="/login?error=enlace-expirado"
              className="mt-4 inline-block text-[14px] font-semibold underline"
              style={{ color: "var(--indigo)" }}
            >
              Volver a pedir un enlace
            </a>
          </>
        )}
      </div>
    </div>
  );
}
