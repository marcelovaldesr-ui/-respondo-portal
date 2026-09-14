import { exigirPermisoPortal } from "@/lib/auth";
import { opcionesDemo } from "@/lib/marketing/modo";
import { resolverRango, sumarDias, diasEntre } from "@/lib/ads/periodos";
import { formatearMonto, formatearNumero, formatearPorcentaje } from "@/lib/ads/moneda";
import { rendimientoMulticanal, NIVELES_BUSQUEDA } from "@/lib/ads/canales";
import { analizarAds } from "@/lib/ads/analisis";
import { ctr, type FilaRendimiento } from "@/lib/ads/canal";
import { panoramaDemo } from "@/lib/marketing/demo";
import Cabecera from "@/components/marketing/Cabecera";
import Recomendaciones from "@/components/marketing/Recomendaciones";

export const dynamic = "force-dynamic";

/**
 * BÚSQUEDA — qué escribe realmente la gente antes de hacer clic.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTA PANTALLA EXISTE APARTE
 *
 * Los términos de búsqueda son el único lugar de toda la publicidad donde se
 * lee, con sus palabras, qué está buscando la persona que paga el negocio. No
 * es una métrica más: es la materia prima para escribir mejores anuncios, para
 * encontrar servicios que la gente pide y el negocio no ofrece, y para cortar
 * el gasto que se va en búsquedas que nunca iban a comprar.
 *
 * Solo existe con Google conectado, porque Meta no tiene nada equivalente
 * —ahí no se busca, se interrumpe—. Por eso la sección aparece en el riel
 * únicamente cuando hay una cuenta de Google leyendo: una pantalla vacía
 * permanente enseña que el producto tiene partes muertas.
 *
 * ⚠️ NO se pide en la carga del inicio. Son dos consultas más a Google (las
 * palabras y los términos) y no tienen por qué pagarlas las seis cifras de la
 * portada: se piden acá, donde se muestran.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export default async function Busqueda({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const { demo, variante } = await opcionesDemo();
  const rango = resolverRango((await searchParams).p);
  const largo = diasEntre(rango.desde, rango.hasta);
  const anterior = { desde: sumarDias(rango.desde, -largo), hasta: sumarDias(rango.desde, -1) };

  /**
   * En demostración se usan los mismos fixtures de Google que el resto del
   * módulo: la demo tiene que mostrar esta pantalla tal como se va a ver con
   * datos reales, incluido el término que NO se debe excluir.
   */
  const { filas, filasAntes, fallas } = demo
    ? (() => {
        const p = panoramaDemo(rango, variante === "meta" ? "google" : variante);
        return { filas: p.filasAds, filasAntes: [] as FilaRendimiento[], fallas: [] };
      })()
    : await (async () => {
        const [ahora, antes] = await Promise.all([
          rendimientoMulticanal(usuario.clienteId, rango, NIVELES_BUSQUEDA),
          rendimientoMulticanal(usuario.clienteId, anterior, ["campana"]),
        ]);
        return { filas: ahora.filas, filasAntes: antes.filas, fallas: ahora.fallas };
      })();

  const deGoogle = filas.filter((f) => f.proveedor === "google");
  const palabras = deGoogle.filter((f) => f.nivel === "palabra").sort((a, b) => b.gasto.valor - a.gasto.valor);
  const terminos = deGoogle.filter((f) => f.nivel === "termino").sort((a, b) => b.gasto.valor - a.gasto.valor);
  const grupos = deGoogle.filter((f) => f.nivel === "grupo").sort((a, b) => b.gasto.valor - a.gasto.valor);
  const moneda = deGoogle[0]?.gasto.moneda ?? "CLP";

  const analisis = analizarAds({
    filas: deGoogle,
    filasAntes: filasAntes.filter((f) => f.proveedor === "google"),
    periodo: rango.etiqueta.toLowerCase(),
    dias: largo,
  });

  const plata = (v: number) => formatearMonto({ valor: v, moneda }, { monedaDelNegocio: "CLP" });
  /** Las palabras activas, para explicar qué término ya está cubierto. */
  const textosPalabras = new Set(palabras.map((p) => p.nombre.toLowerCase()));

  return (
    <main className="mk-pagina">
      <Cabecera
        titulo="Búsqueda"
        bajada="Lo que la gente escribe en Google antes de llegar a ti."
        demo={demo}
        rango={rango}
        base="/marketing/busqueda"
      />

      {fallas.map((f) => (
        <div key={f.proveedor} className="mk-panel mk-aviso mb-6" style={{ borderLeft: "3px solid var(--alerta)" }}>
          {f.mensaje}
        </div>
      ))}

      {deGoogle.length === 0 ? (
        <div className="vacio mt-6">
          <div className="vacio-titulo">Todavía no hay datos de Búsqueda</div>
          <p className="vacio-texto">
            Esta pantalla se llena con las campañas de Búsqueda de Google. Las campañas de Máximo rendimiento y las
            Smart no entregan términos ni palabras clave: en esas, Google no deja ver qué se buscó.
          </p>
        </div>
      ) : (
        <>
          {(analisis.recomendaciones.length > 0 || analisis.insuficientes.length > 0) && (
            <Recomendaciones analisis={analisis} max={4} />
          )}

          <section className="mk-panel mt-7">
            <div className="mk-panel-cabecera">
              <div>
                <h2 className="mk-h2">Términos de búsqueda</h2>
                <p className="mk-meta mt-0.5">
                  Lo que la persona escribió de verdad. No es lo mismo que tus palabras clave: es lo que Google decidió
                  que se parecía a ellas.
                </p>
              </div>
              <span className="mk-meta">{formatearNumero(terminos.length)} términos con actividad</span>
            </div>
            <div className="overflow-x-auto">
              <table className="mk-tabla min-w-[760px]">
                <thead>
                  <tr>
                    <th>Término</th>
                    <th>Lo disparó</th>
                    <th className="num">Gasto</th>
                    <th className="num">Clics</th>
                    <th className="num">Conv.</th>
                    <th className="num">CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {terminos.slice(0, 40).map((t) => {
                    const conv = t.resultados?.cantidad ?? 0;
                    const yaEsPalabra = textosPalabras.has(t.nombre.toLowerCase());
                    return (
                      <tr key={`${t.campanaId}-${t.id}`}>
                        <td className="max-w-[320px]">
                          <span className="block truncate font-semibold" style={{ fontSize: "13.5px" }} title={t.nombre}>
                            {t.nombre}
                          </span>
                          <span className="mk-meta">
                            {conv > 0 && !yaEsPalabra
                              ? "Convierte y todavía no es palabra clave propia"
                              : conv === 0 && t.clics >= 3
                                ? "Gasta sin convertir"
                                : t.campanaNombre ?? ""}
                          </span>
                        </td>
                        <td className="truncate" style={{ fontSize: "12.5px", color: "var(--muted-2)" }}>
                          {String(t.extra?.palabraQueLoDisparo ?? "—")}
                        </td>
                        <td className="num cifra">{plata(t.gasto.valor)}</td>
                        <td className="num cifra">{formatearNumero(t.clics)}</td>
                        <td className="num cifra fuerte">{formatearNumero(conv)}</td>
                        <td className="num cifra">
                          {/* Coma decimal: las cifras chilenas no se escriben con punto. */}
                          {ctr(t) === null ? <span className="nulo">—</span> : formatearPorcentaje(ctr(t))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mk-meta px-4 pb-4">
              Antes de excluir un término, Respondo verifica que no bloquee una palabra clave activa del mismo grupo.
              Los que sí chocarían no se proponen: aparecen arriba, en «lo que todavía no se puede concluir».
            </p>
          </section>

          <section className="mk-panel mt-7">
            <div className="mk-panel-cabecera">
              <h2 className="mk-h2">Palabras clave</h2>
              <span className="mk-meta">{formatearNumero(palabras.length)} con actividad</span>
            </div>
            <div className="overflow-x-auto">
              <table className="mk-tabla min-w-[760px]">
                <thead>
                  <tr>
                    <th>Palabra</th>
                    <th>Grupo</th>
                    <th className="num">Gasto</th>
                    <th className="num">Clics</th>
                    <th className="num">Conv.</th>
                    <th className="num">Costo/conv.</th>
                  </tr>
                </thead>
                <tbody>
                  {palabras.slice(0, 40).map((k) => {
                    const conv = k.resultados?.cantidad ?? 0;
                    return (
                      <tr key={k.id}>
                        <td className="max-w-[280px]">
                          <span className="block truncate font-semibold" style={{ fontSize: "13.5px" }} title={k.nombre}>
                            {k.nombre}
                          </span>
                          <span className="mk-meta">{String(k.extra?.concordancia ?? "").toLowerCase()}</span>
                        </td>
                        <td className="truncate" style={{ fontSize: "12.5px", color: "var(--muted-2)" }}>
                          {k.grupoNombre ?? "—"}
                        </td>
                        <td className="num cifra">{plata(k.gasto.valor)}</td>
                        <td className="num cifra">{formatearNumero(k.clics)}</td>
                        <td className="num cifra fuerte">{formatearNumero(conv)}</td>
                        <td className="num cifra">
                          {conv > 0 ? plata(k.gasto.valor / conv) : <span className="nulo">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {grupos.length > 0 && (
            <section className="mk-panel mt-7">
              <div className="mk-panel-cabecera">
                <h2 className="mk-h2">Grupos de anuncios</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="mk-tabla min-w-[620px]">
                  <thead>
                    <tr>
                      <th>Grupo</th>
                      <th>Campaña</th>
                      <th className="num">Gasto</th>
                      <th className="num">Clics</th>
                      <th className="num">Conv.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupos.map((g) => (
                      <tr key={g.id}>
                        <td className="font-semibold" style={{ fontSize: "13.5px" }}>
                          {g.nombre}
                        </td>
                        <td className="truncate" style={{ fontSize: "12.5px", color: "var(--muted-2)" }}>
                          {g.campanaNombre ?? "—"}
                        </td>
                        <td className="num cifra">{plata(g.gasto.valor)}</td>
                        <td className="num cifra">{formatearNumero(g.clics)}</td>
                        <td className="num cifra fuerte">{formatearNumero(g.resultados?.cantidad ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
