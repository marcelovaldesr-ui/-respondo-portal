/**
 * lib/mediaSegura.ts
 *
 * CABECERAS Y DESCARGA SEGURA PARA SERVIR UN ADJUNTO DE CONVERSACIÓN (auditoría 11-sep-2026 y Misión B P0).
 *
 * GARANTÍAS:
 * 1. PROTECCIÓN XSS: Solo tipos inline permitidos (JPEG, PNG, WebP, GIF, audio, video MP4, PDF)
 *    se muestran en el navegador; todo lo demás sale como octet-stream con nosniff.
 * 2. ANTI-SSRF EN REDIRECTS: Valida que la URL inicial y CADA salto de redirección apunten
 *    exclusivamente a dominios HTTPS autorizados de Meta / Instagram CDN.
 * 3. CONTROL DE REDIRECTS: Seguidas manualmente (redirect: "manual"), revalidando el destino
 *    en cada salto y limitando a 3 saltos para abortar bucles.
 * 4. LÍMITE DE TAMAÑO (25 MB REAL): Si Content-Length excede 25 MB, rechaza inmediatamente con 413.
 *    Si el stream es chunked o no declara tamaño, cuenta bytes al vuelo y aborta si supera 25 MB.
 * 5. PREVENCIÓN DE FUGA DE TOKEN: Si una redirección salta de host (ej. graph.facebook.com -> fbcdn.net),
 *    elimina la cabecera Authorization para no exponer credenciales del tenant a CDNs externos.
 */

export const TIPOS_INLINE: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp4",
  "audio/wav",
  "audio/aac",
  "audio/amr",
  "video/mp4",
  "application/pdf",
]);

export const LIMITE_BYTES_MEDIA = 25 * 1024 * 1024; // 25 MB
export const MAX_REDIRECTS_MEDIA = 3;

/** Deja solo caracteres seguros para un nombre de archivo en una cabecera. */
export function nombreSeguro(nombre: string | null | undefined): string {
  const limpio = String(nombre ?? "")
    .replace(/[^\w.\- ]/g, "_")
    .slice(0, 120)
    .trim();
  return limpio || "archivo";
}

export function cabecerasDeTipo(
  tipoDeclarado: string | null | undefined,
  nombre: string | null | undefined,
): Record<string, string> {
  const tipo = String(tipoDeclarado ?? "").split(";")[0].trim().toLowerCase();
  const inline = TIPOS_INLINE.has(tipo);
  return {
    "Content-Type": inline ? tipo : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${nombreSeguro(nombre)}"`,
    "X-Content-Type-Options": "nosniff",
  };
}

/**
 * Valida si una URL apunta a un CDN oficial y permitido de Meta / Instagram.
 * Exige HTTPS y compara contra la lista blanca estricta.
 */
export function hostDeMediaPermitido(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return (
      h === "lookaside.fbsbx.com" ||
      h === "graph.facebook.com" ||
      h.endsWith(".fbcdn.net") ||
      h.endsWith(".cdninstagram.com")
    );
  } catch {
    return false;
  }
}

/**
 * Envuelve un ReadableStream con un TransformStream que cuenta bytes y aborta
 * inmediatamente con error si se supera el límite máximo permitido.
 */
export function crearStreamConLimiteBytes(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number = LIMITE_BYTES_MEDIA,
): ReadableStream<Uint8Array> {
  let bytesContados = 0;
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesContados += chunk.byteLength;
      if (bytesContados > maxBytes) {
        controller.error(new Error("EXCESO_LIMITE_BYTES"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return stream.pipeThrough(transform);
}

export type ResultadoDescargaMedia =
  | {
      ok: true;
      status: number;
      headers: Headers;
      stream: ReadableStream<Uint8Array>;
      contentType: string;
      contentLength?: number;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

/**
 * Descarga medios con validación estricta de redirects (anti-SSRF) y limitación de tamaño en streaming.
 */
export async function descargarMediaSegura(
  urlInicial: string,
  opciones?: {
    cabeceras?: Record<string, string>;
    maxBytes?: number;
    maxRedirects?: number;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<ResultadoDescargaMedia> {
  const maxBytes = opciones?.maxBytes ?? LIMITE_BYTES_MEDIA;
  const maxRedirects = opciones?.maxRedirects ?? MAX_REDIRECTS_MEDIA;
  const timeoutMs = opciones?.timeoutMs ?? 25_000;
  const fetchFn = opciones?.fetchImpl ?? fetch;

  let urlActual = urlInicial;
  const cabecerasActuales = opciones?.cabeceras ? { ...opciones.cabeceras } : undefined;
  let redirectCount = 0;

  // 1. Validar URL inicial
  if (!hostDeMediaPermitido(urlActual)) {
    return { ok: false, status: 400, error: "Origen no permitido" };
  }

  while (true) {
    let res: Response;
    try {
      res = await fetchFn(urlActual, {
        headers: cabecerasActuales,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e: unknown) {
      return { ok: false, status: 502, error: (e as Error)?.message || "Error de red al descargar media" };
    }

    // 2. Manejo manual de redirecciones
    if (res.status >= 300 && res.status < 400) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        return { ok: false, status: 508, error: "Demasiadas redirecciones (bucle detectado)" };
      }

      const loc = res.headers.get("location");
      if (!loc) {
        return { ok: false, status: 502, error: "Respuesta de redirección sin cabecera Location" };
      }

      let proxUrl: string;
      try {
        proxUrl = new URL(loc, urlActual).toString();
      } catch {
        return { ok: false, status: 400, error: "Cabecera Location inválida" };
      }

      // Re-validar anti-SSRF en la URL de destino
      if (!hostDeMediaPermitido(proxUrl)) {
        return { ok: false, status: 400, error: "Redirección a host no permitido" };
      }

      // Si cambia de host, retirar cabecera de Authorization para no fugar tokens
      try {
        const hOrig = new URL(urlActual).hostname.toLowerCase();
        const hNuevo = new URL(proxUrl).hostname.toLowerCase();
        if (hOrig !== hNuevo && cabecerasActuales) {
          delete cabecerasActuales["Authorization"];
          delete cabecerasActuales["authorization"];
        }
      } catch {
        // no-op
      }

      urlActual = proxUrl;
      continue;
    }

    // 3. Validación de respuesta exitosa
    if (!res.ok) {
      return { ok: false, status: res.status, error: `Servidor devolvió status ${res.status}` };
    }

    // 4. Validación temprana por Content-Length
    const cl = res.headers.get("content-length");
    const largo = cl ? Number(cl) : null;
    if (largo !== null && Number.isFinite(largo) && largo > maxBytes) {
      return { ok: false, status: 413, error: "Archivo demasiado grande" };
    }

    // 5. Streaming seguro con límite de bytes
    if (!res.body) {
      return { ok: false, status: 502, error: "Cuerpo de respuesta vacío" };
    }

    const streamSeguro = crearStreamConLimiteBytes(res.body, maxBytes);

    return {
      ok: true,
      status: res.status,
      headers: res.headers,
      stream: streamSeguro,
      contentType: res.headers.get("content-type") || "",
      contentLength: largo ?? undefined,
    };
  }
}
