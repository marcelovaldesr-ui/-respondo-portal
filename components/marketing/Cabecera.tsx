import Link from "next/link";
import { Ico } from "@/components/marketing/Iconos";
import SelectorPeriodo from "@/components/marketing/SelectorPeriodo";
import type { Rango } from "@/lib/ads/periodos";

/**
 * Cabecera de pantalla: qué estoy mirando, de qué negocio, en qué período y
 * qué puedo hacer. Una sola línea, siempre igual, en las once pantallas.
 *
 * Jerarquía: el título pesa (22 px), la bajada acompaña (14 px, gris) y los
 * controles viven a la derecha sin competir. La bajada es OPCIONAL a
 * propósito: la mayoría de las pantallas no necesitan explicarse.
 */
export default function Cabecera({
  titulo,
  bajada,
  cuenta,
  demo,
  rango,
  base,
  extra,
  acciones,
  controles,
  volver,
  estado,
}: {
  titulo: React.ReactNode;
  bajada?: React.ReactNode;
  /** Nombre de la cuenta publicitaria o del negocio, al lado del período. */
  cuenta?: string | null;
  demo?: boolean;
  /** Si viene, se muestra el selector de período apuntando a `base`. */
  rango?: Rango;
  base?: string;
  extra?: Record<string, string | undefined>;
  /** Acción principal (botón). */
  acciones?: React.ReactNode;
  /** Controles secundarios a la izquierda de la acción principal. */
  controles?: React.ReactNode;
  /** Enlace de vuelta, para pantallas de detalle. */
  volver?: { href: string; texto: string };
  /** Píldora de estado bajo el título (campaña, creatividad). */
  estado?: React.ReactNode;
}) {
  return (
    <header className="mk-cabecera">
      <div className="min-w-0">
        {volver && (
          <Link href={volver.href} className="mk-riel-volver mb-2 inline-flex">
            {Ico.volver({ className: "h-3.5 w-3.5" })} {volver.texto}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="mk-titulo">{titulo}</h1>
          {estado}
          {demo && <span className="mk-demo">Datos de demostración</span>}
        </div>
        {bajada && <p className="mk-bajada">{bajada}</p>}
      </div>

      <div className="mk-cabecera-controles">
        {cuenta && (
          <span
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-[7px]"
            style={{ borderColor: "var(--borde)", background: "var(--superficie)", fontSize: "12.5px", fontWeight: 600, color: "var(--muted)" }}
            title="Cuenta publicitaria"
          >
            <span className="grid h-4 w-4 place-items-center" style={{ color: "#0866ff" }} aria-hidden="true">
              {Ico.meta({ className: "h-4 w-4" })}
            </span>
            {cuenta}
          </span>
        )}
        {controles}
        {rango && base && <SelectorPeriodo rango={rango} base={base} extra={extra} />}
        {acciones}
      </div>
    </header>
  );
}
