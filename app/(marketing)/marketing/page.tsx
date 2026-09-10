import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import type { Metrica } from "@/lib/ads/metricas";
import { cargarMarketing } from "@/lib/marketing/datos";
import { modoDemo } from "@/lib/marketing/modo";
import { ESTADO_CAMPANA, type Panorama } from "@/lib/marketing/tipos";
import { PREGUNTAS_SUGERIDAS } from "@/lib/marketing/copilotoCore";
import Cabecera from "@/components/marketing/Cabecera";
import TarjetaMetrica from "@/components/marketing/TarjetaMetrica";
import GraficoTendencia from "@/components/marketing/GraficoTendencia";
import Embudo from "@/components/marketing/Embudo";
import Hallazgos from "@/components/marketing/Hallazgos";
import Onboarding from "@/components/marketing/Onboarding";
import TarjetaCreatividad from "@/components/marketing/TarjetaCreatividad";
import { Ico } from "@/components/marketing/Iconos";

export const dynamic = "force-dynamic";

/**
 * INICIO — el centro de mando.
 *
 * Responde en este orden, que es el orden en que le importa al dueño:
 *   1. ¿Hay algo que atender?        → hallazgos con evidencia
 *   2. ¿Cómo vamos?                   → siete métricas con su certeza
 *   3. ¿Sube o baja?                  → un gráfico grande, no seis chicos
 *   4. ¿Dónde se pierde la gente?     → el embudo que Meta no ve
 *   5. ¿Qué campañas traen la plata?  → las mejores, con enlace al detalle
 *   6. ¿Qué anuncios funcionan?       → creatividades con rendimiento
 *   7. ¿Qué haría un asesor?          → la entrada al copiloto
 *
 * Cuando el negocio recién empieza y no hay atribución, arriba aparece el
 * onboarding — pero NUNCA solo: las creatividades, el copiloto y la demo
 * están disponibles desde el primer minuto.
 */
export default async function InicioMarketing({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const rango = resolverRango((await searchParams).p);
  const p = await cargarMarketing(usuario.clienteId, rango, { demo });

  const metrica = (clave: string): Metrica | undefined =>
    p.metricas.flatMap((g) => g.metricas).find((m) => m.clave === clave);
  const calificados = p.leads.filter((l) => l.calificado).length;
  const mCalificados: Metrica = {
    clave: "calificados",
    etiqueta: "Leads calificados",
    valor: calificados,
    certeza: "medida",
    ayuda: "Conversaciones que avanzaron a interesado o más, o que cotizaron, reservaron o compraron.",
  };
  const mCostoLead: Metrica = (() => {
    const gasto = metrica("gasto");
    if (!gasto || gasto.certeza === "no_disponible" || !gasto.monto) {
      return { clave: "costo_lead", etiqueta: "Costo por lead calificado", valor: null, certeza: "no_disponible", ayuda: "Gasto dividido por leads calificados.", motivo: gasto?.motivo };
    }
    return {
      clave: "costo_lead",
      etiqueta: "Costo por lead calificado",
      valor: calificados ? gasto.monto.valor / calificados : null,
      monto: calificados ? { valor: gasto.monto.valor / calificados, moneda: gasto.monto.moneda } : null,
      certeza: "derivada",
      ayuda: "Gasto dividido por leads calificados.",
      menosEsMejor: true,
    };
  })();

  const tarjetas: { m: Metrica; serie?: (number | null)[]; destacada?: boolean }[] = [
    { m: metrica("gasto")!, serie: p.serie.map((d) => d.gasto) },
    { m: metrica("conversaciones")!, serie: p.serie.map((d) => d.conversaciones) },
    { m: mCalificados, serie: p.serie.map((d) => d.calificados) },
    { m: metrica("ventas")!, serie: p.serie.map((d) => d.ventas), destacada: true },
    { m: mCostoLead },
    { m: metrica("cobrado")!, serie: p.serie.map((d) => d.cobrado) },
    { m: metrica("roas")! },
  ].filter((t) => t.m);

  const destacadas = p.campanas.filter((c) => c.origen !== "borrador").slice(0, 5);
  const conRendimiento = p.creatividades.filter((c) => c.rendimiento && c.rendimiento.conversaciones > 0).sort((a, b) => (b.rendimiento?.ventas ?? 0) - (a.rendimiento?.ventas ?? 0)).slice(0, 3);
  const cuenta = p.demo ? "Gráfica Andina · CLP" : p.metaConectada ? "Meta conectada" : null;

  return (
    <main className="mk-pagina">
      <Cabecera
        eyebrow={`Marketing · ${p.demo ? "Gráfica Andina" : usuario.clienteNombre}`}
        titulo="Inicio"
        bajada="Qué anuncios traen clientes y qué pasó después del clic."
        cuenta={cuenta}
        demo={p.demo}
        rango={rango}
        base="/marketing"
        acciones={
          <Link href="/marketing/campanas/nueva" className="btn-primario">
            {Ico.nueva()} Crear campaña
          </Link>
        }
      />

      {!p.estado.hayAtribucion && !p.demo && <Onboarding estado={p.estado} creatividades={p.creatividades.length} />}

      {p.hallazgos.length > 0 && (
        <section className="mb-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="eyebrow">Lo que conviene mirar</h2>
            <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
              Hallazgos automáticos · {rango.etiqueta.toLowerCase()}
            </span>
          </div>
          <Hallazgos items={p.hallazgos} columnas={p.hallazgos.length >= 3 ? 3 : 2} />
        </section>
      )}

      <section className="mb-5">
        <div className="mk-metricas">
          {tarjetas.map((t) => (
            <TarjetaMetrica key={t.m.clave} m={t.m} monedaNegocio={p.monedaNegocio} serie={t.serie} destacada={t.destacada} />
          ))}
        </div>
      </section>

      <section className="tarjeta mk-seccion mb-5">
        <div className="mk-seccion-cabecera">
          <h2 className="h-seccion">Tendencia</h2>
          <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
            Por día · {p.serie.length} días
          </span>
        </div>
        <div className="mk-seccion-cuerpo">
          <GraficoTendencia serie={p.serie} metaConectada={p.metaConectada} />
        </div>
      </section>

      <div className="mb-5 grid gap-5 lg:grid-cols-12">
        <section className="tarjeta mk-seccion lg:col-span-5">
          <div className="mk-seccion-cabecera">
            <h2 className="h-seccion">Del anuncio a la venta</h2>
            <Link href="/marketing/atribucion" className="font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}>
              Atribución →
            </Link>
          </div>
          <div className="mk-seccion-cuerpo">
            <Embudo
              escalones={p.embudo}
              enlaces={{
                conversaciones: `/marketing/leads?p=${rango.clave}`,
                calificados: `/marketing/leads?p=${rango.clave}&f=calificados`,
                avanzados: `/marketing/leads?p=${rango.clave}&f=cotizados`,
                ventas: `/marketing/leads?p=${rango.clave}&f=compraron`,
              }}
            />
            <p className="mt-3 leading-relaxed" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
              Meta ve hasta el clic. Desde la conversación en adelante lo contamos nosotros, y cada escalón se puede abrir hasta las personas.
            </p>
          </div>
        </section>

        <section className="tarjeta mk-seccion lg:col-span-7">
          <div className="mk-seccion-cabecera">
            <h2 className="h-seccion">Campañas que más traen</h2>
            <Link href={`/marketing/campanas?p=${rango.clave}`} className="font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}>
              Todas las campañas →
            </Link>
          </div>
          {destacadas.length === 0 ? (
            <div className="vacio">
              <div className="vacio-titulo">Todavía no hay campañas con datos</div>
              <p className="vacio-texto">Cuando alguien entre a WhatsApp desde un anuncio, aparece acá con su costo y su resultado.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Link href="/marketing/campanas/nueva" className="btn-primario">Crear primera campaña</Link>
                <Link href="/marketing/creatividades/nueva" className="btn-suave">Crear creatividad</Link>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Campaña</th>
                    <th className="text-right">Gasto</th>
                    <th className="text-right">Conv.</th>
                    <th className="text-right">Calif.</th>
                    <th className="text-right">Ventas</th>
                    <th className="text-right">Cobrado</th>
                    <th className="text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {destacadas.map((c) => (
                    <tr key={c.id}>
                      <td className="max-w-[260px]">
                        <Link href={`/marketing/campanas/${encodeURIComponent(c.id)}?p=${rango.clave}`} className="block truncate font-semibold hover:underline">
                          {c.nombre}
                        </Link>
                        <span className={`${ESTADO_CAMPANA[c.estado].clase} mt-0.5`}>{ESTADO_CAMPANA[c.estado].texto}</span>
                      </td>
                      <td className="cifra text-right">{c.gasto === null ? <span style={{ color: "var(--muted-3)" }}>—</span> : formatearMonto({ valor: c.gasto, moneda: c.moneda }, { monedaDelNegocio: p.monedaNegocio })}</td>
                      <td className="cifra text-right">{formatearNumero(c.conversaciones)}</td>
                      <td className="cifra text-right">{formatearNumero(c.calificados)}</td>
                      <td className="cifra text-right font-semibold">{formatearNumero(c.ventas)}</td>
                      <td className="cifra text-right font-semibold" style={{ color: c.cobrado > 0 ? "var(--indigo)" : "var(--muted-3)" }}>
                        {c.cobrado > 0 ? formatearMonto({ valor: c.cobrado, moneda: p.monedaNegocio }) : "—"}
                      </td>
                      <td className="cifra text-right">{c.roas === null ? <span style={{ color: "var(--muted-3)" }}>—</span> : `${c.roas.toFixed(1)}×`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <section className="lg:col-span-8">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="eyebrow">Creatividades con rendimiento</h2>
            <Link href="/marketing/creatividades" className="font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}>
              Estudio creativo →
            </Link>
          </div>
          {conRendimiento.length === 0 ? (
            <div className="tarjeta">
              <div className="vacio">
                <div className="vacio-titulo">{p.creatividades.length ? "Tus creatividades todavía no tienen datos de Meta" : "Todavía no hay creatividades"}</div>
                <p className="vacio-texto">
                  {p.creatividades.length
                    ? "Cuando corran en un anuncio y alguien escriba, acá se ve cuál trae conversaciones y cuál trae ventas."
                    : "El estudio escribe el anuncio con lo que Respondo ya sabe de tu negocio y genera la imagen."}
                </p>
                <Link href="/marketing/creatividades/nueva" className="btn-primario mt-4">Crear una creatividad</Link>
              </div>
            </div>
          ) : (
            <div className="mk-galeria">
              {conRendimiento.map((c) => (
                <TarjetaCreatividad key={c.id} c={c} monedaNegocio={p.monedaNegocio} compacta />
              ))}
            </div>
          )}
        </section>

        <section className="lg:col-span-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="eyebrow">Copiloto</h2>
          </div>
          <div className="tarjeta p-4">
            <div className="flex items-center gap-2 font-semibold" style={{ fontSize: "var(--t-fila)" }}>
              <span className="grid h-7 w-7 place-items-center rounded-md" style={{ background: "var(--indigo-suave)", color: "var(--indigo)" }}>
                {Ico.copiloto()}
              </span>
              Pregúntale a Respondo sobre tus campañas
            </div>
            <p className="mt-1.5 leading-relaxed" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
              Responde con las cifras de este período y te dice qué haría. Nunca inventa un número.
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
              {PREGUNTAS_SUGERIDAS.slice(0, 4).map((q) => (
                <Link
                  key={q}
                  href={`/marketing/copiloto?q=${encodeURIComponent(q)}&p=${rango.clave}`}
                  className="rounded-md border px-3 py-2 text-left transition-colors hover:bg-[#fbfbfe]"
                  style={{ borderColor: "var(--borde)", fontSize: "var(--t-menor)", color: "var(--tinta)" }}
                >
                  {q}
                </Link>
              ))}
            </div>
            <Link href={`/marketing/copiloto?p=${rango.clave}`} className="btn-suave mt-3 w-full">
              Abrir el copiloto
            </Link>
          </div>
        </section>
      </div>

      <PieDeInicio p={p} />
    </main>
  );
}

function PieDeInicio({ p }: { p: Panorama }) {
  return (
    <p className="mt-8 max-w-3xl leading-relaxed" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
      Se cuentan las conversaciones que Meta marcó como venidas de un anuncio de Facebook o Instagram
      {p.sinAnuncio > 0 ? `; en este período hubo además ${formatearNumero(p.sinAnuncio)} contactos por otras vías` : ""}. La venta se
      atribuye al primer anuncio que trajo a esa persona, aunque haya comprado semanas después. «Cobrado» es un piso: solo lo que
      pasó por el enlace de pago.
    </p>
  );
}
