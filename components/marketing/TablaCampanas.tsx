"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import { ESTADO_CAMPANA, textoObjetivo, type FilaCampana } from "@/lib/marketing/tipos";
import { Ico } from "@/components/marketing/Iconos";

/**
 * LA TABLA DE CAMPAÑAS — buscar, filtrar, ordenar, entrar.
 *
 * Todo ocurre en el navegador sobre las filas que ya vinieron del servidor:
 * son decenas, no miles, y un filtro que hace un viaje a la base por cada
 * tecla se siente lento sin ganar nada.
 *
 * Las columnas de plata muestran «—» cuando no hay Meta, nunca 0. Y las
 * barras de la columna «Conv.» son relativas a la campaña con más
 * conversaciones, para leer el reparto de un vistazo.
 */

type Clave = "nombre" | "gasto" | "conversaciones" | "calificados" | "avanzados" | "ventas" | "cobrado" | "cpc" | "cpv" | "roas";

const COLUMNAS: { clave: Clave; texto: string; num?: boolean; tip?: string }[] = [
  { clave: "nombre", texto: "Campaña" },
  { clave: "gasto", texto: "Gasto", num: true, tip: "Lo que Meta cobró en el período. Requiere la cuenta conectada." },
  { clave: "conversaciones", texto: "Conv.", num: true, tip: "Personas que escribieron por WhatsApp desde esta campaña." },
  { clave: "calificados", texto: "Calif.", num: true, tip: "Avanzaron a interesado o más, o cotizaron, reservaron o compraron." },
  { clave: "avanzados", texto: "Cotiz./Res.", num: true, tip: "Se envió cotización o se tomó una hora." },
  { clave: "ventas", texto: "Ventas", num: true },
  { clave: "cobrado", texto: "Cobrado", num: true, tip: "Solo lo pagado por enlace de pago. Es un piso." },
  { clave: "cpc", texto: "CPC", num: true, tip: "Costo por conversación = gasto ÷ conversaciones." },
  { clave: "cpv", texto: "CPV", num: true, tip: "Costo por venta = gasto ÷ ventas." },
  { clave: "roas", texto: "ROAS", num: true, tip: "Cobrado ÷ gasto. Como «cobrado» es un piso, el retorno real es mayor." },
];

const FILTROS: { clave: string; texto: string; f: (c: FilaCampana) => boolean }[] = [
  { clave: "todas", texto: "Todas", f: () => true },
  { clave: "activas", texto: "Activas", f: (c) => c.estado === "activa" || c.estado === "publicada" },
  { clave: "pausadas", texto: "Pausadas", f: (c) => c.estado === "pausada" || c.estado === "terminada" },
  { clave: "borradores", texto: "Borradores", f: (c) => c.origen === "borrador" },
];

export default function TablaCampanas({
  filas,
  monedaNegocio,
  periodo,
  metaConectada,
}: {
  filas: FilaCampana[];
  monedaNegocio: string;
  periodo: string;
  metaConectada: boolean;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("todas");
  const [orden, setOrden] = useState<{ clave: Clave; desc: boolean }>({ clave: "cobrado", desc: true });

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const f = FILTROS.find((x) => x.clave === filtro)?.f ?? (() => true);
    const out = filas.filter((c) => f(c) && (!q || c.nombre.toLowerCase().includes(q)));
    out.sort((a, b) => {
      const va = a[orden.clave];
      const vb = b[orden.clave];
      if (typeof va === "string" || typeof vb === "string") {
        return (String(va).localeCompare(String(vb), "es")) * (orden.desc ? -1 : 1);
      }
      const na = va === null ? -Infinity : Number(va);
      const nb = vb === null ? -Infinity : Number(vb);
      return (na - nb) * (orden.desc ? -1 : 1);
    });
    return out;
  }, [filas, busqueda, filtro, orden]);

  const maxConv = Math.max(...filas.map((c) => c.conversaciones), 1);
  const cambiarOrden = (clave: Clave) =>
    setOrden((o) => (o.clave === clave ? { clave, desc: !o.desc } : { clave, desc: clave !== "nombre" }));

  const plata = (v: number | null, moneda = monedaNegocio) =>
    v === null ? <span style={{ color: "var(--muted-3)" }}>—</span> : formatearMonto({ valor: v, moneda }, { monedaDelNegocio: monedaNegocio });

  return (
    <div className="tarjeta mk-seccion">
      <div className="mk-seccion-cabecera flex-wrap">
        <div className="mk-segmentos" role="group" aria-label="Filtro">
          {FILTROS.map((f) => (
            <button key={f.clave} type="button" className="mk-segmento" aria-pressed={filtro === f.clave} onClick={() => setFiltro(f.clave)}>
              {f.texto}
              <span className="ml-1" style={{ color: "var(--muted-3)", fontWeight: 500 }}>
                {filas.filter(f.f).length}
              </span>
            </button>
          ))}
        </div>
        <label className="relative flex items-center">
          <span className="pointer-events-none absolute left-2.5" style={{ color: "var(--muted-3)" }}>
            {Ico.buscar()}
          </span>
          <input
            className="campo py-1.5 pl-8"
            style={{ width: 220, fontSize: "var(--t-menor)" }}
            placeholder="Buscar campaña"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </label>
      </div>

      {visibles.length === 0 ? (
        <div className="vacio">
          <div className="vacio-titulo">{filas.length ? "Ninguna campaña coincide" : "Todavía no hay campañas"}</div>
          <p className="vacio-texto">
            {filas.length ? "Prueba con otro filtro o texto." : "Cuando alguien entre a WhatsApp desde un anuncio, aparece acá. Mientras tanto puedes preparar la primera."}
          </p>
          {!filas.length && (
            <Link href="/marketing/campanas/nueva" className="btn-primario mt-4">Crear primera campaña</Link>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="tabla min-w-[980px]">
            <thead>
              <tr>
                {COLUMNAS.map((col) => (
                  <th key={col.clave} className={col.num ? "text-right" : ""}>
                    <button type="button" onClick={() => cambiarOrden(col.clave)} data-tip={col.tip} aria-sort={orden.clave === col.clave ? (orden.desc ? "descending" : "ascending") : undefined}>
                      {col.texto}
                      <span aria-hidden="true" style={{ opacity: orden.clave === col.clave ? 1 : 0.25, fontSize: 9 }}>
                        {orden.clave === col.clave && !orden.desc ? "▲" : "▼"}
                      </span>
                    </button>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((c) => {
                const href = c.origen === "borrador" ? `/marketing/campanas/nueva?id=${encodeURIComponent(c.id)}` : `/marketing/campanas/${encodeURIComponent(c.id)}?p=${periodo}`;
                const est = ESTADO_CAMPANA[c.estado];
                return (
                  <tr key={c.id}>
                    <td className="max-w-[300px]">
                      <Link href={href} className="block truncate font-semibold hover:underline" title={c.nombre}>
                        {c.nombre}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
                        <span className={est.clase}>{est.texto}</span>
                        {c.objetivo && <span>{textoObjetivo(c.objetivo)}</span>}
                        {c.origen === "atribucion" && <span title="Meta no está conectada: se ve el anuncio, no la campaña que lo contiene">solo atribución</span>}
                        {c.origen !== "borrador" && <span>· {c.anuncios} {c.anuncios === 1 ? "anuncio" : "anuncios"}</span>}
                      </div>
                    </td>
                    <td className="cifra text-right">{plata(c.gasto, c.moneda)}</td>
                    <td className="whitespace-nowrap text-right">
                      {c.origen === "borrador" ? (
                        <span style={{ color: "var(--muted-3)" }}>—</span>
                      ) : (
                        <>
                          <span className="cifra">{formatearNumero(c.conversaciones)}</span>
                          <span className="mk-barra ml-2" style={{ width: Math.max(2, (c.conversaciones / maxConv) * 40) }} />
                        </>
                      )}
                    </td>
                    <td className="cifra text-right">{c.origen === "borrador" ? <span style={{ color: "var(--muted-3)" }}>—</span> : formatearNumero(c.calificados)}</td>
                    <td className="cifra text-right">{c.origen === "borrador" ? <span style={{ color: "var(--muted-3)" }}>—</span> : formatearNumero(c.avanzados)}</td>
                    <td className="cifra text-right font-semibold">{c.origen === "borrador" ? <span style={{ color: "var(--muted-3)" }}>—</span> : formatearNumero(c.ventas)}</td>
                    <td className="cifra text-right font-semibold" style={{ color: c.cobrado > 0 ? "var(--indigo)" : "var(--muted-3)" }}>
                      {c.cobrado > 0 ? formatearMonto({ valor: c.cobrado, moneda: monedaNegocio }) : "—"}
                    </td>
                    <td className="cifra text-right">{plata(c.cpc, c.moneda)}</td>
                    <td className="cifra text-right">{plata(c.cpv, c.moneda)}</td>
                    <td className="cifra text-right">{c.roas === null ? <span style={{ color: "var(--muted-3)" }}>—</span> : `${c.roas.toFixed(1)}×`}</td>
                    <td className="text-right">
                      <Link href={href} className="btn-chico">
                        {c.origen === "borrador" ? "Editar" : "Abrir"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!metaConectada && filas.some((c) => c.origen === "atribucion") && (
        <div className="border-t px-4 py-3" style={{ borderColor: "var(--borde)", fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
          Sin la cuenta de Meta conectada cada anuncio aparece como su propia fila y no se ve el gasto.{" "}
          <Link href="/marketing/integraciones" className="font-semibold" style={{ color: "var(--indigo)" }}>
            Conectar Meta
          </Link>
        </div>
      )}
    </div>
  );
}
