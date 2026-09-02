import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { limitarDistribuido, secretoValido } from "@/lib/seguridad";
import { contarArchivados, contarPerdidos } from "@/lib/archivarMedia";
import { DIAS_UTILES } from "@/lib/archivarMediaCore";
import { pushConfigurado } from "@/lib/push";
import { ipDeRequest } from "@/lib/reservasPublicas";
import { LATIDO_CRON_SEGUIMIENTOS, estadoDelCron, leerLatido } from "@/lib/latidos";
import { tokenDeFila } from "@/lib/whatsapp";

/**
 * Extrae el parámetro ?k= de la URL de webhook que WAHA tiene configurada.
 * Defensivo: URL rara o ausente → null (no revienta el chequeo de salud).
 */
function kDeUrlWebhook(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("k");
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * SALUD DEL SISTEMA — un solo vistazo a todo lo que puede fallar.
 *
 * PROBLEMA QUE RESUELVE: hoy, si Tino deja de responder de madrugada (WAHA
 * desconectado, token vencido, modelo caído, base inalcanzable), NADIE se entera
 * hasta que un cliente reclama. Este endpoint responde "¿está todo bien?" en una
 * llamada, y devuelve HTTP 503 cuando algo está roto — que es justo lo que
 * cualquier vigilante gratuito (cron-job.org, UptimeRobot) necesita para avisar
 * por correo automáticamente. Sin desplegar nada extra.
 *
 * Uso:
 *   GET /api/salud            → chequeo liviano (base + WAHA + actividad)
 *   GET /api/salud?full=1&k=  → agrega modelo IA y token de Meta (gasta cuota)
 *
 * Protección: los detalles internos solo se muestran con el secreto correcto;
 * sin él responde apenas ok/degradado (para no filtrar la infraestructura).
 */

type Chequeo = { ok: boolean; detalle: string; ms?: number };

async function medir(fn: () => Promise<Chequeo>): Promise<Chequeo> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { ...r, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, detalle: (e as Error).message, ms: Date.now() - t0 };
  }
}

/** 1) Base de datos: ¿responde y trae datos? */
/**
 * NOTIFICACIONES PUSH — el fallo que nadie nota hasta que duele.
 *
 * Si las llaves VAPID se borran de Vercel o la tabla desaparece, los avisos
 * dejan de salir **en silencio**: el portal sigue funcionando, las
 * conversaciones siguen llegando, y lo único que pasa es que el teléfono no
 * suena. Nadie reclama por algo que no ocurre; se descubre cuando un cliente
 * dice "les escribí ayer y no me contestaron".
 *
 * Por eso se vigila acá, junto al resto.
 */
async function chequearPush(): Promise<Chequeo> {
  if (!pushConfigurado()) {
    return { ok: false, detalle: "faltan las llaves VAPID: no salen avisos" };
  }
  const { count, error } = await db()
    .from("ed_push_suscripciones")
    .select("id", { count: "exact", head: true });
  if (error) {
    return { ok: false, detalle: "falta la migración 283 (ed_push_suscripciones)" };
  }
  const n = count ?? 0;
  return {
    // Cero dispositivos no es un fallo: puede que nadie los haya activado aún.
    ok: true,
    detalle: n === 0 ? "configurado, sin dispositivos suscritos" : `${n} dispositivo(s) suscrito(s)`,
  };
}

async function chequearBase(): Promise<Chequeo> {
  const { error, count } = await db()
    .from("ed_clientes")
    .select("id", { count: "exact", head: true });
  if (error) return { ok: false, detalle: `error: ${error.message}` };
  return { ok: true, detalle: `${count ?? 0} clientes` };
}

/**
 * 2) WAHA: ¿la sesión sigue vinculada y trabajando, Y el secreto del webhook
 * que WAHA tiene configurado coincide con el que espera este portal?
 *
 * POR QUÉ SE AGREGÓ (6-ago-2026): un rename+rotación de
 * WAHA_WEBHOOK_SECRET dejó a WAHA enviando el ?k= viejo durante ~21 horas.
 * La sesión seguía "WORKING" todo ese tiempo (WhatsApp conectado, nada raro
 * a la vista) pero cada webhook llegaba y el portal lo rechazaba con 403 —
 * así que Tino nunca se enteraba de los mensajes. Este chequeo solo (sesión
 * WORKING) NUNCA habría detectado ese apagón: revisa la conexión con
 * WhatsApp, no si el webhook realmente puede entregar algo. Por eso ahora
 * también compara el secreto en vivo, sin esperar a que lleguen mensajes.
 */
async function chequearWaha(): Promise<Chequeo> {
  const base = (process.env.WAHA_API_URL ?? "").replace(/\/+$/, "");
  const key = process.env.WAHA_API_KEY;
  const sesion = process.env.WAHA_SESSION || "default";
  if (!base || !key) return { ok: true, detalle: "no configurado (omitido)" };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${base}/api/sessions/${sesion}`, {
      headers: { "X-Api-Key": key },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!r.ok) return { ok: false, detalle: `HTTP ${r.status}` };
    const j = (await r.json()) as {
      status?: string;
      me?: { id?: string };
      config?: { webhooks?: { url?: string }[] };
    };
    const estado = j.status ?? "?";
    // SCAN_QR_CODE / FAILED / STOPPED = Tino NO puede atender por este canal.
    const sesionSana = estado === "WORKING";

    const kWaha = kDeUrlWebhook(j.config?.webhooks?.[0]?.url);
    const secretoEsperado = process.env.WAHA_WEBHOOK_SECRET;
    // Solo se evalúa si ambos lados están configurados; si falta alguno, no es
    // un desajuste (puede ser un entorno donde WAHA no está en uso todavía).
    const secretoSincronizado =
      !secretoEsperado || !kWaha ? true : secretoValido(kWaha, secretoEsperado);

    const detalle = `${estado}${j.me?.id ? ` · ${j.me.id}` : ""}${
      secretoSincronizado ? "" : " · ⚠ secreto de webhook desincronizado (WAHA vs Vercel)"
    }`;
    return { ok: sesionSana && secretoSincronizado, detalle };
  } finally {
    clearTimeout(t);
  }
}

/**
 * 3) Actividad reciente — el chequeo MÁS IMPORTANTE.
 * Detecta el fallo silencioso: todo "verde" pero nada fluyendo. Si entraron
 * mensajes de clientes y el asistente no respondió ninguno, algo está roto
 * aunque los servicios digan estar bien.
 */
async function chequearActividad(): Promise<Chequeo> {
  const desde = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const supa = db();
  const [ent, sal] = await Promise.all([
    supa
      .from("ed_mensajes")
      .select("id", { count: "exact", head: true })
      .eq("rol", "cliente")
      .gte("creado_en", desde),
    supa
      .from("ed_mensajes")
      .select("id", { count: "exact", head: true })
      .in("rol", ["empleado", "humano"])
      .gte("creado_en", desde),
  ]);
  const entrantes = ent.count ?? 0;
  const salientes = sal.count ?? 0;
  // Señal de alarma: llegaron mensajes y NO salió ninguno.
  const mudo = entrantes >= 3 && salientes === 0;
  return {
    ok: !mudo,
    detalle: mudo
      ? `⚠ ${entrantes} mensajes entrantes en 6h y NINGUNA respuesta`
      : `6h: ${entrantes} entrantes / ${salientes} salientes`,
  };
}

/**
 * 4) Cron de seguimientos — el fallo más silencioso de todos.
 *
 * Si el cron externo se cae, NADA se ve roto: la web anda, Tino contesta, la
 * base responde. Simplemente dejan de salir los recordatorios de cita y las
 * confirmaciones, y el negocio se entera cuando un cliente no llega. Con el
 * latido, este chequeo devuelve 503 y el vigilante externo manda el correo.
 */
async function chequearCron(): Promise<Chequeo> {
  return estadoDelCron(await leerLatido(LATIDO_CRON_SEGUIMIENTOS));
}

/** 5) Modelo de IA (solo en modo full: consume cuota). */
async function chequearModelo(): Promise<Chequeo> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, detalle: "falta GEMINI_API_KEY" };
  const modelo = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${key}`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "di OK" }] }] }),
      },
    );
    return r.ok
      ? { ok: true, detalle: modelo }
      : { ok: false, detalle: `${modelo}: HTTP ${r.status}` };
  } finally {
    clearTimeout(t);
  }
}

/** 6) Token de Meta (solo en modo full): detecta un token revocado/vencido. */
async function chequearMeta(): Promise<Chequeo> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: true, detalle: "no configurado (omitido)" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}?fields=quality_rating`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!r.ok) return { ok: false, detalle: `token/número inválido (HTTP ${r.status})` };
    const j = (await r.json()) as { quality_rating?: string };
    return { ok: true, detalle: `calidad ${j.quality_rating ?? "?"}` };
  } finally {
    clearTimeout(t);
  }
}

/**
 * 7) TOKENS DE LOS CLIENTES REALES en la vía oficial de Meta.
 *
 * PUNTO CIEGO QUE CIERRA (auditoría 11-ago-2026, antes de escalar):
 * chequearMeta() de más arriba solo mira WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID
 * —las variables del NÚMERO DE PRUEBA—. Cada cliente onboardeado por Embedded
 * Signup guarda SU PROPIO token en ed_clientes.waba_token, y esos no los miraba
 * nadie.
 *
 * O sea: con 10 clientes en Cloud API, si a uno se le revoca el token (el dueño
 * le quita el acceso a la app desde Meta Business Suite, o Meta lo invalida),
 * su Tino queda mudo y /api/salud sigue diciendo "ok" porque el número de
 * prueba está sano. Es EXACTAMENTE el patrón del apagón de 21 h de agosto: el
 * vigilante mirando el lugar equivocado.
 *
 * Acotado a 10 clientes por corrida y en paralelo para no estirar el chequeo.
 */
async function chequearTokensClientes(): Promise<Chequeo> {
  const { data, error } = await db()
    .from("ed_clientes")
    .select("nombre, waba_phone_id, waba_token, waba_token_cifrado")
    .eq("transporte", "cloud")
    .eq("activo", true)
    // Sirve cualquiera de las dos columnas mientras dure la transición de la
    // migración 279. Filtrar solo por la vieja dejaría fuera del chequeo justo
    // a los clientes ya migrados, que es al revés de lo que queremos.
    .or("waba_token.not.is.null,waba_token_cifrado.not.is.null")
    .not("waba_phone_id", "is", null)
    .limit(10);

  if (error) return { ok: false, detalle: `no se pudo leer: ${error.message}` };
  if (!data?.length) return { ok: true, detalle: "sin clientes en vía oficial (omitido)" };

  // Un token que quedó en claro no rompe nada hoy, pero es exactamente la deuda
  // que la 279 vino a cerrar: que aparezca acá evita que se olvide a medio
  // camino, con unos clientes migrados y otros no.
  const enClaro = data.filter((c) => c.waba_token).map((c) => (c.nombre as string) ?? "sin nombre");

  const revisiones = await Promise.all(
    data.map(async (c) => {
      const nombre = (c.nombre as string) ?? "sin nombre";
      try {
        const r = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(c.waba_phone_id as string)}?fields=quality_rating`,
          {
            headers: { Authorization: `Bearer ${tokenDeFila(c)}` },
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
          },
        );
        return { nombre, ok: r.ok, motivo: r.ok ? "" : `HTTP ${r.status}` };
      } catch (e) {
        return { nombre, ok: false, motivo: (e as Error).name === "TimeoutError" ? "sin respuesta" : "error de red" };
      }
    }),
  );

  const rotos = revisiones.filter((r) => !r.ok);
  const aviso = enClaro.length
    ? ` · ⚠ token en TEXTO PLANO: ${enClaro.join(", ")} (falta correr scripts/cifrar_tokens.ts y la migración 280)`
    : "";

  if (rotos.length === 0) {
    return { ok: true, detalle: `${revisiones.length} cliente(s) con token válido${aviso}` };
  }
  return {
    ok: false,
    detalle: `token inválido: ${rotos.map((r) => `${r.nombre} (${r.motivo})`).join(", ")}${aviso}`,
  };
}

/**
 * 8) ¿Hay más de un cliente colgado de la ÚNICA sesión de WAHA?
 *
 * WAHA es de un solo negocio (ver lib/waha.ts): la instancia de entrada y la
 * sesión de salida son variables de entorno globales. Un segundo cliente con
 * transporte='waha' hace que sus mensajes salgan por el WhatsApp del primero.
 *
 * La barrera de lib/waha.ts impide la fuga, pero deja al cliente sin poder
 * responder. Este chequeo avisa ANTES: es un problema de configuración, y el
 * vigilante externo debe verlo apenas alguien conecte un cliente por la vía
 * equivocada, no cuando un cliente reclame que su asistente no contesta.
 */
/**
 * ¿SE ESTÁN GUARDANDO LOS ADJUNTOS ANTES DE QUE META LOS BORRE?
 *
 * Meta elimina el archivo que llega por webhook a los **7 días**. Si el
 * archivador deja de correr, nadie lo nota: el portal sigue funcionando y las
 * fotos simplemente empiezan a desaparecer una semana después, de a poco. Es el
 * mismo tipo de falla muda que las notificaciones, y por eso está acá.
 *
 * Se pone en ROJO si hay adjuntos con puntero de Meta más viejos que el margen
 * del barrido: significa que el archivador no los alcanzó y están por vencer.
 */
/**
 * PUENTES HACIA LOS SISTEMAS DE LOS CLIENTES — la falla más silenciosa de todas.
 *
 * Cuando un cliente tiene su propia app conectada (`ed_integraciones`), sus
 * leads y reportes se llenan desde acá. Si el puente deja de entregar, en el
 * portal NO se nota nada: Tino sigue conversando igual de bien. El cliente solo
 * ve que su tablero dejó de moverse, y lo atribuye a que "no ha llegado nadie".
 *
 * PASÓ DE VERDAD: el puente de Impresora Color quedó mudo el 26-ago-2026 a las
 * 19:13 —la hora exacta de su migración a Cloud API, porque inboundMeta.ts no
 * tenía el gancho— y estuvo 7 días caído sin una sola alarma. Se perdieron 72
 * leads nuevos. Esto es lo que habría avisado el mismo día.
 *
 * CÓMO SE MIDE: no basta con mirar `ultimo_error`. Un puente que dejó de ser
 * llamado nunca falla; simplemente enmudece. Por eso se compara la última
 * entrega OK contra el tráfico real del cliente: si entraron mensajes bastante
 * después de la última entrega, el puente no está haciendo su trabajo.
 */
const GRACIA_PUENTE_MS = 30 * 60_000;

async function chequearPuentes(): Promise<Chequeo> {
  const { data, error } = await db()
    .from("ed_integraciones")
    .select("cliente_id, nombre, ultimo_ok_en, ultimo_error")
    .eq("activo", true);
  if (error) return { ok: false, detalle: `no se pudo leer ed_integraciones: ${error.message}` };

  const puentes = data ?? [];
  if (puentes.length === 0) return { ok: true, detalle: "sin puentes configurados" };

  const rotos: string[] = [];
  for (const puente of puentes) {
    // Último mensaje del cliente, sea de quien sea: es lo que el puente
    // tendría que haber entregado.
    const { data: ultimo } = await db()
      .from("ed_contactos")
      .select("ultimo_mensaje_en")
      .eq("cliente_id", puente.cliente_id)
      .not("ultimo_mensaje_en", "is", null)
      .order("ultimo_mensaje_en", { ascending: false })
      .limit(1)
      .maybeSingle();

    const trafico = ultimo?.ultimo_mensaje_en ? Date.parse(ultimo.ultimo_mensaje_en) : 0;
    // Sin conversaciones no hay nada que entregar: no es un puente roto.
    if (!trafico) continue;

    const entregado = puente.ultimo_ok_en ? Date.parse(puente.ultimo_ok_en) : 0;
    if (trafico - entregado > GRACIA_PUENTE_MS) {
      const horas = Math.round((trafico - entregado) / 3_600_000);
      const quien = puente.nombre ?? puente.cliente_id;
      const causa = puente.ultimo_error ? ` (último error: ${puente.ultimo_error})` : "";
      rotos.push(
        entregado === 0
          ? `${quien}: nunca ha entregado${causa}`
          : `${quien}: sin entregar hace ${horas} h${causa}`,
      );
    }
  }

  if (rotos.length > 0) return { ok: false, detalle: rotos.join(" · ") };
  return { ok: true, detalle: `${puentes.length} puente(s) al día` };
}

async function chequearArchivado(): Promise<Chequeo> {
  const supa = db();

  const limite = new Date(Date.now() - DIAS_UTILES * 24 * 3600_000).toISOString();
  const [pendientes, guardados, perdidos] = await Promise.all([
    // Sin archivar y ya fuera del margen: estos se pierden si nadie actúa.
    supa
      .from("ed_mensajes")
      .select("id", { count: "exact", head: true })
      .like("media_url", "meta:%")
      .lt("creado_en", limite),
    contarArchivados(supa),
    contarPerdidos(supa),
  ]);

  if (pendientes.error) {
    return { ok: true, detalle: `no verificable (${pendientes.error.message})` };
  }

  const enRiesgo = pendientes.count ?? 0;

  /**
   * ⚠️ «MUY GRANDE» Y «META YA LO BORRÓ» SON COSAS DISTINTAS, Y SE DICEN DISTINTO.
   *
   * Antes compartían marca y este chequeo llegó a reportar «1 muy grandes» sobre
   * un archivo que no era grande: era viejo. Llevaba a la conclusión equivocada
   * —«hay que subir el tope»— cuando lo cierto era «llegamos tarde».
   */
  const partes = [`${guardados ?? 0} archivados`];
  if (perdidos?.grandes) partes.push(`${perdidos.grandes} sobre el tope de 10 MB`);
  if (perdidos?.vencidos) partes.push(`${perdidos.vencidos} que Meta ya había borrado`);
  if (enRiesgo) partes.push(`⚠️ ${enRiesgo} sin archivar y por vencer`);

  return { ok: enRiesgo === 0, detalle: partes.join(" · ") };
}

async function chequearWahaUnCliente(): Promise<Chequeo> {
  const instancia = process.env.WAHA_INSTANCIA || "impresora-color";
  const supa = db();

  // La columna waha_instancia llega con la migración 275. Si todavía no está
  // aplicada, PostgREST devuelve error y hay que leer el campo viejo: sin este
  // respaldo el chequeo quedaba ciego justo en la ventana previa a la
  // migración, que es cuando el riesgo es más alto.
  type Fila = {
    id: string;
    nombre: string | null;
    waha_instancia?: string | null;
    waba_phone_id: string | null;
  };
  let clientes: Fila[] = [];
  const conNueva = await supa
    .from("ed_clientes")
    .select("id, nombre, waha_instancia, waba_phone_id")
    .eq("transporte", "waha")
    .eq("activo", true);
  if (conNueva.error) {
    const vieja = await supa
      .from("ed_clientes")
      .select("id, nombre, waba_phone_id")
      .eq("transporte", "waha")
      .eq("activo", true);
    if (vieja.error) return { ok: true, detalle: `no verificable (${vieja.error.message})` };
    clientes = (vieja.data ?? []) as Fila[];
  } else {
    clientes = (conNueva.data ?? []) as Fila[];
  }

  /**
   * ⚠️ CERO CLIENTES EN WAHA NO ES LO MISMO QUE «UN CLIENTE, TODO BIEN».
   *
   * Antes ambos casos caían en la misma rama y el vigilante respondía «1 negocio
   * en WAHA» aunque no quedara ninguno. Un dato plausible y falso, que es
   * justo lo que un monitor no puede hacer: un error se ve y se arregla, un
   * número creíble se cree.
   *
   * Dejó de ser hipotético el 26-ago-2026, cuando Impresora Color —el único
   * cliente en WAHA— se migró a Cloud API.
   */
  if (clientes.length === 0) {
    return {
      ok: true,
      detalle: "nadie usa WAHA: el servidor se puede apagar cuando Cloud esté confirmado",
    };
  }

  // El dueño es el que declara la instancia global (waha_instancia desde la
  // migración 275; waba_phone_id mientras no esté aplicada).
  const ajenos = clientes.filter(
    (c) => (c.waha_instancia ?? c.waba_phone_id) !== instancia,
  );
  if (ajenos.length === 0) {
    return { ok: true, detalle: `${clientes.length} negocio(s) en WAHA (${instancia})` };
  }

  /**
   * Un cliente ajeno DORMIDO (demo, sin nada programado) no es una alarma: la
   * barrera de lib/waha.ts ya impide que use el WhatsApp del dueño. Marcarlo en
   * rojo dejaría el vigilante encendido para siempre por los clientes de
   * demostración, y un monitor siempre rojo se termina ignorando —que es la
   * forma más común de perderse la alerta que sí importaba—.
   *
   * Se pone en rojo solo cuando hay algo REAL por salir: ahí el cliente se
   * queda sin sus recordatorios (bloqueados) y hay que actuar.
   */
  const nombres = ajenos.map((c) => c.nombre ?? "sin nombre").join(", ");

  // ¿Alguno de esos clientes tiene algo REAL por salir?
  const { data: empsAjenos } = await supa
    .from("ed_empleados")
    .select("id")
    .in(
      "cliente_id",
      ajenos.map((c) => c.id),
    );
  const idsEmpleados = (empsAjenos ?? []).map((e) => e.id as string);

  let pendientes = 0;
  if (idsEmpleados.length) {
    const { count } = await supa
      .from("ed_seguimientos")
      .select("id", { count: "exact", head: true })
      .is("enviado_en", null)
      .in("empleado_id", idsEmpleados);
    pendientes = count ?? 0;
  }

  if (pendientes > 0) {
    return {
      ok: false,
      detalle:
        `${ajenos.length} cliente(s) en 'waha' sin ser dueños de la sesión '${instancia}' ` +
        `(${nombres}) tienen ${pendientes} envío(s) pendientes que quedarán BLOQUEADOS ` +
        `para no usar el WhatsApp ajeno. Muévelos a Cloud API.`,
    };
  }
  return {
    ok: true,
    detalle:
      `1 negocio real en WAHA (${instancia}); ${ajenos.length} cliente(s) sin tráfico ` +
      `también marcados 'waha' (${nombres}) — sin envíos pendientes, bloqueados por seguridad.`,
  };
}

export async function GET(request: NextRequest) {
  if (!(await limitarDistribuido(`salud:${ipDeRequest(request.headers)}`, 60, 60)).ok) {
    return NextResponse.json({ estado: "limitado" }, { status: 429 });
  }
  const { searchParams } = new URL(request.url);
  const full = searchParams.get("full") === "1";
  // CRON_SECRET es su propio secreto desde el 5-ago-2026 (ver cron/seguimientos).
  const secreto = process.env.CRON_SECRET;
  const autorizado = secretoValido(searchParams.get("k"), secreto);

  const chequeos: Record<string, Chequeo> = {
    base_de_datos: await medir(chequearBase),
    whatsapp_waha: await medir(chequearWaha),
    actividad: await medir(chequearActividad),
    cron_seguimientos: await medir(chequearCron),
    notificaciones: await medir(chequearPush),
  };
  // Los tokens de los clientes reales se vigilan con el secreto pero SIN exigir
  // `full=1`: es la falla que deja mudo a un cliente entero, así que tiene que
  // entrar en el chequeo que corre cada 30 min, no en el manual. No se expone
  // sin secreto porque haría una llamada a Meta por cliente en cada visita.
  if (autorizado) {
    chequeos.tokens_clientes = await medir(chequearTokensClientes);
    chequeos.puentes_clientes = await medir(chequearPuentes);
    chequeos.waha_un_solo_cliente = await medir(chequearWahaUnCliente);
    chequeos.adjuntos_archivados = await medir(chequearArchivado);
  }
  if (full && autorizado) {
    chequeos.modelo_ia = await medir(chequearModelo);
    chequeos.whatsapp_meta = await medir(chequearMeta);
  }

  const sano = Object.values(chequeos).every((c) => c.ok);
  const estado = sano ? "ok" : "degradado";

  // Sin el secreto: solo el veredicto (no filtrar detalles de infraestructura).
  if (!autorizado) {
    return NextResponse.json({ estado }, { status: sano ? 200 : 503 });
  }

  return NextResponse.json(
    {
      estado,
      revisado: new Date().toISOString(),
      chequeos,
      // 503 hace que cualquier vigilante externo (cron-job.org, UptimeRobot)
      // dispare la alerta por correo automáticamente.
    },
    { status: sano ? 200 : 503 },
  );
}
