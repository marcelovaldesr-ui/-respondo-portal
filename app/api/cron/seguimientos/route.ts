import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { procesarSeguimientos } from "@/lib/seguimientos";
import { enviarTextoWaha } from "@/lib/waha";
import { configPorCliente, enviarTexto } from "@/lib/whatsapp";

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
    if (k !== secreto) return new NextResponse("Forbidden", { status: 403 });
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

  return NextResponse.json(r);
}
