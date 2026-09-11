/**
 * PROCESOS DEL CRON — núcleo puro (sin base), testeable (Fase 0, 11-sep-2026).
 *
 * Problema que resuelve: el cron único ejecuta ~13 pasos (seguimientos, informe
 * semanal, tokens de Instagram, cierres, archivado…). Cada paso tragaba sus
 * errores con `console.error` y el latido solo decía "el cron corrió". Un paso
 * podía fallar todos los lunes durante semanas —el informe semanal de un
 * negocio, por ejemplo— sin que nada en el portal ni en /api/salud lo mostrara.
 *
 * Diseño: se reutiliza `ed_latidos` (una fila por proceso, clave
 * `proceso:<nombre>`), sin tabla nueva. El `detalle` jsonb guarda el estado
 * acumulado que calcula `fusionarDetalle`.
 *
 * Tres resultados posibles por corrida:
 *  - `trabajo: false`  → el paso no tenía nada que hacer (no es lunes, fuera de
 *    horario). NO borra un fallo anterior: si no, el informe que falló el lunes
 *    quedaría "sano" el martes sin haberse generado nunca.
 *  - `ok: true`        → hizo su trabajo sin errores. Resetea los fallos seguidos.
 *  - `ok: false` o `errores` no vacío → fallo (total o de algún negocio).
 */

export type ErrorDeNegocio = { clienteId?: string | null; error: string };

export type ResultadoPaso = {
  nombre: string;
  /** false si el paso lanzó o reportó un error general. */
  ok: boolean;
  /** false cuando el paso retornó sin nada que hacer. Por defecto true. */
  trabajo?: boolean;
  /** Solo números/booleanos/textos cortos: nunca chat_id, teléfonos ni nombres. */
  resumen?: Record<string, number | boolean | string>;
  errores?: ErrorDeNegocio[];
  duracionMs?: number;
};

export type DetalleProceso = {
  ultimo_estado: "ok" | "fallo" | "sin_trabajo";
  ultimo_exito_en: string | null;
  ultimo_fallo_en: string | null;
  ultimo_error: string | null;
  fallos_seguidos: number;
  /** Últimos errores (máx. MAX_ERRORES), el más reciente primero. */
  errores: { clienteId: string | null; error: string; en: string }[];
  resumen: Record<string, number | boolean | string>;
  duracion_ms: number | null;
};

export const MAX_ERRORES = 10;
/** Con 3 corridas fallidas seguidas (15 min con el cron cada 5) se considera "fallando". */
export const FALLOS_PARA_ALERTA = 3;
/** …o con este número de errores dentro de la ventana, aunque no sean seguidos. */
export const ERRORES_RECIENTES_PARA_ALERTA = 5;
export const VENTANA_ERRORES_MS = 6 * 3_600_000;

/**
 * Limpia un mensaje de error antes de guardarlo en una tabla de diagnóstico:
 * sin tokens, sin teléfonos/chat_id, sin correos, y corto.
 */
export function limpiarError(e: unknown): string {
  let s = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e ?? "");
  s = String(s ?? "")
    .replace(/\b(access_token|token|key|secret|k|apikey|password)=([^&\s"']+)/gi, "$1=***")
    .replace(/Bearer\s+[\w.\-~+/=]+/gi, "Bearer ***")
    .replace(/\bEAA[\w-]{10,}/g, "EAA***")
    .replace(/\bIG[A-Z]{2}[\w-]{20,}/g, "IG***")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<correo>")
    .replace(/\+?\d(?:\s?\d){7,}/g, "<número>")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > 240 ? `${s.slice(0, 237)}...` : s || "error sin mensaje";
}

function detalleVacio(): DetalleProceso {
  return {
    ultimo_estado: "sin_trabajo",
    ultimo_exito_en: null,
    ultimo_fallo_en: null,
    ultimo_error: null,
    fallos_seguidos: 0,
    errores: [],
    resumen: {},
    duracion_ms: null,
  };
}

/** Normaliza lo que haya en la base (puede venir null, viejo o corrupto). */
export function leerDetalle(raw: unknown): DetalleProceso {
  const base = detalleVacio();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<DetalleProceso>;
  return {
    ultimo_estado:
      r.ultimo_estado === "ok" || r.ultimo_estado === "fallo" ? r.ultimo_estado : "sin_trabajo",
    ultimo_exito_en: typeof r.ultimo_exito_en === "string" ? r.ultimo_exito_en : null,
    ultimo_fallo_en: typeof r.ultimo_fallo_en === "string" ? r.ultimo_fallo_en : null,
    ultimo_error: typeof r.ultimo_error === "string" ? r.ultimo_error : null,
    fallos_seguidos: Number.isFinite(r.fallos_seguidos) ? Number(r.fallos_seguidos) : 0,
    errores: Array.isArray(r.errores) ? r.errores.slice(0, MAX_ERRORES) : [],
    resumen: r.resumen && typeof r.resumen === "object" ? r.resumen : {},
    duracion_ms: Number.isFinite(r.duracion_ms) ? Number(r.duracion_ms) : null,
  };
}

/** Combina el estado anterior del proceso con el resultado de esta corrida. */
export function fusionarDetalle(previo: unknown, r: ResultadoPaso, ahora: Date): DetalleProceso {
  const d = leerDetalle(previo);
  const en = ahora.toISOString();
  const errores = (r.errores ?? []).map((x) => ({
    clienteId: x.clienteId ?? null,
    error: limpiarError(x.error),
    en,
  }));
  const fallo = !r.ok || errores.length > 0;
  const resumen = r.resumen ?? {};
  const duracion = Number.isFinite(r.duracionMs) ? Number(r.duracionMs) : null;

  if (fallo) {
    const ultimo = errores[0]?.error ?? "el paso falló sin detalle";
    return {
      ...d,
      ultimo_estado: "fallo",
      ultimo_fallo_en: en,
      ultimo_error: ultimo,
      fallos_seguidos: d.fallos_seguidos + 1,
      errores: [...(errores.length ? errores : [{ clienteId: null, error: ultimo, en }]), ...d.errores].slice(
        0,
        MAX_ERRORES,
      ),
      resumen,
      duracion_ms: duracion,
    };
  }
  if (r.trabajo === false) {
    // Sin trabajo: se conserva el estado de salud previo tal cual.
    return { ...d, duracion_ms: duracion ?? d.duracion_ms };
  }
  return {
    ...d,
    ultimo_estado: "ok",
    ultimo_exito_en: en,
    fallos_seguidos: 0,
    resumen,
    duracion_ms: duracion,
  };
}

export type EvaluacionProceso = {
  nombre: string;
  estado: "ok" | "fallando" | "con_errores" | "sin_datos";
  texto: string;
};

/**
 * ¿Hay que alertar? "fallando" solo con FALLOS_PARA_ALERTA corridas fallidas
 * seguidas: un hipo aislado de Meta no debe poner /api/salud en rojo.
 */
export function evaluarProceso(
  nombre: string,
  raw: unknown,
  ultimoEn: string | null,
  ahora: Date = new Date(),
): EvaluacionProceso {
  if (!ultimoEn || !raw) return { nombre, estado: "sin_datos", texto: "sin corridas registradas" };
  const d = leerDetalle(raw);
  /**
   * Segunda regla: errores FRECUENTES aunque no sean seguidos. Un negocio cuyos
   * envíos fallan todo el día no encadena fallos (cada fila fallida se cierra y
   * la corrida siguiente sale "ok"), pero sí acumula errores en pocas horas.
   */
  const corte = ahora.getTime() - VENTANA_ERRORES_MS;
  const recientes = d.errores.filter((e) => Date.parse(e.en) >= corte).length;
  if (recientes >= ERRORES_RECIENTES_PARA_ALERTA) {
    return {
      nombre,
      estado: "fallando",
      texto: `${recientes} errores en las últimas ${VENTANA_ERRORES_MS / 3_600_000} h · último: ${d.ultimo_error ?? "?"}`,
    };
  }
  if (d.fallos_seguidos >= FALLOS_PARA_ALERTA) {
    return {
      nombre,
      estado: "fallando",
      texto: `${d.fallos_seguidos} corridas fallidas seguidas · último error: ${d.ultimo_error ?? "?"}`,
    };
  }
  if (d.fallos_seguidos > 0) {
    return { nombre, estado: "con_errores", texto: `falló en la última corrida: ${d.ultimo_error ?? "?"}` };
  }
  return {
    nombre,
    estado: "ok",
    texto: d.ultimo_exito_en ? `último éxito ${d.ultimo_exito_en}` : "sin trabajo pendiente",
  };
}
