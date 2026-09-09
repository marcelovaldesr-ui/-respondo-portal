import Sidebar from "@/components/Sidebar";
import AvisoVersion from "@/components/AvisoVersion";
import { exigirUsuarioPortal } from "@/lib/auth";
import { contadoresMenu } from "@/lib/contadores";
import { db } from "@/lib/db";

/**
 * Logo del negocio para la barra lateral (migración 296).
 *
 * ⚠️ ESTA CONSULTA NO PUEDE ROMPER NADA. Vive en el layout, así que envuelve
 * TODO el portal: si fallara sin capturar —por ejemplo entre el deploy y la
 * migración, cuando la columna todavía no existe— se caería la aplicación
 * entera, no una tarjeta. Por eso devuelve null ante cualquier problema: sin
 * logo el portal se ve como siempre, que es exactamente lo que corresponde.
 */
async function logoDelNegocio(clienteId: string): Promise<string | null> {
  try {
    const { data, error } = await db()
      .from("ed_clientes")
      .select("logo_url")
      .eq("id", clienteId)
      .maybeSingle();
    if (error) return null;
    return ((data?.logo_url as string | null) ?? "").trim() || null;
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

/**
 * Layout de todo el portal. Acá se resuelve UNA vez quién es el usuario y qué
 * cliente puede ver; si no está autorizado, exigirUsuarioPortal corta el paso.
 *
 * Los contadores del menú se calculan también acá, una sola vez para todas las
 * pantallas. Son dos conteos que la base resuelve por índice sin devolver
 * filas, así que se pagan una vez por navegación y no por página.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const usuario = await exigirUsuarioPortal();
  const contadores = await contadoresMenu(usuario.clienteId);
  const logoUrl = await logoDelNegocio(usuario.clienteId);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar
        clienteNombre={usuario.clienteNombre}
        clienteRubro={usuario.clienteRubro}
        logoUrl={logoUrl}
        email={usuario.email}
        rol={usuario.rol}
        esperando={contadores.esperando}
        porCerrar={contadores.porCerrar}
      />
      <div className="min-w-0 flex-1">{children}</div>
      {/* Avisa cuando la pestaña quedó con una versión vieja, antes de que el
          dueño apriete un botón que ya no existe y se le caiga la pantalla. */}
      <AvisoVersion />
    </div>
  );
}
