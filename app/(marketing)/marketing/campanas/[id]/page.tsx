import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearMonto, formatearNumero, formatearPorcentaje } from "@/lib/ads/moneda";
import { cargarMarketing } from "@/lib/marketing/datos";
import { armarEmbudo } from "@/lib/marketing/demo";
import { modoDemo } from "@/lib/marketing/modo";
import { serieDeLeads } from "@/lib/marketing/series";
import { ESTADO_CAMPANA, textoObjetivo } from "@/lib/marketing/tipos";
import Cabecera from "@/components/marketing/Cabecera";
import Embudo from "@/components/marketing/Embudo";
import GraficoTendencia from "@/components/marketing/GraficoTendencia";
import TablaAnuncios from "@/components/marketing/TablaAnuncios";
import TablaLeads from "@/components/marketing/TablaLeads";
import TarjetaCreatividad from "@/components/marketing/TarjetaCreatividad";
import { Ico } from "@/components/marketing/Iconos";

export const dynamic = "force-dynamic";

const PESTANAS = [
  { clave: "resumen", texto: "Resumen" },
  { clave: "anuncios", texto: "Anuncios" },
  { clave: "embudo", texto: "Embudo" },
  { clave: "leads", texto: "Personas" },
  { clave: "creatividades", texto: "Creatividades" },
] as const;

type Pestana = (typeof PESTANAS)[number]["clave"];

/**
 * UNA CAMPAÑA POR DENTRO.
 *
 * La misma pregunta del inicio, pero para una sola campaña: cuánto costó, a
 * quién trajo y en qué quedó cada persona. Las pestañas viven en la URL
 * (`?t=`) para que se puedan compartir y para que el servidor arme solo lo
 * que se mira.
 */
export default async function DetalleCampana({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ p?: string; t?: string; f?: string }>;
}) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const { id } = await params;
  const sp = await searchParams;
  const rango = resolverRango(sp.p);
  const pestana: Pestana = PESTANAS.some((x) => x.clave === sp.t) ? (sp.t as Pestana) : "resumen";

  const p = await cargarMarketing(usuario.clienteId, rango, { demo });
  const campana = p.campanas.find((c) => c.id === id);
  if (!campana) notFound();
  if (campana.origen === "borrador") redirect(`/marketing/campanas/nueva?id=${encodeURIComponent(id)}`);

  const anuncios = p.anuncios.filter((a) => a.campanaId === id);
  const leads = p.leads.filter((l) => l.campanaId === id);
  const creatividades = p.creatividades.filter((c) => c.campanaId === id);
  const serie = serieDeLeads(rango, leads);
  const embudo = armarEmbudo({
    impresiones: campana.impresiones,
    clics: campana.clics,
    conversaciones: campana.conversaciones,
    calificados: campana.calificados,
    avanzados: campana.avanzados,
    ventas: campana.ventas,
  });
  const est = ESTADO_CAMPANA[campana.estado];
  const extra = { t: pestana };
  const hrefPestana = (t: string) => `/marketing/campanas/${encodeURIComponent(id)}?p=${rango.clave}&t=${t}`;
  const plata = (v: number | null) =>
    v === null ? "—" : formatearMonto({ valor: v, moneda: campana.moneda }, { monedaDelNegocio: p.monedaNegocio });

  return (
    <main className="mk-pagina">
      <Cabecera
        volver={{ href: `/marketing/campanas?p=${rango.clave}`, texto: "Campañas" }}
        titulo={campana.nombre}
        bajada={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className={est.clase}>{est.texto}</span>
            {campana.objetivo && <span>{textoObjetivo(campana.objetivo)}</span>}
            <span>· {campana.anuncios} {campana.anuncios === 1 ? "anuncio" : "anuncios"}</span>
            {campana.origen === "atribucion" && <span>· vista desde la atribución (Meta no conectada)</span>}
          </span>
        }
        demo={p.demo}
        rango={rango}
        base={`/marketing/campanas/${encodeURIComponent(id)}`}
        extra={extra}
        acciones={
          <Link href={`/marketing/copiloto?p=${rango.clave}&q=${encodeURIComponent(`¿Cómo está rindiendo la campaña «${campana.nombre}» y qué cambiarías?`)}`} className="btn-suave">
            {Ico.copiloto()} Preguntar al copiloto
          </Link>
        }
      />

      {/* Cifras de la campaña */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Cifra etiqueta="Gasto" valor={plata(campana.gasto)} nota={campana.gasto === null ? "Sin Meta" : "Según Meta"} />
        <Cifra etiqueta="Clics" valor={campana.clics === null ? "—" : formatearNumero(campana.clics)} nota={campana.impresiones === null ? "Sin Meta" : `${formatearNumero(campana.impresiones)} impresiones`} />
        <Cifra etiqueta="Conversaciones" valor={formatearNumero(campana.conversaciones)} nota={campana.cpc === null ? "Costo no disponible" : `${plata(campana.cpc)} c/u`} />
        <Cifra etiqueta="Calificados" valor={formatearNumero(campana.calificados)} nota={formatearPorcentaje(campana.conversaciones ? (campana.calificados / campana.conversaciones) * 100 : null) + " de las conversaciones"} />
        <Cifra etiqueta="Cotiz. / reservas" valor={formatearNumero(campana.avanzados)} nota="Cotización enviada u hora tomada" />
        <Cifra etiqueta="Ventas" valor={formatearNumero(campana.ventas)} nota={campana.cpv === null ? "Costo no disponible" : `${plata(campana.cpv)} c/u`} fuerte />
        <Cifra etiqueta="Cobrado · ROAS" valor={campana.cobrado > 0 ? formatearMonto({ valor: campana.cobrado, moneda: p.monedaNegocio }) : "—"} nota={campana.roas === null ? "ROAS no disponible" : `ROAS ${campana.roas.toFixed(1)}× (piso)`} fuerte />
      </div>

      <nav className="mk-segmentos mb-4" aria-label="Secciones de la campaña">
        {PESTANAS.map((t) => (
          <Link key={t.clave} href={hrefPestana(t.clave)} className="mk-segmento" aria-pressed={pestana === t.clave}>
            {t.texto}
            {t.clave === "anuncios" && <span className="ml-1" style={{ color: "var(--muted-3)", fontWeight: 500 }}>{anuncios.length}</span>}
            {t.clave === "leads" && <span className="ml-1" style={{ color: "var(--muted-3)", fontWeight: 500 }}>{leads.length}</span>}
            {t.clave === "creatividades" && <span className="ml-1" style={{ color: "var(--muted-3)", fontWeight: 500 }}>{creatividades.length}</span>}
          </Link>
        ))}
      </nav>

      {pestana === "resumen" && (
        <div className="grid gap-5 lg:grid-cols-12">
          <section className="tarjeta mk-seccion lg:col-span-8">
            <div className="mk-seccion-cabecera">
              <h2 className="h-seccion">Tendencia de la campaña</h2>
              <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>Conversaciones, calificados, ventas y cobrado por día</span>
            </div>
            <div className="mk-seccion-cuerpo">
              <GraficoTendencia serie={serie} metaConectada={false} />
            </div>
          </section>
          <section className="tarjeta mk-seccion lg:col-span-4">
            <div className="mk-seccion-cabecera">
              <h2 className="h-seccion">Embudo</h2>
              <Link href={hrefPestana("embudo")} className="font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}>
                Ver detalle →
              </Link>
            </div>
            <div className="mk-seccion-cuerpo">
              <Embudo escalones={embudo} compacto enlaces={{ conversaciones: hrefPestana("leads") }} />
            </div>
          </section>
          <section className="tarjeta mk-seccion lg:col-span-12">
            <div className="mk-seccion-cabecera">
              <h2 className="h-seccion">Anuncios de esta campaña</h2>
              <Link href={hrefPestana("anuncios")} className="font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}>
                Todos →
              </Link>
            </div>
            <TablaAnuncios anuncios={anuncios.slice(0, 5)} monedaNegocio={p.monedaNegocio} periodo={rango.clave} />
          </section>
        </div>
      )}

      {pestana === "anuncios" && (
        <section className="tarjeta mk-seccion">
          <div className="mk-seccion-cabecera">
            <h2 className="h-seccion">Anuncios</h2>
            <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>Ordenados por lo que cobraron</span>
          </div>
          <TablaAnuncios anuncios={anuncios} monedaNegocio={p.monedaNegocio} periodo={rango.clave} />
        </section>
      )}

      {pestana === "embudo" && (
        <div className="grid gap-5 lg:grid-cols-12">
          <section className="tarjeta mk-seccion lg:col-span-7">
            <div className="mk-seccion-cabecera">
              <h2 className="h-seccion">Del anuncio a la venta</h2>
            </div>
            <div className="mk-seccion-cuerpo">
              <Embudo
                escalones={embudo}
                enlaces={{
                  conversaciones: hrefPestana("leads"),
                  calificados: `${hrefPestana("leads")}&f=calificados`,
                  avanzados: `${hrefPestana("leads")}&f=cotizados`,
                  ventas: `${hrefPestana("leads")}&f=compraron`,
                }}
              />
            </div>
          </section>
          <section className="tarjeta mk-seccion lg:col-span-5">
            <div className="mk-seccion-cabecera">
              <h2 className="h-seccion">Cómo leerlo</h2>
            </div>
            <div className="mk-seccion-cuerpo space-y-3" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
              <p>
                <strong style={{ color: "var(--tinta)" }}>Impresiones y clics</strong> los reporta Meta y solo aparecen con la cuenta conectada.
              </p>
              <p>
                <strong style={{ color: "var(--tinta)" }}>Conversaciones</strong> son las personas que efectivamente escribieron por WhatsApp desde un anuncio de esta campaña. Es la primera cifra que Meta no puede ver.
              </p>
              <p>
                <strong style={{ color: "var(--tinta)" }}>Calificados</strong> avanzaron a «interesado» o más, o cotizaron, reservaron o compraron. Si esta tasa es baja, el anuncio promete algo distinto de lo que la persona encuentra al escribir.
              </p>
              <p>
                <strong style={{ color: "var(--tinta)" }}>Ventas</strong> se atribuyen al primer anuncio pagado que trajo a la persona, aunque haya comprado semanas después. «Cobrado» solo suma lo pagado por enlace, así que es un piso.
              </p>
            </div>
          </section>
        </div>
      )}

      {pestana === "leads" && (
        <TablaLeads leads={leads} monedaNegocio={p.monedaNegocio} filtroInicial={sp.f ?? "todos"} demo={p.demo} ocultarCampana />
      )}

      {pestana === "creatividades" && (
        <section>
          {creatividades.length === 0 ? (
            <div className="tarjeta">
              <div className="vacio">
                <div className="vacio-titulo">Esta campaña no tiene creatividades en el estudio</div>
                <p className="vacio-texto">
                  Las que corren en Meta se ven en la pestaña «Anuncios». Acá aparecen las que creas o asignas desde el estudio creativo, con su rendimiento cuando se puede cruzar.
                </p>
                <Link href={`/marketing/creatividades/nueva?campana=${encodeURIComponent(id)}`} className="btn-primario mt-4">
                  Crear una creatividad para esta campaña
                </Link>
              </div>
            </div>
          ) : (
            <div className="mk-galeria">
              {creatividades.map((c) => (
                <TarjetaCreatividad key={c.id} c={c} monedaNegocio={p.monedaNegocio} />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function Cifra({ etiqueta, valor, nota, fuerte }: { etiqueta: string; valor: string; nota: string; fuerte?: boolean }) {
  return (
    <div className="tarjeta px-3.5 py-3">
      <div className="mk-metrica-etiqueta">{etiqueta}</div>
      <div className="cifra mt-1 truncate" style={{ fontSize: "var(--t-ficha)", fontWeight: 600, letterSpacing: "-0.02em", color: fuerte ? "var(--indigo)" : valor === "—" ? "var(--muted-3)" : "var(--tinta)" }}>
        {valor}
      </div>
      <div className="mt-0.5 truncate" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{nota}</div>
    </div>
  );
}
