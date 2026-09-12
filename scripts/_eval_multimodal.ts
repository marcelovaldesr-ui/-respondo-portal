import "./_env"; // DEBE ir primero: lib/db.ts y lib/gemini.ts leen process.env al importarse
import { readFileSync, existsSync, writeFileSync, readdirSync } from "fs";
import { join, extname } from "path";
import { generarJSON } from "../lib/gemini";
import { armarPrompt } from "../lib/promptEmpleado";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BATERÍA DE EVALUACIÓN DE VALOR — audio y visión (Fase 3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PARA QUÉ EXISTE. Para contestar UNA pregunta con evidencia y no con opinión:
 *
 *     ¿Escuchar o ver esto mejora la conversación lo suficiente frente a
 *      callarse y derivar a una persona?
 *
 * NO es un test. No pasa ni falla: mide. Los tests deterministas
 * (tests/media-interpretacion.test.mjs) ya prueban que el camino es seguro;
 * lo que no pueden probar es si la capacidad SIRVE. Eso necesita el modelo de
 * verdad, y por eso esto es un script y no un `npm test`.
 *
 * ── EL CRITERIO, QUE NO ES EL HABITUAL ─────────────────────────────────────
 *
 * ⚠️ NO se mide exactitud de palabras (WER). Una transcripción con el 96 % de
 * las palabras correctas que cambia «cinco mil» por «quinientas» es un
 * FRACASO, y una con el 70 % que conserva todos los números es utilizable.
 *
 * Cada caso declara sus DATOS CRÍTICOS —los que pueden cambiar una venta— y
 * cada dato termina en uno de tres estados:
 *
 *   PRESERVADO  el valor real aparece.               → se puede seguir.
 *   OMITIDO     no aparece ni el real ni uno falso.  → recuperable: Tino pregunta.
 *   ALTERADO    aparece OTRO valor confundible.      → FRACASO. No hay red abajo.
 *
 * La asimetría es el punto: omitir un número se arregla preguntando; cambiarlo
 * no lo detecta nadie hasta que el cliente reclama por una cotización errada.
 * Por eso UN SOLO dato ALTERADO condena el caso, por bien que salga el resto.
 *
 * ── LAS DOS ETAPAS ─────────────────────────────────────────────────────────
 *
 * ETAPA 1 · fidelidad. Manda el archivo a Gemini con los prompts y el parser
 *   que se habían construido para producción —hoy retirados y conservados acá
 *   abajo, intactos— y puntúa los datos críticos.
 *
 * ETAPA 2 · utilidad (solo audio). Mete la transcripción en el historial —con
 *   `lineaDeHistorial`, como se habría hecho en producción— y corre el prompt
 *   REAL de Tino (`armarPrompt`, que sigue siendo el de producción) contra el
 *   negocio DEMO. Es la que contesta lo que de verdad importa:
 *   ¿Tino cotiza sobre un número mal transcrito, o lo confirma antes?
 *
 * ── GARANTÍAS ──────────────────────────────────────────────────────────────
 *
 *  · No escribe NADA en la base (solo `armarPrompt`, que lee la ficha).
 *  · No manda ningún mensaje: no se importa whatsapp.ts ni waha.ts.
 *  · No toca conversaciones de clientes reales: los archivos son grabaciones
 *    y fotos hechas a propósito, y el negocio es el DEMO.
 *  · La clave de Gemini se lee de .env.local y nunca se imprime.
 *  · **No le agrega nada a producción**: nada de este archivo se importa desde
 *    el portal, y lo único que toma prestado del producto es `armarPrompt` y
 *    `generarJSON` en su forma de solo texto.
 *
 * ── USO ────────────────────────────────────────────────────────────────────
 *
 *     npx tsx scripts/_eval_multimodal.ts            # todo lo que haya
 *     npx tsx scripts/_eval_multimodal.ts audio      # solo audio
 *     npx tsx scripts/_eval_multimodal.ts vision     # solo visión
 *     npx tsx scripts/_eval_multimodal.ts A03 A06    # casos puntuales
 *
 * Los archivos van en scripts/eval-multimodal/muestras/ con los nombres que
 * dice casos.json. Lo que falte se informa y se saltea: la batería corre con
 * lo que haya, así se puede empezar con tres audios.
 *
 * Deja scripts/eval-multimodal/resultado.json (crudo, para revisar después).
 */

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE ANTES VIVÍA EN EL PRODUCTO
// ═══════════════════════════════════════════════════════════════════════════
//
// Estas reglas estaban en `lib/mediaInterpretacionCore.ts` y la llamada con
// adjunto en `lib/gemini.ts`. Al decidir NO-GO se retiraron del árbol
// productivo, así que viven ACÁ, completas.
//
// Es a propósito y no es duplicación: al no existir el original, no hay de qué
// divergir. Y así este script no le agrega ni una línea a la superficie de
// producción — nada de lo que hay abajo se importa desde ningún lado que corra
// para un cliente. Si algún día audio vuelve a evaluarse, esto es exactamente
// lo que había que probar.

const MIMES_IMAGEN = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MIMES_AUDIO = new Set([
  "audio/ogg", "audio/opus", "audio/mpeg", "audio/mp4",
  "audio/aac", "audio/amr", "audio/wav", "audio/webm",
]);
const TOPE_IMAGEN_BYTES = 4 * 1024 * 1024;
const TOPE_AUDIO_BYTES = 8 * 1024 * 1024;

type ClaseInterpretacion = "imagen" | "audio";
type Interpretacion = {
  clase: ClaseInterpretacion;
  texto: string;
  legible: boolean;
  noDeterminado: string[];
};

/** Se le pide DESCRIBIR, no resolver, y declarar qué NO puede determinar. */
function promptDeImagen(caption?: string | null): string {
  const conTexto = (caption ?? "").trim();
  return [
    "Eres el sistema de visión de un asistente comercial de WhatsApp.",
    "Un cliente envió esta imagen a un negocio. Descríbela para que el asistente",
    "pueda seguir la conversación. NO le respondas al cliente ni ofrezcas precios.",
    "",
    conTexto ? `El cliente la mandó con este texto: "${conTexto}"` : "La mandó sin texto.",
    "",
    "Responde SOLO este JSON:",
    "{",
    '  "legible": true|false,',
    '  "descripcion": "qué se ve, en una o dos frases, en español de Chile",',
    '  "texto_visible": "el texto que se lea en la imagen, tal cual, o cadena vacía",',
    '  "no_puedo_determinar": ["material", "medida", ...]',
    "}",
    "",
    "Reglas:",
    '- "legible": false si está borrosa, muy oscura, o no se entiende qué muestra.',
    "- No adivines medidas, materiales, cantidades ni precios. Si no se ve, va en",
    '  "no_puedo_determinar".',
    "- Si es una captura de pantalla de una conversación o de una lista de precios,",
    '  transcribe lo que se lee en "texto_visible".',
    "- No describas personas más allá de lo necesario para el pedido.",
  ].join("\n");
}

/** Transcripción LITERAL, no resumen: en el resumen es donde se pierden los números. */
function promptDeAudio(): string {
  return [
    "Transcribe esta nota de voz enviada por un cliente a un negocio chileno.",
    "",
    "Responde SOLO este JSON:",
    "{",
    '  "legible": true|false,',
    '  "transcripcion": "lo que dice, literal, en español",',
    '  "idioma": "es" u otro',
    "}",
    "",
    "Reglas:",
    '- "legible": false si no se entiende, está vacío, o es solo ruido.',
    "- Transcribe literal. No resumas, no corrijas y no completes lo que falte.",
    "- Los números escríbelos en dígitos (500, no quinientos).",
    "- Si hay tramos que no se entienden, escríbelos como [inaudible].",
  ].join("\n");
}

/** Estricto a propósito: una respuesta a medias es peor que ninguna. */
function leerRespuesta(clase: ClaseInterpretacion, crudo: string): Interpretacion | null {
  let d: Record<string, unknown>;
  try {
    const limpio = crudo.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
    const v: unknown = JSON.parse(limpio);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    d = v as Record<string, unknown>;
  } catch {
    return null;
  }
  const legible = d.legible !== false;
  const noDeterminado = Array.isArray(d.no_puedo_determinar)
    ? d.no_puedo_determinar.filter((x): x is string => typeof x === "string").slice(0, 8)
    : [];
  if (clase === "audio") {
    const t = typeof d.transcripcion === "string" ? d.transcripcion.trim() : "";
    if (!legible || !t) return { clase, texto: "", legible: false, noDeterminado: [] };
    return { clase, texto: t.slice(0, 4000), legible: true, noDeterminado: [] };
  }
  const desc = typeof d.descripcion === "string" ? d.descripcion.trim() : "";
  const visible = typeof d.texto_visible === "string" ? d.texto_visible.trim() : "";
  if (!legible || (!desc && !visible)) return { clase, texto: "", legible: false, noDeterminado };
  const partes = [desc];
  if (visible) partes.push(`Texto en la imagen: «${visible}»`);
  return { clase, texto: partes.join(" ").slice(0, 4000), legible: true, noDeterminado };
}

/** ⭐ La interpretación entra como DEDUCCIÓN, nunca como palabras del cliente. */
function lineaDeHistorial(i: Interpretacion): string {
  if (!i.legible) {
    return i.clase === "audio" ? "[audio que no se pudo transcribir]" : "[imagen que no se pudo interpretar]";
  }
  if (i.clase === "audio") return `[nota de voz, transcrita] ${i.texto}`;
  const falta = i.noDeterminado.length
    ? ` [por la imagen no se puede determinar: ${i.noDeterminado.join(", ")}]`
    : "";
  return `[imagen, descrita por el sistema] ${i.texto}${falta}`;
}

/**
 * Llamada a Gemini con archivos adjuntos.
 *
 * Va directo contra la API en vez de pasar por `lib/gemini.ts`: ese archivo
 * volvió a ser solo-texto al retirar multimedia, y no se le va a reabrir una
 * puerta para un script de medición. El texto va PRIMERO y los archivos
 * después, que es el orden que recomienda Google.
 */
async function llamarConAdjuntos(
  prompt: string,
  adjuntos: { mime: string; base64: string }[],
  timeoutMs = 30_000,
): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY");
  const modelo = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${key}`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                ...adjuntos.map((a) => ({ inline_data: { mime_type: a.mime, data: a.base64 } })),
              ],
            },
          ],
          generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
        }),
      },
    );
    if (!r.ok) throw new Error(`${modelo}: HTTP ${r.status}`);
    const d = (await r.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const texto = d?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!texto) throw new Error(`${modelo}: respuesta vacía`);
    return texto;
  } finally {
    clearTimeout(timer);
  }
}

const DIR = join(__dirname, "eval-multimodal");
const MUESTRAS = join(DIR, "muestras");

/** Negocio DEMO — los mismos ids que usa scripts/_test_modismos.ts. */
const CID = process.env.EVAL_CLIENTE_ID || "33333333-3333-3333-3333-333333333333";
const TINO = process.env.EVAL_EMPLEADO_ID || "a3333333-0000-0000-0000-000000000001";

type Critico = {
  dato: string;
  valor: string;
  acepta: string[];
  confundible: string[];
  solo_debe_aparecer?: boolean;
};
type CasoAudio = {
  id: string;
  archivo: string;
  guion: string;
  condiciones: string[];
  criticos: Critico[];
  nota?: string;
  contexto_previo?: { rol: "cliente" | "empleado" | "humano"; texto: string }[];
  texto_posterior?: string;
};
type CasoVision = {
  id: string;
  archivo: string | string[];
  caption: string | null;
  que_fotografiar: string;
  preguntas_sin_vision: string[];
  evitables_con_vision: string[];
  nota?: string;
};

const MIME_POR_EXT: Record<string, string> = {
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".oga": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".amr": "audio/amr",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};

/**
 * Normaliza para comparar: sin acentos, sin mayúsculas, y con los números
 * "desformateados" (5.000 · 5 000 · 5,000 → 5000).
 *
 * Lo de los números importa más de lo que parece: el modelo escribe «5.000» y
 * el caso declara «5000». Sin esta normalización se contaría como OMITIDO un
 * dato que en realidad está perfecto.
 */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\d)[.,\s](\d{3})\b/g, "$1$2")
    .replace(/(\d)[.,\s](\d{3})\b/g, "$1$2") // dos pasadas: 1.500.000
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿Aparece la aguja?
 *
 * Para agujas numéricas se exige límite de token, si no «500» daría positivo
 * dentro de «5000» y todos los casos difíciles pasarían por error.
 */
function contiene(texto: string, aguja: string): boolean {
  const t = norm(texto);
  const a = norm(aguja);
  if (!a) return false;
  if (/^[\d\sx.,]+$/.test(a)) {
    const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    return new RegExp(`(^|[^\\dx])${esc}($|[^\\dx])`, "i").test(` ${t} `);
  }
  return t.includes(a);
}

type EstadoDato = "PRESERVADO" | "OMITIDO" | "ALTERADO";

function puntuar(texto: string, c: Critico): { dato: string; estado: EstadoDato; detalle: string } {
  const agujas = [c.valor, ...c.acepta];
  const esta = agujas.some((a) => contiene(texto, a));
  const falso = c.confundible.find((a) => contiene(texto, a));

  // El orden importa: si aparecen los dos, gana la alerta. Una transcripción
  // que dice «quinientas... cinco mil» deja a Tino eligiendo, y eso hay que
  // mirarlo a mano.
  if (falso && !esta) return { dato: c.dato, estado: "ALTERADO", detalle: `dice "${falso}" en vez de "${c.valor}"` };
  if (falso && esta) return { dato: c.dato, estado: "ALTERADO", detalle: `aparecen los dos: "${c.valor}" y "${falso}"` };
  if (esta) return { dato: c.dato, estado: "PRESERVADO", detalle: c.valor };
  return { dato: c.dato, estado: "OMITIDO", detalle: `falta "${c.valor}"` };
}

function leerMuestra(nombre: string): { mime: string; base64: string; bytes: number } | null {
  const ruta = join(MUESTRAS, nombre);
  if (!existsSync(ruta)) return null;
  const buf = readFileSync(ruta);
  const mime = MIME_POR_EXT[extname(nombre).toLowerCase()] ?? "application/octet-stream";
  return { mime, base64: buf.toString("base64"), bytes: buf.byteLength };
}

/** Nombre real del archivo: acepta cualquier extensión con el mismo tronco. */
function resolver(nombre: string): string | null {
  if (existsSync(join(MUESTRAS, nombre))) return nombre;
  const tronco = nombre.replace(/\.[^.]+$/, "");
  const hay = readdirSync(MUESTRAS).find((f) => f.replace(/\.[^.]+$/, "") === tronco);
  return hay ?? null;
}

// ── ETAPA 1 ─────────────────────────────────────────────────────────────────

async function etapa1(
  clase: "audio" | "imagen",
  archivos: string[],
  caption: string | null,
): Promise<{ ok: boolean; texto: string; legible: boolean; noDeterminado: string[]; ms: number; error?: string; crudo?: string }> {
  const partes: { mime: string; base64: string }[] = [];
  for (const a of archivos) {
    const m = leerMuestra(a);
    if (!m) return { ok: false, texto: "", legible: false, noDeterminado: [], ms: 0, error: `falta ${a}` };
    const permitidos = clase === "audio" ? MIMES_AUDIO : MIMES_IMAGEN;
    if (!permitidos.has(m.mime)) {
      return { ok: false, texto: "", legible: false, noDeterminado: [], ms: 0, error: `mime no soportado: ${m.mime}` };
    }
    const tope = clase === "audio" ? TOPE_AUDIO_BYTES : TOPE_IMAGEN_BYTES;
    if (m.bytes > tope) {
      return { ok: false, texto: "", legible: false, noDeterminado: [], ms: 0, error: `pesa ${(m.bytes / 1048576).toFixed(1)} MB, tope ${tope / 1048576} MB` };
    }
    partes.push({ mime: m.mime, base64: m.base64 });
  }

  const prompt = clase === "audio" ? promptDeAudio() : promptDeImagen(caption);
  const t0 = Date.now();
  let crudo = "";
  try {
    crudo = await llamarConAdjuntos(prompt, partes);
  } catch (e) {
    return { ok: false, texto: "", legible: false, noDeterminado: [], ms: Date.now() - t0, error: (e as Error).message };
  }
  const ms = Date.now() - t0;
  const i = leerRespuesta(clase, crudo);
  if (!i) return { ok: false, texto: "", legible: false, noDeterminado: [], ms, error: "respuesta ilegible del modelo", crudo };
  return { ok: true, texto: i.texto, legible: i.legible, noDeterminado: i.noDeterminado, ms, crudo };
}

// ── ETAPA 2 (audio) ─────────────────────────────────────────────────────────

/**
 * ¿Qué hace Tino con esa transcripción?
 *
 * Se arma el historial EXACTAMENTE como en producción: el marcador del audio
 * sigue ahí y la transcripción va detrás, marcada como deducción del sistema
 * (`lineaDeHistorial`). Si acá se pegara la transcripción como si el cliente la
 * hubiera escrito, la prueba mediría otra cosa: un mundo donde Tino confía
 * ciegamente, que es justo el que no queremos.
 */
async function etapa2(
  caso: CasoAudio,
  transcripcion: string,
): Promise<{ respuesta: string; escalar: boolean; accion: string; ms: number; error?: string }> {
  const hist: { rol: "cliente" | "empleado" | "humano"; texto: string }[] = [
    ...(caso.contexto_previo ?? []),
    {
      rol: "cliente",
      texto:
        "[el cliente envió un audio]\n  ↳ " +
        lineaDeHistorial({ clase: "audio", texto: transcripcion, legible: true, noDeterminado: [] }),
    },
  ];
  if (caso.texto_posterior) hist.push({ rol: "cliente", texto: caso.texto_posterior });

  const t0 = Date.now();
  const prompt = await armarPrompt(CID, TINO, hist);
  if (!prompt) return { respuesta: "", escalar: false, accion: "", ms: 0, error: "armarPrompt devolvió null (¿existe el negocio demo?)" };
  try {
    const d = JSON.parse(await generarJSON(prompt, { intentosPorModelo: 1 }));
    return {
      respuesta: String(d.respuesta ?? ""),
      escalar: d.escalar === true,
      accion: String(d.accion ?? "-"),
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { respuesta: "", escalar: false, accion: "", ms: Date.now() - t0, error: (e as Error).message };
  }
}

/** ¿La respuesta de Tino confirma los datos críticos en vez de darlos por ciertos? */
function confirma(respuesta: string, criticos: Critico[]): boolean {
  const r = norm(respuesta);
  const pregunta = /\?|confirm|me confirmas|seria|serian|entendi|correcto|esta bien/.test(r);
  const menciona = criticos.some((c) => [c.valor, ...c.acepta].some((a) => contiene(respuesta, a)));
  return pregunta && menciona;
}

// ── INFORME ─────────────────────────────────────────────────────────────────

const C = {
  ok: (s: string) => `\x1b[32m${s}\x1b[0m`,
  mal: (s: string) => `\x1b[31m${s}\x1b[0m`,
  med: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};
const pinta = (e: EstadoDato) => (e === "PRESERVADO" ? C.ok(e) : e === "OMITIDO" ? C.med(e) : C.mal(e));

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error(
      "\nFalta GEMINI_API_KEY.\n\n" +
        "Es la misma que ya usa el portal. Si está en .env.local, este script la lee\n" +
        "solo; si no, agrégala a .env.local (NO la pegues en la terminal ni en un chat).\n",
    );
    process.exit(1);
  }

  const casos = JSON.parse(readFileSync(join(DIR, "casos.json"), "utf8")) as {
    audio: CasoAudio[];
    vision: CasoVision[];
  };
  const arg = process.argv.slice(2).map((a) => a.toLowerCase());
  const soloAudio = arg.includes("audio");
  const soloVision = arg.includes("vision") || arg.includes("visión");
  const filtros = arg.filter((a) => !["audio", "vision", "visión"].includes(a));
  const pasa = (id: string) => !filtros.length || filtros.some((f) => id.toLowerCase().includes(f));

  const salida: Record<string, unknown> = { corrido: new Date().toISOString(), modelo: process.env.GEMINI_MODEL || "gemini-2.5-flash", audio: [], vision: [] };

  // ── AUDIO ────────────────────────────────────────────────────────────────
  if (!soloVision) {
    console.log("\n" + "═".repeat(78));
    console.log("AUDIO · ¿se conservan los datos que pueden cambiar una venta?");
    console.log("═".repeat(78));

    for (const caso of casos.audio) {
      if (!pasa(caso.id)) continue;
      const archivo = resolver(caso.archivo);
      if (!archivo) {
        console.log(`\n${caso.id}  ${C.dim("— sin grabar (falta " + caso.archivo + ")")}`);
        (salida.audio as unknown[]).push({ id: caso.id, estado: "SIN_MUESTRA" });
        continue;
      }

      const r = await etapa1("audio", [archivo], null);
      console.log(`\n${caso.id}  ${C.dim("[" + caso.condiciones.join(", ") + "]")}`);
      console.log(`  guion        ${C.dim(caso.guion.slice(0, 100))}`);
      if (!r.ok) {
        console.log(`  ${C.mal("FALLO TÉCNICO")}  ${r.error}`);
        (salida.audio as unknown[]).push({ id: caso.id, estado: "FALLO_TECNICO", error: r.error });
        continue;
      }
      if (!r.legible) {
        // Un "no se entiende" honesto NO es un fallo: es el fallback funcionando.
        console.log(`  ${C.med("ILEGIBLE (honesto)")}  el modelo dijo que no pudo → deriva, lo escucha una persona  ${C.dim(r.ms + " ms")}`);
        (salida.audio as unknown[]).push({ id: caso.id, estado: "ILEGIBLE_HONESTO", ms: r.ms });
        continue;
      }

      console.log(`  transcripción ${r.texto.slice(0, 220)}`);
      const notas = caso.criticos.map((c) => puntuar(r.texto, c));
      for (const n of notas) console.log(`    · ${n.dato.padEnd(22)} ${pinta(n.estado)}  ${C.dim(n.detalle)}`);

      const alterados = notas.filter((n) => n.estado === "ALTERADO");
      const omitidos = notas.filter((n) => n.estado === "OMITIDO");

      let e2: Awaited<ReturnType<typeof etapa2>> | null = null;
      if (!filtros.includes("sin-etapa2")) {
        e2 = await etapa2(caso, r.texto);
        if (e2.error) console.log(`  ${C.med("etapa 2 no corrió")}  ${e2.error}`);
        else {
          console.log(`  TINO → ${e2.respuesta.slice(0, 300)}`);
          console.log(`  ${C.dim(`escalar=${e2.escalar} accion=${e2.accion} ${e2.ms} ms`)}`);
        }
      }

      const confirmo = e2 && !e2.error ? confirma(e2.respuesta, caso.criticos) : false;
      const veredicto = alterados.length
        ? "NO_GO"
        : omitidos.length || !confirmo
          ? "GO_CON_CONFIRMACION"
          : "GO";
      const razon = alterados.length
        ? `dato crítico ALTERADO (${alterados.map((a) => a.dato).join(", ")})`
        : omitidos.length
          ? `faltan datos (${omitidos.map((a) => a.dato).join(", ")}) — Tino tiene que preguntarlos`
          : confirmo
            ? "todo preservado y Tino confirmó antes de avanzar"
            : "todo preservado, pero Tino NO confirmó: hay que exigirlo en el prompt";
      console.log(`  ⇒ ${veredicto === "NO_GO" ? C.mal(veredicto) : veredicto === "GO" ? C.ok(veredicto) : C.med(veredicto)}  ${C.dim(razon)}`);
      console.log(`  ${C.dim(`latencia etapa1 ${r.ms} ms${e2 && !e2.error ? ` · etapa2 ${e2.ms} ms · total ${r.ms + e2.ms} ms` : ""}`)}`);

      (salida.audio as unknown[]).push({
        id: caso.id, estado: "EVALUADO", veredicto, razon,
        transcripcion: r.texto, datos: notas, msEtapa1: r.ms,
        tino: e2 && !e2.error ? { respuesta: e2.respuesta, escalar: e2.escalar, accion: e2.accion, ms: e2.ms, confirmo } : null,
      });
    }
  }

  // ── VISIÓN ───────────────────────────────────────────────────────────────
  if (!soloAudio) {
    console.log("\n" + "═".repeat(78));
    console.log("VISIÓN · ¿ver la imagen evita preguntas que Tino igual tendría que hacer?");
    console.log("═".repeat(78));

    /** Los datos que visión NUNCA puede afirmar como hecho (§11 del brief). */
    const PROHIBIDO = ["gramaje", "gr/m", "grs", "couché", "couche", "opalina", "pvc", "milimetros", "milímetros", "centimetros", "centímetros", " cm", "unidades", "$", "precio", "stock", "disponible"];

    for (const caso of casos.vision) {
      if (!pasa(caso.id)) continue;
      const pedidos = Array.isArray(caso.archivo) ? caso.archivo : [caso.archivo];
      const archivos = pedidos.map(resolver).filter((x): x is string => !!x);
      if (archivos.length !== pedidos.length) {
        console.log(`\n${caso.id}  ${C.dim("— sin foto (falta " + pedidos.join(", ") + ")")}`);
        (salida.vision as unknown[]).push({ id: caso.id, estado: "SIN_MUESTRA" });
        continue;
      }

      const r = await etapa1("imagen", archivos, caso.caption);
      console.log(`\n${caso.id}  ${C.dim(caso.que_fotografiar.slice(0, 90))}`);
      if (caso.caption) console.log(`  caption      "${caso.caption}"`);
      if (!r.ok) {
        console.log(`  ${C.mal("FALLO TÉCNICO")}  ${r.error}`);
        (salida.vision as unknown[]).push({ id: caso.id, estado: "FALLO_TECNICO", error: r.error });
        continue;
      }
      if (!r.legible) {
        console.log(`  ${C.ok("ILEGIBLE (honesto)")}  el modelo dijo que no pudo  ${C.dim(r.ms + " ms")}`);
        (salida.vision as unknown[]).push({ id: caso.id, estado: "ILEGIBLE_HONESTO", ms: r.ms, esperado: caso.evitables_con_vision.length === 0 });
        continue;
      }

      console.log(`  descripción  ${r.texto.slice(0, 300)}`);
      console.log(`  no determina ${r.noDeterminado.join(", ") || C.med("(NADA — sospechoso: una foto casi nunca dice el material)")}`);

      // ¿Afirmó como hecho algo que no se puede ver? Solo cuenta si NO lo puso
      // además en no_puedo_determinar.
      const declarado = norm(r.noDeterminado.join(" "));
      const inventos = PROHIBIDO.filter((p) => contiene(r.texto, p) && !declarado.includes(norm(p).trim()));

      // Lo único que decide: de las preguntas que Tino haría sin ver la foto,
      // ¿cuántas quedaron respondidas por la descripción?
      const evitadas = caso.evitables_con_vision.filter((q) => {
        const clave = norm(q).split(" ").filter((w) => w.length > 3);
        return clave.some((w) => norm(r.texto).includes(w)) || (q.includes("producto") && r.texto.length > 25);
      });

      if (inventos.length) console.log(`  ${C.mal("AFIRMA SIN PODER VER")}  ${inventos.join(", ")}`);
      console.log(`  preguntas    sin visión ${caso.preguntas_sin_vision.length} · evitadas ${evitadas.length} (${evitadas.join(", ") || "ninguna"})`);

      const veredicto = inventos.length ? "NO_GO" : evitadas.length >= 2 ? "GO" : evitadas.length === 1 ? "MARGINAL" : "NO_GO_POR_IRRELEVANCIA";
      const razon = inventos.length
        ? `afirma como hecho lo que no se puede ver: ${inventos.join(", ")}`
        : evitadas.length >= 2
          ? `evita ${evitadas.length} de ${caso.preguntas_sin_vision.length} preguntas`
          : evitadas.length === 1
            ? "evita 1 pregunta de " + caso.preguntas_sin_vision.length + ": hay que decidir si eso paga el costo"
            : "descripción correcta pero Tino tiene que preguntar exactamente lo mismo que sin verla";
      console.log(`  ⇒ ${veredicto === "GO" ? C.ok(veredicto) : veredicto === "MARGINAL" ? C.med(veredicto) : C.mal(veredicto)}  ${C.dim(razon)}`);
      console.log(`  ${C.dim("latencia " + r.ms + " ms")}`);

      (salida.vision as unknown[]).push({
        id: caso.id, estado: "EVALUADO", veredicto, razon,
        descripcion: r.texto, noDeterminado: r.noDeterminado, inventos, evitadas, ms: r.ms,
      });
    }
  }

  // ── RESUMEN ──────────────────────────────────────────────────────────────
  const resumir = (xs: { estado?: string; veredicto?: string }[]) => {
    const c: Record<string, number> = {};
    for (const x of xs) {
      const k = x.estado === "EVALUADO" ? (x.veredicto as string) : (x.estado as string);
      c[k] = (c[k] ?? 0) + 1;
    }
    return Object.entries(c).map(([k, v]) => `${k}=${v}`).join("  ");
  };
  console.log("\n" + "═".repeat(78));
  console.log("RESUMEN");
  console.log("═".repeat(78));
  console.log(`AUDIO   ${resumir(salida.audio as never) || "(nada corrido)"}`);
  console.log(`VISIÓN  ${resumir(salida.vision as never) || "(nada corrido)"}`);
  console.log(
    "\nREGLA DE CIERRE: un solo dato crítico ALTERADO en cantidad, medida, precio o\n" +
      "fecha alcanza para NO_GO de audio. En visión, 'correcto pero irrelevante' también\n" +
      "es NO_GO: la capacidad tiene que ahorrar trabajo, no parecer inteligente.\n",
  );

  const ruta = join(DIR, "resultado.json");
  writeFileSync(ruta, JSON.stringify(salida, null, 2));
  console.log(`Crudo en ${ruta}\n`);
}

main().then(() => process.exit(0));
