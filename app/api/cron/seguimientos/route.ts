import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { procesarSeguimientos } from "@/lib/seguimientos";
import { enviarTextoWaha } from "@/lib/waha";
import { configPorCliente, enviarTexto } from "@/lib/whatsapp";
import { secretoValido } from "@/lib/seguridad";
import { LATIDO_CRON_SEGUIMIENTOS, registrarLatido } from "@/lib/latidos";
import { generarInformesPendientes } from "@/lib/insightsAuto";
import { renovarTokensIg } from "@/lib/instagram";
import { reprocesarWebhooksPendientes } from "@/lib/webhookInbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * CRON DE SEGUIMIENTOS — envía los mensajes proactivos programados
 * (recordatorios de cita, reactivación de cotizaciones) de ed_seguimientos.
 *
 * Disparo: un cron externo (cron-job.org) hace GET acá cada 5 min
 * con ?k=<secreto>. El endpoint es idempotente y barato: si no hay
 * pendientes, no hace nada. Salvaguardas (horario hábil Chile, tope diario,
 * max_intentos, no_contactar) viven en lib/seguimientos.ts.
 *
 * ES EL ÚNICO CRON DEL SISTEMA. De acá cuelgan los recordatorios y encuestas de
 * la agenda, las reactivaciones de Beto y el informe semanal de los lunes. No
 * hay que crear un segundo cron para la agenda: se activa todo junto.
 *
 * Transporte por cliente: 'cloud' → API oficial de Meta; resto → WAHA
 * (misma regla que el inbox en conversaciones/acciones.ts).
 */
export async function GET(request: NextRequest) {
  // CRON_SECRET es su propio secreto desde el 5-ago-2026 (antes caía al
  // EVOLUTION_WEBHOOK_SECRET compartido con el webhook de WAHA — resabio
  // del proveedor viejo ya eliminado). Sepáralos: rotar uno no debe romper
  // el otro.
  const secreto = process.env.CRON_SECRET;
  const k = new URL(request.url).searchParams.get("k");
  // Fail closed: esta ruta ejecuta envíos y usa service_role. Una variable
  // ausente no puede convertirla silenciosamente en un cron público.
  if (!secreto) return new NextResponse("Cron no configurado", { status: 503 });
  if (!secretoValido(k, secreto)) return new NextResponse("Forbidden", { status: 403 });

  const supa = db();

  const r = await procesarSeguimientos({
    enviar: async (empleadoId, chatId, texto) => {
      // Resolver el cliente del empleado para elegir transporte.
      const { data: emp } = await supa
        .from("ed_empleados")
        .select("cliente_id")
        .eq("id", empleadoId)
        .maybeSingle();
      const clienteId = (emp?.cliente_id as string) ?? null;
      if (!clienteId) return { ok: false, error: "empleado sin cliente" };

      const { data: cli } = await supa
        .from("ed_clientes")
        .select("transporte")
        .eq("id", clienteId)
        .maybeSingle();
      const transporte = ((cli as { transporte?: string } | null)?.transporte as string) ?? "waha";

      if (transporte === "cloud") {
        const cfg = await configPorCliente(clienteId);
        if (!cfg) return { ok: false, error: "cliente cloud sin credenciales" };
        return enviarTexto(cfg, chatId, texto);
      }
      // BARRERA MULTI-CLIENTE (auditoría 11-ago-2026): WAHA tiene UNA sola
      // sesión. Sin pasar el clienteId acá, los recordatorios de cualquier otro
      // cliente en transporte='waha' salían por el WhatsApp del dueño de esa
      // sesión y quedaban guardados en SU conversación. Ver lib/waha.ts.
      return enviarTextoWaha(chatId, texto, { clienteId });
    },
  });

  /**
   * INFORME SEMANAL — se engancha acá y no en un cron aparte.
   *
   * lib/insightsAuto.ts se escribió para colgarse de este endpoint ("un solo
   * disparador externo que mantener"), pero la llamada nunca se agregó: el
   * módulo existía y no lo invocaba nadie. Por eso el informe del lunes no
   * aparecía solo y había que apretar el botón a mano.
   *
   * Va DESPUÉS de los seguimientos y envuelto en su propio try: generar un
   * informe usa el modelo y puede demorar o fallar, y eso jamás debe impedir
   * que salgan los recordatorios de citas, que son los que un cliente espera a
   * una hora concreta. Los días que no son lunes retorna al instante.
   */
  let informes = { generados: 0, detalle: ["no_ejecutado"] as string[] };
  try {
    informes = await generarInformesPendientes();
  } catch (e) {
    console.error("[cron] informe semanal falló (no afecta los seguimientos)", e);
    informes = { generados: 0, detalle: ["error"] };
  }

  /**
   * TOKENS DE INSTAGRAM — se renuevan acá por la misma razón que el informe.
   *
   * Duran 60 días y vencen en silencio: la API deja de aceptar los envíos y en
   * el portal no se ve nada raro. Sin esta llamada, el canal se apaga solo a los
   * dos meses de conectarlo y nos enteramos por un cliente. La función retorna
   * al instante cuando no hay nada por vencer, así que correrla cada 5 minutos
   * no cuesta nada.
   */
  let instagram = { renovados: 0, fallas: [] as string[] };
  try {
    instagram = await renovarTokensIg();
  } catch (e) {
    console.error("[cron] renovación de tokens de Instagram falló", e);
  }

  let webhooks = { reintentados: 0, fallidos: 0, purgados: 0, borrados: 0 };
  try {
    // Acotado porque cada entrante puede invocar IA; el siguiente latido toma
    // los restantes sin arriesgar el timeout del cron principal.
    webhooks = await reprocesarWebhooksPendientes(2);
  } catch (e) {
    console.error("[cron] reintento de webhooks falló", (e as Error).message);
  }

  // Deja constancia de que el cron corrió, aunque no haya enviado nada. Esto es
  // lo que permite que /api/salud detecte que el cron DEJÓ de correr; sin el
  // latido, un cron muerto se ve igual que un cron sin trabajo pendiente.
  await registrarLatido(LATIDO_CRON_SEGUIMIENTOS, {
    enviados: r.enviados,
    // Solo el CONTEO del detalle: esas líneas traen chat_id y no deben quedar
    // guardadas en una tabla de diagnóstico.
    pasos: Array.isArray(r.detalle) ? r.detalle.length : 0,
  });

  return NextResponse.json({ ...r, informes, instagram, webhooks });
}
