import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { generarJSON } from "@/lib/gemini";
import { avisarACliente } from "@/lib/push";
import { notificarSistemaDelCliente } from "@/lib/puenteSalida";
import { conEtiqueta, etiquetasTrasCierre } from "@/lib/etiquetasCiclo";
import {
  decidirCierre,
  hayPistaDeCierre,
  hayPistaDeCotizacion,
  interpretarCierre,
  promptCierre,
  type MensajeCierre,
} from "@/lib/cierreDecision";
import { ORDEN_ETAPA } from "@/lib/embudo";

/**
 * EL DETECTOR DE CIERRES: LA IA LEE LA CONVERSACIÓN Y DICE SI LA VENTA SE CERRÓ.
 *
 * Corre en el cron único. Para cada conversación con actividad reciente que
 * no esté ya cerrada, mira si desde la última revisión hay una PISTA de
 * cierre (comprobante, "ya transferí", "dale, hágalo"). Solo entonces le
 * pregunta al modelo, y solo acepta la respuesta si cita evidencia que
 * existe en la conversación (lib/cierreDecision.ts).
 *
 *  - pagado → `ed_resultados` (venta_confirmada), el contacto pasa a GANADO,
 *    se limpian las etiquetas abiertas y se agrega "cliente". El sistema del
 *    cliente (Gestión) se entera por el puente. Se avisa por push.
 *  - aprobado_sin_pago → etiqueta "Falta pago" (pago_pendiente) y la etapa
 *    sube al menos a "cotizado" (aprobó algo: hubo precio). Es la tarea que
 *    se olvida en los negocios que piden abono para empezar. Push la primera
 *    vez.
 *  - cotizado → etiqueta "cotizacion", etapa a "cotizado" si estaba más
 *    atrás, y `ed_resultados` (cotizacion_enviada). Es lo que faltaba cuando
 *    cotiza una persona desde el teléfono en vez de Tino.
 *  - abierto → nada; se anota que ya se revisó hasta este mensaje.
 *
 * La etapa solo SUBE acá, con una excepción explícita: un contacto GANADO al
 * que el cliente le vuelve a escribir después del cierre entra también, y si
 * el detector ve cotización, aprobación o pago, es un CICLO NUEVO (compra
 * otra vez): la etapa vuelve a cotizado —o a ganado con otra venta—, con
 * motivo "nuevo_ciclo" y conservando "cliente". Es la única forma fechada de
 * saber que un cliente repite: en modo humano el motor no corre y nadie más
 * lo anotaría.
 *
 * ⚠️ TOPE Y PRESUPUESTO DE TIEMPO, igual que el vigilante: pocas por pasada y
 * `fechaLimite` desde el cron. Lo que no alcanza, lo toma el siguiente latido.
 *
 * ⚠️ NUNCA pisa lo que movió una persona: `etapa_manual` queda fuera.
 */

const MAX_POR_PASADA = 4;
const MENSAJES_CONTEXTO = 14;
const DIAS_ACTIVIDAD = 3;
const MINIMO_POR_REVISION_MS = 15_000;

export type ResumenCierres = {
  revisados: number;
  consultados: number;
  pagados: number;
  aprobados: number;
  cotizados: number;
  detalle: string[];
};

export async function detectarCierres(
  supa: SupabaseClient = db(),
  opts: { fechaLimite?: number } = {},
): Promise<ResumenCierres> {
  const out: ResumenCierres = { revisados: 0, consultados: 0, pagados: 0, aprobados: 0, cotizados: 0, detalle: [] };
  const fechaLimite = opts.fechaLimite ?? Date.now() + 5 * 60_000;
  const desde = new Date(Date.now() - DIAS_ACTIVIDAD * 86_400_000).toISOString();

  const { data: clientes } = await supa.from("ed_clientes").select("id, nombre, rubro").limit(50);
  if (!clientes?.length) return out;

  let procesados = 0;
  for (const cli of clientes) {
    if (procesados >= MAX_POR_PASADA) break;
    const clienteId = cli.id as string;

    const { data: emps } = await supa
      .from("ed_empleados")
      .select("id, rol")
      .eq("cliente_id", clienteId);
    const empIds = (emps ?? []).map((e) => e.id as string);
    if (!empIds.length) continue;
    const tinoId = (emps ?? []).find((e) => e.rol === "tino")?.id as string | undefined;

    // Candidatos: con actividad reciente, no cerrados, no movidos a mano.
    // "revisado hasta" se compara en JS: PostgREST no compara dos columnas.
    const { data: contactos } = await supa
      .from("ed_contactos")
      .select(
        "chat_id, nombre, etapa, etapa_en, etapa_manual, etiquetas, ultimo_mensaje_en, ultimo_mensaje_rol, ultimo_empleado_id, cierre_revisado_en",
      )
      .eq("cliente_id", clienteId)
      .or("etapa.is.null,etapa.neq.perdido")
      .eq("etapa_manual", false)
      .gte("ultimo_mensaje_en", desde)
      .order("ultimo_mensaje_en", { ascending: false })
      .limit(100);

    const pendientes = (contactos ?? []).filter((c) => {
      const revisado = c.cierre_revisado_en as string | null;
      const ultimo = c.ultimo_mensaje_en as string | null;
      if (!ultimo || (revisado && revisado >= ultimo)) return false;
      // Un ganado entra solo si el CLIENTE escribió después del cierre.
      if (c.etapa === "ganado") {
        const etapaEn = c.etapa_en as string | null;
        return c.ultimo_mensaje_rol === "cliente" && Boolean(etapaEn) && ultimo > etapaEn!;
      }
      return true;
    });

    for (const c of pendientes) {
      if (procesados >= MAX_POR_PASADA) break;
      if (fechaLimite - Date.now() < MINIMO_POR_REVISION_MS) {
        out.detalle.push("sin tiempo: el resto queda para el siguiente latido");
        return out;
      }
      const chatId = c.chat_id as string;
      const revisadoHasta = (c.cierre_revisado_en as string | null) ?? null;
      out.revisados++;

      try {
        const r = await revisarUna({
          supa,
          clienteId,
          negocio: (cli.nombre as string) ?? "el negocio",
          rubro: (cli.rubro as string | null) ?? null,
          empIds,
          empleadoResultado: (c.ultimo_empleado_id as string | null) ?? tinoId ?? empIds[0],
          chatId,
          nombre: (c.nombre as string | null) ?? null,
          etapa: (c.etapa as string) ?? "nuevo",
          etiquetas: (c.etiquetas as string[] | null) ?? [],
          ultimoMensajeEn: c.ultimo_mensaje_en as string,
          revisadoHasta,
          fechaLimite,
        });
        if (r.consultado) {
          procesados++;
          out.consultados++;
        }
        if (r.estado === "pagado") out.pagados++;
        if (r.estado === "aprobado_sin_pago") out.aprobados++;
        if (r.estado === "cotizado") out.cotizados++;
        out.detalle.push(`${r.estado}${r.consultado ? "" : " (sin pista)"}`);
      } catch (e) {
        // Un chat que falla no tumba el barrido; queda sin marcar y se reintenta.
        console.error("[cierres] falló en un chat:", (e as Error).message);
      }
    }
  }
  return out;
}

async function revisarUna(p: {
  supa: SupabaseClient;
  clienteId: string;
  negocio: string;
  rubro: string | null;
  empIds: string[];
  empleadoResultado: string;
  chatId: string;
  nombre: string | null;
  etapa: string;
  etiquetas: string[];
  ultimoMensajeEn: string;
  revisadoHasta: string | null;
  fechaLimite: number;
}): Promise<{ estado: "pagado" | "aprobado_sin_pago" | "cotizado" | "abierto"; consultado: boolean }> {
  const { supa, clienteId, chatId } = p;

  const { data: filas } = await supa
    .from("ed_mensajes")
    .select("rol, texto, creado_en")
    .in("empleado_id", p.empIds)
    .eq("chat_id", chatId)
    .order("creado_en", { ascending: false })
    .limit(MENSAJES_CONTEXTO);
  const mensajes = (filas ?? []).reverse();
  const historial: MensajeCierre[] = mensajes.map((m) => ({
    rol: m.rol as string,
    texto: (m.texto as string) ?? "",
  }));

  // La pista tiene que estar en lo NUEVO: lo anterior ya se revisó.
  const nuevos: MensajeCierre[] = mensajes
    .filter((m) => !p.revisadoHasta || (m.creado_en as string) > p.revisadoHasta)
    .map((m) => ({ rol: m.rol as string, texto: (m.texto as string) ?? "" }));

  // "Revisado hasta el último mensaje": se marca en cada salida, MENOS si el
  // modelo lanzó (timeout, sin tiempo): ahí no se marca y el siguiente latido
  // lo reintenta. Un mensaje nuevo del cliente vuelve a abrir la revisión.
  const marcar = async (extra: Record<string, unknown> = {}) => {
    await supa
      .from("ed_contactos")
      .update({ cierre_revisado_en: p.ultimoMensajeEn, ...extra })
      .eq("cliente_id", clienteId)
      .eq("chat_id", chatId);
  };

  /**
   * Sin una persona en la conversación y sin intención detectada, no hay
   * venta que cerrar. Es la barrera contra las notificaciones de banco y de
   * terceros que llegan al mismo WhatsApp ("Transferencia recibida de…"):
   * calzan con la pista, pero nadie del negocio les habló nunca y siguen en
   * "nuevo". Sin esto, el banco terminaría como cliente ganado.
   */
  const hayPersona = historial.some((m) => m.rol === "humano");
  const hayIntencion =
    p.etapa === "interesado" ||
    p.etapa === "cotizado" ||
    p.etiquetas.includes("cotizacion") ||
    p.etiquetas.includes("posible_comprador");
  const hayPista = hayPistaDeCierre(nuevos) || hayPistaDeCotizacion(nuevos);
  if (!nuevos.length || !hayPista || !(hayPersona || hayIntencion)) {
    await marcar();
    return { estado: "abierto", consultado: false };
  }

  /**
   * La etapa solo sube — salvo el ciclo nuevo: un ganado que vuelve a cotizar
   * o aprobar baja a "cotizado" a propósito, marcado como nuevo_ciclo.
   */
  const nuevoCiclo = p.etapa === "ganado";
  const subirA = (destino: "cotizado"): Record<string, unknown> => {
    if (nuevoCiclo) return { etapa: destino, etapa_motivo: "nuevo_ciclo", etapa_en: new Date().toISOString() };
    return (ORDEN_ETAPA[p.etapa as keyof typeof ORDEN_ETAPA] ?? 0) < ORDEN_ETAPA[destino]
      ? { etapa: destino, etapa_motivo: null, etapa_en: new Date().toISOString() }
      : {};
  };

  const crudo = await generarJSON(promptCierre({ negocio: p.negocio, rubro: p.rubro, mensajes: historial }), {
    fechaLimite: p.fechaLimite,
    intentosPorModelo: 1,
  });
  const propuesta = interpretarCierre(crudo);
  const decision = decidirCierre(propuesta, historial);

  await anotar(supa, { clienteId, chatId, estado: decision.estado, evidencia: decision.evidencia, propuesta: propuesta.estado });

  if (decision.estado === "pagado") {
    await supa.from("ed_resultados").insert({
      empleado_id: p.empleadoResultado,
      chat_id: chatId,
      tipo: "venta_confirmada",
      detectado_por: "bot",
      nota: { origen: "detector_cierre", evidencia: decision.evidencia },
    });
    const etiquetas = etiquetasTrasCierre(p.etiquetas, "ganado");
    await marcar({
      etapa: "ganado",
      etapa_motivo: nuevoCiclo ? "nuevo_ciclo" : "pago_detectado",
      etapa_en: new Date().toISOString(),
      etiquetas,
    });
    avisar(supa, clienteId, chatId, p.nombre, "Pago detectado", decision.evidencia);
    puente(supa, clienteId, chatId, p.nombre, "ganado", etiquetas, p.ultimoMensajeEn);
    return { estado: "pagado", consultado: true };
  }

  if (decision.estado === "aprobado_sin_pago") {
    // Aprobó algo: hubo precio. La etapa sube al menos a "cotizado" y la
    // etiqueta "cotizacion" acompaña (si no la había puesto nadie).
    const etiquetas = conEtiqueta(conEtiqueta(p.etiquetas, "cotizacion"), "pago_pendiente");
    const subida = subirA("cotizado");
    const cambio = etiquetas !== p.etiquetas || Object.keys(subida).length > 0;
    await marcar(cambio ? { etiquetas, ...subida } : {});
    if (!p.etiquetas.includes("pago_pendiente")) {
      avisar(supa, clienteId, chatId, p.nombre, "Aprobó, falta el pago", decision.evidencia);
    }
    if (cambio) {
      puente(supa, clienteId, chatId, p.nombre, (subida.etapa as string) ?? p.etapa, etiquetas, p.ultimoMensajeEn);
    }
    return { estado: "aprobado_sin_pago", consultado: true };
  }

  if (decision.estado === "cotizado") {
    const etiquetas = conEtiqueta(p.etiquetas, "cotizacion");
    const subida = subirA("cotizado");
    const cambio = etiquetas !== p.etiquetas || Object.keys(subida).length > 0;
    await marcar(cambio ? { etiquetas, ...subida } : {});
    if (cambio) {
      // Solo la primera vez: es lo que cuenta "cotizaciones enviadas" en Inicio.
      await supa.from("ed_resultados").insert({
        empleado_id: p.empleadoResultado,
        chat_id: chatId,
        tipo: "cotizacion_enviada",
        detectado_por: "bot",
        nota: { origen: "detector_cierre", evidencia: decision.evidencia },
      });
      puente(supa, clienteId, chatId, p.nombre, (subida.etapa as string) ?? p.etapa, etiquetas, p.ultimoMensajeEn);
    }
    return { estado: "cotizado", consultado: true };
  }

  await marcar();
  return { estado: "abierto", consultado: true };
}

/** Bitácora (migración 291). Best-effort: sin tabla, avisa y sigue. */
async function anotar(
  supa: SupabaseClient,
  r: { clienteId: string; chatId: string; estado: string; evidencia: string; propuesta: string },
) {
  const { error } = await supa.from("ed_cierres_detectados").insert({
    cliente_id: r.clienteId,
    chat_id: r.chatId,
    estado: r.estado,
    propuesta: r.propuesta,
    evidencia: r.evidencia || null,
  });
  if (error) console.warn("[cierres] sin bitácora (¿migración 291 aplicada?):", error.message);
}

function avisar(
  supa: SupabaseClient,
  clienteId: string,
  chatId: string,
  nombre: string | null,
  titulo: string,
  evidencia: string,
) {
  const quien = nombre || `+${chatId}`;
  void avisarACliente(
    clienteId,
    {
      titulo: `${quien}: ${titulo}`,
      cuerpo: evidencia ? `«${evidencia}»` : "",
      url: `/conversaciones?chat=${encodeURIComponent(chatId)}`,
      tag: `cierre:${chatId}`,
    },
    supa,
  ).catch(() => undefined);
}

function puente(
  supa: SupabaseClient,
  clienteId: string,
  chatId: string,
  nombre: string | null,
  etapa: string,
  etiquetas: string[],
  ultimoMensajeEn: string,
) {
  notificarSistemaDelCliente({
    evento: "etapa",
    clienteId,
    contacto: {
      chatId,
      nombre,
      canal: chatId.startsWith("ig:") ? "instagram" : "whatsapp",
      etapa,
      etapaManual: false,
      etiquetas,
      ultimoMensajeEn,
    },
    supa,
  });
}
