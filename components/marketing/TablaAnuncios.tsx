import Link from "next/link";
import { formatearMonto, formatearNumero, formatearPorcentaje } from "@/lib/ads/moneda";
import type { FilaAnuncio } from "@/lib/marketing/tipos";
import { PieSinPublicidad } from "@/components/marketing/Estado";

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
        <p className="vacio-texto">Prueba con un período más largo, o revisa que la campaña esté activa en Meta.</p>
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
                      <img src={a.imagenUrl} alt="" loading="lazy" />
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
              <td className="num cifra">
                {a.gasto === null ? raya : formatearMonto({ valor: a.gasto, moneda: monedaNegocio })}
              </td>
              <td className="num cifra">{a.clics === null ? raya : formatearNumero(a.clics)}</td>
              <td className="num">
                <span className="inline-flex items-center gap-2">
                  <span className="mk-barra" style={{ width: Math.max(3, (a.conversaciones / maxConv) * 40) }} />
                  <span className="cifra">{formatearNumero(a.conversaciones)}</span>
                </span>
              </td>
              <td className="num cifra">
                {a.gasto !== null && a.conversaciones ? formatearMonto({ valor: a.gasto / a.conversaciones, moneda: monedaNegocio }) : raya}
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
        <PieSinPublicidad texto={motivoSinPublicidad} puedeConectar={puedeConectarMeta} metaConectada={hayGasto} />
      )}
    </div>
  );
}
