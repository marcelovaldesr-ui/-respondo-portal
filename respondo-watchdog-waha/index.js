/**
 * RESPONDO WATCHDOG — WAHA (motor GOWS) — vigila la conexión de Tino 24/7
 * ----------------------------------------------------------------------------
 * Reemplaza al watchdog viejo de Evolution (ya eliminado). Vigila la sesión de
 * WAHA y avisa por Telegram si Tino deja de poder atender.
 *
 * Qué hace cada CHECK_INTERVAL_MIN (default 5):
 *  1) Lee el estado de la sesión (GET /api/sessions/{session}).
 *     - WORKING           → sano.
 *     - STOPPED           → intenta arrancarla (POST .../start).
 *     - FAILED            → intenta reiniciarla (POST .../restart).
 *     - SCAN_QR_CODE      → REQUIERE HUMANO (re-escanear QR) → alerta.
 *     - otro/timeout      → cuenta como caída.
 *  2) (Opcional) Canary: envía un texto a sí mismo y verifica que no quede en
 *     error, para detectar el caso "WORKING pero no entrega".
 *
 * Escalera: 1er fallo tolera, 2º intenta auto-recuperar, 3º alerta Telegram.
 * Rate limits anti-tormenta: 1 alerta/hora, máx 3 auto-recuperaciones/hora.
 *
 * Sin dependencias (Node 18+, fetch nativo). Correr como servicio en Railway
 * junto a WAHA con restart policy ALWAYS.
 *
 * Variables de entorno:
 *   WAHA_API_URL        https://waha-production-003e.up.railway.app
 *   WAHA_API_KEY        clave global de WAHA
 *   WAHA_SESSION        nombre de la sesión (default "default")
 *   SELF_NUMBER         número propio del chip, solo dígitos (para el canary)
 *   TELEGRAM_BOT_TOKEN  token del bot de @BotFather
 *   TELEGRAM_CHAT_ID    tu chat id
 *   CHECK_INTERVAL_MIN  default 5
 *   CANARY              "1" para activar el canary de envío (default off)
 */

const CFG = {
  base: (process.env.WAHA_API_URL || "https://waha-production-003e.up.railway.app").replace(/\/+$/, ""),
  key: process.env.WAHA_API_KEY || "",
  session: process.env.WAHA_SESSION || "default",
  self: (process.env.SELF_NUMBER || "").replace(/\D/g, ""),
  intervalMs: (parseInt(process.env.CHECK_INTERVAL_MIN || "5", 10)) * 60_000,
  tgToken: process.env.TELEGRAM_BOT_TOKEN || "",
  tgChat: process.env.TELEGRAM_CHAT_ID || "",
  canary: process.env.CANARY === "1",
};

const state = { strikes: 0, recuperaciones: [], lastAlertAt: 0, lastHealthyAt: Date.now() };
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function waha(method, path, body) {
  const res = await fetch(`${CFG.base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Api-Key": CFG.key },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* vacío */ }
  return { status: res.status, ok: res.ok, data };
}

async function telegram(text) {
  if (!CFG.tgToken || !CFG.tgChat) { log("[ALERTA sin Telegram]", text); return; }
  try {
    await fetch(`https://api.telegram.org/bot${CFG.tgToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CFG.tgChat, text, parse_mode: "HTML" }),
    });
  } catch (e) { log("Error Telegram:", e.message); }
}

async function alert(text) {
  const now = Date.now();
  if (now - state.lastAlertAt < 60 * 60_000) { log("[alerta suprimida por throttle]", text); return; }
  state.lastAlertAt = now;
  await telegram(`🚨 <b>Watchdog Tino (WAHA)</b>\n${text}`);
}

async function estadoSesion() {
  const r = await waha("GET", `/api/sessions/${CFG.session}`);
  return r.data?.status || (r.ok ? "unknown" : "unreachable");
}

function pruneOld(arr, ms) { const c = Date.now() - ms; while (arr.length && arr[0] < c) arr.shift(); }

async function intentarRecuperar(estado) {
  pruneOld(state.recuperaciones, 60 * 60_000);
  if (state.recuperaciones.length >= 3) { log("Rate limit: 3 recuperaciones/h"); return false; }
  state.recuperaciones.push(Date.now());
  if (estado === "STOPPED") {
    log(">> sesión STOPPED → start");
    await waha("POST", `/api/sessions/${CFG.session}/start`);
  } else {
    log(">> sesión", estado, "→ restart");
    await waha("POST", `/api/sessions/${CFG.session}/restart`);
  }
  await new Promise((r) => setTimeout(r, 20_000));
  return true;
}

/** Canary opcional: envía a sí mismo y revisa que no quede en error. */
async function canaryOk() {
  if (!CFG.canary || !CFG.self) return true;
  const chatId = `${CFG.self}@c.us`;
  const r = await waha("POST", `/api/sendText`, { session: CFG.session, chatId, text: `🩺 watchdog ${new Date().toISOString()}` });
  if (!r.ok) { log("canary sendText falló:", r.status); return false; }
  const id = (typeof r.data?.id === "string" ? r.data.id : r.data?.id?._serialized) || "";
  if (!id) return true; // no se pudo trackear; el envío fue aceptado
  await new Promise((res) => setTimeout(res, 12_000));
  const m = await waha("GET", `/api/${CFG.session}/chats/${encodeURIComponent(chatId)}/messages?limit=5&downloadMedia=false`);
  const arr = Array.isArray(m.data) ? m.data : [];
  const gid = id.slice(id.lastIndexOf("_") + 1);
  const msg = arr.find((x) => (x.id || "").includes(gid));
  if (msg && (msg.ackName === "ERROR" || msg.ack === -1 || msg.ack === 0)) return false;
  return true;
}

async function checkOnce() {
  let estado = "unreachable";
  try { estado = await estadoSesion(); } catch (e) { log("estadoSesion error:", e.message); }
  log("estado sesión:", estado, "| strikes:", state.strikes);

  // SCAN_QR_CODE = requiere humano; no se auto-recupera.
  if (estado === "SCAN_QR_CODE") {
    await alert("La sesión pide <b>escanear QR</b> (posible logout/ban del número). Tino NO está atendiendo.\n→ Entrar al panel de WAHA y re-escanear con el chip.");
    return;
  }

  let sano = estado === "WORKING";
  if (sano) { try { sano = await canaryOk(); } catch { /* no bloquear */ } }

  if (sano) {
    if (state.strikes > 0) await telegram(`✅ <b>Watchdog Tino</b>\nRecuperado tras ${state.strikes} strike(s).`);
    state.strikes = 0;
    state.lastHealthyAt = Date.now();
    log("SANO ✓");
    return;
  }

  state.strikes++;
  log("NO SANO ✗ — strike", state.strikes);
  if (state.strikes === 1) {
    log("strike 1: tolerado.");
  } else if (state.strikes === 2) {
    await intentarRecuperar(estado);
  } else {
    const mins = Math.round((Date.now() - state.lastHealthyAt) / 60_000);
    await alert(`Tino lleva ~${mins} min sin poder atender (estado: <b>${estado}</b>) pese a intentar recuperar.\n→ Revisar el servicio WAHA en Railway y el panel de sesión.`);
  }
}

async function main() {
  const falta = [];
  if (!CFG.base) falta.push("WAHA_API_URL");
  if (!CFG.key) falta.push("WAHA_API_KEY");
  if (falta.length) { console.error("Faltan variables:", falta.join(", ")); process.exit(1); }
  log(`Watchdog WAHA iniciado. Sesión: ${CFG.session} | intervalo: ${CFG.intervalMs / 60000} min | canary: ${CFG.canary}`);
  await telegram(`🐕 <b>Watchdog Tino (WAHA)</b> iniciado. Vigilando "${CFG.session}" cada ${CFG.intervalMs / 60000} min.`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try { await checkOnce(); } catch (e) { log("Error en ciclo:", e.message); }
    await new Promise((r) => setTimeout(r, CFG.intervalMs));
  }
}

main();
