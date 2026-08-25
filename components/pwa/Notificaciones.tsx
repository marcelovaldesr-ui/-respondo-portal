"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * REGISTRO DEL SERVICE WORKER Y ALTA DE NOTIFICACIONES.
 *
 * Este componente hace dos cosas: registra el service worker (lo que permite
 * instalar el portal y recibir avisos) y ofrece activar las notificaciones.
 *
 * REGLAS DE TRATO QUE NO SON DECORACIÓN
 * -------------------------------------
 *  1. **NUNCA se pide el permiso solo.** Un navegador que muestra el cartel de
 *     permisos apenas entras recibe un "Bloquear" reflejo, y ese bloqueo es
 *     **permanente**: no se puede volver a preguntar nunca más desde el código.
 *     La persona tendría que ir a la configuración del navegador a mano. Por eso
 *     el permiso se pide SOLO después de que alguien apretó un botón.
 *  2. **Si ya lo bloqueó, no se insiste.** Se explica cómo revertirlo y punto.
 *  3. **En iPhone hay que instalar primero.** Apple no entrega notificaciones a
 *     una pestaña de Safari: solo a la app agregada a la pantalla de inicio. Si
 *     detectamos ese caso, se dice qué hacer en vez de ofrecer un botón que no
 *     va a funcionar.
 */

type Estado = "cargando" | "no_soportado" | "ios_sin_instalar" | "apagado" | "encendido" | "bloqueado";

/** La llave pública VAPID viaja al navegador; es pública por diseño. */
const LLAVE = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** El navegador espera la llave como bytes, no como texto base64url. */
function llaveABytes(base64url: string): Uint8Array {
  const relleno = "=".repeat((4 - (base64url.length % 4)) % 4);
  const b64 = (base64url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = atob(b64);
  const out = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i++) out[i] = crudo.charCodeAt(i);
  return out;
}

/** ¿Está corriendo como app instalada y no como pestaña? */
function instalada(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari en iOS usa esta propiedad propia en vez del display-mode.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function esIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export default function Notificaciones() {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    let vivo = true;

    (async () => {
      if (!("serviceWorker" in navigator) || !LLAVE) {
        if (vivo) setEstado("no_soportado");
        return;
      }

      // Registrar SIEMPRE, aunque no se activen las notificaciones: es lo que
      // habilita instalar la app y la pantalla de sin conexión.
      let reg: ServiceWorkerRegistration;
      try {
        reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch {
        if (vivo) setEstado("no_soportado");
        return;
      }

      if (!("PushManager" in window) || !("Notification" in window)) {
        // iPhone sin instalar: el soporte aparece recién al agregarla al inicio.
        if (vivo) setEstado(esIOS() && !instalada() ? "ios_sin_instalar" : "no_soportado");
        return;
      }
      if (esIOS() && !instalada()) {
        if (vivo) setEstado("ios_sin_instalar");
        return;
      }
      if (Notification.permission === "denied") {
        if (vivo) setEstado("bloqueado");
        return;
      }

      const sus = await reg.pushManager.getSubscription();
      if (vivo) setEstado(sus ? "encendido" : "apagado");
    })();

    return () => {
      vivo = false;
    };
  }, []);

  const encender = useCallback(async () => {
    setTrabajando(true);
    try {
      // El permiso se pide ACÁ, dentro del clic. Pedirlo al cargar la página es
      // cómo se consigue un bloqueo permanente.
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado(permiso === "denied" ? "bloqueado" : "apagado");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sus = await reg.pushManager.subscribe({
        // Obligatorio en Chrome: no se aceptan suscripciones silenciosas.
        userVisibleOnly: true,
        applicationServerKey: llaveABytes(LLAVE) as unknown as BufferSource,
      });

      const r = await fetch("/api/push/suscribir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sus.toJSON()),
      });
      if (!r.ok) {
        // Si el servidor no la aceptó, no dejar al navegador creyendo que sí:
        // quedaría "activado" sin que llegue nunca nada.
        await sus.unsubscribe().catch(() => undefined);
        setEstado("apagado");
        return;
      }
      setEstado("encendido");
    } catch {
      setEstado("apagado");
    } finally {
      setTrabajando(false);
    }
  }, []);

  const apagar = useCallback(async () => {
    setTrabajando(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sus = await reg.pushManager.getSubscription();
      if (sus) {
        await fetch(`/api/push/suscribir?endpoint=${encodeURIComponent(sus.endpoint)}`, {
          method: "DELETE",
        }).catch(() => undefined);
        await sus.unsubscribe().catch(() => undefined);
      }
      setEstado("apagado");
    } finally {
      setTrabajando(false);
    }
  }, []);

  if (estado === "cargando" || estado === "no_soportado") return null;

  const marco =
    "flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-[13px]";

  if (estado === "ios_sin_instalar") {
    return (
      <div className={marco} style={{ background: "#F6F7FB", border: "1px solid var(--borde)" }}>
        <span style={{ color: "var(--muted)" }}>
          📲 Para recibir avisos en tu iPhone: toca <strong>Compartir</strong> y luego{" "}
          <strong>Agregar a pantalla de inicio</strong>. Después ábrela desde el ícono.
        </span>
      </div>
    );
  }

  if (estado === "bloqueado") {
    return (
      <div className={marco} style={{ background: "#F6F7FB", border: "1px solid var(--borde)" }}>
        <span style={{ color: "var(--muted)" }}>
          🔕 Bloqueaste los avisos para este sitio. Para reactivarlos hay que permitirlos en la
          configuración del navegador — desde acá ya no se puede volver a preguntar.
        </span>
      </div>
    );
  }

  const encendido = estado === "encendido";
  return (
    <div
      className={marco}
      style={{
        background: encendido ? "#EEF2FF" : "#F6F7FB",
        border: `1px solid ${encendido ? "#C7D2FE" : "var(--borde)"}`,
      }}
    >
      <span style={{ color: encendido ? "#3730A3" : "var(--muted)" }}>
        {encendido
          ? "🔔 Te avisamos en este dispositivo cuando un cliente necesite a una persona."
          : "🔔 Activa los avisos y te llega una notificación cuando un cliente te necesite."}
      </span>
      <button
        onClick={encendido ? apagar : encender}
        disabled={trabajando}
        className={(encendido ? "btn-suave" : "btn-primario") + " shrink-0 px-3 py-1.5 text-[12.5px] disabled:opacity-50"}
      >
        {trabajando ? "…" : encendido ? "Desactivar" : "Activar avisos"}
      </button>
    </div>
  );
}
