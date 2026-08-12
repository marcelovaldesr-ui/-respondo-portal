import type { Metadata } from "next";
import { citaPorToken } from "@/lib/autogestionDatos";
import { permisosDeGestion } from "@/lib/autogestion";
import GestionCita from "@/components/GestionCita";

export const dynamic = "force-dynamic";

/**
 * PÁGINA PÚBLICA DE AUTOGESTIÓN — /cita/<token>
 *
 * El enlace se le manda a quien reserva en la confirmación y en el recordatorio
 * de WhatsApp. Desde acá cambia o anula su hora sin escribirle a nadie.
 *
 * `noindex` a propósito: aunque el token es imposible de adivinar, no queremos
 * que un buscador termine con la hora de alguien en sus resultados.
 */
export const metadata: Metadata = {
  title: "Tu hora",
  robots: { index: false, follow: false },
};

export default async function PaginaGestionCita({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const cita = await citaPorToken(token);

  // Mismo mensaje para "no existe", "mal escrito" y "de otro negocio": no le
  // confirmamos a nadie si un token es real, para que no se puedan tantear.
  if (!cita) {
    return (
      <main className="mx-auto max-w-md px-5 py-16">
        <div className="tarjeta p-7 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/isotipo.svg" alt="Respondo" width={32} height={32} className="mx-auto" />
          <h1 className="titular mt-4 text-[21px] font-bold">Este enlace no es válido</h1>
          <p className="mt-2 text-[14.5px]" style={{ color: "var(--muted)" }}>
            Puede que esté incompleto o que la hora ya no exista. Si necesitas
            ayuda, escríbele directo al negocio por WhatsApp.
          </p>
        </div>
      </main>
    );
  }

  const permisos = permisosDeGestion(
    { estado: cita.estado, inicioIso: cita.inicioIso },
    cita.politica,
  );

  return (
    <main className="mx-auto max-w-md px-5 pb-16">
      <GestionCita token={token} cita={cita} permisos={permisos} />
      <p className="mt-5 text-center text-[11.5px]" style={{ color: "var(--muted-2)" }}>
        Agenda gestionada con Respondo
      </p>
    </main>
  );
}
