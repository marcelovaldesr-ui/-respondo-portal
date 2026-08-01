/**
 * MEDIA BAJO DEMANDA contra el WAHA real (revisión independiente 1-ago-2026).
 *
 * Verifica en vivo (solo LECTURA, no envía nada) la cadena que usa el visor de
 * adjuntos del inbox (/api/whatsapp/media) en WAHA Core:
 *   1. mediaDeMensajeWaha: pide a WAHA el media de un mensaje entrante por id
 *      (downloadMedia=true) — en Core el webhook llega con media=null, así que
 *      esta resolución bajo demanda es la única forma de obtener la URL.
 *   2. La URL resuelta queda RE-ANCLADA al host público de WAHA (Core devuelve
 *      localhost:8080, inservible desde afuera).
 *   3. El archivo descarga con X-Api-Key y devuelve 401 sin ella.
 *
 * USO: npx tsx scripts/_test_media_waha.ts [chatId] [waIdNormalizado]
 * Sin argumentos usa un mensaje real conocido de la imprenta (imagen jpeg).
 * Si ese mensaje ya no existe en WAHA (rotación de historial), pasar uno nuevo:
 * buscarlo con GET /api/default/chats/{n}@c.us/messages?limit=20 (hasMedia).
 */
import "./_env";

async function main() {
  const { mediaDeMensajeWaha, reanclarUrlWaha } = await import("../lib/waha");

  const chatId = process.argv[2] ?? "56951967547";
  const waId = process.argv[3] ?? "AC7222F543C368FC3E2BDC0279CACFEA";
  let fallos = 0;
  const ok = (c: boolean, n: string) => {
    if (c) console.log(`  ✓ ${n}`);
    else {
      fallos++;
      console.error(`  ✗ ${n}`);
    }
  };

  console.log("=== reanclarUrlWaha (puro) ===");
  const base = (process.env.WAHA_API_URL || "").replace(/\/+$/, "");
  ok(
    reanclarUrlWaha("http://localhost:8080/api/files/default/x.jpeg") ===
      `${new URL(base).origin}/api/files/default/x.jpeg`,
    "localhost se re-ancla al host público",
  );
  ok(
    (reanclarUrlWaha("http://169.254.169.254/latest/meta-data") ?? "").startsWith(
      new URL(base).origin,
    ),
    "host malicioso queda re-anclado (anti-SSRF por construcción)",
  );
  ok(reanclarUrlWaha("no-es-url") === null, "URL inválida → null");

  console.log(`\n=== resolución bajo demanda (chat ${chatId}, id ${waId.slice(0, 8)}…) ===`);
  const r = await mediaDeMensajeWaha(chatId, waId);
  if (!r) {
    console.error(
      "  ✗ no se resolvió — si el mensaje rotó del historial de WAHA, pasar chatId y waId de un mensaje con media vigente",
    );
    process.exit(1);
  }
  ok(r.url.startsWith(new URL(base).origin), "URL resuelta apunta al host público de WAHA");

  const key = process.env.WAHA_API_KEY!;
  const conKey = await fetch(r.url, { headers: { "X-Api-Key": key } });
  const bytes = conKey.ok ? (await conKey.arrayBuffer()).byteLength : 0;
  ok(conKey.status === 200 && bytes > 500, `descarga con api key (HTTP ${conKey.status}, ${bytes} bytes)`);

  const sinKey = await fetch(r.url);
  ok(sinKey.status === 401, `sin api key rechaza (HTTP ${sinKey.status})`);

  console.log(fallos === 0 ? "\n✅ MEDIA WAHA OK" : `\n❌ ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FALLO:", e);
  process.exit(1);
});
