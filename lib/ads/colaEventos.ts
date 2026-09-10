import { db } from "@/lib/db";
import {
  armarPayload,
  idDeEvento,
  toca_reintentar,
  verificar,
  type EventoPendiente,
  type TipoEvento,
} from "@/lib/ads/eventos";

/**
 * LA COLA DE CONVERSIONES — de nuestros hechos a Meta.
 *
 * CÓMO ESTÁ ARMADO Y POR QUÉ ASÍ
 * En vez de disparar un evento desde cada lugar donde puede pasar algo —el
 * detector de cierres, la agenda, el webhook de pagos, el embudo— hay UN
 * proceso que BARRE lo que ya ocurrió y encola lo que falte. Cinco disparadores
 * repartidos serían cinco lugares donde olvidarse de uno, cinco caminos que
 * probar y cinco formas de mandar el mismo evento dos veces.
 *
 * El barrido, en cambio, es idempotente por construcción: el `evento_id` se
 * deriva del hecho, y la llave única de la tabla rechaza el duplicado aunque el
 * código se equivoque. Correrlo dos veces no hace daño.
 *
 * DOS PASOS SEPARADOS A PROPÓSITO:
 *   1. `encolar`  — mira la base. No usa red. Siempre puede correr.
 *   2. `enviar`   — habla con Meta. Puede fallar, y falla sin perder nada:
 *                   lo que no salió queda en la cola con su motivo.
 *
 * Un evento sin `ctwa_clid` NO se manda: queda `descartado` con el motivo
 * escrito. Se guarda igual para poder EXPLICAR por qué no salió, que es la
 * pregunta que sigue cuando alguien mira la pantalla y ve menos de lo que
 * esperaba.
 */

const GRAPH = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 12_000;
/** Días hacia atrás que barre. Un evento más viejo ya no le sirve a Meta. */
const VENTANA_DIAS = 7;
/** Tope por corrida: comparte función con el cron de seguimientos. */
const MAX_POR_CORRIDA = 40;

type Candidato = {
  chatId: string;
  tipo: TipoEvento;
  ocurridoEn: Date;
  valor?: number | null;
  moneda?: string | null;
};

/**
 * Busca hechos recientes que merezcan un evento y los deja encolados.
 *
 * Los tres orígenes son los que Respondo puede AFIRMAR, no inferir:
 *   · `Purchase` — un cobro por enlace que quedó pagado. Con monto real.
 *   · `Schedule` — una cita creada (ed_resultados: agendamiento).
 *   · `Lead`     — una cotización enviada. Es el punto donde una consulta se
 *                  volvió una oportunidad; antes de eso es solo una pregunta.
 */
export async function encolar(clienteId: string): Promise<{ nuevos: number; descartados: number }> {
  const supa = db();
  const desde = new Date(Date.now() - VENTANA_DIAS * 86_400_000).toISOString();

  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId);
  const ids = (empleados ?? []).map((e) => e.id as string);

  const candidatos: Candidato[] = [];

  // Compras: la fuente más confiable, porque hay plata de por medio.
  const { data: pagos } = await supa
    .from("ed_pagos")
    .select("chat_id, monto, pagado_en")
    .eq("cliente_id", clienteId)
    .eq("estado", "pagado")
    .gte("pagado_en", desde)
    .limit(200);
  for (const p of pagos ?? []) {
    if (!p.pagado_en) continue;
    candidatos.push({
      chatId: p.chat_id as string,
      tipo: "Purchase",
      ocurridoEn: new Date(p.pagado_en as string),
      valor: Number(p.monto) || null,
      moneda: "CLP",
    });
  }

  // Agendas y cotizaciones.
  if (ids.length) {
    const { data: res } = await supa
      .from("ed_resultados")
      .select("chat_id, tipo, creado_en, valor_clp")
      .in("empleado_id", ids)
      .in("tipo", ["agendamiento", "cotizacion_enviada", "venta_confirmada", "venta_recuperada"])
      .gte("creado_en", desde)
      .limit(400);

    for (const r of res ?? []) {
      const t = r.tipo as string;
      const tipo: TipoEvento | null =
        t === "agendamiento"
          ? "Schedule"
          : t === "cotizacion_enviada"
            ? "Lead"
            : "Purchase";
      if (!tipo) continue;
      candidatos.push({
        chatId: r.chat_id as string,
        tipo,
        ocurridoEn: new Date(r.creado_en as string),
        valor: tipo === "Purchase" ? Number(r.valor_clp) || null : null,
        moneda: tipo === "Purchase" ? "CLP" : null,
      });
    }
  }

  if (!candidatos.length) return { nuevos: 0, descartados: 0 };

  /**
   * ORDEN ANTES DE CORTAR. El tope por corrida existe para no pasarse del
   * tiempo del cron, pero cortar una lista sin ordenar puede dejar afuera una
   * venta para que entren cuarenta cotizaciones. Una compra vale más que una
   * cita y una cita más que un lead; a igual tipo, lo más reciente primero.
   */
  const PESO: Record<TipoEvento, number> = { Purchase: 3, Schedule: 2, Lead: 1 };
  candidatos.sort(
    (a, b) => PESO[b.tipo] - PESO[a.tipo] || b.ocurridoEn.getTime() - a.ocurridoEn.getTime(),
  );

  /**
   * El `ctwa_clid` sale del contacto. Se pide UNA vez para todos los chats en
   * vez de una consulta por evento: con cuarenta candidatos serían cuarenta
   * viajes a la base dentro de una función que tiene 60 segundos en total.
   */
  const chats = [...new Set(candidatos.map((c) => c.chatId))].slice(0, 200);
  const clids = new Map<string, { clid: string; telefono: string }>();
  try {
    const { data } = await supa
      .from("ed_contactos")
      .select("chat_id, datos")
      .eq("cliente_id", clienteId)
      .in("chat_id", chats);
    for (const c of data ?? []) {
      const campana = ((c.datos ?? {}) as Record<string, unknown>).campana as
        | Record<string, unknown>
        | undefined;
      const clid = String(campana?.ctwaClid ?? "");
      if (clid) clids.set(c.chat_id as string, { clid, telefono: c.chat_id as string });
    }
  } catch {
    return { nuevos: 0, descartados: 0 };
  }

  let nuevos = 0;
  let descartados = 0;

  for (const c of candidatos.slice(0, MAX_POR_CORRIDA)) {
    const ocurridoEn = Math.floor(c.ocurridoEn.getTime() / 1000);
    if (!Number.isFinite(ocurridoEn)) continue;

    const ref = clids.get(c.chatId);
    const evento: EventoPendiente = {
      clienteId,
      chatId: c.chatId,
      tipo: c.tipo,
      ocurridoEn,
      ctwaClid: ref?.clid ?? "",
      telefono: c.chatId,
      valor: c.valor,
      moneda: c.moneda,
    };

    const v = verificar(evento);
    const fila = {
      cliente_id: clienteId,
      chat_id: c.chatId,
      tipo: c.tipo,
      evento_id: idDeEvento(evento),
      ocurrido_en: c.ocurridoEn.toISOString(),
      ctwa_clid: evento.ctwaClid || null,
      valor: c.valor,
      moneda: c.moneda,
      estado: v.ok ? "pendiente" : "descartado",
      motivo: v.ok ? null : v.motivo,
    };

    try {
      // `ignoreDuplicates`: si ya estaba encolado, no se toca. Sin esto, un
      // barrido posterior pisaría el estado de uno ya enviado y lo mandaría de
      // nuevo — el duplicado que toda esta arquitectura existe para evitar.
      const { data, error } = await supa
        .from("ed_ads_eventos")
        .upsert(fila, { onConflict: "cliente_id,evento_id", ignoreDuplicates: true })
        .select("id");

      /**
       * PostgREST devuelve el error, no lo lanza. Si la 302 no está aplicada la
       * tabla no existe y las 40 filas van a fallar igual: se corta acá en vez
       * de hacer 40 viajes inútiles dentro de un cron que tiene 60 segundos.
       */
      if (error) break;

      /**
       * Se cuenta lo que REALMENTE entró, no lo que se intentó. Con
       * `ignoreDuplicates` una fila ya encolada vuelve vacía — sumarla igual
       * haría que el cron reportara «+12 encolados» cada cinco minutos sobre
       * los mismos doce eventos. El informe del cron tiene que poder creerse.
       */
      if (!data?.length) continue;
      if (v.ok) nuevos += 1;
      else descartados += 1;
    } catch {
      return { nuevos, descartados };
    }
  }

  return { nuevos, descartados };
}

/**
 * Manda a Meta lo que esté pendiente.
 *
 * Requiere dos cosas que el negocio tiene que configurar: el `dataset_id` y un
 * WABA conectado. Sin cualquiera de las dos NO se manda nada y NO se marca como
 * error: los eventos quedan esperando, que es el estado correcto. Fingir que
 * salieron sería la peor forma de fallar acá.
 */
export async function enviar(clienteId: string): Promise<{ enviados: number; fallidos: number }> {
  const supa = db();

  const { data: cliente } = await supa
    .from("ed_clientes")
    .select("ads_dataset_id, waba_id, waba_token, waba_token_cifrado")
    .eq("id", clienteId)
    .maybeSingle();

  const dataset = String(cliente?.ads_dataset_id ?? "").trim();
  const wabaId = String(cliente?.waba_id ?? "").trim();
  if (!dataset || !wabaId) return { enviados: 0, fallidos: 0 };

  /**
   * El token es el MISMO del WhatsApp Business del cliente: la Conversions API
   * de mensajería cuelga de ahí, no de la cuenta publicitaria. Por eso medir se
   * puede tener sin haber conectado nunca una cuenta de anuncios.
   */
  const { descifrar } = await import("@/lib/cifrado");
  const token =
    (cliente?.waba_token_cifrado
      ? descifrar(cliente.waba_token_cifrado as string, "waba-token")
      : null) ?? ((cliente?.waba_token as string | null) || null);
  if (!token) return { enviados: 0, fallidos: 0 };

  const { data: pendientes } = await supa
    .from("ed_ads_eventos")
    .select("id, chat_id, tipo, evento_id, ocurrido_en, ctwa_clid, valor, moneda, estado, intentos, ultimo_intento")
    .eq("cliente_id", clienteId)
    .in("estado", ["pendiente", "fallido"])
    .order("creado_en", { ascending: true })
    .limit(25);

  let enviados = 0;
  let fallidos = 0;

  for (const f of pendientes ?? []) {
    const intentos = Number(f.intentos) || 0;
    if (
      f.estado === "fallido" &&
      !toca_reintentar({
        estado: "fallido",
        intentos,
        ultimoIntento: f.ultimo_intento ? Date.parse(f.ultimo_intento as string) : null,
      })
    ) {
      continue;
    }

    const payload = armarPayload(
      {
        clienteId,
        chatId: f.chat_id as string,
        tipo: f.tipo as TipoEvento,
        ocurridoEn: Math.floor(Date.parse(f.ocurrido_en as string) / 1000),
        ctwaClid: String(f.ctwa_clid ?? ""),
        telefono: f.chat_id as string,
        valor: f.valor as number | null,
        moneda: f.moneda as string | null,
      },
      wabaId,
    );

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let ok = false;
    let motivo = "";
    try {
      const r = await fetch(`${GRAPH}/${dataset}/events`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const cuerpo = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      ok = r.ok;
      if (!ok) {
        const err = (cuerpo.error ?? {}) as Record<string, unknown>;
        // El mensaje se guarda recortado y sin encabezados: nunca el token.
        motivo = String(err.message ?? `HTTP ${r.status}`).slice(0, 300);
      }
    } catch {
      motivo = "no se pudo contactar a Meta (timeout o red)";
    } finally {
      clearTimeout(timer);
    }

    try {
      await supa
        .from("ed_ads_eventos")
        .update(
          ok
            ? { estado: "enviado", enviado_en: new Date().toISOString(), motivo: null }
            : {
                estado: "fallido",
                motivo,
                intentos: intentos + 1,
                ultimo_intento: new Date().toISOString(),
              },
        )
        .eq("id", f.id as string)
        .eq("cliente_id", clienteId);
    } catch {
      // Si no se puede escribir el estado, el evento vuelve a intentarse. Es
      // seguro: el `evento_id` es el mismo y Meta lo deduplica.
    }

    if (ok) enviados += 1;
    else fallidos += 1;
  }

  return { enviados, fallidos };
}

/**
 * Lo que llama el cron. Recorre los negocios que tengan dataset configurado.
 *
 * Nunca lanza: comparte endpoint con los recordatorios de cita, y una falla
 * acá no puede impedir que salga un mensaje que un cliente está esperando a
 * una hora concreta.
 */
export async function procesarEventos(opts?: {
  fechaLimite?: number;
  maxClientes?: number;
}): Promise<{ encolados: number; enviados: number; detalle: string[] }> {
  const detalle: string[] = [];
  let encolados = 0;
  let enviados = 0;

  try {
    const { data: clientes } = await db()
      .from("ed_clientes")
      .select("id, nombre, ads_dataset_id")
      .not("ads_dataset_id", "is", null)
      .limit(opts?.maxClientes ?? 5);

    if (!clientes?.length) return { encolados: 0, enviados: 0, detalle: ["sin_configurar"] };

    for (const c of clientes) {
      if (opts?.fechaLimite && Date.now() > opts.fechaLimite - 8_000) {
        detalle.push("sin_tiempo");
        break;
      }
      const e = await encolar(c.id as string);
      const s = await enviar(c.id as string);
      encolados += e.nuevos;
      enviados += s.enviados;
      detalle.push(`${c.nombre ?? c.id}: +${e.nuevos} encolados, ${s.enviados} enviados`);
    }
  } catch (e) {
    detalle.push(`error: ${(e as Error).message}`);
  }

  return { encolados, enviados, detalle };
}
