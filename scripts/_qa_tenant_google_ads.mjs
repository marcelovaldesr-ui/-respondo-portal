/**
 * Tenant QA AISLADO para el E2E de Google Ads con cuentas de PRUEBA de Google
 * (22-sep-2026). No es un cliente y no toca Customer Zero (Impresora Color):
 * la conexión de prueba queda en ESTE cliente_id y en ningún otro.
 *
 * Idempotente. Uso (con las variables de .env.local cargadas):
 *   node scripts/_qa_tenant_google_ads.mjs
 */
const ID = "66666666-6666-6666-6666-666666666666";
const EMAIL = "qa.googleads@demo.respondo.cl";
const u = process.env.SUPABASE_URL;
const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!u || !k) throw new Error("faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
const h = { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json", Prefer: "return=representation" };

async function rest(ruta, init = {}) {
  const r = await fetch(`${u}/rest/v1/${ruta}`, { headers: h, ...init });
  const t = await r.text();
  if (!r.ok) throw new Error(`${ruta}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

const ya = await rest(`ed_clientes?select=id&id=eq.${ID}`);
if (!ya.length) {
  await rest("ed_clientes", {
    method: "POST",
    body: JSON.stringify({
      id: ID,
      nombre: "QA Google Ads (cuentas de prueba)",
      rubro: "QA interno de Respondo — software de marketing con IA (no es un cliente)",
      telefono_escalacion: [],
      canal_escalacion: "whatsapp",
      destino_leads: "sheets",
      activo: true,
      slug: "qa-google-ads",
      reservas_online: false,
    }),
  });
  await rest("ed_conocimiento", {
    method: "POST",
    body: JSON.stringify([
      {
        cliente_id: ID,
        categoria: "servicios",
        titulo: "Qué ofrecemos",
        contenido:
          "Tenant QA de Respondo para probar Google Ads contra cuentas de prueba. Respondo: asistentes con IA que atienden, agendan y venden por WhatsApp, y campañas de Búsqueda creadas en pausa. Sitio web: https://respon-do.com",
      },
    ]),
  });
  console.log("TENANT CREADO", ID);
} else console.log("TENANT YA EXISTÍA", ID);

const us = await rest(`portal_usuarios?select=email,cliente_id,rol,activo&email=eq.${encodeURIComponent(EMAIL)}`);
if (!us.length) {
  await rest("portal_usuarios", { method: "POST", body: JSON.stringify({ email: EMAIL, cliente_id: ID, rol: "dueno", activo: true }) });
  console.log("USUARIO QA CREADO", EMAIL);
} else if (us[0].cliente_id !== ID) {
  throw new Error(`${EMAIL} ya pertenece a otro cliente (${us[0].cliente_id}); no se mueve.`);
} else console.log("USUARIO QA YA EXISTÍA", EMAIL);
