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
 * Mismo lenguaje que la barra del portal: lienzo claro, ítem activo como
 * tarjeta blanca con borde de 1px, rótulos de grupo en mayúsculas chicas.
 */
const GRUPOS: { rotulo: string | null; items: { href: string; label: string; icono: keyof typeof Ico; exacto?: boolean }[] }[] = [
  { rotulo: null, items: [{ href: "/marketing", label: "Inicio", icono: "inicio", exacto: true }] },
  {
    rotulo: "Analizar",
    items: [
      { href: "/marketing/campanas", label: "Campañas", icono: "campanas" },
      { href: "/marketing/atribucion", label: "Atribución", icono: "atribucion" },
      { href: "/marketing/leads", label: "Leads", icono: "leads" },
    ],
  },
  {
    rotulo: "Crear",
    items: [
      { href: "/marketing/creatividades", label: "Creatividades", icono: "creatividades" },
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

export default function RielMarketing({
  clienteNombre,
  demo,
}: {
  clienteNombre: string;
  demo: boolean;
}) {
  const ruta = usePathname();
  const activo = (href: string, exacto?: boolean) => {
    if (exacto) return ruta === href;
    // «Campañas» no se marca cuando la ruta es «Nueva campaña», que es otro ítem.
    if (href === "/marketing/campanas" && ruta === "/marketing/campanas/nueva") return false;
    return ruta === href || ruta.startsWith(href + "/");
  };

  return (
    <aside className="mk-riel">
      <div className="px-4 pt-4 pb-3">
        <Link
          href="/inicio"
          className="inline-flex items-center gap-1 font-semibold"
          style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
        >
          {Ico.volver()} Volver al portal
        </Link>
        <div className="mt-3 flex items-center gap-2.5">
          <div
            className="grid h-8 w-8 place-items-center rounded-md text-white"
            style={{ background: "var(--indigo)" }}
            aria-hidden="true"
          >
            {Ico.campanas({ className: "h-4 w-4" })}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="font-semibold" style={{ fontSize: "var(--t-fila)", letterSpacing: "-0.01em" }}>
              Marketing
            </div>
            <div className="truncate" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
              {clienteNombre}
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 pb-3" aria-label="Secciones de Marketing">
        {GRUPOS.map((g, i) => (
          <div key={i}>
            {g.rotulo && <div className="mk-riel-grupo">{g.rotulo}</div>}
            {g.items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className="mk-riel-item"
                aria-current={activo(it.href, it.exacto) ? "page" : undefined}
              >
                {Ico[it.icono]()}
                <span>{it.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t px-4 py-3" style={{ borderColor: "var(--nav-borde)" }}>
        <ConmutadorDemo activo={demo} />
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
        <Link href="/inicio" className="inline-flex items-center gap-1 font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
          {Ico.volver()} Portal
        </Link>
        <span className="font-semibold" style={{ fontSize: "var(--t-fila)" }}>Marketing</span>
        {demo && <span className="mk-demo ml-auto">Datos de demostración</span>}
      </div>
      <nav className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Secciones de Marketing">
        {items.map((it) => {
          const act = it.exacto ? ruta === it.href : ruta === it.href || ruta.startsWith(it.href + "/");
          return (
            <Link key={it.href} href={it.href} className="mk-segmento shrink-0" aria-current={act ? "page" : undefined}>
              {it.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
