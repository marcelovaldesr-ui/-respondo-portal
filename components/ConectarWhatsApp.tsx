"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Botón "Conectar WhatsApp" — EMBEDDED SIGNUP de Meta (Respondo como Tech
 * Provider directo, sin BSP).
 *
 * Flujo:
 *  1) Carga el SDK de Facebook y FB.init con el App ID de Respon.do.
 *  2) FB.login con el config_id del Embedded Signup (response_type=code).
 *  3) El popup de Meta guía al cliente (crea/elige WABA y número). Con
 *     COEXISTENCIA, el cliente escanea un QR desde su app de WhatsApp Business
 *     y el número queda funcionando en la app Y en la Cloud API a la vez.
 *  4) Meta manda por postMessage (WA_EMBEDDED_SIGNUP) el waba_id y
 *     phone_number_id; FB.login entrega el `code`.
 *  5) Se manda todo a /api/whatsapp/onboarding, que canjea el code por token,
 *     suscribe la app a la WABA y guarda las credenciales del cliente.
 *
 * Env necesarias (públicas): NEXT_PUBLIC_WHATSAPP_APP_ID y
 * NEXT_PUBLIC_WHATSAPP_CONFIG_ID (config del Embedded Signup en la app de Meta).
 */

declare global {
  interface Window {
    FB?: {
      init: (opts: Record<string, unknown>) => void;
      login: (
        cb: (resp: { authResponse?: { code?: string } | null; status?: string }) => void,
        opts: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type Estado =
  | { fase: "listo" }
  | { fase: "cargando" }
  | { fase: "conectando" }
  | { fase: "guardando" }
  | { fase: "ok"; detalle: string }
  | { fase: "error"; detalle: string };

const APP_ID = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID;
const CONFIG_ID = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID;

export default function ConectarWhatsApp() {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  // Datos que llegan por postMessage antes/después del callback de FB.login.
  const sesion = useRef<{ wabaId?: string; phoneNumberId?: string }>({});
  const code = useRef<string | null>(null);

  const intentarGuardar = useCallback(async () => {
    const { wabaId, phoneNumberId } = sesion.current;
    if (!code.current || !wabaId || !phoneNumberId) return; // aún falta una pata
    setEstado({ fase: "guardando" });
    try {
      const r = await fetch("/api/whatsapp/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.current, wabaId, phoneNumberId }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setEstado({ fase: "ok", detalle: "WhatsApp conectado. Tino ya puede atender este número." });
      // Refrescar la página para mostrar el estado conectado del servidor.
      setTimeout(() => window.location.reload(), 1600);
    } catch (e) {
      setEstado({ fase: "error", detalle: (e as Error).message });
    }
  }, []);

  // Escuchar los eventos del popup del Embedded Signup (sessionInfo v3).
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (!ev.origin.endsWith("facebook.com")) return;
      try {
        const data = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA" || data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
          sesion.current = {
            wabaId: data.data?.waba_id ?? sesion.current.wabaId,
            phoneNumberId: data.data?.phone_number_id ?? sesion.current.phoneNumberId,
          };
          void intentarGuardar();
        } else if (data.event === "CANCEL" || data.event === "ERROR") {
          setEstado({
            fase: "error",
            detalle:
              data.data?.error_message ??
              "El proceso se cerró antes de terminar. Puedes intentarlo de nuevo.",
          });
        }
      } catch {
        /* mensajes ajenos: ignorar */
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [intentarGuardar]);

  // Cargar el SDK de Facebook una sola vez.
  useEffect(() => {
    if (!APP_ID || !CONFIG_ID) {
      setEstado({
        fase: "error",
        detalle:
          "Falta configurar NEXT_PUBLIC_WHATSAPP_APP_ID / NEXT_PUBLIC_WHATSAPP_CONFIG_ID.",
      });
      return;
    }
    if (window.FB) {
      setEstado({ fase: "listo" });
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: "v21.0" });
      setEstado({ fase: "listo" });
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/es_LA/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () =>
      setEstado({ fase: "error", detalle: "No se pudo cargar el SDK de Meta (¿bloqueador de anuncios?)." });
    document.body.appendChild(s);
  }, []);

  function conectar() {
    if (!window.FB) return;
    setEstado({ fase: "conectando" });
    window.FB.login(
      (resp) => {
        if (resp.authResponse?.code) {
          code.current = resp.authResponse.code;
          void intentarGuardar();
        } else {
          setEstado({
            fase: "error",
            detalle: "No se completó la autorización en Meta. Intenta de nuevo.",
          });
        }
      },
      {
        config_id: CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          // COEXISTENCIA: permite conectar un número que ya usa la app de
          // WhatsApp Business (QR desde el teléfono) sin perder la app.
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  }

  const ocupado =
    estado.fase === "cargando" || estado.fase === "conectando" || estado.fase === "guardando";

  return (
    <div>
      <button
        type="button"
        onClick={conectar}
        disabled={ocupado || estado.fase === "error" && (!APP_ID || !CONFIG_ID)}
        className="btn-primario px-5 py-2.5 text-[15px] disabled:opacity-60"
      >
        {estado.fase === "conectando"
          ? "Esperando a Meta…"
          : estado.fase === "guardando"
            ? "Guardando conexión…"
            : estado.fase === "cargando"
              ? "Cargando…"
              : "Conectar WhatsApp"}
      </button>

      {estado.fase === "ok" && (
        <p className="mt-3 text-[14px] font-semibold" style={{ color: "#0F7B4D" }}>
          ✓ {estado.detalle}
        </p>
      )}
      {estado.fase === "error" && (
        <p className="mt-3 text-[14px]" style={{ color: "#B4231F" }}>
          {estado.detalle}
        </p>
      )}
    </div>
  );
}
