import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { empleadosDeCliente, type EmpleadoBasico } from "@/lib/empleadosCache";
import { contarEsperando } from "@/lib/metricas";
import {
  CITAS_ACTIVAS,
  COLUMNAS_CONTACTO,
  TIPOS_RESULTADO_ESTADO,
  armarHechos,
} from "@/lib/estadoComercialFilas";
import {
  DIAS_RETOMAR_MAX,
  RANGO_OPORTUNIDAD,
  atencionRequerida,
  compararItems,
  oportunidadAbierta,
  siguienteAccion,
  TIPO_SEGUIMIENTO_COTIZACION,
  type AccionSugerida,
  type Atencion,
  type ContextoNegocio,
  type GrupoAtencion,
  type HechosContacto,
  type Oportunidad,
} from "@/lib/estadoComercialCore";

/**
 * CARGADOR DEL ESTADO COMERCIAL (Fase 1) — lee los hechos de sus dueños, POR
 * LOTE, y los pasa al núcleo puro (lib/estadoComercialCore.ts).
 *
 * ⚠️ NÚMERO FIJO DE CONSULTAS, NO UNA POR CLIENTE.
 * Cada tabla se consulta una vez con `.in("chat_id", lote)`: 400 contactos son
 * dos lotes, no 400 viajes. Nada acá recorre contactos haciendo consultas.
 *
 * ⚠️ TABLAS OPCIONALES FALLAN SUAVE.
 * Pagos (289), propuestas (297) y citas (220) pueden no existir en un entorno:
 * su error se trata como «sin filas». Contactos, estados y derivaciones son
 * base del producto y su error se propaga como `completo: false`.
 */

type Supa = SupabaseClient | ReturnType<typeof db>;
type Fila = Record<string, unknown>;

const DIA = 86_400_000;
/** Ids por consulta `.in()`. ~16 caracteres por id: la URL queda muy por debajo del límite. */
const LOTE = 200;

function trozos<T>(arr: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

type Respuesta = { data: Fila[] | null; error: unknown };

async function porLotes(
  ids: readonly string[],
  consulta: (lote: string[]) => PromiseLike<Respuesta>,
  opcional = false,
): Promise<{ filas: Fila[]; ok: boolean }> {
  if (!ids.length) return { filas: [], ok: true };
  const resp = await Promise.all(
    trozos(ids, LOTE).map(async (lote) => {
      try {
        return await consulta(lote);
      } catch (e) {
        return { data: null, error: e } as Respuesta;
      }
    }),
  );
  const filas: Fila[] = [];
  let ok = true;
  for (const r of resp) {
    if (r.error) {
      if (!opcional) ok = false;
      continue;
    }
    filas.push(...(r.data ?? []));
  }
  return { filas, ok };
}

/**
 * CONTEXTO DEL NEGOCIO para las reglas: si Beto retoma cotizaciones, si hay
 * enlace de pago y quién mira. Una consulta; columnas nuevas con respaldo.
 */
export async function contextoNegocio(
  clienteId: string,
  opts: { puedeAprobarPagados: boolean },
  supa: Supa = db(),
): Promise<ContextoNegocio> {
  const empleados = await empleadosDeCliente(clienteId);
  const nombre = (rol: string) => empleados.find((e) => e.rol === rol)?.nombrePublico || undefined;

  let fila: Fila | null = null;
  for (const cols of ["cotizacion_seguimiento, pago_link_base", "pago_link_base", "id"]) {
    const r = await supa.from("ed_clientes").select(cols).eq("id", clienteId).maybeSingle();
    if (!r.error) {
      fila = (r.data as Fila | null) ?? null;
      break;
    }
  }
  return {
    ahora: Date.now(),
    betoCotizaciones: fila?.cotizacion_seguimiento === true,
    tienePagoLink: typeof fila?.pago_link_base === "string" && Boolean((fila.pago_link_base as string).trim()),
    puedeAprobarPagados: opts.puedeAprobarPagados,
    nombreTino: nombre("tino"),
    nombreBeto: nombre("rita"),
  };
}

/** Tope real de PostgREST: pedir más no trae más. */
const LIMITE_DERIVACIONES = 1000;

/** Igual que DIAS_CLIENTE_ESPERA_MAX: más atrás, ese motivo ya no aparece. */
const DIAS_ATENDIDAS = 31;

/**
 * Hechos de un conjunto de chats. `previos` evita volver a pedir lo que el
 * llamador ya trajo (los contactos y derivaciones de la búsqueda de candidatos).
 */
export async function cargarHechos(
  clienteId: string,
  chatIds: readonly string[],
  opts: {
    empleados?: EmpleadoBasico[];
    contactos?: Fila[];
    derivaciones?: Fila[];
    ahora?: number;
  } = {},
  supa: Supa = db(),
): Promise<{ hechos: Map<string, HechosContacto>; completo: boolean }> {
  const ids = [...new Set(chatIds)];
  const empleados = opts.empleados ?? (await empleadosDeCliente(clienteId));
  const empIds = empleados.map((e) => e.id);
  if (!ids.length || !empIds.length) return { hechos: new Map(), completo: true };

  const ahora = opts.ahora ?? Date.now();
  const hace = (dias: number) => new Date(ahora - dias * DIA).toISOString();

  const yaContactos = new Set((opts.contactos ?? []).map((c) => c.chat_id as string));
  const faltanContactos = ids.filter((id) => !yaContactos.has(id));
  const set = new Set(ids);

  const [contactos, estados, derivaciones, pagos, resultados, propuestas, seguimientos, citas, atendidas] = await Promise.all([
    porLotes(faltanContactos, (l) =>
      supa.from("ed_contactos").select(COLUMNAS_CONTACTO).eq("cliente_id", clienteId).in("chat_id", l),
    ),
    porLotes(ids, (l) =>
      supa.from("ed_chat_estado").select("empleado_id, chat_id, modo").in("empleado_id", empIds).in("chat_id", l),
    ),
    opts.derivaciones
      ? Promise.resolve({ filas: opts.derivaciones.filter((d) => set.has(d.chat_id as string)), ok: true })
      : porLotes(ids, (l) =>
          supa
            .from("ed_escalaciones")
            .select("chat_id, trigger, resumen, creado_en")
            .in("empleado_id", empIds)
            .in("chat_id", l)
            .is("atendida_en", null),
        ),
    porLotes(
      ids,
      (l) =>
        supa
          .from("ed_pagos")
          .select("id, chat_id, estado, monto, creado_en, pagado_en")
          .eq("cliente_id", clienteId)
          .in("chat_id", l)
          .neq("estado", "anulado")
          .gte("creado_en", hace(180)),
      true,
    ),
    porLotes(ids, (l) =>
      supa
        .from("ed_resultados")
        .select("chat_id, tipo, creado_en, nota")
        .in("empleado_id", empIds)
        .in("chat_id", l)
        .in("tipo", [...TIPOS_RESULTADO_ESTADO])
        .gte("creado_en", hace(180)),
    ),
    porLotes(
      ids,
      (l) =>
        supa
          .from("ed_propuestas_seguimiento")
          .select("chat_id, estado, creado_en, resuelto_en, motivo_juez")
          .eq("cliente_id", clienteId)
          .eq("tipo", TIPO_SEGUIMIENTO_COTIZACION)
          .in("chat_id", l)
          // Las que esperan aprobación cuentan aunque sean viejas: si no, una
          // propuesta de hace 3 meses desaparece de Inicio sin resolverse.
          .or(`estado.eq.propuesto,creado_en.gte.${hace(90)}`),
      true,
    ),
    porLotes(ids, (l) =>
      supa
        .from("ed_seguimientos")
        .select("empleado_id, chat_id, tipo, programado_para, enviado_en, respuesta_recibida, variables")
        .in("empleado_id", empIds)
        .in("chat_id", l)
        .gte("programado_para", hace(60)),
    ),
    porLotes(
      ids,
      (l) =>
        supa
          .from("ed_citas")
          .select("id, chat_id, inicio, fin, estado")
          .eq("cliente_id", clienteId)
          .in("chat_id", l)
          .in("estado", [...CITAS_ACTIVAS])
          .gte("fin", hace(30)),
      true,
    ),
    // Derivaciones ya cerradas: «Ya lo atendí» saca el chat de Inicio aunque
    // siga en manos de una persona (ver atencionRequerida).
    porLotes(
      ids,
      (l) =>
        supa
          .from("ed_escalaciones")
          .select("chat_id, atendida_en")
          .in("empleado_id", empIds)
          .in("chat_id", l)
          .gte("atendida_en", hace(DIAS_ATENDIDAS)),
      true,
    ),
  ]);

  const hechos = armarHechos({
    contactos: [...(opts.contactos ?? []).filter((c) => set.has(c.chat_id as string)), ...contactos.filas],
    estados: estados.filas,
    derivaciones: derivaciones.filas,
    pagos: pagos.filas,
    resultados: resultados.filas,
    propuestas: propuestas.filas,
    seguimientos: seguimientos.filas,
    citas: citas.filas,
    atendidas: atendidas.filas,
    empleados,
  });
  const completo = contactos.ok && estados.ok && derivaciones.ok && resultados.ok && seguimientos.ok;
  return { hechos, completo };
}

// ─── Panorama para Inicio ───────────────────────────────────────────────────

export type FilaAtencion = {
  chatId: string;
  /** Empleado con el que abrir la conversación (último que habló, o Tino). */
  empleadoId: string | null;
  nombre: string;
  atencion: Atencion;
  accion: AccionSugerida | null;
  /** Etiquetas del resto de motivos del mismo chat («+ Pago por confirmar»). */
  otros: string[];
};

export type FilaOportunidad = {
  chatId: string;
  empleadoId: string | null;
  nombre: string;
  etapa: HechosContacto["etapa"];
  oportunidad: Oportunidad;
  ultimoMensaje: string | null;
};

export type PanoramaInicio = {
  atencion: FilaAtencion[];
  conteoAtencion: Record<GrupoAtencion, number>;
  /** Chats con derivación abierta: la misma cifra que el menú y la bandeja. */
  derivadas: number;
  oportunidades: FilaOportunidad[];
  conteoOportunidades: Partial<Record<Oportunidad["tipo"], number>>;
  completo: boolean;
};

/**
 * LO QUE INICIO NECESITA SABER, EN DOS TANDAS.
 *
 * Tanda 1 — candidatos, siete consultas en paralelo, cada una acotada:
 *   · derivaciones abiertas del negocio            (todas: son la cifra canónica)
 *   · contactos donde el cliente habló último ≤30 d (posible «espera respuesta»)
 *   · contactos con «Pago por confirmar» o «Falta pago»
 *   · contactos interesados/cotizados con actividad ≤30 d
 *   · propuestas de Beto vivas · cobros pendientes · citas pasadas sin cerrar
 * Tanda 2 — hechos del conjunto (cargarHechos), reutilizando lo ya traído.
 *
 * Después todo es memoria: el núcleo decide qué requiere atención y qué está
 * por cerrarse, con las mismas reglas que la ficha de la conversación.
 */
export async function panoramaInicio(
  clienteId: string,
  ctx: ContextoNegocio,
  supa: Supa = db(),
  opts: { empleados?: EmpleadoBasico[] } = {},
): Promise<PanoramaInicio> {
  const empleados = opts.empleados ?? (await empleadosDeCliente(clienteId));
  const empIds = empleados.map((e) => e.id);
  const vacio: PanoramaInicio = {
    atencion: [],
    conteoAtencion: { urgente: 0, hoy: 0, esta_semana: 0, pendiente: 0, antiguo: 0 },
    derivadas: 0,
    oportunidades: [],
    conteoOportunidades: {},
    completo: true,
  };
  if (!empIds.length) return vacio;

  const hace = (dias: number) => new Date(ctx.ahora - dias * DIA).toISOString();
  const opcional = async (p: PromiseLike<Respuesta>): Promise<Fila[]> => {
    try {
      const r = await p;
      return r.error ? [] : r.data ?? [];
    } catch {
      return [];
    }
  };

  const [deriv, clienteUltimo, conPago, abiertas, propuestas, cobros, citas, esperando] = await Promise.all([
    supa
      .from("ed_escalaciones")
      .select("chat_id, empleado_id, trigger, resumen, creado_en")
      .in("empleado_id", empIds)
      .is("atendida_en", null)
      // Más nuevas primero: PostgREST corta en 1.000 filas y, si corta, que
      // falten las más viejas (irían a «Más de 7 días»), no las de hoy.
      .order("creado_en", { ascending: false })
      .limit(LIMITE_DERIVACIONES),
    supa
      .from("ed_contactos")
      .select(COLUMNAS_CONTACTO)
      .eq("cliente_id", clienteId)
      .eq("ultimo_mensaje_rol", "cliente")
      .gte("ultimo_mensaje_en", hace(30))
      .order("ultimo_mensaje_en", { ascending: false })
      .limit(500),
    supa
      .from("ed_contactos")
      .select(COLUMNAS_CONTACTO)
      .eq("cliente_id", clienteId)
      .overlaps("etiquetas", ["pago_por_confirmar", "pago_pendiente"])
      .limit(300),
    supa
      .from("ed_contactos")
      .select(COLUMNAS_CONTACTO)
      .eq("cliente_id", clienteId)
      .or("etapa.in.(interesado,cotizado),etiquetas.cs.{cotizacion}")
      .gte("ultimo_mensaje_en", hace(DIAS_RETOMAR_MAX + 1))
      .order("ultimo_mensaje_en", { ascending: false })
      .limit(300),
    opcional(
      supa
        .from("ed_propuestas_seguimiento")
        .select("chat_id")
        .eq("cliente_id", clienteId)
        .eq("estado", "propuesto")
        .limit(300),
    ),
    opcional(
      supa.from("ed_pagos").select("chat_id").eq("cliente_id", clienteId).eq("estado", "pendiente").limit(300),
    ),
    opcional(
      supa
        .from("ed_citas")
        .select("chat_id")
        .eq("cliente_id", clienteId)
        .in("estado", [...CITAS_ACTIVAS])
        .lt("fin", new Date(ctx.ahora).toISOString())
        .gte("fin", hace(30))
        .not("chat_id", "is", null)
        .limit(300),
    ),
    // La cifra canónica de «derivadas» (menú y bandeja): misma RPC.
    contarEsperando(clienteId, empIds, supa).catch(() => null),
  ]);

  const contactos = new Map<string, Fila>();
  for (const r of [clienteUltimo, conPago, abiertas]) {
    for (const c of r.data ?? []) contactos.set(c.chat_id as string, c as Fila);
  }
  const derivFilas = (deriv.data ?? []) as Fila[];
  const ids = new Set<string>(contactos.keys());
  for (const f of [...derivFilas, ...propuestas, ...cobros, ...citas]) {
    if (typeof f.chat_id === "string" && f.chat_id) ids.add(f.chat_id);
  }

  const { hechos, completo } = await cargarHechos(
    clienteId,
    [...ids],
    { empleados, contactos: [...contactos.values()], derivaciones: derivFilas, ahora: ctx.ahora },
    supa,
  );

  const atencion: FilaAtencion[] = [];
  const oportunidades: FilaOportunidad[] = [];
  const conteoAtencion: Record<GrupoAtencion, number> = { urgente: 0, hoy: 0, esta_semana: 0, pendiente: 0, antiguo: 0 };
  const conteoOportunidades: Partial<Record<Oportunidad["tipo"], number>> = {};

  for (const h of hechos.values()) {
    const nombre = h.nombre || (h.chatId.startsWith("ig:") ? "Instagram" : `+${h.chatId}`);
    const a = atencionRequerida(h, ctx);
    if (a.requiere && a.principal && a.grupo) {
      conteoAtencion[a.grupo] += 1;
      atencion.push({
        chatId: h.chatId,
        empleadoId: h.empleadoId ?? null,
        nombre,
        atencion: a,
        accion: siguienteAccion(h, ctx, a),
        otros: a.items.slice(1).map((i) => i.label),
      });
      continue; // Lo que ya pide atención no se repite en «por cerrarse».
    }
    const o = oportunidadAbierta(h, ctx);
    if (o) {
      conteoOportunidades[o.tipo] = (conteoOportunidades[o.tipo] ?? 0) + 1;
      oportunidades.push({
        chatId: h.chatId,
        empleadoId: h.empleadoId ?? null,
        nombre,
        etapa: h.etapa,
        oportunidad: o,
        ultimoMensaje: (contactos.get(h.chatId)?.ultimo_mensaje_texto as string | undefined) ?? null,
      });
    }
  }

  atencion.sort((x, y) => compararItems(x.atencion.principal!, y.atencion.principal!));
  oportunidades.sort((x, y) => {
    const r = RANGO_OPORTUNIDAD[x.oportunidad.tipo] - RANGO_OPORTUNIDAD[y.oportunidad.tipo];
    if (r) return r;
    return Date.parse(y.oportunidad.desde ?? "") - Date.parse(x.oportunidad.desde ?? "") || 0;
  });

  return {
    atencion,
    conteoAtencion,
    derivadas: esperando ?? new Set(derivFilas.map((d) => d.chat_id as string)).size,
    oportunidades,
    conteoOportunidades,
    completo: completo && derivFilas.length < LIMITE_DERIVACIONES && !deriv.error && !clienteUltimo.error && !conPago.error && !abiertas.error,
  };
}

