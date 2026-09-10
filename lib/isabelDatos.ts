import { db } from "@/lib/db";
import { LOCALE, ZONA } from "@/lib/fechas";
import { palabrasClave, situacionVacia, type SituacionNegocio } from "@/lib/isabelCore";

/**
 * ISABEL — LO QUE EL PORTAL YA INTERPRETÓ.
 *
 * Este módulo no analiza nada: junta lo que otras partes del sistema ya
 * decidieron, y que hasta ahora Isabel no veía.
 *
 *   · `ed_insights`   — el informe semanal. Un análisis que YA se pagó con una
 *                       llamada larga al modelo y que ella ignoraba por completo.
 *   · `ed_escalaciones` — por qué se derivó una conversación y el resumen de
 *                       tres líneas que dejó el asistente al derivarla.
 *   · `ed_cierres_detectados` — qué cierre se detectó y con qué frase textual.
 *   · `ed_pagos`      — qué se cobró y sigue sin pagarse, con monto y antigüedad.
 *   · `ed_citas`      — quién viene, cuándo y a qué.
 *   · `ed_resultados` — ventas, agendas, reseñas y clientes molestos del período.
 *
 * TRES REGLAS QUE VALEN MÁS QUE EL CÓDIGO
 *
 * 1. Todo va acotado y ordenado por lo más reciente. Ninguna consulta puede
 *    crecer con el tamaño del negocio: son topes fijos, no "todo lo que haya".
 * 2. Cada bloque falla solo. Si `ed_cierres_detectados` no existe en un
 *    ambiente, Isabel responde igual con lo demás — nunca se cae la pantalla
 *    entera por un bloque (la lección del logo en el layout, 9-sep-2026).
 * 3. Nada de esto se le pide al modelo que lo cuente. Son hechos; el modelo los
 *    usa, no los recalcula.
 */

/** Topes por bloque. Bajos a propósito: es contexto, no un listado. */
const TOPES = {
  informes: 2,
  citas: 12,
  cobros: 10,
  esperando: 8,
  cierres: 8,
  molestos: 5,
} as const;

/** Cuántos días de historia mira el bloque de resultados y cierres. */
const DIAS = 30;

function haceDias(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/** "vie 12 sep, 10:30" en hora de Chile. */
function cuando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: ZONA,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** "12 sep" — para cosas donde la hora no aporta. */
function dia(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: ZONA,
    day: "numeric",
    month: "short",
  }).format(d);
}

function diasDesde(iso: string): number {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return 0;
  return Math.max(0, Math.floor((Date.now() - d) / 86_400_000));
}

function recorte(v: unknown, n: number): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
}

/** Ejecuta un bloque y, si falla, devuelve el vacío en vez de tumbar el resto. */
async function seguro<T>(nombre: string, fn: () => Promise<T>, vacio: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[isabel] bloque «${nombre}» no disponible:`, (e as Error).message);
    return vacio;
  }
}

/**
 * Nombres de contacto para un puñado de chats.
 *
 * Vale la pena la consulta extra: «Ana Pérez lleva 3 días esperando» es
 * accionable y «…4821 lleva 3 días esperando» no lo es.
 */
async function nombresDe(clienteId: string, chats: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const unicos = [...new Set(chats.filter(Boolean))].slice(0, 60);
  if (!unicos.length) return mapa;
  try {
    const { data } = await db()
      .from("ed_contactos")
      .select("chat_id, nombre")
      .eq("cliente_id", clienteId)
      .in("chat_id", unicos);
    for (const c of data ?? []) {
      const n = recorte(c.nombre, 60);
      if (n) mapa.set(c.chat_id as string, n);
    }
  } catch {
    // Sin nombres se lee peor, pero se lee.
  }
  return mapa;
}

/** Cómo se llama alguien cuando no sabemos su nombre. */
function quienEs(chatId: string, nombres: Map<string, string>): string {
  return nombres.get(chatId) || `…${String(chatId).slice(-4)}`;
}

/**
 * Junta toda la situación del negocio.
 *
 * Los bloques corren en paralelo porque son independientes; el costo real es
 * una ida y vuelta a la base, no seis.
 */
/**
 * FICHA DE LAS PERSONAS QUE LA PREGUNTA NOMBRA.
 *
 * «¿Qué pasa con Ana Pérez?» no se responde bien buscando «Ana» entre los
 * mensajes: eso devuelve lo que se DIJO, no lo que el negocio SABE. La etapa
 * del embudo, la última atención, la ficha por rubro (la moto y su kilometraje,
 * la raza del perro), los cobros y las citas viven en cuatro tablas distintas y
 * ningún mensaje los menciona.
 *
 * Solo se dispara si alguna palabra de la pregunta calza con el nombre de un
 * contacto. Si nadie calza, no cuesta nada: son dos consultas cortas que no
 * devuelven filas.
 */
export async function fichasDeContactosNombrados(
  clienteId: string,
  pregunta: string,
): Promise<SituacionNegocio["contactos"]> {
  const supa = db();
  // Palabras de 4+ letras: los nombres cortos («Ana») se pierden, y está bien —
  // buscar por «Ana» traería a media agenda. Con apellido o nombre largo calza.
  const claves = palabrasClave(pregunta, 4).filter((p) => !/^\d+$/.test(p));
  if (!claves.length) return [];

  const encontrados = new Map<string, Record<string, unknown>>();
  try {
    const porTermino = await Promise.all(
      claves.slice(0, 3).map((t) =>
        supa
          .from("ed_contactos")
          .select("chat_id, nombre, etapa, etiquetas, ultima_atencion, datos, ultimo_mensaje_texto, ultimo_mensaje_en")
          .eq("cliente_id", clienteId)
          .ilike("nombre", `%${t.replace(/[%_\\]/g, "")}%`)
          .limit(3),
      ),
    );
    for (const r of porTermino) {
      for (const f of r.data ?? []) {
        if (encontrados.size >= 3) break;
        encontrados.set(f.chat_id as string, f as Record<string, unknown>);
      }
    }
  } catch {
    return [];
  }
  if (!encontrados.size) return [];

  const chats = [...encontrados.keys()];

  // Cobros y citas de esas personas, en una consulta cada uno.
  const [pagosR, citasR] = await Promise.all([
    seguro(
      "ficha-pagos",
      async () => {
        const { data } = await supa
          .from("ed_pagos")
          .select("chat_id, monto, concepto, estado, creado_en")
          .eq("cliente_id", clienteId)
          .in("chat_id", chats)
          .order("creado_en", { ascending: false })
          .limit(15);
        return data ?? [];
      },
      [] as Record<string, unknown>[],
    ),
    seguro(
      "ficha-citas",
      async () => {
        const { data } = await supa
          .from("ed_citas")
          .select("chat_id, inicio, estado")
          .eq("cliente_id", clienteId)
          .in("chat_id", chats)
          .order("inicio", { ascending: false })
          .limit(15);
        return data ?? [];
      },
      [] as Record<string, unknown>[],
    ),
  ]);

  const agrupar = (filas: Record<string, unknown>[], armar: (f: Record<string, unknown>) => string) => {
    const m = new Map<string, string[]>();
    for (const f of filas) {
      const k = f.chat_id as string;
      const arr = m.get(k) ?? [];
      if (arr.length < 4) arr.push(armar(f));
      m.set(k, arr);
    }
    return m;
  };

  const pagosPorChat = agrupar(pagosR, (f) => {
    const monto = `$${Math.round(Number(f.monto) || 0).toLocaleString("es-CL")}`;
    return `${monto} por ${recorte(f.concepto, 50)} — ${f.estado} (${dia(f.creado_en as string)})`;
  });
  const citasPorChat = agrupar(citasR, (f) => `${cuando(f.inicio as string)} (${f.estado})`);

  return chats.map((chat) => {
    const c = encontrados.get(chat) ?? {};
    const datos = (c.datos ?? {}) as Record<string, unknown>;
    // La atribución de campaña ya se muestra en Pauta; acá estorbaría.
    const propios = Object.entries(datos)
      .filter(([k]) => k !== "campana")
      .map(([k, v]) => `${k}: ${recorte(v, 60)}`)
      .slice(0, 6)
      .join(" · ");

    const ultimo = c.ultimo_mensaje_texto
      ? `«${recorte(c.ultimo_mensaje_texto, 140)}» (${dia(c.ultimo_mensaje_en as string)})`
      : "";

    return {
      quien: recorte(c.nombre, 60) || `…${chat.slice(-4)}`,
      etapa: recorte(c.etapa, 20) || "nuevo",
      etiquetas: Array.isArray(c.etiquetas) ? (c.etiquetas as string[]).slice(0, 6) : [],
      ultimaAtencion: c.ultima_atencion ? dia(`${c.ultima_atencion}T12:00:00Z`) : "",
      ultimoMensaje: ultimo,
      datos: propios,
      pagos: (pagosPorChat.get(chat) ?? []).join(" · "),
      citas: (citasPorChat.get(chat) ?? []).join(" · "),
    };
  });
}

export async function situacionDelNegocio(clienteId: string): Promise<SituacionNegocio> {
  const supa = db();
  const situacion = situacionVacia();

  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId);
  const ids = (empleados ?? []).map((e) => e.id as string);

  const [informes, citas, cobros, escalaciones, cierres, resultados] = await Promise.all([
    // ── Informes semanales ya generados ──────────────────────────────────────
    seguro(
      "informes",
      async () => {
        const { data } = await supa
          .from("ed_insights")
          .select("periodo_desde, periodo_hasta, contenido")
          .eq("cliente_id", clienteId)
          .order("periodo_desde", { ascending: false })
          .limit(TOPES.informes);
        return (data ?? []).map((f) => {
          const c = (f.contenido ?? {}) as Record<string, unknown>;
          const lista = (v: unknown, n: number) =>
            Array.isArray(v) ? v.map((x) => recorte(x, 220)).filter(Boolean).slice(0, n) : [];
          return {
            periodo: `${dia(`${f.periodo_desde}T12:00:00Z`)} al ${dia(`${f.periodo_hasta}T12:00:00Z`)}`,
            resumen: lista(c.resumen, 3),
            problemas: lista(c.problemas, 3),
            oportunidades: lista(c.oportunidades, 2),
          };
        });
      },
      [] as SituacionNegocio["informes"],
    ),

    // ── Próximas citas ───────────────────────────────────────────────────────
    seguro(
      "citas",
      async () => {
        /**
         * DOS CONSULTAS EN VEZ DE UN EMBED, a propósito. Un `select` anidado de
         * PostgREST hacia ed_servicios obliga a nombrar la llave foránea exacta,
         * y ya nos costó once días de agenda vacía equivocarnos en eso
         * (bug del join ambiguo, ago-2026). Son doce filas: dos viajes a la base
         * cuestan menos que un bloque que se cae en silencio.
         */
        const { data } = await supa
          .from("ed_citas")
          .select("inicio, estado, nombre_contacto, servicio_id")
          .eq("cliente_id", clienteId)
          .gte("inicio", new Date().toISOString())
          .in("estado", ["agendada", "confirmada", "reagendada"])
          .order("inicio", { ascending: true })
          .limit(TOPES.citas);
        const filas = data ?? [];
        if (!filas.length) return [];

        const servicios = new Map<string, string>();
        const idsServicio = [...new Set(filas.map((f) => f.servicio_id as string).filter(Boolean))];
        if (idsServicio.length) {
          const { data: servs } = await supa
            .from("ed_servicios")
            .select("id, nombre")
            .eq("cliente_id", clienteId)
            .in("id", idsServicio);
          for (const s of servs ?? []) servicios.set(s.id as string, recorte(s.nombre, 60));
        }

        return filas.map((f) => ({
          cuando: cuando(f.inicio as string),
          quien: recorte(f.nombre_contacto, 60) || "sin nombre",
          servicio: servicios.get(f.servicio_id as string) || "sin servicio",
          estado: recorte(f.estado, 20),
        }));
      },
      [] as SituacionNegocio["citas"],
    ),

    // ── Cobros emitidos y sin pagar ──────────────────────────────────────────
    seguro(
      "cobros",
      async () => {
        const { data } = await supa
          .from("ed_pagos")
          .select("chat_id, monto, concepto, creado_en")
          .eq("cliente_id", clienteId)
          .eq("estado", "pendiente")
          .order("creado_en", { ascending: true }) // los más viejos primero: duelen más
          .limit(TOPES.cobros);
        return (data ?? []).map((f) => ({
          chatId: f.chat_id as string,
          monto: Number(f.monto) || 0,
          concepto: recorte(f.concepto, 80),
          dias: diasDesde(f.creado_en as string),
        }));
      },
      [] as { chatId: string; monto: number; concepto: string; dias: number }[],
    ),

    // ── Derivaciones abiertas ────────────────────────────────────────────────
    seguro(
      "esperando",
      async () => {
        if (!ids.length) return [];
        const { data } = await supa
          .from("ed_escalaciones")
          .select("chat_id, trigger, resumen, creado_en")
          .in("empleado_id", ids)
          .is("atendida_en", null)
          .order("creado_en", { ascending: true }) // el que espera hace más rato, primero
          .limit(TOPES.esperando);
        return (data ?? []).map((f) => ({
          chatId: f.chat_id as string,
          motivo: recorte(f.trigger, 40) || "sin motivo",
          resumen: recorte(f.resumen, 240),
          dias: diasDesde(f.creado_en as string),
        }));
      },
      [] as { chatId: string; motivo: string; resumen: string; dias: number }[],
    ),

    // ── Cierres detectados, con su evidencia ─────────────────────────────────
    seguro(
      "cierres",
      async () => {
        const { data } = await supa
          .from("ed_cierres_detectados")
          .select("chat_id, estado, evidencia, creado_en")
          .eq("cliente_id", clienteId)
          .gte("creado_en", haceDias(DIAS))
          .order("creado_en", { ascending: false })
          .limit(TOPES.cierres);
        return (data ?? [])
          .filter((f) => recorte(f.evidencia, 200))
          .map((f) => ({
            chatId: f.chat_id as string,
            estado: recorte(f.estado, 30),
            evidencia: recorte(f.evidencia, 160),
            cuando: dia(f.creado_en as string),
          }));
      },
      [] as { chatId: string; estado: string; evidencia: string; cuando: string }[],
    ),

    // ── Resultados del período ───────────────────────────────────────────────
    seguro(
      "resultados",
      async () => {
        if (!ids.length) return [];
        const { data } = await supa
          .from("ed_resultados")
          .select("chat_id, tipo, valor_clp, creado_en")
          .in("empleado_id", ids)
          .gte("creado_en", haceDias(DIAS))
          .order("creado_en", { ascending: false })
          .limit(1000);
        return (data ?? []).map((f) => ({
          chatId: f.chat_id as string,
          tipo: f.tipo as string,
          valor: Number(f.valor_clp) || 0,
          creadoEn: f.creado_en as string,
        }));
      },
      [] as { chatId: string; tipo: string; valor: number; creadoEn: string }[],
    ),
  ]);

  // Los nombres se piden UNA vez para todos los bloques que los necesitan.
  const nombres = await nombresDe(clienteId, [
    ...cobros.map((c) => c.chatId),
    ...escalaciones.map((e) => e.chatId),
    ...cierres.map((c) => c.chatId),
    ...resultados.filter((r) => r.tipo === "cliente_molesto").map((r) => r.chatId),
  ]);

  situacion.informes = informes;
  situacion.citas = citas;
  situacion.cobrosPendientes = cobros.map((c) => ({
    quien: quienEs(c.chatId, nombres),
    monto: c.monto,
    concepto: c.concepto,
    dias: c.dias,
  }));
  situacion.esperando = escalaciones.map((e) => ({
    quien: quienEs(e.chatId, nombres),
    motivo: e.motivo,
    resumen: e.resumen,
    dias: e.dias,
  }));
  situacion.cierres = cierres.map((c) => ({
    quien: quienEs(c.chatId, nombres),
    estado: c.estado,
    evidencia: c.evidencia,
    cuando: c.cuando,
  }));

  /**
   * Los resultados se agregan por tipo. Un listado de 300 filas no le dice nada
   * a nadie; «venta_confirmada: 14 ($890.000)» sí.
   */
  const porTipo = new Map<string, { total: number; valor: number }>();
  for (const r of resultados) {
    const acc = porTipo.get(r.tipo) ?? { total: 0, valor: 0 };
    acc.total += 1;
    acc.valor += r.valor;
    porTipo.set(r.tipo, acc);
  }
  situacion.resultados = [...porTipo.entries()]
    .map(([tipo, v]) => ({ tipo, ...v }))
    .sort((a, b) => b.total - a.total);

  /**
   * Los clientes molestos salen del agregado y van con nombre y fecha. Es el
   * único bloque donde una fila individual importa más que el total: «hubo 3
   * molestos» no sirve, «Ana el martes» sí.
   */
  situacion.molestos = resultados
    .filter((r) => r.tipo === "cliente_molesto")
    .slice(0, TOPES.molestos)
    .map((r) => ({
      quien: quienEs(r.chatId, nombres),
      cuando: dia(r.creadoEn),
      nota: "",
    }));

  return situacion;
}
