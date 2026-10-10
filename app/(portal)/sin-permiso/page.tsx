import Link from "next/link";
import { obtenerUsuarioPortal } from "@/lib/auth";
import { MENSAJE_SOLO_MENSAJERIA } from "@/lib/soloMensajeria";

export const dynamic = "force-dynamic";

export default async function SinPermiso() {
  const usuario = await obtenerUsuarioPortal();
  // Cuentas de solo mensajería (migración 322): se explica por qué el control está bloqueado.
  const solo = Boolean(usuario?.soloMensajeria);
  return (
    <main className="mx-auto max-w-xl px-5 py-16 text-center">
      <h1 className="h-pagina">
        {solo ? MENSAJE_SOLO_MENSAJERIA : "Esta acción necesita permiso de dueño"}
      </h1>
      <p className="mt-3" style={{ color: "var(--muted)" }}>
        {solo
          ? "Aquí no hay empleados de IA: solo se atienden las conversaciones a mano y se envían los avisos que pide tu sistema."
          : "Tu sesión sigue activa. Pídele al dueño del negocio que realice este cambio."}
      </p>
      <Link href={solo ? "/conversaciones" : "/inicio"} className="btn-primario mt-6 inline-flex">
        {solo ? "Ir a las conversaciones" : "Volver al inicio"}
      </Link>
    </main>
  );
}
