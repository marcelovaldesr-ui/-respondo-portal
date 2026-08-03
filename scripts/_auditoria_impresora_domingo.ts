/**
 * Auditoría dirigida a Impresora Color antes del lunes (3-ago-2026, feedback
 * directo del usuario): buscar cualquier cosa que haga fallar a Tino con
 * clientes reales — duplicados, chats atascados en "humano" sin que nadie
 * responda, mensajes de cliente sin respuesta, errores.
 * Solo LECTURA. No modifica nada. Ejecutar: npx tsx scripts/_auditoria_impresora_domingo.ts
 */
import "./_env";
import { db } from "../lib/db";

const TINO = "a3333333-0000-0000-0000-000000000001";

function horasDesde(iso: string) {
  return ((Date.now() - new Date(iso).getTime()) / 3_600_000).toFixed(1);
}

async function main() {
  const supa = db();

  // 1) Mensajes de los últimos 5 días
  const desde = new Date(Date.now() - 5 * 24 * 3_600_000).toISOString();
  const { data: msgs, error } = await supa
    .from("ed_mensajes")
    .select("id, chat_id, rol, texto, wa_message_id, creado_en")
    .eq("empleado_id", TINO)
    .gte("creado_en", desde)
    .order("chat_id", { ascending: true })
    .order("creado_en", { ascending: true });
  if (error) {
    console.error("ERROR mensajes:", error);
    process.exit(1);
  }
  console.log(`Mensajes últimos 5 días: ${msgs?.length ?? 0}\n`);

  // 2) DUPLICADOS: mismo chat, rol=empleado, mismo texto, <120s de diferencia
  console.log("=== 1) POSIBLES DUPLICADOS (empleado repite el mismo texto en <120s) ===");
  let dup = 0;
  const porChat: Record<string, typeof msgs> = {};
  for (const m of msgs ?? []) {
    (porChat[m.chat_id] ??= []).push(m);
  }
  for (const [chat, lista] of Object.entries(porChat)) {
    for (let i = 1; i < lista.length; i++) {
      const a = lista[i - 1];
      const b = lista[i];
      if (
        a.rol === "empleado" &&
        b.rol === "empleado" &&
        a.texto === b.texto &&
        (new Date(b.creado_en).getTime() - new Date(a.creado_en).getTime()) / 1000 < 120
      ) {
        dup++;
        console.log(`  [${chat}] "${a.texto.slice(0, 60)}" repetido a los ${((new Date(b.creado_en).getTime() - new Date(a.creado_en).getTime()) / 1000).toFixed(0)}s (${a.creado_en} / ${b.creado_en})`);
      }
    }
  }
  if (!dup) console.log("  (ninguno encontrado)");

  // 3) Chats en modo "humano" con mensaje de CLIENTE sin responder después
  console.log("\n=== 2) CHATS EN MODO 'HUMANO' CON CLIENTE ESPERANDO ===");
  const { data: estados } = await supa
    .from("ed_chat_estado")
    .select("chat_id, modo, actualizado_en, ultimo_entrante_en")
    .eq("empleado_id", TINO)
    .eq("modo", "humano");
  let esperando = 0;
  for (const e of estados ?? []) {
    const lista = porChat[e.chat_id] ?? [];
    const ultimo = lista[lista.length - 1];
    if (!ultimo) continue;
    if (ultimo.rol === "cliente") {
      const horas = horasDesde(ultimo.creado_en);
      if (Number(horas) > 1) {
        esperando++;
        console.log(`  [${e.chat_id}] último mensaje es del CLIENTE hace ${horas}h, modo=humano, nadie respondió: "${ultimo.texto.slice(0, 80)}"`);
      }
    }
  }
  if (!esperando) console.log("  (ninguno encontrado en los últimos 5 días)");

  // 4) Chats en modo "bot" donde el ÚLTIMO mensaje es del cliente y pasó >30 min sin respuesta de Tino
  console.log("\n=== 3) CHATS EN MODO 'BOT' SIN RESPUESTA DE TINO (>30 min) ===");
  const { data: estadosBot } = await supa
    .from("ed_chat_estado")
    .select("chat_id, modo")
    .eq("empleado_id", TINO)
    .eq("modo", "bot");
  const setBot = new Set((estadosBot ?? []).map((e) => e.chat_id));
  let sinResponder = 0;
  for (const [chat, lista] of Object.entries(porChat)) {
    if (!setBot.has(chat)) continue;
    const ultimo = lista[lista.length - 1];
    if (ultimo.rol === "cliente") {
      const horas = Number(horasDesde(ultimo.creado_en));
      if (horas > 0.5 && horas < 48) {
        sinResponder++;
        console.log(`  [${chat}] cliente escribió hace ${horas.toFixed(1)}h y Tino (modo=bot) no respondió: "${ultimo.texto.slice(0, 80)}"`);
      }
    }
  }
  if (!sinResponder) console.log("  (ninguno encontrado)");

  // 5) Mensajes MUY seguidos del cliente (fragmentados) para ver si Tino respondió más de una vez de forma redundante
  console.log("\n=== 4) RESUMEN POR CHAT (para revisión manual) ===");
  const chats = Object.keys(porChat);
  console.log(`  Total chats con actividad en 5 días: ${chats.length}`);
  console.log(`  Chats en modo humano: ${(estados ?? []).length}`);
  console.log(`  Chats en modo bot: ${setBot.size}`);

  // 6) Escalaciones recientes
  console.log("\n=== 5) ESCALACIONES ÚLTIMOS 5 DÍAS ===");
  const { data: escalaciones } = await supa
    .from("ed_escalaciones")
    .select("chat_id, trigger, resumen, creado_en, resuelta")
    .eq("empleado_id", TINO)
    .gte("creado_en", desde)
    .order("creado_en", { ascending: false });
  console.log(`  Total: ${escalaciones?.length ?? 0}`);
  for (const e of escalaciones ?? []) {
    console.log(`  [${e.chat_id}] ${e.creado_en} trigger=${e.trigger} resuelta=${e.resuelta} — ${(e.resumen ?? "").slice(0, 100)}`);
  }

  console.log("\n=== FIN AUDITORÍA (solo lectura) ===");
}
main().then(() => process.exit(0)).catch((e) => { console.error("FALLO:", e); process.exit(1); });
