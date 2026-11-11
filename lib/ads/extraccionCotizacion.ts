import { db } from "@/lib/db";
import { generarJSON } from "@/lib/gemini";
import { leerConfig } from "@/lib/ads/conversionesConfig";
import {
  ESQUEMA_COTIZACION,
  fusionarCotizacion,
  interpretarExtraccion,
  leerCotizacion,
  promptCotizacion,
} from "@/lib/ads/cotizacionCore";

/**
 * EXTRACTOR DE COTIZACIONES — corre en el cron, nunca en el turno de Tino.
 *
 * Solo para tenants con `conversiones_meta_activo` y solo en conversaciones que
 * vinieron de un anuncio (tienen `ctwa_clid`): son las únicas que pueden
 * generar un evento, y así el costo de modelo queda acotado a la campaña.
 *
 * Por cada conversación con mensajes nuevos desde la última lectura, el modelo
 * lee los últimos mensajes con un schema fijo (producto, cantidad, tipo,
 * fecha, logo, empresa) y el resultado se fusiona en `ed_contactos.cotizacion`.
 * La regla de calificación la aplica el CÓDIGO (conversionesConfig.ts), no el
 * modelo.
 *
 * Si el modelo falla, la conversación NO se marca como revisada y el siguiente
 * latido la reintenta. Nunca lanza.
 */

const MAX_POR_PASADA = 4;
const DIAS_ACTIVIDAD = 7;
const MENSAJES_CONTEXTO = 20;
const MINIMO_MS = 15_000;

export async function extraerCotizaciones(opts: { fechaLimite?: number } = {}): Promise<{
  revisadas: number;
  completas: number;
  calificadas: number;
  detalle: string[];
}> {
  const out = { revisadas: 0, completas: 0, calificadas: 0, detalle: [] as string[] };
  const fechaLimite = opts.fechaLimite ?? Date.now() + 60_000;
  const supa = db();
  try {
    const { data: clientes, error } = await supa
      .from("ed_clientes")
      .select("id, nombre, conversiones_meta")
      .eq("conversiones_meta_activo", true)
      .limit(10);
    if (error || !clientes?.length) return out; // sin la 331 o sin nadie activo

    const desde = new Date(Date.now() - DIAS_ACTIVIDAD * 86_400_000).toISOString();
    let procesadas = 0;

    for (const cli of clientes) {
      if (procesadas >= MAX_POR_PASADA) break;
      const clienteId = cli.id as string;
      const cfg = leerConfig(cli.conversiones_meta);
      const { data: emps } = await supa.from("ed_empleados").select("id").eq("cliente_id", clienteId);
      const empIds = (emps ?? []).map((e) => e.id as string);
      if (!empIds.length) continue;

      const { data: contactos } = await supa
        .from("ed_contactos")
        .select("chat_id, cotizacion, cotizacion_revisada_en, ultimo_mensaje_en")
        .eq("cliente_id", clienteId)
        .not("datos->campana->>ctwaClid", "is", null)
        .gte("ultimo_mensaje_en", desde)
        .order("ultimo_mensaje_en", { ascending: false })
        .limit(60);

      const pendientes = (contactos ?? []).filter((c) => {
        const r = c.cotizacion_revisada_en as string | null;
        const u = c.ultimo_mensaje_en as string | null;
        return Boolean(u) && (!r || r < (u as string));
      });

      for (const c of pendientes) {
        if (procesadas >= MAX_POR_PASADA) break;
        if (fechaLimite - Date.now() < MINIMO_MS) {
          out.detalle.push("sin tiempo");
          return out;
        }
        const chatId = c.chat_id as string;
        const marcar = async (extra: Record<string, unknown> = {}) =>
          supa
            .from("ed_contactos")
            .update({ cotizacion_revisada_en: c.ultimo_mensaje_en, ...extra })
            .eq("cliente_id", clienteId)
            .eq("chat_id", chatId);

        const { data: filas } = await supa
          .from("ed_mensajes")
          .select("rol, texto, creado_en")
          .in("empleado_id", empIds)
          .eq("chat_id", chatId)
          .order("creado_en", { ascending: false })
          .limit(MENSAJES_CONTEXTO);
        const mensajes = (filas ?? []).reverse().map((m) => ({ rol: m.rol as string, texto: (m.texto as string) ?? "" }));
        if (!mensajes.some((m) => m.rol === "cliente" && m.texto.trim())) {
          await marcar();
          continue;
        }

        procesadas++;
        out.revisadas++;
        let crudo: string;
        try {
          crudo = await generarJSON(
            promptCotizacion({
              negocio: (cli.nombre as string) ?? "el negocio",
              productos: cfg.reglas.map((r) => r.producto),
              mensajes,
            }),
            { fechaLimite, intentosPorModelo: 1, thinkingBudget: 0, esquema: ESQUEMA_COTIZACION as unknown as Record<string, unknown> },
          );
        } catch (e) {
          out.detalle.push(`modelo falló: ${(e as Error).message}`);
          continue; // sin marcar: se reintenta
        }

        const previa = leerCotizacion(c.cotizacion);
        const nueva = fusionarCotizacion(previa, interpretarExtraccion(crudo), cfg.reglas, new Date().toISOString());
        if (nueva.completaEn && !previa.completaEn) out.completas++;
        if (nueva.calificadaEn && !previa.calificadaEn) out.calificadas++;
        await marcar({ cotizacion: nueva });
      }
    }
  } catch (e) {
    out.detalle.push(`error: ${(e as Error).message}`);
  }
  return out;
}
