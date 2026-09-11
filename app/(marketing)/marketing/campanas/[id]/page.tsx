import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearMonto, formatearNumero, formatearPorcentaje } from "@/lib/ads/moneda";
import { cargarMarketing } from "@/lib/marketing/datos";
import { armarEmbudo } from "@/lib/marketing/demo";
import { modoDemo } from "@/lib/marketing/modo";
import { serieDeLeads } from "@/lib/marketing/series";
import { textoObjetivo } from "@/lib/marketing/tipos";
import Cabecera from "@/components/marketing/Cabecera";
import Embudo from "@/components/marketing/Embudo";
import GraficoTendencia from "@/components/marketing/GraficoTendencia";
import TablaAnuncios from "@/components/marketing/TablaAnuncios";
import TablaLeads from "@/components/marketing/TablaLeads";
import TarjetaCreatividad from "@/components/marketing/TarjetaCreatividad";
import { EstadoDeCampana } from "@/components/marketing/Estado";
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
 * El resumen cuenta una historia y no muestra una colección de tablas: qué
 * costó, a quién trajo, dónde se cayó la gente y con qué creatividades. Las
 * pestañas existen para PROFUNDIZAR, no para esconder lo básico —por eso el
 * resumen ya trae el embudo, la tendencia y los anuncios—.
 *
 * Las pestañas viven en la URL (`?t=`) para poder compartirlas y para que el
 * servidor arme solo lo que se mira.
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
  const href = (t: string) => `/marketing/campanas/${encodeURIComponent(id)}?p=${rango.clave}&t=${t}`;
  const plata = (v: number | null) =>
    v === null ? "—" : formatearMonto({ valor: v, moneda: campana.moneda }, { monedaDelNegocio: p.monedaNegocio });
  const cpl = campana.gasto !== null && campana.calificados ? campana.gasto / campana.calificados : null;

  return (
    <main className="mk-pagina">
      <Cabecera
        volver={{ href: `/marketing/campanas?p=${rango.clave}`, texto: "Campañas" }}
        titulo={campana.nombre}
        estado={<EstadoDeCampana estado={campana.estado} />}
        bajada={
          <span className="inline-flex flex-wrap items-center gap-x-2.5">
            {campana.objetivo && <span>{textoObjetivo(campana.objetivo)}</span>}
            <span>·</span>
            <span>
              {campana.anuncios} {campana.anuncios === 1 ? "anuncio" : "anuncios"}
            </span>
            {campana.origen === "atribucion" && <span>· vista desde la atribución (Meta no conectada)</span>}
          </span>
        }
        demo={p.demo}
        rango={rango}
        base={`/marketing/campanas/${encodeURIComponent(id)}`}
        extra={{ t: pestana }}
        acciones={
          <Link
            href={`/marketing/copiloto?p=${rango.clave}&q=${encodeURIComponent(`¿Cómo está rindiendo la campaña «${campana.nombre}» y qué cambiarías?`)}`}
            className="btn-suave mk-btn-lg"
          >
            {Ico.copiloto({ className: "h-4 w-4" })} Preguntar al copiloto
          </Link>
        }
      />

      <section className="mk-kpis">
        <Kpi etiqueta="Invertido" valor={plata(campana.gasto)} nota={campana.gasto === null ? "Requiere Meta" : "Según Meta"} />
        <Kpi
          etiqueta="Conversaciones"
          valor={formatearNumero(campana.conversaciones)}
          nota={campana.cpc === null ? "Costo no disponible" : `${plata(campana.cpc)} cada una`}
        />
        <Kpi
          etiqueta="Calificados"
          valor={formatearNumero(campana.calificados)}
          nota={`${formatearPorcentaje(campana.conversaciones ? (campana.calificados / campana.conversaciones) * 100 : null)} de las conv.`}
        />
        <Kpi etiqueta="Cotiz. / reservas" valor={formatearNumero(campana.avanzados)} nota="Pidió precio u hora" />
        <Kpi
          etiqueta="Ventas"
          valor={formatearNumero(campana.ventas)}
          nota={campana.cpv === null ? "Costo no disponible" : `${plata(campana.cpv)} cada una`}
          destacada
        />
        <Kpi
          etiqueta="Ingresos · ROAS"
          valor={campana.cobrado > 0 ? formatearMonto({ valor: campana.cobrado, moneda: p.monedaNegocio }) : "—"}
          nota={campana.roas === null ? `CPL ${cpl === null ? "—" : plata(cpl)}` : `ROAS ${campana.roas.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}× · piso`}
          destacada
        />
      </section>

      <nav className="mk-segmentos my-6" aria-label="Secciones de la campaña">
        {PESTANAS.map((t) => (
          <Link key={t.clave} href={href(t.clave)} className="mk-segmento" aria-pressed={pestana === t.clave}>
            {t.texto}
            {t.clave === "anuncios" && <span className="mk-conteo">{anuncios.length}</span>}
            {t.clave === "leads" && <span className="mk-conteo">{leads.length}</span>}
            {t.clave === "creatividades" && <span className="mk-conteo">{creatividades.length}</span>}
          </Link>
        ))}
      </nav>

      {pestana === "resumen" && (
        <div className="grid gap-6">
          <div className="grid gap-6 xl:grid-cols-12">
            <section className="mk-panel xl:col-span-7">
              <div className="mk-panel-cabecera">
                <h2 className="mk-h2">Qué pasó cada día</h2>
                <span className="mk-meta">Conversaciones, calificados, ventas e ingresos</span>
              </div>
              <div className="mk-panel-cuerpo">
                <GraficoTendencia serie={serie} metaConectada={false} principalInicial="conversaciones" alto={240} />
              </div>
            </section>
            <section className="mk-panel xl:col-span-5">
              <div className="mk-panel-cabecera">
                <h2 className="mk-h2">Dónde se cae la gente</h2>
                <Link href={href("embudo")} className="mk-enlace">
                  Detalle {Ico.flecha({ className: "h-3.5 w-3.5" })}
                </Link>
              </div>
              <div className="mk-panel-cuerpo">
                <Embudo escalones={embudo} compacto enlaces={{ conversaciones: href("leads") }} />
              </div>
              {/* El embudo muestra seis cifras; esta línea dice cuál mirar. Solo
                  se consideran los escalones que el negocio sí controla: lo que
                  pasa antes del clic no se arregla desde Respondo. */}
              {(() => {
                const propios = embudo.filter(
                  (e) => (e.clave === "calificados" || e.clave === "avanzados") && e.tasa !== null && e.valor !== null,
                );
                if (!propios.length) return null;
                const peor = propios.reduce((a, b) => ((a.tasa ?? 100) <= (b.tasa ?? 100) ? a : b));
                const i = embudo.findIndex((e) => e.clave === peor.clave);
                const previo = embudo[i - 1];
                if (!previo) return null;
                return (
                  <div className="mk-panel-pie">
                    El corte más grande está entre <strong>{previo.etiqueta.toLowerCase()}</strong> y{" "}
                    <strong>{peor.etiqueta.toLowerCase()}</strong>: pasa el {formatearPorcentaje(peor.tasa)}.
                  </div>
                );
              })()}
            </section>
          </div>

          <section className="mk-panel">
            <div className="mk-panel-cabecera">
              <h2 className="mk-h2">Anuncios de esta campaña</h2>
              <Link href={href("anuncios")} className="mk-enlace">
                Todos {Ico.flecha({ className: "h-3.5 w-3.5" })}
              </Link>
            </div>
            <TablaAnuncios anuncios={anuncios.slice(0, 4)} monedaNegocio={p.monedaNegocio} periodo={rango.clave} />
          </section>

          {creatividades.length > 0 && (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="mk-h2">Creatividades</h2>
                <Link href={href("creatividades")} className="mk-enlace">
                  Ver todas {Ico.flecha({ className: "h-3.5 w-3.5" })}
                </Link>
              </div>
              <div className="mk-galeria">
                {creatividades.slice(0, 4).map((c) => (
                  <TarjetaCreatividad key={c.id} c={c} monedaNegocio={p.monedaNegocio} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {pestana === "anuncios" && (
        <section className="mk-panel">
          <div className="mk-panel-cabecera">
            <h2 className="mk-h2">Anuncios</h2>
            <span className="mk-meta">Ordenados por lo que cobraron</span>
          </div>
          <TablaAnuncios anuncios={anuncios} monedaNegocio={p.monedaNegocio} periodo={rango.clave} />
        </section>
      )}

      {pestana === "embudo" && (
        <div className="grid gap-6">
          <section className="mk-panel">
            <div className="mk-panel-cabecera">
              <h2 className="mk-h2">Del anuncio a la venta</h2>
              <span className="mk-meta">{campana.nombre}</span>
            </div>
            <div className="mk-panel-cuerpo" style={{ paddingTop: 36 }}>
              <Embudo
                escalones={embudo}
                enlaces={{
                  conversaciones: href("leads"),
                  calificados: `${href("leads")}&f=calificados`,
                  avanzados: `${href("leads")}&f=cotizados`,
                  ventas: `${href("leads")}&f=compraron`,
                }}
              />
            </div>
          </section>
          <section className="mk-panel">
            <div className="mk-panel-cabecera">
              <h2 className="mk-h2">Cómo leerlo</h2>
            </div>
            <div className="mk-panel-cuerpo grid gap-5 md:grid-cols-2" style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6 }}>
              <p>
                <strong style={{ color: "var(--tinta)" }}>Impresiones y clics</strong> los reporta Meta y solo aparecen con la cuenta
                conectada.
              </p>
              <p>
                <strong style={{ color: "var(--tinta)" }}>Conversaciones</strong> son las personas que efectivamente escribieron por
                WhatsApp desde un anuncio de esta campaña. Es la primera cifra que Meta no puede ver.
              </p>
              <p>
                <strong style={{ color: "var(--tinta)" }}>Calificados</strong> avanzaron a «interesado» o más, o cotizaron, reservaron o
                compraron. Si esta tasa es baja, el anuncio promete algo distinto de lo que la persona encuentra al escribir.
              </p>
              <p>
                <strong style={{ color: "var(--tinta)" }}>Ventas</strong> se atribuyen al primer anuncio pagado que trajo a la persona,
                aunque haya comprado semanas después. Los ingresos solo suman lo pagado por enlace, así que son un piso.
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
            <div className="mk-panel">
              <div className="vacio">
                <div className="vacio-titulo">Esta campaña no tiene creatividades en el estudio</div>
                <p className="vacio-texto">
                  Las que corren en Meta se ven en «Anuncios». Acá aparecen las que creas o asignas desde el estudio, con su rendimiento
                  cuando se puede cruzar.
                </p>
                <Link href={`/marketing/creatividades/nueva?campana=${encodeURIComponent(id)}`} className="btn-primario mk-btn-lg mt-5">
                  Crear una creatividad para esta campaña
                </Link>
              </div>
            </div>
          ) : (
            <div className="mk-galeria grande">
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

function Kpi({ etiqueta, valor, nota, destacada }: { etiqueta: string; valor: string; nota: string; destacada?: boolean }) {
  return (
    <div className="mk-kpi">
      <div className="mk-kpi-etiqueta">{etiqueta}</div>
      <div className={`mk-kpi-valor ${valor === "—" ? "sin-dato" : destacada ? "destacada" : ""}`}>{valor}</div>
      <div className="mk-kpi-pie">
        <span className="truncate">{nota}</span>
      </div>
    </div>
  );
}
