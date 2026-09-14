import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import type { Metrica } from "@/lib/ads/metricas";
import { agregar, ETIQUETA_RESULTADO } from "@/lib/ads/canal";
import { tituloEmbudo } from "@/lib/marketing/embudoAdaptativo";
import Recomendaciones from "@/components/marketing/Recomendaciones";
import { cargarMarketing } from "@/lib/marketing/datos";
import { opcionesDemo } from "@/lib/marketing/modo";
import { preguntasPara } from "@/lib/marketing/copilotoCore";
import Cabecera from "@/components/marketing/Cabecera";
import FranjaKpis, { type Kpi } from "@/components/marketing/FranjaKpis";
import GraficoTendencia from "@/components/marketing/GraficoTendencia";
import Embudo from "@/components/marketing/Embudo";
import Hallazgos from "@/components/marketing/Hallazgos";
import Onboarding from "@/components/marketing/Onboarding";
import TarjetaCreatividad from "@/components/marketing/TarjetaCreatividad";
import { EstadoDeCampana } from "@/components/marketing/Estado";
import { Ico } from "@/components/marketing/Iconos";

export const dynamic = "force-dynamic";

/**
 * INICIO — el centro de mando de marketing.
 *
 * Responde, en el orden en que le importa al dueño:
 *   1. ¿Cómo vamos?                  → seis cifras con su certeza y su chispa
 *   2. ¿Hay algo que atender?        → hallazgos con evidencia y acción
 *   3. ¿Sube o baja?                 → un gráfico grande, no seis chicos
 *   4. ¿Dónde se pierde la gente?    → el embudo que Meta no ve
 *   5. ¿Qué campañas traen la plata? → las mejores, con enlace al detalle
 *   6. ¿Qué anuncios funcionan?      → creatividades con su rendimiento
 *   7. ¿Qué haría un asesor?         → la entrada al copiloto
 *
 * Cuando el negocio recién empieza y no hay atribución, arriba aparece la
 * puesta en marcha — pero nunca sola: el estudio creativo, el copiloto y la
 * demostración funcionan desde el primer minuto.
 */
export default async function InicioMarketing({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const { demo, variante } = await opcionesDemo();
  const rango = resolverRango((await searchParams).p);
  const p = await cargarMarketing(usuario.clienteId, rango, { demo, variante });

  const metrica = (clave: string): Metrica | undefined => p.metricas.flatMap((g) => g.metricas).find((m) => m.clave === clave);
  const calificados = p.leads.filter((l) => l.calificado).length;

  const mCalificados: Metrica = {
    clave: "calificados",
    etiqueta: "Leads calificados",
    valor: calificados,
    certeza: "medida",
    ayuda: "Conversaciones que avanzaron a interesado o más, o que cotizaron, reservaron o compraron.",
  };
  /**
   * ⭐ LOS KPI SE ELIGEN POR LA PROFUNDIDAD DE SEÑAL (Fase 6).
   *
   * Seis KPI fijos funcionaban cuando todos los negocios eran iguales. Hoy no:
   * a un negocio que no trae conversaciones, «Conversaciones · Calificados ·
   * Ventas · Ingresos · ROAS» le dejan cinco de seis cifras en cero o en «—»,
   * y una franja así no informa: desanima y además miente por omisión, porque
   * esas conversaciones existen —pasan por otro lado—.
   *
   * La regla: **nunca más de seis, y solo las que este negocio puede llenar.**
   * Cuando hay publicidad pero no conversaciones, la franja se arma con lo que
   * la plataforma sí mide: inversión, clics, CTR, resultados y su costo.
   */
  const totalesAds = agregar(p.filasAds.filter((f) => f.nivel === "campana"));
  const resultadosAds = totalesAds.resultados;
  const costoResultado =
    totalesAds.gasto && resultadosAds && resultadosAds.cantidad > 0
      ? totalesAds.gasto.valor / resultadosAds.cantidad
      : null;

  const kpiClics: Metrica = {
    clave: "clics_plataforma",
    etiqueta: "Clics",
    valor: p.senales.ads ? totalesAds.clics : null,
    certeza: p.senales.ads ? "medida" : "no_disponible",
    ayuda: "Personas que apretaron un anuncio. Lo reporta la plataforma.",
  };
  const kpiCtr: Metrica = {
    clave: "ctr_plataforma",
    etiqueta: "CTR",
    valor: p.senales.ads && totalesAds.impresiones > 0 ? (totalesAds.clics / totalesAds.impresiones) * 100 : null,
    certeza: "derivada",
    ayuda: "De cada 100 veces que se mostró, cuántas terminaron en clic.",
  };
  const kpiResultados: Metrica = {
    clave: "resultados_plataforma",
    etiqueta: resultadosAds ? ETIQUETA_RESULTADO[resultadosAds.tipo] : "Resultados",
    valor: resultadosAds?.cantidad ?? null,
    certeza: resultadosAds ? "medida" : "no_disponible",
    ayuda: "Lo que la plataforma cuenta como resultado de la campaña, con la medición configurada en la cuenta.",
    motivo: resultadosAds ? undefined : "Tu cuenta publicitaria no reportó conversiones en este período.",
  };
  const kpiCostoResultado: Metrica = {
    clave: "costo_resultado",
    etiqueta: "Costo por resultado",
    valor: costoResultado,
    monto: costoResultado === null ? null : { valor: costoResultado, moneda: totalesAds.gasto?.moneda ?? p.monedaNegocio },
    certeza: costoResultado === null ? "no_disponible" : "derivada",
    ayuda: "Cuánto costó cada resultado que reporta la plataforma.",
    menosEsMejor: true,
  };

  const kpis: Kpi[] = (
    p.senales.conversaciones
      ? [
          { m: metrica("gasto")!, etiqueta: "Invertido", serie: p.serie.map((d) => d.gasto) },
          { m: metrica("conversaciones")!, etiqueta: "Conversaciones", serie: p.serie.map((d) => d.conversaciones) },
          { m: mCalificados, etiqueta: "Calificados", serie: p.serie.map((d) => d.calificados) },
          { m: metrica("ventas")!, etiqueta: "Ventas", serie: p.serie.map((d) => d.ventas), destacada: true },
          { m: metrica("cobrado")!, etiqueta: "Ingresos", serie: p.serie.map((d) => d.cobrado), destacada: true },
          { m: metrica("roas")!, etiqueta: "Retorno (ROAS)" },
        ]
      : [
          { m: metrica("gasto")!, etiqueta: "Invertido", serie: p.serie.map((d) => d.gasto) },
          { m: kpiClics, etiqueta: "Clics", serie: p.serie.map((d) => d.clics) },
          { m: kpiCtr, etiqueta: "CTR" },
          { m: kpiResultados, etiqueta: kpiResultados.etiqueta, destacada: true },
          { m: kpiCostoResultado, etiqueta: "Costo por resultado", destacada: true },
        ]
  ).filter((k) => k.m) as Kpi[];

  const conDatos = p.campanas.filter((c) => c.origen !== "borrador");
  const destacadas = conDatos.slice(0, 5);
  const conRendimiento = p.creatividades
    .filter((c) => c.rendimiento && c.rendimiento.conversaciones > 0)
    .sort((a, b) => (b.rendimiento?.ventas ?? 0) - (a.rendimiento?.ventas ?? 0))
    .slice(0, 4);
  const sinRendimiento = p.creatividades.filter((c) => c.estado !== "archivada").slice(0, 4);
  const galeria = conRendimiento.length ? conRendimiento : sinRendimiento;
  /**
   * ¿HAY ALGO QUE MOSTRAR TODAVÍA?
   *
   * Un negocio que recién entra no necesita ver seis KPI en cero, un gráfico
   * plano de 30 días y un embudo de puros ceros: eso no es un panel vacío, es
   * un panel que dice «acá no pasa nada» y desanima. Mientras no haya ni una
   * conversación atribuida ni cifras de la cuenta publicitaria, la pantalla
   * muestra la puesta en marcha y las puertas que SÍ funcionan sin conectar
   * nada —escribir un anuncio, armar una campaña— y el analítica aparece sola
   * en cuanto hay con qué llenarla.
   *
   * En demostración nunca se oculta: la demo existe para mostrar el producto
   * completo.
   */
  const hayQueMostrar = p.demo || p.leads.length > 0 || p.senales.ads || conDatos.length > 0;

  const enlacesEmbudo = {
    conversaciones: `/marketing/leads?p=${rango.clave}`,
    calificados: `/marketing/leads?p=${rango.clave}&f=calificados`,
    avanzados: `/marketing/leads?p=${rango.clave}&f=avanzaron`,
    ventas: `/marketing/leads?p=${rango.clave}&f=compraron`,
  };

  return (
    <main className="mk-pagina">
      <Cabecera
        titulo="Marketing"
        bajada="Qué está trayendo clientes y cómo hacer mejor la próxima campaña."
        // En demostración el riel ya dice de qué negocio se trata; acá solo va lo
        // que el riel NO dice: si la cuenta publicitaria está leyendo.
        cuenta={p.demo ? null : p.capacidades.metaConectada ? "Cuenta publicitaria conectada" : null}
        demo={p.demo}
        rango={rango}
        base="/marketing"
        acciones={
          <Link href="/marketing/campanas/nueva" className="btn-primario mk-btn-lg">
            {Ico.nueva({ className: "h-4 w-4" })} Crear campaña
          </Link>
        }
      />

      {!p.estado.hayAtribucion && !p.demo && <Onboarding estado={p.estado} creatividades={p.creatividades.length} capacidades={p.capacidades} />}

      {hayQueMostrar && <FranjaKpis kpis={kpis} monedaNegocio={p.monedaNegocio} />}

      {p.hallazgos.length > 0 && (
        <section className="mt-7">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="mk-h2">Lo que conviene mirar</h2>
            <span className="mk-meta">Hallazgos automáticos · {rango.etiqueta.toLowerCase()}</span>
          </div>
          <Hallazgos items={p.hallazgos} max={3} />
        </section>
      )}

      {(p.analisis.recomendaciones.length > 0 || p.analisis.insuficientes.length > 0) && (
        <Recomendaciones analisis={p.analisis} max={3} />
      )}

      {hayQueMostrar && (
        <section className="mk-panel mt-7">
          <div className="mk-panel-cabecera">
            <h2 className="mk-h2">Rendimiento por día</h2>
            <span className="mk-meta">{p.serie.length} días · hora de Chile</span>
          </div>
          <div className="mk-panel-cuerpo">
            <GraficoTendencia
              serie={p.serie}
              metaConectada={p.metaConectada}
              hayConversaciones={p.senales.conversaciones}
              hayIngresos={p.senales.ingresos}
            />
          </div>
        </section>
      )}

      {hayQueMostrar && (
      <section className="mk-panel mt-7">
        <div className="mk-panel-cabecera">
          <div>
            <h2 className="mk-h2">{p.senales.conversaciones ? "Del anuncio a la venta" : "Del anuncio al resultado"}</h2>
            <p className="mk-meta mt-0.5">{tituloEmbudo(p.senales).bajada}</p>
          </div>
          <Link href={`/marketing/atribucion?p=${rango.clave}`} className="mk-enlace">
            Ver atribución {Ico.flecha({ className: "h-3.5 w-3.5" })}
          </Link>
        </div>
        <div className="mk-panel-cuerpo" style={{ paddingTop: 34 }}>
          <Embudo
            escalones={p.embudo}
            enlaces={p.senales.conversaciones ? enlacesEmbudo : undefined}
            rotuloPlataforma={
              p.canales.filter((c) => c.conectado).length === 1
                ? (p.canales.find((c) => c.conectado)?.nombre.toUpperCase() ?? "PLATAFORMA")
                : "PLATAFORMA"
            }
          />
        </div>
      </section>
      )}

      <div className="mt-7 grid gap-6 xl:grid-cols-12">
        <section className="mk-panel xl:col-span-8">
          <div className="mk-panel-cabecera">
            <h2 className="mk-h2">Campañas que más traen</h2>
            <div className="flex items-center gap-3">
              {/* Decirlo importa: esta tabla suma menos que el KPI de arriba
                  cuando hay más de cinco campañas, y sin este rótulo eso se lee
                  como una cifra que no cuadra. */}
              {conDatos.length > destacadas.length && (
                <span className="mk-meta">
                  Las {destacadas.length} con más ingresos de {conDatos.length}
                </span>
              )}
              <Link href={`/marketing/campanas?p=${rango.clave}`} className="mk-enlace">
                Todas las campañas {Ico.flecha({ className: "h-3.5 w-3.5" })}
              </Link>
            </div>
          </div>
          {destacadas.length === 0 ? (
            <div className="vacio">
              <div className="vacio-titulo">Todavía no hay campañas con datos</div>
              <p className="vacio-texto">
                {p.senales.conversaciones
                  ? "Cuando alguien entre a WhatsApp desde un anuncio, su campaña aparece acá con lo que costó y lo que trajo."
                  : "Cuando tu cuenta publicitaria reporte campañas con actividad, aparecen acá con lo que costaron y lo que consiguieron."}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Link href="/marketing/campanas/nueva" className="btn-primario mk-btn-lg">
                  Crear la primera campaña
                </Link>
                <Link href="/marketing/creatividades/nueva" className="btn-suave mk-btn-lg">
                  Crear una creatividad
                </Link>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="mk-tabla">
                <thead>
                  <tr>
                    <th>Campaña</th>
                    <th className="num">Invertido</th>
                    <th className="num">Conv.</th>
                    <th className="num">Calif.</th>
                    <th className="num">Ventas</th>
                    <th className="num">Ingresos</th>
                    <th className="num">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {destacadas.map((c) => (
                    <tr key={c.id}>
                      <td className="max-w-[300px]">
                        <Link
                          href={`/marketing/campanas/${encodeURIComponent(c.id)}?p=${rango.clave}`}
                          className="block truncate font-semibold hover:underline"
                          style={{ fontSize: "13.5px" }}
                        >
                          {c.nombre}
                        </Link>
                        <div className="mt-1.5">
                          <EstadoDeCampana estado={c.estado} />
                        </div>
                      </td>
                      <td className="num cifra">
                        {c.gasto === null ? (
                          <span className="nulo">—</span>
                        ) : (
                          formatearMonto({ valor: c.gasto, moneda: c.moneda }, { monedaDelNegocio: p.monedaNegocio })
                        )}
                      </td>
                      <td className="num cifra">{formatearNumero(c.conversaciones)}</td>
                      <td className="num cifra">{formatearNumero(c.calificados)}</td>
                      <td className="num cifra fuerte">{formatearNumero(c.ventas)}</td>
                      <td className="num cifra plata">
                        {c.cobrado > 0 ? formatearMonto({ valor: c.cobrado, moneda: p.monedaNegocio }) : <span className="nulo">—</span>}
                      </td>
                      <td className="num cifra fuerte">{c.roas === null ? <span className="nulo">—</span> : `${c.roas.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mk-panel xl:col-span-4">
          <div className="mk-panel-cabecera">
            <h2 className="mk-h2 flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-md" style={{ background: "var(--indigo-suave)", color: "var(--indigo)" }}>
                {Ico.copiloto({ className: "h-3.5 w-3.5" })}
              </span>
              Copiloto
            </h2>
          </div>
          <div className="mk-panel-cuerpo">
            <p style={{ fontSize: "13.5px", color: "var(--muted)", lineHeight: 1.55 }}>
              Lee las cifras de este período antes de opinar, y dice en qué se basa. Nunca inventa un número.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {preguntasPara(p).slice(0, 4).map((q) => (
                <Link key={q} href={`/marketing/copiloto?q=${encodeURIComponent(q)}&p=${rango.clave}`} className="mk-prompt">
                  {Ico.rayo({ className: "h-4 w-4" })}
                  <span className="min-w-0">{q}</span>
                </Link>
              ))}
            </div>
            <Link href={`/marketing/copiloto?p=${rango.clave}`} className="btn-suave mk-btn-lg mt-4 w-full">
              Abrir el copiloto
            </Link>
          </div>
        </section>
      </div>

      <section className="mt-7">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="mk-h2">{conRendimiento.length ? "Creatividades con rendimiento" : "Estudio creativo"}</h2>
          <Link href="/marketing/creatividades" className="mk-enlace">
            Ver el estudio {Ico.flecha({ className: "h-3.5 w-3.5" })}
          </Link>
        </div>
        {galeria.length === 0 ? (
          <div className="mk-panel">
            <div className="mk-panel-cuerpo">
              <p className="mb-4" style={{ fontSize: "13.5px", color: "var(--muted)" }}>
                Respondo escribe el anuncio con lo que ya sabe de tu negocio y genera la imagen. No hace falta conectar nada.
              </p>
              <div className="mk-arranques">
                <Arranque icono="producto" titulo="Anuncio de producto" texto="El más vendible, con su precio" href="/marketing/creatividades/nueva?plantilla=producto" />
                <Arranque icono="oferta" titulo="Oferta" texto="Un gancho con plazo" href="/marketing/creatividades/nueva?plantilla=oferta" />
                <Arranque icono="historia" titulo="Historia 9:16" texto="Para historias y reels" href="/marketing/creatividades/nueva?plantilla=historia" />
                <Arranque icono="whatsapp" titulo="Click-to-WhatsApp" texto="Que escriban ahora" href="/marketing/creatividades/nueva?plantilla=whatsapp" />
              </div>
            </div>
          </div>
        ) : (
          <div className="mk-galeria">
            {galeria.map((c) => (
              <TarjetaCreatividad key={c.id} c={c} monedaNegocio={p.monedaNegocio} />
            ))}
          </div>
        )}
      </section>

      <p className="mt-9 max-w-3xl leading-relaxed" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
        Se cuentan las conversaciones que Meta marcó como venidas de un anuncio de Facebook o Instagram
        {p.sinAnuncio > 0 ? `; en este período hubo además ${formatearNumero(p.sinAnuncio)} contactos por otras vías` : ""}. La venta se
        atribuye al primer anuncio que trajo a esa persona, aunque haya comprado semanas después. «Ingresos» cuenta al menos: solo entra lo que pasó
        por el enlace de pago.
      </p>
    </main>
  );
}

function Arranque({ icono, titulo, texto, href }: { icono: keyof typeof Ico; titulo: string; texto: string; href: string }) {
  return (
    <Link href={href} className="mk-arranque">
      <span className="mk-arranque-icono">{Ico[icono]({ className: "h-[18px] w-[18px]" })}</span>
      <span className="mk-arranque-titulo">{titulo}</span>
      <span className="mk-arranque-texto">{texto}</span>
    </Link>
  );
}
