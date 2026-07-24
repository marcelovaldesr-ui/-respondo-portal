/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Los server actions permiten 1MB por defecto; una foto lo supera. Subimos el
    // tope para poder enviar imágenes/PDF (base64) desde el inbox.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
