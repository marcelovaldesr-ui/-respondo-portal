import { redirect } from "next/navigation";

/**
 * /pauta se convirtió en /marketing. Los enlaces viejos (correos, favoritos,
 * el callback de Meta de versiones anteriores) siguen llegando acá; se los
 * lleva a la pantalla equivalente en vez de a un 404.
 */
const MAPA: Record<string, string> = {
  "": "/marketing",
  anuncios: "/marketing/atribucion",
  personas: "/marketing/leads",
  conexion: "/marketing/integraciones",
};

export default async function RedirigirPauta({
  params,
  searchParams,
}: {
  params: Promise<{ resto?: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { resto = [] } = await params;
  const sp = await searchParams;
  const destino = MAPA[resto[0] ?? ""] ?? "/marketing";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v) q.set(k, v);
  redirect(q.size ? `${destino}?${q}` : destino);
}
