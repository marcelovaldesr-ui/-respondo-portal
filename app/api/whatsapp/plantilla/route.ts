import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { db } from "@/lib/db";
import { guardarMensaje } from "@/lib/mensajes";
import { limitarDistribuido } from "@/lib/seguridad";
import { PLANTILLAS, limpiarParam, plantillasParaRubro, render } from "@/lib/plantillas";
import { enviarPlantilla } from "@/lib/whatsapp";
import { restaurarControl, tomarControlTemporal, transporteSalida } from "@/lib/controlChat";

export const dynamic = "force-dynamic";

/**
 * ENVIAR UNA PLANTILLA APROBADA DESDE LA BANDEJA.
 *
 * POR QUÉ HACÍA FALTA
 * -------------------
 * Pasadas 24 h desde el último mensaje del cliente, Meta rechaza cualquier texto
 * libre — **del asistente y de la persona por igual**. Hasta ahora el portal
 * avisaba de eso y no ofrecía nada: la persona escribía igual, apretaba enviar,
 * y el mensaje moría en Meta con el error 131047. Peor que bloquear, porque
 * parecía que había salido.
 *
 * Las plantillas ya están aprobadas y Beto y Vera las usan. Faltaba que una
 * persona pudiera mandarlas a mano, que es justo el caso de "quiero retomar esta
 * conversación fría ahora".
 *
 * QUÉ SE VALIDA ACÁ Y NO EN EL NAVEGADOR
 * --------------------------------------
 * El nombre de la plantilla y los parámetros llegan del cliente, así que se
 * comprueban contra el catálogo: que la plantilla exista, que la cantidad de
 * parámetros calce y que ninguno venga vacío. Meta rechazaría igual, pero con un
 * código numérico que no le dice nada a nadie; acá el error se explica.
 */
export async function POST(request: NextRequest) {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });

  if (!(await limitarDistribuido(`plantilla:${usuario.email}`, 20, 60)).ok) {
    return NextResponse.json(
      { ok: false, error: "Demasiados envíos seguidos. Espera un momento." },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    empleadoId?: string;
    chatId?: string;
    plantilla?: string;
    params?: unknown[];
  };
  const empleadoId = String(body.empleadoId ?? "");
  const chatId = String(body.chatId ?? "");
  const nombre = String(body.plantilla ?? "");
  const params = (Array.isArray(body.params) ? body.params : []).map(limpiarParam);

  if (!empleadoId || !chatId || !nombre) {
    return NextResponse.json({ ok: false, error: "Faltan datos" }, { status: 400 });
  }

  const plantilla = PLANTILLAS[nombre];
  if (!plantilla) {
    return NextResponse.json({ ok: false, error: "Esa plantilla no existe" }, { status: 400 });
  }

  /**
   * ⚠️ QUE LA PLANTILLA EXISTA EN EL CATÁLOGO NO SIGNIFICA QUE EXISTA EN SU WABA.
   *
   * Las plantillas se dan de alta **en el WABA de cada cliente**, y desde el
   * 26-ago-2026 solo se crean las de su rubro. A una imprenta nunca se le crea
   * `moto_lista`: pedirla acá saldría con el error 132001 de Meta, que dice
   * «plantilla no encontrada» y no ayuda a entender por qué.
   *
   * La lista de la bandeja ya viene filtrada, pero esta validación va igual: una
   * comprobación que solo vive en la interfaz no es una comprobación. Basta con
   * una petición armada a mano para saltarla.
   */
  const { data: cli } = await db()
    .from("ed_clientes")
    .select("rubro")
    .eq("id", usuario.clienteId)
    .maybeSingle();
  const permitidas = plantillasParaRubro((cli?.rubro as string | null) ?? null);
  if (!permitidas.some((p) => p.nombre === nombre)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Esa plantilla no está dada de alta para este negocio. " +
          "Solo salen las que corresponden a su rubro.",
      },
      { status: 400 },
    );
  }

  /**
   * El texto que se guarda sale del MISMO cuerpo aprobado que se envía. Si
   * `render` devuelve null es porque falta un dato o quedó vacío: se corta acá
   * en vez de mandar algo que Meta va a rechazar.
   */
  const texto = render(plantilla.cuerpo, params);
  if (!texto) {
    return NextResponse.json(
      { ok: false, error: "Faltan datos de la plantilla o alguno quedó vacío." },
      { status: 400 },
    );
  }

  const supa = db();
  const [{ data: empleado }, { data: contacto }] = await Promise.all([
    supa
      .from("ed_empleados")
      .select("id")
      .eq("id", empleadoId)
      .eq("cliente_id", usuario.clienteId)
      .maybeSingle(),
    supa
      .from("ed_contactos")
      .select("chat_id")
      .eq("cliente_id", usuario.clienteId)
      .eq("chat_id", chatId)
      .maybeSingle(),
  ]);
  if (!empleado || !contacto) {
    return NextResponse.json({ ok: false, error: "Sin acceso a este chat" }, { status: 403 });
  }

  const transporte = await transporteSalida(usuario.clienteId);
  if (transporte.tipo === "error") {
    return NextResponse.json({ ok: false, error: transporte.error });
  }
  if (transporte.tipo !== "cloud") {
    // En WAHA no existen las plantillas: se escribe libre y punto.
    return NextResponse.json({
      ok: false,
      error: "Este número no usa la API oficial: puedes escribir el mensaje normalmente.",
    });
  }

  const control = await tomarControlTemporal(supa, empleadoId, chatId);
  if (!control) {
    return NextResponse.json({ ok: false, error: "No se pudo tomar el control del chat" });
  }

  const envio = await enviarPlantilla(transporte.config, chatId, {
    nombre: plantilla.nombre,
    idioma: plantilla.idioma,
    params,
  });

  if (!envio.ok) {
    await restaurarControl(supa, empleadoId, chatId, control);
    /**
     * Traducir los códigos de Meta a algo que se entienda. Un «132001» en
     * pantalla no le sirve a nadie: lo que hay que saber es que esa plantilla no
     * está dada de alta en el WhatsApp de ESTE negocio.
     */
    const crudo = envio.error ?? "";
    const amable = crudo.includes("132001")
      ? "Esa plantilla todavía no está aprobada en el WhatsApp de este negocio."
      : crudo.includes("132000")
        ? "Los datos de la plantilla no calzan con la versión aprobada."
        : crudo.includes("131047")
          ? "WhatsApp no aceptó el mensaje: la conversación está fuera de plazo."
          : crudo || "No se pudo enviar la plantilla";
    return NextResponse.json({ ok: false, error: amable });
  }

  const guardado = await guardarMensaje(supa, {
    empleadoId,
    chatId,
    rol: "humano",
    texto,
    waId: envio.waId,
    canal: "whatsapp",
  });
  if (!guardado.ok) {
    return NextResponse.json({
      ok: false,
      enviado: true,
      error: "El mensaje salió, pero no se pudo registrar. Revisa el chat antes de continuar.",
    });
  }

  await supa
    .from("ed_escalaciones")
    .update({ atendida_en: new Date().toISOString() })
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .is("atendida_en", null);

  return NextResponse.json({ ok: true, texto });
}
