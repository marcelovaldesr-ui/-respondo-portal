import { db } from "@/lib/db";
import { generarJSON } from "@/lib/gemini";
import { ZONA } from "@/lib/fechas";

/**
 * INFORME SEMANAL CON IA — el módulo que convierte el portal en asesor.
 *
 * Qué hace: lee las conversaciones de la semana y le pide al modelo un informe
 * en el idioma del negocio: qué pidieron los clientes, dónde se perdieron
 * ventas, qué hay que corregirle al asistente, qué oportunidades aparecieron.
 *
 * Por qué importa comercialmente: la bandeja y las métricas muestran QUÉ pasó;
 * esto dice QUÉ HACER. Es la diferencia entre una herramienta que se mira y una
 * que se extraña cuando falta — o sea, entre cancelar y renovar.
 *
 * Reglas de honestidad (heredadas del resto del portal):
 *  - Solo se analiza lo que existe. Si hubo poca actividad, el informe lo dice
 *    en vez de inventar conclusiones.
 *  - El modelo recibe conversaciones REALES, nunca resúmenes inventados.
 *  - Si el modelo falla, no se guarda nada a medias.
 */

export type Categoria = { nombre: string; tickets: number; descripcion: string };

export type ContenidoInsight = {
  resumen: string[];
  piden: string[];
  problemas: string[];
  oportunidades: string[];
  fortalezas: string[];
  categorias: Categoria[];
};

export type Insight = {
  id: string;
  periodoDesde: string;
  periodoHasta: string;
  contenido: ContenidoInsight;
  conversaciones: number;
  mensajes: number;
  creadoEn: string;
};

/** Fecha AAAA-MM-DD en hora de Chile. */
function diaChile(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Lunes de la semana que contiene `ref` (hora de Chile) y el domingo siguiente.
 * Por defecto analiza la semana ANTERIOR completa, que es la que tiene sentido
 * revisar un lunes por la mañana.
 */
export function semanaDe(ref = new Date(), semanasAtras = 0) {
  const diaSemana = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA,
    weekday: "short",
  }).format(ref);
  const mapa: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const desdeLunes = mapa[diaSemana] ?? 0;
  const lunes = new Date(ref.getTime() - (desdeLunes + semanasAtras * 7) * 86400_000);
  const domingo = new Date(lunes.getTime() + 6 * 86400_000);
  return { desde: diaChile(lunes), hasta: diaChile(domingo) };
}

/** Trae el último informe guardado (o el de una semana puntual). */
export async function obtenerInsight(
  clienteId: string,
  periodoDesde?: string,
): Promise<Insight | null> {
  const supa = db();
  let q = supa
    .from("ed_insights")
    .select("id, periodo_desde, periodo_hasta, contenido, conversaciones, mensajes, creado_en")
    .eq("cliente_id", clienteId);
  q = periodoDesde
    ? q.eq("periodo_desde", periodoDesde)
    : q.order("periodo_desde", { ascending: false });
  const { data, error } = await q.limit(1).maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id as string,
    periodoDesde: data.periodo_desde as string,
    periodoHasta: data.periodo_hasta as string,
    contenido: data.contenido as ContenidoInsight,
    conversaciones: data.conversaciones as number,
    mensajes: data.mensajes as number,
    creadoEn: data.creado_en as string,
  };
}

/** Lista de semanas con informe, para el selector. */
export async function listarSemanas(
  clienteId: string,
): Promise<{ desde: string; hasta: string }[]> {
  const { data } = await db()
    .from("ed_insights")
    .select("periodo_desde, periodo_hasta")
    .eq("cliente_id", clienteId)
    .order("periodo_desde", { ascending: false })
    .limit(20);
  return (data ?? []).map((r) => ({
    desde: r.periodo_desde as string,
    hasta: r.periodo_hasta as string,
  }));
}

const PROMPT = `Eres un consultor comercial chileno con 20 años de experiencia analizando la atención de pymes. Recibes las conversaciones REALES de una semana entre los clientes de un negocio y su asistente digital (y a veces personas del equipo).

Tu trabajo NO es resumir la semana: es decirle al dueño QUÉ HACER el lunes.

NEGOCIO: {{negocio}} ({{rubro}})
SEMANA: {{desde}} al {{hasta}}
CONVERSACIONES ANALIZADAS: {{n_conv}}

REGLAS
1. Habla en chileno neutro, directo, sin jerga técnica ni palabras de consultor ("sinergia", "accionable", "insight"). Como le hablarías al dueño en el mesón.
2. Todo lo que digas debe salir de las conversaciones que te paso. Si algo no está, NO lo inventes.
3. Nombra montos, productos y situaciones concretas cuando aparezcan.
4. Si la actividad fue poca para sacar conclusiones, dilo con todas sus letras en el resumen.
5. En "problemas", incluye también fallas del propio asistente si las ves (respondió mal, no supo algo importante, repitió, no cerró la venta).
6. Frases cortas. Nada de párrafos largos.

CONVERSACIONES:
{{conversaciones}}

Responde SOLO con este JSON, sin texto alrededor:
{
  "resumen": ["3 o 4 frases: qué pasó esta semana, qué frustró a los clientes, y LO MÁS IMPORTANTE que el dueño debería cambiar"],
  "piden": ["lo que los clientes pidieron, ordenado por frecuencia, máximo 6"],
  "problemas": ["dónde se perdieron ventas o falló la atención, máximo 5"],
  "oportunidades": ["oportunidades concretas de venta o mejora que se ven en las conversaciones, máximo 4"],
  "fortalezas": ["qué está funcionando bien y hay que mantener, máximo 3"],
  "categorias": [{"nombre":"tema","tickets":número de conversaciones sobre ese tema,"descripcion":"una frase"}]
}`;

/**
 * Genera (o regenera) el informe de una semana y lo guarda.
 *
 * `enviar` no aplica acá: esto no escribe a nadie, solo analiza. Devuelve un
 * resultado explícito para que la UI pueda mostrar el motivo si no se pudo.
 */
export async function generarInsight(
  clienteId: string,
  opts?: { semanasAtras?: number },
): Promise<{ ok: boolean; motivo?: string; insight?: Insight }> {
  const supa = db();
  const { desde, hasta } = semanaDe(new Date(), opts?.semanasAtras ?? 0);

  const { data: cliente } = await supa
    .from("ed_clientes")
    .select("nombre, rubro")
    .eq("id", clienteId)
    .maybeSingle();
  if (!cliente) return { ok: false, motivo: "Cliente no encontrado" };

  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId);
  const ids = (empleados ?? []).map((e) => e.id as string);
  if (!ids.length) return { ok: false, motivo: "El cliente no tiene empleados digitales" };

  // Rango en UTC que cubre la semana completa en hora de Chile (con holgura de
  // un día a cada lado; el filtro fino se hace después con la fecha local).
  const desdeUTC = new Date(`${desde}T00:00:00-04:00`);
  const hastaUTC = new Date(`${hasta}T23:59:59-03:00`);

  // Paginado: PostgREST corta en 1.000 filas (mismo motivo que en analitica.ts).
  const PAGINA = 1000;
  const filas: { chat_id: string; rol: string; texto: string; creado_en: string }[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supa
      .from("ed_mensajes")
      .select("chat_id, rol, texto, creado_en")
      .in("empleado_id", ids)
      .gte("creado_en", desdeUTC.toISOString())
      .lte("creado_en", hastaUTC.toISOString())
      .order("creado_en", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error || !data?.length) break;
    filas.push(...(data as typeof filas));
    if (data.length < PAGINA) break;
    if (inicio > 50_000) break;
  }

  if (filas.length < 10) {
    return {
      ok: false,
      motivo: "Hay muy poca actividad esta semana para generar un informe útil.",
    };
  }

  // Agrupar por conversación y recortar para no reventar el contexto del modelo.
  const porChat = new Map<string, typeof filas>();
  for (const f of filas) {
    const arr = porChat.get(f.chat_id) ?? [];
    arr.push(f);
    porChat.set(f.chat_id, arr);
  }
  // 40 conversaciones medido en ~25 s de generación; con 60 se acercaba al
  // límite de la función en Vercel (60 s). Se prefiere margen de sobra.
  const MAX_CONV = 40;
  const MAX_MSG_POR_CONV = 14;
  const MAX_CHARS = 220;
  const conversaciones = [...porChat.entries()]
    .sort((a, b) => b[1].length - a[1].length) // las más ricas primero
    .slice(0, MAX_CONV)
    .map(([chat, msgs], i) => {
      const recorte = msgs.slice(-MAX_MSG_POR_CONV);
      const lineas = recorte.map((m) => {
        const quien =
          m.rol === "cliente" ? "CLIENTE" : m.rol === "empleado" ? "ASISTENTE" : "EQUIPO";
        return `  ${quien}: ${String(m.texto).replace(/\s+/g, " ").slice(0, MAX_CHARS)}`;
      });
      return `--- Conversación ${i + 1} (${chat.slice(-4)}, ${msgs.length} mensajes) ---\n${lineas.join("\n")}`;
    })
    .join("\n\n");

  const prompt = PROMPT.replace("{{negocio}}", (cliente.nombre as string) ?? "")
    .replace("{{rubro}}", (cliente.rubro as string) ?? "")
    .replace("{{desde}}", desde)
    .replace("{{hasta}}", hasta)
    .replace("{{n_conv}}", String(porChat.size))
    .replace("{{conversaciones}}", conversaciones);

  let contenido: ContenidoInsight;
  try {
    // Tarea de fondo: se le da aire (mide ~25 s con 40 conversaciones) y no se
    // reintenta, porque un reintento duplicaría el costo sin mejorar nada.
    const crudo = await generarJSON(prompt, {
      timeoutMs: 50_000,
      intentosPorModelo: 1,
      // Ver el comentario de thinkingBudget en gemini.ts: sin tope esta llamada
      // es impredecible (25 s a +43 s) y puede pasarse del límite de Vercel.
      thinkingBudget: 2048,
    });
    const p = JSON.parse(crudo) as Partial<ContenidoInsight>;

    /**
     * Normalización defensiva. Caso real visto en pruebas: el modelo devolvió
     * `resumen` como un TEXTO de varias frases en vez de una lista, y una
     * validación estricta habría descartado un informe perfectamente bueno.
     * Acá se acepta cualquiera de las dos formas: si viene texto, se parte en
     * frases; si viene lista, se limpia.
     */
    const lista = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
      if (typeof v === "string" && v.trim()) {
        return v
          .split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/) // corta entre frases, no en decimales
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8);
      }
      return [];
    };
    contenido = {
      resumen: lista(p.resumen),
      piden: lista(p.piden),
      problemas: lista(p.problemas),
      oportunidades: lista(p.oportunidades),
      fortalezas: lista(p.fortalezas),
      categorias: Array.isArray(p.categorias)
        ? p.categorias
            .filter((c) => c && typeof c === "object")
            .map((c) => ({
              nombre: String((c as Categoria).nombre ?? "").slice(0, 80),
              tickets: Number((c as Categoria).tickets) || 0,
              descripcion: String((c as Categoria).descripcion ?? "").slice(0, 300),
            }))
            .filter((c) => c.nombre)
            .slice(0, 8)
        : [],
    };
    if (!contenido.resumen.length) {
      return { ok: false, motivo: "El análisis volvió vacío. Intenta de nuevo en un momento." };
    }
  } catch (e) {
    return { ok: false, motivo: `No se pudo generar el análisis: ${(e as Error).message}` };
  }

  const { data: guardado, error: errGuardar } = await supa
    .from("ed_insights")
    .upsert(
      {
        cliente_id: clienteId,
        periodo_desde: desde,
        periodo_hasta: hasta,
        contenido,
        conversaciones: porChat.size,
        mensajes: filas.length,
        modelo: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        creado_en: new Date().toISOString(),
      },
      { onConflict: "cliente_id,periodo_desde" },
    )
    .select("id, periodo_desde, periodo_hasta, contenido, conversaciones, mensajes, creado_en")
    .maybeSingle();

  if (errGuardar || !guardado) {
    return { ok: false, motivo: `No se pudo guardar el informe: ${errGuardar?.message ?? "?"}` };
  }

  return {
    ok: true,
    insight: {
      id: guardado.id as string,
      periodoDesde: guardado.periodo_desde as string,
      periodoHasta: guardado.periodo_hasta as string,
      contenido: guardado.contenido as ContenidoInsight,
      conversaciones: guardado.conversaciones as number,
      mensajes: guardado.mensajes as number,
      creadoEn: guardado.creado_en as string,
    },
  };
}
