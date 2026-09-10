import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { cargarPauta } from "@/lib/ads/atribucion";
import { proveedorMeta } from "@/lib/ads/meta";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import { resolverRango } from "@/lib/ads/periodos";
import SelectorRango from "@/components/pauta/SelectorRango";

export const dynamic = "force-dynamic";

/**
 * ANUNCIOS — aviso por aviso, qué trajo cada uno.
 *
 * ⭐ LA TABLA SE ARMA DESDE NUESTROS DATOS, NO DESDE META. Eso es lo que hace
 * que funcione sin conectar nada: los anuncios que aparecen son aquellos por
 * los que alguien efectivamente entró a WhatsApp. Cuando hay conexión, cada
 * fila se ENRIQUECE con el gasto; sin conexión, esas columnas dicen «—» en vez
 * de cero, y las que sí sabemos se muestran igual.
 *
 * Al revés —armar la tabla desde Meta y buscarle conversaciones— la pantalla
 * estaría vacía hasta conectar, y además mostraría anuncios que nunca trajeron
 * a nadie, que es ruido.
 */
export default async function Anuncios({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const rango = resolverRango((await searchParams).p);

  const [pauta, rendimiento] = await Promise.all([
    cargarPauta(usuario.clienteId, rango),
    proveedorMeta.rendimiento(usuario.clienteId, rango),
  ]);

  /** Gasto por id de anuncio, cuando hay conexión. */
  const gastoPorAnuncio = new Map<string, { gasto: number; moneda: string; clics: number }>();
  if (rendimiento.ok) {
    for (const r of rendimiento.datos) {
      const previo = gastoPorAnuncio.get(r.anuncioId);
      gastoPorAnuncio.set(r.anuncioId, {
        gasto: (previo?.gasto ?? 0) + r.gasto.valor,
        moneda: r.gasto.moneda,
        clics: (previo?.clics ?? 0) + r.clics,
      });
    }
  }
  const hayCosto = gastoPorAnuncio.size > 0;

  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="h-pagina">Anuncios</h1>
          <p className="sub-pagina">
            Cada aviso por el que entró alguien a WhatsApp, y en qué terminó
          </p>
        </div>
        <SelectorRango rango={rango} base="/pauta/anuncios" />
      </div>

      {pauta.filas.length === 0 ? (
        <div className="tarjeta mt-6">
          <div className="vacio">
            <div className="vacio-titulo">Ningún anuncio trajo conversaciones en este período</div>
            <p className="vacio-texto">
              Prueba con un rango más largo. Si tampoco aparece nada, revisa que tus avisos lleven
              a WhatsApp: solo esos quedan registrados acá.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="tarjeta mt-5 overflow-x-auto">
            <table className="tabla min-w-[860px]">
              <thead>
                <tr>
                  <th>Anuncio</th>
                  {hayCosto && <th className="text-right">Invertido</th>}
                  <th className="text-right">Conversaciones</th>
                  {hayCosto && <th className="text-right">Costo por conv.</th>}
                  <th className="text-right">Cotizaciones</th>
                  <th className="text-right">Agendaron</th>
                  <th className="text-right">Ventas</th>
                  <th className="text-right">Cobrado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pauta.filas.map((f) => {
                  const meta = f.anuncioId ? gastoPorAnuncio.get(f.anuncioId) : undefined;
                  const costoConv =
                    meta && f.conversaciones > 0
                      ? { valor: meta.gasto / f.conversaciones, moneda: meta.moneda }
                      : null;
                  /**
                   * Se marca, no se juzga. Un aviso con pocas conversaciones y
                   * cero ventas puede llevar tres días activo: pintarlo de rojo
                   * sería una conclusión sin evidencia. El umbral es el mismo
                   * que usan los hallazgos automáticos.
                   */
                  const sinCerrar = f.conversaciones >= 8 && f.ventas === 0;

                  return (
                    <tr key={f.clave}>
                      <td className="max-w-[260px]">
                        <div className="truncate font-semibold">
                          {f.url ? (
                            <a
                              href={f.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              {f.titular}
                            </a>
                          ) : (
                            f.titular
                          )}
                        </div>
                        <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
                          {f.anuncioId ? `id ${f.anuncioId.slice(-8)}` : "sin id de Meta"}
                          {f.conClid > 0 ? ` · ${f.conClid} con clic identificado` : ""}
                        </div>
                        {sinCerrar && (
                          <span className="pildora-alerta mt-1 inline-flex">no cierra</span>
                        )}
                      </td>

                      {hayCosto && (
                        <td className="cifra text-right">
                          {meta
                            ? formatearMonto(
                                { valor: meta.gasto, moneda: meta.moneda },
                                { monedaDelNegocio: "CLP" },
                              )
                            : "—"}
                        </td>
                      )}

                      <td className="cifra text-right">{formatearNumero(f.conversaciones)}</td>

                      {hayCosto && (
                        <td className="cifra text-right">
                          {formatearMonto(costoConv, { monedaDelNegocio: "CLP" })}
                        </td>
                      )}

                      <td className="cifra text-right">{formatearNumero(f.cotizaciones)}</td>
                      <td className="cifra text-right">{formatearNumero(f.agendadas)}</td>
                      <td className="cifra text-right font-semibold">
                        {formatearNumero(f.ventas)}
                      </td>
                      <td
                        className="cifra text-right font-semibold"
                        style={{ color: f.pagado > 0 ? "var(--indigo)" : "var(--muted-3)" }}
                      >
                        {f.pagado > 0
                          ? formatearMonto({ valor: f.pagado, moneda: "CLP" })
                          : "—"}
                      </td>
                      <td className="text-right">
                        <Link
                          href={`/pauta/personas?anuncio=${encodeURIComponent(f.clave)}&p=${rango.clave}`}
                          className="font-semibold underline"
                          style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}
                        >
                          Ver quiénes
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!hayCosto && (
            <p
              className="mt-3 max-w-3xl leading-relaxed"
              style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
            >
              Falta el costo: sin la cuenta publicitaria conectada podemos decirte qué trajo cada
              anuncio, pero no cuánto te costó.{" "}
              <Link href="/pauta/conexion" className="font-semibold underline">
                Conectar Meta
              </Link>
            </p>
          )}
        </>
      )}
    </main>
  );
}
