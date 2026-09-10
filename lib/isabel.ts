import { db } from "@/lib/db";
import { generarJSON } from "@/lib/gemini";
import { listarFichas } from "@/lib/conocimiento";
import { inicioDeMesChile, ZONA } from "@/lib/fechas";
import { situacionDelNegocio } from "@/lib/isabelDatos";
import {
  armarConversaciones,
  armarPrompt,
  normalizarRespuesta,
  palabrasClave,
  panoramaEnTexto,
  rankearChats,
  sinAcentos,
  situacionEnTexto,
  validarPregunta,
  type MensajeIsabel,
  type PanoramaNegocio,
  type RespuestaIsabel,
} from "@/lib/isabelCore";

/**
 * ISABEL — las consultas. La cabeza está en isabelCore.ts.
 *
 * CÓMO CONTESTA, EN ORDEN
 *  1. Panorama: las cifras exactas del negocio, calculadas por la base. El
 *     modelo NO las recalcula, las recibe hechas. Un modelo sumando
 *     conversaciones a ojo es exactamente cómo se pierde la confianza del dueño.
 *  2. Fichas: lo que el negocio tiene cargado (precios, horarios, direcciones).
 *  3. Historial: las conversaciones que tienen que ver con la pregunta. Se
 *     buscan por palabra; si la pregunta es general, se le muestran las más
 *     recientes.
 *
 * LÍMITE QUE HAY QUE TENER PRESENTE: Isabel lee una MUESTRA del historial, no
 * el historial completo — no cabe en el contexto del modelo y no cabría aunque
 * cupiera el presupuesto. Por eso el prompt le prohíbe estimar cantidades desde
 * las conversaciones: para contar están las cifras del panorama.
 */

const DIAS_PANORAMA = 30;

/** Tope de mensajes que se le muestran al modelo. Medido para no pasar de ~25 s. */
const MAX_MENSAJES_CONTEXTO = 220;

function haceDias(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString();
}

/** "miércoles 10 de septiembre de 2026", para que Isabel sepa qué es "esta semana". */
function hoyEnChile(): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

/**
 * Cuenta filas sin traerlas (`head: true` + count exacto): la base responde por
 * índice. Devuelve 0 ante cualquier problema — una cifra que no se pudo leer no
 * puede tumbar la pantalla, y el prompt ya le prohíbe a Isabel afirmar sobre lo
 * que no está.
 */
async function cuenta(consulta: PromiseLike<{ count: number | null }>): Promise<number> {
  try {
    const { count } = await consulta;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Las cifras del negocio. Todo con `head: true` y count exacto: la base
 * responde por índice sin devolver filas, así que son consultas baratas aunque
 * sean varias.
 */
export async function panoramaDelNegocio(clienteId: string): Promise<PanoramaNegocio> {
  const supa = db();
  const desde = haceDias(DIAS_PANORAMA);

  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId);
  const ids = (empleados ?? []).map((e) => e.id as string);

  const ETAPAS = ["nuevo", "interesado", "cotizado", "ganado", "perdido"] as const;

  const soloContar = { count: "exact" as const, head: true };

  const [conversaciones, mensajes, esperando, citasProximas, cobrosPendientes, etapasCount] =
    await Promise.all([
      cuenta(
        supa
          .from("ed_contactos")
          .select("id", soloContar)
          .eq("cliente_id", clienteId)
          .gte("ultimo_mensaje_en", desde),
      ),
      ids.length
        ? cuenta(
            supa
              .from("ed_mensajes")
              .select("id", soloContar)
              .in("empleado_id", ids)
              .gte("creado_en", desde),
          )
        : Promise.resolve(0),
      ids.length
        ? cuenta(
            supa
              .from("ed_escalaciones")
              .select("id", soloContar)
              .in("empleado_id", ids)
              .is("atendida_en", null),
          )
        : Promise.resolve(0),
      cuenta(
        supa
          .from("ed_citas")
          .select("id", soloContar)
          .eq("cliente_id", clienteId)
          .gte("inicio", new Date().toISOString())
          .in("estado", ["agendada", "confirmada", "reagendada"]),
      ),
      cuenta(
        supa
          .from("ed_pagos")
          .select("id", soloContar)
          .eq("cliente_id", clienteId)
          .eq("estado", "pendiente"),
      ),
      Promise.all(
        ETAPAS.map((etapa) =>
          cuenta(
            supa
              .from("ed_contactos")
              .select("id", soloContar)
              .eq("cliente_id", clienteId)
              .eq("etapa", etapa),
          ).then((total) => ({ etapa: etapa as string, total })),
        ),
      ),
    ]);

  // Cobrado del mes: son pocas filas, se suman acá.
  let cobradoMes = 0;
  try {
    const { data } = await supa
      .from("ed_pagos")
      .select("monto")
      .eq("cliente_id", clienteId)
      .eq("estado", "pagado")
      .gte("pagado_en", inicioDeMesChile());
    cobradoMes = (data ?? []).reduce((s, f) => s + ((f.monto as number) ?? 0), 0);
  } catch {
    cobradoMes = 0;
  }

  // Etiquetas: no hay group by en PostgREST, así que se cuentan acá sobre los
  // contactos activos del período (acotado, no la tabla entera).
  const porEtiqueta: { etiqueta: string; total: number }[] = [];
  try {
    const { data } = await supa
      .from("ed_contactos")
      .select("etiquetas")
      .eq("cliente_id", clienteId)
      .gte("ultimo_mensaje_en", desde)
      .limit(1000);
    const cuenta = new Map<string, number>();
    for (const f of data ?? []) {
      for (const e of (f.etiquetas as string[] | null) ?? []) {
        cuenta.set(e, (cuenta.get(e) ?? 0) + 1);
      }
    }
    porEtiqueta.push(
      ...[...cuenta.entries()]
        .map(([etiqueta, total]) => ({ etiqueta, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 8),
    );
  } catch {
    // Sin etiquetas el panorama sigue sirviendo.
  }

  return {
    dias: DIAS_PANORAMA,
    conversaciones,
    mensajes,
    esperando,
    citasProximas,
    cobrosPendientes,
    cobradoMes,
    porEtapa: etapasCount.filter((e) => e.total > 0),
    porEtiqueta,
  };
}

/**
 * Busca en el historial las conversaciones que tienen que ver con la pregunta.
 *
 * Estrategia deliberadamente simple: `ilike` por palabra, tomar los chats que
 * aparecen, y traer esas conversaciones completas (recortadas). No hay
 * embeddings ni índice vectorial, y no hace falta todavía: un negocio chico
 * tiene miles de mensajes, no millones, y una búsqueda por palabra sobre un
 * texto que la persona acaba de escribir acierta casi siempre.
 *
 * Cuando la pregunta es general («¿cómo va la semana?») no hay palabra que
 * buscar: ahí se muestran las conversaciones más recientes, que es lo que
 * cualquiera miraría.
 */
export async function historialRelevante(
  clienteId: string,
  pregunta: string,
): Promise<{ mensajes: MensajeIsabel[]; porBusqueda: boolean }> {
  const supa = db();
  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId);
  const ids = (empleados ?? []).map((e) => e.id as string);
  if (!ids.length) return { mensajes: [], porBusqueda: false };

  const claves = palabrasClave(pregunta, 3);
  let chats: string[] = [];

  /**
   * ⭐ PRIMERO, BÚSQUEDA POR RELEVANCIA (migración 299).
   *
   * `ed_buscar_mensajes_isabel` usa la búsqueda de texto completo de Postgres
   * en español: reduce «cotizaciones» y «cotización» a la misma raíz, ordena
   * por `ts_rank` y va por índice en vez de recorrer la tabla entera.
   *
   * Si la migración no está aplicada la llamada falla y NO pasa nada: se sigue
   * al `ilike` de abajo, que es lo que había antes. Isabel funciona igual, solo
   * encuentra peor. Misma regla que el resto: una mejora no puede ser un
   * requisito.
   */
  if (pregunta.trim()) {
    try {
      const { data, error } = await supa.rpc("ed_buscar_mensajes_isabel", {
        p_cliente_id: clienteId,
        p_consulta: pregunta,
        p_limite: 12,
      });
      if (!error && Array.isArray(data)) {
        chats = (data as { chat_id: string }[]).map((r) => r.chat_id).filter(Boolean);
      }
    } catch {
      // Sin la 299: el camino de abajo.
    }
  }

  if (!chats.length && claves.length) {
    // Con acentos y sin acentos: `ilike` distingue, y la gente escribe de las
    // dos formas. Son dos consultas baratas contra una que fallaría.
    const terminos = new Set<string>();
    for (const c of claves) {
      terminos.add(c);
      const plano = sinAcentos(c);
      if (plano !== c.toLowerCase()) terminos.add(plano);
    }

    const resultados = await Promise.all(
      [...terminos].slice(0, 6).map((t) =>
        supa
          .from("ed_mensajes")
          .select("chat_id, creado_en")
          .in("empleado_id", ids)
          .ilike("texto", `%${t.replace(/[%_\\]/g, "")}%`)
          .order("creado_en", { ascending: false })
          .limit(40),
      ),
    );

    /**
     * ⭐ RANKEO, no «los primeros que aparezcan».
     *
     * Antes se recorrían las listas en orden y se cortaba en diez, lo que
     * premiaba al término que se buscó primero. Ahora manda en cuántos términos
     * distintos aparece cada conversación: preguntando «¿qué pasó con la
     * cotización de los pendones?», la que habla de las dos cosas gana sobre
     * diez que solo dicen «cotización». Ver rankearChats en isabelCore.
     */
    chats = rankearChats(
      resultados.map((r) => (r.data ?? []).map((f) => f.chat_id as string)),
      12,
    );
  }

  const porBusqueda = chats.length > 0;

  let filas: Record<string, unknown>[] = [];
  if (porBusqueda) {
    const { data } = await supa
      .from("ed_mensajes")
      .select("chat_id, rol, texto, creado_en")
      .in("empleado_id", ids)
      .in("chat_id", chats)
      .order("creado_en", { ascending: false })
      .limit(MAX_MENSAJES_CONTEXTO);
    filas = (data ?? []) as Record<string, unknown>[];
  } else {
    const { data } = await supa
      .from("ed_mensajes")
      .select("chat_id, rol, texto, creado_en")
      .in("empleado_id", ids)
      .gte("creado_en", haceDias(DIAS_PANORAMA))
      .order("creado_en", { ascending: false })
      .limit(MAX_MENSAJES_CONTEXTO);
    filas = (data ?? []) as Record<string, unknown>[];
  }

  // Nombres, para que Isabel pueda decir "la señora Pérez" y no "…4821".
  const nombres = new Map<string, string>();
  const chatsUsados = [...new Set(filas.map((f) => f.chat_id as string))];
  if (chatsUsados.length) {
    try {
      const { data } = await supa
        .from("ed_contactos")
        .select("chat_id, nombre")
        .eq("cliente_id", clienteId)
        .in("chat_id", chatsUsados.slice(0, 200));
      for (const c of data ?? []) {
        const n = (c.nombre as string | null) ?? "";
        if (n) nombres.set(c.chat_id as string, n);
      }
    } catch {
      // Sin nombres se lee igual, solo menos cómodo.
    }
  }

  return {
    porBusqueda,
    mensajes: filas.map((f) => ({
      chatId: f.chat_id as string,
      rol: f.rol as string,
      texto: (f.texto as string) ?? "",
      creadoEn: f.creado_en as string,
      nombre: nombres.get(f.chat_id as string) ?? null,
    })),
  };
}

export type ConsultaIsabel = {
  id?: string;
  pregunta: string;
  respuesta: RespuestaIsabel;
  creadoEn: string;
};

/** Las últimas preguntas del dueño, para que la pantalla no arranque vacía. */
export async function historialDeConsultas(
  clienteId: string,
  limite = 8,
): Promise<ConsultaIsabel[]> {
  try {
    const { data, error } = await db()
      .from("ed_isabel_consultas")
      .select("id, pregunta, respuesta, creado_en")
      .eq("cliente_id", clienteId)
      .order("creado_en", { ascending: false })
      .limit(limite);
    if (error || !data) return [];
    /**
     * Se sanea al LEER, no solo al escribir. La columna es jsonb y el formato
     * puede cambiar con el tiempo: una respuesta vieja sin `apoyos` haría que
     * la pantalla reventara al mapear un undefined, y quien entra a preguntar
     * algo se encontraría con un error en vez de con Isabel.
     */
    return data.map((f) => {
      const r = (f.respuesta ?? {}) as Partial<RespuestaIsabel>;
      return {
        id: f.id as string,
        pregunta: (f.pregunta as string) ?? "",
        respuesta: {
          respuesta: String(r.respuesta ?? ""),
          apoyos: Array.isArray(r.apoyos) ? r.apoyos.map(String) : [],
          seguridad:
            r.seguridad === "alta" || r.seguridad === "no_se" ? r.seguridad : "media",
        },
        creadoEn: f.creado_en as string,
      };
    });
  } catch {
    // Sin la migración 298 la pantalla funciona igual: solo no recuerda.
    return [];
  }
}

/**
 * La consulta completa: pregunta del dueño → respuesta apoyada en datos.
 *
 * Devuelve un resultado explícito (nunca lanza) para que la pantalla pueda
 * decir por qué no se pudo, que es la mitad del trabajo cuando algo falla.
 */
export async function preguntarAIsabel(
  clienteId: string,
  preguntaCruda: string,
): Promise<{ ok: boolean; motivo?: string; consulta?: ConsultaIsabel }> {
  const v = validarPregunta(preguntaCruda);
  if (!v.ok) return { ok: false, motivo: v.motivo };
  const pregunta = v.texto;

  const supa = db();
  const { data: cliente } = await supa
    .from("ed_clientes")
    .select("nombre, rubro")
    .eq("id", clienteId)
    .maybeSingle();
  if (!cliente) return { ok: false, motivo: "No se pudo identificar el negocio." };

  const [panorama, situacion, historial, fichas] = await Promise.all([
    panoramaDelNegocio(clienteId),
    /**
     * Lo que el portal YA interpretó: el informe semanal, las derivaciones
     * abiertas con su motivo, los cierres con su evidencia, los cobros sin
     * pagar, quién viene y quién quedó molesto. Es la diferencia entre alguien
     * que relee el archivo cada vez y alguien que trabaja ahí.
     */
    situacionDelNegocio(clienteId),
    historialRelevante(clienteId, pregunta),
    listarFichas(clienteId).catch(() => []),
  ]);

  const fichasTexto = fichas
    .filter((f) => f.vigente)
    .slice(0, 40)
    .map((f) => `· [${f.categoria}] ${f.titulo}: ${f.contenido.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");

  const prompt = armarPrompt({
    negocio: (cliente.nombre as string) ?? "",
    rubro: (cliente.rubro as string) ?? "",
    hoy: hoyEnChile(),
    panorama: panoramaEnTexto(panorama),
    situacion: situacionEnTexto(situacion),
    fichas: fichasTexto,
    conversaciones: armarConversaciones(historial.mensajes),
    pregunta,
  });

  let respuesta: RespuestaIsabel | null = null;
  try {
    const crudo = await generarJSON(prompt, {
      // Es una pregunta que alguien está esperando en pantalla, pero razona
      // sobre bastante texto: mismo aire que el informe semanal, sin reintento
      // (un reintento duplicaría el costo y la espera sin mejorar la respuesta).
      timeoutMs: 45_000,
      intentosPorModelo: 1,
      thinkingBudget: 2048,
    });
    respuesta = normalizarRespuesta(crudo);
  } catch (e) {
    return { ok: false, motivo: `Isabel no pudo responder: ${(e as Error).message}` };
  }

  if (!respuesta) {
    return { ok: false, motivo: "La respuesta volvió vacía. Prueba de nuevo en un momento." };
  }

  const consulta: ConsultaIsabel = {
    pregunta,
    respuesta,
    creadoEn: new Date().toISOString(),
  };

  /**
   * Se guarda la conversación con Isabel. Si la tabla todavía no existe
   * (migración 298 sin aplicar), la respuesta igual se entrega: el valor está
   * en contestar, no en recordar. Misma regla que la atribución de campaña.
   */
  try {
    const { data } = await supa
      .from("ed_isabel_consultas")
      .insert({
        cliente_id: clienteId,
        pregunta,
        respuesta,
        modelo: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        mensajes_leidos: historial.mensajes.length,
        por_busqueda: historial.porBusqueda,
      })
      .select("id")
      .maybeSingle();
    if (data?.id) consulta.id = data.id as string;
  } catch {
    // Sin bitácora, pero con respuesta.
  }

  return { ok: true, consulta };
}
