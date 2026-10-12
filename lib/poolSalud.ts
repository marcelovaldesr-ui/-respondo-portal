import { db } from "@/lib/db";
import { estadoSesion, wahaPoolApagado, wahaPoolConfigurado, poolSimulado } from "@/lib/wahaPool";
import type { WahaNumero } from "@/lib/poolNumeros";
import { avisarACliente } from "@/lib/push";
import { notificarHQ } from "@/lib/hqBridge";

/**
 * SALUD Y ROTACIÓN AUTOMÁTICA DEL POOL DE NÚMEROS WAHA.
 *
 * Vigila el estado de conexión de cada número del pool:
 *  - Si una sesión cae (FAILED, STOPPED, SCAN_QR_CODE) -> marca 'caido' y saca del reparto.
 *  - Si acumula >= 3 fallos seguidos o error de ban -> marca 'bloqueado' y saca del reparto.
 *  - Promueve automáticamente un número en 'calentando' a 'activo' si existe.
 *  - Envía alerta (push / HQ bridge) informando la incidencia.
 */

const ESTADOS_CAIDOS = new Set(["FAILED", "STOPPED", "SCAN_QR_CODE", "UNPAIRED"]);

export async function alertarNumeroAfectado(
  numero: { id: string; cliente_id: string; sesion: string; etiqueta?: string | null },
  tipo: "caido" | "bloqueado" | "promovido",
  motivo?: string | null,
  supa = db(),
): Promise<void> {
  const nombreNum = numero.etiqueta ? `${numero.etiqueta} (${numero.sesion})` : numero.sesion;
  const descripcion =
    tipo === "promovido"
      ? `Número ${nombreNum} promovido a ACTIVO para mantener capacidad del pool.`
      : `ALERTA WAHA: Número ${nombreNum} quedó ${tipo.toUpperCase()}${motivo ? ` (${motivo})` : ""}. Se retiró del reparto.`;

  console.warn(`[poolSalud] ${descripcion}`);

  // 1) Push al portal de Marcelo / staff
  try {
    await avisarACliente(
      numero.cliente_id,
      {
        titulo: tipo === "promovido" ? "Pool WAHA: Número Promovido" : "Alerta Pool WAHA",
        cuerpo: descripcion,
        tag: `pool_waha_${numero.id}`,
      },
      supa,
    );
  } catch (e) {
    console.warn("[poolSalud] error al enviar push:", (e as Error).message);
  }

  // 2) Puente a HQ
  try {
    notificarHQ({
      tipo: "error",
      clientePortalId: numero.cliente_id,
      detalle: descripcion,
    });
  } catch (e) {
    console.warn("[poolSalud] error al notificar HQ:", (e as Error).message);
  }
}

/**
 * Promueve un número del pool en estado 'calentando' a 'activo' para reemplazar
 * a uno que cayó o se bloqueó.
 */
export async function promoverCalentando(
  clienteId: string,
  supa = db(),
): Promise<WahaNumero | null> {
  const { data } = await supa
    .from("ed_waha_numeros")
    .select("*")
    .eq("cliente_id", clienteId)
    .eq("estado", "calentando")
    .eq("rol", "envio")
    .order("calentamiento_desde", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data?.id) return null;

  const { data: promovido, error } = await supa
    .from("ed_waha_numeros")
    .update({ estado: "activo" })
    .eq("id", data.id)
    .select("*")
    .maybeSingle();

  if (error || !promovido) return null;

  const numPromovido = promovido as WahaNumero;
  await alertarNumeroAfectado(numPromovido, "promovido", "Reemplazo de capacidad", supa);
  return numPromovido;
}

/**
 * Actualiza el estado de una sesión tras recibir un evento session.status de WAHA.
 */
export async function actualizarEstadoSesion(
  sesion: string,
  statusWaha: string,
  supa = db(),
): Promise<{ accion: string; estado: string }> {
  const sUpper = statusWaha.toUpperCase();
  const { data: actual } = await supa
    .from("ed_waha_numeros")
    .select("*")
    .eq("sesion", sesion)
    .maybeSingle();

  if (!actual) return { accion: "sesion_no_encontrada", estado: "desconocido" };

  const num = actual as WahaNumero;

  if (ESTADOS_CAIDOS.has(sUpper)) {
    if (num.estado !== "caido" && num.estado !== "bloqueado") {
      await supa
        .from("ed_waha_numeros")
        .update({ estado: "caido", ultimo_error: `WAHA: ${sUpper}` })
        .eq("id", num.id);

      await alertarNumeroAfectado(num, "caido", sUpper, supa);
      await promoverCalentando(num.cliente_id, supa);
      return { accion: "marcado_caido", estado: "caido" };
    }
  } else if (sUpper === "WORKING" && num.estado === "caido") {
    // Si la sesión volvió a WORKING, se reactiva
    await supa
      .from("ed_waha_numeros")
      .update({ estado: "activo", ultimo_error: null })
      .eq("id", num.id);
    return { accion: "restaurado_activo", estado: "activo" };
  }

  return { accion: "sin_cambios", estado: num.estado };
}

/**
 * Revisa la salud de todos los números activos o en calentamiento del pool.
 * Paso periódico del cron ('salud_pool').
 */
export async function revisarSaludPool(
  supa = db(),
): Promise<{
  revisados: number;
  caidos: number;
  bloqueados: number;
  promovidos: number;
  detalle: string[];
}> {
  const out = { revisados: 0, caidos: 0, bloqueados: 0, promovidos: 0, detalle: [] as string[] };

  if (wahaPoolApagado()) {
    out.detalle.push("waha_pool_apagado");
    return out;
  }

  if (!wahaPoolConfigurado() && !poolSimulado()) {
    out.detalle.push("waha_pool_no_configurado");
    return out;
  }

  const { data, error } = await supa
    .from("ed_waha_numeros")
    .select("*")
    .in("estado", ["activo", "calentando"]);

  if (error || !data || data.length === 0) {
    out.detalle.push(error ? error.message : "sin_numeros_activos");
    return out;
  }

  for (const f of data as WahaNumero[]) {
    out.revisados++;

    // 1) Chequeo de fallos seguidos acumulados
    if (f.fallos_seguidos >= 3 && f.estado !== "bloqueado") {
      await supa
        .from("ed_waha_numeros")
        .update({ estado: "bloqueado", ultimo_error: "Acumuló >= 3 fallos consecutivos" })
        .eq("id", f.id);
      out.bloqueados++;
      out.detalle.push(`${f.sesion}: bloqueado por 3 fallos`);
      await alertarNumeroAfectado(f, "bloqueado", "3 fallos consecutivos", supa);
      const prom = await promoverCalentando(f.cliente_id, supa);
      if (prom) out.promovidos++;
      continue;
    }

    // 2) Consulta del estado de la sesión en WAHA
    const r = await estadoSesion(f.sesion);
    if (!r.ok || ESTADOS_CAIDOS.has(r.status.toUpperCase())) {
      const motivo = r.ok ? r.status : (r.error ?? "error_sesion");
      await supa
        .from("ed_waha_numeros")
        .update({ estado: "caido", ultimo_error: `WAHA: ${motivo}` })
        .eq("id", f.id);
      out.caidos++;
      out.detalle.push(`${f.sesion}: caido (${motivo})`);
      await alertarNumeroAfectado(f, "caido", motivo, supa);
      const prom = await promoverCalentando(f.cliente_id, supa);
      if (prom) out.promovidos++;
    }
  }

  return out;
}

/**
 * Chequeo de salud del pool WAHA para /api/salud.
 * Retorna ok: true (omitido) si WAHA_POOL_URL no está configurada y no está en modo simulado.
 */
export async function chequearWahaPool(
  supa = db(),
): Promise<{ ok: boolean; detalle: string }> {
  if (!process.env.WAHA_POOL_URL && !poolSimulado()) {
    return { ok: true, detalle: "no configurado (omitido)" };
  }

  const { data, error } = await supa
    .from("ed_waha_numeros")
    .select("sesion, estado, fallos_seguidos");

  if (error) {
    return { ok: false, detalle: `error al leer ed_waha_numeros: ${error.message}` };
  }

  const numeros = (data ?? []) as WahaNumero[];
  if (numeros.length === 0) {
    return { ok: true, detalle: "sin números en el pool" };
  }

  const activos = numeros.filter((n) => n.estado === "activo" || n.estado === "calentando");
  if (activos.length === 0) {
    return {
      ok: false,
      detalle: `sin números operativos (${numeros.length} configurados, todos caídos o bloqueados)`,
    };
  }

  const caidos: string[] = [];
  for (const n of activos) {
    const r = await estadoSesion(n.sesion);
    if (!r.ok || ESTADOS_CAIDOS.has((r.status ?? "").toUpperCase())) {
      const err = r.ok ? r.status : (r.error ?? "error");
      caidos.push(`${n.sesion} (${err})`);
    }
  }

  if (caidos.length > 0) {
    return {
      ok: false,
      detalle: `${caidos.length}/${activos.length} números con problemas: ${caidos.join(", ")}`,
    };
  }

  return {
    ok: true,
    detalle: `${activos.length} número(s) sanos (${activos.map((n) => n.sesion).join(", ")})`,
  };
}
