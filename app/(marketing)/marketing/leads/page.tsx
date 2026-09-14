import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import { cargarMarketing } from "@/lib/marketing/datos";
import { opcionesDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import TablaLeads from "@/components/marketing/TablaLeads";

export const dynamic = "force-dynamic";

/**
 * PERSONAS — quién llegó por un anuncio y en qué quedó.
 *
 * `?f=` preselecciona la etapa (viene del embudo) y `?a=` acota a un anuncio
 * (viene de las tablas de anuncios). El resto lo resuelve la tabla.
 */
export default async function Leads({ searchParams }: { searchParams: Promise<{ p?: string; f?: string; a?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const { demo, variante } = await opcionesDemo();
  const sp = await searchParams;
  const rango = resolverRango(sp.p);
  const p = await cargarMarketing(usuario.clienteId, rango, { demo, variante });

  const anuncio = sp.a ? p.anuncios.find((a) => a.id === sp.a) : null;
  const leads = anuncio ? p.leads.filter((l) => l.anuncioId === anuncio.id) : p.leads;
  const campanas = Array.from(
    new Map(p.leads.filter((l) => l.campanaId).map((l) => [l.campanaId!, { id: l.campanaId!, nombre: l.campanaNombre }])).values(),
  );
  const calificados = leads.filter((l) => l.calificado).length;
  const compraron = leads.filter((l) => l.compro).length;
  const cobrado = leads.reduce((a, l) => a + l.cobrado, 0);

  return (
    <main className="mk-pagina">
      <Cabecera
        titulo={anuncio ? `Personas de «${anuncio.titular}»` : "Personas"}
        bajada={
          anuncio
            ? `Llegaron desde este anuncio de «${anuncio.campanaNombre}».`
            : undefined
        }
        demo={p.demo}
        rango={rango}
        base="/marketing/leads"
        extra={{ f: sp.f, a: sp.a }}
        volver={
          anuncio
            ? { href: `/marketing/campanas/${encodeURIComponent(anuncio.campanaId)}?p=${rango.clave}&t=anuncios`, texto: anuncio.campanaNombre }
            : undefined
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Dato etiqueta="Llegaron por un anuncio" valor={formatearNumero(leads.length)} />
        <Dato etiqueta="Calificados" valor={formatearNumero(calificados)} nota={leads.length ? `${Math.round((calificados / leads.length) * 100)}% de los que llegaron` : undefined} />
        <Dato etiqueta="Compraron" valor={formatearNumero(compraron)} nota={leads.length ? `${Math.round((compraron / leads.length) * 100)}% de los que llegaron` : undefined} />
        <Dato etiqueta="Ingresos atribuidos" valor={cobrado > 0 ? formatearMonto({ valor: cobrado, moneda: p.monedaNegocio }) : "—"} nota="Al menos: lo cobrado por enlace de pago" fuerte />
      </div>

      <TablaLeads
        leads={leads}
        monedaNegocio={p.monedaNegocio}
        filtroInicial={sp.f}
        demo={p.demo}
        campanas={anuncio ? undefined : campanas}
      />
    </main>
  );
}

function Dato({ etiqueta, valor, nota, fuerte }: { etiqueta: string; valor: string; nota?: string; fuerte?: boolean }) {
  return (
    <div className="mk-panel px-5 py-4">
      <div className="mk-kpi-etiqueta">{etiqueta}</div>
      <div
        className="cifra mt-2 truncate"
        style={{ fontSize: "21px", fontWeight: 600, letterSpacing: "-0.025em", color: fuerte ? "var(--indigo)" : valor === "—" ? "var(--muted-3)" : "var(--tinta)" }}
      >
        {valor}
      </div>
      <div className="mt-1.5" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
        {nota ?? " "}
      </div>
    </div>
  );
}
