/**
 * PAUTA — el cruce entre el aviso y la plata. Núcleo puro, sin base de datos.
 *
 * QUÉ RESUELVE
 * El Administrador de Anuncios de Meta sabe cuántas conversaciones abrió un
 * aviso y ahí se le acaba la vista: la venta ocurre después, dentro de WhatsApp.
 * Nosotros tenemos las dos mitades y nunca las habíamos juntado — el anuncio de
 * origen se guarda desde la migración 282 (`ed_contactos.datos.campana`) y el
 * pago desde la 289 (`ed_pagos`).
 *
 * Este archivo es solo la aritmética, a propósito: recibe listas planas y
 * devuelve una fila por aviso. Sin red y sin Supabase se puede probar entero,
 * que es donde se esconden los errores de un informe (un chat contado dos
 * veces, una venta atribuida al aviso equivocado).
 *
 * REGLAS QUE IMPORTAN
 *  · Un CHAT cuenta una sola vez por aviso, aunque tenga diez resultados.
 *  · La atribución es del PRIMER anuncio: quien trajo a la persona. Eso ya lo
 *    garantiza inboundMeta (no pisa una referencia guardada); acá se respeta
 *    sin volver a decidirlo.
 *  · Solo se suma lo que existe. Un aviso sin ventas muestra 0, no se esconde:
 *    un aviso que trae conversaciones y ninguna venta es justamente el hallazgo.
 */

/** Tipos de `ed_resultados` que cuentan como venta cerrada. */
export const TIPOS_VENTA = new Set(["venta_confirmada", "venta_recuperada"]);

export type CampanaContacto = {
  /** `source_id` de Meta. Puede faltar si el aviso llegó sin id. */
  anuncioId?: string;
  tipo?: string;
  titular?: string;
  cuerpo?: string;
  url?: string;
  /** Identificador del clic. Sin esto no se le puede devolver la venta a Meta. */
  ctwaClid?: string;
  /** Cuándo se vio por primera vez (lo escribe inboundMeta). */
  visto?: string;
};

export type ContactoPauta = {
  chatId: string;
  nombre?: string | null;
  campana: CampanaContacto;
};

export type ResultadoPauta = { chatId: string; tipo: string };
export type PagoPauta = { chatId: string; monto: number };

export type FilaPauta = {
  /** Clave de agrupación: el id del anuncio, o el titular si no vino id. */
  clave: string;
  anuncioId: string;
  titular: string;
  url: string;
  /** "Anuncio" / "Publicación" / lo que haya dicho Meta en `source_type`. */
  tipo: string;
  conversaciones: number;
  cotizaciones: number;
  agendadas: number;
  ventas: number;
  /** Pesos efectivamente cobrados por Flow en esos chats. */
  pagado: number;
  /**
   * Cuántas de esas conversaciones traen `ctwa_clid`. Es el termómetro de la
   * ola 2: solo esas se le pueden devolver a Meta como conversión.
   */
  conClid: number;
  /** Primer y último contacto atribuidos a este aviso (ISO, o "" si no hay). */
  primera: string;
  ultima: string;
};

export type ResumenPauta = {
  avisos: number;
  conversaciones: number;
  agendadas: number;
  ventas: number;
  pagado: number;
  conClid: number;
  /** Conversaciones por venta. 0 si todavía no hay ventas. */
  porVenta: number;
};

function limpio(v: unknown, tope = 160): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, tope);
}

/**
 * Nombre legible de un aviso, para no mostrarle al dueño un número de 17
 * dígitos. Prefiere el titular que Meta manda en el referral; si no vino,
 * cae al id, y si tampoco hay, lo llama por lo que es.
 */
export function nombreDeAviso(c: CampanaContacto): string {
  const titular = limpio(c.titular, 90);
  if (titular) return titular;
  const id = limpio(c.anuncioId, 40);
  if (id) return `Anuncio ${id.slice(-6)}`;
  return "Anuncio sin identificar";
}

/** Clave de agrupación: el id manda; sin id, el titular; sin nada, un cajón. */
export function claveDeAviso(c: CampanaContacto): string {
  return limpio(c.anuncioId, 60) || limpio(c.titular, 90).toLowerCase() || "sin_id";
}

/**
 * Junta contactos, resultados y pagos en una fila por aviso.
 *
 * Los resultados y pagos que no correspondan a un chat atribuido se ignoran en
 * silencio: son las ventas que no vinieron de un anuncio, y meterlas acá haría
 * que la pauta se atribuyera trabajo que no hizo.
 */
export function agruparPorAnuncio(entrada: {
  contactos: ContactoPauta[];
  resultados: ResultadoPauta[];
  pagos: PagoPauta[];
}): FilaPauta[] {
  const { contactos, resultados, pagos } = entrada;

  /** chat -> clave del aviso que lo trajo. Un chat pertenece a UN aviso. */
  const avisoDeChat = new Map<string, string>();
  const filas = new Map<string, FilaPauta>();

  for (const c of contactos) {
    if (!c?.chatId || !c.campana) continue;
    // Un mismo chat repetido en la entrada no puede contar dos veces.
    if (avisoDeChat.has(c.chatId)) continue;

    const clave = claveDeAviso(c.campana);
    avisoDeChat.set(c.chatId, clave);

    const fila =
      filas.get(clave) ??
      ({
        clave,
        anuncioId: limpio(c.campana.anuncioId, 60),
        titular: nombreDeAviso(c.campana),
        url: limpio(c.campana.url, 300),
        tipo: limpio(c.campana.tipo, 30) || "ad",
        conversaciones: 0,
        cotizaciones: 0,
        agendadas: 0,
        ventas: 0,
        pagado: 0,
        conClid: 0,
        primera: "",
        ultima: "",
      } satisfies FilaPauta);

    fila.conversaciones += 1;
    if (limpio(c.campana.ctwaClid, 200)) fila.conClid += 1;
    // Si la primera fila del grupo vino sin url o sin titular útil, se completa
    // con la de cualquier otra: es el mismo aviso.
    if (!fila.url) fila.url = limpio(c.campana.url, 300);
    if (!fila.anuncioId) fila.anuncioId = limpio(c.campana.anuncioId, 60);

    const visto = limpio(c.campana.visto, 40);
    if (visto) {
      if (!fila.primera || visto < fila.primera) fila.primera = visto;
      if (!fila.ultima || visto > fila.ultima) fila.ultima = visto;
    }

    filas.set(clave, fila);
  }

  /** Un chat aporta como máximo UNA cotización, UNA agenda y UNA venta. */
  const yaContado = new Map<string, Set<string>>();
  const contarUnaVez = (chat: string, que: string): boolean => {
    const set = yaContado.get(chat) ?? new Set<string>();
    if (set.has(que)) return false;
    set.add(que);
    yaContado.set(chat, set);
    return true;
  };

  for (const r of resultados) {
    const clave = avisoDeChat.get(r?.chatId ?? "");
    if (!clave) continue;
    const fila = filas.get(clave);
    if (!fila) continue;

    if (r.tipo === "agendamiento" && contarUnaVez(r.chatId, "agenda")) fila.agendadas += 1;
    else if (r.tipo === "cotizacion_enviada" && contarUnaVez(r.chatId, "cotizacion"))
      fila.cotizaciones += 1;
    else if (TIPOS_VENTA.has(r.tipo) && contarUnaVez(r.chatId, "venta")) fila.ventas += 1;
  }

  for (const p of pagos) {
    const clave = avisoDeChat.get(p?.chatId ?? "");
    if (!clave) continue;
    const fila = filas.get(clave);
    if (!fila) continue;
    // Los pagos SÍ se suman todos: dos abonos del mismo cliente son dos pagos.
    const monto = Number(p.monto);
    if (Number.isFinite(monto) && monto > 0) fila.pagado += Math.round(monto);
  }

  /**
   * Orden: primero lo que trajo plata, después lo que trajo conversaciones.
   * Un aviso con muchas conversaciones y cero ventas queda arriba de los
   * irrelevantes justamente para que se vea.
   */
  return [...filas.values()].sort(
    (a, b) => b.pagado - a.pagado || b.ventas - a.ventas || b.conversaciones - a.conversaciones,
  );
}

/** Totales de la tabla, para la fila de arriba de la pantalla. */
export function resumenPauta(filas: FilaPauta[]): ResumenPauta {
  const acc = filas.reduce(
    (s, f) => ({
      conversaciones: s.conversaciones + f.conversaciones,
      agendadas: s.agendadas + f.agendadas,
      ventas: s.ventas + f.ventas,
      pagado: s.pagado + f.pagado,
      conClid: s.conClid + f.conClid,
    }),
    { conversaciones: 0, agendadas: 0, ventas: 0, pagado: 0, conClid: 0 },
  );
  return {
    avisos: filas.length,
    ...acc,
    porVenta: acc.ventas > 0 ? Math.round((acc.conversaciones / acc.ventas) * 10) / 10 : 0,
  };
}

/**
 * Lectura honesta del estado de la atribución, para decir en la pantalla qué se
 * puede y qué no todavía. No es decoración: si nadie trae `ctwa_clid`, la ola 2
 * no se puede encender y conviene que se sepa antes de prometérselo a nadie.
 */
export function estadoAtribucion(r: ResumenPauta): {
  nivel: "sin_datos" | "solo_lectura" | "listo";
  mensaje: string;
} {
  if (r.conversaciones === 0) {
    return {
      nivel: "sin_datos",
      mensaje:
        "Todavía no llega ninguna conversación desde un anuncio. Aparecen solas apenas alguien entre por un aviso de Facebook o Instagram.",
    };
  }
  if (r.conClid === 0) {
    return {
      nivel: "solo_lectura",
      mensaje:
        "Se ve de qué anuncio viene cada conversación, pero todavía no llega el identificador del clic, así que aún no se le puede devolver la venta a Meta.",
    };
  }
  return {
    nivel: "listo",
    mensaje: `${r.conClid} de ${r.conversaciones} conversaciones traen el identificador del clic: esas son las que se le pueden devolver a Meta como venta.`,
  };
}
