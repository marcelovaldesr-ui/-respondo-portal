import { db } from "@/lib/db";
import {
  agruparPorAnuncio,
  estadoAtribucion,
  nombreDeAviso,
  resumenPauta,
  type CampanaContacto,
  type ContactoPauta,
  type FilaPauta,
  type PagoPauta,
  type ResultadoPauta,
  type ResumenPauta,
} from "@/lib/pautaCore";

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
  /** Días hacia atrás que se miraron. */
  dias: number;
};

/**
 * Trae los contactos que traen anuncio de origen.
 *
 * Se intenta primero el filtro en la base (`datos->campana` no nulo), que es lo
 * barato. Si el motor lo rechaza —o la columna `datos` no existiera todavía en
 * algún ambiente— se cae a traer los contactos y filtrar acá. Vale la pena la
 * doble vía: esta pantalla NO puede caerse, y un negocio chico tiene miles de
 * contactos, no millones.
 */
async function contactosConAnuncio(
  clienteId: string,
  desdeISO: string,
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

  // Camino rápido.
  try {
    const filas: Record<string, unknown>[] = [];
    for (let inicio = 0; ; inicio += PAGINA) {
      const { data, error } = await supa
        .from("ed_contactos")
        .select(columnas)
        .eq("cliente_id", clienteId)
        .not("datos->campana", "is", null)
        .gte("creado_en", desdeISO)
        .order("creado_en", { ascending: false })
        .range(inicio, inicio + PAGINA - 1);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      filas.push(...(data as Record<string, unknown>[]));
      if (data.length < PAGINA) break;
      if (inicio > 20_000) break;
    }
    return { contactos: arma(filas), total: filas.length };
  } catch {
    // Camino lento, pero que no deja la pantalla en blanco.
    const filas: Record<string, unknown>[] = [];
    for (let inicio = 0; ; inicio += PAGINA) {
      const { data, error } = await supa
        .from("ed_contactos")
        .select(columnas)
        .eq("cliente_id", clienteId)
        .gte("creado_en", desdeISO)
        .order("creado_en", { ascending: false })
        .range(inicio, inicio + PAGINA - 1);
      if (error || !data?.length) break;
      filas.push(...(data as Record<string, unknown>[]));
      if (data.length < PAGINA) break;
      if (inicio > 20_000) break;
    }
    return { contactos: arma(filas), total: filas.length };
  }
}

/**
 * El informe de pauta de un cliente.
 *
 * `dias` mira hacia atrás sobre la fecha del contacto, no sobre la del pago: lo
 * que se está midiendo es "de los que ENTRARON en este período, cuántos
 * compraron", que es la pregunta que se hace quien pone plata en anuncios.
 */
export async function cargarPauta(clienteId: string, dias = 90): Promise<Pauta> {
  const supa = db();
  const desdeISO = new Date(Date.now() - Math.max(1, dias) * 86_400_000).toISOString();

  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId);
  const ids = (empleados ?? []).map((e) => e.id as string);

  const { contactos, total } = await contactosConAnuncio(clienteId, desdeISO);
  const chats = contactos.map((c) => c.chatId);

  let resultados: ResultadoPauta[] = [];
  let pagos: PagoPauta[] = [];

  if (chats.length && ids.length) {
    const tandas = trozos(chats, TANDA);

    const resR = await Promise.all(
      tandas.map((t) =>
        supa.from("ed_resultados").select("chat_id, tipo").in("empleado_id", ids).in("chat_id", t),
      ),
    );
    resultados = resR.flatMap((r) =>
      (r.data ?? []).map((x) => ({ chatId: x.chat_id as string, tipo: x.tipo as string })),
    );

    const pagR = await Promise.all(
      tandas.map((t) =>
        supa
          .from("ed_pagos")
          .select("chat_id, monto, estado")
          .in("empleado_id", ids)
          .in("chat_id", t)
          .eq("estado", "pagado"),
      ),
    );
    pagos = pagR.flatMap((r) =>
      (r.data ?? []).map((x) => ({ chatId: x.chat_id as string, monto: x.monto as number })),
    );
  }

  const filas = agruparPorAnuncio({ contactos, resultados, pagos });
  const resumen = resumenPauta(filas);

  return {
    filas,
    resumen,
    estado: estadoAtribucion(resumen),
    sinAnuncio: Math.max(0, total - contactos.length),
    dias,
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
