"use server";

import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { db } from "@/lib/db";
import { limitarDistribuido } from "@/lib/seguridad";
import { guardarMensaje } from "@/lib/mensajes";
import { enviarTexto } from "@/lib/whatsapp";
import { enviarTextoWaha } from "@/lib/waha";
import { cuentaIgDeCliente, enviarTextoInstagram } from "@/lib/instagram";
import {
  conservarPausa,
  restaurarControl,
  tomarControlTemporal,
  transporteSalida,
} from "@/lib/controlChat";
import { ventanaAbierta } from "@/lib/ventana24";
import { cerrarEscalacionesPendientes } from "@/lib/escalaciones";
import { idsEmpleadosDeCliente } from "@/lib/empleadosCache";
import { explicarErrorMeta } from "@/lib/erroresMeta";
import { mensajeDeCobro, validarCobro, type EstadoPago } from "@/lib/pagosCore";
import { cambiarEstadoPago, crearPago, linkDePago } from "@/lib/pagos";
import { programarSeguimiento } from "@/lib/seguimientos";
import { plantillasParaRubro } from "@/lib/plantillas";

/**
 * ACCIONES DE COBRO Y DE AVISO DE PEDIDO — separadas de `acciones.ts` a
 * propósito: ese archivo ya es grande y estas dos funciones tienen su propia
 * historia. El camino de envío es el MISMO que el de responder a mano
 * (transporte, control temporal, guardado con waId), calcado del que ya está
 * probado en producción.
 */

/**
 * COBRAR EN LA CONVERSACIÓN.
 *
 * Crea el registro, manda el mensaje con el enlace de pago del negocio y la
 * referencia, y toma el control del chat (quien cobra es una persona; Tino se
 * calla igual que cuando ella escribe).
 *
 * Orden deliberado: primero la fila, después el envío. Si el envío falla, la
 * fila se BORRA — nunca quedó nada comunicado al cliente, así que dejar un
 * registro sería inventar un cobro que no existió.
 */
export async function cobrarEnChat(formData: FormData): Promise<{
  ok: boolean;
  error?: string;
  referencia?: string;
}> {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) return { ok: false, error: "Sesión no válida" };

  // Más estricto que el de mensajes: cobrar no es chatear.
  if (!(await limitarDistribuido(`cobrar:${usuario.email}`, 10, 60)).ok) {
    return { ok: false, error: "Demasiados cobros seguidos. Espera un momento." };
  }

  const empleadoId = String(formData.get("empleadoId") ?? "");
  const chatId = String(formData.get("chatId") ?? "");
  const monto = Number(formData.get("monto") ?? NaN);
  const concepto = String(formData.get("concepto") ?? "");
  if (!empleadoId || !chatId) return { ok: false, error: "Faltan datos" };

  const supa = db();

  // El enlace del negocio: sin él, la función no existe para este cliente.
  const { link, nombre } = await linkDePago(usuario.clienteId, supa);
  const v = validarCobro({ monto, concepto, linkBase: link });
  if (!v.ok) return { ok: false, error: v.error };

  // Aislamiento: el empleado y el contacto tienen que ser de ESTE cliente.
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
  if (!empleado || !contacto) return { ok: false, error: "Sin acceso a este chat" };

  /**
   * ⚠️ VENTANA DE 24 H ANTES DE CREAR NADA (auditoría 27-ago).
   *
   * El cobro sale como texto libre. En Cloud, fuera de la ventana Meta lo
   * rechaza con el 131047 — el rollback ya funcionaba (fila borrada), pero la
   * persona veía el error crudo del proveedor DESPUÉS de llenar el formulario.
   * Chequear acá convierte eso en una explicación clara antes de tocar nada.
   * Se usa `ventanaAbierta` (por NÚMERO, todos los empleados), no la regla por
   * hilo — misma distinción que en el vigilante de abandonadas.
   */
  const esInstagram = chatId.startsWith("ig:");
  let transporte: Awaited<ReturnType<typeof transporteSalida>> | null = null;
  if (!esInstagram) {
    transporte = await transporteSalida(usuario.clienteId);
    if (transporte.tipo === "error") return { ok: false, error: transporte.error };
    if (transporte.tipo === "cloud") {
      const abierta = await ventanaAbierta({ clienteId: usuario.clienteId, chatId, supa });
      if (!abierta) {
        return {
          ok: false,
          error:
            "La conversación está fuera de las 24 h de WhatsApp: el cobro no llegaría. " +
            "Retómala primero con una plantilla y cobra cuando el cliente responda.",
        };
      }
    }
  }

  const creado = await crearPago({
    clienteId: usuario.clienteId,
    empleadoId,
    chatId,
    monto: v.monto,
    concepto: v.concepto,
    creadoPor: usuario.email,
    supa,
  });
  if (!creado.ok) return { ok: false, error: creado.error };

  const texto = mensajeDeCobro({
    concepto: v.concepto,
    monto: v.monto,
    referencia: creado.referencia,
    linkBase: link!,
    nombreNegocio: nombre,
  });

  /** Si algo falla desde acá, el cobro no existió: se borra la fila. */
  const deshacer = () => supa.from("ed_pagos").delete().eq("id", creado.id);

  const control = await tomarControlTemporal(supa, empleadoId, chatId);
  if (!control) {
    await deshacer();
    return { ok: false, error: "No se pudo tomar el control del chat" };
  }

  // Mismo ruteo de canal que responderComoHumano (incluido el bug de Instagram
  // del 17-ago: un chat ig: mandado por WhatsApp muere en silencio). El
  // transporte ya se resolvió arriba, junto con el chequeo de ventana.
  let envio: { ok: boolean; waId?: string; error?: string };
  if (esInstagram) {
    const cuenta = await cuentaIgDeCliente(usuario.clienteId);
    if (!cuenta) {
      await restaurarControl(supa, empleadoId, chatId, control);
      await deshacer();
      return { ok: false, error: "Este negocio no tiene Instagram conectado" };
    }
    envio = await enviarTextoInstagram(cuenta, chatId.slice(3), texto, { sinEspera: true });
  } else if (transporte!.tipo === "cloud") {
    envio = await enviarTexto(transporte!.config, chatId, texto, { sinEspera: true });
  } else {
    envio = await enviarTextoWaha(chatId, texto, { clienteId: usuario.clienteId });
  }

  if (!envio.ok) {
    await restaurarControl(supa, empleadoId, chatId, control);
    await deshacer();
    return { ok: false, error: explicarErrorMeta(envio.error, "cobro") };
  }

  // Con el waId, el eco de Coexistencia se reconoce y no se duplica (1-ago).
  const guardado = await guardarMensaje(supa, {
    empleadoId,
    chatId,
    rol: "humano",
    texto,
    waId: envio.waId,
    canal: esInstagram ? "instagram" : "whatsapp",
  });
  if (!guardado.ok) {
    // El cobro SÍ salió (y la fila existe): no se deshace. Pero sin el mensaje
    // en el historial la IA no sabría que se cobró, así que se avisa.
    return {
      ok: false,
      referencia: creado.referencia,
      error:
        "El cobro salió, pero no se pudo registrar el mensaje en la conversación. " +
        "Revisa el chat antes de continuar.",
    };
  }

  // Cobrar es atender: se cierra la derivación pendiente, por chat.
  await cerrarEscalacionesPendientes(supa, {
    empleadoIds: await idsEmpleadosDeCliente(usuario.clienteId),
    chatId,
    clienteId: usuario.clienteId,
  });
  await conservarPausa(supa, empleadoId, chatId, control);

  return { ok: true, referencia: creado.referencia };
}

/** Marcar pagado o anular, respetando las transiciones de pagosCore. */
export async function marcarPago(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) return { ok: false, error: "Sesión no válida" };

  const pagoId = String(formData.get("pagoId") ?? "");
  const desde = String(formData.get("desde") ?? "") as EstadoPago;
  const hacia = String(formData.get("hacia") ?? "") as EstadoPago;
  if (!pagoId || !desde || !hacia) return { ok: false, error: "Faltan datos" };

  return cambiarEstadoPago({ clienteId: usuario.clienteId, pagoId, desde, hacia });
}

/**
 * AVISAR QUE EL PEDIDO ESTÁ LISTO — el camino UNIVERSAL, sin sistema externo.
 *
 * Para el negocio que no tiene ERP ni quiere tenerlo: un botón en la
 * conversación. Se programa el seguimiento `pedido_listo` y el motor de
 * siempre decide cómo sale (texto libre con la ventana abierta, plantilla si
 * está cerrada) con todas sus salvaguardas: horario hábil, no_contactar,
 * reintentos.
 *
 * No se envía directo a propósito: el motor ya resuelve la parte difícil
 * (ventana, plantilla, idempotencia) y duplicar ese criterio acá es cómo dos
 * caminos divergen con el tiempo. El costo es hasta 5 minutos de espera del
 * cron — para «tu pedido está listo», irrelevante.
 */
export async function avisarPedidoListo(formData: FormData): Promise<{
  ok: boolean;
  error?: string;
}> {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) return { ok: false, error: "Sesión no válida" };

  if (!(await limitarDistribuido(`pedido:${usuario.email}`, 20, 60)).ok) {
    return { ok: false, error: "Demasiados avisos seguidos. Espera un momento." };
  }

  const empleadoId = String(formData.get("empleadoId") ?? "");
  const chatId = String(formData.get("chatId") ?? "");
  const detalle = String(formData.get("detalle") ?? "").trim().slice(0, 80) || "tu pedido";
  if (!empleadoId || !chatId) return { ok: false, error: "Faltan datos" };

  const supa = db();
  const { data: cli } = await supa
    .from("ed_clientes")
    .select("nombre, rubro")
    .eq("id", usuario.clienteId)
    .maybeSingle();

  // Solo rubros cuyo catálogo incluye la plantilla: a una clínica dental este
  // botón no le corresponde y ofrecerlo sería ofrecer un error futuro.
  const aplica = plantillasParaRubro((cli?.rubro as string | null) ?? null).some(
    (p) => p.nombre === "pedido_listo",
  );
  if (!aplica) return { ok: false, error: "Este rubro no usa avisos de pedido." };

  const { data: contacto } = await supa
    .from("ed_contactos")
    .select("nombre")
    .eq("cliente_id", usuario.clienteId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!contacto) return { ok: false, error: "Sin acceso a este chat" };

  /**
   * ⚠️ IDEMPOTENCIA (auditoría 27-ago): `programarSeguimiento` NO deduplica —
   * el punto manual de clientes/acciones lo chequea aparte, y acá faltaba. Sin
   * esto, tocar el botón dos veces (o volver al chat y repetir) = DOS «tu
   * pedido está listo» al mismo cliente, con cinco minutos de diferencia.
   */
  const { data: enCola } = await supa
    .from("ed_seguimientos")
    .select("id")
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .eq("tipo", "pedido_listo")
    .is("enviado_en", null)
    .limit(1)
    .maybeSingle();
  if (enCola) return { ok: true }; // ya está en cola: repetirlo no aporta

  const r = await programarSeguimiento({
    empleadoId,
    chatId,
    tipo: "pedido_listo",
    paramsPlantilla: [
      (contacto.nombre as string | null) || "hola",
      (cli?.nombre as string) ?? "",
      detalle,
    ],
    programadoPara: new Date(),
    supa,
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}
