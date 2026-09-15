import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearMonto, formatearNumero, formatearPorcentaje } from "@/lib/ads/moneda";
import { ctr, ETIQUETA_RESULTADO, type FilaRendimiento } from "@/lib/ads/canal";
import { rendimientoMulticanal } from "@/lib/ads/canales";
import { cargarMarketing } from "@/lib/marketing/datos";
import { armarEmbudoAdaptativo, tituloEmbudo } from "@/lib/marketing/embudoAdaptativo";
import { opcionesDemo } from "@/lib/marketing/modo";
import { motivoFaltante } from "@/lib/ads/senales";
import { serieDeLeads } from "@/lib/marketing/series";
import { textoObjetivo, type FilaAnuncio } from "@/lib/marketing/tipos";
import Cabecera from "@/components/marketing/Cabecera";
import Embudo from "@/components/marketing/Embudo";
import GraficoTendencia from "@/components/marketing/GraficoTendencia";
import TablaAnuncios, { TablaAnunciosDePlataforma } from "@/components/marketing/TablaAnuncios";
import TablaLeads from "@/components/marketing/TablaLeads";
import TarjetaCreatividad from "@/components/marketing/TarjetaCreatividad";
import { EstadoDeCampana } from "@/components/marketing/Estado";
import { Ico } from "@/components/marketing/Iconos";
import { motivoSinPublicidad } from "@/lib/marketing/capacidades";

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
 *
 * ⭐ Y se arma con las SEÑALES del negocio, igual que la portada: la mitad de
 * esta pantalla hablaba de conversaciones de WhatsApp, y una campaña de Google
 * en un negocio que no las tiene mostraba cinco cifras en cero y un embudo con
 * cuatro escalones muertos.
 */
export default async function DetalleCampana({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ p?: string; t?: string; f?: string }>;
}) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const { demo, variante } = await opcionesDemo();
  const { id } = await params;
  const sp = await searchParams;
  const rango = resolverRango(sp.p);

  const p = await cargarMarketing(usuario.clienteId, rango, { demo, variante });
  const campana = p.campanas.find((c) => c.id === id);
  if (!campana) notFound();
  if (campana.origen === "borrador") redirect(`/marketing/campanas/nueva?id=${encodeURIComponent(id)}`);

  /**
   * «Personas» no se ofrece sin conversaciones propias: sería una pestaña que
   * nunca va a tener nada, exactamente lo que `seccionesVisibles` ya evita en
   * el riel. Una pestaña muerta acá enseña lo mismo que una sección muerta allá.
   */
  const pestanas = PESTANAS.filter((t) => t.clave !== "leads" || p.senales.conversaciones);
  const pestana: Pestana = pestanas.some((x) => x.clave === sp.t) ? (sp.t as Pestana) : "resumen";

  const anuncios = p.anuncios.filter((a) => a.campanaId === id);
  const leads = p.leads.filter((l) => l.campanaId === id);
  const creatividades = p.creatividades.filter((c) => c.campanaId === id);
  const serie = serieDeLeads(rango, leads);

  /**
   * LOS ANUNCIOS DE LA PLATAFORMA, CUANDO NO HAY NINGUNO ATRIBUIDO.
   *
   * `p.anuncios` se arma desde las conversaciones atribuidas, así que un
   * negocio sin WhatsApp tenía la pestaña «Anuncios» permanentemente vacía
   * aunque la campaña estuviera gastando. El panorama ya trae el nivel campaña
   * en `filasAds`; el nivel anuncio se pide acá —donde se muestra— y no en cada
   * carga del inicio, igual que hace «Búsqueda» con las palabras y términos.
   */
  const deLaCampana = (filas: FilaRendimiento[]) =>
    filas.filter((f) => f.nivel === "anuncio" && f.campanaId === id);
  let anunciosPlataforma = deLaCampana(p.filasAds);
  if (!anunciosPlataforma.length && !anuncios.length && !p.demo && campana.origen !== "atribucion") {
    anunciosPlataforma = deLaCampana((await rendimientoMulticanal(usuario.clienteId, rango, ["anuncio"])).filas);
  }
  const totalAnuncios = anuncios.length || anunciosPlataforma.length;

  /**
   * El embudo era el RÍGIDO de seis escalones de `demo.ts`: anuncio →
   * conversación de WhatsApp → calificado → cotización → venta. En una campaña
   * de Google sin WhatsApp cuatro de seis quedaban en cero permanente, que no
   * se lee como «esto no aplica» sino como «acá no vende nadie». Se arma con
   * las mismas señales que la portada, con el resultado que declara la
   * plataforma en el escalón del medio.
   */
  const embudo = armarEmbudoAdaptativo(
    {
      impresiones: campana.impresiones,
      clics: campana.clics,
      resultados: campana.resultados ?? null,
      tipoResultado: campana.tipoResultado ?? null,
      conversaciones: campana.conversaciones,
      calificados: campana.calificados,
      avanzados: campana.avanzados,
      ventas: campana.ventas,
    },
    p.senales,
  );

  const href = (t: string) => `/marketing/campanas/${encodeURIComponent(id)}?p=${rango.clave}&t=${t}`;
  const plata = (v: number | null) =>
    v === null ? "—" : formatearMonto({ valor: v, moneda: campana.moneda }, { monedaDelNegocio: p.monedaNegocio });
  const cpl = campana.gasto !== null && campana.calificados ? campana.gasto / campana.calificados : null;
  const ctrCampana = ctr({ impresiones: campana.impresiones ?? 0, clics: campana.clics ?? 0 });
  const motivoPublicidad = motivoSinPublicidad(p.capacidades, p.errorPublicidad);
  const enlacesEmbudo = p.senales.conversaciones
    ? {
        conversaciones: href("leads"),
        calificados: `${href("leads")}&f=calificados`,
        avanzados: `${href("leads")}&f=avanzaron`,
        ventas: `${href("leads")}&f=compraron`,
      }
    : undefined;

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
            {campana.origen === "atribucion" && <span>· vista desde la atribución (sin cifras de la plataforma)</span>}
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
        <Kpi
          etiqueta="Invertido"
          valor={plata(campana.gasto)}
          nota={campana.gasto === null ? motivoPublicidad : "Según tu cuenta publicitaria"}
        />
        {p.senales.conversaciones ? (
          <>
            <Kpi
              etiqueta="Conversaciones"
              valor={formatearNumero(campana.conversaciones)}
              nota={campana.costoPorConversacion === null ? "Costo no disponible" : `${plata(campana.costoPorConversacion)} cada una`}
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
              nota={campana.costoPorVenta === null ? "Costo no disponible" : `${plata(campana.costoPorVenta)} cada una`}
              destacada
            />
            <Kpi
              etiqueta="Ingresos · ROAS"
              valor={campana.cobrado > 0 ? formatearMonto({ valor: campana.cobrado, moneda: p.monedaNegocio }) : "—"}
              nota={campana.roas === null ? `CPL ${cpl === null ? "—" : plata(cpl)}` : `ROAS ${campana.roas.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`}
              destacada
            />
          </>
        ) : (
          <>
            <Kpi
              etiqueta="Impresiones"
              valor={campana.impresiones === null ? "—" : formatearNumero(campana.impresiones)}
              nota={campana.impresiones === null ? motivoPublicidad : "Veces que se mostró el anuncio"}
            />
            <Kpi
              etiqueta="Clics"
              valor={campana.clics === null ? "—" : formatearNumero(campana.clics)}
              nota={`CTR ${formatearPorcentaje(ctrCampana)}`}
            />
            <Kpi
              etiqueta={campana.tipoResultado ? ETIQUETA_RESULTADO[campana.tipoResultado] : "Resultados"}
              valor={campana.resultados === null || campana.resultados === undefined ? "—" : formatearNumero(campana.resultados)}
              nota={
                campana.resultados === null || campana.resultados === undefined
                  ? "Tu cuenta publicitaria no reportó conversiones para esta campaña."
                  : "Lo que declara la plataforma, con la medición configurada en la cuenta"
              }
              destacada
            />
            <Kpi
              etiqueta="Costo por resultado"
              valor={plata(campana.costoPorResultado ?? null)}
              nota={campana.costoPorResultado ? "Invertido ÷ resultados de la plataforma" : "Sin resultados no se puede calcular"}
              destacada
            />
          </>
        )}
      </section>

      <nav className="mk-segmentos my-6" aria-label="Secciones de la campaña">
        {pestanas.map((t) => (
          <Link key={t.clave} href={href(t.clave)} className="mk-segmento" aria-pressed={pestana === t.clave}>
            {t.texto}
            {t.clave === "anuncios" && <span className="mk-conteo">{totalAnuncios}</span>}
            {t.clave === "leads" && <span className="mk-conteo">{leads.length}</span>}
            {t.clave === "creatividades" && <span className="mk-conteo">{creatividades.length}</span>}
          </Link>
        ))}
      </nav>

      {pestana === "resumen" && (
        <div className="grid gap-6">
          <div className="grid gap-6 xl:grid-cols-12">
            {/* La tendencia se dibuja desde los leads del período: sin
                conversaciones propias sería una línea plana en cero durante 30
                días, que no es «no pasó nada», es «no lo estamos midiendo». */}
            {p.senales.conversaciones && (
              <section className="mk-panel xl:col-span-7">
                <div className="mk-panel-cabecera">
                  <h2 className="mk-h2">Qué pasó cada día</h2>
                  <span className="mk-meta">Conversaciones, calificados, ventas e ingresos</span>
                </div>
                <div className="mk-panel-cuerpo">
                  <GraficoTendencia serie={serie} metaConectada={false} principalInicial="conversaciones" alto={240} />
                </div>
              </section>
            )}
            <section className={`mk-panel ${p.senales.conversaciones ? "xl:col-span-5" : "xl:col-span-12"}`}>
              <div className="mk-panel-cabecera">
                <div>
                  <h2 className="mk-h2">{p.senales.conversaciones ? "Dónde se cae la gente" : "Del anuncio al resultado"}</h2>
                  <p className="mk-meta mt-0.5">{tituloEmbudo(p.senales).bajada}</p>
                </div>
                <Link href={href("embudo")} className="mk-enlace">
                  Detalle {Ico.flecha({ className: "h-3.5 w-3.5" })}
                </Link>
              </div>
              <div className="mk-panel-cuerpo">
                <Embudo escalones={embudo} compacto enlaces={enlacesEmbudo} />
              </div>
              {/* Esta línea dice cuál de los escalones mirar. Solo se consideran
                  los que el negocio sí controla: lo que pasa antes del clic no
                  se arregla desde Respondo. */}
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
            <ListaDeAnuncios
              anuncios={anuncios.slice(0, 4)}
              plataforma={anunciosPlataforma.slice(0, 4)}
              monedaNegocio={p.monedaNegocio}
              periodo={rango.clave}
              puedeConectarMeta={p.capacidades.puedeConectarMeta}
              motivo={motivoPublicidad}
            />
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
            <span className="mk-meta">
              {anuncios.length ? "Ordenados por lo que cobraron" : "Ordenados por lo invertido · según tu cuenta publicitaria"}
            </span>
          </div>
          <ListaDeAnuncios
            anuncios={anuncios}
            plataforma={anunciosPlataforma}
            monedaNegocio={p.monedaNegocio}
            periodo={rango.clave}
            puedeConectarMeta={p.capacidades.puedeConectarMeta}
            motivo={motivoPublicidad}
          />
        </section>
      )}

      {pestana === "embudo" && (
        <div className="grid gap-6">
          <section className="mk-panel">
            <div className="mk-panel-cabecera">
              <div>
                <h2 className="mk-h2">{p.senales.conversaciones ? "Del anuncio a la venta" : "Del anuncio al resultado"}</h2>
                <p className="mk-meta mt-0.5">{tituloEmbudo(p.senales).bajada}</p>
              </div>
              <span className="mk-meta">{campana.nombre}</span>
            </div>
            <div className="mk-panel-cuerpo" style={{ paddingTop: 36 }}>
              <Embudo escalones={embudo} enlaces={enlacesEmbudo} />
            </div>
          </section>
          <section className="mk-panel">
            <div className="mk-panel-cabecera">
              <h2 className="mk-h2">Cómo leerlo</h2>
            </div>
            <div className="mk-panel-cuerpo grid gap-5 md:grid-cols-2" style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6 }}>
              <p>
                <strong style={{ color: "var(--tinta)" }}>Impresiones y clics</strong> los reporta tu cuenta publicitaria y solo
                aparecen con la cuenta conectada.
              </p>
              {p.senales.conversiones && (
                <p>
                  <strong style={{ color: "var(--tinta)" }}>
                    {ETIQUETA_RESULTADO[campana.tipoResultado ?? "desconocido"]}
                  </strong>{" "}
                  es lo que declara la plataforma con la medición configurada en la cuenta. Es su cuenta, no la nuestra: dos campañas
                  que miden cosas distintas no se suman ni se comparan.
                </p>
              )}
              {p.senales.conversaciones ? (
                <>
                  <p>
                    <strong style={{ color: "var(--tinta)" }}>Conversaciones</strong> son las personas que efectivamente escribieron
                    por WhatsApp desde un anuncio de esta campaña. Es la primera cifra que la plataforma no puede ver.
                  </p>
                  <p>
                    <strong style={{ color: "var(--tinta)" }}>Calificados</strong> avanzaron a «interesado» o más, o cotizaron,
                    reservaron o compraron. Si esta tasa es baja, el anuncio promete algo distinto de lo que la persona encuentra al
                    escribir.
                  </p>
                  <p>
                    <strong style={{ color: "var(--tinta)" }}>Ventas</strong> se atribuyen al primer anuncio pagado que trajo a la
                    persona, aunque haya comprado semanas después. Los ingresos solo suman lo pagado por enlace, así que son un piso.
                  </p>
                </>
              ) : (
                <p>
                  <strong style={{ color: "var(--tinta)" }}>Hasta acá llega el embudo</strong>, y no es una limitación de esta
                  campaña. {motivoFaltante("conversaciones")}
                </p>
              )}
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
                  Las que ya corren en la plataforma se ven en «Anuncios». Acá aparecen las que creas o asignas desde el estudio, con su
                  rendimiento cuando se puede cruzar.
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

/**
 * Qué tabla de anuncios corresponde.
 *
 * Con anuncios atribuidos se muestra la tabla completa —es la única que puede
 * decir qué pasó DESPUÉS del clic—. Sin ninguno se muestran los que reporta la
 * plataforma, que existen igual: la lista vacía anterior hacía creer que la
 * campaña no tenía avisos corriendo.
 */
function ListaDeAnuncios({
  anuncios,
  plataforma,
  monedaNegocio,
  periodo,
  puedeConectarMeta,
  motivo,
}: {
  anuncios: FilaAnuncio[];
  plataforma: FilaRendimiento[];
  monedaNegocio: string;
  periodo: string;
  puedeConectarMeta: boolean;
  motivo: string;
}) {
  if (anuncios.length > 0) {
    return (
      <TablaAnuncios
        anuncios={anuncios}
        monedaNegocio={monedaNegocio}
        periodo={periodo}
        puedeConectarMeta={puedeConectarMeta}
        motivoSinPublicidad={motivo}
      />
    );
  }
  return (
    <TablaAnunciosDePlataforma
      filas={plataforma}
      monedaNegocio={monedaNegocio}
      vacio={{
        titulo: "Sin anuncios con actividad en este período",
        texto: `Tu cuenta publicitaria no reportó ningún anuncio de esta campaña con entrega. Prueba con un período más largo. ${motivo}`,
      }}
    />
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
