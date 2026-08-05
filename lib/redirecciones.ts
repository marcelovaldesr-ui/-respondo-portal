/** Acepta solo rutas absolutas del mismo sitio; nunca URLs ni `//host`. */
export function rutaInterna(valor: string | null | undefined, fallback = "/inicio"): string {
  const ruta = (valor ?? "").trim();
  if (!ruta.startsWith("/") || ruta.startsWith("//") || ruta.includes("\\")) return fallback;
  try {
    const base = new URL("https://interno.invalid");
    const resuelta = new URL(ruta, base);
    if (resuelta.origin !== base.origin) return fallback;
    return `${resuelta.pathname}${resuelta.search}${resuelta.hash}`;
  } catch {
    return fallback;
  }
}
