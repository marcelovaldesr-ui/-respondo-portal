/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false, // no revelar el stack (cabecera X-Powered-By)
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
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
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
