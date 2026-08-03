import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import ReservaPublica from "@/components/ReservaPublica";
import ReservaClases from "@/components/ReservaClases";
import { proximasClases } from "@/lib/clases";

export const dynamic = "force-dynamic";

/**
 * PÁGINA PÚBLICA DE RESERVAS (F1) — sin login. Solo existe para clientes con
 * reservas_online = true y slug configurado (se activa en /agenda del portal).
 * Las reservas entran por la misma vía que las citas de WhatsApp: mismos
 * cupos, misma garantía anti doble-reserva.
 */

type Props = { params: { slug: string } };

async function clientePorSlug(slug: string) {
  const { data } = await db()
    .from("ed_clientes")
    .select("id, nombre, rubro")
    .eq("slug", slug)
    .eq("reservas_online", true)
    .eq("activo", true)
    .maybeSingle();
  return data as { id: string; nombre: string; rubro: string | null } | null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const cliente = await clientePorSlug(params.slug);
  return {
    title: cliente ? `Reserva tu hora · ${cliente.nombre}` : "Reservas",
    robots: { index: true },
  };
}

export default async function PaginaReservas({ params }: Props) {
  const cliente = await clientePorSlug(params.slug);
  if (!cliente) notFound();

  const { data: servicios } = await db()
    .from("ed_servicios")
    .select("id, nombre, descripcion, duracion_min, precio_clp")
    .eq("cliente_id", cliente.id)
    .eq("activo", true)
    .order("orden", { ascending: true });

  if (!servicios || servicios.length === 0) notFound();

  /**
   * ¿Este negocio trabaja con clases?
   *
   * Se decide por los datos, no por una casilla de configuración: si tiene
   * sesiones programadas, es un gimnasio; si no, es una clínica o una barbería
   * y la página se ve exactamente igual que antes. Una opción más que marcar
   * sería una cosa más que se nos olvida activar en una implementación.
   *
   * Un negocio puede tener las dos cosas —un gimnasio con clases Y evaluación
   * personal— y por eso las clases van arriba y las horas quedan abajo, en vez
   * de reemplazarse.
   */
  const clases = await proximasClases(cliente.id, { dias: 21 });

  // Iniciales para el círculo del encabezado: da identidad sin pedirle un logo
  // al negocio, que es una fricción más al momento de partir.
  const iniciales = cliente.nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-[19px] font-bold text-white"
          style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)", boxShadow: "var(--glow-indigo)" }}
          aria-hidden
        >
          {iniciales}
        </div>
        <div className="min-w-0">
          <div className="eyebrow">Reserva online</div>
          <h1 className="titular mt-1 text-[26px] font-bold leading-tight sm:text-[29px]">
            {cliente.nombre}
          </h1>
          <p className="mt-1 text-[14.5px]" style={{ color: "var(--muted)" }}>
            Elige tu servicio y tu hora — te llegará la confirmación y el
            recordatorio por WhatsApp.
          </p>
        </div>
      </header>

      {clases.length > 0 && (
        <ReservaClases
          slug={params.slug}
          clases={clases.map((c) => ({
            id: c.id,
            servicio: c.servicioNombre,
            profesional: c.profesionalNombre,
            inicio: c.inicio,
            fin: c.fin,
            lugaresLibres: c.lugaresLibres,
            cupoMaximo: c.cupoMaximo,
          }))}
        />
      )}

      {clases.length > 0 && (
        <h2 className="h-seccion mt-9 mb-1">O reserva una hora personal</h2>
      )}

      <ReservaPublica
        slug={params.slug}
        servicios={servicios.map((s) => ({
          id: s.id as string,
          nombre: s.nombre as string,
          descripcion: (s.descripcion as string) ?? null,
          duracionMin: s.duracion_min as number,
          precioClp: (s.precio_clp as number) ?? null,
        }))}
      />

      <footer className="mt-10 text-center text-[12px]" style={{ color: "var(--muted-2)" }}>
        Reservas con empleados IA por{" "}
        <a href="https://respon-do.com" className="font-bold underline">
          Respondo
        </a>
      </footer>
    </main>
  );
}
