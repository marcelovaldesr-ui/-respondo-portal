import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { programarSeguimiento } from "@/lib/seguimientos";
import {
  DIAS_MAX,
  DIAS_MIN,
  cuposDisponibles,
  decidirCotizacion,
  type Candidato,
} from "@/lib/generadorCotizacionCore";

/**
 * GENERADOR: BETO PERSIGUE LAS COTIZACIONES QUE NADIE CONTESTÓ.
 *
 * Por qué existe y qué cuesta: ver `sql/288_seguimiento_cotizacion.sql` y
 * `lib/generadorCotizacionCore.ts`. Resumen: hasta hoy los tres generadores que
 * había dependían de una CITA o del rubro motos, así que a una imprenta —que no
 * agenda— Beto y Vera no le hacían nada.
 *
 * ⚠️ INERTE HASTA QUE ALGUIEN LO ENCIENDA. `cotizacion_seguimiento` nace en
 * false. Mientras nadie lo active, esto cuesta una consulta por latido.
 *
 * ⚠️ EL TOPE ES DE GASTO, NO DE CARGA. Cada envío es una plantilla de marketing
 * (~$85). Ese es el motivo del tope diario, no el rendimiento.
 */

export type ResumenCotizacion = {
  clientes: number;
  candidatos: number;
  programados: number;
  detalle: string[];
};

export async function generarSeguimientosCotizacion(
  supa: SupabaseClient = db(),
): Promise<ResumenCotizacion> {
  const out: ResumenCotizacion = { clientes: 0, candidatos: 0, programados: 0, detalle: [] };

  const { data: clientes } = await supa
    .from("ed_clientes")
    .select("id, nombre, cotizacion_tope_diario")
    .eq("cotizacion_seguimiento", true)
    .limit(50);

  if (!clientes?.length) return out;
  out.clientes = clientes.length;

  const ahora = Date.now();
  const desde = new Date(ahora - DIAS_MAX * 86_400_000).toISOString();
  const hasta = new Date(ahora - DIAS_MIN * 86_400_000).toISOString();
  const hoy = new Date(new Date().toDateString()).toISOString();

  for (const cli of clientes) {
    const clienteId = cli.id as string;
    const topeDiario = (cli.cotizacion_tope_diario as number | null) ?? 10;

    /**
     * El empleado que manda esto es Beto. Si el cliente no lo tiene contratado,
     * no hay a quién colgarle el seguimiento — y es correcto: alguien que solo
     * pagó por Tino no debe recibir mensajes proactivos por accidente.
     */
    /**
     * ⚠️ EL ROL DE BETO EN LA BASE ES `rita`, NO «beto» NI «seguimiento».
     *
     * Es un resabio: el empleado se llamaba Rita y el cambio de nombre se hizo
     * solo en la marca, nunca en los datos (está anotado en `lib/empleados.ts`).
     * Buscar por «seguimiento» devuelve null y el generador se queda mudo **sin
     * ningún error** — que es la peor forma de fallar. Mismo criterio que usa
     * `generadorSeguimientos.ts`, que sí funciona.
     */
    const { data: beto } = await supa
      .from("ed_empleados")
      .select("id")
      .eq("cliente_id", clienteId)
      .eq("rol", "rita")
      .eq("activo", true)
      .maybeSingle();
    if (!beto) {
      out.detalle.push(`${cli.nombre}: sin Beto activo`);
      continue;
    }
    const betoId = beto.id as string;

    // Cuánto se lleva enviado hoy: el tope es diario y de plata.
    const { count: enviadosHoy } = await supa
      .from("ed_seguimientos")
      .select("id", { count: "exact", head: true })
      .eq("empleado_id", betoId)
      .eq("tipo", "cotizacion_sin_respuesta")
      .gte("programado_para", hoy);

    /**
     * Candidatos: cotizados dentro de la ventana. El `limit` es explícito
     * —PostgREST corta en 1.000 sin avisar— y sobra: el tope diario va a
     * recortar mucho antes.
     */
    const { data: contactos } = await supa
      .from("ed_contactos")
      .select("chat_id, nombre, etapa, etiquetas, ultimo_mensaje_en")
      .eq("cliente_id", clienteId)
      .gte("ultimo_mensaje_en", desde)
      .lte("ultimo_mensaje_en", hasta)
      .order("ultimo_mensaje_en", { ascending: true })
      .limit(300);

    if (!contactos?.length) continue;

    /**
     * QUIÉN HABLÓ ÚLTIMO, EN UNA SOLA CONSULTA.
     *
     * Es el dato que más protege —no escribirle a quien acaba de escribir— y el
     * más caro si se pide por contacto. Con 300 candidatos serían 300 viajes en
     * serie dentro de un cron con techo de tiempo. Se trae todo junto y se
     * reduce en memoria, igual que se arregló el N+1 de `seguimientos.ts`.
     */
    const chatIds = contactos.map((c) => c.chat_id as string);
    const { data: mensajes } = await supa
      .from("ed_mensajes")
      .select("chat_id, rol, creado_en")
      .eq("empleado_id", betoId)
      .in("chat_id", chatIds)
      .gte("creado_en", desde)
      .order("creado_en", { ascending: true })
      .limit(1000);

    const ultimoRol = new Map<string, string>();
    for (const m of mensajes ?? []) {
      // Ordenado ascendente: el último que se escribe gana.
      ultimoRol.set(m.chat_id as string, m.rol as string);
    }

    // Seguimientos previos de este tipo, para no insistir dos veces.
    const { data: previos } = await supa
      .from("ed_seguimientos")
      .select("chat_id, programado_para")
      .eq("empleado_id", betoId)
      .eq("tipo", "cotizacion_sin_respuesta")
      .in("chat_id", chatIds)
      .limit(1000);

    const ultimoSeg = new Map<string, string>();
    for (const s of previos ?? []) {
      const k = s.chat_id as string;
      const v = s.programado_para as string;
      const prev = ultimoSeg.get(k);
      if (!prev || v > prev) ultimoSeg.set(k, v);
    }

    const elegibles: { chatId: string; nombre: string }[] = [];
    for (const c of contactos) {
      const chatId = c.chat_id as string;
      const cand: Candidato = {
        chatId,
        etiquetas: ((c.etiquetas as string[] | null) ?? []),
        etapa: (c.etapa as string | null) ?? null,
        ultimoMensajeEn: (c.ultimo_mensaje_en as string | null) ?? null,
        ultimoRol: ultimoRol.get(chatId) ?? null,
        ultimoSeguimientoEn: ultimoSeg.get(chatId) ?? null,
      };
      if (decidirCotizacion(cand, ahora).enviar) {
        elegibles.push({ chatId, nombre: (c.nombre as string | null) || "" });
      }
    }

    out.candidatos += elegibles.length;

    const cupo = cuposDisponibles({
      topeDiario,
      enviadosHoy: enviadosHoy ?? 0,
      candidatos: elegibles.length,
    });
    if (cupo <= 0) {
      out.detalle.push(
        `${cli.nombre}: ${elegibles.length} en espera, tope diario alcanzado (${topeDiario})`,
      );
      continue;
    }

    /**
     * Los MÁS ANTIGUOS primero: `contactos` viene ordenado por fecha ascendente,
     * así que `elegibles` conserva ese orden. Son los que están más cerca de
     * salirse de la ventana de 30 días y perderse del todo.
     */
    for (const e of elegibles.slice(0, cupo)) {
      const r = await programarSeguimiento({
        empleadoId: betoId,
        chatId: e.chatId,
        tipo: "cotizacion_sin_respuesta",
        // La plantilla pide: nombre, negocio, y de qué era la cotización. Lo
        // último no se sabe con certeza, así que va una fórmula neutra en vez de
        // inventar un producto — que es exactamente lo que no debe hacer.
        paramsPlantilla: [e.nombre || "hola", (cli.nombre as string) || "", "lo que nos consultaste"],
        programadoPara: new Date(),
        supa,
      });
      if (r.ok) out.programados++;
      else out.detalle.push(`${e.chatId}: no se pudo programar (${r.error})`);
    }

    out.detalle.unshift(
      `${cli.nombre}: ${elegibles.length} elegibles · ${Math.min(cupo, elegibles.length)} programados`,
    );
  }

  return out;
}
