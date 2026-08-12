import { db } from "@/lib/db";
import {
  parsearInstagram,
  cuentaPorIdIg,
  enviarTextoInstagram,
  type CuentaIg,
} from "@/lib/instagram";
import { tinoDe } from "@/lib/whatsapp";
import { guardarMensaje, yaProcesado, esEcoReciente } from "@/lib/mensajes";
import { setModo, tocarVentanaEntrante } from "@/lib/estadoChat";
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
    if (ev.mid && (await yaProcesado(supa, empleadoId, ev.mid))) {
      resultados.push({ accion: "duplicado" });
      continue;
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
      resultados.push({ accion: "toma_humana" });
      continue;
    }

    // ── Mensaje de la persona ───────────────────────────────────────────────
    const guardado = await guardarMensaje(supa, {
      empleadoId,
      chatId,
      rol: "cliente",
      texto: ev.texto,
      waId: ev.mid,
      canal: "instagram",
    });
    // El índice único rechazó el insert → esta es una entrega duplicada y la
    // otra ya está respondiendo. Retirarse evita la doble respuesta.
    if (guardado.dup) {
      resultados.push({ accion: "duplicado_carrera" });
      continue;
    }

    const { data: contactoGuardado } = await supa
      .from("ed_contactos")
      .upsert(
        {
          cliente_id: ctx.clienteId,
          chat_id: chatId,
          // No se inventa un nombre: en Instagram el perfil requiere otro permiso
          // y hasta tenerlo es preferible mostrar el usuario que un dato falso.
          etiqueta: "lead",
        },
        { onConflict: "cliente_id,chat_id" },
      )
      .select("nombre, telefono, etiquetas, etapa, etapa_manual, ultimo_mensaje_en, ultimo_mensaje_rol")
      .maybeSingle();

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

    /** Igual que en WhatsApp: si llegó algo más nuevo, esta respuesta sobra. */
    const sigueVigente = async (): Promise<boolean> => {
      if (!ev.mid) return true;
      const { data } = await supa
        .from("ed_mensajes")
        .select("wa_message_id")
        .eq("empleado_id", empleadoId)
        .eq("chat_id", chatId)
        .eq("rol", "cliente")
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      return !data?.wa_message_id || data.wa_message_id === ev.mid;
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
