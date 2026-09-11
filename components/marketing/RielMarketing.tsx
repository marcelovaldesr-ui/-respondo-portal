"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ico } from "@/components/marketing/Iconos";
import ConmutadorDemo from "@/components/marketing/ConmutadorDemo";

/**
 * EL RIEL DEL CENTRO DE MARKETING.
 *
 * Tres verbos y no ocho sustantivos. Quien entra viene a ANALIZAR qué está
 * pasando, a CREAR el próximo anuncio o campaña, o a OPTIMIZAR con ayuda del
 * copiloto y las integraciones. Agrupar por verbo hace que el riel se lea
 * como un flujo de trabajo y no como un índice.
 *
 * Mismo lenguaje que la barra del portal (lienzo claro, ítem activo como
 * tarjeta blanca) pero con más peso: Marketing es un módulo del producto, no
 * una herramienta incrustada, y el riel es lo primero que lo dice.
 */
const GRUPOS: {
  rotulo: string | null;
  items: { href: string; label: string; icono: keyof typeof Ico; exacto?: boolean }[];
}[] = [
  { rotulo: null, items: [{ href: "/marketing", label: "Inicio", icono: "inicio", exacto: true }] },
  {
    rotulo: "Analizar",
    items: [
      { href: "/marketing/campanas", label: "Campañas", icono: "campanas" },
      { href: "/marketing/atribucion", label: "Atribución", icono: "atribucion" },
      { href: "/marketing/leads", label: "Personas", icono: "leads" },
    ],
  },
  {
    rotulo: "Crear",
    items: [
      { href: "/marketing/creatividades", label: "Estudio creativo", icono: "creatividades" },
      { href: "/marketing/campanas/nueva", label: "Nueva campaña", icono: "nueva", exacto: true },
    ],
  },
  {
    rotulo: "Optimizar",
    items: [
      { href: "/marketing/copiloto", label: "Copiloto", icono: "copiloto" },
      { href: "/marketing/integraciones", label: "Integraciones", icono: "integraciones" },
    ],
  },
];

function esActivo(ruta: string, href: string, exacto?: boolean) {
  if (exacto) return ruta === href;
  if (href === "/marketing/campanas" && ruta === "/marketing/campanas/nueva") return false;
  return ruta === href || ruta.startsWith(href + "/");
}

export default function RielMarketing({
  clienteNombre,
  demo,
}: {
  clienteNombre: string;
  demo: boolean;
}) {
  const ruta = usePathname();

  return (
    <aside className="mk-riel">
      <div className="mk-riel-marca">
        <Link href="/inicio" className="mk-riel-volver">
          {Ico.volver({ className: "h-3.5 w-3.5" })} Volver al portal
        </Link>
        <div className="mt-3.5 flex items-center gap-3">
          <div className="mk-riel-logo" aria-hidden="true">
            {Ico.campanas({ className: "h-[18px] w-[18px]" })}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="font-semibold" style={{ fontSize: "15px", letterSpacing: "-0.015em" }}>
              Marketing
            </div>
            <div className="truncate" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
              {clienteNombre}
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 pb-4" aria-label="Secciones de Marketing">
        {GRUPOS.map((g, i) => (
          <div key={i}>
            {g.rotulo && <div className="mk-riel-grupo">{g.rotulo}</div>}
            {g.items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className="mk-riel-item"
                aria-current={esActivo(ruta, it.href, it.exacto) ? "page" : undefined}
              >
                {Ico[it.icono]()}
                <span>{it.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="mk-riel-pie">
        <div className="mk-riel-demo" data-activo={demo}>
          <ConmutadorDemo activo={demo} />
        </div>
      </div>
    </aside>
  );
}

/** La versión para pantallas angostas: una franja con las secciones. */
export function FranjaMarketing({ demo }: { demo: boolean }) {
  const ruta = usePathname();
  const items = GRUPOS.flatMap((g) => g.items);
  return (
    <div className="lg:hidden" style={{ background: "var(--nav-bg)", borderBottom: "1px solid var(--nav-borde)" }}>
      <div className="flex items-center gap-3 px-4 pt-3">
        <Link href="/inicio" className="mk-riel-volver">
          {Ico.volver({ className: "h-3.5 w-3.5" })} Portal
        </Link>
        <span className="font-semibold" style={{ fontSize: "14px" }}>
          Marketing
        </span>
        {demo && <span className="mk-demo ml-auto">Demostración</span>}
      </div>
      <nav className="-mx-1 mt-2.5 flex gap-1 overflow-x-auto px-3 pb-2.5" aria-label="Secciones de Marketing">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="mk-segmento shrink-0"
            aria-current={esActivo(ruta, it.href, it.exacto) ? "page" : undefined}
          >
            {it.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
