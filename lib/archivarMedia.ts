import { db } from "@/lib/db";
import { configPorCliente, hostDeMediaPermitido, resolverMediaMeta } from "@/lib/whatsapp";
import {
  DIAS_UTILES,
  PREFIJO_GRANDE,
  PREFIJO_META,
  PREFIJO_VENCIDO,
  PREFIJO_STORAGE,
  TOPE_BYTES,
  decidir,
  rutaPara,
} from "@/lib/archivarMediaCore";

/**
 * ARCHIVADOR DE ADJUNTOS: baja de Meta y guarda antes de que Meta borre.
 *
 * Meta borra el archivo que llega por webhook a los **7 días**. El portal solo
 * guardaba un puntero `meta:<id>`, así que **cada foto que manda un cliente
 * dejaba de verse en una semana**, sola, sin que nadie tocara nada.
 *
 * ⚠️ POR QUÉ VA EN EL CRON Y NO EN EL WEBHOOK
 * -------------------------------------------
 * Lo intuitivo sería descargar el archivo al recibirlo. Sería un error: el
 * webhook tiene un presupuesto de tiempo (ver `lib/presupuesto.ts`) y bajar 10 MB
 * ahí adentro se lo come. Si el webhook tarda de más, **Meta lo reintenta** y
 * terminamos procesando el mismo mensaje otra vez.
 *
 * Acá el ingreso queda rápido y el archivado ocurre después, con calma. Con el
 * cron cada 5 minutos y 6 días de margen sobre los 7 de Meta, tendría que estar
 * caído casi una semana entera para perder algo.
 *
 * Además evita tocar `lib/inboundMeta.ts`, que es un archivo compartido entre
 * sesiones de trabajo.
 */

/** Cuántos por pasada. Cada uno son dos viajes a Meta más una subida. */
const MAX_POR_PASADA = 12;

const BUCKET = "adjuntos";

export type ResumenArchivado = {
  revisados: number;
  archivados: number;
  grandes: number;
  /** Meta ya los había borrado cuando fuimos a buscarlos. */
  vencidos: number;
  fallidos: number;
  bytes: number;
};

export async function archivarPendientes(
  supa = db(),
  max = MAX_POR_PASADA,
): Promise<ResumenArchivado> {
  const out: ResumenArchivado = {
    revisados: 0,
    archivados: 0,
    grandes: 0,
    vencidos: 0,
    fallidos: 0,
    bytes: 0,
  };

  const desde = new Date(Date.now() - DIAS_UTILES * 24 * 3600_000).toISOString();

  /**
   * Punteros de Meta todavía vivos. `like` sobre `media_url` con el prefijo, y
   * acotado por fecha para no revisar el historial entero en cada pasada.
   *
   * Los más ANTIGUOS primero: son los que están más cerca de vencer. Ordenar al
   * revés dejaría los urgentes para el final y se perderían justo esos.
   */
  const { data: filas, error } = await supa
    .from("ed_mensajes")
    .select("id, creado_en, media_url, media_mime, media_nombre, ed_empleados!inner(cliente_id)")
    .like("media_url", `${PREFIJO_META}%`)
    .gte("creado_en", desde)
    .order("creado_en", { ascending: true })
    .limit(max);

  if (error || !filas?.length) return out;
  out.revisados = filas.length;

  for (const f of filas) {
    const mensajeId = f.id as string;
    const clienteId = (f as { ed_empleados?: { cliente_id?: string } }).ed_empleados?.cliente_id;
    if (!clienteId) {
      out.fallidos++;
      continue;
    }

    try {
      const cfg = await configPorCliente(clienteId);
      if (!cfg) {
        out.fallidos++;
        continue;
      }

      const mediaId = (f.media_url as string).slice(PREFIJO_META.length);
      const res = await resolverMediaMeta(cfg, mediaId);
      if (!res) {
        /**
         * Meta ya no lo tiene: venció el plazo o el cliente lo borró.
         *
         * ⚠️ MARCA PROPIA, NO LA DE «MUY GRANDE». Al principio compartían marca y
         * el chequeo de salud terminó reportando «1 muy grandes» sobre un archivo
         * que no era grande — llevaba a la conclusión equivocada («subamos el
         * tope») cuando lo cierto era «llegamos tarde».
         *
         * Se marca para dejar de intentarlo: sin esto, el barrido lo reintentaría
         * en cada pasada hasta que la ventana de 6 días lo saque, gastando cuota
         * para recibir el mismo 404.
         */
        await marcar(supa, mensajeId, `${PREFIJO_VENCIDO}${mediaId}`);
        out.vencidos++;
        continue;
      }

      // Nunca mandar el token del negocio a un host que no sea de Meta.
      if (!hostDeMediaPermitido(res.url)) {
        console.error("[archivar] host no permitido en la URL de Meta");
        out.fallidos++;
        continue;
      }

      const decision = decidir({
        clienteId,
        mensajeId,
        creadoEn: f.creado_en as string,
        mediaUrl: f.media_url as string,
        // Meta informa el tamaño al resolver; si no viene, se decide al bajar.
        bytes: typeof res.bytes === "number" ? res.bytes : null,
        mime: (f.media_mime as string | null) ?? res.mime,
        nombre: f.media_nombre as string | null,
      });

      if (decision.accion === "marcar_grande") {
        await marcar(supa, mensajeId, `${PREFIJO_GRANDE}${mediaId}`);
        out.grandes++;
        continue;
      }
      if (decision.accion === "omitir") continue;

      const r = await fetch(res.url, { headers: { Authorization: `Bearer ${cfg.token}` } });
      if (!r.ok) {
        out.fallidos++;
        continue;
      }

      const buf = new Uint8Array(await r.arrayBuffer());

      /**
       * Segundo control de tamaño, ahora sobre los bytes reales.
       *
       * Hace falta porque `resolverMediaMeta` no siempre informa el tamaño, y
       * confiar en un dato que puede no venir es cómo se llena un bucket sin
       * darse cuenta.
       */
      if (buf.byteLength > TOPE_BYTES) {
        await marcar(supa, mensajeId, `${PREFIJO_GRANDE}${mediaId}`);
        out.grandes++;
        continue;
      }

      const mime = (f.media_mime as string | null) || res.mime || "application/octet-stream";
      const ruta = rutaPara({
        clienteId,
        mensajeId,
        creadoEn: f.creado_en as string,
        mime,
        nombre: f.media_nombre as string | null,
      });

      const subida = await supa.storage.from(BUCKET).upload(ruta, buf, {
        contentType: mime,
        // Idempotente: si el archivador pasa dos veces, sobrescribe en vez de
        // fallar o duplicar.
        upsert: true,
      });
      if (subida.error) {
        console.error("[archivar] no se pudo subir:", subida.error.message);
        out.fallidos++;
        continue;
      }

      /**
       * ⚠️ EL PUNTERO SE REESCRIBE AL FINAL, NUNCA ANTES.
       *
       * Si se marcara primero y la subida fallara, el mensaje apuntaría a un
       * archivo que no existe y el original se perdería igual a los 7 días. En
       * este orden, un fallo deja las cosas como estaban y el próximo barrido lo
       * vuelve a intentar.
       */
      await marcar(supa, mensajeId, `${PREFIJO_STORAGE}${ruta}`, mime);
      out.archivados++;
      out.bytes += buf.byteLength;
    } catch (e) {
      console.error("[archivar] falló un adjunto:", (e as Error).message);
      out.fallidos++;
    }
  }

  return out;
}

async function marcar(
  supa: ReturnType<typeof db>,
  mensajeId: string,
  valor: string,
  mime?: string,
) {
  await supa
    .from("ed_mensajes")
    .update({ media_url: valor, ...(mime ? { media_mime: mime } : {}) })
    .eq("id", mensajeId);
}

/**
 * Cuántos adjuntos hay archivados. Lo usa `/api/salud` para avisar temprano.
 *
 * ⚠️ El conteo se pide con `count: "exact", head: true`, que **no transfiere ni
 * una fila** y devuelve el número en `count`, no en `data`. Contar filas en
 * JavaScript acá daría un tope de 1.000 sin ningún error: PostgREST corta ahí y
 * `.limit()` mayor NO lo sube. Este repositorio ya pagó ese error una vez (la
 * analítica del 31-jul reportaba 0% de cobertura con el bot a todo dar).
 */
export async function contarArchivados(supa = db()): Promise<number | null> {
  const { count, error } = await supa
    .from("ed_mensajes")
    .select("id", { count: "exact", head: true })
    .like("media_url", `${PREFIJO_STORAGE}%`);
  if (error) return null;
  return count ?? 0;
}

/**
 * Adjuntos que se quedaron sin archivar y a los que ya se les venció el plazo de
 * Meta. Son archivos **que ya no se pueden recuperar**: sirve para decirlo en la
 * pantalla en vez de mostrar un error mudo.
 */
export async function contarPerdidos(
  supa = db(),
): Promise<{ grandes: number; vencidos: number } | null> {
  const [g, v] = await Promise.all([
    supa.from("ed_mensajes").select("id", { count: "exact", head: true })
      .like("media_url", `${PREFIJO_GRANDE}%`),
    supa.from("ed_mensajes").select("id", { count: "exact", head: true })
      .like("media_url", `${PREFIJO_VENCIDO}%`),
  ]);
  if (g.error || v.error) return null;
  return { grandes: g.count ?? 0, vencidos: v.count ?? 0 };
}
