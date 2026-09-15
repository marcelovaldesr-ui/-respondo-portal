"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import { textoObjetivo, type FilaCampana } from "@/lib/marketing/tipos";
import { ETIQUETA_RESULTADO, NOMBRE_PROVEEDOR, type Proveedor } from "@/lib/ads/canal";
import type { Senales } from "@/lib/ads/senales";
import { EstadoDeCampana, PieSinPublicidad } from "@/components/marketing/Estado";
import { Ico } from "@/components/marketing/Iconos";

/**
 * LA TABLA DE CAMPAÑAS — el centro operativo de «Analizar».
 *
 * Todo el filtrado ocurre en el navegador sobre las filas que ya vinieron del
 * servidor: son decenas, no miles, y un filtro que viaja a la base por cada
 * tecla se siente lento sin ganar nada.
 *
 * DECISIONES DE LECTURA:
 *   · La primera columna es una ficha, no un texto: nombre, estado y objetivo
 *     juntos, porque nadie lee «Activa» en una columna a 400 px del nombre.
 *   · Las columnas de plata muestran «—» cuando ninguna plataforma entregó
 *     cifras, nunca un 0 que parece un dato.
 *   · La tendencia es una chispa de siete días: ocupa 60 px y responde la
 *     pregunta que sigue a cualquier cifra —«¿y va subiendo?»—.
 *   · Los borradores conviven con las campañas reales porque para el dueño
 *     son «mis campañas»; sus celdas de resultado van en raya, no en cero.
 */
/** Filas por tramo. Ordenadas por ingresos, lo de arriba es lo que importa. */
const PAGINA = 50;

type Clave = "nombre" | "gasto" | "conversaciones" | "calificados" | "ventas" | "cobrado" | "cpl" | "roas" | "resultados" | "costoPorResultado";

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
  hayPublicidad,
  puedeConectarMeta,
  motivoSinPublicidad,
  series,
  senales,
  canales = [],
}: {
  filas: FilaCampana[];
  monedaNegocio: string;
  periodo: string;
  /**
   * ¿Hay ALGUNA plataforma publicitaria leyendo? Era `metaConectada`, y con
   * solo Google conectado valía false: la tabla daba por hecho que no había
   * publicidad y ofrecía conectar una cuenta que el negocio ya tenía.
   */
  hayPublicidad: boolean;
  /** Si la instalación siquiera permite conectar una cuenta publicitaria. */
  puedeConectarMeta: boolean;
  /** Por qué no hay cifras de publicidad, ya escrito para el dueño. */
  motivoSinPublicidad: string;
  /** Conversaciones por día de cada campaña, para la chispa. */
  series?: Record<string, number[]>;
  /**
   * ⭐ QUÉ COLUMNAS TIENEN SENTIDO (Fase 6).
   *
   * Sin conversaciones, «Conv. · Calif. · Ventas · Ingresos · CPL · ROAS» son
   * seis columnas de ceros: ocupan la tabla entera y no dicen nada cierto. En
   * su lugar van las que la plataforma sí mide —resultados y su costo—, con el
   * TIPO de resultado en el encabezado, porque «12 formularios» y «12
   * conversaciones» no son la misma cosa y no deben leerse igual.
   */
  senales: Senales;
  /** Canales conectados. Con más de uno aparece la columna y el filtro. */
  canales?: Proveedor[];
}) {
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("todas");
  const [canal, setCanal] = useState<Proveedor | "todos">("todos");
  const [orden, setOrden] = useState<{ clave: Clave; desc: boolean }>({ clave: "cobrado", desc: true });
  /** Una pyme tiene decenas, no cientos; pero si las tiene, no se pintan todas. */
  const [tope, setTope] = useState(PAGINA);

  const cpl = (c: FilaCampana) => (c.gasto !== null && c.calificados ? c.gasto / c.calificados : null);

  /**
   * El encabezado de resultados dice QUÉ se está contando. Con dos tipos
   * distintos en la misma tabla dice «Resultados» y cada fila se lee con su
   * propio tipo: sumarlos sería comparar formularios con compras.
   */
  const tipos = new Set(filas.map((c) => c.tipoResultado).filter(Boolean));
  const etiquetaResultados = tipos.size === 1 ? ETIQUETA_RESULTADO[[...tipos][0]!] : "Resultados";

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const f = FILTROS.find((x) => x.clave === filtro)?.f ?? (() => true);
    const out = filas.filter(
      (c) =>
        f(c) &&
        (!q || c.nombre.toLowerCase().includes(q)) &&
        (canal === "todos" || c.proveedor === canal),
    );
    const valor = (c: FilaCampana): number | string => {
      if (orden.clave === "nombre") return c.nombre;
      if (orden.clave === "cpl") return cpl(c) ?? -Infinity;
      const v = c[orden.clave as keyof FilaCampana];
      return v === null || v === undefined ? -Infinity : Number(v);
    };
    out.sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb), "es") * (orden.desc ? -1 : 1);
      }
      return (va - vb) * (orden.desc ? -1 : 1);
    });
    return out;
  }, [filas, busqueda, filtro, orden, canal]);

  const maxConv = Math.max(...filas.map((c) => c.conversaciones), 1);
  const cambiarOrden = (clave: Clave) =>
    setOrden((o) => (o.clave === clave ? { clave, desc: !o.desc } : { clave, desc: clave !== "nombre" }));

  const plata = (v: number | null, moneda = monedaNegocio) =>
    v === null ? <span className="nulo">—</span> : formatearMonto({ valor: v, moneda }, { monedaDelNegocio: monedaNegocio });

  const th = (clave: Clave, texto: string, num?: boolean, tip?: string) => (
    <Th key={clave} clave={clave} texto={texto} num={num} tip={tip} orden={orden} alOrdenar={cambiarOrden} />
  );

  return (
    <section className="mk-panel">
      <div className="mk-panel-cabecera flex-wrap">
        <div className="mk-segmentos" role="group" aria-label="Filtro">
          {FILTROS.map((f) => (
            <button key={f.clave} type="button" className="mk-segmento" aria-pressed={filtro === f.clave} onClick={() => { setTope(PAGINA); setFiltro(f.clave); }}>
              {f.texto}
              <span className="mk-conteo">{filas.filter(f.f).length}</span>
            </button>
          ))}
        </div>

        {/* ⭐ El filtro por canal aparece SOLO con más de uno conectado: con un
            único canal sería un control que no cambia nada. */}
        {canales.length > 1 && (
          <div className="mk-segmentos" role="group" aria-label="Canal">
            <button type="button" className="mk-segmento" aria-pressed={canal === "todos"} onClick={() => { setTope(PAGINA); setCanal("todos"); }}>
              Todos
            </button>
            {canales.map((cn) => (
              <button
                key={cn}
                type="button"
                className="mk-segmento"
                aria-pressed={canal === cn}
                onClick={() => {
                  setTope(PAGINA);
                  setCanal(cn);
                }}
              >
                {NOMBRE_PROVEEDOR[cn]}
                <span className="mk-conteo">{filas.filter((c) => c.proveedor === cn).length}</span>
              </button>
            ))}
          </div>
        )}

        <label className="relative flex items-center">
          <span className="pointer-events-none absolute left-3" style={{ color: "var(--muted-3)" }}>
            {Ico.buscar({ className: "h-4 w-4" })}
          </span>
          <input
            className="campo py-2 pl-9"
            style={{ width: 240, fontSize: "13px" }}
            placeholder="Buscar campaña"
            value={busqueda}
            onChange={(e) => { setTope(PAGINA); setBusqueda(e.target.value); }}
          />
        </label>
      </div>

      {visibles.length === 0 ? (
        <div className="vacio">
          <div className="vacio-titulo">{filas.length ? "Ninguna campaña coincide" : "Todavía no hay campañas"}</div>
          <p className="vacio-texto">
            {filas.length
              ? "Prueba con otro filtro o con otro texto."
              : senales.conversaciones
                ? "Cuando alguien entre a WhatsApp desde un anuncio, su campaña aparece acá con su costo y su resultado."
                : "Cuando tu cuenta publicitaria reporte campañas con actividad, aparecen acá con su costo y su resultado."}
          </p>
          {!filas.length && (
            <Link href="/marketing/campanas/nueva" className="btn-primario mk-btn-lg mt-5">
              Crear la primera campaña
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="mk-tabla min-w-[920px]">
            <thead>
              <tr>
                {th("nombre", "Campaña")}
                {th("gasto", "Gasto", true, "Lo que cobró tu cuenta publicitaria en el período.")}
                {senales.conversiones &&
                  th("resultados", etiquetaResultados, true, "Lo que la plataforma cuenta como resultado, con la medición configurada en la cuenta.")}
                {senales.conversiones &&
                  th("costoPorResultado", "Costo/result.", true, "Inversión ÷ resultados de la plataforma.")}
                {senales.conversaciones &&
                  th("conversaciones", "Conv.", true, "Personas que escribieron por WhatsApp desde esta campaña.")}
                {senales.conversaciones &&
                  th("calificados", "Calif.", true, "Avanzaron a interesado o más, o cotizaron, reservaron o compraron.")}
                {senales.conversaciones && th("ventas", "Ventas", true)}
                {senales.ingresos &&
                  th("cobrado", "Ingresos", true, "Solo lo pagado por enlace de pago. El total real puede ser mayor.")}
                {senales.conversaciones && th("cpl", "CPL", true, "Costo por lead calificado = invertido ÷ calificados.")}
                {senales.ingresos &&
                  th("roas", "ROAS", true, "Ingresos ÷ invertido. Como solo contamos lo pagado por enlace, el retorno real puede ser mayor.")}
                {senales.conversaciones && (
                  <th className="num solo-ancho" data-tip="Conversaciones por día en la última semana">
                    7 días
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visibles.slice(0, tope).map((c) => {
                const borrador = c.origen === "borrador";
                const href = borrador
                  ? `/marketing/campanas/nueva?id=${encodeURIComponent(c.id)}`
                  : `/marketing/campanas/${encodeURIComponent(c.id)}?p=${periodo}`;
                const raya = <span className="nulo">—</span>;
                return (
                  <tr key={c.id}>
                    <td className="max-w-[290px]">
                      <Link href={href} className="block truncate font-semibold hover:underline" style={{ fontSize: "13.5px" }} title={c.nombre}>
                        {c.nombre}
                      </Link>
                      {/* Una sola línea: si el objetivo es largo y «2 anuncios»
                          se va abajo, esa fila crece y la tabla deja de leerse
                          como una grilla. Lo que no cabe se corta. */}
                      <div
                        className="mt-1.5 flex items-center gap-2 overflow-hidden whitespace-nowrap"
                        style={{ fontSize: "11.5px", color: "var(--muted-2)" }}
                      >
                        {canales.length > 1 && c.proveedor && (
                          <span className="mk-pildora shrink-0">{NOMBRE_PROVEEDOR[c.proveedor]}</span>
                        )}
                        <EstadoDeCampana estado={c.estado} />
                        {c.objetivo && <span className="truncate">{textoObjetivo(c.objetivo)}</span>}
                        {!borrador && (
                          <span className="shrink-0">
                            · {c.anuncios} {c.anuncios === 1 ? "anuncio" : "anuncios"}
                          </span>
                        )}
                        {c.origen === "atribucion" && (
                          <span data-tip="Meta no está conectada: se ve el anuncio, no la campaña que lo contiene">solo atribución</span>
                        )}
                      </div>
                    </td>
                    <td className="num cifra">{borrador ? raya : plata(c.gasto, c.moneda)}</td>
                    {senales.conversiones && (
                      <td className="num cifra fuerte">
                        {borrador || c.resultados === null || c.resultados === undefined ? raya : formatearNumero(c.resultados)}
                      </td>
                    )}
                    {senales.conversiones && (
                      <td className="num cifra">{borrador ? raya : plata(c.costoPorResultado ?? null, c.moneda)}</td>
                    )}
                    {senales.conversaciones && (
                      <td className="num cifra">
                        {borrador ? (
                          raya
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <span className="mk-barra" style={{ width: Math.max(3, (c.conversaciones / maxConv) * 44) }} />
                            {formatearNumero(c.conversaciones)}
                          </span>
                        )}
                      </td>
                    )}
                    {senales.conversaciones && <td className="num cifra">{borrador ? raya : formatearNumero(c.calificados)}</td>}
                    {senales.conversaciones && <td className="num cifra fuerte">{borrador ? raya : formatearNumero(c.ventas)}</td>}
                    {senales.ingresos && (
                      <td className="num cifra plata">
                        {borrador || c.cobrado <= 0 ? raya : formatearMonto({ valor: c.cobrado, moneda: monedaNegocio })}
                      </td>
                    )}
                    {senales.conversaciones && <td className="num cifra">{borrador ? raya : plata(cpl(c), c.moneda)}</td>}
                    {senales.ingresos && (
                      <td className="num cifra fuerte">
                        {c.roas === null ? raya : `${c.roas.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`}
                      </td>
                    )}
                    {senales.conversaciones && (
                      <td className="num solo-ancho">{series?.[c.id]?.some((v) => v) ? <MiniSerie datos={series[c.id]} /> : raya}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibles.length > tope && (
            <div className="flex flex-col items-center gap-2 border-t py-5" style={{ borderColor: "var(--borde)" }}>
              <button type="button" className="btn-suave" onClick={() => setTope((t) => t + PAGINA)}>
                Ver más campañas
              </button>
              <span className="mk-meta">
                {tope} de {visibles.length}
              </span>
            </div>
          )}
        </div>
      )}

      {!hayPublicidad && filas.some((c) => c.origen === "atribucion") && (
        <PieSinPublicidad
          texto={`Sin cifras de tu cuenta publicitaria cada anuncio aparece como su propia fila y no se ve el gasto. ${motivoSinPublicidad}`}
          puedeConectar={puedeConectarMeta}
          hayPublicidad={hayPublicidad}
        />
      )}
    </section>
  );
}

/** Chispa de los últimos días, para leer la dirección sin abrir la campaña. */
function MiniSerie({ datos }: { datos: number[] }) {
  const max = Math.max(...datos, 1);
  const w = 60;
  const h = 20;
  const paso = w / Math.max(1, datos.length - 1);
  const d = datos.map((v, i) => `${i === 0 ? "M" : "L"}${(i * paso).toFixed(1)},${(h - (v / max) * (h - 3) - 1.5).toFixed(1)}`).join(" ");
  const sube = datos.length > 1 && datos[datos.length - 1] >= datos[0];
  return (
    <svg width={w} height={h} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d={d} fill="none" stroke={sube ? "var(--ok)" : "var(--peligro)"} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}


/**
 * La cabecera ordenable, DEFINIDA FUERA del componente.
 *
 * Estaba dentro del cuerpo: React la trataba como un tipo de componente nuevo
 * en cada render, así que toda la fila de encabezados se desmontaba y volvía a
 * montar con cada tecla del buscador. Acá arriba es una sola identidad.
 */
function Th({
  clave,
  texto,
  num,
  tip,
  orden,
  alOrdenar,
}: {
  clave: Clave;
  texto: string;
  num?: boolean;
  tip?: string;
  orden: { clave: Clave; desc: boolean };
  alOrdenar: (c: Clave) => void;
}) {
  const activa = orden.clave === clave;
  return (
    // `aria-sort` va en la celda de encabezado, no en el botón: es propiedad de
    // la columna. En el botón el lector de pantalla simplemente lo ignora.
    <th className={num ? "num" : ""} aria-sort={activa ? (orden.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => alOrdenar(clave)} data-tip={tip}>
        {texto}
        <span aria-hidden="true" style={{ opacity: activa ? 1 : 0.22, fontSize: 8 }}>
          {activa && !orden.desc ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}
