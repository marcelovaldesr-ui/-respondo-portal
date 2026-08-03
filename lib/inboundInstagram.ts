import { db } from "@/lib/db";
import {
  parsearInstagram,
  clientePorPaginaIg,
  enviarTextoInstagram,
} from "@/lib/instagram";
import { tinoDe } from "@/lib/whatsapp";
import { guardarMensaje, yaProcesado, esEcoReciente } from "@/lib/mensajes";
import { setModo, tocarVentanaEntrante } from "@/lib/estadoChat";
import { responderSiBot } from "@/lib/responderBot";
import { empleadoParaEntrante } from "@/lib/seguimientos";

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
  const eventos = parsearInstagram(payload);
  if (!eventos.length) return [{ accion: "ignorado" }];

  const supa = db();
  const resultados: ResultadoIg[] = [];
  // Una entrega puede traer varios eventos de la misma cuenta: se resuelve una vez.
  const cache = new Map<string, { clienteId: string; empleadoId: string } | null>();

  for (const ev of eventos) {
    let ctx = cache.get(ev.paginaId);
    if (ctx === undefined) {
      const clienteId = await clientePorPaginaIg(ev.paginaId);
      const empleadoId = clienteId ? await tinoDe(clienteId) : null;
      ctx = clienteId && empleadoId ? { clienteId, empleadoId } : null;
      cache.set(ev.paginaId, ctx);
    }
    if (!ctx) {
      resultados.push({ accion: "sin_cliente", detalle: ev.paginaId });
      continue;
    }

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

    await supa.from("ed_contactos").upsert(
      {
        cliente_id: ctx.clienteId,
        chat_id: chatId,
        // No se inventa un nombre: en Instagram el perfil requiere otro permiso
        // y hasta tenerlo es preferible mostrar el usuario que un dato falso.
        etiqueta: "lead",
      },
      { onConflict: "cliente_id,chat_id" },
    );

    await tocarVentanaEntrante(empleadoId, chatId, supa);

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
        enviarTextoInstagram(ev.igsid, texto, { vigente: sigueVigente }));

    const r = await responderSiBot({
      clienteId: ctx.clienteId,
      empleadoId,
      chatId,
      enviar,
      sigueVigente,
      canal: "instagram",
    });
    resultados.push({ accion: `cliente:${r.accion}`, detalle: r.detalle });
  }

  return resultados;
}
