import "./_env";
import { db } from "../lib/db";

/**
 * DIAGNÓSTICO DEL CRON DE SEGUIMIENTOS.
 *
 * Responde tres preguntas, en orden, con datos de la base — no con suposiciones:
 *  1) ¿Hay seguimientos programados? (si no hay, el cron podría estar vivo y
 *     no notarse)
 *  2) ¿Se enviaron seguimientos en los últimos días? → prueba de que ALGUIEN
 *     está llamando al endpoint.
 *  3) ¿Hay pendientes VENCIDOS (programado_para en el pasado y sin enviar)?
 *     → prueba de que el cron NO está corriendo.
 *
 * Uso: npx tsx scripts/_diag_cron.ts
 */

const ZONA = "America/Santiago";
const fmt = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("es-CL", {
        timeZone: ZONA, day: "2-digit", month: "short",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(iso))
    : "—";

async function main() {
  const supa = db();
  const ahora = new Date();

  const { count: total, error: e1 } = await supa
    .from("ed_seguimientos")
    .select("id", { count: "exact", head: true });
  if (e1) {
    console.log("✗ No se pudo leer ed_seguimientos:", e1.message);
    process.exit(1);
  }
  console.log(`\nTotal de seguimientos en la base: ${total}`);

  // 2) Enviados recientes = evidencia de que el cron corre.
  const hace7 = new Date(ahora.getTime() - 7 * 86_400_000).toISOString();
  const { data: enviados } = await supa
    .from("ed_seguimientos")
    .select("id, tipo, chat_id, programado_para, enviado_en")
    .not("enviado_en", "is", null)
    .gte("enviado_en", hace7)
    .order("enviado_en", { ascending: false })
    .limit(10);

  console.log(`\n── Enviados en los últimos 7 días: ${enviados?.length ?? 0}`);
  for (const s of enviados ?? []) {
    console.log(`   ${fmt(s.enviado_en as string)}  ${s.tipo}  → ${s.chat_id}`);
  }

  // El último envío de todos los tiempos, para saber cuándo dejó de andar.
  const { data: ultimo } = await supa
    .from("ed_seguimientos")
    .select("enviado_en, tipo")
    .not("enviado_en", "is", null)
    .order("enviado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  console.log(
    `\n── Último envío registrado: ${ultimo ? `${fmt(ultimo.enviado_en as string)} (${ultimo.tipo})` : "NINGUNO en toda la historia"}`,
  );

  // 3) Vencidos sin enviar = el cron NO está corriendo (o está fallando).
  const { data: vencidos } = await supa
    .from("ed_seguimientos")
    .select("id, tipo, chat_id, programado_para, intento")
    .is("enviado_en", null)
    .lte("programado_para", ahora.toISOString())
    .order("programado_para", { ascending: true })
    .limit(20);

  console.log(`\n── Pendientes VENCIDOS (deberían haber salido ya): ${vencidos?.length ?? 0}`);
  for (const s of vencidos ?? []) {
    const atrasoH = Math.round(
      (ahora.getTime() - Date.parse(s.programado_para as string)) / 3600_000,
    );
    console.log(
      `   ${fmt(s.programado_para as string)}  ${s.tipo}  → ${s.chat_id}  (atraso ${atrasoH} h, intentos ${s.intento ?? 0})`,
    );
  }

  // Futuros programados: lo que se perdería si el cron sigue muerto.
  const { data: futuros } = await supa
    .from("ed_seguimientos")
    .select("id, tipo, programado_para")
    .is("enviado_en", null)
    .gt("programado_para", ahora.toISOString())
    .order("programado_para", { ascending: true })
    .limit(10);
  console.log(`\n── Programados a futuro: ${futuros?.length ?? 0}`);
  for (const s of futuros ?? []) {
    console.log(`   ${fmt(s.programado_para as string)}  ${s.tipo}`);
  }

  // ── Veredicto ────────────────────────────────────────────────────────
  console.log("\n════ VEREDICTO ════");
  if ((vencidos?.length ?? 0) > 0) {
    console.log("✗ EL CRON NO ESTÁ CORRIENDO (o falla): hay seguimientos vencidos sin enviar.");
  } else if ((enviados?.length ?? 0) > 0) {
    console.log("✓ El cron está vivo: hubo envíos en los últimos 7 días y no quedan vencidos.");
  } else if ((total ?? 0) === 0) {
    console.log("? No hay ningún seguimiento en la base: no se puede concluir nada. Hay que provocar uno.");
  } else {
    console.log("? Sin vencidos y sin envíos recientes. Puede estar bien (no había nada que enviar) o llevar mucho sin usarse.");
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
