import { db } from "@/lib/db";
import { generarJSON } from "@/lib/gemini";
import { ZONA } from "@/lib/fechas";
import {
  armarConversaciones,
  armarPromptDestilado,
  normalizarHechos,
  type HechoSabido,
  type MensajeIsabel,
} from "@/lib/isabelCore";

/**
 * EL DESTILADO NOCTURNO — cómo Isabel deja de arrancar de cero.
 *
 * Cada noche lee las conversaciones del día y las convierte en hechos que van a
 * seguir siendo ciertos en tres meses: cómo llama la gente a los productos, qué
 * objeción aparece siempre, qué precios circulan, qué no supo contestar el
 * asistente. Eso se acumula en `ed_isabel_saber`, y ella lo lee ANTES que el
 * historial crudo.
 *
 * ⭐ LO QUE HACE QUE ESTO FUNCIONE ES LA FUSIÓN, NO LA EXTRACCIÓN.
 * Si cada noche insertara sus hallazgos, en un mes habría trescientas frases
 * parecidas y ninguna sabría cuál importa. La `clave` que devuelve el modelo
 * —una etiqueta corta y estable— es la llave: mismo tipo + misma clave = el
 * mismo hecho, y en vez de duplicarlo se le suma una observación. Así «la gente
 * pregunta por envío a regiones» pasa de ser una frase suelta a decir
 * «observado 14 veces», que es lo que la vuelve accionable.
 *
 * SE ENGANCHA AL CRON QUE YA EXISTE (`/api/cron/seguimientos`), igual que el
 * informe semanal: un solo disparador externo que mantener. Ver insightsAuto.ts,
 * de donde sale la forma de este archivo.
 *
 * REGLAS DE CONVIVENCIA CON EL CRON — las mismas del informe semanal:
 *  · Corre una vez al día, de madrugada. El resto del día retorna al instante.
 *  · Idempotente: la llave única (cliente, día) impide destilar dos veces.
 *  · Pocos clientes por corrida; lo que no alcanza sale en el latido siguiente.
 *  · NUNCA revienta: cualquier error se registra y se devuelve. Esta función
 *    comparte endpoint con los recordatorios de cita, que son los que un
 *    cliente está esperando a una hora exacta.
 */

/** Hora de Chile a la que corre. De madrugada: el día ya está cerrado. */
const HORA_DESTILADO = 4;

/** Mensajes mínimos para que valga la pena. Bajo esto no hay patrón que sacar. */
const MINIMO_MENSAJES = 25;

/** Clientes por corrida. Cada destilado es una llamada larga al modelo. */
const MAX_CLIENTES = 2;

function diaChile(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** ¿Es la madrugada en Chile? */
export function esHoraDeDestilar(d = new Date()): boolean {
  const hora = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONA,
      hour: "2-digit",
      hour12: false,
    }).format(d),
  );
  return hora === HORA_DESTILADO;
}

/**
 * Funde los hechos nuevos con lo que ya se sabía.
 *
 * Se hace fila por fila y no con un `upsert` masivo a propósito: `veces` tiene
 * que INCREMENTARSE sobre el valor actual, y un upsert lo pisaría con 1,
 * borrando justamente el dato que le da valor a la tabla.
 */
async function fundirHechos(
  clienteId: string,
  dia: string,
  hechos: HechoSabido[],
): Promise<{ nuevos: number; vistos: number }> {
  const supa = db();
  let nuevos = 0;
  let vistos = 0;

  for (const h of hechos) {
    try {
      const { data: previo } = await supa
        .from("ed_isabel_saber")
        .select("id, veces")
        .eq("cliente_id", clienteId)
        .eq("tipo", h.tipo)
        .eq("clave", h.clave)
        .maybeSingle();

      if (previo?.id) {
        await supa
          .from("ed_isabel_saber")
          .update({
            veces: (Number(previo.veces) || 1) + 1,
            ultima_vez: dia,
            // El texto se refresca: la última redacción suele ser la mejor,
            // porque el modelo ya vio el patrón más veces.
            texto: h.texto,
            activo: true,
          })
          .eq("id", previo.id);
        vistos += 1;
      } else {
        await supa.from("ed_isabel_saber").insert({
          cliente_id: clienteId,
          tipo: h.tipo,
          clave: h.clave,
          texto: h.texto,
          veces: 1,
          primera_vez: dia,
          ultima_vez: dia,
        });
        nuevos += 1;
      }
    } catch {
      // Un hecho que no se pudo guardar no puede voltear la corrida entera.
    }
  }

  return { nuevos, vistos };
}

/** Destila UN día de UN cliente. Devuelve el motivo cuando no hizo nada. */
export async function destilarDia(
  clienteId: string,
  dia: string,
  opts?: { fechaLimite?: number },
): Promise<{ ok: boolean; motivo?: string; omitido?: boolean; nuevos?: number; vistos?: number }> {
  const supa = db();

  const { data: cliente } = await supa
    .from("ed_clientes")
    .select("nombre, rubro")
    .eq("id", clienteId)
    .maybeSingle();
  if (!cliente) return { ok: false, omitido: true, motivo: "cliente_no_encontrado" };

  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId);
  const ids = (empleados ?? []).map((e) => e.id as string);
  if (!ids.length) {
    // Se marca el día igual que con poca actividad (Fase 0): sin marca, un
    // negocio sin empleados quedaba primero en cada corrida de la madrugada.
    await marcarDia(clienteId, dia, { nuevos: 0, vistos: 0, mensajes: 0 });
    return { ok: false, omitido: true, motivo: "sin_empleados" };
  }

  // Rango UTC que cubre el día completo en Chile, con holgura a los dos lados
  // (Chile está entre UTC-3 y UTC-4; el margen evita perder la primera y la
  // última hora según la época del año).
  const desde = new Date(`${dia}T00:00:00-04:00`).toISOString();
  const hasta = new Date(`${dia}T23:59:59-03:00`).toISOString();

  const { data: filas } = await supa
    .from("ed_mensajes")
    .select("chat_id, rol, texto, creado_en")
    .in("empleado_id", ids)
    .gte("creado_en", desde)
    .lte("creado_en", hasta)
    .order("creado_en", { ascending: true })
    .limit(800);

  const mensajes: MensajeIsabel[] = (filas ?? []).map((f) => ({
    chatId: f.chat_id as string,
    rol: f.rol as string,
    texto: (f.texto as string) ?? "",
    creadoEn: f.creado_en as string,
  }));

  if (mensajes.length < MINIMO_MENSAJES) {
    // Igual se deja la marca del día: si no, mañana se reintenta un día que
    // nunca va a tener suficiente y se gasta la corrida en él para siempre.
    await marcarDia(clienteId, dia, { nuevos: 0, vistos: 0, mensajes: mensajes.length });
    return { ok: false, omitido: true, motivo: "poca_actividad" };
  }

  const prompt = armarPromptDestilado({
    negocio: (cliente.nombre as string) ?? "",
    rubro: (cliente.rubro as string) ?? "",
    dia,
    conversaciones: armarConversaciones(mensajes, {
      maxChats: 25,
      maxMensajes: 16,
      maxChars: 240,
    }),
  });

  let hechos: HechoSabido[];
  try {
    const crudo = await generarJSON(prompt, {
      timeoutMs: 50_000,
      intentosPorModelo: 1,
      fechaLimite: opts?.fechaLimite,
      thinkingBudget: 2048,
    });
    hechos = normalizarHechos(crudo);
  } catch (e) {
    return { ok: false, motivo: `modelo: ${(e as Error).message}` };
  }

  const { nuevos, vistos } = await fundirHechos(clienteId, dia, hechos);
  await marcarDia(clienteId, dia, { nuevos, vistos, mensajes: mensajes.length });

  return { ok: true, nuevos, vistos };
}

async function marcarDia(
  clienteId: string,
  dia: string,
  r: { nuevos: number; vistos: number; mensajes: number },
): Promise<void> {
  try {
    await db()
      .from("ed_isabel_destilados")
      .upsert(
        {
          cliente_id: clienteId,
          dia,
          hechos_nuevos: r.nuevos,
          hechos_vistos: r.vistos,
          mensajes: r.mensajes,
          modelo: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        },
        { onConflict: "cliente_id,dia" },
      );
  } catch {
    // Sin la migración 301 no hay bitácora. El destilado tampoco habría escrito.
  }
}

/**
 * Lo que llama el cron: destila el día de ayer para los clientes que falten.
 *
 * Retorna al instante fuera de la madrugada, y también si la migración 301 no
 * está aplicada — en ese caso la consulta de la bitácora falla, se captura, y
 * el cron sigue con lo suyo sin enterarse.
 */
export async function destilarPendientes(opts?: {
  ahora?: Date;
  forzar?: boolean;
  maxClientes?: number;
  fechaLimite?: number;
}): Promise<{
  destilados: number;
  detalle: string[];
  /** Fallos por negocio (observabilidad del cron). */
  errores: { clienteId: string; error: string }[];
  sinTrabajo?: boolean;
}> {
  const ahora = opts?.ahora ?? new Date();
  const detalle: string[] = [];
  const errores: { clienteId: string; error: string }[] = [];

  if (!opts?.forzar && !esHoraDeDestilar(ahora)) {
    return { destilados: 0, detalle: ["fuera_de_horario"], errores, sinTrabajo: true };
  }

  const ayer = diaChile(new Date(ahora.getTime() - 86_400_000));
  const supa = db();

  try {
    // Solo activos y en orden estable (Fase 0): antes entraban negocios dados de
    // baja y, sin orden, el recorte de 50 era arbitrario.
    const { data: clientes, error: errClientes } = await supa
      .from("ed_clientes")
      .select("id, nombre")
      .eq("activo", true)
      .order("id", { ascending: true })
      .limit(50);
    if (errClientes) throw new Error(`no se pudo leer negocios: ${errClientes.message}`);
    if (!clientes?.length) return { destilados: 0, detalle: ["sin_clientes"], errores };

    const { data: hechos } = await supa
      .from("ed_isabel_destilados")
      .select("cliente_id")
      .eq("dia", ayer);
    const yaHechos = new Set((hechos ?? []).map((f) => f.cliente_id as string));

    const pendientes = clientes.filter((c) => !yaHechos.has(c.id as string));
    const tope = opts?.maxClientes ?? MAX_CLIENTES;

    let destilados = 0;
    let conModelo = 0;
    for (const c of pendientes) {
      // El tope cuenta solo los que llamaron al modelo: un omitido (poca
      // actividad) es barato y no debe dejar esperando al siguiente.
      if (conModelo >= tope) break;
      // Si ya no queda tiempo de función, lo que falte sale en el latido
      // siguiente. Mismo criterio que el informe semanal.
      if (opts?.fechaLimite && Date.now() > opts.fechaLimite - 12_000) {
        detalle.push("sin_tiempo");
        break;
      }
      const r = await destilarDia(c.id as string, ayer, { fechaLimite: opts?.fechaLimite });
      detalle.push(`${c.nombre ?? c.id}: ${r.ok ? `+${r.nuevos}/${r.vistos}` : r.motivo}`);
      if (r.ok) destilados += 1;
      else if (!r.omitido) errores.push({ clienteId: c.id as string, error: r.motivo ?? "destilado falló" });
      if (!r.omitido) conModelo += 1;
    }

    return { destilados, detalle, errores };
  } catch (e) {
    return {
      destilados: 0,
      detalle: [`error: ${(e as Error).message}`],
      errores: [{ clienteId: "", error: (e as Error).message }],
    };
  }
}
