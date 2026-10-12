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
import {
  canalMarketingDe,
  enviadosEfectivosHoy,
  topeDelDia,
  registrarEnvio as registrarEnvioPool,
  registrarFallo as registrarFalloPool,
  registrarExito as registrarExitoPool,
} from "@/lib/poolNumeros";
import {
  wahaPoolApagado,
  enviarTextoPool,
  existeEnWhatsApp,
  iniciarTipeo,
  pararTipeo,
} from "@/lib/wahaPool";
import { textoWaha } from "@/lib/plantillasKambakPool";
import { emitirEvento } from "@/lib/webhookSalida";

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

/**
 * Cuántos avisos de marketing lleva ese número en el mes.
 *  · Al recibir el pedido cuenta lo enviado, lo que va saliendo y lo que espera
 *    en cola (cada uno ya «gastó» un cupo).
 *  · Al despachar la cola (`excluirId` = la fila que se está despachando) solo
 *    cuenta lo ya enviado o saliendo, sin contarse a sí misma ni a las demás
 *    que esperan: así dos pendientes del mismo número no se bloquean entre sí.
 */
async function enviosDelMes(
  clienteId: string, hash: string, mes: string, excluirId?: string,
): Promise<number> {
  const estados = excluirId ? ["enviado", "enviando"] : ["enviado", "enviando", "en_cola"];
  const { data } = await db()
    .from("ed_envios_api").select("id")
    .eq("cliente_id", clienteId).eq("telefono_hash", hash).eq("mes", mes)
    .eq("categoria", "marketing").in("estado", estados);
  return (data ?? []).filter((f) => (f as { id: string }).id !== excluirId).length;
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

  const canalMkt = await canalMarketingDe(clienteId, supa);

  // Soporte piloto por local / opt-in (P11)
  // Campo opcional en la petición: canalMarketing ('waha' o 'meta')
  const peticionCanalRaw = (cuerpo.canalMarketing ?? cuerpo.canal_marketing ?? "") as string;
  const peticionCanal = peticionCanalRaw === "waha" || peticionCanalRaw === "meta" ? peticionCanalRaw : null;

  let canalDestino: "meta" | "waha" = "meta";
  if (p.categoria === "marketing" && !wahaPoolApagado()) {
    if (canalMkt === "waha") {
      canalDestino = peticionCanal === "meta" ? "meta" : "waha";
    } else if (canalMkt === "waha_opt_in") {
      canalDestino = peticionCanal === "waha" ? "waha" : "meta";
    } else {
      canalDestino = "meta";
    }
  }

  const esWahaMarketing = canalDestino === "waha";

  if (!esWahaMarketing && !simulado() && !(await configPorCliente(clienteId))) {
    return res(503, { ok: false, error: "WhatsApp de la cuenta sin configurar" });
  }

  const mes = mesChile(ahora);
  const metaObj = cuerpo.metadata && typeof cuerpo.metadata === "object" ? (cuerpo.metadata as Record<string, unknown>) : {};
  const origenRef = (
    cuerpo.origen_ref ||
    cuerpo.referencia ||
    cuerpo.local ||
    metaObj.origen_ref ||
    metaObj.local ||
    metaObj.slug ||
    null
  ) as string | null;

  const base = {
    cliente_id: clienteId, clave, plantilla: p.nombre, categoria: p.categoria,
    telefono_hash: hash, mes,
    canal: esWahaMarketing ? "waha" : "meta",
    origen_ref: origenRef,
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
      if (f?.id) {
        await emitirEvento(clienteId, "message.status", `status:${f.id}:opt_out`, {
          id: f.id,
          status: "failed",
          reason: "opt_out",
          error_code: "opt_out",
        }).catch(() => undefined);
      }
      return res(200, f ? aVista(f) : { ok: true, status: "skipped", reason: "opted_out" });
    }
    if (p.categoria === "marketing" && (await enviosDelMes(clienteId, hash, mes)) >= topeMensual()) {
      const f = await registrar({ estado: "omitido", motivo: "monthly_cap" });
      if (f?.id) {
        await emitirEvento(clienteId, "message.status", `status:${f.id}:monthly_cap`, {
          id: f.id,
          status: "failed",
          reason: "monthly_cap",
          error_code: "monthly_cap",
        }).catch(() => undefined);
      }
      return res(200, f ? aVista(f) : { ok: true, status: "skipped", reason: "monthly_cap" });
    }
    // Desvío WAHA: marketing por WAHA siempre queda en cola (el pool lo despacha rotando números con pausas)
    if (esWahaMarketing) {
      const f = await registrar({
        estado: "en_cola",
        canal: "waha",
        telefono,
        variables: v.params,
        programado_para: ahora.toISOString(),
      });
      if (!f) return res(500, { ok: false, error: "No se pudo dejar en cola" });
      return res(200, aVista(f));
    }
    if (!enHorarioPermitido(ahora)) {
      const f = await registrar({
        estado: "en_cola", canal: "meta", telefono, variables: v.params,
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
  const reserva = await registrar({ estado: "enviando", canal: "meta", telefono, variables: v.params, programado_para: ahora.toISOString() });
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
    .select("id, cliente_id, plantilla, categoria, telefono, variables, telefono_hash, mes, canal")
    .eq("estado", "en_cola").lte("programado_para", ahora.toISOString()).limit(max);

  const inicio = Date.now();
  for (const f of data ?? []) {
    if (Date.now() - inicio > 25_000) break; // el resto sale en la próxima pasada del cron

    // Si la fila fue encolada para WAHA y el pool sigue activo, la atiende drenarColaWaha.
    // Si se activó el kill switch o el cliente volvió a 'meta', sale por Meta acá.
    const canalRow = (f.canal as string | null) ?? "meta";
    if (canalRow === "waha" && !wahaPoolApagado()) {
      const canalActual = await canalMarketingDe(f.cliente_id as string, supa);
      if (canalActual === "waha" || canalActual === "waha_opt_in") continue;
    }

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
      if (p.categoria === "marketing" && (await enviosDelMes(clienteId, f.telefono_hash as string, mesChile(ahora), f.id as string)) >= topeMensual()) {
        await cerrar({ estado: "omitido", motivo: "monthly_cap" }); out.omitidos++; continue;
      }
    }
    const r = await finalizar(f.id as string, p, clienteId, telefono, params, ahora);
    if (r.status === 200) out.enviados++; else out.fallidos++;
  }
  return out;
}

/**
 * Intercala filas pendientes según su local (origen_ref) en estilo round-robin.
 * Evita que un local con 300 envíos monopolice todos los chips y bloquee a otro local.
 */
export function intercalarPorOrigenRef<T extends { origen_ref?: string | null }>(
  filas: T[],
): T[] {
  const grupos = new Map<string, T[]>();
  for (const f of filas) {
    const clave = f.origen_ref || "_sin_ref";
    const lista = grupos.get(clave) || [];
    lista.push(f);
    grupos.set(clave, lista);
  }

  const resultado: T[] = [];
  const listas = Array.from(grupos.values());
  let maxLen = 0;
  for (const l of listas) {
    if (l.length > maxLen) maxLen = l.length;
  }

  for (let i = 0; i < maxLen; i++) {
    for (const l of listas) {
      if (i < l.length) {
        resultado.push(l[i]);
      }
    }
  }

  return resultado;
}

/**
 * Reaper: filas en estado 'enviando' por más de 3 min sin wamid -> estado_incierto;
 * con wamid -> enviado. Corre al inicio de cada pasada del cron.
 */
export async function reaperEnviosWaha(
  supa = db(),
  ahora = new Date(),
): Promise<{ recuperados: number; inciertos: number }> {
  const limiteMs = ahora.getTime() - 3 * 60 * 1000;
  const { data: atascados } = await supa
    .from("ed_envios_api")
    .select("id, cliente_id, wamid, estado, actualizado_en, programado_para")
    .eq("canal", "waha")
    .eq("estado", "enviando");

  let recuperados = 0;
  let inciertos = 0;

  for (const f of atascados ?? []) {
    const fechaRef = (f.actualizado_en || f.programado_para) as string | null;
    if (fechaRef && Date.parse(fechaRef) < limiteMs) {
      if (f.wamid) {
        await supa
          .from("ed_envios_api")
          .update({ estado: "enviado", telefono: null, variables: null })
          .eq("id", f.id);

        await emitirEvento(f.cliente_id as string, "message.status", `status:${f.id}:sent`, {
          id: f.id,
          message_id: f.wamid,
          status: "sent",
        }).catch(() => undefined);

        recuperados++;
      } else {
        await supa
          .from("ed_envios_api")
          .update({
            estado: "fallido",
            motivo: "estado_incierto",
            ultimo_error: "reaper_timeout_sin_wamid",
            telefono: null,
            variables: null,
          })
          .eq("id", f.id);

        await emitirEvento(f.cliente_id as string, "message.status", `status:unc:${f.id}`, {
          id: f.id,
          status: "failed",
          reason: "uncertain",
          error_code: "uncertain",
        }).catch(() => undefined);

        inciertos++;
      }
    }
  }

  return { recuperados, inciertos };
}

/**
 * Expiración de cola WAHA: filas en 'en_cola' que superan WAHA_POOL_COLA_MAX_HORAS (default 48h).
 */
export async function expirarColaWaha(
  supa = db(),
  ahora = new Date(),
): Promise<number> {
  const maxHoras = Number(process.env.WAHA_POOL_COLA_MAX_HORAS) || 48;
  const limiteMs = ahora.getTime() - maxHoras * 3600 * 1000;

  const { data: cola } = await supa
    .from("ed_envios_api")
    .select("id, cliente_id, programado_para, creado_en")
    .eq("canal", "waha")
    .eq("estado", "en_cola");

  let totalExpirados = 0;
  for (const f of cola ?? []) {
    const fechaRef = (f.programado_para || f.creado_en) as string | null;
    if (fechaRef && Date.parse(fechaRef) < limiteMs) {
      await supa
        .from("ed_envios_api")
        .update({
          estado: "fallido",
          motivo: "expirado",
          ultimo_error: "expirado",
          telefono: null,
          variables: null,
        })
        .eq("id", f.id);

      await emitirEvento(f.cliente_id as string, "message.status", `status:exp:${f.id}`, {
        id: f.id,
        status: "failed",
        reason: "expired",
        error_code: "expired",
      }).catch(() => undefined);

      totalExpirados++;
    }
  }

  return totalExpirados;
}

/**
 * Despacha la cola de marketing del grupo de números WAHA.
 * Procesa un envío por número en paralelo (Promise.allSettled).
 * Respeta presupuesto de tiempo (guard ≤45s, corte a los 35s),
 * justicia round-robin entre locales, expiración (48h), reaper (>3m),
 * failover excluyendo número fallido, reintento con backoff exponencial
 * (máx 3 intentos), simulación de tipeo y kill switch en tiempo real.
 */
export async function drenarColaWaha(
  ahora: Date = new Date(),
  max = 50,
): Promise<{ enviados: number; fallidos: number; omitidos: number }> {
  const out = { enviados: 0, fallidos: 0, omitidos: 0 };
  if (wahaPoolApagado()) return out;
  if (!enHorarioPermitido(ahora)) return out;

  const supa = db();
  const inicio = Date.now();

  // 1) Reaper de envíos colgados y expiración de cola vieja
  await reaperEnviosWaha(supa, ahora);
  await expirarColaWaha(supa, ahora);

  // 2) Obtener números activos con rol envio
  const { data: numsRaw } = await supa
    .from("ed_waha_numeros")
    .select("*")
    .eq("estado", "activo")
    .eq("rol", "envio");

  const todosNumeros = (numsRaw as WahaNumero[]) ?? [];
  const disponibles = todosNumeros.filter((n) => {
    if (n.proximo_envio_en && Date.parse(n.proximo_envio_en) > ahora.getTime()) return false;
    if (n.pausado_hasta && Date.parse(n.pausado_hasta) > ahora.getTime()) return false;
    return enviadosEfectivosHoy(n, ahora) < topeDelDia(n, ahora);
  });

  if (disponibles.length === 0) {
    if (process.env.WAHA_POOL_FALLBACK_META === "1") {
      return drenarCola(ahora, max);
    }
    return out; // Sin números con cupo ni tiempo libre en esta pasada
  }

  // 3) Obtener mensajes pendientes en cola para WAHA
  const { data: filasRaw } = await supa
    .from("ed_envios_api")
    .select("id, cliente_id, plantilla, categoria, telefono, variables, telefono_hash, mes, canal, intentos, proximo_intento_en, ultimo_error, numero_id, origen_ref, wamid")
    .eq("estado", "en_cola")
    .is("wamid", null)
    .lte("programado_para", ahora.toISOString())
    .limit(max);

  const filasDisponibles = (filasRaw ?? []).filter((f) => {
    if (f.proximo_intento_en && Date.parse(f.proximo_intento_en) > ahora.getTime()) return false;
    return true;
  });

  if (filasDisponibles.length === 0) {
    return out;
  }

  // 4) Reparto equitativo entre locales (round-robin por origen_ref)
  const filasOrdenadas = intercalarPorOrigenRef(filasDisponibles);

  // 5) Asignar 1 mensaje por número disponible respetando failover
  const filasAsignadas = new Set<string>();
  const pares: Array<{ numero: WahaNumero; fila: (typeof filasRaw)[0] }> = [];

  for (const num of disponibles) {
    const fila = filasOrdenadas.find((f) => {
      if (filasAsignadas.has(f.id as string)) return false;
      if (f.cliente_id !== num.cliente_id) return false;
      // Failover: si falló previamente en este número, preferir otro número disponible
      if (f.numero_id && f.numero_id === num.id && disponibles.some((d) => d.id !== num.id && d.cliente_id === num.cliente_id)) {
        return false;
      }
      return true;
    });

    if (fila) {
      filasAsignadas.add(fila.id as string);
      pares.push({ numero: num, fila });
    }
  }

  if (pares.length === 0) {
    return out;
  }

  // 4) Procesamiento concurrente de los envíos asignados
  const tareas = pares.map(async ({ numero, fila: f }) => {
    if (wahaPoolApagado()) return;
    if (Date.now() - inicio > 35_000) return; // Guard de tiempo: no iniciar pasada si > 35s

    const clienteId = f.cliente_id as string;
    const canalActual = await canalMarketingDe(clienteId, supa);
    if (canalActual !== "waha" && canalActual !== "waha_opt_in") return;
    if (f.categoria !== "marketing") return;

    const p = plantillaKambak(f.plantilla as string);
    const telefono = f.telefono as string | null;
    const params = f.variables as string[] | null;
    const cerrar = (extra: Record<string, unknown>) =>
      supa.from("ed_envios_api").update({ telefono: null, variables: null, ...extra }).eq("id", f.id);

    if (!p || !telefono || !params) {
      await cerrar({ estado: "fallido", motivo: "datos_incompletos" });
      await emitirEvento(clienteId, "message.status", `status:${f.id}:datos_incompletos`, {
        id: f.id,
        status: "failed",
        reason: "datos_incompletos",
        error_code: "datos_incompletos",
      }).catch(() => undefined);
      out.fallidos++;
      return;
    }

    if (!(await esSoloMensajeria(clienteId))) {
      await cerrar({ estado: "omitido", motivo: "cuenta_no_habilitada" });
      await emitirEvento(clienteId, "message.status", `status:${f.id}:cuenta_no_habilitada`, {
        id: f.id,
        status: "failed",
        reason: "cuenta_no_habilitada",
        error_code: "cuenta_no_habilitada",
      }).catch(() => undefined);
      out.omitidos++;
      return;
    }

    if (await enBaja(clienteId, telefono)) {
      await cerrar({ estado: "omitido", motivo: "opted_out" });
      await emitirEvento(clienteId, "message.status", `status:${f.id}:opt_out`, {
        id: f.id,
        status: "failed",
        reason: "opt_out",
        error_code: "opt_out",
      }).catch(() => undefined);
      out.omitidos++;
      return;
    }

    if ((await enviosDelMes(clienteId, f.telefono_hash as string, mesChile(ahora), f.id as string)) >= topeMensual()) {
      await cerrar({ estado: "omitido", motivo: "monthly_cap" });
      await emitirEvento(clienteId, "message.status", `status:${f.id}:monthly_cap`, {
        id: f.id,
        status: "failed",
        reason: "monthly_cap",
        error_code: "monthly_cap",
      }).catch(() => undefined);
      out.omitidos++;
      return;
    }

    // Reclamar la fila con idempotencia fuerte condicional
    const { data: tomada } = await supa
      .from("ed_envios_api")
      .update({ estado: "enviando", canal: "waha", numero_id: numero.id })
      .eq("id", f.id)
      .eq("estado", "en_cola")
      .is("wamid", null)
      .select("id");

    if (!tomada || tomada.length === 0) return;

    // Verificar si el contacto tiene WhatsApp
    const check = await existeEnWhatsApp(numero.sesion, telefono);
    if (check.ok && !check.existe) {
      await cerrar({ estado: "omitido", motivo: "sin_whatsapp" });
      await emitirEvento(clienteId, "message.status", `status:${f.id}:not_on_whatsapp`, {
        id: f.id,
        status: "failed",
        reason: "not_on_whatsapp",
        error_code: "not_on_whatsapp",
      }).catch(() => undefined);
      out.omitidos++;
      return;
    }

    // Presencia escribiendo realista (máx 4.5s)
    const texto = textoWaha(p, params, telefono);
    const tipeoMs = Math.min(4500, 700 + texto.length * 30 + Math.floor(Math.random() * 800));
    await iniciarTipeo(numero.sesion, telefono);
    if (process.env.WAHA_POOL_SIMULAR_DELAY === "1") {
      await new Promise((r) => setTimeout(r, Math.min(tipeoMs, 500)));
    }
    await pararTipeo(numero.sesion, telefono);

    // Verificación de kill switch en tiempo real antes de llamar a la red
    if (wahaPoolApagado()) {
      await supa.from("ed_envios_api").update({ estado: "en_cola" }).eq("id", f.id);
      return;
    }

    const rEnvio = await enviarTextoPool(numero.sesion, telefono, texto);

    if (!rEnvio.ok) {
      const err = rEnvio.error ?? "error";
      const esFalloSesion = /session|sesion|desvinculad|banned|logged out|STOPPED|FAILED/i.test(err);

      if (esFalloSesion) {
        // Fallo de sesión: cuenta contra el número, no contra el envío
        await registrarFalloPool(numero.id, err, supa);
        await supa.from("ed_envios_api").update({
          estado: "en_cola",
          ultimo_error: `fallo_sesion: ${err}`,
          proximo_intento_en: null,
        }).eq("id", f.id);
        out.fallidos++;
        return;
      }

      // Error transitorio: reintento con backoff exponencial
      await registrarFalloPool(numero.id, err, supa);
      const intentosActuales = ((f.intentos as number) || 0) + 1;

      if (intentosActuales >= 3) {
        await cerrar({
          estado: "fallido",
          motivo: "max_intentos",
          ultimo_error: err,
          intentos: intentosActuales,
        });
        await emitirEvento(clienteId, "message.status", `status:${f.id}:max_intentos`, {
          id: f.id,
          status: "failed",
          reason: "max_intentos",
          error_code: "max_intentos",
        }).catch(() => undefined);
        out.fallidos++;
      } else {
        const minutosBackoff = Math.pow(2, intentosActuales) * 2;
        const proximoIntento = new Date(ahora.getTime() + minutosBackoff * 60 * 1000).toISOString();
        await supa.from("ed_envios_api").update({
          estado: "en_cola",
          intentos: intentosActuales,
          proximo_intento_en: proximoIntento,
          ultimo_error: err,
          numero_id: numero.id,
        }).eq("id", f.id);
        out.fallidos++;
      }
      return;
    }

    // Éxito: registrar envío en el pool y actualizar la fila
    await registrarEnvioPool(numero.id, ahora, undefined, supa);
    await registrarExitoPool(numero.id, supa);

    await supa.from("ed_envios_api").update({
      estado: "enviado",
      wamid: rEnvio.waId ?? null,
      enviado_en: ahora.toISOString(),
      telefono: null,
      variables: null,
    }).eq("id", f.id);

    await emitirEvento(clienteId, "message.status", `status:${f.id}:sent`, {
      id: f.id,
      message_id: rEnvio.waId ?? null,
      status: "sent",
    }).catch(() => undefined);

    try {
      const tino = await tinoDe(clienteId);
      if (tino) {
        const nombre = p.categoria === "authentication" ? null : params[0];
        await asegurarContacto(supa, { clienteId, chatId: telefono, nombre, telefono: `+${telefono}` });
        await guardarMensaje(supa, {
          empleadoId: tino,
          chatId: telefono,
          rol: "empleado",
          texto,
          waId: rEnvio.waId ?? null,
        });
      }
    } catch (e) {
      console.error("[kambak-envios] no se pudo registrar en la conversación:", (e as Error).message);
    }

    out.enviados++;
  });

  await Promise.allSettled(tareas);
  return out;
}
