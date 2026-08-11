/**
 * RESINCRONIZAR EL PUENTE — traer el historial y cerrar huecos.
 *
 * PARA QUÉ SIRVE, DOS COSAS:
 *
 *  1) EL DÍA 1. El puente en vivo solo avisa de lo que pasa de ahora en
 *     adelante. Sin este script, la app del cliente estrena sus pantallas de
 *     leads y reportes en cero, y quien las abre concluye que no funcionan.
 *     (Ya pasó con el embudo: mostraba 55 oportunidades abiertas cuando en
 *     verdad había 7, y el dueño dejó de creerle al panel. El daño de un panel
 *     que miente es que después nadie lo mira.)
 *
 *  2) DESPUÉS. El envío en vivo es best-effort: si la app del cliente estuvo
 *     caída, o la función serverless se cortó antes de terminar el envío, ese
 *     aviso se perdió. Este script se puede correr de nuevo cuando sea: la base
 *     del portal es la fuente de verdad y el receptor es idempotente (el índice
 *     único sobre wa_message_id descarta lo que ya estaba).
 *
 * CÓMO SE CORRE (desde la raíz de respondo-portal):
 *
 *   node --env-file=.env.local scripts/resincronizar-puente.mjs <cliente_id>
 *
 * Opciones:
 *   --desde=2026-07-01   solo mensajes desde esa fecha (por defecto: todo)
 *   --limite=5000        tope de mensajes a procesar (por defecto 5000)
 *   --ritmo=25           envíos en paralelo (por defecto 10)
 *   --seco               no manda nada; solo muestra qué haría
 *
 * Ejemplo para Impresora Color:
 *   node --env-file=.env.local scripts/resincronizar-puente.mjs \
 *     33333333-3333-3333-3333-333333333333 --seco
 *
 * POR QUÉ ES UN SCRIPT Y NO UN ENDPOINT: se corre a mano, dos o tres veces en
 * la vida del cliente, y procesa miles de filas. Un endpoint con eso adentro es
 * un timeout esperando pasar, y además una puerta abierta que hay que proteger.
 */

import { createHmac } from "node:crypto";

// --- Argumentos -------------------------------------------------------------

const args = process.argv.slice(2);
const clienteId = args.find((a) => !a.startsWith("--"));
const opt = (nombre, def) => {
  const a = args.find((x) => x.startsWith(`--${nombre}=`));
  return a ? a.split("=")[1] : def;
};
const seco = args.includes("--seco");
const desde = opt("desde", null);
const limite = Number(opt("limite", 5000));
const ritmo = Number(opt("ritmo", 10));

if (!clienteId) {
  console.error(
    "Falta el cliente_id.\n" +
      "  node --env-file=.env.local scripts/resincronizar-puente.mjs <cliente_id> [--desde=YYYY-MM-DD] [--seco]",
  );
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Usá --env-file=.env.local");
  process.exit(1);
}

// --- Acceso a la base -------------------------------------------------------

async function q(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/**
 * Trae TODAS las filas paginando.
 *
 * La API de Supabase devuelve 1.000 filas como máximo por consulta, y lo hace en
 * silencio: no avisa que truncó. Sin paginar, un negocio con más de mil mensajes
 * quedaría con el historial cortado y nadie se daría cuenta — justo el tipo de
 * error que se descubre meses después mirando un reporte que no cuadra.
 */
async function todas(path, paso = 1000) {
  const out = [];
  for (let desplazamiento = 0; ; desplazamiento += paso) {
    const sep = path.includes("?") ? "&" : "?";
    const lote = await q(`${path}${sep}limit=${paso}&offset=${desplazamiento}`);
    out.push(...lote);
    if (lote.length < paso || out.length >= limite) break;
  }
  return out.slice(0, limite);
}

// --- Clasificador -----------------------------------------------------------
// Se importa el MISMO módulo que usa el puente en vivo. Node 22 puede ejecutar
// TypeScript quitando los tipos, así que no hace falta compilar ni —peor—
// mantener una copia del diccionario acá, que se desincronizaría al primer
// cambio. Si tu Node es anterior a 22.6, corré el script con:
//   npx tsx scripts/resincronizar-puente.mjs ...
const {
  clasificarProducto,
  detectarUrgencia,
  esRuido,
  esNotificacionAutomatica,
  esMensajePreformateado,
} = await import("../lib/clasificadorProducto.ts");

// --- Main -------------------------------------------------------------------

const [cliente] = await q(`ed_clientes?id=eq.${clienteId}&select=id,nombre,rubro`);
if (!cliente) {
  console.error(`No existe el cliente ${clienteId}`);
  process.exit(1);
}

const destinos = await q(
  `ed_integraciones?cliente_id=eq.${clienteId}&activo=is.true&select=id,nombre,url,secreto,eventos`,
);
if (!destinos.length) {
  console.error(
    `${cliente.nombre} no tiene integraciones activas.\n` +
      "Revisá la tabla ed_integraciones (migración 274) antes de resincronizar.",
  );
  process.exit(1);
}

console.log(`Cliente: ${cliente.nombre} (rubro: ${cliente.rubro})`);
console.log(`Destinos: ${destinos.map((d) => d.nombre).join(", ")}`);
if (seco) console.log("MODO SECO: no se manda nada.\n");

const empleados = await q(`ed_empleados?cliente_id=eq.${clienteId}&select=id`);
const ids = empleados.map((e) => e.id);
if (!ids.length) {
  console.error("Ese cliente no tiene empleados digitales; no hay mensajes que traer.");
  process.exit(1);
}

const contactos = await todas(
  `ed_contactos?cliente_id=eq.${clienteId}&select=chat_id,nombre,telefono,etiquetas,etapa,etapa_manual,ultimo_mensaje_en,ultimo_mensaje_rol`,
);
const porChat = new Map(contactos.map((c) => [c.chat_id, c]));
console.log(`Contactos: ${contactos.length}`);

const filtroFecha = desde ? `&creado_en=gte.${desde}` : "";
const mensajes = await todas(
  `ed_mensajes?empleado_id=in.(${ids.join(",")})&rol=eq.cliente${filtroFecha}` +
    `&select=chat_id,rol,texto,wa_message_id,canal,creado_en&order=creado_en.asc`,
);
console.log(`Mensajes de cliente a procesar: ${mensajes.length}\n`);

const firmar = (cuerpo, secreto) =>
  `sha256=${createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex")}`;

/**
 * `simulados` existe aparte de `enviados` por una razón concreta: la primera
 * versión sumaba los del modo seco a `enviados`, y el resumen terminaba diciendo
 * "Enviados: 2222" sin haber mandado nada. Se lee como éxito y hace creer que el
 * trabajo está hecho. Un contador que miente en el caso de prueba es peor que no
 * tenerlo.
 */
const stats = { enviados: 0, simulados: 0, duplicados: 0, descartados: 0, errores: 0, conProducto: 0 };

function armarCuerpo(m) {
  const c = porChat.get(m.chat_id) ?? {};
  const texto = m.texto ?? "";
  const cls = clasificarProducto(texto, cliente.rubro ?? "");
  if (cls.producto) stats.conProducto++;
  return JSON.stringify({
    evento: "mensaje",
    enviadoEn: new Date().toISOString(),
    cliente: { id: clienteId, rubro: cliente.rubro ?? null },
    contacto: {
      chatId: m.chat_id,
      telefono: c.telefono ?? null,
      nombre: c.nombre ?? null,
      canal: m.canal === "instagram" || String(m.chat_id).startsWith("ig:") ? "instagram" : "whatsapp",
      etapa: c.etapa ?? null,
      etapaManual: Boolean(c.etapa_manual),
      etiquetas: c.etiquetas ?? null,
      ultimoMensajeEn: c.ultimo_mensaje_en ?? null,
      ultimoMensajeRol: c.ultimo_mensaje_rol ?? null,
    },
    mensaje: {
      waId: m.wa_message_id ?? null,
      rol: "cliente",
      texto,
      creadoEn: m.creado_en ?? null,
      producto: cls.producto,
      productoTermino: cls.termino,
      productoNoSeHace: cls.noSeHace,
      urgencia: detectarUrgencia(texto),
      ruido: esRuido(texto),
      preformateado: esMensajePreformateado(texto),
      noEsCliente: esNotificacionAutomatica(texto),
    },
  });
}

async function enviar(m) {
  const json = armarCuerpo(m);
  if (seco) {
    stats.simulados++;
    return;
  }
  for (const d of destinos) {
    if (!d.eventos.includes("mensaje")) continue;
    try {
      const res = await fetch(d.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-respondo-firma": firmar(json, d.secreto),
          "x-respondo-evento": "mensaje",
        },
        body: json,
      });
      if (!res.ok) {
        stats.errores++;
        if (stats.errores <= 5) console.warn(`  HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
        continue;
      }
      const r = await res.json().catch(() => ({}));
      if (r.accion === "duplicado") stats.duplicados++;
      else if (String(r.accion ?? "").startsWith("descartado")) stats.descartados++;
      else stats.enviados++;
    } catch (e) {
      stats.errores++;
      if (stats.errores <= 5) console.warn(`  ${e.message}`);
    }
  }
}

// Se manda EN ORDEN CRONOLÓGICO y por tandas.
//
// El orden importa de verdad: el receptor se queda con el PRIMER producto que se
// nombró en cada conversación y con el primer mensaje con contenido como
// referencia. Mandar en desorden dejaría a cada lead con un producto al azar de
// su hilo, y peor: los reportes quedarían plausibles pero equivocados, que es
// más difícil de detectar que un error evidente.
//
// El tope de paralelismo evita que un backfill de miles de mensajes parezca un
// ataque a la app del cliente. Dentro de cada tanda no hay garantía de orden,
// así que se mantiene chica.
for (let i = 0; i < mensajes.length; i += ritmo) {
  const tanda = mensajes.slice(i, i + ritmo);
  await Promise.all(tanda.map(enviar));
  const hechos = Math.min(i + ritmo, mensajes.length);
  if (hechos % 200 < ritmo || hechos === mensajes.length) {
    console.log(`  ${hechos}/${mensajes.length}`);
  }
}

console.log("\n--- Resultado ---");
if (seco) {
  // El aviso va al FINAL además del principio: cuando el proceso tarda minutos,
  // lo que se lee es el resumen, no la primera línea que ya scrolleó.
  console.log(`Se ENVIARIAN:        ${stats.simulados} mensajes`);
  console.log(`Con producto identificado:     ${stats.conProducto}`);
  console.log("\n" + "=".repeat(58));
  console.log("MODO SECO: NO SE ENVIO NADA. Nada cambio en el otro sistema.");
  console.log("Para que entre de verdad, corre el MISMO comando SIN --seco.");
  console.log("=".repeat(58));
} else {
  console.log(`Enviados:            ${stats.enviados}`);
  console.log(`Ya estaban:          ${stats.duplicados}`);
  console.log(`Descartados (no son clientes): ${stats.descartados}`);
  console.log(`Errores:             ${stats.errores}`);
  console.log(`Con producto identificado:     ${stats.conProducto}`);
  if (stats.errores) {
    console.log("\nHubo errores. Se puede correr de nuevo: el receptor descarta lo que ya guardó.");
    process.exit(1);
  }
}
