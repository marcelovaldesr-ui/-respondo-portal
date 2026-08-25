/** @type {import('next').NextConfig} */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co https://graph.facebook.com https://graph.instagram.com https://connect.facebook.net https://www.facebook.com",
  "frame-src https://www.facebook.com https://web.facebook.com https://business.facebook.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig = {
  poweredByHeader: false, // no revelar el stack (cabecera X-Powered-By)

  /**
   * MAPAS DE ORIGEN: QUITADOS el 24-ago-2026.
   *
   * Se habían activado el 19-ago para cazar el fallo «i is not a function», que
   * llegaba minificado. Ese fallo dejó de reproducirse (el candidato es el
   * desajuste de zona horaria que se corrigió el mismo día) y los mapas publican
   * el código fuente del cliente, así que no hay razón para dejarlos.
   *
   * Si vuelve a aparecer, se reactivan con una línea:
   *   productionBrowserSourceMaps: true,
   */


  /**
   * VERSIÓN DEL DESPLIEGUE, HORNEADA EN EL PAQUETE DEL NAVEGADOR.
   *
   * Sirve para detectar que una pestaña quedó vieja. Tras un despliegue, el
   * navegador conserva el JavaScript anterior; si el cliente aprieta un botón
   * que llama a una acción del servidor, esa acción ya no existe con el mismo
   * identificador y revienta con "i is not a function" — el portal se cae
   * entero y el dueño ve un cartel de error mientras atendía a alguien.
   *
   * Comparando esto contra /api/version (que devuelve el valor VIVO) se detecta
   * la diferencia ANTES de que el usuario apriete nada.
   */
  env: {
    NEXT_PUBLIC_VERSION_DESPLIEGUE:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
  },
  experimental: {
    // Los server actions permiten 1MB por defecto; una foto lo supera. Subimos el
    // tope para poder enviar imágenes/PDF (base64) desde el inbox.
    serverActions: { bodySizeLimit: "12mb" },
  },

  /**
   * Cabeceras de seguridad (auditoría 30-jul-2026).
   * Vercel ya enviaba HSTS; faltaban las defensas del navegador:
   *  - X-Frame-Options: impide cargar el portal dentro de un iframe ajeno
   *    (clickjacking: superponer algo invisible sobre "Tomar el control" o
   *    "Enviar" para que el usuario lo apriete sin saberlo).
   *  - X-Content-Type-Options: impide que el navegador "adivine" el tipo de un
   *    archivo y ejecute como script algo subido como imagen (MIME sniffing).
   *  - Referrer-Policy: evita filtrar la URL del portal (lleva ids de chat) a
   *    sitios externos.
   *  - Permissions-Policy: apaga cámara/micrófono/geolocalización, que no se usan.
   */
  async headers() {
    return [
      {
        /**
         * EL SERVICE WORKER NO SE CACHEA. NUNCA.
         *
         * Es el error clásico de las PWA: el navegador guarda /sw.js, y como ese
         * archivo controla lo que se sirve, una versión vieja puede quedar
         * mandando durante días — con la persona recargando sin entender por qué
         * nada cambia. `no-cache` obliga a revalidarlo en cada carga.
         */
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
