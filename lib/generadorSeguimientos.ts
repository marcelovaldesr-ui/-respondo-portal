import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { programarSeguimiento } from "@/lib/seguimientos";
import { ventanaMantencion } from "@/lib/generadorCore";

/**
 * GENERADOR DE SEGUIMIENTOS DE BETO.
 *
 * El motor de ed_seguimientos envía lo que encuentra programado, pero no
 * programa nada solo: es inerte a propósito, para que un cliente que solo
 * contrató a Tino jamás reciba un mensaje proactivo por accidente. Esta es la
 * pieza que faltaba: mira los contactos y decide a quién le toca AHORA.
 *
 * DECISIONES QUE VALE LA PENA DEJAR ESCRITAS
 *
 * 1. La ventana es "está en fecha", no "ya pasó la fecha". Si el intervalo es
 *    de 6 meses, se le escribe a quien vino hace entre 5 y 8 meses. Antes de
 *    los 5 el mensaje es prematuro y molesta; después de los 8 ya no es un
 *    recordatorio, es una reactivación fría — otro mensaje, otro momento y otra
 *    conversación con el negocio.
 *
 * 2. Nunca se le escribe dos veces por lo mismo. Antes de programar se mira si
 *    ese contacto ya recibió un seguimiento del mismo tipo en los últimos
 *    `diasSinRepetir` días (por defecto 90). Sin esto, el cron reprograma al
 *    mismo cliente en cada pasada mientras siga dentro de la ventana, que son
 *    288 mensajes al día a la misma persona.
 *
 * 3. Respeta `no_contactar` acá y también en el motor. Dos veces a propósito:
 *    acá evita crear la fila, y allá evita enviarla si la etiqueta se puso
 *    después de programada.
 *
 * 4. Tope por pasada. Aunque la lista traiga 3.000 personas, se programan de a
 *    poco. El tope diario del motor igual las frenaría, pero es mejor no llenar
 *    la tabla de filas que van a esperar semanas.
 */

export type OpcionesGenerador = {
  clienteId: string;
  /** Meses entre mantenciones. Lo define el negocio en la puesta en marcha. */
  intervaloMeses?: number;
  /** Cuánto antes del cumplimiento se empieza a avisar. */
  margenAntesMeses?: number;
  /** Hasta cuánto después se sigue considerando "recordatorio" y no "reactivación". */
  margenDespuesMeses?: number;
  diasSinRepetir?: number;
  maxPorPasada?: number;
  ahora?: Date;
  supa?: SupabaseClient;
  /** No escribe nada: devuelve a quiénes se les habría escrito. */
  simular?: boolean;
};

export type ResultadoGenerador = {
  programados: number;
  candidatos: { chatId: string; nombre: string; vehiculo: string; ultimaAtencion: string }[];
  detalle: string[];
};

/**
 * Programa los avisos de "te toca la mantención" del cliente indicado.
 *
 * Devuelve siempre un resumen legible: este código corre dentro de un cron que
 * nadie mira, y cuando alguien pregunte "¿por qué no le llegó a fulano?" la
 * respuesta tiene que estar en el log y no en una reconstrucción a mano.
 */
export async function generarMantenciones(
  opts: OpcionesGenerador,
): Promise<ResultadoGenerador> {
  const supa = opts.supa ?? db();
  const ahora = opts.ahora ?? new Date();
  const intervalo = opts.intervaloMeses ?? 6;
  const antes = opts.margenAntesMeses ?? 1;
  const despues = opts.margenDespuesMeses ?? 2;
  const diasSinRepetir = opts.diasSinRepetir ?? 90;
  const maxPorPasada = opts.maxPorPasada ?? 20;
  const detalle: string[] = [];

  // Beto. Si el cliente no lo tiene activo, acá no hay nada que hacer.
  const { data: beto } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", opts.clienteId)
    .eq("rol", "rita")
    .eq("activo", true)
    .maybeSingle();
  if (!beto?.id) return { programados: 0, candidatos: [], detalle: ["sin_beto_activo"] };
  const betoId = beto.id as string;

  // El nombre del negocio va en la plantilla: sin él no se puede enviar fuera
  // de la ventana, así que se corta antes de programar filas inservibles.
  const { data: cli } = await supa
    .from("ed_clientes")
    .select("nombre")
    .eq("id", opts.clienteId)
    .maybeSingle();
  const negocio = (cli?.nombre as string) ?? "";
  if (!negocio) return { programados: 0, candidatos: [], detalle: ["cliente_sin_nombre"] };

  /**
   * La ventana. `desde` es la fecha MÁS ANTIGUA que sigue contando como
   * recordatorio y `hasta` la más reciente que ya amerita aviso.
   * Con intervalo 6, antes 1 y después 2: entre hace 8 y hace 5 meses.
   */
  const { desde, hasta } = ventanaMantencion(ahora, intervalo, antes, despues);

  const { data: contactos, error } = await supa
    .from("ed_contactos")
    .select("chat_id, nombre, etiquetas, ultima_atencion, datos")
    .eq("cliente_id", opts.clienteId)
    .not("ultima_atencion", "is", null)
    .gte("ultima_atencion", desde)
    .lte("ultima_atencion", hasta)
    .order("ultima_atencion", { ascending: true })
    .limit(maxPorPasada * 5); // margen para los que se filtran abajo

  if (error) {
    // Migración 282 sin aplicar: el generador no rompe el cron, avisa y se va.
    return {
      programados: 0,
      candidatos: [],
      detalle: [`sin_columna_o_error: ${error.message}`],
    };
  }
  if (!contactos?.length) {
    return { programados: 0, candidatos: [], detalle: [`sin_candidatos (${desde} a ${hasta})`] };
  }

  const candidatos: ResultadoGenerador["candidatos"] = [];
  let programados = 0;
  const corte = new Date(ahora.getTime() - diasSinRepetir * 86400_000).toISOString();

  for (const c of contactos) {
    if (programados >= maxPorPasada) {
      detalle.push(`tope de la pasada (${maxPorPasada}); el resto queda para la próxima`);
      break;
    }

    const chatId = c.chat_id as string;
    const etiquetas = (c.etiquetas as string[] | null) ?? [];
    if (etiquetas.includes("no_contactar")) {
      detalle.push(`${chatId}: no_contactar`);
      continue;
    }

    // ¿Ya se le escribió por esto hace poco?
    const { data: previo } = await supa
      .from("ed_seguimientos")
      .select("id")
      .eq("empleado_id", betoId)
      .eq("chat_id", chatId)
      .eq("tipo", "mantencion_toca")
      .gte("programado_para", corte)
      .limit(1);
    if (previo?.length) {
      detalle.push(`${chatId}: ya tiene uno reciente`);
      continue;
    }

    const datos = (c.datos as Record<string, string> | null) ?? {};
    const vehiculo = String(datos.vehiculo ?? "").trim();
    const nombre = String(c.nombre ?? "").trim().split(/\s+/)[0] ?? "";
    if (!nombre || !vehiculo) {
      // La plantilla necesita los cuatro parámetros. Sin moto o sin nombre no
      // se puede armar un mensaje que no suene a formulario, así que se salta
      // y queda anotado para que alguien complete la ficha.
      detalle.push(`${chatId}: ficha incompleta (${!nombre ? "sin nombre" : "sin moto"})`);
      continue;
    }

    candidatos.push({
      chatId,
      nombre,
      vehiculo,
      ultimaAtencion: String(c.ultima_atencion),
    });

    if (opts.simular) {
      programados++;
      continue;
    }

    const r = await programarSeguimiento({
      empleadoId: betoId,
      chatId,
      tipo: "mantencion_toca",
      paramsPlantilla: [nombre, negocio, vehiculo, "su próxima mantención"],
      programadoPara: ahora, // el cron lo toma en la próxima pasada hábil
      supa,
    });
    if (r.ok) {
      programados++;
    } else {
      detalle.push(`${chatId}: no se pudo programar (${r.error})`);
    }
  }

  detalle.unshift(
    `ventana ${desde} → ${hasta} · ${contactos.length} en rango · ${programados} programados`,
  );
  return { programados, candidatos, detalle };
}

/**
 * Corre el generador para todos los clientes que tengan a Beto activo.
 *
 * Se cuelga del cron único (app/api/cron/seguimientos). Va envuelto en su
 * propio try en el cron: que falle el generador no puede impedir que salgan los
 * seguimientos ya programados, que es la parte que el negocio ya está viendo.
 */
export async function generarParaTodos(
  opts?: { ahora?: Date; supa?: SupabaseClient; maxPorPasada?: number },
): Promise<{ total: number; porCliente: Record<string, number> }> {
  const supa = opts?.supa ?? db();
  const porCliente: Record<string, number> = {};
  let total = 0;

  const { data: betos } = await supa
    .from("ed_empleados")
    .select("cliente_id")
    .eq("rol", "rita")
    .eq("activo", true);

  for (const b of betos ?? []) {
    const clienteId = b.cliente_id as string;
    try {
      /**
       * El intervalo lo define cada negocio: una moto no se atiende con la
       * misma frecuencia que una consulta dental. Si la columna no está (o el
       * negocio no lo definió todavía), 6 meses es el punto de partida más
       * habitual y el generador igual funciona.
       */
      const { data: cfg } = await supa
        .from("ed_clientes")
        .select("intervalo_mantencion_meses")
        .eq("id", clienteId)
        .maybeSingle();
      const intervalo = (cfg?.intervalo_mantencion_meses as number | null) ?? undefined;

      const r = await generarMantenciones({
        clienteId,
        intervaloMeses: intervalo,
        ahora: opts?.ahora,
        maxPorPasada: opts?.maxPorPasada,
        supa,
      });
      porCliente[clienteId] = r.programados;
      total += r.programados;
      if (r.programados) {
        console.log(`[generador] ${clienteId}: ${r.detalle[0]}`);
      }
    } catch (e) {
      console.error(`[generador] ${clienteId} falló:`, (e as Error).message);
    }
  }
  return { total, porCliente };
}
