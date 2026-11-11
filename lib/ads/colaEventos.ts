import { db } from "@/lib/db";
import { esSoloMensajeria, sinSoloMensajeria } from "@/lib/soloMensajeria";
import {
  armarPayload,
  idDeEvento,
  respuestaParaGuardar,
  toca_reintentar,
  verificar,
  type EventoPendiente,
  type TipoEvento,
} from "@/lib/ads/eventos";
import { leerConfig, type ConfigConversiones } from "@/lib/ads/conversionesConfig";
import { leerCotizacion } from "@/lib/ads/cotizacionCore";

/**
 * LA COLA DE CONVERSIONES — de nuestros hechos a Meta.
 *
 * Función general de Respondo, por tenant, detrás del flag
 * `ed_clientes.conversiones_meta_activo` (migración 331, apagado por defecto).
 * Un negocio que no lo enciende no entra a ningún paso de este archivo.
 *
 * CÓMO ESTÁ ARMADO
 * Un proceso BARRE lo que ya ocurrió y encola lo que falte. El `evento_id` se
 * deriva del hecho y la llave única de la tabla rechaza el duplicado: correrlo
 * dos veces no hace daño. ⭐ Meta NO deduplica estos eventos; esa barrera es
 * toda nuestra.
 *
 *   1. `encolar`  — mira la base. No usa red.
 *   2. `enviar`   — habla con Meta. Si falla, queda en la cola con su motivo,
 *                   el payload y la respuesta. La conversación con el cliente no
 *                   se entera: todo esto corre en el cron, no en el webhook.
 *
 * DE DÓNDE SALE CADA EVENTO
 *   · LeadSubmitted — `ed_contactos.cotizacion.completaEn` (la IA leyó
 *                     producto + cantidad; ver extraccionCotizacion.ts).
 *   · QualifiedLead — `cotizacion.calificadaEn` (la regla del tenant o el
 *                     botón manual «Cotización calificada»).
 *   · Purchase      — `ed_resultados` venta_confirmada que marcó una PERSONA
 *                     con el botón «Marcar como venta» (nota.origen =
 *                     'venta_marcada'). Uno por venta. NO sale de cada pago:
 *                     una imprenta cobra abono y saldo, y serían dos compras.
 */

const GRAPH = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 12_000;
/** Días hacia atrás que barre. Un evento más viejo ya no le sirve a Meta. */
const VENTANA_DIAS = 7;
/** Tope por corrida: comparte función con el cron de seguimientos. */
const MAX_POR_CORRIDA = 40;
/** Marca de las ventas que cuentan como Purchase. */
export const ORIGEN_VENTA_MARCADA = "venta_marcada";

type Candidato = {
  chatId: string;
  tipo: TipoEvento;
  ocurridoEn: Date;
  ctwaClid: string;
  valor?: number | null;
  ventaId?: string | null;
  origen: string;
};

type ClienteConversiones = {
  activo: boolean;
  config: ConfigConversiones;
  datasetId: string;
  wabaId: string;
};

/** Lee flag + config + dataset. Sin la 331 devuelve `activo: false`. */
export async function configDeCliente(clienteId: string): Promise<ClienteConversiones> {
  const { data, error } = await db()
    .from("ed_clientes")
    .select("conversiones_meta_activo, conversiones_meta, ads_dataset_id, waba_id")
    .eq("id", clienteId)
    .maybeSingle();
  if (error || !data) {
    return { activo: false, config: leerConfig(null), datasetId: "", wabaId: "" };
  }
  return {
    activo: Boolean(data.conversiones_meta_activo),
    config: leerConfig(data.conversiones_meta),
    datasetId: String(data.ads_dataset_id ?? "").trim(),
    wabaId: String(data.waba_id ?? "").trim(),
  };
}

/** El `ctwa_clid` guardado en el contacto (migración 282, `datos.campana`). */
export function clidDe(datos: unknown): string {
  const campana = ((datos ?? {}) as Record<string, unknown>).campana as Record<string, unknown> | undefined;
  return String(campana?.ctwaClid ?? "").trim();
}

/** Busca hechos recientes que merezcan un evento y los deja encolados. */
export async function encolar(clienteId: string): Promise<{ nuevos: number; descartados: number }> {
  const supa = db();
  const cfg = await configDeCliente(clienteId);
  if (!cfg.activo) return { nuevos: 0, descartados: 0 };
  const desdeMs = Date.now() - VENTANA_DIAS * 86_400_000;
  const desde = new Date(desdeMs).toISOString();
  const candidatos: Candidato[] = [];

  // ── Leads: de la cotización estructurada, solo conversaciones de anuncio ──
  if (cfg.config.eventos.LeadSubmitted || cfg.config.eventos.QualifiedLead) {
    const { data: contactos } = await supa
      .from("ed_contactos")
      .select("chat_id, datos, cotizacion")
      .eq("cliente_id", clienteId)
      .not("cotizacion", "is", null)
      .not("datos->campana->>ctwaClid", "is", null)
      .gte("ultimo_mensaje_en", desde)
      .limit(300);
    for (const c of contactos ?? []) {
      const cot = leerCotizacion(c.cotizacion);
      const clid = clidDe(c.datos);
      const chatId = c.chat_id as string;
      if (cfg.config.eventos.LeadSubmitted && cot.completaEn && Date.parse(cot.completaEn) >= desdeMs) {
        candidatos.push({ chatId, tipo: "LeadSubmitted", ocurridoEn: new Date(cot.completaEn), ctwaClid: clid, origen: "ia" });
      }
      if (cfg.config.eventos.QualifiedLead && cot.calificadaEn && Date.parse(cot.calificadaEn) >= desdeMs) {
        candidatos.push({
          chatId,
          tipo: "QualifiedLead",
          ocurridoEn: new Date(cot.calificadaEn),
          ctwaClid: clid,
          origen: cot.calificadaManual ? "manual" : "regla",
        });
      }
    }
  }

  // ── Compras: solo las que marcó una persona, una por venta ───────────────
  if (cfg.config.eventos.Purchase) {
    const { data: emps } = await supa.from("ed_empleados").select("id").eq("cliente_id", clienteId);
    const ids = (emps ?? []).map((e) => e.id as string);
    if (ids.length) {
      const { data: ventas } = await supa
        .from("ed_resultados")
        .select("id, chat_id, valor_clp, creado_en")
        .in("empleado_id", ids)
        .eq("tipo", "venta_confirmada")
        .eq("detectado_por", "humano")
        .eq("nota->>origen", ORIGEN_VENTA_MARCADA)
        .gte("creado_en", desde)
        .limit(200);
      const chats = [...new Set((ventas ?? []).map((v) => v.chat_id as string))];
      const clids = new Map<string, string>();
      if (chats.length) {
        const { data } = await supa
          .from("ed_contactos")
          .select("chat_id, datos")
          .eq("cliente_id", clienteId)
          .in("chat_id", chats);
        for (const c of data ?? []) clids.set(c.chat_id as string, clidDe(c.datos));
      }
      for (const v of ventas ?? []) {
        candidatos.push({
          chatId: v.chat_id as string,
          tipo: "Purchase",
          ocurridoEn: new Date(v.creado_en as string),
          ctwaClid: clids.get(v.chat_id as string) ?? "",
          valor: Number(v.valor_clp) || null,
          ventaId: v.id as string,
          origen: "manual",
        });
      }
    }
  }

  if (!candidatos.length) return { nuevos: 0, descartados: 0 };

  // Orden antes de cortar: una compra vale más que un lead calificado, y este
  // más que uno sin calificar; a igual tipo, lo más reciente primero.
  const PESO: Record<TipoEvento, number> = { Purchase: 3, QualifiedLead: 2, LeadSubmitted: 1 };
  candidatos.sort((a, b) => PESO[b.tipo] - PESO[a.tipo] || b.ocurridoEn.getTime() - a.ocurridoEn.getTime());

  let nuevos = 0;
  let descartados = 0;
  for (const c of candidatos.slice(0, MAX_POR_CORRIDA)) {
    const ocurridoEn = Math.floor(c.ocurridoEn.getTime() / 1000);
    if (!Number.isFinite(ocurridoEn)) continue;
    const evento: EventoPendiente = {
      clienteId,
      chatId: c.chatId,
      tipo: c.tipo,
      ocurridoEn,
      ctwaClid: c.ctwaClid,
      valor: c.valor ?? null,
      moneda: "CLP",
      ventaId: c.ventaId ?? null,
    };
    const v = verificar(evento);
    const fila = {
      cliente_id: clienteId,
      chat_id: c.chatId,
      tipo: c.tipo,
      evento_id: idDeEvento(evento),
      ocurrido_en: c.ocurridoEn.toISOString(),
      ctwa_clid: evento.ctwaClid || null,
      valor: c.valor ?? null,
      moneda: "CLP",
      estado: v.ok ? "pendiente" : "descartado",
      motivo: v.ok ? null : v.motivo,
      origen: c.origen,
    };
    // `ignoreDuplicates`: si ya estaba encolado, no se toca. Sin esto un
    // barrido posterior pisaría el estado de uno ya enviado y saldría de nuevo.
    const { data, error } = await supa
      .from("ed_ads_eventos")
      .upsert(fila, { onConflict: "cliente_id,evento_id", ignoreDuplicates: true })
      .select("id");
    if (error) break; // PostgREST devuelve el error, no lo lanza: sin tabla, cortar.
    if (!data?.length) continue; // ya estaba: no se cuenta
    if (v.ok) nuevos += 1;
    else descartados += 1;
  }
  return { nuevos, descartados };
}

/** Token del WhatsApp Business del cliente: la API de conversiones cuelga de ahí. */
export async function tokenWaba(clienteId: string): Promise<string | null> {
  const { data: cliente } = await db()
    .from("ed_clientes")
    .select("waba_token, waba_token_cifrado")
    .eq("id", clienteId)
    .maybeSingle();
  const { descifrar } = await import("@/lib/cifrado");
  return (
    (cliente?.waba_token_cifrado ? descifrar(cliente.waba_token_cifrado as string, "waba-token") : null) ??
    ((cliente?.waba_token as string | null) || null)
  );
}

/** Una llamada a la Graph API con timeout. Nunca lanza. */
export async function llamarGraph(
  ruta: string,
  token: string,
  opciones: { method?: "GET" | "POST"; cuerpo?: unknown } = {},
): Promise<{ ok: boolean; status: number; cuerpo: Record<string, unknown>; motivo: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${GRAPH}/${ruta}`, {
      method: opciones.method ?? "GET",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(opciones.cuerpo !== undefined ? { body: JSON.stringify(opciones.cuerpo) } : {}),
    });
    const cuerpo = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    const err = (cuerpo.error ?? {}) as Record<string, unknown>;
    return {
      ok: r.ok,
      status: r.status,
      cuerpo,
      motivo: r.ok ? "" : String(err.message ?? `HTTP ${r.status}`).slice(0, 300),
    };
  } catch {
    return { ok: false, status: 0, cuerpo: {}, motivo: "no se pudo contactar a Meta (timeout o red)" };
  } finally {
    clearTimeout(timer);
  }
}

/** Manda a Meta lo que esté pendiente. */
export async function enviar(clienteId: string): Promise<{ enviados: number; fallidos: number }> {
  const supa = db();
  if (await esSoloMensajeria(clienteId, supa)) return { enviados: 0, fallidos: 0 };
  const cfg = await configDeCliente(clienteId);
  // Sin flag, dataset o WABA NO se manda nada y NO se marca error: los eventos
  // esperan, que es el estado correcto. Fingir que salieron sería peor.
  if (!cfg.activo || !cfg.datasetId || !cfg.wabaId) return { enviados: 0, fallidos: 0 };
  const token = await tokenWaba(clienteId);
  if (!token) return { enviados: 0, fallidos: 0 };

  const { data: pendientes } = await supa
    .from("ed_ads_eventos")
    .select("id, chat_id, tipo, ocurrido_en, ctwa_clid, valor, moneda, estado, intentos, ultimo_intento")
    .eq("cliente_id", clienteId)
    .eq("es_prueba", false)
    .in("estado", ["pendiente", "fallido"])
    .in("tipo", ["LeadSubmitted", "QualifiedLead", "Purchase"])
    .order("creado_en", { ascending: true })
    .limit(25);

  let enviados = 0;
  let fallidos = 0;
  for (const f of pendientes ?? []) {
    const intentos = Number(f.intentos) || 0;
    if (
      f.estado === "fallido" &&
      !toca_reintentar({
        estado: "fallido",
        intentos,
        ultimoIntento: f.ultimo_intento ? Date.parse(f.ultimo_intento as string) : null,
      })
    ) {
      continue;
    }

    const payload = armarPayload(
      {
        clienteId,
        chatId: f.chat_id as string,
        tipo: f.tipo as TipoEvento,
        ocurridoEn: Math.floor(Date.parse(f.ocurrido_en as string) / 1000),
        ctwaClid: String(f.ctwa_clid ?? ""),
        valor: f.valor as number | null,
        moneda: f.moneda as string | null,
      },
      cfg.wabaId,
      { partnerAgent: cfg.config.partnerAgent },
    );
    const r = await llamarGraph(`${cfg.datasetId}/events`, token, { method: "POST", cuerpo: payload });

    await supa
      .from("ed_ads_eventos")
      .update(
        r.ok
          ? {
              estado: "enviado",
              enviado_en: new Date().toISOString(),
              motivo: null,
              payload,
              respuesta: respuestaParaGuardar(r.cuerpo),
              intentos: intentos + 1,
              ultimo_intento: new Date().toISOString(),
            }
          : {
              estado: "fallido",
              motivo: r.motivo,
              payload,
              respuesta: respuestaParaGuardar(r.cuerpo),
              intentos: intentos + 1,
              ultimo_intento: new Date().toISOString(),
            },
      )
      .eq("id", f.id as string)
      .eq("cliente_id", clienteId);

    if (r.ok) enviados += 1;
    else fallidos += 1;
  }
  return { enviados, fallidos };
}

/**
 * EVENTO DE PRUEBA para «Probar eventos» del Administrador de eventos.
 *
 * Va con `test_event_code`, NO pasa por la cola y NO consume la deduplicación:
 * su `evento_id` es único por intento. Así probar no impide que después salga
 * el evento real de esa misma conversación. Usa el `ctwa_clid` de la
 * conversación de anuncio más reciente; si todavía no hay ninguna, uno de
 * ejemplo (Meta igual muestra el evento y su diagnóstico en la pestaña de
 * prueba). Queda registrado con `es_prueba = true`.
 */
export async function enviarEventoPrueba(
  clienteId: string,
): Promise<{ ok: boolean; mensaje: string; usoClidReal: boolean }> {
  const supa = db();
  const cfg = await configDeCliente(clienteId);
  if (!cfg.wabaId) return { ok: false, mensaje: "Este negocio no tiene WhatsApp conectado.", usoClidReal: false };
  if (!cfg.datasetId) return { ok: false, mensaje: "Falta el conjunto de datos (dataset).", usoClidReal: false };
  if (!cfg.config.testEventCode) {
    return { ok: false, mensaje: "Falta el código de prueba (Test event code) del Administrador de eventos.", usoClidReal: false };
  }
  const token = await tokenWaba(clienteId);
  if (!token) return { ok: false, mensaje: "No se encontró el token de WhatsApp de este negocio.", usoClidReal: false };

  const { data: conAnuncio } = await supa
    .from("ed_contactos")
    .select("chat_id, datos")
    .eq("cliente_id", clienteId)
    .not("datos->campana->>ctwaClid", "is", null)
    .order("ultimo_mensaje_en", { ascending: false })
    .limit(1);
  const fila = (conAnuncio ?? [])[0];
  const clidReal = fila ? clidDe(fila.datos) : "";
  const ctwaClid = clidReal || "RESPONDO_PRUEBA_CTWA_CLID";
  const chatId = (fila?.chat_id as string | undefined) ?? "prueba";
  const ahora = Math.floor(Date.now() / 1000);

  const payload = armarPayload(
    { clienteId, chatId, tipo: "QualifiedLead", ocurridoEn: ahora, ctwaClid },
    cfg.wabaId,
    { testEventCode: cfg.config.testEventCode, partnerAgent: cfg.config.partnerAgent },
  );
  const r = await llamarGraph(`${cfg.datasetId}/events`, token, { method: "POST", cuerpo: payload });

  await supa.from("ed_ads_eventos").insert({
    cliente_id: clienteId,
    chat_id: chatId,
    tipo: "QualifiedLead",
    evento_id: `prueba-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ocurrido_en: new Date(ahora * 1000).toISOString(),
    ctwa_clid: ctwaClid,
    valor: 0,
    moneda: "CLP",
    estado: r.ok ? "enviado" : "descartado",
    motivo: r.ok ? null : r.motivo,
    enviado_en: r.ok ? new Date().toISOString() : null,
    intentos: 1,
    ultimo_intento: new Date().toISOString(),
    payload,
    respuesta: respuestaParaGuardar(r.cuerpo),
    es_prueba: true,
    origen: "prueba",
  });

  return r.ok
    ? {
        ok: true,
        usoClidReal: Boolean(clidReal),
        mensaje: `Meta recibió el evento de prueba (${String(r.cuerpo.events_received ?? 1)}). Revísalo en «Probar eventos» del Administrador de eventos.`,
      }
    : { ok: false, usoClidReal: Boolean(clidReal), mensaje: `Meta rechazó el evento: ${r.motivo}` };
}

/**
 * Obtiene el dataset vinculado a la WABA, o lo crea. `POST /{WABA}/dataset`
 * devuelve el existente si ya hay uno, así que es seguro repetirlo.
 *
 * Es también la VERIFICACIÓN DEL PERMISO: si el token no tiene
 * `whatsapp_business_manage_events`, Meta lo dice acá, con su mensaje, antes de
 * que se encole nada.
 */
export async function obtenerOCrearDataset(clienteId: string): Promise<{ ok: boolean; datasetId?: string; mensaje: string }> {
  const cfg = await configDeCliente(clienteId);
  if (!cfg.wabaId) return { ok: false, mensaje: "Este negocio no tiene WhatsApp conectado." };
  const token = await tokenWaba(clienteId);
  if (!token) return { ok: false, mensaje: "No se encontró el token de WhatsApp de este negocio." };

  const leerId = (c: Record<string, unknown>): string => {
    const directo = String(c.id ?? c.dataset_id ?? "");
    if (/^\d{6,25}$/.test(directo)) return directo;
    const lista = Array.isArray(c.data) ? (c.data as Record<string, unknown>[]) : [];
    const primero = String(lista[0]?.id ?? lista[0]?.dataset_id ?? "");
    return /^\d{6,25}$/.test(primero) ? primero : "";
  };

  const leido = await llamarGraph(`${cfg.wabaId}/dataset`, token);
  let datasetId = leido.ok ? leerId(leido.cuerpo) : "";
  let ultimo = leido;
  if (!datasetId) {
    const creado = await llamarGraph(`${cfg.wabaId}/dataset`, token, { method: "POST" });
    datasetId = creado.ok ? leerId(creado.cuerpo) : "";
    ultimo = creado;
  }
  if (!datasetId) {
    return {
      ok: false,
      mensaje: `Meta no entregó el conjunto de datos: ${ultimo.motivo || "respuesta sin id"}. Si menciona permisos, falta «whatsapp_business_manage_events» en el token de este WhatsApp.`,
    };
  }
  const { error } = await db().from("ed_clientes").update({ ads_dataset_id: datasetId }).eq("id", clienteId);
  if (error) return { ok: false, mensaje: `Meta entregó el dataset ${datasetId} pero no se pudo guardar.` };
  return { ok: true, datasetId, mensaje: `Conjunto de datos listo: ${datasetId}.` };
}

/**
 * Lo que llama el cron. Recorre SOLO los negocios con el flag encendido y
 * dataset. Nunca lanza: comparte endpoint con los recordatorios de cita.
 */
export async function procesarEventos(opts?: {
  fechaLimite?: number;
  maxClientes?: number;
}): Promise<{ encolados: number; enviados: number; detalle: string[] }> {
  const detalle: string[] = [];
  let encolados = 0;
  let enviados = 0;
  try {
    const { data: clientesBruto, error } = await db()
      .from("ed_clientes")
      .select("id, nombre")
      .eq("conversiones_meta_activo", true)
      .not("ads_dataset_id", "is", null)
      .limit(opts?.maxClientes ?? 5);
    // Sin la 331 la columna no existe: es «nadie activo», no un error.
    if (error) return { encolados: 0, enviados: 0, detalle: ["sin_configurar"] };
    const clientes = await sinSoloMensajeria(clientesBruto);
    if (!clientes?.length) return { encolados: 0, enviados: 0, detalle: ["sin_configurar"] };

    for (const c of clientes) {
      if (opts?.fechaLimite && Date.now() > opts.fechaLimite - 8_000) {
        detalle.push("sin_tiempo");
        break;
      }
      const e = await encolar(c.id as string);
      const s = await enviar(c.id as string);
      encolados += e.nuevos;
      enviados += s.enviados;
      detalle.push(`${c.nombre ?? c.id}: +${e.nuevos} encolados, ${s.enviados} enviados, ${s.fallidos} con error`);
    }
  } catch (e) {
    detalle.push(`error: ${(e as Error).message}`);
  }
  return { encolados, enviados, detalle };
}
