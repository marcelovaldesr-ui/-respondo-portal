import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { cargarPauta } from "@/lib/ads/atribucion";
import { estadoDePauta } from "@/lib/ads/estado";
import { hallazgos } from "@/lib/ads/insights";
import { armarMetricas, type DatosPlataforma } from "@/lib/ads/metricas";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import { proveedorMeta } from "@/lib/ads/meta";
import { resolverRango } from "@/lib/ads/periodos";
import Metrica from "@/components/pauta/Metrica";
import SelectorRango from "@/components/pauta/SelectorRango";

export const dynamic = "force-dynamic";

/**
 * RESUMEN — la pantalla que responde «¿vamos bien o mal?» en diez segundos.
 *
 * ORDEN DE LECTURA, QUE ES LO QUE MÁS SE PENSÓ ACÁ:
 *   1. Los hallazgos. Lo que hay que hacer algo al respecto va ARRIBA, antes
 *      que cualquier cifra. Un panel donde primero hay que interpretar veinte
 *      números para llegar a la conclusión es un panel que nadie abre dos veces.
 *   2. Las métricas, en cuatro grupos que van de lo que Meta ya te muestra a lo
 *      que solo nosotros podemos calcular.
 *   3. Los anuncios que están trayendo la plata.
 *
 * Y cuando no hay nada que mostrar, no se muestra un tablero de ceros: se
 * muestra qué falta para que haya algo.
 */
export default async function ResumenPauta({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const rango = resolverRango((await searchParams).p);

  /**
   * Las tres consultas van en paralelo y **Meta va aparte**: si la Graph API
   * está lenta o el token venció, las cifras propias tienen que aparecer igual.
   * Que una integración externa pueda dejar en blanco una pantalla que no la
   * necesita es el error que hace que un panel se sienta poco confiable.
   */
  const [pauta, estado, rendimiento] = await Promise.all([
    cargarPauta(usuario.clienteId, rango),
    estadoDePauta(usuario.clienteId),
    proveedorMeta.rendimiento(usuario.clienteId, rango),
  ]);

  const plataforma: DatosPlataforma = rendimiento.ok
    ? rendimiento.datos.reduce<DatosPlataforma>((acc, r) => {
        if (!acc) {
          return {
            impresiones: r.impresiones,
            clics: r.clics,
            gasto: { valor: r.gasto.valor, moneda: r.gasto.moneda },
          };
        }
        acc.impresiones += r.impresiones;
        acc.clics += r.clics;
        acc.gasto.valor += r.gasto.valor;
        return acc;
      }, null)
    : null;

  const grupos = armarMetricas({
    plataforma,
    propios: pauta.propios,
    anteriores: pauta.propiosAntes ? { plataforma: null, propios: pauta.propiosAntes } : null,
  });

  const señales = hallazgos({
    filas: pauta.filas,
    resumen: pauta.resumen,
    propios: pauta.propios,
    propiosAntes: pauta.propiosAntes,
    periodo: rango.etiqueta.toLowerCase(),
  });

  const topAnuncios = pauta.filas.slice(0, 5);

  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="h-pagina">De dónde viene cada venta</h1>
          <p className="sub-pagina">
            Qué anuncio trajo la conversación, y cuál de esas conversaciones terminó en plata
          </p>
        </div>
        <SelectorRango rango={rango} base="/pauta" />
      </div>

      {/* Aviso de la conexión, solo cuando hay algo que decir. */}
      {!rendimiento.ok && rendimiento.error.codigo !== "sin_conexion" && (
        <div
          className="tarjeta mt-5 flex flex-wrap items-center justify-between gap-3 p-4"
          style={{ borderLeft: "3px solid var(--alerta)" }}
        >
          <span style={{ fontSize: "var(--t-menor)" }}>{rendimiento.error.mensaje}</span>
          {rendimiento.error.href && rendimiento.error.accion && (
            <Link href={rendimiento.error.href} className="btn-suave">
              {rendimiento.error.accion}
            </Link>
          )}
        </div>
      )}

      {!estado.hayAtribucion ? (
        <PrimeraVez estado={estado} />
      ) : (
        <>
          {señales.length > 0 && (
            <section className="mt-5">
              <h2 className="eyebrow">Lo que conviene mirar</h2>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                {señales.map((h) => (
                  <div
                    key={h.clave}
                    className="tarjeta p-4"
                    style={{
                      borderLeft: `3px solid ${
                        h.tono === "alerta"
                          ? "var(--peligro)"
                          : h.tono === "oportunidad"
                            ? "var(--ok)"
                            : "var(--muted-3)"
                      }`,
                    }}
                  >
                    <div className="h-seccion">{h.titulo}</div>
                    <p
                      className="mt-1.5 leading-relaxed"
                      style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
                    >
                      {h.evidencia}
                    </p>
                    {h.href && (
                      <Link
                        href={h.href}
                        className="mt-2 inline-block font-semibold underline"
                        style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}
                      >
                        Ver el detalle
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {grupos.map((g) => (
            <section key={g.clave} className="mt-6">
              <h2 className="eyebrow">{g.titulo}</h2>
              <p className="mt-0.5" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
                {g.descripcion}
              </p>
              <div className="mt-2.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {g.metricas.map((m) => (
                  <Metrica key={m.clave} m={m} monedaNegocio="CLP" />
                ))}
              </div>
            </section>
          ))}

          {topAnuncios.length > 0 && (
            <section className="mt-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="eyebrow">Los que más trajeron</h2>
                <Link
                  href="/pauta/anuncios"
                  className="font-semibold underline"
                  style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}
                >
                  Ver todos
                </Link>
              </div>
              <div className="tarjeta mt-2.5 overflow-x-auto">
                <table className="tabla min-w-[520px]">
                  <thead>
                    <tr>
                      <th>Anuncio</th>
                      <th className="text-right">Conversaciones</th>
                      <th className="text-right">Ventas</th>
                      <th className="text-right">Cobrado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topAnuncios.map((f) => (
                      <tr key={f.clave}>
                        <td className="max-w-[280px] truncate font-semibold">{f.titular}</td>
                        <td className="cifra text-right">{formatearNumero(f.conversaciones)}</td>
                        <td className="cifra text-right">{formatearNumero(f.ventas)}</td>
                        <td className="cifra text-right font-semibold">
                          {f.pagado > 0
                            ? formatearMonto({ valor: f.pagado, moneda: "CLP" })
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <p
        className="mt-8 max-w-3xl leading-relaxed"
        style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
      >
        Se cuentan las conversaciones que Meta marcó como venidas de un anuncio de Facebook o
        Instagram. Quien llega por Google, por el perfil o porque ya te conocía no aparece acá
        {pauta.sinAnuncio > 0 ? `: en este período fueron ${pauta.sinAnuncio} contactos` : ""}. La
        venta se atribuye al primer anuncio que trajo a esa persona, aunque haya comprado semanas
        después.
      </p>
    </main>
  );
}

/**
 * LA PRIMERA VEZ.
 *
 * Nadie tiene que encontrarse un tablero de ceros. Si todavía no llegó nadie
 * por un anuncio, lo único útil que se puede mostrar es en qué pie está la
 * configuración y qué falta — con la parte importante dicha de entrada: la
 * atribución no hay que configurarla, llega sola.
 */
function PrimeraVez({ estado }: { estado: Awaited<ReturnType<typeof estadoDePauta>> }) {
  return (
    <div className="tarjeta mt-6 p-6">
      <h2 className="h-seccion">Todavía no llegó nadie desde un anuncio</h2>
      <p
        className="mt-2 max-w-2xl leading-relaxed"
        style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
      >
        Esta pantalla se llena sola: cuando alguien entre a WhatsApp apretando un aviso de Facebook
        o Instagram, queda registrado de qué anuncio vino y qué pasó después. No hay que instalar
        ni configurar nada para eso. Si ya estás pauteando y esto sigue vacío, revisa que los
        avisos lleven a WhatsApp y no a un formulario o al perfil.
      </p>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Qué hay listo</span>
          <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
            {estado.listos} de {estado.total}
          </span>
        </div>
        <ul className="mt-2 space-y-2.5">
          {estado.items.map((i) => (
            <li key={i.titulo} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className="mt-[6px] h-2 w-2 shrink-0 rounded-full"
                style={{
                  background:
                    i.estado === "ok"
                      ? "var(--ok)"
                      : i.estado === "atencion"
                        ? "var(--alerta)"
                        : "var(--muted-3)",
                }}
              />
              <div className="min-w-0">
                <div style={{ fontSize: "var(--t-fila)", fontWeight: 600 }}>{i.titulo}</div>
                <div
                  className="leading-snug"
                  style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
                >
                  {i.detalle}
                </div>
                {i.accion && (
                  <Link
                    href={i.accion.href}
                    className="mt-1 inline-block font-semibold underline"
                    style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}
                  >
                    {i.accion.texto}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
