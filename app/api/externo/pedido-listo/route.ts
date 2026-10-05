import { db } from "@/lib/db";
import { auditarSistema } from "@/lib/auditoria";
import { limitarDistribuido } from "@/lib/seguridad";
import { ipDeRequest } from "@/lib/reservasPublicas";
import { configPorCliente, enviarPlantilla, tinoDe } from "@/lib/whatsapp";
import { plantillaPara, render, limpiarParam } from "@/lib/plantillas";
import { asegurarContacto } from "@/lib/contactoEntrante";
import { guardarMensaje } from "@/lib/mensajes";
import {
  firmaTiendaValida,
  paramsPedidoListo,
  validarAvisoTienda,
} from "@/lib/avisoTiendaCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * La TIENDA de Impresora Color avisa «pedido listo» y el portal manda la
 * plantilla aprobada por la API oficial de WhatsApp.
 *
 * POST /api/externo/pedido-listo
 *   X-IC-Timestamp / X-IC-Signature = HMAC-SHA256(secreto, `${ts}.${cuerpo}`)
 *
 * ENV (portal): TIENDA_IC_SECRET (el MISMO valor que WHATSAPP_BOT_SECRET de la
 * tienda) y, opcional, TIENDA_IC_CLIENTE_ID (por defecto Impresora Color).
 *
 * El secreto es propio de la tienda y NO el de ed_integraciones: así esta firma
 * no sirve para /api/externo/responder ni para leer conversaciones.
 *
 * Códigos: 200 enviado/duplicado/omitido · 400 cuerpo inválido · 401 firma ·
 * 409 otra llamada igual en curso · 502 Meta rechazó · 503 sin configurar.
 * A diferencia de /api/integraciones/pedidos, ENVÍA EN LÍNEA: la tienda
 * muestra «enviado por el bot» según este código, así que 200 solo si Meta
 * aceptó el mensaje.
 */

const CLIENTE_POR_DEFECTO = "33333333-3333-3333-3333-333333333333";
const ACCION_OK = "tienda_pedido_listo_ok";

function resp(status: number, cuerpo: Record<string, unknown>) {
  return Response.json(cuerpo, { status });
}

export async function POST(request: Request) {
  const secreto = process.env.TIENDA_IC_SECRET;
  if (!secreto) return resp(503, { ok: false, error: "TIENDA_IC_SECRET sin configurar" });

  if (!(await limitarDistribuido(`tienda-pl-ip:${ipDeRequest(request.headers)}`, 60, 60)).ok) {
    return resp(429, { ok: false, error: "Demasiadas peticiones" });
  }

  // Cuerpo CRUDO: la firma cubre estos bytes, no el JSON re-serializado.
  const crudo = await request.text();
  if (
    !firmaTiendaValida({
      cuerpoCrudo: crudo,
      timestamp: request.headers.get("x-ic-timestamp"),
      firma: request.headers.get("x-ic-signature"),
      secreto,
    })
  ) {
    return resp(401, { ok: false, error: "Firma inválida" });
  }

  let json: unknown;
  try {
    json = JSON.parse(crudo);
  } catch {
    return resp(400, { ok: false, error: "JSON inválido" });
  }
  const v = validarAvisoTienda(json);
  if (!v.ok) return resp(400, { ok: false, error: v.error });
  const a = v.aviso;

  const clienteId = process.env.TIENDA_IC_CLIENTE_ID || CLIENTE_POR_DEFECTO;
  const supa = db();

  // Idempotencia durable: un aviso ya enviado con esta clave no se repite.
  const { data: previo } = await supa
    .from("ed_auditoria_portal")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("accion", ACCION_OK)
    .eq("recurso_id", a.idempotencyKey)
    .limit(1)
    .maybeSingle();
  if (previo) return resp(200, { ok: true, duplicado: true });

  // Freno a dos llamadas simultáneas (doble clic) antes de que exista el registro.
  if (!(await limitarDistribuido(`tienda-pl:${a.idempotencyKey}`, 1, 30)).ok) {
    return resp(409, { ok: false, error: "Ya hay un envío en curso con esta clave" });
  }

  const { data: contacto } = await supa
    .from("ed_contactos")
    .select("etiquetas")
    .eq("cliente_id", clienteId)
    .eq("chat_id", a.telefono)
    .maybeSingle();
  if (((contacto?.etiquetas as string[] | null) ?? []).includes("no_contactar")) {
    await auditarSistema(clienteId, "tienda_pedido_listo_omitido", a.idempotencyKey);
    return resp(200, { ok: true, omitido: "contacto marcado no_contactar" });
  }

  const [{ data: cli }, cfg, pl] = await Promise.all([
    supa.from("ed_clientes").select("nombre").eq("id", clienteId).maybeSingle(),
    configPorCliente(clienteId),
    Promise.resolve(plantillaPara("pedido_listo")),
  ]);
  if (!cfg || !pl) return resp(503, { ok: false, error: "WhatsApp del negocio sin configurar" });

  const params = paramsPedidoListo(a, limpiarParam((cli?.nombre as string) || "Impresora Color")).map(limpiarParam);
  const textoFinal = render(pl.cuerpo, params);
  if (!textoFinal) return resp(400, { ok: false, error: "parámetros inválidos para la plantilla" });

  const r = await enviarPlantilla(cfg, a.telefono, { nombre: pl.nombre, idioma: pl.idioma, params });
  if (!r.ok) {
    console.error("[tienda-pedido-listo] Meta rechazó:", r.error);
    await auditarSistema(
      clienteId,
      `tienda_pedido_listo_error: ${(r.error ?? "").slice(0, 70)}`,
      a.idempotencyKey,
    );
    return resp(502, { ok: false, error: "Meta rechazó el mensaje" });
  }

  // Ya salió: lo que sigue es registro y nunca debe convertir el éxito en error.
  await auditarSistema(clienteId, ACCION_OK, a.idempotencyKey);
  try {
    const tino = await tinoDe(clienteId);
    if (tino) {
      await asegurarContacto(supa, {
        clienteId,
        chatId: a.telefono,
        nombre: a.nombre,
        telefono: `+${a.telefono}`,
      });
      await guardarMensaje(supa, {
        empleadoId: tino,
        chatId: a.telefono,
        rol: "empleado",
        texto: textoFinal,
        waId: r.waId ?? null,
      });
    }
  } catch (e) {
    console.error("[tienda-pedido-listo] no se pudo registrar en la conversación:", (e as Error).message);
  }

  return resp(200, { ok: true, enviado: true, wamid: r.waId ?? null });
}
