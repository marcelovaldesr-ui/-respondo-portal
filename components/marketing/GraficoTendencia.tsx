"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PuntoDiario } from "@/lib/marketing/tipos";

/**
 * EL GRÁFICO PRINCIPAL — protagonista de la pantalla, no adorno.
 *
 * Un gráfico grande con selector vale más que seis chicos: la pregunta del
 * dueño es «¿esto sube o baja?» y para eso hace falta ancho, no miniaturas.
 * Se pueden superponer dos series (área + línea punteada) para ver, por
 * ejemplo, si el gasto subió y las conversaciones no.
 *
 * SVG a mano, sin librería: son 200 líneas y no agregan 90 KB al portal.
 * Dibuja en un viewBox fijo y escala con CSS. El hover es por índice de día,
 * con línea guía, puntos y una ficha que sigue al cursor.
 */
type Serie = {
  clave: keyof PuntoDiario;
  etiqueta: string;
  plata?: boolean;
  disponible: boolean;
};

const PAD = { arriba: 18, abajo: 30, izq: 10, der: 58 };

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/** «27 ago» desde AAAA-MM-DD, sin Intl: el mismo texto en servidor y cliente. */
function diaCorto(dia: string): string {
  const [, m, d] = dia.split("-").map(Number);
  return `${d} ${MESES[(m ?? 1) - 1] ?? ""}`;
}
const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const num = (n: number) => Math.round(n).toLocaleString("es-CL");
/** 19.901 → «$20k»: el eje no necesita los pesos exactos. */
const corto = (n: number, plata?: boolean) => {
  if (!plata) return num(n);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
};

export default function GraficoTendencia({
  serie,
  metaConectada,
  hayConversaciones = true,
  hayIngresos = true,
  principalInicial,
  alto = 300,
}: {
  serie: PuntoDiario[];
  metaConectada: boolean;
  /** Señales del negocio: deciden qué series tiene sentido ofrecer (Fase 6). */
  hayConversaciones?: boolean;
  hayIngresos?: boolean;
  principalInicial?: keyof PuntoDiario;
  alto?: number;
}) {
  const SERIES: Serie[] = useMemo(
    () => [
      /**
       * ⭐ FASE 6: una serie que este negocio no puede llenar NO se ofrece.
       *
       * Sin conversaciones en Respondo, las pestañas «Conversaciones ·
       * Calificados · Ventas · Ingresos» dibujaban cuatro líneas planas en
       * cero — que no es «no pasó nada», es «no medimos eso acá». `clics`
       * ocupa su lugar: es lo que sí se mide con solo publicidad.
       */
      { clave: "gasto", etiqueta: "Invertido", plata: true, disponible: metaConectada },
      { clave: "clics", etiqueta: "Clics", disponible: metaConectada && !hayConversaciones },
      { clave: "conversaciones", etiqueta: "Conversaciones", disponible: hayConversaciones },
      { clave: "calificados", etiqueta: "Calificados", disponible: hayConversaciones },
      { clave: "ventas", etiqueta: "Ventas", disponible: hayConversaciones },
      { clave: "cobrado", etiqueta: "Ingresos", plata: true, disponible: hayIngresos },
    ],
    [metaConectada, hayConversaciones, hayIngresos],
  );

  const [principal, setPrincipal] = useState<keyof PuntoDiario>(
    principalInicial ?? (metaConectada ? "gasto" : hayConversaciones ? "conversaciones" : "clics"),
  );
  /**
   * ⚠️ La comparación tiene que arrancar en una serie DISPONIBLE. Arrancaba
   * fija en «conversaciones» y, en un negocio que no las tiene, el selector
   * mostraba «sin comparar» mientras el gráfico seguía dibujando una línea
   * punteada de ceros con su leyenda. Un control diciendo una cosa y el dibujo
   * mostrando otra.
   */
  const [secundaria, setSecundaria] = useState<keyof PuntoDiario | null>(
    hayConversaciones ? (metaConectada ? "conversaciones" : "ventas") : null,
  );
  const [hover, setHover] = useState<number | null>(null);

  /**
   * ⚠️ EL VIEWBOX SE MIDE, NO SE INVENTA.
   *
   * Con un viewBox fijo de 1000 y `preserveAspectRatio` por defecto, el SVG se
   * centra y deja franjas vacías cuando el panel es más ancho que alto: a
   * 1920 px el gráfico quedaba con 240 px de blanco a cada lado. Se mide el
   * contenedor y se dibuja 1 unidad = 1 píxel, así el trazo y los textos
   * conservan su grosor real a cualquier ancho.
   */
  const caja = useRef<HTMLDivElement>(null);
  const [ANCHO, setAncho] = useState(1000);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setAncho(Math.max(360, Math.round(el.getBoundingClientRect().width)));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ALTO = alto;

  const n = serie.length;
  const xDe = (i: number) => PAD.izq + (n <= 1 ? 0 : (i / (n - 1)) * (ANCHO - PAD.izq - PAD.der));

  const camino = (clave: keyof PuntoDiario) => {
    const vals = serie.map((p) => Number(p[clave] ?? 0));
    const max = Math.max(...vals, 1);
    const yDe = (v: number) => PAD.arriba + (1 - v / max) * (ALTO - PAD.arriba - PAD.abajo);
    const d = vals.map((v, i) => `${i === 0 ? "M" : "L"}${xDe(i).toFixed(1)},${yDe(v).toFixed(1)}`).join(" ");
    const area = `${d} L${xDe(n - 1).toFixed(1)},${ALTO - PAD.abajo} L${xDe(0).toFixed(1)},${ALTO - PAD.abajo} Z`;
    return { d, area, vals, max, yDe };
  };

  const A = camino(principal);
  const B = secundaria ? camino(secundaria) : null;
  const vacio = A.vals.every((v) => !v) && (!B || B.vals.every((v) => !v));

  const serieDe = (k: keyof PuntoDiario) => SERIES.find((s) => s.clave === k);
  const fmt = (k: keyof PuntoDiario, v: number) => (serieDe(k)?.plata ? pesos(v) : num(v));

  const guias = [0, 0.5, 1].map((f) => ({ y: A.yDe(A.max * f), v: A.max * f }));

  /**
   * Índices con etiqueta en el eje x. Se arma la lista y DESPUÉS se quita la
   * penúltima si queda pegada a la última: con 30 días, el paso de 4 dejaba
   * «29 ago» y «30 ago» encimados, que es peor que no poner ninguna.
   */
  const paso = Math.max(1, Math.ceil(n / 8));
  const marcas = (() => {
    const xs: number[] = [];
    for (let i = 0; i < n; i += paso) xs.push(i);
    if (xs[xs.length - 1] !== n - 1) {
      if (n - 1 - xs[xs.length - 1] < paso * 0.6) xs.pop();
      xs.push(n - 1);
    }
    return new Set(xs);
  })();

  const elegir = (k: keyof PuntoDiario) => {
    if (k === principal) return;
    if (k === secundaria) setSecundaria(principal);
    setPrincipal(k);
  };

  const hoverX = hover === null ? 0 : xDe(hover);
  const fichaIzq = hoverX > ANCHO * 0.62;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="mk-segmentos" role="group" aria-label="Serie principal">
          {/* Solo las series que este negocio puede llenar. Una pestaña
              apagada permanentemente es una promesa que el producto no va a
              cumplir mientras no cambie la configuración, y ocupa el mismo
              lugar que las que sí sirven. */}
          {SERIES.filter((s) => s.disponible).map((s) => (
            <button
              key={s.clave}
              type="button"
              className="mk-segmento"
              aria-pressed={s.clave === principal}
              onClick={() => elegir(s.clave)}
            >
              {s.etiqueta}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <Leyenda color="var(--indigo)" texto={serieDe(principal)?.etiqueta ?? ""} />
          {secundaria && <Leyenda color="var(--coral)" texto={serieDe(secundaria)?.etiqueta ?? ""} punteada />}
          <label className="flex items-center gap-2" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
            Comparar
            <select
              className="campo"
              style={{ width: "auto", fontSize: "12px", padding: "4px 8px" }}
              value={secundaria ?? ""}
              onChange={(e) => setSecundaria((e.target.value || null) as keyof PuntoDiario | null)}
            >
              <option value="">sin comparar</option>
              {SERIES.filter((s) => s.disponible && s.clave !== principal).map((s) => (
                <option key={s.clave} value={s.clave}>
                  {s.etiqueta}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="relative mt-4" ref={caja}>
        {vacio && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
            <div className="text-center">
              <div className="font-semibold" style={{ fontSize: "13.5px", color: "var(--muted)" }}>
                Sin movimiento en este período
              </div>
              <div style={{ fontSize: "12px", color: "var(--muted-2)" }}>
                La curva aparece con la primera conversación que llegue desde un anuncio.
              </div>
            </div>
          </div>
        )}
        <svg
          viewBox={`0 0 ${ANCHO} ${ALTO}`}
          className="block w-full"
          style={{ height: ALTO }}
          role="img"
          aria-label={`Tendencia de ${serieDe(principal)?.etiqueta} por día`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const caja = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - caja.left) / caja.width) * ANCHO;
            const i = Math.round(((x - PAD.izq) / (ANCHO - PAD.izq - PAD.der)) * (n - 1));
            setHover(Math.max(0, Math.min(n - 1, i)));
          }}
        >
          <defs>
            <linearGradient id="mk-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--indigo)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--indigo)" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {guias.map((g, i) => (
            <g key={i}>
              <line
                x1={PAD.izq}
                x2={ANCHO - PAD.der}
                y1={g.y}
                y2={g.y}
                stroke="var(--borde)"
                strokeWidth="1"
                strokeDasharray={i === guias.length - 1 ? undefined : "3 5"}
              />
              <text
                x={ANCHO - PAD.der + 8}
                y={g.y + 3.5}
                fontSize="11"
                fill="var(--muted-3)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {corto(g.v, serieDe(principal)?.plata)}
              </text>
            </g>
          ))}

          {!vacio && (
            <>
              <path d={A.area} fill="url(#mk-area)" />
              <path d={A.d} fill="none" stroke="var(--indigo)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
              {B && (
                <path
                  d={B.d}
                  fill="none"
                  stroke="var(--coral)"
                  strokeWidth="2"
                  strokeDasharray="5 4"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
            </>
          )}

          {serie.map((p, i) =>
            marcas.has(i) ? (
              <text key={p.dia} x={xDe(i)} y={ALTO - 8} fontSize="11" fill="var(--muted-3)" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
                {diaCorto(p.dia)}
              </text>
            ) : null,
          )}

          {hover !== null && !vacio && (
            <g>
              <line x1={hoverX} x2={hoverX} y1={PAD.arriba - 6} y2={ALTO - PAD.abajo} stroke="var(--borde-fuerte)" strokeWidth="1" />
              <circle cx={hoverX} cy={A.yDe(A.vals[hover])} r="4.5" fill="#fff" stroke="var(--indigo)" strokeWidth="2.4" />
              {B && <circle cx={hoverX} cy={B.yDe(B.vals[hover])} r="4" fill="#fff" stroke="var(--coral)" strokeWidth="2" />}
            </g>
          )}
        </svg>

        {hover !== null && !vacio && (
          <div
            className="pointer-events-none absolute top-1 rounded-lg border px-3 py-2"
            style={{
              left: fichaIzq ? undefined : `calc(${(hoverX / ANCHO) * 100}% + 14px)`,
              right: fichaIzq ? `calc(${100 - (hoverX / ANCHO) * 100}% + 14px)` : undefined,
              background: "var(--superficie)",
              borderColor: "var(--borde)",
              boxShadow: "var(--sombra-alta)",
              minWidth: 150,
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted-2)" }}>
              {diaCorto(serie[hover].dia)}
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-5">
              <span className="flex items-center gap-1.5" style={{ fontSize: "12px", color: "var(--muted)" }}>
                <i className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--indigo)" }} />
                {serieDe(principal)?.etiqueta}
              </span>
              <span className="cifra font-semibold" style={{ fontSize: "13.5px" }}>
                {fmt(principal, A.vals[hover])}
              </span>
            </div>
            {B && secundaria && (
              <div className="mt-1 flex items-center justify-between gap-5">
                <span className="flex items-center gap-1.5" style={{ fontSize: "12px", color: "var(--muted)" }}>
                  <i className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--coral)" }} />
                  {serieDe(secundaria)?.etiqueta}
                </span>
                <span className="cifra font-semibold" style={{ fontSize: "13.5px" }}>
                  {fmt(secundaria, B.vals[hover])}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Leyenda({ color, texto, punteada }: { color: string; texto: string; punteada?: boolean }) {
  return (
    <span className="hidden items-center gap-2 sm:inline-flex" style={{ fontSize: "12px", color: "var(--muted)" }}>
      <svg width="16" height="4" aria-hidden="true">
        <line x1="0" y1="2" x2="16" y2="2" stroke={color} strokeWidth="2.5" strokeDasharray={punteada ? "4 3" : undefined} strokeLinecap="round" />
      </svg>
      {texto}
    </span>
  );
}
