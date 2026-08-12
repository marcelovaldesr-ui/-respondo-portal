import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { permisosDeGestion, tokenConFormato, type PoliticaAutogestion } from "@/lib/autogestion";
import { cambiarEstado, reagendar, disponibilidad } from "@/lib/agenda";
import { anularSeguimientosDeCita, programarSeguimientosCita } from "@/lib/agendaSeguimientos";

/**
 * CAPA DE DATOS de la autogestión (migración 277).
 *
 * El token de la cita es la ÚNICA credencial: no hay sesión ni contraseña. Por
 * eso todo lo que se expone acá está pensado para que, si alguien consigue un
 * enlace, no obtenga más de lo que ya sabía la persona que reservó.
 *
 * EN CONCRETO, lo que NO se devuelve nunca:
 *  - el teléfono ni el chat_id de quien reservó (el enlace podría reenviarse)
 *  - las notas internas del negocio sobre la cita
 *  - la ficha con los datos personales (RUT, previsión, etc.)
 *  - ningún id interno de cliente, servicio o profesional
 */

export type CitaGestionable = {
  nombreContacto: string;
  servicioNombre: string;
  profesionalNombre: string | null;
  inicioIso: string;
  duracionMin: number;
  precioClp: number | null;
  estado: string;
  negocio: { nombre: string; slug: string | null; whatsapp: string | null };
  politica: PoliticaAutogestion;
};

/** Datos internos que la capa de acciones necesita y la vista NO debe ver. */
type CitaInterna = {
  id: string;
  clienteId: string;
  servicioId: string;
  estado: string;
  inicioIso: string;
  politica: PoliticaAutogestion;
};

function politicaDe(cliente: Record<string, unknown>): PoliticaAutogestion {
  return {
    // Defaults inocuos si la migración 277 aún no se aplicó: se comporta como
    // hoy (sin autogestión) en vez de abrir permisos por accidente.
    permiteCancelar: cliente.permite_cancelar_online === true,
    permiteReagendar: cliente.permite_reagendar_online === true,
    cancelacionMinHoras:
      typeof cliente.cancelacion_min_horas === "number" ? cliente.cancelacion_min_horas : 4,
  };
}

/** Teléfono del negocio para el enlace "escríbenos" (solo dígitos). */
function whatsappDe(cliente: Record<string, unknown>): string | null {
  const t = cliente.telefono_escalacion;
  if (!Array.isArray(t) || !t.length) return null;
  const d = String(t[0] ?? "").replace(/\D/g, "");
  return d || null;
}

async function buscar(
  token: string,
  supa: SupabaseClient,
): Promise<{ vista: CitaGestionable; interna: CitaInterna } | null> {
  // Formato antes que consulta: un escaneo de URLs no debe costarnos una
  // consulta por intento.
  if (!tokenConFormato(token)) return null;

  // Tipos explícitos: con joins, el cliente de Supabase infiere una unión que
  // incluye su tipo de error y hace ruido en todo el archivo.
  type FilaCita = {
    id: string;
    cliente_id: string;
    servicio_id: string;
    nombre_contacto: string;
    inicio: string;
    estado: string;
    ed_servicios: { nombre: string; duracion_min: number; precio_clp: number | null } | null;
    ed_profesionales: { nombre: string } | null;
  };

  const { data: filaCruda, error } = await supa
    .from("ed_citas")
    .select(
      "id, cliente_id, servicio_id, nombre_contacto, inicio, fin, estado, " +
        "ed_servicios(nombre, duracion_min, precio_clp), ed_profesionales(nombre)",
    )
    .eq("gestion_token", token)
    .maybeSingle();
  if (error || !filaCruda) return null;
  const cita = filaCruda as unknown as FilaCita;

  const { data: clienteCrudo } = await supa
    .from("ed_clientes")
    .select(
      "id, nombre, slug, activo, telefono_escalacion, " +
        "permite_cancelar_online, permite_reagendar_online, cancelacion_min_horas",
    )
    .eq("id", cita.cliente_id)
    .maybeSingle();
  if (!clienteCrudo) return null;
  const cliente = clienteCrudo as unknown as Record<string, unknown>;
  if (cliente.activo === false) return null;

  const svc = cita.ed_servicios;
  const prof = cita.ed_profesionales;
  const politica = politicaDe(cliente);

  return {
    vista: {
      nombreContacto: cita.nombre_contacto,
      servicioNombre: svc?.nombre ?? "Tu hora",
      profesionalNombre: prof?.nombre ?? null,
      inicioIso: cita.inicio,
      duracionMin: svc?.duracion_min ?? 30,
      precioClp: svc?.precio_clp ?? null,
      estado: cita.estado,
      negocio: {
        nombre: (cliente.nombre as string) ?? "",
        slug: (cliente.slug as string) ?? null,
        whatsapp: whatsappDe(cliente),
      },
      politica,
    },
    interna: {
      id: cita.id,
      clienteId: cita.cliente_id,
      servicioId: cita.servicio_id,
      estado: cita.estado,
      inicioIso: cita.inicio,
      politica,
    },
  };
}

/** Lo que ve la página pública. Null = token inválido (no distinguimos por qué). */
export async function citaPorToken(
  token: string,
  supa: SupabaseClient = db(),
): Promise<CitaGestionable | null> {
  const r = await buscar(token, supa);
  return r?.vista ?? null;
}

export type ResultadoGestion =
  | { ok: true; mensaje: string }
  | { ok: false; error: string };

/** Cancela la hora si la política lo permite. */
export async function cancelarPorToken(
  token: string,
  supa: SupabaseClient = db(),
): Promise<ResultadoGestion> {
  const r = await buscar(token, supa);
  if (!r) return { ok: false, error: "Este enlace no es válido." };

  // La política se re-evalúa acá, en el servidor. Que el botón se haya visto
  // habilitado en el navegador no prueba nada: la pestaña pudo quedar abierta
  // horas y cruzar el plazo de corte.
  const permisos = permisosDeGestion(
    { estado: r.interna.estado, inicioIso: r.interna.inicioIso },
    r.interna.politica,
  );
  if (!permisos.cancelar.permitido) {
    return { ok: false, error: permisos.cancelar.motivo ?? "No se puede anular por internet." };
  }

  const res = await cambiarEstado(r.interna.clienteId, r.interna.id, "cancelada", supa);
  if (!res.ok) return { ok: false, error: "No pudimos anular la hora. Intenta de nuevo." };

  // Sin esto le seguirían llegando el recordatorio y la encuesta de una hora
  // que ella misma anuló — el tipo de detalle que hace desconfiar del sistema.
  await anularSeguimientosDeCita(r.interna.id, supa).catch(() => undefined);

  return { ok: true, mensaje: "Tu hora quedó anulada." };
}

/** Cupos a los que se puede mover esta cita (mismo servicio). */
export async function cuposParaReagendar(
  token: string,
  supa: SupabaseClient = db(),
): Promise<{ ok: true; slots: { inicio: string }[] } | { ok: false; error: string }> {
  const r = await buscar(token, supa);
  if (!r) return { ok: false, error: "Este enlace no es válido." };

  const permisos = permisosDeGestion(
    { estado: r.interna.estado, inicioIso: r.interna.inicioIso },
    r.interna.politica,
  );
  if (!permisos.reagendar.permitido) {
    return { ok: false, error: permisos.reagendar.motivo ?? "No se puede mover por internet." };
  }

  const disp = await disponibilidad(r.interna.clienteId, r.interna.servicioId, {
    maxSlots: 120,
    supa,
  });
  if (!disp.ok) return { ok: false, error: "No pudimos cargar los horarios." };

  // Se devuelve SOLO el instante. El profesional lo elige el servidor al
  // confirmar: exponer profesionalId acá permitiría que alguien eligiera con
  // quién atenderse saltándose las reglas del negocio.
  return { ok: true, slots: disp.slots.map((s) => ({ inicio: s.inicio })) };
}

/** Mueve la hora a un cupo nuevo, validando que sea uno realmente ofrecido. */
export async function reagendarPorToken(
  token: string,
  nuevoInicioIso: string,
  supa: SupabaseClient = db(),
): Promise<ResultadoGestion> {
  const r = await buscar(token, supa);
  if (!r) return { ok: false, error: "Este enlace no es válido." };

  const permisos = permisosDeGestion(
    { estado: r.interna.estado, inicioIso: r.interna.inicioIso },
    r.interna.politica,
  );
  if (!permisos.reagendar.permitido) {
    return { ok: false, error: permisos.reagendar.motivo ?? "No se puede mover por internet." };
  }

  const disp = await disponibilidad(r.interna.clienteId, r.interna.servicioId, {
    maxSlots: 200,
    supa,
  });
  if (!disp.ok) return { ok: false, error: "No pudimos cargar los horarios." };

  // El instante tiene que ser uno de los que el SERVIDOR ofreció. Sin esta
  // comprobación se podría mover la hora a las 3 de la mañana mandando el POST
  // a mano — la misma barrera que ya usa la reserva pública.
  const elegido = disp.slots.find((s) => s.inicio === nuevoInicioIso);
  if (!elegido) {
    return { ok: false, error: "Ese horario ya no está disponible. Elige otro, por favor." };
  }

  const res = await reagendar(r.interna.clienteId, r.interna.id, nuevoInicioIso, supa);
  if (!res.ok) {
    if (res.motivo === "cupo_tomado") {
      return { ok: false, error: "Ese horario se acaba de ocupar. Elige otro, por favor." };
    }
    return { ok: false, error: "No pudimos mover la hora. Intenta de nuevo." };
  }

  // Reprogramar recordatorios a la hora nueva (los viejos ya no sirven).
  await anularSeguimientosDeCita(r.interna.id, supa).catch(() => undefined);
  await programarSeguimientosCita({
    cita: res.cita,
    servicioNombre: r.vista.servicioNombre,
    clienteId: r.interna.clienteId,
    supa,
  }).catch(() => 0);

  return { ok: true, mensaje: "Tu hora quedó cambiada." };
}
