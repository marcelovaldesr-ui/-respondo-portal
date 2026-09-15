import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearMonto, formatearNumero, formatearPorcentaje } from "@/lib/ads/moneda";
import { agregar, ctr, ETIQUETA_RESULTADO } from "@/lib/ads/canal";
import { motivoFaltante } from "@/lib/ads/senales";
import { cargarMarketing } from "@/lib/marketing/datos";
import { tituloEmbudo } from "@/lib/marketing/embudoAdaptativo";
import { opcionesDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import Embudo from "@/components/marketing/Embudo";
import TablaAnuncios from "@/components/marketing/TablaAnuncios";
import { Ico } from "@/components/marketing/Iconos";
import { motivoSinPublicidad } from "@/lib/marketing/capacidades";

export const dynamic = "force-dynamic";

/**
 * ATRIBUCIÓN — de qué anuncio salieron mis ventas.
 *
 * Es la pantalla que justifica toda la sección, y por eso arranca con la
 * frase entera dibujada: el embudo horizontal con la frontera marcada entre
 * lo que reporta la plataforma (impresiones, clics) y lo que solo puede contar
 * Respondo (conversación, calificado, cotización, venta).
 *
 * Debajo, dos lecturas distintas y no una tabla repetida:
 *   · POR CAMPAÑA: eficiencia del embudo — qué porcentaje sobrevive en cada
 *     escalón. Ahí se ve cuál trae gente que avanza y cuál trae curiosos.
 *   · POR ANUNCIO: calidad del lead — cuánto cuesta la conversación y cuántas
 *     terminan en venta. Ahí se ve qué creatividad repetir.
 *
 * Cada cifra baja hasta las personas: una tasa que no se puede auditar es una
 * tasa en la que nadie confía.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ⭐ Y TODO ESO EXIGE LA SEÑAL `conversaciones`.
 *
 * La bajada decía en duro «de qué anuncio salió cada conversación que entró por
 * WhatsApp»: para un negocio que pauta en Google y no trae la conversación a
 * Respondo eso es falso, y debajo aparecían cuatro tarjetas en cero y dos
 * tablas vacías. La pantalla sigue existiendo —con solo publicidad todavía
 * tiene qué mostrar: impresiones → clics → resultado, que es lo que decide
 * `seccionesVisibles`— pero dice qué SÍ se puede saber y qué no, en vez de
 * contestar con ceros una pregunta que no puede responder.
 * ───────────────────────────────────────────────────────────────────────────
 */
export default async function Atribucion({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const { demo, variante } = await opcionesDemo();
  const rango = resolverRango((await searchParams).p);
  const p = await cargarMarketing(usuario.clienteId, rango, { demo, variante });

  const reales = p.campanas.filter((c) => c.origen !== "borrador");
  const hayPersonas = p.senales.conversaciones;
  const totalVentas = reales.reduce((a, c) => a + c.ventas, 0);
  const conAnuncio = p.leads.length;
  const totalContactos = conAnuncio + p.sinAnuncio;
  const conClid = p.leads.filter((l) => l.conClid).length;
  const cobrado = reales.reduce((a, c) => a + c.cobrado, 0);
  const enlaces = hayPersonas
    ? {
        conversaciones: `/marketing/leads?p=${rango.clave}`,
        calificados: `/marketing/leads?p=${rango.clave}&f=calificados`,
        avanzados: `/marketing/leads?p=${rango.clave}&f=avanzaron`,
        ventas: `/marketing/leads?p=${rango.clave}&f=compraron`,
      }
    : undefined;

  /** Lo que la plataforma sí entrega, para llenar la pantalla sin conversaciones. */
  const totales = agregar(p.filasAds.filter((f) => f.nivel === "campana"));
  const resultados = totales.resultados;
  const costoResultado =
    totales.gasto && resultados && resultados.cantidad > 0 ? totales.gasto.valor / resultados.cantidad : null;
  const monedaAds = totales.gasto?.moneda ?? p.monedaNegocio;
  const motivoPublicidad = motivoSinPublicidad(p.capacidades, p.errorPublicidad);

  return (
    <main className="mk-pagina">
      <Cabecera
        titulo="Atribución"
        bajada={
          hayPersonas
            ? "De qué anuncio salió cada conversación que entró por WhatsApp, y en qué terminó."
            : "Qué entrega cada anuncio y qué resultados declara tu cuenta publicitaria. Lo que le pasó después a cada persona todavía no se puede seguir."
        }
        demo={p.demo}
        rango={rango}
        base="/marketing/atribucion"
      />

      <section className="mk-panel">
        <div className="mk-panel-cabecera">
          <div>
            <h2 className="mk-h2">{hayPersonas ? "Del anuncio a la venta" : "Del anuncio al resultado"}</h2>
            <p className="mk-meta mt-0.5">
              {tituloEmbudo(p.senales).bajada}
              {hayPersonas ? " Cada etapa se abre hasta las personas que la componen." : ""}
            </p>
          </div>
          <span className="mk-meta">{rango.etiqueta}</span>
        </div>
        <div className="mk-panel-cuerpo" style={{ paddingTop: 36, paddingBottom: 24 }}>
          <Embudo
            escalones={p.embudo}
            enlaces={enlaces}
            rotuloPlataforma={
              p.canales.filter((c) => c.conectado).length === 1
                ? (p.canales.find((c) => c.conectado)?.nombre.toUpperCase() ?? "PLATAFORMA")
                : "PLATAFORMA"
            }
          />
        </div>
        <div className="mk-panel-pie flex flex-wrap items-center justify-between gap-3">
          {hayPersonas ? (
            <>
              <span>
                Modelo: <strong style={{ color: "var(--tinta)" }}>primer contacto pagado</strong>. Cada persona se atribuye al primer
                anuncio desde el que escribió, aunque compre semanas después. Una venta cuenta una vez, en un solo lugar. Solo entran
                las conversaciones que llegaron con la marca del anuncio: si alguien te escribe después por su cuenta, no se le puede
                asignar.
              </span>
              <Link href={`/marketing/leads?p=${rango.clave}`} className="mk-enlace">
                Ver todas las personas {Ico.flecha({ className: "h-3.5 w-3.5" })}
              </Link>
            </>
          ) : (
            <span>
              El embudo llega hasta donde llega la medición y no se rellena con estimaciones. {motivoFaltante("conversaciones")}
            </span>
          )}
        </div>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {hayPersonas ? (
          <>
            <Dato titulo="Contactos del período" valor={formatearNumero(totalContactos)} nota="Por todas las vías" />
            <Dato
              titulo="Vinieron de un anuncio"
              valor={formatearNumero(conAnuncio)}
              nota={`${formatearPorcentaje(totalContactos ? (conAnuncio / totalContactos) * 100 : null)} del total`}
            />
            <Dato
              titulo="Con identificador de clic"
              valor={formatearNumero(conClid)}
              nota="Se le pueden devolver a Meta como conversión"
            />
            <Dato
              titulo="Ventas atribuidas"
              valor={`${formatearNumero(totalVentas)} · ${cobrado > 0 ? formatearMonto({ valor: cobrado, moneda: p.monedaNegocio }) : "—"}`}
              nota="Al menos: lo cobrado por enlace de pago"
              fuerte
            />
          </>
        ) : (
          <>
            <Dato
              titulo="Invertido"
              valor={totales.gasto === null ? "—" : formatearMonto(totales.gasto, { monedaDelNegocio: p.monedaNegocio })}
              nota={totales.gasto === null ? motivoPublicidad : "Según tu cuenta publicitaria, en el período"}
            />
            <Dato
              titulo="Impresiones"
              valor={p.senales.ads ? formatearNumero(totales.impresiones) : "—"}
              nota={p.senales.ads ? "Veces que se mostró un anuncio" : motivoPublicidad}
            />
            <Dato
              titulo="Clics"
              valor={p.senales.ads ? formatearNumero(totales.clics) : "—"}
              nota={p.senales.ads ? `CTR ${formatearPorcentaje(ctr(totales))}` : motivoPublicidad}
            />
            <Dato
              titulo={resultados ? ETIQUETA_RESULTADO[resultados.tipo] : "Resultados"}
              valor={resultados ? formatearNumero(resultados.cantidad) : "—"}
              nota={
                resultados
                  ? `${costoResultado === null ? "—" : formatearMonto({ valor: costoResultado, moneda: monedaAds }, { monedaDelNegocio: p.monedaNegocio })} cada uno`
                  : "Tu cuenta publicitaria no reportó conversiones en este período."
              }
              fuerte
            />
          </>
        )}
      </div>

      <section className="mk-panel mt-6">
        <div className="mk-panel-cabecera">
          <div>
            <h2 className="mk-h2">{hayPersonas ? "Eficiencia por campaña" : "Qué consigue cada campaña"}</h2>
            <p className="mk-meta mt-0.5">
              {hayPersonas
                ? "Qué porcentaje de cada campaña sobrevive en cada escalón."
                : "Lo que la plataforma entregó y lo que declara haber conseguido, campaña por campaña."}
            </p>
          </div>
          <Link href={`/marketing/campanas?p=${rango.clave}`} className="mk-enlace">
            Campañas {Ico.flecha({ className: "h-3.5 w-3.5" })}
          </Link>
        </div>
        {reales.length === 0 ? (
          <div className="vacio">
            <div className="vacio-titulo">
              {hayPersonas ? "Todavía no hay conversaciones atribuidas" : "Todavía no hay campañas con actividad"}
            </div>
            <p className="vacio-texto">
              {hayPersonas
                ? "La atribución empieza sola con el primer mensaje que llegue desde un anuncio. No hay nada que configurar."
                : `Cuando tu cuenta publicitaria reporte campañas con entrega, aparecen acá con lo que costaron y lo que consiguieron. ${motivoPublicidad}`}
            </p>
            <Link href="/marketing/campanas/nueva" className="btn-primario mk-btn-lg mt-5">
              Crear una campaña
            </Link>
          </div>
        ) : hayPersonas ? (
          <div className="overflow-x-auto">
            <table className="mk-tabla min-w-[900px]">
              <thead>
                <tr>
                  <th>Campaña</th>
                  <th className="num">Conversaciones</th>
                  <th className="num" data-tip="Calificados ÷ conversaciones">Califican</th>
                  <th className="num" data-tip="Cotizaron o reservaron ÷ conversaciones">Avanzan</th>
                  <th className="num" data-tip="Ventas ÷ conversaciones">Cierran</th>
                  <th className="num">Ventas</th>
                  <th className="num">Ingresos</th>
                  <th className="num" data-tip="Participación en las ventas del período">Peso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reales.map((c) => {
                  const t = (n: number) => (c.conversaciones ? (n / c.conversaciones) * 100 : null);
                  return (
                    <tr key={c.id}>
                      <td className="max-w-[300px]">
                        <Link
                          href={`/marketing/campanas/${encodeURIComponent(c.id)}?p=${rango.clave}&t=embudo`}
                          className="block truncate font-semibold hover:underline"
                          style={{ fontSize: "13.5px" }}
                        >
                          {c.nombre}
                        </Link>
                      </td>
                      <td className="num cifra">{formatearNumero(c.conversaciones)}</td>
                      <td className="num"><Tasa pct={t(c.calificados)} n={c.calificados} /></td>
                      <td className="num"><Tasa pct={t(c.avanzados)} n={c.avanzados} /></td>
                      <td className="num cifra fuerte">{formatearPorcentaje(t(c.ventas))}</td>
                      <td className="num cifra fuerte">{formatearNumero(c.ventas)}</td>
                      <td className="num cifra plata">
                        {c.cobrado > 0 ? formatearMonto({ valor: c.cobrado, moneda: p.monedaNegocio }) : <span className="nulo">—</span>}
                      </td>
                      <td className="num">
                        <span className="inline-flex items-center gap-2">
                          <span className="mk-barra" style={{ width: Math.max(3, totalVentas ? (c.ventas / totalVentas) * 44 : 3) }} />
                          <span className="cifra">{formatearPorcentaje(totalVentas ? (c.ventas / totalVentas) * 100 : null)}</span>
                        </span>
                      </td>
                      <td className="num">
                        <Link href={`/marketing/campanas/${encodeURIComponent(c.id)}?p=${rango.clave}&t=leads`} className="btn-chico">
                          Personas
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Las mismas campañas, con las columnas que la plataforma sí llena.
             Las de conversación no aparecen en cero: no existen. */
          <div className="overflow-x-auto">
            <table className="mk-tabla min-w-[760px]">
              <thead>
                <tr>
                  <th>Campaña</th>
                  <th className="num">Invertido</th>
                  <th className="num">Impresiones</th>
                  <th className="num">Clics</th>
                  <th className="num" data-tip="De cada 100 veces que se mostró, cuántas terminaron en clic.">CTR</th>
                  {p.senales.conversiones && (
                    <th className="num" data-tip="Lo que la plataforma cuenta como resultado, con la medición configurada en la cuenta.">
                      Resultados
                    </th>
                  )}
                  {p.senales.conversiones && <th className="num" data-tip="Invertido ÷ resultados de la plataforma.">Costo/result.</th>}
                </tr>
              </thead>
              <tbody>
                {reales.map((c) => {
                  const raya = <span className="nulo">—</span>;
                  return (
                    <tr key={c.id}>
                      <td className="max-w-[300px]">
                        <Link
                          href={`/marketing/campanas/${encodeURIComponent(c.id)}?p=${rango.clave}&t=embudo`}
                          className="block truncate font-semibold hover:underline"
                          style={{ fontSize: "13.5px" }}
                        >
                          {c.nombre}
                        </Link>
                      </td>
                      <td className="num cifra">
                        {c.gasto === null ? raya : formatearMonto({ valor: c.gasto, moneda: c.moneda }, { monedaDelNegocio: p.monedaNegocio })}
                      </td>
                      <td className="num cifra">{c.impresiones === null ? raya : formatearNumero(c.impresiones)}</td>
                      <td className="num cifra">{c.clics === null ? raya : formatearNumero(c.clics)}</td>
                      <td className="num cifra">
                        {formatearPorcentaje(ctr({ impresiones: c.impresiones ?? 0, clics: c.clics ?? 0 }))}
                      </td>
                      {p.senales.conversiones && (
                        <td className="num cifra fuerte">
                          {c.resultados === null || c.resultados === undefined ? (
                            raya
                          ) : (
                            <span title={ETIQUETA_RESULTADO[c.tipoResultado ?? "desconocido"]}>
                              {formatearNumero(c.resultados)}
                            </span>
                          )}
                        </td>
                      )}
                      {p.senales.conversiones && (
                        <td className="num cifra">
                          {c.costoPorResultado
                            ? formatearMonto({ valor: c.costoPorResultado, moneda: c.moneda }, { monedaDelNegocio: p.monedaNegocio })
                            : raya}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mk-panel mt-6">
        <div className="mk-panel-cabecera">
          <div>
            <h2 className="mk-h2">Calidad del lead por anuncio</h2>
            <p className="mk-meta mt-0.5">Cuál trae gente que compra y cuál trae gente que pregunta.</p>
          </div>
          {hayPersonas && <span className="mk-meta">{formatearNumero(p.anuncios.length)} con actividad</span>}
        </div>
        {hayPersonas ? (
          <TablaAnuncios
            anuncios={p.anuncios}
            monedaNegocio={p.monedaNegocio}
            periodo={rango.clave}
            mostrarCampana
            puedeConectarMeta={p.capacidades.puedeConectarMeta}
            motivoSinPublicidad={motivoPublicidad}
          />
        ) : (
          /* Antes acá había una tabla vacía con seis columnas de conversación.
             Decir qué falta y qué se ofrece en cambio es la respuesta honesta a
             una pregunta que esta señal no alcanza a contestar. */
          <div className="vacio">
            <div className="vacio-titulo">Esto necesita las conversaciones de tu negocio</div>
            <p className="vacio-texto">{motivoFaltante("conversaciones")}</p>
            <Link href={`/marketing/campanas?p=${rango.clave}`} className="btn-suave mk-btn-lg mt-5">
              Ver qué anuncio consigue resultados más barato
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}

/** El porcentaje manda y el conteo lo acompaña en chico: quien compara
    campañas compara tasas, no totales de distinto tamaño. */
function Tasa({ pct, n }: { pct: number | null; n: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="cifra" style={{ fontWeight: 600 }}>
        {formatearPorcentaje(pct)}
      </span>
      <span className="cifra" style={{ fontSize: "11px", color: "var(--muted-3)" }}>
        {formatearNumero(n)}
      </span>
    </span>
  );
}

function Dato({ titulo, valor, nota, fuerte }: { titulo: string; valor: string; nota: string; fuerte?: boolean }) {
  return (
    <div className="mk-panel px-5 py-4">
      <div className="mk-kpi-etiqueta">{titulo}</div>
      <div
        className="cifra mt-2 truncate"
        style={{ fontSize: "21px", fontWeight: 600, letterSpacing: "-0.025em", color: fuerte ? "var(--indigo)" : "var(--tinta)" }}
      >
        {valor}
      </div>
      <div className="mt-1.5" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
        {nota}
      </div>
    </div>
  );
}
