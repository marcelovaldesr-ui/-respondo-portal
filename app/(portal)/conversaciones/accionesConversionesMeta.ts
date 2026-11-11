"use server";

import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { db } from "@/lib/db";
import { limitarDistribuido } from "@/lib/seguridad";
import { empleadoYContactoDelCliente } from "@/lib/tenant";
import { aplicarPagoConfirmado } from "@/lib/pagos";
import { validarMontoVenta } from "@/lib/ads/conversionesConfig";
import { leerCotizacion, marcarCalificadaManual } from "@/lib/ads/cotizacionCore";
import { clidDe, configDeCliente, ORIGEN_VENTA_MARCADA } from "@/lib/ads/colaEventos";

/**
 * VENTA Y COTIZACIÓN CALIFICADA, DESDE LA CONVERSACIÓN (conversiones a Meta).
 *
 * Solo existen para tenants con `conversiones_meta_activo`. Con el flag
 * apagado `estadoVentaMeta` devuelve null y el bloque no se dibuja: un negocio
 * que no usa la función no ve nada distinto.
 *
 * ⚠️ AISLAMIENTO: el `cliente_id` sale SIEMPRE de la sesión; el chat y el
 * empleado se comprueban contra ese cliente antes de escribir.
 */

export type EstadoVentaMeta = {
  vieneDeAnuncio: boolean;
  anuncio: string | null;
  cotizacion: {
    producto: string | null;
    cantidad: number | null;
    tipo: string | null;
    fechaNecesita: string | null;
    tieneLogo: boolean | null;
    empresa: string | null;
  };
  calificada: boolean;
  calificadaManual: boolean;
  ventas: { id: string; monto: number; en: string }[];
  eventos: { tipo: string; estado: string; motivo: string | null }[];
};

export async function estadoVentaMeta(chatId: string): Promise<EstadoVentaMeta | null> {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario || !chatId) return null;
  const cfg = await configDeCliente(usuario.clienteId);
  if (!cfg.activo) return null;

  const supa = db();
  const { data: c } = await supa
    .from("ed_contactos")
    .select("datos, cotizacion")
    .eq("cliente_id", usuario.clienteId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!c) return null;
  const cot = leerCotizacion(c.cotizacion);
  const campana = ((c.datos ?? {}) as Record<string, unknown>).campana as Record<string, unknown> | undefined;

  const { data: emps } = await supa.from("ed_empleados").select("id").eq("cliente_id", usuario.clienteId);
  const ids = (emps ?? []).map((e) => e.id as string);
  const [{ data: ventas }, { data: eventos }] = await Promise.all([
    ids.length
      ? supa
          .from("ed_resultados")
          .select("id, valor_clp, creado_en")
          .in("empleado_id", ids)
          .eq("chat_id", chatId)
          .eq("tipo", "venta_confirmada")
          .eq("nota->>origen", ORIGEN_VENTA_MARCADA)
          .order("creado_en", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supa
      .from("ed_ads_eventos")
      .select("tipo, estado, motivo")
      .eq("cliente_id", usuario.clienteId)
      .eq("chat_id", chatId)
      .eq("es_prueba", false)
      .order("creado_en", { ascending: false })
      .limit(10),
  ]);

  return {
    vieneDeAnuncio: Boolean(clidDe(c.datos)),
    anuncio: (campana?.titular as string | undefined) ?? (campana?.anuncioId as string | undefined) ?? null,
    cotizacion: {
      producto: cot.producto,
      cantidad: cot.cantidad,
      tipo: cot.tipo,
      fechaNecesita: cot.fechaNecesita,
      tieneLogo: cot.tieneLogo,
      empresa: cot.empresa,
    },
    calificada: Boolean(cot.calificadaEn),
    calificadaManual: Boolean(cot.calificadaManual),
    ventas: (ventas ?? []).map((v) => ({
      id: v.id as string,
      monto: Number(v.valor_clp) || 0,
      en: v.creado_en as string,
    })),
    eventos: (eventos ?? []).map((e) => ({
      tipo: e.tipo as string,
      estado: e.estado as string,
      motivo: (e.motivo as string | null) ?? null,
    })),
  };
}

/** «Marcar como venta» con monto neto. Una venta = un Purchase. */
export async function marcarVenta(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) return { ok: false, error: "Sesión no válida" };
  if (!(await limitarDistribuido(`venta-meta:${usuario.email}`, 10, 60)).ok) {
    return { ok: false, error: "Demasiados intentos seguidos. Espera un minuto." };
  }
  const cfg = await configDeCliente(usuario.clienteId);
  if (!cfg.activo) return { ok: false, error: "Esta función no está activa para tu negocio." };

  const empleadoId = String(formData.get("empleadoId") ?? "");
  const chatId = String(formData.get("chatId") ?? "");
  const v = validarMontoVenta(formData.get("monto"));
  if (!v.ok) return v;

  const supa = db();
  const acceso = await empleadoYContactoDelCliente(supa, { clienteId: usuario.clienteId, empleadoId, chatId });
  if (!acceso.ok) return { ok: false, error: "Sin acceso a esta conversación" };

  // Doble clic / red lenta: la misma venta (mismo chat y monto) en 2 minutos
  // es la misma. Sin esto Meta recibiría dos compras.
  const { data: reciente } = await supa
    .from("ed_resultados")
    .select("id")
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .eq("tipo", "venta_confirmada")
    .eq("valor_clp", v.monto)
    .eq("nota->>origen", ORIGEN_VENTA_MARCADA)
    .gte("creado_en", new Date(Date.now() - 120_000).toISOString())
    .limit(1);
  if ((reciente ?? []).length) return { ok: true };

  const { error } = await supa.from("ed_resultados").insert({
    empleado_id: empleadoId,
    chat_id: chatId,
    tipo: "venta_confirmada",
    valor_clp: v.monto,
    detectado_por: "humano",
    nota: { origen: ORIGEN_VENTA_MARCADA, por: usuario.email, neto: true },
  });
  if (error) return { ok: false, error: "No se pudo guardar la venta. Intenta de nuevo." };

  // La conversación lo refleja: etapa ganado (salvo que alguien la fijara a
  // mano) y fuera las etiquetas de pago pendiente. Best-effort.
  await aplicarPagoConfirmado({ clienteId: usuario.clienteId, chatId, supa });
  return { ok: true };
}

/** Respaldo manual: «Cotización calificada», por si la IA no la detectó. */
export async function marcarCotizacionCalificada(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) return { ok: false, error: "Sesión no válida" };
  const cfg = await configDeCliente(usuario.clienteId);
  if (!cfg.activo) return { ok: false, error: "Esta función no está activa para tu negocio." };

  const chatId = String(formData.get("chatId") ?? "");
  const supa = db();
  const { data: c } = await supa
    .from("ed_contactos")
    .select("cotizacion")
    .eq("cliente_id", usuario.clienteId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!c) return { ok: false, error: "Sin acceso a esta conversación" };

  const nueva = marcarCalificadaManual(leerCotizacion(c.cotizacion), usuario.email, new Date().toISOString());
  const { error } = await supa
    .from("ed_contactos")
    .update({ cotizacion: nueva })
    .eq("cliente_id", usuario.clienteId)
    .eq("chat_id", chatId);
  if (error) return { ok: false, error: "No se pudo guardar. Intenta de nuevo." };
  return { ok: true };
}
