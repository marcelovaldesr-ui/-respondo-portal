import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearNumero } from "@/lib/ads/moneda";
import { cargarMarketing } from "@/lib/marketing/datos";
import { modoDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import TablaLeads from "@/components/marketing/TablaLeads";

export const dynamic = "force-dynamic";

/**
 * PERSONAS — quién llegó por un anuncio y en qué quedó.
 *
 * `?f=` preselecciona la etapa (viene del embudo), `?a=` acota a un anuncio
 * (viene de las tablas de anuncios). El resto es la tabla.
 */
export default async function Leads({ searchParams }: { searchParams: Promise<{ p?: string; f?: string; a?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const sp = await searchParams;
  const rango = resolverRango(sp.p);
  const p = await cargarMarketing(usuario.clienteId, rango, { demo });

  const anuncio = sp.a ? p.anuncios.find((a) => a.id === sp.a) : null;
  const leads = anuncio ? p.leads.filter((l) => l.anuncioId === anuncio.id) : p.leads;
  const campanas = Array.from(new Map(p.leads.filter((l) => l.campanaId).map((l) => [l.campanaId!, { id: l.campanaId!, nombre: l.campanaNombre }])).values());
  const calificados = leads.filter((l) => l.calificado).length;
  const compraron = leads.filter((l) => l.compro).length;

  return (
    <main className="mk-pagina">
      <Cabecera
        eyebrow={`Marketing · ${p.demo ? "Gráfica Andina" : usuario.clienteNombre}`}
        titulo={anuncio ? `Personas del anuncio «${anuncio.titular}»` : "Personas"}
        bajada={
          anuncio
            ? `${formatearNumero(leads.length)} personas llegaron desde este anuncio de «${anuncio.campanaNombre}».`
            : `${formatearNumero(leads.length)} personas llegaron desde un anuncio · ${formatearNumero(calificados)} calificadas · ${formatearNumero(compraron)} compraron.`
        }
        demo={p.demo}
        rango={rango}
        base="/marketing/leads"
        extra={{ f: sp.f, a: sp.a }}
        volver={anuncio ? { href: `/marketing/campanas/${encodeURIComponent(anuncio.campanaId)}?p=${rango.clave}&t=anuncios`, texto: anuncio.campanaNombre } : undefined}
      />
      <TablaLeads leads={leads} monedaNegocio={p.monedaNegocio} filtroInicial={sp.f} demo={p.demo} campanas={anuncio ? undefined : campanas} />
    </main>
  );
}
