import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validarParametrosCrearPago,
  generarCommerceOrder,
  mapearEstadoFlow,
  FLOW_TIMEOUT_DEFECTO_S,
} from "@/lib/flow/flowCore";
import {
  crearPagoFlowApi,
  obtenerEstadoPagoFlowApi,
  type RespuestaEstadoPagoFlow,
} from "@/lib/flow/flowClient";
import { obtenerConfigFlow } from "@/lib/flow/flowConfig";
import { generarReferencia } from "@/lib/pagosCore";
import { aplicarPagoConfirmado } from "@/lib/pagos";
import { emitirPagoConfirmado } from "@/lib/eventosComerciales";
import { urlPortal } from "@/lib/origenes";

export type IniciarPagoFlowParams = {
  clienteId: string;
  empleadoId: string;
  chatId?: string | null;
  contactoId?: string | null;
  monto: number;
  concepto: string;
  email?: string | null;
  tipoTransaccion?:
    | "cobro_general"
    | "anticipo_cita"
    | "pago_total_cita"
    | "inscripcion_clase"
    | "compra_membresia"
    | "renovacion_membresia"
    | "pack_creditos";
  metadata?: Record<string, unknown>;
  timeoutSegundos?: number;
  creadoPor?: string;
  supa?: SupabaseClient;
  /** Inyección para testing sin llamadas reales de red */
  fetchFn?: typeof fetch;
};

export type ResultadoIniciarPagoFlow =
  | {
      ok: true;
      pagoId: string;
      referencia: string;
      commerceOrder: string;
      url: string;
      token: string;
      flowOrder: number;
      reusado?: boolean;
    }
  | { ok: false; error: string };

/**
 * INICIA UN COBRO EN FLOW.CL.
 *
 * Flujo:
 *  1. Valida configuración y credenciales del tenant.
 *  2. Resuelve contacto canónico (Guardrail 1).
 *  3. Idempotencia: si ya existe un cobro pendiente idéntico reciente, lo reutiliza.
 *  4. Inserta fila PENDIENTE en `ed_pagos`.
 *  5. Invoca a Flow.cl (`/payment/create`).
 *  6. Actualiza `ed_pagos` con token, flowOrder y URL de checkout.
 *  7. Devuelve URL segura para WhatsApp/Portal.
 */
export async function iniciarPagoFlow(
  p: IniciarPagoFlowParams,
): Promise<ResultadoIniciarPagoFlow> {
  const supa = p.supa ?? db();

  // 1. Obtener credenciales Flow del tenant
  const creds = await obtenerConfigFlow(p.clienteId, supa);
  if (!creds) {
    return {
      ok: false,
      error: "Este negocio no tiene configuradas sus credenciales de Flow.cl (API Key y Secret Key).",
    };
  }

  // 2. Resolver contacto canónico (Guardrail 1)
  let resolvedContactoId: string | null = p.contactoId ?? null;
  let resolvedEmail: string | null = p.email ?? null;
  let attributionData: Record<string, unknown> = {};

  if (!resolvedContactoId && p.chatId) {
    const { data: c } = await supa
      .from("ed_contactos")
      .select("id, email, datos")
      .eq("cliente_id", p.clienteId)
      .eq("chat_id", p.chatId)
      .maybeSingle();

    if (c) {
      resolvedContactoId = c.id as string;
      if (!resolvedEmail && c.email) resolvedEmail = c.email as string;
      if (c.datos && typeof c.datos === "object") {
        attributionData = c.datos as Record<string, unknown>;
      }
    }
  }

  // URLs de confirmación (webhook server-to-server) y retorno (navegador UX)
  const urlConfirmation = urlPortal("/api/flow/confirmacion");
  const urlReturn = urlPortal("/api/flow/retorno");

  // 3. Validar parámetros de la orden
  const val = validarParametrosCrearPago({
    monto: p.monto,
    concepto: p.concepto,
    email: resolvedEmail,
    urlConfirmation,
    urlReturn,
  });
  if (!val.ok) return val;

  const timeoutS = p.timeoutSegundos ?? FLOW_TIMEOUT_DEFECTO_S;
  const expiraEn = new Date(Date.now() + timeoutS * 1000).toISOString();

  // 4. Idempotencia: evitar doble orden por doble clic o reintento rápido (< 2 min)
  const chatIdConsulta = p.chatId ?? "";
  if (chatIdConsulta) {
    const dosMinutosAtras = new Date(Date.now() - 2 * 60_000).toISOString();
    const { data: existente } = await supa
      .from("ed_pagos")
      .select("id, referencia, proveedor_orden, proveedor_token, proveedor_url, creado_en")
      .eq("cliente_id", p.clienteId)
      .eq("chat_id", chatIdConsulta)
      .eq("proveedor", "flow")
      .eq("estado", "pendiente")
      .eq("monto", val.monto)
      .gte("creado_en", dosMinutosAtras)
      .not("proveedor_token", "is", null)
      .limit(1)
      .maybeSingle();

    if (existente?.proveedor_token && existente?.proveedor_url) {
      return {
        ok: true,
        pagoId: existente.id as string,
        referencia: existente.referencia as string,
        commerceOrder: generarCommerceOrder(existente.referencia as string),
        url: existente.proveedor_url as string,
        token: existente.proveedor_token as string,
        flowOrder: Number(existente.proveedor_orden ?? 0),
        reusado: true,
      };
    }
  }

  // 5. Crear referencia legible P-XXXXXX y registrar orden inicial PENDIENTE
  const referencia = generarReferencia();
  const commerceOrder = generarCommerceOrder(referencia);

  const mergedMetadata = {
    ...(p.metadata ?? {}),
    attribution: attributionData,
    commerceOrder,
  };

  const { data: pagoNuevo, error: errorInsert } = await supa
    .from("ed_pagos")
    .insert({
      cliente_id: p.clienteId,
      empleado_id: p.empleadoId,
      chat_id: chatIdConsulta,
      contacto_id: resolvedContactoId,
      referencia,
      monto: val.monto,
      concepto: val.concepto,
      estado: "pendiente",
      proveedor: "flow",
      tipo_transaccion: p.tipoTransaccion ?? "cobro_general",
      expira_en: expiraEn,
      metadata: mergedMetadata,
      creado_por: p.creadoPor ?? "sistema",
    })
    .select("id")
    .single();

  if (errorInsert || !pagoNuevo) {
    console.error("[flowPagos] Error al crear fila ed_pagos:", errorInsert?.message);
    return { ok: false, error: "No se pudo registrar la orden de cobro en el sistema." };
  }

  const pagoId = pagoNuevo.id as string;

  // 6. Invocar API de Flow (`POST /payment/create`)
  const respFlow = await crearPagoFlowApi(
    creds,
    {
      commerceOrder,
      subject: val.concepto,
      currency: "CLP",
      amount: val.monto,
      email: val.email,
      urlConfirmation,
      urlReturn,
      timeout: timeoutS,
      optional: JSON.stringify({ pagoId, clienteId: p.clienteId }),
    },
    p.fetchFn,
  );

  if (!respFlow.ok) {
    // Si Flow rechaza la creación, marcamos como anulado para no dejar deuda fantasma
    await supa
      .from("ed_pagos")
      .update({
        estado: "anulado",
        anulado_en: new Date().toISOString(),
        metadata: { ...mergedMetadata, errorCreacionFlow: respFlow.error },
      })
      .eq("id", pagoId);

    return { ok: false, error: `Error de pasarela Flow: ${respFlow.error}` };
  }

  const { token, url, flowOrder } = respFlow.data;
  const checkoutUrl = `${url}?token=${token}`;

  // 7. Persistir tokens y datos de Flow
  await supa
    .from("ed_pagos")
    .update({
      proveedor_token: token,
      proveedor_orden: String(flowOrder),
      proveedor_url: checkoutUrl,
    })
    .eq("id", pagoId);

  return {
    ok: true,
    pagoId,
    referencia,
    commerceOrder,
    url: checkoutUrl,
    token,
    flowOrder,
  };
}

export type ResultadoProcesarConfirmacionFlow =
  | {
      ok: true;
      pagoId: string;
      estado: "pagado" | "rechazado" | "anulado" | "pendiente";
      monto: number;
      referencia: string;
      yaProcesado?: boolean;
    }
  | { ok: false; error: string; estado?: string };

/**
 * PROCESA EL CALLBACK OFICIAL DE FLOW (`urlConfirmation`).
 *
 * Seguridad y Zero-Trust:
 *  - El webhook solo provee `token`.
 *  - Se consulta síncronamente a Flow (`/payment/getStatus`) para verificar autenticidad.
 *  - Se valida coincidencia estricta de monto y orden.
 *  - Solo `status = 2` marca como PAGADO.
 *  - Idempotencia garantizada en base de datos.
 */
export async function procesarConfirmacionFlow(
  token: string,
  opts?: { supa?: SupabaseClient; fetchFn?: typeof fetch },
): Promise<ResultadoProcesarConfirmacionFlow> {
  const supa = opts?.supa ?? db();
  const tokenLimpio = (token ?? "").trim();
  if (!tokenLimpio) return { ok: false, error: "Falta token de Flow" };

  // 1. Localizar el pago por `proveedor_token`
  const { data: pago, error: errPago } = await supa
    .from("ed_pagos")
    .select("id, cliente_id, empleado_id, chat_id, contacto_id, referencia, monto, concepto, estado, proveedor, proveedor_orden, metadata")
    .eq("proveedor_token", tokenLimpio)
    .eq("proveedor", "flow")
    .maybeSingle();

  if (errPago || !pago) {
    console.warn(`[flowPagos] Token Flow no encontrado en ed_pagos: ${tokenLimpio}`);
    return { ok: false, error: "Orden de pago no encontrada para el token provisto" };
  }

  // 2. Si ya está en estado terminal, responder con éxito inmediato (Idempotencia)
  if (pago.estado === "pagado") {
    return {
      ok: true,
      pagoId: pago.id as string,
      estado: "pagado",
      monto: pago.monto as number,
      referencia: pago.referencia as string,
      yaProcesado: true,
    };
  }

  // 3. Consultar a Flow el estado real server-to-server
  const creds = await obtenerConfigFlow(pago.cliente_id as string, supa);
  if (!creds) {
    return { ok: false, error: "No se encontraron credenciales para verificar el pago en Flow" };
  }

  const estadoFlowResp = await obtenerEstadoPagoFlowApi(creds, tokenLimpio, opts?.fetchFn);
  if (!estadoFlowResp.ok) {
    return { ok: false, error: estadoFlowResp.error };
  }

  const flowData: RespuestaEstadoPagoFlow = estadoFlowResp.data;
  const nuevoEstado = mapearEstadoFlow(flowData.status);

  // 4. Validación de Integridad de Monto y Moneda
  if (flowData.currency !== "CLP") {
    console.error(`[flowPagos] Moneda discordante en pago ${pago.id}: esperado CLP, recibido ${flowData.currency}`);
    return { ok: false, error: "Moneda devuelta por Flow no coincide con CLP" };
  }

  if (Math.round(flowData.amount) !== pago.monto) {
    console.error(`[flowPagos] Monto discordante en pago ${pago.id}: esperado ${pago.monto}, recibido ${flowData.amount}`);
    return { ok: false, error: "Monto de Flow no coincide con la orden registrada" };
  }

  // 5. Aplicar Transición de Estado Atómica
  if (nuevoEstado === "pagado") {
    const ahora = new Date().toISOString();

    const { data: actualizado, error: errUpdate } = await supa
      .from("ed_pagos")
      .update({
        estado: "pagado",
        pagado_en: ahora,
        proveedor_estado: flowData.status,
        proveedor_datos: flowData.paymentData ?? {},
        proveedor_orden: String(flowData.flowOrder),
      })
      .eq("id", pago.id)
      .eq("estado", "pendiente") // Garantía concurrente: solo si sigue pendiente
      .select("id");

    if (errUpdate) {
      console.error("[flowPagos] Error al actualizar estado a pagado:", errUpdate.message);
      return { ok: false, error: errUpdate.message };
    }

    // Si no actualizó filas, otro proceso ganó la carrera
    if (!actualizado || actualizado.length === 0) {
      return {
        ok: true,
        pagoId: pago.id as string,
        estado: "pagado",
        monto: pago.monto as number,
        referencia: pago.referencia as string,
        yaProcesado: true,
      };
    }

    // 6. Emitir evento comercial de dominio PAYMENT_CONFIRMED (Guardrail 3)
    await emitirPagoConfirmado(
      {
        clienteId: pago.cliente_id as string,
        pagoId: pago.id as string,
        contactoId: (pago.contacto_id as string | null) ?? null,
        monto: pago.monto as number,
        moneda: "CLP",
        proveedor: "flow",
        proveedorOrden: String(flowData.flowOrder),
        chatId: (pago.chat_id as string | null) ?? null,
        payload: {
          concepto: pago.concepto,
          referencia: pago.referencia,
          tipoTransaccion: (pago as { tipo_transaccion?: string }).tipo_transaccion ?? "cobro_general",
          payer: flowData.payer,
          media: flowData.paymentData?.media,
        },
      },
      supa,
    );

    // 7. Reflejar en la conversación de WhatsApp (retirar etiquetas de falta pago, mover etapa a ganado)
    if (pago.chat_id) {
      await aplicarPagoConfirmado({
        clienteId: pago.cliente_id as string,
        chatId: pago.chat_id as string,
        supa,
      }).catch((e) => {
        console.error("[flowPagos] Fallo no fatal en aplicarPagoConfirmado:", e);
      });
    }

    return {
      ok: true,
      pagoId: pago.id as string,
      estado: "pagado",
      monto: pago.monto as number,
      referencia: pago.referencia as string,
    };
  }

  // Si fue rechazada o anulada en Flow
  if (nuevoEstado === "rechazado" || nuevoEstado === "anulado") {
    await supa
      .from("ed_pagos")
      .update({
        estado: nuevoEstado,
        anulado_en: new Date().toISOString(),
        proveedor_estado: flowData.status,
        proveedor_datos: flowData.paymentData ?? {},
      })
      .eq("id", pago.id)
      .eq("estado", "pendiente");

    return {
      ok: true,
      pagoId: pago.id as string,
      estado: nuevoEstado,
      monto: pago.monto as number,
      referencia: pago.referencia as string,
    };
  }

  return {
    ok: true,
    pagoId: pago.id as string,
    estado: "pendiente",
    monto: pago.monto as number,
    referencia: pago.referencia as string,
  };
}

/**
 * CONCILIACIÓN FORZADA / MANUAL DE UN PAGO.
 *
 * Permite resolver: "Flow dice pagada pero Respondo quedó pendiente".
 */
export async function conciliarPagoFlow(
  pagoId: string,
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<ResultadoProcesarConfirmacionFlow> {
  const { data: pago, error } = await supa
    .from("ed_pagos")
    .select("proveedor, proveedor_token")
    .eq("id", pagoId)
    .eq("cliente_id", clienteId)
    .maybeSingle();

  if (error || !pago) {
    return { ok: false, error: "Pago no encontrado en el negocio indicado" };
  }

  if (pago.proveedor !== "flow" || !pago.proveedor_token) {
    return { ok: false, error: "Este cobro no fue procesado mediante Flow.cl" };
  }

  return procesarConfirmacionFlow(pago.proveedor_token as string, { supa });
}
