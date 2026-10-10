import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { limitarDistribuido } from "@/lib/seguridad";
import { configPorCliente, enviarPlantilla, tinoDe } from "@/lib/whatsapp";
import { asegurarContacto } from "@/lib/contactoEntrante";
import { guardarMensaje } from "@/lib/mensajes";
import { esSoloMensajeria } from "@/lib/soloMensajeria";
import {
  plantillaKambak,
  prepararVariables,
  textoDe,
  type PlantillaKambak,
} from "@/lib/plantillasKambak";

/**
 * ENVÍOS POR API PARA CUENTAS DE SOLO MENSAJERÍA (Kambak).
 *
 * El sistema de Kambak pide «mándale esta plantilla a este número» y el portal
 * decide si sale. Esta es la SEGUNDA barrera: Kambak ya filtra por consentimiento
 * y por local; acá se vuelve a revisar lo que no puede dejar de revisarse.
 *
 *   1. Solo cuentas marcadas «solo mensajería» (esta API no sirve a otros clientes).
 *   2. Solo plantillas del catálogo de Kambak, con sus variables completas.
 *   3. Solo celulares chilenos (+56 9 y 8 dígitos).
 *   4. Idempotencia: la misma `idempotencyKey` nunca envía dos veces.
 *   5. Baja: un número que dijo BAJA (etiqueta `no_contactar`) no recibe
 *      plantillas de utility ni de marketing. El código de verificación
 *      (authentication) SÍ sale: lo pidió la persona en ese momento.
 *   6. Horario: marketing y utility solo entre 9:00 y 21:00 de Chile; fuera de
 *      horario quedan EN COLA hasta las 9:00 (las despacha el cron). El código
 *      sale siempre.
 *   7. Tope mensual por número (solo marketing). Por defecto 4;
 *      RESPONDO_TOPE_MENSUAL_MARKETING lo cambia sin tocar código.
 *
 * MODO SIMULADO: con RESPONDO_ENVIOS_SIMULADOS=1 se hace todo igual salvo la
 * llamada a Meta (el id de mensaje sale como «sim.…»). Sirve para probar el
 * circuito completo sin mandar nada real.
 *
 * QUÉ SE GUARDA: en `ed_envios_api` solo plantilla, estado y una huella del
 * número. El teléfono y las variables se guardan únicamente mientras el envío
 * espera en cola y se borran al terminar.
 */

export const ZONA = "America/Santiago";
export const HORA_DESDE = 9;
export const HORA_HASTA = 21; // exclusivo: a las 21:00 ya no sale

const TOPE_POR_DEFECTO = 4;

export function topeMensual(): number {
  const n = Number(process.env.RESPONDO_TOPE_MENSUAL_MARKETING);
  return Number.isInteger(n) && n > 0 ? n : TOPE_POR_DEFECTO;
}

export function simulado(): boolean {
  return process.env.RESPONDO_ENVIOS_SIMULADOS === "1";
}

/** Celular chileno → "569XXXXXXXX", o null si no calza. */
export function normalizarCelularCL(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const limpio = raw.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  return /^569\d{8}$/.test(limpio) ? limpio : null;
}

export function huellaTelefono(clienteId: string, telefono: string): string {
  return createHash("sha256").update(`${clienteId}:${telefono}`).digest("hex");
}

function partesChile(fecha: Date): { hora: number; mes: string } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA, year: "numeric", month: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(fecha);
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return { hora: Number(g("hour")), mes: `${g("year")}-${g("month")}` };
}

export function mesChile(fecha: Date): string {
  return partesChile(fecha).mes;
}

export function enHorarioPermitido(fecha: Date): boolean {
  const { hora } = partesChile(fecha);
  return hora >= HORA_DESDE && hora < HORA_HASTA;
}

/** Primer instante (en el borde de 15 min) con hora de Chile 9:00 en adelante. */
export function proximaVentana(fecha: Date): Date {
  const paso = 15 * 60_000;
  let t = new Date(Math.floor(fecha.getTime() / paso) * paso);
  for (let i = 0; i < 200; i++) {
    t = new Date(t.getTime() + paso);
    if (enHorarioPermitido(t)) return t;
  }
  return new Date(fecha.getTime() + 12 * 3_600_000);
}

type Resultado = { status: number; cuerpo: Record<string, unknown> };
const res = (status: number, cuerpo: Record<string, unknown>): Resultado => ({ status, cuerpo });

type FilaEnvio = {
  id: string;
  estado: string;
  motivo?: string | null;
};

function aVista(f: FilaEnvio): Record<string, unknown> {
  const status = f.estado === "enviado" ? "sent" : f.estado === "en_cola" || f.estado === "enviando" ? "queued"
    : f.estado === "omitido" ? "skipped" : "failed";
  return { ok: true, id: f.id, status, ...(f.motivo ? { reason: f.motivo } : {}) };
}

/** Manda la plantilla (o la simula) y deja el registro en la conversación. */
async function despachar(
  p: PlantillaKambak,
  clienteId: string,
  telefono: string,
  params: string[],
): Promise<{ ok: boolean; wamid?: string; error?: string }> {
  let wamid: string | undefined;
  if (simulado()) {
    wamid = `sim.${createHash("sha1").update(`${clienteId}${telefono}${Date.now()}${Math.random()}`).digest("hex").slice(0, 16)}`;
  } else {
    const cfg = await configPorCliente(clienteId);
    if (!cfg) return { ok: false, error: "WhatsApp sin configurar" };
    const r = await enviarPlantilla(cfg, telefono, {
      nombre: p.nombre,
      idioma: p.idioma,
      params,
      ...(p.botonConCodigo ? { botonUrl: params[0] } : {}),
    });
    if (!r.ok) return { ok: false, error: (r.error ?? "error").slice(0, 120) };
    wamid = r.waId;
  }

  // Ya salió: el registro en la bandeja nunca debe convertir el éxito en error.
  try {
    const supa = db();
    const tino = await tinoDe(clienteId);
    if (tino) {
      const nombre = p.categoria === "authentication" ? null : params[0];
      await asegurarContacto(supa, { clienteId, chatId: telefono, nombre, telefono: `+${telefono}` });
      await guardarMensaje(supa, {
        empleadoId: tino, chatId: telefono, rol: "empleado",
        texto: textoDe(p, params), waId: wamid ?? null,
      });
    }
  } catch (e) {
    console.error("[kambak-envios] no se pudo registrar en la conversación:", (e as Error).message);
  }
  return { ok: true, wamid };
}

async function enBaja(clienteId: string, telefono: string): Promise<boolean> {
  const { data } = await db()
    .from("ed_contactos").select("etiquetas")
    .eq("cliente_id", clienteId).eq("chat_id", telefono).maybeSingle();
  return ((data?.etiquetas as string[] | null) ?? []).includes("no_contactar");
}

async function enviosDelMes(clienteId: string, hash: string, mes: string): Promise<number> {
  const { data } = await db()
    .from("ed_envios_api").select("id")
    .eq("cliente_id", clienteId).eq("telefono_hash", hash).eq("mes", mes)
    .eq("categoria", "marketing").in("estado", ["enviado", "en_cola"]);
  return (data ?? []).length;
}

/** POST /api/externo/mensajes (ya autenticado). */
export async function procesarEnvio(
  clienteId: string,
  cuerpo: Record<string, unknown>,
  ahora: Date = new Date(),
): Promise<Resultado> {
  if (!(await esSoloMensajeria(clienteId))) {
    return res(403, { ok: false, error: "Esta API es solo para cuentas de solo mensajería" });
  }

  const clave = cuerpo.idempotencyKey;
  if (typeof clave !== "string" || !/^[A-Za-z0-9_\-:.]{8,128}$/.test(clave)) {
    return res(400, { ok: false, error: "idempotencyKey inválida (8 a 128 caracteres)" });
  }
  const nombrePlantilla = typeof cuerpo.template === "string" ? cuerpo.template : "";
  const p = plantillaKambak(nombrePlantilla);
  if (!p) return res(422, { ok: false, error: "Plantilla no registrada" });
  const idioma = cuerpo.language ?? p.idioma;
  if (idioma !== p.idioma) return res(422, { ok: false, error: `Idioma no registrado para ${p.nombre}` });

  const telefono = normalizarCelularCL(cuerpo.to);
  if (!telefono) return res(422, { ok: false, error: "Número inválido: debe ser celular chileno (+56 9 y 8 dígitos)" });

  const v = prepararVariables(p, cuerpo.variables);
  if (!v.ok) return res(422, { ok: false, error: v.error });

  const supa = db();

  // Idempotencia: misma clave → mismo resultado, sin volver a enviar.
  const { data: previo } = await supa.from("ed_envios_api")
    .select("id, estado, motivo").eq("cliente_id", clienteId).eq("clave", clave).maybeSingle();
  if (previo) return res(200, { ...aVista(previo as FilaEnvio), duplicate: true });

  // Freno por número. Los códigos son el vector típico de abuso (inundar a una
  // persona con SMS/WhatsApp de verificación): tope más estricto y de 10 minutos.
  const hash = huellaTelefono(clienteId, telefono);
  const frenoNumero = p.categoria === "authentication"
    ? await limitarDistribuido(`kambak-cod:${hash}`, 5, 600)
    : await limitarDistribuido(`kambak-num:${hash}`, 20, 60);
  if (!frenoNumero.ok) {
    return res(429, { ok: false, error: "Demasiados envíos seguidos a este número" });
  }

  if (!simulado() && !(await configPorCliente(clienteId))) {
    return res(503, { ok: false, error: "WhatsApp de la cuenta sin configurar" });
  }

  const mes = mesChile(ahora);
  const base = {
    cliente_id: clienteId, clave, plantilla: p.nombre, categoria: p.categoria,
    telefono_hash: hash, mes,
  };

  async function registrar(extra: Record<string, unknown>): Promise<FilaEnvio | null> {
    const { data, error } = await supa.from("ed_envios_api")
      .insert({ ...base, ...extra }).select("id, estado, motivo").single();
    if (error) {
      if (error.code === "23505") { // otra llamada igual ganó la carrera
        const { data: otra } = await supa.from("ed_envios_api").select("id, estado, motivo")
          .eq("cliente_id", clienteId).eq("clave", clave).maybeSingle();
        return (otra as FilaEnvio) ?? null;
      }
      console.error("[kambak-envios] no se pudo registrar:", error.message);
      return null;
    }
    return data as FilaEnvio;
  }

  const exenta = p.categoria === "authentication";

  if (!exenta) {
    if (await enBaja(clienteId, telefono)) {
      const f = await registrar({ estado: "omitido", motivo: "opted_out" });
      return res(200, f ? aVista(f) : { ok: true, status: "skipped", reason: "opted_out" });
    }
    if (p.categoria === "marketing" && (await enviosDelMes(clienteId, hash, mes)) >= topeMensual()) {
      const f = await registrar({ estado: "omitido", motivo: "monthly_cap" });
      return res(200, f ? aVista(f) : { ok: true, status: "skipped", reason: "monthly_cap" });
    }
    if (!enHorarioPermitido(ahora)) {
      const f = await registrar({
        estado: "en_cola", telefono, variables: v.params,
        programado_para: proximaVentana(ahora).toISOString(),
      });
      if (!f) return res(500, { ok: false, error: "No se pudo dejar en cola" });
      return res(200, aVista(f));
    }
  }

  // Se reserva la clave ANTES de enviar: si dos llamadas iguales llegan juntas,
  // solo una pasa de acá.
  // Estado «enviando»: el cron de la cola no lo toca. Si el proceso se cae a
  // medio camino queda así y NO se reintenta (preferimos no enviar a enviar dos).
  const reserva = await registrar({ estado: "enviando", telefono, variables: v.params, programado_para: ahora.toISOString() });
  if (!reserva) return res(500, { ok: false, error: "No se pudo registrar el envío" });
  if (reserva.estado !== "enviando" || reserva.id === undefined) return res(200, { ...aVista(reserva), duplicate: true });

  return finalizar(reserva.id, p, clienteId, telefono, v.params, ahora);
}

async function finalizar(
  id: string, p: PlantillaKambak, clienteId: string, telefono: string, params: string[], ahora: Date,
): Promise<Resultado> {
  const supa = db();
  const r = await despachar(p, clienteId, telefono, params);
  const limpio = { telefono: null, variables: null };
  if (!r.ok) {
    await supa.from("ed_envios_api").update({ ...limpio, estado: "fallido", motivo: r.error ?? "error" }).eq("id", id);
    return res(502, { ok: false, id, status: "failed", reason: r.error ?? "error" });
  }
  await supa.from("ed_envios_api")
    .update({ ...limpio, estado: "enviado", wamid: r.wamid ?? null, enviado_en: ahora.toISOString() })
    .eq("id", id);
  return res(200, { ok: true, id, status: "sent" });
}

/**
 * Despacha lo que quedó en cola (fuera de horario). Lo llama el cron. Si por
 * algún motivo seguimos fuera de horario, no hace nada.
 */
export async function drenarCola(ahora: Date = new Date(), max = 50): Promise<{ enviados: number; fallidos: number; omitidos: number }> {
  const out = { enviados: 0, fallidos: 0, omitidos: 0 };
  const supa = db();
  const { data } = await supa.from("ed_envios_api")
    .select("id, cliente_id, plantilla, categoria, telefono, variables, telefono_hash, mes")
    .eq("estado", "en_cola").lte("programado_para", ahora.toISOString()).limit(max);

  for (const f of data ?? []) {
    const p = plantillaKambak(f.plantilla as string);
    const clienteId = f.cliente_id as string;
    const telefono = f.telefono as string | null;
    const params = f.variables as string[] | null;
    const cerrar = (extra: Record<string, unknown>) =>
      supa.from("ed_envios_api").update({ telefono: null, variables: null, ...extra }).eq("id", f.id);

    if (p && p.categoria !== "authentication" && !enHorarioPermitido(ahora)) continue; // sigue de noche
    // Se reclama la fila: si dos cron corren a la vez, solo uno la toma.
    const { data: tomada } = await supa.from("ed_envios_api")
      .update({ estado: "enviando" }).eq("id", f.id).eq("estado", "en_cola").select("id");
    if (!tomada || tomada.length === 0) continue;

    if (!p || !telefono || !params) { await cerrar({ estado: "fallido", motivo: "datos_incompletos" }); out.fallidos++; continue; }
    if (p.categoria !== "authentication") {
      if (!(await esSoloMensajeria(clienteId))) { await cerrar({ estado: "omitido", motivo: "cuenta_no_habilitada" }); out.omitidos++; continue; }
      if (await enBaja(clienteId, telefono)) { await cerrar({ estado: "omitido", motivo: "opted_out" }); out.omitidos++; continue; }
      // El tope se revisa de nuevo: entre el pedido y la mañana pudo cambiar el mes.
      if (p.categoria === "marketing" && (await enviosDelMes(clienteId, f.telefono_hash as string, mesChile(ahora))) > topeMensual()) {
        await cerrar({ estado: "omitido", motivo: "monthly_cap" }); out.omitidos++; continue;
      }
    }
    const r = await finalizar(f.id as string, p, clienteId, telefono, params, ahora);
    if (r.status === 200) out.enviados++; else out.fallidos++;
  }
  return out;
}
