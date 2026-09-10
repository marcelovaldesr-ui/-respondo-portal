"use client";

import { useMemo, useState } from "react";
import type { PuntoDiario } from "@/lib/marketing/tipos";

/**
 * EL GRÁFICO PRINCIPAL — una sola tendencia, con la serie que la persona elija.
 *
 * Un gráfico grande con un selector vale más que seis chicos: la pregunta que
 * se hace el dueño es «¿esto va subiendo o bajando?» y para eso hace falta
 * espacio horizontal, no seis miniaturas. Se pueden comparar dos series
 * (una en área, otra en línea) para ver, por ejemplo, si el gasto subió y las
 * conversaciones no.
 *
 * SVG a mano, sin librería: son 120 líneas y no agregan 90 KB al portal.
 * Dibuja en un viewBox fijo y escala con CSS, así se ve igual en cualquier
 * ancho. El tooltip sigue el mouse por índice de día, no por píxel.
 */

type Serie = {
  clave: keyof PuntoDiario;
  etiqueta: string;
  plata?: boolean;
  disponible: boolean;
};

const ANCHO = 900;
const ALTO = 240;
const PAD = { arriba: 14, abajo: 26, izq: 8, der: 8 };

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const num = (n: number) => Math.round(n).toLocaleString("es-CL");

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/** «27 ago» a partir de AAAA-MM-DD, sin Intl: el mismo texto en servidor y cliente. */
function diaCorto(dia: string): string {
  const [, m, d] = dia.split("-").map(Number);
  return `${d} ${MESES[(m ?? 1) - 1] ?? ""}`;
}

export default function GraficoTendencia({
  serie,
  metaConectada,
}: {
  serie: PuntoDiario[];
  metaConectada: boolean;
}) {
  const SERIES: Serie[] = useMemo(
    () => [
      { clave: "gasto", etiqueta: "Gasto", plata: true, disponible: metaConectada },
      { clave: "conversaciones", etiqueta: "Conversaciones", disponible: true },
      { clave: "calificados", etiqueta: "Calificados", disponible: true },
      { clave: "ventas", etiqueta: "Ventas", disponible: true },
      { clave: "cobrado", etiqueta: "Cobrado", plata: true, disponible: true },
    ],
    [metaConectada],
  );

  const [principal, setPrincipal] = useState<keyof PuntoDiario>(metaConectada ? "gasto" : "conversaciones");
  const [secundaria, setSecundaria] = useState<keyof PuntoDiario | null>("conversaciones");
  const [hover, setHover] = useState<number | null>(null);

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

  // Guías horizontales: 3 líneas con el valor de la serie principal.
  const guias = [0.25, 0.5, 0.75, 1].map((f) => ({ y: A.yDe(A.max * f), v: A.max * f }));

  // Etiquetas del eje x: 6 como máximo, para que no se pisen.
  const paso = Math.max(1, Math.ceil(n / 6));

  const elegir = (k: keyof PuntoDiario) => {
    if (k === principal) return;
    if (k === secundaria) {
      setSecundaria(principal);
      setPrincipal(k);
      return;
    }
    setPrincipal(k);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="mk-segmentos" role="group" aria-label="Serie principal">
          {SERIES.map((s) => (
            <button
              key={s.clave}
              type="button"
              className="mk-segmento"
              aria-pressed={s.clave === principal}
              disabled={!s.disponible}
              title={!s.disponible ? "Se ve cuando conectes Meta" : undefined}
              style={{ opacity: s.disponible ? 1 : 0.4 }}
              onClick={() => elegir(s.clave)}
            >
              {s.etiqueta}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
          Comparar con
          <select
            className="campo py-1"
            style={{ width: "auto", fontSize: "var(--t-micro)", padding: "3px 8px" }}
            value={secundaria ?? ""}
            onChange={(e) => setSecundaria((e.target.value || null) as keyof PuntoDiario | null)}
          >
            <option value="">nada</option>
            {SERIES.filter((s) => s.disponible && s.clave !== principal).map((s) => (
              <option key={s.clave} value={s.clave}>
                {s.etiqueta}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="relative mt-2">
        {vacio && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
            <div className="text-center">
              <div className="font-semibold" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>Sin movimiento en este período</div>
              <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>La curva aparece con la primera conversación que llegue desde un anuncio.</div>
            </div>
          </div>
        )}
        <svg
          viewBox={`0 0 ${ANCHO} ${ALTO}`}
          className="block w-full"
          style={{ height: 240 }}
          role="img"
          aria-label={`${serieDe(principal)?.etiqueta} por día`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * ANCHO;
            const i = Math.round(((x - PAD.izq) / (ANCHO - PAD.izq - PAD.der)) * (n - 1));
            setHover(Math.max(0, Math.min(n - 1, i)));
          }}
        >
          <defs>
            <linearGradient id="mk-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {guias.map((g, i) => (
            <g key={i}>
              <line x1={PAD.izq} x2={ANCHO - PAD.der} y1={g.y} y2={g.y} stroke="#e8eaf0" strokeDasharray="2 4" />
              <text x={ANCHO - PAD.der} y={g.y - 4} textAnchor="end" fontSize="10" fill="#a3abbc" fontFamily="Geist Mono, monospace">
                {fmt(principal, g.v)}
              </text>
            </g>
          ))}
          <path d={A.area} fill="url(#mk-area)" />
          <path d={A.d} fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {B && <path d={B.d} fill="none" stroke="#f97362" strokeWidth="1.75" strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />}
          {serie.map((p, i) =>
            i % paso === 0 || i === n - 1 ? (
              <text key={p.dia} x={xDe(i)} y={ALTO - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="10" fill="#8792a8">
                {diaCorto(p.dia)}
              </text>
            ) : null,
          )}
          {hover !== null && (
            <g>
              <line x1={xDe(hover)} x2={xDe(hover)} y1={PAD.arriba} y2={ALTO - PAD.abajo} stroke="#c7cbe8" />
              <circle cx={xDe(hover)} cy={A.yDe(A.vals[hover])} r="4" fill="#fff" stroke="#4f46e5" strokeWidth="2" />
              {B && <circle cx={xDe(hover)} cy={B.yDe(B.vals[hover])} r="3.5" fill="#fff" stroke="#f97362" strokeWidth="2" />}
            </g>
          )}
        </svg>

        {hover !== null && (
          <div
            className="tarjeta pointer-events-none absolute top-2 px-3 py-2"
            style={{
              left: `${(xDe(hover) / ANCHO) * 100}%`,
              transform: xDe(hover) > ANCHO * 0.7 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
              boxShadow: "var(--sombra-alta)",
              fontSize: "var(--t-micro)",
              minWidth: 150,
            }}
          >
            <div className="font-semibold" style={{ color: "var(--tinta)" }}>
              {diaCorto(serie[hover].dia)}
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#4f46e5" }} />
                {serieDe(principal)?.etiqueta}
              </span>
              <span className="cifra font-semibold">{fmt(principal, A.vals[hover])}</span>
            </div>
            {B && secundaria && (
              <div className="mt-0.5 flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#f97362" }} />
                  {serieDe(secundaria)?.etiqueta}
                </span>
                <span className="cifra font-semibold">{fmt(secundaria, B.vals[hover])}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
