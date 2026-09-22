/**
 * Borrador de campaña de Búsqueda para el E2E de Google Ads en el tenant QA
 * (66666666-…). Plan determinista (sin modelo) para que la prueba sea
 * reproducible. Idempotente por nombre dentro del tenant QA. SOLO el tenant QA.
 *   node scripts/_qa_borrador_google.mjs
 */
const QA = "66666666-6666-6666-6666-666666666666";
const NOMBRE = "TEST_GOOGLE";
const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json", Prefer: "return=representation" };
const rest = async (r, i = {}) => { const x = await fetch(`${u}/rest/v1/${r}`, { headers: h, ...i }); const t = await x.text(); if (!x.ok) throw new Error(`${r}: ${x.status} ${t.slice(0, 300)}`); return t ? JSON.parse(t) : null; };

const monto = (valor) => ({ valor, moneda: "CLP" });
const grupo = {
  nombre: "Asistente WhatsApp pymes",
  palabras: [
    { texto: "asistente whatsapp para empresas", concordancia: "frase" },
    { texto: "chatbot whatsapp pymes", concordancia: "frase" },
    { texto: "automatizar ventas whatsapp", concordancia: "exacta" },
  ],
  negativasSugeridas: [],
  titulares: ["Asistente para pymes", "Responde en segundos", "Agenda automática", "Ventas por WhatsApp"],
  descripciones: [
    "Atiende, agenda y vende por WhatsApp con implementación acompañada.",
    "Hecho en Chile para pymes. Pide una demo sin compromiso.",
  ],
};
const plan = {
  objetivoNegocio: "QA: validar publicación de Google Search en cuenta de prueba",
  presupuestoMensual: monto(60000),
  moneda: "CLP",
  piso: null,
  duracionDias: 30,
  estrategiaCanal: [{ canal: "google", parte: 1, porQue: "QA de Google Ads" }],
  campanas: [{ canal: "google", nombre: NOMBRE, objetivo: "SEARCH", presupuestoDiario: monto(2000), destino: "sitio_web", destinoDetalle: "https://respon-do.com", conjuntos: [], grupos: [grupo] }],
  angulos: [],
  tracking: { utm: null, loQueSeMide: [], loQueNoSeMide: [] },
  hipotesis: { enunciado: "QA", senalPrincipal: "IDs reales devueltos por Google", senalesSecundarias: [], senalRespondo: null },
  advertencias: ["Fixture de QA en cuenta de PRUEBA de Google Ads: no sirve anuncios ni gasta."],
};

const ya = await rest(`ed_mk_campanas?select=id,estado,google_campaign_id&cliente_id=eq.${QA}&nombre=eq.${NOMBRE}`);
if (ya.length) { console.log("YA EXISTE", JSON.stringify(ya[0])); process.exit(0); }
const [fila] = await rest("ed_mk_campanas", {
  method: "POST",
  body: JSON.stringify({
    cliente_id: QA, nombre: NOMBRE, objetivo: "trafico", presupuesto_diario: 2000, moneda: "CLP", destino: "sitio_web",
    copies: grupo.titulares.slice(0, 2).map((t, i) => ({ titular: t, texto: grupo.descripciones[i], cta: "Más información" })),
    estado: "lista", canal: "google", plan,
  }),
});
console.log("BORRADOR", fila.id);
