import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { drenarColaWaha, reaperEnviosWaha, expirarColaWaha } from "@/lib/kambakEnvios";
import { revisarSaludPool } from "@/lib/poolSalud";
import { procesarEventosPendientes } from "@/lib/webhookSalida";
import { limitarDistribuido, secretoValido } from "@/lib/seguridad";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * CRON DEDICADO POOL WAHA KAMBAK (P13).
 *
 * Ejecución periódica (cada 1 a 2 min en horario hábil 09:00 a 21:00 Chile):
 *   1. Reaper: recupera envíos en 'enviando' atascados (>3m).
 *   2. Expiración: marca filas 'en_cola' viejas (>48h o WAHA_POOL_COLA_MAX_HORAS) como fallidas.
 *   3. Drenado de cola: despacha hasta 50 mensajes en paralelo distribuidos entre chips disponibles.
 *   4. Salud del pool: monitorea conectividad, pausas, desconexiones y rampa de calentamiento.
 *   5. Webhooks salientes: entrega eventos pendientes a Kambak.
 *
 * Autenticación:
 *   - Cabecera: Authorization: Bearer <CRON_SECRET>
 *   - Query param: ?k=<CRON_SECRET>
 */
async function ejecutarCron(request: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    return new NextResponse("Cron no configurado", { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const k = new URL(request.url).searchParams.get("k");

  const tokenValido = (bearer && secretoValido(bearer, secreto)) || (k && secretoValido(k, secreto));
  if (!tokenValido) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Prevenir corridas concurrentes encimadas (máx 1 cada 50s por clave)
  const candado = await limitarDistribuido("cron:pool-kambak", 1, 50);
  if (!candado.ok) {
    return NextResponse.json({ ok: false, omitido: "otra corrida en curso" });
  }

  const ahora = new Date();
  const supa = db();

  try {
    // 1. Reaper de mensajes huérfanos
    const reaper = await reaperEnviosWaha(supa, ahora);

    // 2. Expiración de cola vieja
    const expirados = await expirarColaWaha(supa, ahora);

    // 3. Drenado de la cola de envíos WAHA
    const drenado = await drenarColaWaha(ahora, 50);

    // 4. Revisión de salud del pool (conectividad, pausados, auto-recuperación y calentamiento)
    const salud = await revisarSaludPool(supa, ahora);

    // 5. Despacho de webhooks de salida pendientes hacia Kambak
    const webhooks = await procesarEventosPendientes(ahora, 50);

    return NextResponse.json({
      ok: true,
      timestamp: ahora.toISOString(),
      drenado,
      reaper,
      expirados,
      salud,
      webhooks,
    });
  } catch (error) {
    console.error("[cron/pool-kambak] error durante ejecución:", (error as Error).message);
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return ejecutarCron(request);
}

export async function POST(request: NextRequest) {
  return ejecutarCron(request);
}
