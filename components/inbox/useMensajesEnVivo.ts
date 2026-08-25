"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EstadoEnvio, MensajeUI } from "./tipos";

/**
 * EL TRANSPORTE EN VIVO DEL INBOX.
 *
 * Encapsula toda la mecánica de "mantener la conversación al día" para que el
 * componente de chat no sepa nada de SSE, sondeos ni reconexiones.
 *
 * ESTRATEGIA, EN ORDEN
 * --------------------
 *  1. **SSE** contra `/api/whatsapp/stream`: el servidor empuja apenas hay algo.
 *     Latencia ~1 s en vez de los 4 s del sondeo anterior.
 *  2. **Sondeo incremental** si SSE falla dos veces seguidas (proxies corporativos
 *     y algunas extensiones lo rompen). Peor, pero nunca deja a nadie sin mensajes.
 *  3. **Pausa total con la pestaña oculta.** Antes el intervalo seguía corriendo
 *     en segundo plano: cada pestaña olvidada abierta seguía pidiendo 200
 *     mensajes cada 4 segundos, para nadie.
 *
 * REGLAS QUE NO SON OBVIAS
 * ------------------------
 *  - **Nunca se reemplaza la lista completa.** Se fusiona por id. Reemplazarla
 *    era lo que hacía re-dibujar toda la conversación y parpadear las imágenes.
 *  - **Los mensajes optimistas sobreviven** hasta que llega su versión real: se
 *    reconocen por un id que empieza con `tmp:`.
 *  - **Los estados de entrega se piden aparte.** Un mensaje ya enviado no vuelve
 *    a aparecer en la consulta incremental —su fecha es vieja— pero su ✓ sí
 *    cambia después. Sin esto los ✓✓ quedarían congelados hasta recargar.
 */

/** Cuánto esperar entre sondeos cuando SSE no está disponible. */
const SONDEO_ACTIVO_MS = 1500;
const SONDEO_REPOSO_MS = 4000;
/** Tras cuántos segundos sin actividad se considera que el chat está en reposo. */
const REPOSO_TRAS_MS = 60_000;

export type EstadoConexion = "vivo" | "sondeando" | "reconectando";

export function useMensajesEnVivo(params: {
  empleadoId: string;
  chatId: string;
  inicial: MensajeUI[];
  modoInicial: string;
}) {
  const { empleadoId, chatId } = params;
  const [mensajes, setMensajes] = useState<MensajeUI[]>(params.inicial);
  const [modo, setModo] = useState(params.modoInicial);
  const [conexion, setConexion] = useState<EstadoConexion>("reconectando");
  const [hayMasHistorial, setHayMasHistorial] = useState(true);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  /** Cursor: fecha del último mensaje conocido. Se lee en callbacks, va en ref. */
  const cursor = useRef<string>(
    params.inicial.length ? params.inicial[params.inicial.length - 1].creadoEn : new Date(0).toISOString(),
  );
  const ultimaActividad = useRef<number>(Date.now());
  const fallosSse = useRef(0);

  /**
   * ⚠️ ESTE HOOK DEPENDE DE QUE LO REMONTEN AL CAMBIAR DE CONVERSACIÓN.
   *
   * Los mensajes, el cursor y el modo viven en `useState`/`useRef`, y **useState
   * solo lee su valor inicial en el primer render**. Si se reusa la misma
   * instancia para otro chat, el estado del anterior se queda pegado y en
   * pantalla aparece la conversación equivocada hasta recargar la página.
   *
   * Pasó de verdad el 24-ago-2026 y lo vio Marcelo antes que yo.
   *
   * Por eso `PanelChat` monta `<InboxConversacion key={emp|chat}>`. **Si alguien
   * quita esa `key`, este hook se rompe en silencio.**
   *
   * Se intentó blindarlo acá reseteando el estado durante el render, y no se
   * puede: React prohíbe tocar refs mientras se renderiza, y el linter lo
   * rechaza con razón —bajo render concurrente ese patrón produce fallos peores
   * y más raros que el que intenta evitar—. La `key` es la forma correcta y la
   * que la propia documentación de React recomienda para reiniciar estado.
   */

  /**
   * Fusiona por id, conservando el orden cronológico.
   *
   * Devuelve la MISMA referencia si no hubo cambios. Eso importa: un `setState`
   * con un arreglo nuevo pero equivalente igual dispara render, y este hook se
   * ejecuta varias veces por segundo.
   */
  const fusionar = useCallback((entrantes: MensajeUI[]) => {
    if (!entrantes.length) return;
    setMensajes((prev) => {
      const porId = new Map(prev.map((m) => [m.id, m]));
      let cambio = false;

      for (const m of entrantes) {
        const yaEsta = porId.get(m.id);
        if (yaEsta) {
          // Puede venir con estado nuevo o con el adjunto ya resuelto.
          if (yaEsta.estado !== m.estado || yaEsta.texto !== m.texto) {
            porId.set(m.id, { ...yaEsta, ...m });
            cambio = true;
          }
          continue;
        }
        /**
         * ¿Es la versión real de algo que dibujamos de forma optimista?
         * Se reconoce por rol + texto dentro de una ventana corta. Si calza, se
         * reemplaza el temporal en vez de agregar un duplicado — que es lo que
         * la persona vería como su mensaje apareciendo dos veces.
         */
        const tmp = [...porId.values()].find(
          (p) =>
            p.id.startsWith("tmp:") &&
            p.rol === m.rol &&
            p.texto === m.texto &&
            Math.abs(Date.parse(p.creadoEn) - Date.parse(m.creadoEn)) < 120_000,
        );
        if (tmp) porId.delete(tmp.id);
        porId.set(m.id, m);
        cambio = true;
      }

      if (!cambio) return prev;
      ultimaActividad.current = Date.now();
      return [...porId.values()].sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
    });
  }, []);

  const aplicarEstados = useCallback((estados: Record<string, string>) => {
    const ids = Object.keys(estados);
    if (!ids.length) return;
    setMensajes((prev) => {
      let cambio = false;
      const out = prev.map((m) => {
        const e = estados[m.id] as EstadoEnvio | undefined;
        if (e && e !== m.estado) {
          cambio = true;
          return { ...m, estado: e };
        }
        return m;
      });
      return cambio ? out : prev;
    });
  }, []);

  /** Ids propios cuyo ✓ todavía puede avanzar. Se mandan al servidor para que los vigile. */
  const idsVigilados = useCallback(() => {
    return mensajes
      .filter(
        (m) =>
          m.rol !== "cliente" &&
          !m.id.startsWith("tmp:") &&
          m.estado !== "leido" &&
          m.estado !== "error",
      )
      .slice(-25)
      .map((m) => m.id);
  }, [mensajes]);

  /** Una pasada de sondeo. También se usa para recuperar tras un error de SSE. */
  const sondear = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        emp: empleadoId,
        chat: chatId,
        desde: cursor.current,
      });
      const vig = idsVigilados();
      if (vig.length) qs.set("estados", vig.join(","));

      const r = await fetch(`/api/whatsapp/mensajes?${qs}`, { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      if (Array.isArray(d.mensajes) && d.mensajes.length) {
        fusionar(d.mensajes);
        if (d.hasta) cursor.current = d.hasta;
      }
      if (d.estados) aplicarEstados(d.estados);
      if (d.modo) setModo((m) => (m === d.modo ? m : d.modo));
    } catch {
      /* silencioso: el próximo ciclo reintenta */
    }
  }, [empleadoId, chatId, fusionar, aplicarEstados, idsVigilados]);

  // ── Conexión en vivo ──────────────────────────────────────────────────────
  useEffect(() => {
    let fuente: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let vivo = true;

    const cerrar = () => {
      fuente?.close();
      fuente = null;
      if (timer) clearTimeout(timer);
      timer = null;
    };

    /** Sondeo con ritmo adaptativo: rápido si hay conversación, lento si no. */
    const cicloSondeo = () => {
      if (!vivo) return;
      const enReposo = Date.now() - ultimaActividad.current > REPOSO_TRAS_MS;
      timer = setTimeout(async () => {
        if (!vivo || document.hidden) return void cicloSondeo();
        await sondear();
        cicloSondeo();
      }, enReposo ? SONDEO_REPOSO_MS : SONDEO_ACTIVO_MS);
    };

    const abrirSse = () => {
      if (!vivo) return;
      const qs = new URLSearchParams({
        emp: empleadoId,
        chat: chatId,
        desde: cursor.current,
      });
      const vig = idsVigilados();
      if (vig.length) qs.set("estados", vig.join(","));

      fuente = new EventSource(`/api/whatsapp/stream?${qs}`);

      fuente.addEventListener("listo", () => {
        fallosSse.current = 0;
        setConexion("vivo");
      });
      fuente.addEventListener("mensajes", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        fusionar(d.mensajes ?? []);
        if (d.hasta) cursor.current = d.hasta;
      });
      fuente.addEventListener("estados", (e) => {
        aplicarEstados(JSON.parse((e as MessageEvent).data).estados ?? {});
      });
      fuente.addEventListener("modo", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        if (d.modo) setModo((m) => (m === d.modo ? m : d.modo));
      });
      // Cierre planificado del servidor: reconectar enseguida, sin castigo.
      fuente.addEventListener("fin", () => {
        cerrar();
        if (vivo && !document.hidden) abrirSse();
      });
      fuente.onerror = () => {
        cerrar();
        if (!vivo) return;
        fallosSse.current += 1;
        /**
         * Dos fallos seguidos = este entorno no soporta SSE (proxy corporativo,
         * extensión, red rara). Se pasa a sondeo y no se insiste más: reintentar
         * en bucle contra algo que no va a funcionar solo gasta batería.
         */
        if (fallosSse.current >= 2) {
          setConexion("sondeando");
          cicloSondeo();
        } else {
          setConexion("reconectando");
          timer = setTimeout(abrirSse, 1200);
        }
      };
    };

    const arrancar = () => {
      if (document.hidden) return;
      // Al volver de una pestaña oculta puede haber pasado cualquier cosa:
      // recuperar de una antes de abrir el canal.
      void sondear();
      if (fallosSse.current >= 2 || typeof EventSource === "undefined") {
        setConexion("sondeando");
        cicloSondeo();
      } else {
        abrirSse();
      }
    };

    /**
     * PAUSA CON LA PESTAÑA OCULTA. Antes el intervalo seguía corriendo aunque
     * nadie estuviera mirando. Acá se corta todo y se retoma al volver.
     */
    const onVisibilidad = () => {
      if (document.hidden) {
        cerrar();
        setConexion("reconectando");
      } else {
        arrancar();
      }
    };

    arrancar();
    document.addEventListener("visibilitychange", onVisibilidad);
    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", onVisibilidad);
      cerrar();
    };
    // `idsVigilados` cambia con cada mensaje; incluirlo reabriría el stream todo
    // el tiempo. Se lee al abrir, que es cuando importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empleadoId, chatId, fusionar, aplicarEstados, sondear]);

  /** Cargar el tramo anterior de la conversación (botón "ver anteriores"). */
  const cargarAnteriores = useCallback(async () => {
    if (cargandoHistorial || !hayMasHistorial || !mensajes.length) return;
    setCargandoHistorial(true);
    try {
      const qs = new URLSearchParams({
        emp: empleadoId,
        chat: chatId,
        antesDe: mensajes[0].creadoEn,
      });
      const r = await fetch(`/api/whatsapp/mensajes?${qs}`, { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        setHayMasHistorial(Boolean(d.hayMas));
        if (Array.isArray(d.mensajes) && d.mensajes.length) {
          setMensajes((prev) => {
            const conocidos = new Set(prev.map((m) => m.id));
            const nuevos = (d.mensajes as MensajeUI[]).filter((m) => !conocidos.has(m.id));
            return nuevos.length ? [...nuevos, ...prev] : prev;
          });
        }
      }
    } catch {
      /* si falla, el botón sigue disponible */
    } finally {
      setCargandoHistorial(false);
    }
  }, [empleadoId, chatId, mensajes, cargandoHistorial, hayMasHistorial]);

  /** Agrega un mensaje optimista y devuelve su id temporal. */
  const agregarOptimista = useCallback((m: Omit<MensajeUI, "id">) => {
    const id = `tmp:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    setMensajes((prev) => [...prev, { ...m, id }]);
    ultimaActividad.current = Date.now();
    return id;
  }, []);

  const quitar = useCallback((id: string) => {
    setMensajes((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const marcar = useCallback((id: string, cambios: Partial<MensajeUI>) => {
    setMensajes((prev) => prev.map((m) => (m.id === id ? { ...m, ...cambios } : m)));
  }, []);

  return {
    mensajes,
    modo,
    setModo,
    conexion,
    sondear,
    agregarOptimista,
    quitar,
    marcar,
    cargarAnteriores,
    hayMasHistorial,
    cargandoHistorial,
  };
}
