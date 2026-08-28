import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { secretoValido, limitarDistribuido } from "@/lib/seguridad";
import { ipDeRequest } from "@/lib/reservasPublicas";
import { programarSeguimiento } from "@/lib/seguimientos";
import { plantillasParaRubro } from "@/lib/plantillas";
import { validarCuerpoPedido } from "@/lib/pedidosCore";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * WEBHOOK GENÉRICO DE PEDIDOS: el sistema del cliente avisa, Beto le escribe.
 *
 * POST /api/integraciones/pedidos
 *   Headers:  X-Respondo-Cliente: <uuid>   X-Respondo-Secreto: <secreto>
 *   Body:     { "chat_id": "569...", "tipo": "pedido_listo" | "encargo_llego",
 *               "detalle": "500 tarjetas" }
 *
 * POR QUÉ ES GENÉRICO Y NO UN PARCHE PARA IMPRESORA
 * -------------------------------------------------
 * El estado de un pedido vive en el sistema de CADA negocio (su ERP, su app de
 * gestión, su Excel con macros). Respondo no compite con eso — decidido en el
 * análisis contra Tecnom: NO construir DMS. Lo que Respondo pone es la capa que
 * le habla al cliente final.
 *
 * Este endpoint es el enchufe: cualquier sistema que pueda hacer un POST avisa
 * «este pedido está listo» y el motor de seguimientos hace el resto (texto
 * libre si la ventana está abierta, plantilla si no, horario hábil,
 * no_contactar, idempotencia). La app de Gestión de Impresora es el primer
 * consumidor; el argumento comercial es para todos: «ya tengo mi sistema» deja
 * de ser una objeción y pasa a ser el punto de conexión.
 *
 * SEGURIDAD
 * ---------
 * El secreto es el de `ed_integraciones` (migración 274), el mismo con el que
 * el portal firma lo que SALE hacia el sistema del cliente. Un solo secreto por
 * integración, dos direcciones. Comparación en tiempo constante y freno por IP:
 * es un endpoint público en la URL, no en la práctica.
 */
export async function POST(request: NextRequest) {
  if (!(await limitarDistribuido(`pedidos:${ipDeRequest(request.headers)}`, 30, 60)).ok) {
    return NextResponse.json({ ok: false, error: "Demasiadas peticiones" }, { status: 429 });
  }

  const clienteId = request.headers.get("x-respondo-cliente") ?? "";
  const secreto = request.headers.get("x-respondo-secreto") ?? "";
  if (!clienteId || !secreto) {
    return NextResponse.json({ ok: false, error: "Faltan credenciales" }, { status: 401 });
  }

  const supa = db();

  /**
   * La integración del cliente, con su secreto. Se listan las activas del
   * cliente y se compara contra CADA una en tiempo constante — un cliente puede
   * tener más de un sistema conectado y cualquiera de sus secretos vale.
   */
  const { data: integraciones } = await supa
    .from("ed_integraciones")
    .select("secreto")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .limit(10);

  const autorizado = (integraciones ?? []).some((i) =>
    secretoValido(secreto, i.secreto as string),
  );
  if (!autorizado) {
    return NextResponse.json({ ok: false, error: "Credenciales inválidas" }, { status: 401 });
  }

  // Validación en `lib/pedidosCore.ts` (pura y con tests): todo lo que llega de
  // un sistema externo es hostil hasta que se demuestre lo contrario.
  const v = validarCuerpoPedido(await request.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  const { chatId, tipo, detalle } = v;

  // El rubro del cliente tiene que incluir estas plantillas: si no, el envío
  // fallaría después con 132001 y nadie entendería por qué.
  const { data: cli } = await supa
    .from("ed_clientes")
    .select("nombre, rubro")
    .eq("id", clienteId)
    .maybeSingle();
  if (!cli) return NextResponse.json({ ok: false, error: "Cliente no existe" }, { status: 404 });

  const aplica = plantillasParaRubro((cli.rubro as string | null) ?? null).some(
    (p) => p.nombre === tipo,
  );
  if (!aplica) {
    return NextResponse.json(
      { ok: false, error: `El rubro "${cli.rubro}" no tiene la plantilla ${tipo}` },
      { status: 422 },
    );
  }

  /**
   * El contacto TIENE que existir: este endpoint avisa sobre conversaciones que
   * ya ocurrieron, no inicia relaciones con desconocidos. Sin esta barrera, un
   * sistema integrado con un bug podría hacer que el negocio le escribiera a
   * cualquier número — spam con el nombre del cliente.
   */
  const { data: contacto } = await supa
    .from("ed_contactos")
    .select("chat_id, nombre, etiquetas")
    .eq("cliente_id", clienteId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!contacto) {
    return NextResponse.json(
      { ok: false, error: "Ese número no tiene conversación con este negocio" },
      { status: 404 },
    );
  }
  if (((contacto.etiquetas as string[] | null) ?? []).includes("no_contactar")) {
    // 200 a propósito: para el sistema que avisa no es un error suyo, y
    // reintentar no va a cambiar nada.
    return NextResponse.json({ ok: true, omitido: "contacto marcado no_contactar" });
  }

  // El empleado que envía: Tino, para que el aviso caiga en la MISMA
  // conversación que la persona ya tiene abierta con el negocio.
  const { data: tino } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("rol", "tino")
    .eq("activo", true)
    .maybeSingle();
  if (!tino) {
    return NextResponse.json({ ok: false, error: "El cliente no tiene asistente activo" }, { status: 422 });
  }

  const r = await programarSeguimiento({
    empleadoId: tino.id as string,
    chatId,
    tipo,
    paramsPlantilla: [
      (contacto.nombre as string | null) || "hola",
      (cli.nombre as string) ?? "",
      detalle,
    ],
    programadoPara: new Date(),
    supa,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 });

  return NextResponse.json({ ok: true, programado: tipo });
}
