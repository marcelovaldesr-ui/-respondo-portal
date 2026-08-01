import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { procesarSeguimientos } from "@/lib/seguimientos";
import { enviarTextoWaha } from "@/lib/waha";
import { configPorCliente, enviarTexto } from "@/lib/whatsapp";
import { secretoValido } from "@/lib/seguridad";
import { LATIDO_CRON_SEGUIMIENTOS, registrarLatido } from "@/lib/latidos";
import { generarInformesPendientes } from "@/lib/insightsAuto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * CRON DE SEGUIMIENTOS — envía los mensajes proactivos programados
 * (recordatorios de cita, reactivación de cotizaciones) de ed_seguimientos.
 *
 * Disparo: un cron externo (cron-job.org / Vercel Cron) hace GET acá cada
 * 15–60 min con ?k=<secreto>. El endpoint es idempotente y barato: si no hay
 * pendientes, no hace nada. Salvaguardas (horario hábil Chile, tope diario,
 * max_intentos, no_contactar) viven en lib/seguimientos.ts.
 *
 * Transporte por cliente: 'cloud' → API oficial de Meta; resto → WAHA
 * (misma regla que el inbox en conversaciones/acciones.ts).
 */
export async function GET(request: NextRequest) {
  const secreto = process.env.CRON_SECRET || process.env.EVOLUTION_WEBHOOK_SECRET;
  if (secreto) {
    const k = new URL(request.url).searchParams.get("k");
    if (!secretoValido(k, secreto)) return new NextResponse("Forbidden", { status: 403 });
  }

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
      return enviarTextoWaha(chatId, texto);
    },
  });

  // Deja constancia de que el cron corrió, aunque no haya enviado nada. Esto es
  // lo que permite que /api/salud detecte que el cron DEJÓ de correr; sin el
  // latido, un cron muerto se ve igual que un cron sin trabajo pendiente.
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

  await registrarLatido(LATIDO_CRON_SEGUIMIENTOS, {
    enviados: r.enviados,
    // Solo el CONTEO del detalle: esas líneas traen chat_id y no deben quedar
    // guardadas en una tabla de diagnóstico.
    pasos: Array.isArray(r.detalle) ? r.detalle.length : 0,
  });

  return NextResponse.json({ ...r, informes });
}
