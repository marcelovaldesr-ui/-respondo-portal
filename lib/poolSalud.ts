import { db } from "@/lib/db";
import { estadoSesion, wahaPoolApagado, wahaPoolConfigurado, poolSimulado } from "@/lib/wahaPool";
import { topeDelDia, enviadosEfectivosHoy } from "@/lib/poolNumeros";
import type { WahaNumero } from "@/lib/poolNumeros";
import { avisarACliente } from "@/lib/push";
import { notificarHQ } from "@/lib/hqBridge";

/**
 * SALUD Y ROTACIÓN AUTOMÁTICA DEL POOL DE NÚMEROS WAHA (v2).
 *
 * Vigila el estado de conexión de cada número del pool y del servidor WAHA:
 *  - Distingue servidor WAHA caído (todos inalcanzables -> no tocar números, alertar HQ)
 *    de números caídos individualmente.
 *  - Si un número acumula fallos transitorios -> 'pausado' con enfriamiento (15m -> 1h -> 6h).
 *  - Si una sesión cae (FAILED, STOPPED, SCAN_QR_CODE) -> 'caido' (se recupera al volver WORKING).
 *  - Si acumula 3 fallos seguidos, 3 ciclos de pausa o señal de ban (UNPAIRED) -> 'bloqueado'.
 *  - Recuperación automática de caídos y pausados al volver a WORKING.
 *  - Deduplicación de alertas (máx. 1/hora) y alerta informativa de "recuperado".
 *  - Detección de falta de capacidad (0 números activos con cupo en horario hábil Chile, máx 1/2h).
 */

const ESTADOS_CAIDOS = new Set(["FAILED", "STOPPED", "SCAN_QR_CODE", "UNPAIRED"]);

const historialAlertas = new Map<string, number>();
let ultimaAlertaSinCapacidad = 0;

export function reiniciarHistorialAlertas(): void {
  historialAlertas.clear();
  ultimaAlertaSinCapacidad = 0;
}

export function esHorarioHabilChile(ahora: Date = new Date()): boolean {
  try {
    const horaStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Santiago",
      hour: "numeric",
      hour12: false,
    }).format(ahora);
    const hora = parseInt(horaStr, 10);
    return hora >= 9 && hora < 21;
  } catch {
    const utcHours = ahora.getUTCHours();
    const clHours = (utcHours - 3 + 24) % 24;
    return clHours >= 9 && clHours < 21;
  }
}

export async function alertarNumeroAfectado(
  numero: { id: string; cliente_id: string; sesion: string; etiqueta?: string | null },
  tipo: "caido" | "bloqueado" | "promovido" | "pausado" | "recuperado",
  motivo?: string | null,
  supa = db(),
  ahora = new Date(),
): Promise<boolean> {
  const clave = `${numero.id}:${tipo}`;
  const ahoraMs = ahora.getTime();
  const ultimoAviso = historialAlertas.get(clave);

  if (tipo !== "recuperado" && ultimoAviso && ahoraMs - ultimoAviso < 60 * 60 * 1000) {
    // Deduplicación: misma alerta máx. 1 vez cada 60 min
    return false;
  }

  if (tipo === "recuperado") {
    // Al recuperarse, limpiamos el historial de caída/pausa
    historialAlertas.delete(`${numero.id}:caido`);
    historialAlertas.delete(`${numero.id}:pausado`);
    historialAlertas.delete(`${numero.id}:bloqueado`);
  }

  historialAlertas.set(clave, ahoraMs);

  const nombreNum = numero.etiqueta ? `${numero.etiqueta} (${numero.sesion})` : numero.sesion;
  let descripcion: string;
  let tipoNotif: "error" | "info" = "error";

  if (tipo === "promovido") {
    descripcion = `Número ${nombreNum} promovido a ACTIVO para mantener capacidad del pool.`;
    tipoNotif = "info";
  } else if (tipo === "recuperado") {
    descripcion = `AVISO WAHA: Número ${nombreNum} RECUPERADO (sesión WORKING). Vuelve al reparto activo.`;
    tipoNotif = "info";
  } else if (tipo === "pausado") {
    descripcion = `AVISO WAHA: Número ${nombreNum} PAUSADO temporalmente${motivo ? ` (${motivo})` : ""}.`;
    tipoNotif = "info";
  } else {
    descripcion = `ALERTA WAHA: Número ${nombreNum} quedó ${tipo.toUpperCase()}${motivo ? ` (${motivo})` : ""}. Se retiró del reparto.`;
    tipoNotif = "error";
  }

  console.warn(`[poolSalud] ${descripcion}`);

  // 1) Push al portal de Marcelo / staff
  try {
    await avisarACliente(
      numero.cliente_id,
      {
        titulo: tipo === "promovido" || tipo === "recuperado" ? "Pool WAHA: Información" : "Alerta Pool WAHA",
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
      tipo: tipoNotif,
      clientePortalId: numero.cliente_id,
      detalle: descripcion,
    });
  } catch (e) {
    console.warn("[poolSalud] error al notificar HQ:", (e as Error).message);
  }

  return true;
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
 * Registra en ed_waha_pool_estado que el servidor WAHA está completamente inalcanzable.
 * Alerta a HQ con rate-limit de 30 minutos.
 */
async function registrarServidorInalcanzable(supa = db(), ahora = new Date()): Promise<void> {
  try {
    const { data: actual } = await supa
      .from("ed_waha_pool_estado")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    const ahoraIso = ahora.toISOString();
    const yaInalcanzable = actual?.pool_inalcanzable_desde;

    await supa
      .from("ed_waha_pool_estado")
      .upsert({
        id: 1,
        pool_inalcanzable_desde: yaInalcanzable || ahoraIso,
        ultimo_chequeo_en: ahoraIso,
        actualizado_en: ahoraIso,
      });

    const ultimaAlerta = actual?.alerta_inalcanzable_en ? Date.parse(actual.alerta_inalcanzable_en) : 0;
    const debeAlertar = ahora.getTime() - ultimaAlerta > 30 * 60 * 1000;

    if (debeAlertar) {
      await supa
        .from("ed_waha_pool_estado")
        .update({ alerta_inalcanzable_en: ahoraIso })
        .eq("id", 1);

      notificarHQ({
        tipo: "error",
        detalle: "ALERTA POOL WAHA: Servidor WAHA inalcanzable (red/timeout/servidor). Se preserva el estado de todos los números del pool.",
      });
    }
  } catch (e) {
    console.warn("[poolSalud] error al registrar servidor inalcanzable:", (e as Error).message);
  }
}

/**
 * Registra en ed_waha_pool_estado que el servidor WAHA volvió a responder.
 */
async function registrarServidorRecuperado(supa = db(), ahora = new Date()): Promise<void> {
  try {
    const { data: actual } = await supa
      .from("ed_waha_pool_estado")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (actual?.pool_inalcanzable_desde) {
      await supa
        .from("ed_waha_pool_estado")
        .update({
          pool_inalcanzable_desde: null,
          ultimo_chequeo_en: ahora.toISOString(),
          actualizado_en: ahora.toISOString(),
        })
        .eq("id", 1);

      notificarHQ({
        tipo: "info",
        detalle: "AVISO POOL WAHA: Servidor WAHA recuperado y alcanzable. Operación restablecida.",
      });
    }
  } catch (e) {
    console.warn("[poolSalud] error al registrar servidor recuperado:", (e as Error).message);
  }
}

/**
 * Verifica si quedan 0 números activos con cupo en horario hábil y alerta a HQ (máx 1/2h).
 */
export async function alertarSinCapacidadSiCorresponde(
  numeros: WahaNumero[],
  ahora = new Date(),
): Promise<boolean> {
  if (!esHorarioHabilChile(ahora)) return false;

  const disponibles = numeros.filter(
    (n) =>
      n.estado === "activo" &&
      (!n.pausado_hasta || Date.parse(n.pausado_hasta) <= ahora.getTime()) &&
      enviadosEfectivosHoy(n, ahora) < topeDelDia(n, ahora),
  );

  if (disponibles.length === 0) {
    const ahoraMs = ahora.getTime();
    if (ahoraMs - ultimaAlertaSinCapacidad > 2 * 60 * 60 * 1000) {
      ultimaAlertaSinCapacidad = ahoraMs;
      notificarHQ({
        tipo: "error",
        detalle: "ALERTA POOL WAHA: Sin capacidad de envío en horario hábil (0 números activos con cupo disponible).",
      });
      return true;
    }
  }
  return false;
}

/**
 * Actualiza el estado de una sesión tras recibir un evento session.status de WAHA.
 */
export async function actualizarEstadoSesion(
  sesion: string,
  statusWaha: string,
  supa = db(),
  ahora = new Date(),
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
    const esBloqueo = sUpper === "UNPAIRED";
    const nuevoEstado = esBloqueo ? "bloqueado" : "caido";

    if (num.estado !== nuevoEstado && num.estado !== "bloqueado") {
      await supa
        .from("ed_waha_numeros")
        .update({ estado: nuevoEstado, ultimo_error: `WAHA: ${sUpper}` })
        .eq("id", num.id);

      await alertarNumeroAfectado(num, nuevoEstado, sUpper, supa, ahora);
      await promoverCalentando(num.cliente_id, supa);
      return { accion: `marcado_${nuevoEstado}`, estado: nuevoEstado };
    }
  } else if (sUpper === "WORKING" && (num.estado === "caido" || num.estado === "pausado")) {
    await supa
      .from("ed_waha_numeros")
      .update({
        estado: "activo",
        ultimo_error: null,
        ultimo_ok_en: ahora.toISOString(),
        pausado_hasta: null,
        ciclos_pausa: 0,
        fallos_seguidos: 0,
      })
      .eq("id", num.id);

    await alertarNumeroAfectado(num, "recuperado", "Sesión WORKING", supa, ahora);
    return { accion: "restaurado_activo", estado: "activo" };
  }

  return { accion: "sin_cambios", estado: num.estado };
}

/**
 * Revisa la salud de todos los números activos, en calentamiento o pausados del pool.
 * Paso periódico del cron ('salud_pool').
 */
export async function revisarSaludPool(
  supa = db(),
  ahora = new Date(),
): Promise<{
  revisados: number;
  caidos: number;
  bloqueados: number;
  pausados: number;
  recuperados: number;
  promovidos: number;
  inalcanzable?: boolean;
  detalle: string[];
}> {
  const out = {
    revisados: 0,
    caidos: 0,
    bloqueados: 0,
    pausados: 0,
    recuperados: 0,
    promovidos: 0,
    detalle: [] as string[],
  };

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
    .in("estado", ["activo", "calentando", "pausado"]);

  if (error || !data || data.length === 0) {
    out.detalle.push(error ? error.message : "sin_numeros_activos");
    return out;
  }

  const numeros = data as WahaNumero[];
  const activosOCalentando = numeros.filter((n) => n.estado === "activo" || n.estado === "calentando");

  // Chequeo previo: consultar estado de sesión de cada número activo/calentando
  const estadosPorSesion = new Map<string, Awaited<ReturnType<typeof estadoSesion>>>();
  for (const f of activosOCalentando) {
    estadosPorSesion.set(f.sesion, await estadoSesion(f.sesion));
  }

  // 1) Si TODOS los números activos/calentando son inalcanzables -> El servidor WAHA está caído
  const totalActivos = activosOCalentando.length;
  const inalcanzables = activosOCalentando.filter((f) => {
    const r = estadosPorSesion.get(f.sesion);
    return r?.tipo === "inalcanzable";
  });

  if (totalActivos > 0 && inalcanzables.length === totalActivos) {
    await registrarServidorInalcanzable(supa, ahora);
    out.revisados = totalActivos;
    out.detalle.push("servidor_waha_inalcanzable");
    return { ...out, inalcanzable: true };
  }

  // Servidor alcanzable (al menos un número respondió)
  await registrarServidorRecuperado(supa, ahora);

  // 2) Revisión individual por número
  for (const f of numeros) {
    out.revisados++;

    // A) Número pausado: verificar si terminó su tiempo de enfriamiento
    if (f.estado === "pausado") {
      if (f.pausado_hasta && Date.parse(f.pausado_hasta) > ahora.getTime()) {
        out.detalle.push(`${f.sesion}: en enfriamiento hasta ${f.pausado_hasta}`);
        continue;
      }

      // Pasó el tiempo de pausa -> verificar si la sesión está WORKING
      const r = estadosPorSesion.get(f.sesion) ?? (await estadoSesion(f.sesion));
      if (r.ok && r.status.toUpperCase() === "WORKING") {
        await supa
          .from("ed_waha_numeros")
          .update({
            estado: "activo",
            pausado_hasta: null,
            ultimo_error: null,
            ultimo_ok_en: ahora.toISOString(),
            ciclos_pausa: 0,
            fallos_seguidos: 0,
          })
          .eq("id", f.id);

        out.recuperados++;
        out.detalle.push(`${f.sesion}: recuperado de pausa`);
        await alertarNumeroAfectado(f, "recuperado", "Sesión WORKING", supa, ahora);
      } else {
        // No se recuperó tras la pausa -> siguiente ciclo de backoff
        const ciclos = (f.ciclos_pausa ?? 0) + 1;
        if (ciclos >= 3) {
          await supa
            .from("ed_waha_numeros")
            .update({
              estado: "bloqueado",
              ultimo_error: "Bloqueado tras 3 ciclos de pausa sin recuperación",
            })
            .eq("id", f.id);

          out.bloqueados++;
          out.detalle.push(`${f.sesion}: bloqueado tras 3 ciclos de pausa`);
          await alertarNumeroAfectado(f, "bloqueado", "3 ciclos de pausa sin recuperación", supa, ahora);
          const prom = await promoverCalentando(f.cliente_id, supa);
          if (prom) out.promovidos++;
        } else {
          const minutosPausa = ciclos === 2 ? 60 : 360;
          const proxPausa = new Date(ahora.getTime() + minutosPausa * 60 * 1000).toISOString();
          await supa
            .from("ed_waha_numeros")
            .update({
              pausado_hasta: proxPausa,
              ciclos_pausa: ciclos,
              ultimo_error: `Pausa ciclo ${ciclos}: sesión no operativa (${r.status})`,
            })
            .eq("id", f.id);

          out.pausados++;
          out.detalle.push(`${f.sesion}: pausa ciclo ${ciclos} (${minutosPausa} min)`);
        }
      }
      continue;
    }

    // B) Chequeo de fallos seguidos acumulados
    if (f.fallos_seguidos >= 3 && f.estado !== "bloqueado") {
      await supa
        .from("ed_waha_numeros")
        .update({ estado: "bloqueado", ultimo_error: "Acumuló >= 3 fallos consecutivos" })
        .eq("id", f.id);

      out.bloqueados++;
      out.detalle.push(`${f.sesion}: bloqueado por 3 fallos`);
      await alertarNumeroAfectado(f, "bloqueado", "3 fallos consecutivos", supa, ahora);
      const prom = await promoverCalentando(f.cliente_id, supa);
      if (prom) out.promovidos++;
      continue;
    }

    // C) Consulta del estado de la sesión
    const r = estadosPorSesion.get(f.sesion) ?? (await estadoSesion(f.sesion));

    // Si este número individual dio inalcanzable (servidor sí respondió a otros)
    if (r.tipo === "inalcanzable") {
      if (f.ultimo_error === "waha_inalcanzable_1") {
        // Segunda revisión seguida inalcanzable -> aplicar pausa transitoria
        const proxPausa = new Date(ahora.getTime() + 15 * 60 * 1000).toISOString();
        await supa
          .from("ed_waha_numeros")
          .update({
            estado: "pausado",
            pausado_hasta: proxPausa,
            ciclos_pausa: 1,
            ultimo_error: "Sesión inalcanzable tras 2 revisiones consecutivas",
          })
          .eq("id", f.id);

        out.pausados++;
        out.detalle.push(`${f.sesion}: pausado por inalcanzable (2 intentos)`);
        await alertarNumeroAfectado(f, "pausado", "Inalcanzable (2 intentos)", supa, ahora);
        const prom = await promoverCalentando(f.cliente_id, supa);
        if (prom) out.promovidos++;
      } else {
        // Primer fallo inalcanzable: registrar marca de tolerancia sin cambiar estado
        await supa
          .from("ed_waha_numeros")
          .update({ ultimo_error: "waha_inalcanzable_1" })
          .eq("id", f.id);
        out.detalle.push(`${f.sesion}: inalcanzable intento 1 (tolerancia)`);
      }
      continue;
    }

    // Si la sesión está caída o bloqueada
    if (!r.ok || ESTADOS_CAIDOS.has((r.status ?? "").toUpperCase())) {
      const statusUp = (r.status ?? "").toUpperCase();
      const esBloqueoClaro = statusUp === "UNPAIRED" || (r.error && /logged out|banned|baneado|bloqueado/i.test(r.error));

      if (esBloqueoClaro) {
        await supa
          .from("ed_waha_numeros")
          .update({ estado: "bloqueado", ultimo_error: `WAHA: ${r.error || statusUp}` })
          .eq("id", f.id);

        out.bloqueados++;
        out.detalle.push(`${f.sesion}: bloqueado (${r.error || statusUp})`);
        await alertarNumeroAfectado(f, "bloqueado", r.error || statusUp, supa, ahora);
        const prom = await promoverCalentando(f.cliente_id, supa);
        if (prom) out.promovidos++;
      } else {
        const motivo = r.ok ? r.status : (r.error ?? "error_sesion");
        await supa
          .from("ed_waha_numeros")
          .update({ estado: "caido", ultimo_error: `WAHA: ${motivo}` })
          .eq("id", f.id);

        out.caidos++;
        out.detalle.push(`${f.sesion}: caido (${motivo})`);
        await alertarNumeroAfectado(f, "caido", motivo, supa, ahora);
        const prom = await promoverCalentando(f.cliente_id, supa);
        if (prom) out.promovidos++;
      }
      continue;
    }

    // Sesión sana (WORKING)
    if (f.estado === "caido") {
      await supa
        .from("ed_waha_numeros")
        .update({
          estado: "activo",
          ultimo_error: null,
          ultimo_ok_en: ahora.toISOString(),
          fallos_seguidos: 0,
        })
        .eq("id", f.id);

      out.recuperados++;
      out.detalle.push(`${f.sesion}: recuperado (WORKING)`);
      await alertarNumeroAfectado(f, "recuperado", "WORKING", supa, ahora);
    } else {
      await supa
        .from("ed_waha_numeros")
        .update({
          ultimo_ok_en: ahora.toISOString(),
          ultimo_error: null,
        })
        .eq("id", f.id);
    }
  }

  // 3) Verificar capacidad general en horario hábil
  await alertarSinCapacidadSiCorresponde(numeros, ahora);

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
