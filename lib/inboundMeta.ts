import { db } from "@/lib/db";
import {
  parsearWebhook,
  parsearAcksMeta,
  parsearEcosMeta,
  configPorPhoneId,
  tinoDe,
  enviarTexto,
  type ConfigWhatsApp,
} from "@/lib/whatsapp";
import {
  guardarMensaje,
  yaProcesado,
  esEcoReciente,
  actualizarEstadoEnvio,
} from "@/lib/mensajes";
import { modoDe, setModo, tocarVentanaEntrante } from "@/lib/estadoChat";
import { responderSiBot } from "@/lib/responderBot";
import { empleadoParaEntrante } from "@/lib/seguimientos";
import { fechaLimiteModelo } from "@/lib/presupuesto";
import { transporteDe } from "@/lib/transporte";
import { ventanaDeEspera } from "@/lib/ritmoHumano";

export type ResultadoMeta = { accion: string; detalle?: string };

/**
 * Orquesta un payload del webhook de la WhatsApp Cloud API OFICIAL (Opción B).
 * Gemelo de lib/inboundWaha.ts: MISMO cerebro, MISMA convivencia Tino+persona,
 * MISMO tracking de entregas. Solo cambian los parsers del transporte.
 *
 * Un payload de Meta puede traer VARIOS eventos mezclados (messages, statuses,
 * message_echoes). Se procesan todos y se devuelve el resumen.
 *
 *  0) statuses (ACKs) → actualizar estado_envio.
 *  1) message_echoes (Coexistencia): eco de envío propio → ignorar;
 *     id desconocido → PERSONA escribió desde la app → toma de control humana.
 *  2) messages (cliente) → idempotencia (Meta REINTENTA webhooks) → guardar,
 *     tocar ventana, debounce y responder.
 */
export async function manejarEntranteMeta(
  payload: unknown,
  opts?: {
    /** Inyección del transporte (para pruebas: evita enviar WhatsApp real). */
    enviar?: (
      chatId: string,
      texto: string,
    ) => Promise<{ ok: boolean; waId?: string; error?: string }>;
  },
): Promise<ResultadoMeta[]> {
  // Presupuesto de tiempo de ESTA invocación (ver lib/presupuesto.ts): el
  // modelo no puede consumir el margen que necesita la red de seguridad.
  const fechaLimite = fechaLimiteModelo(Date.now());
  const resultados: ResultadoMeta[] = [];
  const supa = db();

  // Cache de resolución por phone_number_id dentro del mismo payload.
  const cacheCfg = new Map<string, { cfg: ConfigWhatsApp; empleadoId: string } | null>();
  async function resolver(phoneNumberId: string) {
    if (cacheCfg.has(phoneNumberId)) return cacheCfg.get(phoneNumberId)!;
    const cfg = await configPorPhoneId(phoneNumberId);
    if (!cfg) {
      cacheCfg.set(phoneNumberId, null);
      return null;
    }
    // Simétrico a la guardia de inboundWaha: mientras el cliente siga en WAHA
    // (recién conectado a Meta, o revertido por un rollback), este canal NO debe
    // responder ni guardar — duplicaría la conversación.
    if ((await transporteDe(cfg.clienteId, supa)) !== "cloud") {
      cacheCfg.set(phoneNumberId, null);
      return null;
    }
    const empleadoId = await tinoDe(cfg.clienteId);
    if (!empleadoId) {
      cacheCfg.set(phoneNumberId, null);
      return null;
    }
    const r = { cfg, empleadoId };
    cacheCfg.set(phoneNumberId, r);
    return r;
  }

  // 0) ACKs (statuses).
  for (const ack of parsearAcksMeta(payload)) {
    const ctx = await resolver(ack.phoneNumberId);
    if (!ctx) {
      resultados.push({ accion: "ack_sin_cliente", detalle: ack.phoneNumberId });
      continue;
    }
    const r = await actualizarEstadoEnvio(supa, ctx.empleadoId, ack.waId, ack.estado);
    if (ack.estado === "error") {
      console.error("[meta ack] envío no entregado", {
        codigo: ack.errorDetalle?.slice(0, 80) ?? "sin_detalle",
      });
    }
    resultados.push({
      accion: "ack",
      detalle: `${ack.estado}${r.encontrado === false ? " (ajeno)" : ""}`,
    });
  }

  // 1) Ecos de Coexistencia (mensajes salientes del número del negocio).
  for (const eco of parsearEcosMeta(payload)) {
    const ctx = await resolver(eco.phoneNumberId);
    if (!ctx) {
      resultados.push({ accion: "eco_sin_cliente", detalle: eco.phoneNumberId });
      continue;
    }
    const { empleadoId } = ctx;
    const chatId = eco.para;

    // Eco de un envío propio (API o inbox del portal): id ya guardado o texto
    // recién enviado por Tino → ignorar.
    if (
      (eco.waId && (await yaProcesado(supa, empleadoId, eco.waId))) ||
      (await esEcoReciente(supa, empleadoId, chatId, eco.texto))
    ) {
      resultados.push({ accion: "eco" });
      continue;
    }
    // ANTI-CARRERA (mismo riesgo B de la auditoría WAHA): el eco puede llegar
    // antes de que el envío haya guardado su id. Esperar y re-verificar antes de
    // concluir "toma humana" (que silenciaría a Tino por error).
    await new Promise((r) => setTimeout(r, 2500));
    if (
      (eco.waId && (await yaProcesado(supa, empleadoId, eco.waId))) ||
      (await esEcoReciente(supa, empleadoId, chatId, eco.texto))
    ) {
      resultados.push({ accion: "eco" });
      continue;
    }

    // PERSONA real escribiendo desde la app del negocio → toma de control.
    await guardarMensaje(supa, {
      empleadoId,
      chatId,
      rol: "humano",
      texto: eco.texto,
      waId: eco.waId,
      /**
       * El adjunto que mandó la persona desde su teléfono (26-ago-2026).
       *
       * Antes el eco descartaba todo lo que no fuera texto, así que una foto de
       * Cecilia no se guardaba **y Tino ni se enteraba de que ella había tomado
       * el chat**: seguía respondiendo encima. Mismo formato `meta:<id>` que el
       * camino del cliente, así que el proxy y el archivador ya saben servirlo
       * sin ningún cambio.
       */
      media: eco.adjunto
        ? {
            url: `meta:${eco.adjunto.id}`,
            tipo: eco.adjunto.tipo,
            mime: eco.adjunto.mime ?? null,
            nombre: eco.adjunto.nombre ?? null,
          }
        : null,
      canal: "whatsapp",
    });
    await setModo(empleadoId, chatId, "humano", supa);
    resultados.push({ accion: "toma_humana" });
  }

  // 2) Mensajes del cliente.
  for (const m of parsearWebhook(payload)) {
    const ctx = await resolver(m.phoneNumberId);
    if (!ctx) {
      resultados.push({ accion: "sin_cliente", detalle: m.phoneNumberId });
      continue;
    }
    const { cfg } = ctx;
    const chatId = m.de;
    // RUTEO: chat con seguimiento activo (<72h) → responde el empleado que lo
    // inició (Beto/Vera); sin seguimiento → Tino.
    const empleadoId =
      (await empleadoParaEntrante(cfg.clienteId, chatId, ctx.empleadoId, supa)) ?? ctx.empleadoId;

    // IDEMPOTENCIA: Meta reintenta el webhook si el 200 tarda → sin esto, Tino
    // respondería DOS veces al mismo mensaje.
    if (m.waId && (await yaProcesado(supa, empleadoId, m.waId))) {
      resultados.push({ accion: "duplicado" });
      continue;
    }

    const guardado = await guardarMensaje(supa, {
      empleadoId,
      chatId,
      rol: "cliente",
      texto: m.texto,
      waId: m.waId,
      /**
       * ADJUNTO (arreglado el 21-ago-2026 — brecha G4).
       *
       * Este camino NUNCA guardaba los metadatos del adjunto, así que
       * `media_tipo` quedaba en NULL y el inbox no dibujaba nada: la persona
       * veía «[el cliente envió una imagen]» y no podía abrirla. Y como todo
       * cliente nuevo entra por Cloud API, era el comportamiento por defecto.
       *
       * El `id` de Meta se guarda con prefijo `meta:` en `media_url`. No es una
       * URL y a propósito: las URL de Meta **expiran en minutos**, así que
       * guardar una sería guardar basura. El prefijo le dice al proxy por dónde
       * resolver, sin necesidad de una columna nueva ni de otra migración.
       */
      media: m.adjunto
        ? {
            url: `meta:${m.adjunto.id}`,
            tipo: m.adjunto.tipo,
            mime: m.adjunto.mime ?? null,
            nombre: m.adjunto.nombre ?? null,
          }
        : null,
      canal: "whatsapp",
    });
    // ANTI-DOBLE-RESPUESTA: si el índice único rechazó el insert, es una entrega
    // duplicada del mismo mensaje (Meta reintenta el webhook). La que sí guardó
    // responde; ésta se retira para no generar una segunda respuesta.
    if (guardado.dup) {
      resultados.push({ accion: "duplicado_carrera" });
      continue;
    }

    if (m.nombre) {
      await supa.from("ed_contactos").upsert(
        {
          cliente_id: cfg.clienteId,
          chat_id: chatId,
          nombre: m.nombre,
          telefono: `+${chatId}`,
          etiqueta: "lead",
        },
        { onConflict: "cliente_id,chat_id" },
      );
    }

    /**
     * ATRIBUCIÓN DE CAMPAÑA. Meta manda el anuncio de origen SOLO en el primer
     * mensaje de la conversación; si no se guarda ahora, se pierde para siempre.
     *
     * Se escribe en `ed_contactos.datos` (jsonb, migración 282) leyendo antes lo
     * que hubiera para no pisarlo, y **nunca sobre una referencia ya guardada**:
     * la primera es la que trajo al cliente.
     *
     * Si la 282 no está aplicada, avisa una vez y sigue. Un mensaje real vale
     * más que su atribución.
     */
    if (m.referencia) {
      try {
        const { data: previo } = await supa
          .from("ed_contactos")
          .select("datos")
          .eq("cliente_id", cfg.clienteId)
          .eq("chat_id", chatId)
          .maybeSingle();

        const datos = (previo?.datos ?? {}) as Record<string, unknown>;
        if (!datos.campana) {
          const { error } = await supa
            .from("ed_contactos")
            .update({
              datos: { ...datos, campana: { ...m.referencia, visto: new Date().toISOString() } },
            })
            .eq("cliente_id", cfg.clienteId)
            .eq("chat_id", chatId);
          if (error) throw new Error(error.message);
        }
      } catch (e) {
        console.warn(
          "[meta] no se pudo guardar la atribución de campaña (¿falta la migración 282?):",
          (e as Error).message,
        );
      }
    }

    await tocarVentanaEntrante(empleadoId, chatId, supa);

    /**
     * DEBOUNCE: si el cliente manda varios mensajes seguidos, responde solo la
     * invocación del ÚLTIMO (su historial ya los incluye todos). Evita
     * respuestas solapadas y desordenadas.
     *
     * ANTES ERAN 6 s FIJOS (G1, arreglado el 21-ago-2026). El camino de WAHA ya
     * usaba una ventana ADAPTATIVA desde el 3-ago porque 6 s no alcanzan: la
     * gente escribe a pedazos con 15-17 s entre fragmento y fragmento, así que
     * cada pedazo caía fuera de la ventana y disparaba su propia respuesta —
     * Tino preguntando lo mismo 2-4 veces seguidas. El arreglo se aplicó solo a
     * WAHA, o sea al número de Impresora Color, y Cloud API —por donde entra
     * TODO cliente nuevo— se quedó con el bug.
     */
    const DEBOUNCE_MS = ventanaDeEspera(m.texto ?? "");
    if (m.waId) {
      await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
      const { data: ultimo } = await supa
        .from("ed_mensajes")
        .select("wa_message_id")
        .eq("empleado_id", empleadoId)
        .eq("chat_id", chatId)
        .eq("rol", "cliente")
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ultimo?.wa_message_id && ultimo.wa_message_id !== m.waId) {
        resultados.push({ accion: "debounce_superseded" });
        continue;
      }
    }

    // ⚠️ ORDEN: `sigueVigente` se define ANTES que `enviar` porque ahora el
    // sender la lleva dentro (G2). Si se vuelve a invertir, TypeScript avisa.

    /**
     * PARIDAD CON WAHA (fix auditoría 1-ago-2026): la vía oficial no tenía esta
     * guardia, así que le faltaban DOS protecciones que WAHA sí tiene:
     *  1) Doble respuesta: si el cliente escribe otro mensaje MIENTRAS el modelo
     *     piensa (~9 s, ya fuera de la ventana del debounce), sin esto salían dos
     *     respuestas seguidas. Ahora el ciclo viejo se descarta y contesta el del
     *     último mensaje, con el historial completo.
     *  2) Tino sobre el humano: si una persona toma el control entre que el modelo
     *     responde y el envío, se re-lee el modo y la respuesta obsoleta no sale.
     */
    const sigueVigente = async (): Promise<boolean> => {
      if ((await modoDe(empleadoId, chatId, supa)) !== "bot") return false;
      if (!m.waId) return true;
      const { data } = await supa
        .from("ed_mensajes")
        .select("wa_message_id")
        .eq("empleado_id", empleadoId)
        .eq("chat_id", chatId)
        .eq("rol", "cliente")
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      return !data?.wa_message_id || data.wa_message_id === m.waId;
    };

    /**
     * El sender que usa el cerebro. Ahora lleva DENTRO la guardia y el ritmo
     * humano (G2 y G3, 21-ago-2026), igual que `enviarTextoWaha`.
     *
     * Va acá y no en `responderBot` a propósito: así el cerebro sigue sin saber
     * de transportes, y cualquier camino nuevo que quiera las dos protecciones
     * solo tiene que armar su sender igual que éste.
     */
    const enviar =
      opts?.enviar ??
      (async (para: string, texto: string) =>
        enviarTexto(cfg, para, texto, {
          vigente: sigueVigente,
          mensajeIdCliente: m.waId,
        }));

    const r = await responderSiBot({
      clienteId: cfg.clienteId,
      empleadoId,
      chatId,
      enviar,
      sigueVigente,
      fechaLimiteModelo: fechaLimite,
    });
    resultados.push({ accion: `cliente:${r.accion}`, detalle: r.detalle });
  }

  if (resultados.length === 0) resultados.push({ accion: "ignorado" });
  return resultados;
}
