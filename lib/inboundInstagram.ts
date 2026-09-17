import { db } from "@/lib/db";
import {
  parsearInstagram,
  cuentaPorIdIg,
  enviarTextoInstagram,
  nombreDelRemitente,
  tipoMediaIg,
  type CuentaIg,
} from "@/lib/instagram";
import { tinoDe } from "@/lib/whatsapp";
import { guardarMensaje, yaProcesado, esEcoReciente, mensajeSinRespuesta } from "@/lib/mensajes";
import { modoDe, setModo, tocarVentanaEntrante } from "@/lib/estadoChat";
import { conservaElTurno } from "@/lib/turnoTino";
import { ventanaDeEspera } from "@/lib/ritmoHumano";
import { cerrarEscalacionesPendientes } from "@/lib/escalaciones";
import { idsEmpleadosDeCliente } from "@/lib/empleadosCache";
import { responderSiBot } from "@/lib/responderBot";
import { empleadoParaEntrante } from "@/lib/seguimientos";
import { notificarSistemaDelCliente } from "@/lib/puenteSalida";
import { fechaLimiteModelo } from "@/lib/presupuesto";

export type ResultadoIg = { accion: string; detalle?: string };

/**
 * Orquesta los DMs de Instagram.
 *
 * Gemelo de inboundWaha e inboundMeta: MISMO cerebro, MISMA convivencia
 * asistente + persona, MISMAS protecciones contra doble respuesta. Solo cambia
 * el transporte. Esa simetría no es elegancia: significa que todo lo que ya se
 * corrigió y probó en WhatsApp —el eco, la carrera del eco, el debounce, la
 * revalidación antes de enviar— vale igual acá sin volver a descubrirlo.
 *
 * LA IDENTIDAD ES OTRA, Y CONVIENE SABERLO
 * En WhatsApp el chat_id es el teléfono, así que la web y el chat caen en la
 * misma ficha. En Instagram es un IGSID: no es un teléfono, no sirve para
 * llamar y no se puede cruzar con la ficha de WhatsApp. La misma persona que
 * escribe por los dos canales aparece dos veces, y eso es correcto — unirlas
 * requeriría que ella diera su teléfono, y adivinarlo sería peor.
 */
export async function manejarEntranteInstagram(
  payload: unknown,
  opts?: {
    enviar?: (
      chatId: string,
      texto: string,
    ) => Promise<{ ok: boolean; waId?: string; error?: string }>;
  },
): Promise<ResultadoIg[]> {
  // Presupuesto de tiempo de ESTA invocación (ver lib/presupuesto.ts).
  const fechaLimite = fechaLimiteModelo(Date.now());
  const eventos = parsearInstagram(payload);
  if (!eventos.length) return [{ accion: "ignorado" }];

  const supa = db();
  const resultados: ResultadoIg[] = [];
  // Una entrega puede traer varios eventos de la misma cuenta: se resuelve una vez.
  const cache = new Map<
    string,
    { clienteId: string; empleadoId: string; cuenta: CuentaIg } | null
  >();

  for (const ev of eventos) {
    let ctx = cache.get(ev.paginaId);
    if (ctx === undefined) {
      const cuenta = await cuentaPorIdIg(ev.paginaId);
      const empleadoId = cuenta ? await tinoDe(cuenta.clienteId) : null;
      ctx = cuenta && empleadoId ? { clienteId: cuenta.clienteId, empleadoId, cuenta } : null;
      cache.set(ev.paginaId, ctx);
    }
    if (!ctx) {
      resultados.push({ accion: "sin_cliente", detalle: ev.paginaId });
      continue;
    }
    // Copia a const: `ctx` es `let` y TypeScript pierde el estrechamiento del
    // null dentro de los cierres que se crean más abajo.
    const cta = ctx;

    // El chat se identifica con prefijo para que un IGSID no pueda colisionar
    // jamás con un número de teléfono en la misma tabla.
    const chatId = `ig:${ev.igsid}`;
    const empleadoId =
      (await empleadoParaEntrante(ctx.clienteId, chatId, ctx.empleadoId, supa)) ??
      ctx.empleadoId;

    // Idempotencia: Meta reintenta las entregas que no respondieron a tiempo.
    //
    // RED DE SEGURIDAD DEL "DUPLICADO" (auditoría externa 13-sep-2026; misma
    // protección que ya tenía lib/inboundMeta.ts desde el 3-sep-2026 — WAHA e
    // Instagram no la tenían, y por eso un mensaje huérfano quedaba mudo para
    // siempre. Ver lib/mensajes.ts::mensajeSinRespuesta para el detalle.
    //
    // Los ecos (esPropio) NO aplican: no son mensajes del cliente esperando
    // respuesta, así que un duplicado de eco siempre es solo un duplicado.
    let huerfano = false;
    if (ev.mid && (await yaProcesado(supa, empleadoId, ev.mid))) {
      if (ev.esPropio) {
        resultados.push({ accion: "duplicado" });
        continue;
      }
      huerfano = await mensajeSinRespuesta(supa, empleadoId, chatId, ev.mid);
      if (!huerfano) {
        resultados.push({ accion: "duplicado" });
        continue;
      }
      resultados.push({ accion: "duplicado_huerfano" });
      // Sin continue: se reprocesa como mensaje de la persona sin volver a
      // guardarlo (más abajo se salta guardarMensaje cuando huerfano === true).
    }

    // ── Mensaje del propio negocio ──────────────────────────────────────────
    if (ev.esPropio) {
      // ¿Es el eco de una respuesta que acabamos de mandar, o lo escribió una
      // persona desde el Instagram del negocio? Mismo problema y misma solución
      // que en WhatsApp: si es eco se ignora; si es una persona, el asistente
      // se calla en ese chat.
      if (
        (ev.mid && (await yaProcesado(supa, empleadoId, ev.mid))) ||
        (await esEcoReciente(supa, empleadoId, chatId, ev.texto))
      ) {
        resultados.push({ accion: "eco" });
        continue;
      }
      // ANTI-CARRERA: el eco puede llegar antes de que el envío haya guardado su
      // id. Sin esta espera, la propia respuesta del asistente se confundiría
      // con una intervención humana y se silenciaría solo.
      await new Promise((r) => setTimeout(r, 2500));
      if (
        (ev.mid && (await yaProcesado(supa, empleadoId, ev.mid))) ||
        (await esEcoReciente(supa, empleadoId, chatId, ev.texto))
      ) {
        resultados.push({ accion: "eco" });
        continue;
      }
      await guardarMensaje(supa, {
        empleadoId,
        chatId,
        rol: "humano",
        texto: ev.texto,
        waId: ev.mid,
        canal: "instagram",
      });
      await setModo(empleadoId, chatId, "humano", supa);
      /**
       * Una PERSONA le escribió al cliente: eso ES atender. La escalación se
       * cierra acá igual que cuando responde desde el portal; si no, "te
       * espera" quedaba encendido para siempre (2-sep-2026, ver escalaciones.ts).
       * Por chat, no por empleado: la derivación pudo abrirla Beto o Vera.
       */
      await cerrarEscalacionesPendientes(supa, {
        empleadoIds: await idsEmpleadosDeCliente(ctx.clienteId),
        chatId,
        clienteId: ctx.clienteId,
      });
      resultados.push({ accion: "toma_humana" });
      continue;
    }

    // ── Mensaje de la persona ───────────────────────────────────────────────
    // Si viene de la recuperación de huérfano (arriba), el mensaje YA está
    // guardado — guardarlo de nuevo lo rechazaría por el índice único y esta
    // invocación se retiraría creyendo que es una carrera.
    if (!huerfano) {
      const guardado = await guardarMensaje(supa, {
        empleadoId,
        chatId,
        rol: "cliente",
        texto: ev.texto,
        waId: ev.mid,
        canal: "instagram",
        /**
         * (Fase 3) LA MEDIA SE GUARDA. Hasta ahora este camino era el único de
         * los tres que no pasaba `media`: `parsearInstagram` extraía la URL del
         * adjunto y acá se tiraba. Una foto por DM quedaba como el texto "[el
         * cliente envió una imagen]" con media_tipo nulo, y el inbox no dibujaba
         * nada. Es la misma brecha que ya se había corregido dos veces en los
         * otros dos transportes.
         *
         * La URL de Instagram es temporal, igual que la de Meta: el archivador
         * (lib/archivarMedia.ts) la baja al bucket privado dentro de su ventana.
         */
        media: ev.adjunto
          ? {
              url: ev.adjunto.url ?? null,
              tipo: tipoMediaIg(ev.adjunto.tipo),
              mime: null,
              nombre: null,
            }
          : null,
      });
      // El índice único rechazó el insert → esta es una entrega duplicada y la
      // otra ya está respondiendo. Retirarse evita la doble respuesta.
      if (guardado.dup) {
        resultados.push({ accion: "duplicado_carrera" });
        continue;
      }
    }

    // NO DEGRADAR ETIQUETAS: un contacto existente conserva su etiqueta (cliente,
    // proveedor, etc.) y su etapa. Solo un contacto NUEVO se inicializa como 'lead'.
    const { data: existente } = await supa
      .from("ed_contactos")
      .select("nombre, telefono, etiquetas, etapa, etapa_manual, ultimo_mensaje_en, ultimo_mensaje_rol, etiqueta")
      .eq("cliente_id", ctx.clienteId)
      .eq("chat_id", chatId)
      .maybeSingle();

    let contactoGuardado = existente;
    if (!existente) {
      const { data: nuevo } = await supa
        .from("ed_contactos")
        .upsert(
          { cliente_id: ctx.clienteId, chat_id: chatId, etiqueta: "lead" },
          { onConflict: "cliente_id,chat_id", ignoreDuplicates: true },
        )
        .select("nombre, telefono, etiquetas, etapa, etapa_manual, ultimo_mensaje_en, ultimo_mensaje_rol, etiqueta")
        .maybeSingle();
      contactoGuardado = nuevo;
    }

    /**
     * El nombre de quien escribe, la PRIMERA vez que escribe.
     *
     * Sin esto el contacto aparece como `+ig:1436053351910293` y el dueño no
     * puede reconocer a nadie en su bandeja. Se pide una sola vez —solo si el
     * contacto todavía no tiene nombre— para no gastar una llamada a Meta por
     * cada mensaje de una conversación larga.
     *
     * Va sin `await` bloqueante sobre la respuesta al cliente: es un dato
     * cosmético y no puede retrasar ni impedir que Tino conteste.
     */
    if (!contactoGuardado?.nombre) {
      try {
        const nombre = await nombreDelRemitente(ev.igsid, cta.cuenta);
        if (nombre) {
          await supa
            .from("ed_contactos")
            .update({ nombre })
            .eq("cliente_id", ctx.clienteId)
            .eq("chat_id", chatId);
          if (contactoGuardado) contactoGuardado.nombre = nombre;
        }
      } catch {
        /* un contacto sin nombre es un detalle; perder el mensaje no lo es */
      }
    }

    await tocarVentanaEntrante(empleadoId, chatId, supa);

    /**
     * PUENTE HACIA EL SISTEMA DEL CLIENTE (agregado 11-ago-2026).
     * Mismo enganche que en WhatsApp; ver la nota larga en `lib/inboundWaha.ts`.
     *
     * OJO CON LA IDENTIDAD: acá el chatId es `ig:<IGSID>`, que NO es un teléfono.
     * El sistema del cliente identifica sus leads por teléfono, así que un lead
     * de Instagram va a quedar con el IGSID en ese campo y no se va a poder
     * cruzar con el historial de pedidos ni abrir un WhatsApp de respuesta. Es
     * correcto que sea así: unirlos exigiría que la persona diera su teléfono, y
     * adivinarlo sería peor. Queda distinguible por `canal = 'instagram'`.
     */
    notificarSistemaDelCliente({
      evento: "mensaje",
      clienteId: cta.clienteId,
      contacto: {
        chatId,
        telefono: (contactoGuardado?.telefono as string | null) ?? null,
        nombre: (contactoGuardado?.nombre as string | null) ?? null,
        canal: "instagram",
        etapa: (contactoGuardado?.etapa as string | null) ?? null,
        etapaManual: Boolean(contactoGuardado?.etapa_manual),
        etiquetas: (contactoGuardado?.etiquetas as string[] | null) ?? null,
        ultimoMensajeEn: (contactoGuardado?.ultimo_mensaje_en as string | null) ?? null,
        ultimoMensajeRol: (contactoGuardado?.ultimo_mensaje_rol as string | null) ?? null,
      },
      mensaje: { waId: ev.mid, rol: "cliente", texto: ev.texto ?? "" },
      supa,
    });

    /**
     * ── RÁFAGA (Fase 3) ──────────────────────────────────────────────────────
     *
     * Instagram era el único transporte sin ventana de agrupación: cada
     * mensaje disparaba su propio ciclo, así que quien escribe "hola" /
     * "quiero" / "500" en tres burbujas seguidas recibía tres respuestas, cada
     * una sin el contexto de la siguiente. Por DM eso es todavía más común que
     * por WhatsApp.
     *
     * Misma mecánica que los otros dos: se espera la ventana que corresponde
     * al texto y, al despertar, esta ejecución se pregunta si sigue siendo el
     * último mensaje del cliente. Las que no lo son se retiran; la que queda
     * arma el historial completo, que ya incluye todos los pedazos.
     */
    const DEBOUNCE_MS = ventanaDeEspera(ev.texto ?? "");
    if (ev.mid) {
      await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
      const { data: ultimoIg } = await supa
        .from("ed_mensajes")
        .select("wa_message_id")
        .eq("empleado_id", empleadoId)
        .eq("chat_id", chatId)
        .eq("rol", "cliente")
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ultimoIg?.wa_message_id && ultimoIg.wa_message_id !== ev.mid) {
        resultados.push({ accion: "debounce_superseded" });
        continue;
      }
    }

    /**
     * Igual que en WhatsApp: si llegó algo más nuevo, esta respuesta sobra.
     *
     * (Fase 3) Ahora también re-lee el MODO, que era la diferencia con los
     * otros dos transportes. Sin eso, si una persona tomaba el control durante
     * los segundos del "escribiendo…", Tino igual hablaba encima: exactamente
     * el incidente que lib/inboundWaha.ts documenta como ya ocurrido. La capa
     * de responderBot.ts lo cubría antes de enviar, pero no durante el envío.
     */
    const sigueVigente = async (): Promise<boolean> => {
      const { data } = await supa
        .from("ed_mensajes")
        .select("wa_message_id")
        .eq("empleado_id", empleadoId)
        .eq("chat_id", chatId)
        .eq("rol", "cliente")
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      return conservaElTurno({
        modo: await modoDe(empleadoId, chatId, supa),
        idUltimoDelCliente: (data?.wa_message_id as string | null) ?? null,
        idQueRespondo: ev.mid,
      });
    };

    const enviar =
      opts?.enviar ??
      (async (_chatId: string, texto: string) =>
        enviarTextoInstagram(cta.cuenta, ev.igsid, texto, { vigente: sigueVigente }));

    const r = await responderSiBot({
      clienteId: ctx.clienteId,
      empleadoId,
      chatId,
      enviar,
      sigueVigente,
      canal: "instagram",
      fechaLimiteModelo: fechaLimite,
    });
    resultados.push({ accion: `cliente:${r.accion}`, detalle: r.detalle });
  }

  return resultados;
}
