import Link from "next/link";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import type { FilaAnuncio } from "@/lib/marketing/tipos";

/**
 * LOS ANUNCIOS DE UNA CAMPAÑA (o de todas), con miniatura y resultado.
 *
 * Es una tabla de servidor a propósito: no hace falta filtrar ni ordenar
 * porque son pocos por campaña, y así la miniatura llega en el primer render.
 * Cada fila enlaza a las personas que trajo ese anuncio.
 */
export default function TablaAnuncios({
  anuncios,
  monedaNegocio,
  periodo,
  mostrarCampana = false,
}: {
  anuncios: FilaAnuncio[];
  monedaNegocio: string;
  periodo: string;
  mostrarCampana?: boolean;
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
  const plata = (v: number | null) =>
    v === null ? <span style={{ color: "var(--muted-3)" }}>—</span> : formatearMonto({ valor: v, moneda: monedaNegocio });

  return (
    <div className="overflow-x-auto">
      <table className="tabla min-w-[820px]">
        <thead>
          <tr>
            <th>Anuncio</th>
            {mostrarCampana && <th>Campaña</th>}
            <th className="text-right" data-tip="Lo que Meta cobró. Requiere la cuenta conectada.">Gasto</th>
            <th className="text-right">Clics</th>
            <th className="text-right">Conv.</th>
            <th className="text-right">Calif.</th>
            <th className="text-right" data-tip="Cotizaciones enviadas o horas tomadas">Cotiz./Res.</th>
            <th className="text-right">Ventas</th>
            <th className="text-right">Cobrado</th>
            <th className="text-right" data-tip="Costo por conversación">CPC</th>
          </tr>
        </thead>
        <tbody>
          {ordenados.map((a) => (
            <tr key={a.id}>
              <td className="max-w-[320px]">
                <div className="flex items-center gap-2.5">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded" style={{ background: "var(--fondo-hundido)" }}>
                    {a.imagenUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.imagenUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <Link href={`/marketing/leads?p=${periodo}&a=${encodeURIComponent(a.id)}`} className="block truncate font-semibold hover:underline" title={`Ver las personas que trajo «${a.titular}»`}>
                      {a.titular || "Anuncio sin titular"}
                    </Link>
                    <div className="truncate" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }} title={a.cuerpo}>
                      {a.cuerpo || a.id}
                    </div>
                  </div>
                </div>
              </td>
              {mostrarCampana && (
                <td className="max-w-[200px]">
                  <Link href={`/marketing/campanas/${encodeURIComponent(a.campanaId)}?p=${periodo}`} className="block truncate hover:underline">
                    {a.campanaNombre}
                  </Link>
                </td>
              )}
              <td className="cifra text-right">{plata(a.gasto)}</td>
              <td className="cifra text-right">{a.clics === null ? <span style={{ color: "var(--muted-3)" }}>—</span> : formatearNumero(a.clics)}</td>
              <td className="whitespace-nowrap text-right">
                <span className="cifra">{formatearNumero(a.conversaciones)}</span>
                <span className="mk-barra ml-2" style={{ width: Math.max(2, (a.conversaciones / maxConv) * 36) }} />
              </td>
              <td className="cifra text-right">{formatearNumero(a.calificados)}</td>
              <td className="cifra text-right">{formatearNumero(a.cotizaciones + a.agendadas)}</td>
              <td className="cifra text-right font-semibold">{formatearNumero(a.ventas)}</td>
              <td className="cifra text-right font-semibold" style={{ color: a.cobrado > 0 ? "var(--indigo)" : "var(--muted-3)" }}>
                {a.cobrado > 0 ? formatearMonto({ valor: a.cobrado, moneda: monedaNegocio }) : "—"}
              </td>
              <td className="cifra text-right">{a.gasto !== null && a.conversaciones ? formatearMonto({ valor: a.gasto / a.conversaciones, moneda: monedaNegocio }) : <span style={{ color: "var(--muted-3)" }}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!hayGasto && (
        <div className="border-t px-4 py-2.5" style={{ borderColor: "var(--borde)", fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
          El gasto y los clics aparecen cuando la cuenta de Meta está conectada.{" "}
          <Link href="/marketing/integraciones" className="font-semibold" style={{ color: "var(--indigo)" }}>
            Conectar
          </Link>
        </div>
      )}
    </div>
  );
}
