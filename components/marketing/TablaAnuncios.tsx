import Link from "next/link";
import { formatearMonto, formatearNumero, formatearPorcentaje } from "@/lib/ads/moneda";
import { costoPorResultado, ctr, ETIQUETA_RESULTADO, type FilaRendimiento } from "@/lib/ads/canal";
import type { FilaAnuncio } from "@/lib/marketing/tipos";
import { PieSinPublicidad } from "@/components/marketing/Estado";
import { urlDeImagen } from "@/lib/marketing/imagenes";

/**
 * LOS ANUNCIOS, con su miniatura y la calidad del lead que traen.
 *
 * Es una tabla de servidor a propósito: son pocos por campaña y así la
 * miniatura llega en el primer render. La primera columna es la creatividad
 * —imagen, titular y cuerpo— porque el dueño reconoce sus anuncios por la
 * foto, no por el id de Meta.
 *
 * «Cierran» es la columna que ninguna plataforma puede mostrar: qué
 * porcentaje de las conversaciones de ese anuncio terminó en venta.
 */
export default function TablaAnuncios({
  anuncios,
  monedaNegocio,
  periodo,
  mostrarCampana = false,
  puedeConectarMeta,
  motivoSinPublicidad,
}: {
  anuncios: FilaAnuncio[];
  monedaNegocio: string;
  periodo: string;
  mostrarCampana?: boolean;
  /** Si la instalación permite conectar una cuenta publicitaria. */
  puedeConectarMeta: boolean;
  /** Por qué faltan las cifras de publicidad, ya escrito para el dueño. */
  motivoSinPublicidad: string;
}) {
  if (anuncios.length === 0) {
    return (
      <div className="vacio">
        <div className="vacio-titulo">Sin anuncios con actividad en este período</div>
        <p className="vacio-texto">Prueba con un período más largo, o revisa que la campaña esté activa en la plataforma.</p>
      </div>
    );
  }
  const hayGasto = anuncios.some((a) => a.gasto !== null);
  const ordenados = [...anuncios].sort((a, b) => b.cobrado - a.cobrado || b.ventas - a.ventas || b.conversaciones - a.conversaciones);
  const maxConv = Math.max(...anuncios.map((a) => a.conversaciones), 1);
  const raya = <span className="nulo">—</span>;

  return (
    <div className="overflow-x-auto">
      <table className="mk-tabla min-w-[940px]">
        <thead>
          <tr>
            <th>Anuncio</th>
            {mostrarCampana && <th>Campaña</th>}
            <th className="num" data-tip="Lo que cobró tu cuenta publicitaria en el período.">Invertido</th>
            <th className="num">Clics</th>
            <th className="num">Conversaciones</th>
            <th className="num" data-tip="Costo por conversación = invertido ÷ conversaciones. No es el costo por clic.">Costo/conv.</th>
            <th className="num" data-tip="Avanzaron a interesado o más, o cotizaron, reservaron o compraron">Calificados</th>
            <th className="num" data-tip="Ventas ÷ conversaciones de este anuncio">Cierran</th>
            <th className="num">Ingresos</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {ordenados.map((a) => (
            <tr key={a.id}>
              <td className="max-w-[330px]">
                <div className="flex items-center gap-3">
                  <div className="mk-miniatura">
                    {a.imagenUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={urlDeImagen(a.imagenUrl) ?? ""} alt="" loading="lazy" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <Link
                      href={`/marketing/leads?p=${periodo}&a=${encodeURIComponent(a.id)}`}
                      className="block truncate font-semibold hover:underline"
                      style={{ fontSize: "13.5px" }}
                      title={`Ver quién llegó desde «${a.titular}»`}
                    >
                      {a.titular || "Anuncio sin titular"}
                    </Link>
                    {/* Solo si hay texto real. La clave interna del aviso —un
                        número de 17 dígitos de Meta, o la palabra «sin_id»— no
                        le dice nada a nadie y se veía bajo cada fila. */}
                    {a.cuerpo && (
                      <div className="truncate" style={{ fontSize: "11.5px", color: "var(--muted-2)" }} title={a.cuerpo}>
                        {a.cuerpo}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              {mostrarCampana && (
                <td className="max-w-[190px]">
                  <Link href={`/marketing/campanas/${encodeURIComponent(a.campanaId)}?p=${periodo}`} className="block truncate hover:underline">
                    {a.campanaNombre}
                  </Link>
                </td>
              )}
              {/*
                ⚠️ El gasto se formatea con LA MONEDA DEL ANUNCIO, que es la de
                la cuenta publicitaria. Antes usaba `monedaNegocio` —fijo en
                «CLP»— y US$50 gastados en Meta salían como «$50»: la misma
                cifra, la moneda equivocada y ninguna forma de notarlo.
              */}
              <td className="num cifra">
                {a.gasto === null ? raya : formatearMonto({ valor: a.gasto, moneda: a.moneda }, { monedaDelNegocio: monedaNegocio })}
              </td>
              <td className="num cifra">{a.clics === null ? raya : formatearNumero(a.clics)}</td>
              <td className="num">
                <span className="inline-flex items-center gap-2">
                  <span className="mk-barra" style={{ width: Math.max(3, (a.conversaciones / maxConv) * 40) }} />
                  <span className="cifra">{formatearNumero(a.conversaciones)}</span>
                </span>
              </td>
              <td className="num cifra">
                {a.gasto !== null && a.conversaciones
                  ? formatearMonto({ valor: a.gasto / a.conversaciones, moneda: a.moneda }, { monedaDelNegocio: monedaNegocio })
                  : raya}
              </td>
              <td className="num cifra">{formatearNumero(a.calificados)}</td>
              <td className="num cifra fuerte">{a.conversaciones ? formatearPorcentaje((a.ventas / a.conversaciones) * 100) : raya}</td>
              <td className="num cifra plata">
                {a.cobrado > 0 ? formatearMonto({ valor: a.cobrado, moneda: monedaNegocio }) : raya}
              </td>
              <td className="num">
                <Link href={`/marketing/leads?p=${periodo}&a=${encodeURIComponent(a.id)}`} className="btn-chico">
                  Personas
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!hayGasto && (
        <PieSinPublicidad texto={motivoSinPublicidad} puedeConectar={puedeConectarMeta} hayPublicidad={hayGasto} />
      )}
    </div>
  );
}

/**
 * LOS ANUNCIOS TAL COMO LOS VE LA PLATAFORMA.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * QUÉ SE ROMPÍA: la pestaña «Anuncios» de una campaña se arma con `p.anuncios`,
 * que sale de las conversaciones atribuidas. Un negocio sin WhatsApp no tiene
 * ninguna, así que la lista salía vacía aunque la campaña tuviera seis avisos
 * corriendo y gastando — y el vacío decía «revisa que la campaña esté activa»,
 * que era culpar al dueño de un dato que nosotros no estábamos pidiendo.
 *
 * POR QUÉ UN COMPONENTE APARTE Y NO UN PARÁMETRO MÁS EN `TablaAnuncios`:
 * las dos tablas no comparten NI UNA columna con la misma definición. Arriba la
 * primera celda es la creatividad (miniatura, titular, cuerpo) y las cinco
 * siguientes —conversaciones, costo por conversación, calificados, cierran,
 * ingresos— existen solo con conversaciones propias; acá no hay creatividad que
 * mostrar (la plataforma entrega un id y a lo más un nombre) y las columnas son
 * las que la plataforma sí mide. Unificarlas habría sido un componente con dos
 * cuerpos, dos vacíos y un `if` por celda: más código que estas cuarenta líneas
 * y, sobre todo, un sitio donde volver a mezclar métricas que no significan lo
 * mismo. Lo que se comparte de verdad —los formateadores, `mk-tabla` y el pie
 * que explica la falta de cifras— ya se comparte por estar en este archivo.
 *
 * ⚠️ NO hay columnas de conversación en cero. Si no hay señal de conversaciones
 * esas columnas no existen, que es distinto de existir valiendo cero.
 * ───────────────────────────────────────────────────────────────────────────
 */
export function TablaAnunciosDePlataforma({
  filas,
  monedaNegocio,
  vacio,
}: {
  filas: FilaRendimiento[];
  monedaNegocio: string;
  /** Qué decir cuando la plataforma no entregó ningún anuncio del período. */
  vacio: { titulo: string; texto: string };
}) {
  if (filas.length === 0) {
    return (
      <div className="vacio">
        <div className="vacio-titulo">{vacio.titulo}</div>
        <p className="vacio-texto">{vacio.texto}</p>
      </div>
    );
  }

  const ordenados = [...filas].sort((a, b) => b.gasto.valor - a.gasto.valor || b.clics - a.clics);
  const raya = <span className="nulo">—</span>;
  /**
   * La columna de resultados aparece solo si hay resultados que mostrar, y su
   * encabezado dice QUÉ se está contando: «Conversiones del sitio» y
   * «Conversaciones iniciadas» no son lo mismo y no se leen igual. Con tipos
   * mezclados el encabezado se queda en la palabra genérica en vez de elegir
   * uno de los dos y mentir sobre la mitad de las filas.
   */
  const tipos = new Set(ordenados.filter((f) => f.resultados).map((f) => f.resultados!.tipo));
  const hayResultados = tipos.size > 0;
  const etiquetaResultados = tipos.size === 1 ? ETIQUETA_RESULTADO[[...tipos][0]] : "Resultados";

  return (
    <div className="overflow-x-auto">
      <table className="mk-tabla min-w-[760px]">
        <thead>
          <tr>
            <th>Anuncio</th>
            <th className="num" data-tip="Lo que cobró tu cuenta publicitaria en el período.">Invertido</th>
            <th className="num">Impresiones</th>
            <th className="num">Clics</th>
            <th className="num" data-tip="De cada 100 veces que se mostró, cuántas terminaron en clic.">CTR</th>
            {hayResultados && (
              <th className="num" data-tip="Lo que la plataforma cuenta como resultado, con la medición configurada en la cuenta.">
                {etiquetaResultados}
              </th>
            )}
            {hayResultados && <th className="num" data-tip="Invertido ÷ resultados de la plataforma.">Costo/result.</th>}
          </tr>
        </thead>
        <tbody>
          {ordenados.map((f) => {
            const costo = costoPorResultado(f);
            return (
              <tr key={`${f.proveedor}|${f.id}`}>
                <td className="max-w-[330px]">
                  <div className="truncate font-semibold" style={{ fontSize: "13.5px" }} title={f.nombre}>
                    {f.nombre}
                  </div>
                  {f.grupoNombre && (
                    <div className="truncate" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
                      {f.grupoNombre}
                    </div>
                  )}
                </td>
                <td className="num cifra">
                  {formatearMonto({ valor: f.gasto.valor, moneda: f.gasto.moneda }, { monedaDelNegocio: monedaNegocio })}
                </td>
                <td className="num cifra">{formatearNumero(f.impresiones)}</td>
                <td className="num cifra">{formatearNumero(f.clics)}</td>
                <td className="num cifra">{formatearPorcentaje(ctr(f))}</td>
                {hayResultados && (
                  <td className="num cifra fuerte">{f.resultados ? formatearNumero(f.resultados.cantidad) : raya}</td>
                )}
                {hayResultados && (
                  <td className="num cifra">
                    {costo === null ? raya : formatearMonto({ valor: costo.valor, moneda: costo.moneda }, { monedaDelNegocio: monedaNegocio })}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
