import Sidebar from "@/components/Sidebar";
import { exigirUsuarioPortal } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Layout de todo el portal. Acá se resuelve UNA vez quién es el usuario y qué
 * cliente puede ver; si no está autorizado, exigirUsuarioPortal corta el paso.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const usuario = await exigirUsuarioPortal();

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar
        clienteNombre={usuario.clienteNombre}
        clienteRubro={usuario.clienteRubro}
        email={usuario.email}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
