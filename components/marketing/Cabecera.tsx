import Link from "next/link";
import { Ico } from "@/components/marketing/Iconos";
import SelectorPeriodo from "@/components/marketing/SelectorPeriodo";
import type { Rango } from "@/lib/ads/periodos";

/**
 * Cabecera de cada pantalla: dónde estoy, de qué negocio, qué período miro y
 * qué acción principal tengo. Una sola línea, siempre igual. Es lo que hace
 * que las ocho pantallas se sientan una sola herramienta.
 */
export default function Cabecera({
  eyebrow = "Marketing",
  titulo,
  bajada,
  cuenta,
  demo,
  rango,
  base,
  extra,
  acciones,
  volver,
}: {
  eyebrow?: string;
  titulo: React.ReactNode;
  bajada?: React.ReactNode;
  /** Nombre de la cuenta/negocio que se muestra al lado del período. */
  cuenta?: string | null;
  demo?: boolean;
  /** Si viene, se muestra el selector de período apuntando a `base`. */
  rango?: Rango;
  base?: string;
  extra?: Record<string, string | undefined>;
  acciones?: React.ReactNode;
  /** Enlace de vuelta (para pantallas de detalle). */
  volver?: { href: string; texto: string };
}) {
  return (
    <header className="mk-cabecera">
      <div className="min-w-0">
        {volver ? (
          <Link href={volver.href} className="inline-flex items-center gap-1 font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
            {Ico.volver()} {volver.texto}
          </Link>
        ) : (
          <div className="eyebrow">{eyebrow}</div>
        )}
        <h1 className="mk-titulo mt-1 flex flex-wrap items-center gap-2">
          {titulo}
          {demo && <span className="mk-demo">Datos de demostración</span>}
        </h1>
        {bajada && (
          <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
            {bajada}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {cuenta && (
          <span className="pildora-neutra" title="Cuenta publicitaria">
            {cuenta}
          </span>
        )}
        {rango && base && <SelectorPeriodo rango={rango} base={base} extra={extra} />}
        {acciones}
      </div>
    </header>
  );
}
