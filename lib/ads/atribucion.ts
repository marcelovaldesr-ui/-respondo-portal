import { db } from "@/lib/db";
import { exigirId } from "@/lib/marketing/tenant";
import { bordesUTC, periodoAnterior, type Rango } from "@/lib/ads/periodos";
import type { DatosPropios } from "@/lib/ads/metricas";
import {
  agruparPorAnuncio,
  claveDeAviso,
  estadoAtribucion,
  nombreDeAviso,
  resumenPauta,
  TIPOS_VENTA,
  type CampanaContacto,
  type ContactoPauta,
  type FilaPauta,
  type PagoPauta,
  type ResultadoPauta,
  type ResumenPauta,
} from "@/lib/ads/atribucionCore";

/**
 * PAUTA — las consultas. La aritmética vive en pautaCore.ts.
 *
 * ⚠️ ESTE MÓDULO NO NECESITA NINGUNA MIGRACIÓN. Lee tres cosas que ya existen
 * en producción: el anuncio de origen (`ed_contactos.datos.campana`, migración
 * 282), los resultados del embudo (`ed_resultados`) y los pagos de Flow
 * (`ed_pagos`, migración 289). Se puede desplegar sin esperar a nadie, que es
 * justamente por qué se hizo primero.
 *
 * Aislamiento: todo se filtra por el `cliente_id` de la sesión y por los
 * empleados de ESE cliente. Misma regla que el resto del portal.
 */

/** PostgREST corta en 1.000 filas; mismo criterio que analitica.ts e insights.ts. */
const PAGINA = 1000;

/** `.in()` con miles de valores arma una URL enorme: se parte en tandas. */
const TANDA = 200;

function trozos<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export type Pauta = {
  filas: FilaPauta[];
  resumen: ResumenPauta;
  estado: ReturnType<typeof estadoAtribucion>;
  /** Contactos del cliente que NO vinieron de un anuncio (para dar contexto). */
  sinAnuncio: number;
  /** El período mirado. */
  rango: Rango;
  /** Lo mismo, en el vocabulario de las métricas. */
  propios: DatosPropios;
  /** El período anterior, para comparar. null cuando no corresponde. */
  propiosAntes: DatosPropios | null;
};

/**
 * EL MODELO DE ATRIBUCIÓN, ESCRITO PARA QUE NO SE OLVIDE.
 *
 * **Primer contacto pagado (first paid touch), con ventana abierta.**
 *
 * Qué significa: una conversación se le atribuye al PRIMER anuncio que la
 * trajo, y esa atribución no vence. Si alguien llegó por un aviso en marzo y
 * compró en junio, la venta es de ese aviso de marzo.
 *
 * Por qué así y no de otra forma:
 *  · **No es una elección, es lo que el dato permite.** Meta manda el objeto
 *    `referral` SOLO en el primer mensaje de la conversación. No hay un segundo
 *    toque que registrar aunque quisiéramos: last-touch requeriría un dato que
 *    no existe.
 *  · **En una pyme el ciclo es corto.** Entre el clic y la compra suelen pasar
 *    días, no meses; la diferencia entre modelos de atribución casi no cambia
 *    el resultado, y sí cambiaría mucho la complejidad.
 *  · **Es más conservador que Meta.** El Administrador de Anuncios usa ventanas
 *    de 7 días para el clic y 1 día para la vista, y se atribuye conversiones
 *    que nosotros no. Que nuestras cifras sean MENORES que las de Meta es lo
 *    correcto: son las que podemos defender una por una.
 *
 * Dónde vive: `inboundMeta.ts` guarda la referencia una sola vez y nunca pisa
 * la anterior. Ese `if (!datos.campana)` ES el modelo de atribución.
 *
 * Qué haría falta para cambiarlo: guardar un historial de referencias por
 * contacto en vez de una sola. La tabla no existe hoy a propósito — cuando un
 * cliente tenga ciclos largos, ese es el momento de crearla.
 */
export const MODELO_ATRIBUCION = "primer_contacto_pagado" as const;

/**
 * Trae los contactos que traen anuncio de origen.
 *
 * Se intenta primero el filtro en la base (`datos->campana` no nulo), que es lo
 * barato. Si el motor lo rechaza —o la columna `datos` no existiera todavía en
 * algún ambiente— se cae a traer los contactos y filtrar acá. Vale la pena la
 * doble vía: esta pantalla NO puede caerse, y un negocio chico tiene miles de
 * contactos, no millones.
 */
/**
 * Cuántos contactos entraron en el período, VINIERAN O NO de un anuncio.
 *
 * Va en su propia consulta de conteo porque `contactosConAnuncio` filtra por
 * `datos->campana` en la base: su `total` era el total de los YA filtrados, así
 * que «contactos del período» y «vinieron de un anuncio» daban siempre lo mismo
 * y la pantalla afirmaba «100,0% del total» en negocios que obviamente reciben
 * consultas orgánicas. Un `head: true` no trae filas: cuesta casi nada.
 */
async function contarContactos(clienteId: string, desdeISO: string, hastaISO: string): Promise<number | null> {
  try {
    const { count, error } = await db()
      .from("ed_contactos")
      .select("chat_id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .gte("creado_en", desdeISO)
      .lte("creado_en", hastaISO);
    if (error) return null;
    return count ?? null;
  } catch {
    return null;
  }
}

/**
 * CUÁNDO «LLEGÓ» ALGUIEN DESDE UN ANUNCIO.
 *
 * Hay dos fechas y no son la misma:
 *   · `creado_en`  — cuándo apareció el contacto en el portal, por CUALQUIER vía.
 *   · `datos.campana.visto` — cuándo escribió DESDE EL ANUNCIO. Lo escribe
 *     `inboundMeta` en el primer mensaje que trae el referral de Meta.
 *
 * Para atribución la buena es `visto`: es el momento en que el aviso trajo a
 * esa persona. La consulta filtraba por `creado_en` y la pantalla mostraba
 * `visto`, así que un contacto que ya existía y recién ahora hizo clic en un
 * anuncio quedaba FUERA del período —aunque el anuncio lo hubiera traído
 * dentro—, y uno con el referral un día después del corte aparecía en la lista
 * con una fecha posterior al período.
 *
 * Cómo se arregla sin pedirle a la base un índice sobre JSON: se trae con el
 * filtro barato e indexado de `creado_en`, PERO con una ventana hacia atrás
 * (`visto` siempre es igual o posterior a `creado_en`), y después se recorta en
 * memoria por `visto`, que es la fecha que además se muestra. Las dos cosas
 * pasan a contar lo mismo.
 */
const DIAS_DE_HOLGURA = 120;

function restarDias(iso: string, dias: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString();
}

async function contactosConAnuncio(
  clienteId: string,
  desdeISO: string,
  hastaISO: string,
): Promise<{ contactos: ContactoPauta[]; total: number }> {
  const supa = db();
  const columnas = "chat_id, nombre, datos, creado_en";

  const arma = (filas: Record<string, unknown>[]): ContactoPauta[] =>
    filas
      .map((f): ContactoPauta | null => {
        const datos = (f.datos ?? {}) as Record<string, unknown>;
        const campana = datos.campana as ContactoPauta["campana"] | undefined;
        if (!campana || typeof campana !== "object") return null;
        return {
          chatId: f.chat_id as string,
          nombre: (f.nombre as string | null) ?? null,
          // `visto` lo escribe inboundMeta; si faltara, sirve la fecha del contacto.
          campana: { ...campana, visto: campana.visto ?? (f.creado_en as string) },
        };
      })
      .filter((x): x is ContactoPauta => x !== null);

  // Se pide con holgura hacia atrás y se recorta por `visto` al final.
  const desdeConsulta = restarDias(desdeISO, DIAS_DE_HOLGURA);
  const enPeriodo = (c: ContactoPauta) => {
    const v = c.campana.visto;
    return !v || (v >= desdeISO && v <= hastaISO);
  };

  // Camino rápido.
  try {
    const filas: Record<string, unknown>[] = [];
    for (let inicio = 0; ; inicio += PAGINA) {
      const { data, error } = await supa
        .from("ed_contactos")
        .select(columnas)
        .eq("cliente_id", clienteId)
        .not("datos->campana", "is", null)
        .gte("creado_en", desdeConsulta)
        .lte("creado_en", hastaISO)
        .order("creado_en", { ascending: false })
        .range(inicio, inicio + PAGINA - 1);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      filas.push(...(data as Record<string, unknown>[]));
      if (data.length < PAGINA) break;
      if (inicio > 20_000) break;
    }
    const dentro = arma(filas).filter(enPeriodo);
    return { contactos: dentro, total: dentro.length };
  } catch {
    // Camino lento, pero que no deja la pantalla en blanco.
    const filas: Record<string, unknown>[] = [];
    for (let inicio = 0; ; inicio += PAGINA) {
      const { data, error } = await supa
        .from("ed_contactos")
        .select(columnas)
        .eq("cliente_id", clienteId)
        .gte("creado_en", desdeConsulta)
        .lte("creado_en", hastaISO)
        .order("creado_en", { ascending: false })
        .range(inicio, inicio + PAGINA - 1);
      if (error || !data?.length) break;
      filas.push(...(data as Record<string, unknown>[]));
      if (data.length < PAGINA) break;
      if (inicio > 20_000) break;
    }
    const dentro = arma(filas).filter(enPeriodo);
    return { contactos: dentro, total: dentro.length };
  }
}

/**
 * El informe de pauta de un cliente.
 *
 * `dias` mira hacia atrás sobre la fecha del contacto, no sobre la del pago: lo
 * que se está midiendo es "de los que ENTRARON en este período, cuántos
 * compraron", que es la pregunta que se hace quien pone plata en anuncios.
 */
export async function cargarPauta(clienteId: string, rango: Rango): Promise<Pauta> {
  // Un `clienteId` vacío haría que PostgREST ignorara el filtro y devolviera la
  // tabla entera. Hoy siempre viene de la sesión, pero la guarda cuesta nada.
  exigirId(clienteId);
  const supa = db();
  const { desdeISO, hastaISO } = bordesUTC(rango);

  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId);
  const ids = (empleados ?? []).map((e) => e.id as string);

  const [{ contactos }, totalContactos] = await Promise.all([
    contactosConAnuncio(clienteId, desdeISO, hastaISO),
    contarContactos(clienteId, desdeISO, hastaISO),
  ]);
  const chats = contactos.map((c) => c.chatId);

  let resultados: ResultadoPauta[] = [];
  let pagos: PagoPauta[] = [];

  if (chats.length) {
    const tandas = trozos(chats, TANDA);

    const [resR, pagR] = await Promise.all([
      // Los resultados del embudo sí cuelgan de un empleado: sin empleados no hay.
      ids.length
        ? Promise.all(
            tandas.map((t) =>
              supa
                .from("ed_resultados")
                .select("chat_id, tipo")
                .in("empleado_id", ids)
                .in("chat_id", t),
            ),
          )
        : Promise.resolve([]),
      Promise.all(
        tandas.map((t) =>
          supa
            .from("ed_pagos")
            .select("chat_id, monto")
            .eq("cliente_id", clienteId)
            .in("chat_id", t)
            .eq("estado", "pagado"),
        ),
      ),
    ]);

    resultados = resR.flatMap((r) =>
      (r.data ?? []).map((x) => ({ chatId: x.chat_id as string, tipo: x.tipo as string })),
    );
    pagos = pagR.flatMap((r) =>
      (r.data ?? []).map((x) => ({ chatId: x.chat_id as string, monto: x.monto as number })),
    );
  }

  const filas = agruparPorAnuncio({ contactos, resultados, pagos });
  const resumen = resumenPauta(filas);

  /**
   * La moneda de lo cobrado es la del NEGOCIO, no la de la cuenta publicitaria.
   * Se lee del cliente en vez de asumir CLP: el día que haya un cliente que
   * cobre en otra moneda, `metricas.ts` va a negarse a calcular el retorno en
   * vez de mezclar — que es exactamente lo que tiene que pasar.
   */
  const monedaNegocio = "CLP";

  const propios: DatosPropios = {
    conversaciones: resumen.conversaciones,
    cotizaciones: filas.reduce((s, f) => s + f.cotizaciones, 0),
    agendadas: resumen.agendadas,
    avanzados: filas.reduce((s, f) => s + f.avanzados, 0),
    ventas: resumen.ventas,
    cobrado: { valor: resumen.pagado, moneda: monedaNegocio },
  };

  /**
   * El período anterior se calcula con la MISMA función, no con una consulta
   * paralela: cualquier arreglo futuro en el conteo se aplica a los dos lados y
   * la comparación no se descuadra sola. Va en su propio try porque una
   * comparación que falla no puede dejar sin cifras al período actual.
   */
  let propiosAntes: DatosPropios | null = null;
  const anterior = periodoAnterior(rango);
  if (anterior) {
    try {
      const previo = await totalesDelPeriodo(clienteId, anterior, ids, monedaNegocio);
      propiosAntes = previo;
    } catch {
      propiosAntes = null;
    }
  }

  return {
    filas,
    resumen,
    estado: estadoAtribucion(resumen),
    // null si el conteo falló: la pantalla prefiere no decir nada a decir «0».
    sinAnuncio: totalContactos === null ? 0 : Math.max(0, totalContactos - contactos.length),
    rango,
    propios,
    propiosAntes,
  };
}

/**
 * Los totales de un período, sin armar la tabla por anuncio.
 *
 * Existe aparte de `cargarPauta` para el período anterior, donde solo hacen
 * falta los números: traer y agrupar la tabla entera de un período que nadie va
 * a mirar sería pagar el doble por una sola cifra de comparación.
 */
async function totalesDelPeriodo(
  clienteId: string,
  periodo: { desde: string; hasta: string },
  ids: string[],
  moneda: string,
): Promise<DatosPropios> {
  const supa = db();
  const { desdeISO, hastaISO } = bordesUTC(periodo);
  const { contactos } = await contactosConAnuncio(clienteId, desdeISO, hastaISO);
  const chats = contactos.map((c) => c.chatId);

  const vacio: DatosPropios = {
    conversaciones: contactos.length,
    cotizaciones: 0,
    agendadas: 0,
    avanzados: 0,
    ventas: 0,
    cobrado: { valor: 0, moneda },
  };
  if (!chats.length) return vacio;

  const tandas = trozos(chats, TANDA);

  const [resR, pagR] = await Promise.all([
    ids.length
      ? Promise.all(
          tandas.map((t) =>
            supa
              .from("ed_resultados")
              .select("chat_id, tipo")
              .in("empleado_id", ids)
              .in("chat_id", t),
          ),
        )
      : Promise.resolve([]),
    Promise.all(
      tandas.map((t) =>
        supa
          .from("ed_pagos")
          .select("chat_id, monto")
          .eq("cliente_id", clienteId)
          .in("chat_id", t)
          .eq("estado", "pagado"),
      ),
    ),
  ]);

  const filas = agruparPorAnuncio({
    contactos,
    resultados: resR.flatMap((r) =>
      (r.data ?? []).map((x) => ({ chatId: x.chat_id as string, tipo: x.tipo as string })),
    ),
    pagos: pagR.flatMap((r) =>
      (r.data ?? []).map((x) => ({ chatId: x.chat_id as string, monto: x.monto as number })),
    ),
  });
  const resumen = resumenPauta(filas);

  return {
    conversaciones: resumen.conversaciones,
    cotizaciones: filas.reduce((s, f) => s + f.cotizaciones, 0),
    agendadas: resumen.agendadas,
    avanzados: filas.reduce((s, f) => s + f.avanzados, 0),
    ventas: resumen.ventas,
    cobrado: { valor: resumen.pagado, moneda },
  };
}

/**
 * El anuncio que trajo UNA conversación, para mostrarlo dentro del chat.
 *
 * Devuelve null ante cualquier problema a propósito: es una línea de contexto,
 * no puede tumbar la bandeja (lección del logo en el layout, 9-sep-2026).
 */
export async function anuncioDeChat(
  clienteId: string,
  chatId: string,
): Promise<{ titular: string; url: string; anuncioId: string } | null> {
  try {
    const { data } = await db()
      .from("ed_contactos")
      .select("datos")
      .eq("cliente_id", clienteId)
      .eq("chat_id", chatId)
      .maybeSingle();
    const campana = ((data?.datos ?? {}) as Record<string, unknown>).campana as
      | CampanaContacto
      | undefined;
    if (!campana || typeof campana !== "object") return null;
    return {
      titular: nombreDeAviso(campana),
      url: String(campana.url ?? ""),
      anuncioId: String(campana.anuncioId ?? ""),
    };
  } catch {
    return null;
  }
}


/* ────────────────────────────────────────────────────────────────────────────
 * EL RECORRIDO DE CADA PERSONA
 * ──────────────────────────────────────────────────────────────────────────── */

export type PersonaAtribuida = {
  chatId: string;
  nombre: string;
  anuncio: string;
  anuncioId: string;
  /** Cuándo entró. */
  desde: string;
  etapa: string;
  cotizo: boolean;
  agendo: boolean;
  compro: boolean;
  pagado: number;
  /** ¿Se le puede devolver a Meta como conversión? */
  conClid: boolean;
  /** Cuándo se registró la venta (pago o resultado), si la hubo. */
  compradoEn: string | null;
  /** Última línea de la conversación, para reconocer a la persona en la lista de leads. */
  ultimoMensaje: string;
  telefono: string;
};

/**
 * Las personas que llegaron por un anuncio, una por fila.
 *
 * Esta es la pantalla que convence: la tabla por anuncio dice «14 conversaciones
 * y 3 ventas», y acá se ve QUIÉNES son esas 14 y en qué quedó cada una. Es la
 * diferencia entre un informe que hay que creer y uno que se puede auditar
 * —abrir la conversación y leerla— cuando algo no cuadra.
 *
 * `anuncioId` filtra a un aviso puntual, que es a donde lleva el enlace desde
 * la tabla de anuncios.
 */
export async function personasDeAnuncios(
  clienteId: string,
  rango: Rango,
  anuncioId?: string,
): Promise<PersonaAtribuida[]> {
  const supa = db();
  const { desdeISO, hastaISO } = bordesUTC(rango);

  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId);
  const ids = (empleados ?? []).map((e) => e.id as string);

  const { contactos } = await contactosConAnuncio(clienteId, desdeISO, hastaISO);
  const filtrados = anuncioId
    ? contactos.filter((c) => claveDeAviso(c.campana) === anuncioId)
    : contactos;
  if (!filtrados.length) return [];

  const chats = filtrados.map((c) => c.chatId);
  const tandas = trozos(chats, TANDA);

  /**
   * La etapa se lee de `ed_contactos` y NO se recalcula: el embudo ya tiene su
   * propia lógica (incluido el respeto por lo que una persona movió a mano), y
   * una segunda implementación acá terminaría contradiciendo a la pantalla de
   * Embudo sin que nadie sepa cuál creer.
   */
  const [etapasR, resR, pagR] = await Promise.all([
    Promise.all(
      tandas.map((t) =>
        supa
          .from("ed_contactos")
          .select("chat_id, nombre, etapa, telefono")
          .eq("cliente_id", clienteId)
          .in("chat_id", t),
      ),
    ),
    ids.length
      ? Promise.all(
          tandas.map((t) =>
            supa
              .from("ed_resultados")
              .select("chat_id, tipo, creado_en")
              .in("empleado_id", ids)
              .in("chat_id", t),
          ),
        )
      : Promise.resolve([]),
    Promise.all(
      tandas.map((t) =>
        supa
          .from("ed_pagos")
          .select("chat_id, monto, pagado_en")
          .eq("cliente_id", clienteId)
          .in("chat_id", t)
          .eq("estado", "pagado"),
      ),
    ),
  ]);

  const etapa = new Map<string, { nombre: string; etapa: string; telefono: string }>();
  for (const r of etapasR) {
    for (const f of r.data ?? []) {
      etapa.set(f.chat_id as string, {
        nombre: ((f.nombre as string | null) ?? "").trim(),
        etapa: (f.etapa as string) ?? "nuevo",
        telefono: ((f.telefono as string | null) ?? "").trim(),
      });
    }
  }

  const marcas = new Map<
    string,
    { cotizo: boolean; agendo: boolean; compro: boolean; compradoEn: string | null }
  >();
  for (const r of resR) {
    for (const f of r.data ?? []) {
      const chat = f.chat_id as string;
      const m = marcas.get(chat) ?? { cotizo: false, agendo: false, compro: false, compradoEn: null };
      const t = f.tipo as string;
      if (t === "cotizacion_enviada") m.cotizo = true;
      if (t === "agendamiento") m.agendo = true;
      if (TIPOS_VENTA.has(t)) {
        m.compro = true;
        m.compradoEn = m.compradoEn ?? ((f.creado_en as string | null) ?? null);
      }
      marcas.set(chat, m);
    }
  }

  const pagado = new Map<string, number>();
  const pagadoEn = new Map<string, string>();
  for (const r of pagR) {
    for (const f of r.data ?? []) {
      const chat = f.chat_id as string;
      pagado.set(chat, (pagado.get(chat) ?? 0) + (Number(f.monto) || 0));
      const cuando = (f.pagado_en as string | null) ?? null;
      if (cuando && !pagadoEn.has(chat)) pagadoEn.set(chat, cuando);
    }
  }

  /**
   * La última línea de cada conversación, para que la lista de leads se pueda
   * leer sin abrir cada chat. Una sola consulta ordenada por fecha; nos
   * quedamos con la primera aparición de cada chat. Es contexto, no dato: si
   * falla, la lista sigue sirviendo.
   */
  const ultimo = new Map<string, string>();
  try {
    if (ids.length) {
      const r = await supa
        .from("ed_mensajes")
        .select("chat_id, texto, creado_en")
        .in("empleado_id", ids)
        .in("chat_id", chats.slice(0, 400))
        .order("creado_en", { ascending: false })
        .limit(1200);
      for (const m of r.data ?? []) {
        const chat = m.chat_id as string;
        if (!ultimo.has(chat)) ultimo.set(chat, String(m.texto ?? "").slice(0, 140));
      }
    }
  } catch {
    /* sin última línea */
  }

  return filtrados
    .map((c) => {
      const info = etapa.get(c.chatId);
      const m = marcas.get(c.chatId) ?? { cotizo: false, agendo: false, compro: false, compradoEn: null };
      const monto = pagado.get(c.chatId) ?? 0;
      return {
        chatId: c.chatId,
        nombre: info?.nombre || c.nombre || `…${c.chatId.slice(-4)}`,
        anuncio: nombreDeAviso(c.campana),
        anuncioId: claveDeAviso(c.campana),
        desde: c.campana.visto ?? "",
        etapa: info?.etapa ?? "nuevo",
        cotizo: m.cotizo,
        agendo: m.agendo,
        // Un cobro pagado por el enlace ES una venta, aunque nadie la marcara.
        compro: m.compro || monto > 0,
        pagado: monto,
        conClid: Boolean(c.campana.ctwaClid),
        compradoEn: pagadoEn.get(c.chatId) ?? m.compradoEn,
        ultimoMensaje: ultimo.get(c.chatId) ?? "",
        telefono: info?.telefono || c.chatId,
      };
    })
    // Primero quien dejó plata, después quien avanzó más, después lo reciente.
    .sort(
      (a, b) =>
        b.pagado - a.pagado ||
        Number(b.compro) - Number(a.compro) ||
        Number(b.agendo) - Number(a.agendo) ||
        (a.desde < b.desde ? 1 : -1),
    );
}
