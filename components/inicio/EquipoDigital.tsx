import Link from "next/link";
import type { TarjetaEquipo } from "@/lib/inicio";
import { AvatarEmpleado, Estado } from "@/components/estado/Estados";

/**
 * C · TU EQUIPO DIGITAL. Una fila por empleado: qué está haciendo y qué logró.
 * Sin tarjetas por empleado ni tablas de ceros. Apagado se dice «Apagado».
 */
export default function EquipoDigital({ equipo }: { equipo: TarjetaEquipo[] }) {
  return (
    <section aria-labelledby="t-equipo">
      <h2 id="t-equipo" className="mb-2 font-semibold" style={{ fontSize: "var(--t-titulo)" }}>
        Tu equipo digital
      </h2>
      <ul className="tarjeta lista-filas overflow-hidden">
        {equipo.map((e) => (
          <li key={e.clave} className="flex gap-3 px-4 py-3.5">
            <AvatarEmpleado src={e.avatar} color={e.color} nombre={e.nombre} tamano={34} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                  {e.nombre}
                </span>
                <span style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>{e.funcion}</span>
                {e.estado === "apagado" && <Estado tono="neutro">Apagado</Estado>}
              </div>
              <p className="mt-1" style={{ fontSize: "var(--t-cuerpo)", color: "var(--tinta)" }}>
                {e.haciendo}
              </p>
              {e.resultado && (
                <p className="mt-0.5" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                  {e.resultado}
                </p>
              )}
              {e.enlace && (
                <Link
                  href={e.enlace.href}
                  className="mt-1.5 inline-block font-semibold hover:underline"
                  style={{ fontSize: "var(--t-menor)", color: "var(--azul)" }}
                >
                  {e.enlace.label} →
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>
        Cifras de la actividad registrada. Nada estimado.
      </p>
    </section>
  );
}
