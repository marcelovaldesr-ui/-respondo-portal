import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { plantillaPara, render, limpiarParam } from "@/lib/plantillas";

/**
 * MOTOR DE SEGUIMIENTOS PROGRAMADOS (tabla ed_seguimientos).
 *
 * Es la pieza que comparten dos features vendibles:
 *  - Recordatorio/confirmación de citas (feature #1 de compra del vertical
 *    clínicas según el análisis competitivo del 30-jul).
 *  - Reactivación de cotizaciones sin respuesta (rol de Beto).
 *
 * DISEÑO (patrón del prompt de Beto/rita: "el primer mensaje siempre es una
 * plantilla del sistema — tú entras cuando la persona RESPONDE"):
 *  1. Algo (una feature, una persona, un flujo) INSERTA una fila en
 *     ed_seguimientos con programado_para y el texto en variables.texto.
 *  2. El cron (app/api/cron/seguimientos) envía los vencidos respetando
 *     horario hábil de Chile, tope diario y max_intentos.
 *  3. Cuando el cliente RESPONDE, el inbound rutea la conversación al
 *     empleado del seguimiento (Beto/Vera) — no a Tino — y su cerebro
 *     continúa (ver empleadoParaEntrante).
 *
 * El motor es INERTE por defecto: no genera seguimientos solo. Para la
 * imprenta (solo Tino) simplemente no se programan filas.
 */

export type Seguimiento = {
  id: string;
  empleado_id: string;
  chat_id: string;
  tipo: string;
  plantilla_meta: string | null;
  variables: Record<string, unknown> | null;
  programado_para: string;
  enviado_en: string | null;
  respuesta_recibida: boolean | null; // boolean en el esquema (no timestamp)
  max_intentos: number | null;
  intento: number | null;
};

/** Hora local de Chile (maneja DST vía Intl). */
export function horaChile(d = new Date()): number {
  const s = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    hour: "numeric",
    hour12: false,
  }).format(d);
  return Number(s);
}

/** ¿Estamos en horario hábil para mensajes proactivos? (10:00–18:59 Chile) */
export function enHorarioHabil(d = new Date()): boolean {
  const h = horaChile(d);
  return h >= 10 && h < 19;
}

/**
 * Programa un seguimiento.
 *
 * Hay dos formas de llamarlo, y la diferencia decide si el mensaje puede salir
 * fuera de la ventana de 24 h:
 *
 *  A) Con `paramsPlantilla`: el texto se RENDERIZA desde el cuerpo aprobado en
 *     Meta (lib/plantillas.ts). Sirve dentro y fuera de la ventana. Es la forma
 *     que usan Beto y Vera, y la que hay que usar siempre que se pueda.
 *
 *  B) Solo con `texto`: texto libre. Sale únicamente si el cliente escribió en
 *     las últimas 24 h; si no, el cron lo deja pendiente y lo dice en el
 *     detalle. Queda para el botón manual de reactivación del portal, donde la
 *     persona escribe el mensaje a mano.
 *
 * En el caso A el `texto` guardado y el cuerpo enviado son literalmente lo
 * mismo, así que el portal muestra lo que le llegó al cliente.
 */
export async function programarSeguimiento(params: {
  empleadoId: string;
  chatId: string;
  tipo: string; // ej: 'recordatorio_cita' | 'cotizacion_sin_respuesta'
  texto?: string;
  paramsPlantilla?: string[];
  programadoPara: Date;
  plantillaMeta?: string; // fuerza una plantilla distinta a la del tipo
  maxIntentos?: number;
  supa?: SupabaseClient;
}): Promise<{ ok: boolean; error?: string }> {
  const supa = params.supa ?? db();

  let plantillaNombre = "texto_libre";
  let texto = params.texto ?? "";
  let paramsLimpios: string[] | null = null;

  if (params.paramsPlantilla) {
    const pl = plantillaPara(params.plantillaMeta ?? params.tipo);
    if (!pl) {
      return { ok: false, error: `no hay plantilla para el tipo "${params.tipo}"` };
    }
    paramsLimpios = params.paramsPlantilla.map(limpiarParam);
    const renderizado = render(pl.cuerpo, paramsLimpios);
    if (!renderizado) {
      // Un parámetro vacío o de menos. Mejor no programar nada que dejar una
      // fila que va a fallar recién dentro de tres días, cuando venza.
      return { ok: false, error: `parámetros inválidos para la plantilla ${pl.nombre}` };
    }
    plantillaNombre = pl.nombre;
    texto = renderizado;
  } else if (params.plantillaMeta) {
    plantillaNombre = params.plantillaMeta;
  }

  if (!texto.trim()) return { ok: false, error: "seguimiento sin texto" };

  const { error } = await supa.from("ed_seguimientos").insert({
    empleado_id: params.empleadoId,
    chat_id: params.chatId,
    tipo: params.tipo,
    // NOT NULL en el esquema. 'texto_libre' = solo dentro de la ventana de 24h.
    plantilla_meta: plantillaNombre,
    variables: { texto, ...(paramsLimpios ? { params: paramsLimpios } : {}) },
    programado_para: params.programadoPara.toISOString(),
    max_intentos: params.maxIntentos ?? 1,
    intento: 0,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Procesa los seguimientos vencidos y los envía.
 *
 * Salvaguardas (innegociables para la vía no oficial):
 *  - Solo en horario hábil de Chile (si no, no hace nada y lo dice).
 *  - Tope diario de envíos proactivos (SEGUIMIENTOS_MAX_DIA, default 15).
 *  - Respeta max_intentos y no reenvía lo ya enviado.
 *  - Respeta la etiqueta 'no_contactar' del contacto.
 *
 * `enviar` se inyecta (mismo patrón de responderBot): en producción es el
 * transporte real; en tests, un mock. Devuelve el resumen de lo hecho.
 */
export async function procesarSeguimientos(opts: {
  /**
   * El transporte. Recibe además la plantilla y sus parámetros para poder
   * elegir entre texto libre y plantilla según la ventana de 24 h. Puede
   * devolver `omitido: true` cuando decide no enviar todavía (por ejemplo, un
   * texto libre con la ventana cerrada): en ese caso la fila NO se marca como
   * enviada y se reintenta en la próxima pasada.
   */
  enviar: (
    empleadoId: string,
    chatId: string,
    texto: string,
    extra: { tipo: string; plantilla: string; params: string[] },
  ) => Promise<{ ok: boolean; waId?: string; error?: string; omitido?: boolean }>;
  ahora?: Date;
  limite?: number;
  supa?: SupabaseClient;
}): Promise<{ enviados: number; detalle: string[] }> {
  const supa = opts.supa ?? db();
  const ahora = opts.ahora ?? new Date();
  const detalle: string[] = [];

  if (!enHorarioHabil(ahora)) {
    return { enviados: 0, detalle: [`fuera_horario (hora Chile: ${horaChile(ahora)})`] };
  }

  const maxDia = Number(process.env.SEGUIMIENTOS_MAX_DIA ?? 15);
  const hoy = new Date(ahora);
  hoy.setUTCHours(0, 0, 0, 0);

  const { data: pendientes, error } = await supa
    .from("ed_seguimientos")
    .select("*")
    .is("enviado_en", null)
    .lte("programado_para", ahora.toISOString())
    .order("programado_para", { ascending: true })
    .limit(opts.limite ?? 10);
  if (error) return { enviados: 0, detalle: [`error_lectura: ${error.message}`] };
  if (!pendientes?.length) return { enviados: 0, detalle: ["sin_pendientes"] };

  /**
   * TOPE DIARIO POR CLIENTE (corregido en la auditoría del 31-jul).
   *
   * Antes se contaban los envíos del día de TODOS los clientes contra un mismo
   * tope. Con un cliente no se notaba, pero al entrar el segundo los envíos de
   * uno le habrían consumido la cuota al otro —y el afectado nunca se enteraría
   * de por qué su asistente dejó de hacer seguimientos—. El tope existe para
   * cuidar CADA número de WhatsApp, así que tiene que contarse por cliente.
   */
  const enviadosHoyPorCliente = new Map<string, number>();
  const clientePorEmpleado = new Map<string, string>();
  const empleadosDeLaTanda = [...new Set((pendientes as Seguimiento[]).map((s) => s.empleado_id))];
  if (empleadosDeLaTanda.length) {
    const { data: emps } = await supa
      .from("ed_empleados")
      .select("id, cliente_id")
      .in("id", empleadosDeLaTanda);
    for (const e of emps ?? []) clientePorEmpleado.set(e.id as string, e.cliente_id as string);

    /**
     * CUÁNTO SE ENVIÓ HOY, POR CLIENTE — EN DOS CONSULTAS, NO EN 2×N.
     *
     * Antes esto era un bucle: por CADA cliente de la tanda se pedían sus
     * empleados y después su conteo del día. Con 3 clientes eran 6 consultas y
     * no se notaba; con 30 son 60, en serie, dentro de un cron que además tiene
     * un techo de tiempo. Es de los errores que no duelen hasta que el negocio
     * funciona — y ahí duelen justo cuando menos conviene.
     *
     * Ahora: una consulta trae TODOS los empleados de TODOS los clientes de la
     * tanda, y otra trae los envíos de hoy de todos esos empleados. El conteo
     * por cliente se arma en memoria, que es gratis.
     */
    const clientes = [...new Set(clientePorEmpleado.values())];
    if (clientes.length) {
      const { data: todosLosEmpleados } = await supa
        .from("ed_empleados")
        .select("id, cliente_id")
        .in("cliente_id", clientes);

      // empleado → cliente, para poder atribuir cada envío sin volver a consultar.
      const duenoDe = new Map<string, string>();
      for (const e of todosLosEmpleados ?? []) {
        duenoDe.set(e.id as string, e.cliente_id as string);
      }
      for (const cid of clientes) enviadosHoyPorCliente.set(cid, 0);

      const idsTodos = [...duenoDe.keys()];
      if (idsTodos.length) {
        const { data: enviadosHoy } = await supa
          .from("ed_seguimientos")
          .select("empleado_id")
          .in("empleado_id", idsTodos)
          .gte("enviado_en", hoy.toISOString());

        for (const fila of enviadosHoy ?? []) {
          const cid = duenoDe.get(fila.empleado_id as string);
          if (cid) enviadosHoyPorCliente.set(cid, (enviadosHoyPorCliente.get(cid) ?? 0) + 1);
        }
      }
    }
  }

  let enviados = 0;
  for (const s of pendientes as Seguimiento[]) {
    const intento = (s.intento ?? 0) + 1;
    if (intento > (s.max_intentos ?? 1)) {
      detalle.push(`${s.id.slice(0, 8)}: max_intentos superado, omitido`);
      continue;
    }

    // Cuota del cliente dueño de este seguimiento (no una bolsa compartida).
    const cidDueno = clientePorEmpleado.get(s.empleado_id);
    if (cidDueno) {
      const yaHoy = enviadosHoyPorCliente.get(cidDueno) ?? 0;
      if (yaHoy >= maxDia) {
        detalle.push(`${s.id.slice(0, 8)}: tope diario del cliente alcanzado`);
        continue;
      }
    }

    // Respeto de 'no_contactar' (etiqueta del contacto del cliente dueño).
    const { data: emp } = await supa
      .from("ed_empleados")
      .select("cliente_id")
      .eq("id", s.empleado_id)
      .maybeSingle();
    if (emp?.cliente_id) {
      const { data: cont } = await supa
        .from("ed_contactos")
        .select("etiquetas")
        .eq("cliente_id", emp.cliente_id)
        .eq("chat_id", s.chat_id)
        .maybeSingle();
      const etiquetas = (cont?.etiquetas as string[] | null) ?? [];
      if (etiquetas.includes("no_contactar")) {
        // Se marca como enviado con nota para que no se reintente jamás.
        await supa
          .from("ed_seguimientos")
          .update({ enviado_en: ahora.toISOString(), intento })
          .eq("id", s.id);
        detalle.push(`${s.id.slice(0, 8)}: no_contactar, cancelado`);
        continue;
      }
    }

    const texto = String((s.variables as { texto?: string } | null)?.texto ?? "").trim();
    if (!texto) {
      detalle.push(`${s.id.slice(0, 8)}: sin variables.texto, omitido`);
      continue;
    }

    const vars = (s.variables as { params?: unknown } | null) ?? {};
    const params = Array.isArray(vars.params) ? (vars.params as string[]).map(String) : [];
    const plantilla = s.plantilla_meta ?? "texto_libre";

    const r = await opts.enviar(s.empleado_id, s.chat_id, texto, {
      tipo: s.tipo,
      plantilla,
      params,
    });
    if (r.omitido) {
      // No es un fallo: el transporte decidió esperar. El intento NO se
      // consume, porque si se consumiera un seguimiento con max_intentos = 1
      // moriría por el solo hecho de haber pasado por acá con la ventana
      // cerrada, sin haberle escrito nunca a nadie.
      detalle.push(`${s.id.slice(0, 8)}: pospuesto (${r.error ?? "sin ventana"})`);
      continue;
    }
    if (!r.ok) {
      detalle.push(`${s.id.slice(0, 8)}: envío falló (${r.error ?? "?"})`);
      continue;
    }

    // Guardar el mensaje en el hilo del EMPLEADO del seguimiento (así la
    // conversación aparece bajo Beto/Vera en el portal, no bajo Tino).
    await supa.from("ed_mensajes").insert({
      empleado_id: s.empleado_id,
      chat_id: s.chat_id,
      rol: "empleado",
      texto,
      canal: "whatsapp",
      ...(r.waId ? { wa_message_id: r.waId } : {}),
    });

    await supa
      .from("ed_seguimientos")
      .update({ enviado_en: ahora.toISOString(), intento })
      .eq("id", s.id);

    enviados += 1;
    if (cidDueno) {
      enviadosHoyPorCliente.set(cidDueno, (enviadosHoyPorCliente.get(cidDueno) ?? 0) + 1);
    }
    detalle.push(`${s.id.slice(0, 8)}: enviado (${s.tipo})`);
  }

  return { enviados, detalle };
}

/**
 * RUTEO DE RESPUESTAS: decide qué empleado atiende un mensaje ENTRANTE.
 *
 * Si el chat tiene un seguimiento enviado hace <72h sin respuesta registrada,
 * la conversación es de ESE empleado (Beto/Vera continúan lo que iniciaron) y
 * se marca respuesta_recibida. Si no, se usa el fallback (Tino).
 *
 * Defensivo: ante cualquier error devuelve el fallback — jamás se pierde un
 * mensaje por culpa del ruteo.
 */
export async function empleadoParaEntrante(
  clienteId: string,
  chatId: string,
  fallback: string | null,
  supa?: SupabaseClient,
): Promise<string | null> {
  try {
    const s = supa ?? db();
    const desde = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    const { data } = await s
      .from("ed_seguimientos")
      .select("id, empleado_id, ed_empleados!inner(cliente_id)")
      .eq("chat_id", chatId)
      .eq("ed_empleados.cliente_id", clienteId)
      .not("enviado_en", "is", null)
      .eq("respuesta_recibida", false) // boolean en el esquema
      .gte("enviado_en", desde)
      .order("enviado_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return fallback;
    await s
      .from("ed_seguimientos")
      .update({ respuesta_recibida: true })
      .eq("id", data.id);
    return data.empleado_id as string;
  } catch {
    return fallback;
  }
}
