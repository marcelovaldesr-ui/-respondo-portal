"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { db } from "@/lib/db";
import { guardarDatosCliente } from "@/lib/clientes";
import { programarSeguimiento } from "@/lib/seguimientos";
import { limitarDistribuido } from "@/lib/seguridad";
import { ventanaAbierta } from "@/lib/ventana24";

/** Guarda nombre, teléfono, correo y notas internas de la ficha. */
export async function guardarFicha(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const usuario = await obtenerUsuarioConPermiso("editar_clientes");
  if (!usuario) return { ok: false, error: "Sesión no válida" };

  const chatId = String(formData.get("chatId") ?? "");
  if (!chatId) return { ok: false, error: "Falta el cliente" };

  const r = await guardarDatosCliente(usuario.clienteId, chatId, {
    nombre: String(formData.get("nombre") ?? ""),
    telefono: String(formData.get("telefono") ?? ""),
    email: String(formData.get("email") ?? ""),
    notas: String(formData.get("notas") ?? ""),
  });
  revalidatePath(`/clientes/${chatId}`);
  revalidatePath("/clientes");
  return r;
}

/**
 * REACTIVAR UN CLIENTE — "recalentar el lead".
 *
 * No manda nada al instante: programa un seguimiento en la cola que ya existe,
 * y de ahí sale con todas las salvaguardas puestas (horario hábil de Chile,
 * tope diario por cliente, respeto de "no contactar"). Cuando la persona
 * responde, el ruteo la deja en manos del mismo empleado que la contactó.
 *
 * Se escribe el mensaje a mano en vez de generarlo con IA: es un mensaje
 * comercial que sale a nombre del negocio, y quien conoce al cliente sabe mejor
 * que un modelo con qué excusa retomar.
 */
export async function reactivarCliente(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; aviso?: string }> {
  const usuario = await obtenerUsuarioConPermiso("editar_clientes");
  if (!usuario) return { ok: false, error: "Sesión no válida" };

  const chatId = String(formData.get("chatId") ?? "");
  const texto = String(formData.get("texto") ?? "").trim();
  if (!chatId || !texto) return { ok: false, error: "Escribe el mensaje que quieres enviar" };
  if (texto.length > 900) return { ok: false, error: "El mensaje es demasiado largo" };

  // Anti-abuso: reactivar es un mensaje saliente al WhatsApp de una persona.
  if (!(await limitarDistribuido(`reactivar:${usuario.clienteId}`, 20, 3600)).ok) {
    return { ok: false, error: "Demasiadas reactivaciones seguidas. Espera un rato." };
  }

  const supa = db();

  // El contacto tiene que ser de este negocio (barrera de acceso).
  const { data: contacto } = await supa
    .from("ed_contactos")
    .select("chat_id, etiquetas")
    .eq("cliente_id", usuario.clienteId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!contacto) return { ok: false, error: "Cliente no encontrado" };

  if (((contacto.etiquetas as string[] | null) ?? []).includes("no_contactar")) {
    return { ok: false, error: "Este cliente pidió no ser contactado." };
  }

  // Se usa el empleado de seguimiento (Beto) si existe; si no, el principal.
  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id, rol")
    .eq("cliente_id", usuario.clienteId)
    .eq("activo", true);
  const lista = empleados ?? [];
  const empleado =
    lista.find((e) => e.rol === "rita") ?? lista.find((e) => e.rol === "tino") ?? lista[0];
  if (!empleado) return { ok: false, error: "No hay un empleado digital activo" };

  // Ya en cola y sin enviar: no se duplica.
  const { data: enCola } = await supa
    .from("ed_seguimientos")
    .select("id")
    .eq("empleado_id", empleado.id as string)
    .eq("chat_id", chatId)
    .is("enviado_en", null)
    .maybeSingle();
  if (enCola) return { ok: false, error: "Ya hay un mensaje en cola para este cliente." };

  const r = await programarSeguimiento({
    empleadoId: empleado.id as string,
    chatId,
    tipo: "cliente_inactivo",
    texto,
    programadoPara: new Date(), // el cron lo toma en la próxima pasada hábil
    supa,
  });
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath(`/clientes/${chatId}`);

  /**
   * AVISO DE LA VENTANA DE 24 HORAS.
   *
   * Este mensaje lo escribe una persona a mano, así que no puede salir por una
   * plantilla aprobada. Meta solo acepta texto libre si el cliente escribió en
   * las últimas 24 h; si no, el mensaje queda esperando en la cola hasta que
   * vuelva a escribir.
   *
   * Eso pasaba igual antes, pero en silencio: la persona apretaba "enviar",
   * veía "listo" y se quedaba tranquila mientras el mensaje no salía nunca. Se
   * programa igual —si el cliente responde algo esa tarde, sale solo— pero se
   * dice lo que va a ocurrir.
   */
  const abierta = await ventanaAbierta({ clienteId: usuario.clienteId, chatId, supa });
  if (!abierta) {
    return {
      ok: true,
      aviso:
        "Guardado, pero este cliente no escribe hace más de 24 horas y WhatsApp no " +
        "permite mensajes escritos a mano fuera de ese plazo. El mensaje queda en cola " +
        "y sale solo apenas él escriba.",
    };
  }
  return { ok: true };
}
