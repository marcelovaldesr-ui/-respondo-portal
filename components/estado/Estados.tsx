import type { ReactNode } from "react";
import { metaEtapa } from "@/lib/etapasCore";
import type { EstadoPago } from "@/lib/estadoComercialCore";
import { TONOS, textoPago, type Tono } from "@/lib/estadoComercialVista";

/**
 * PRIMITIVAS DE ESTADO (Fase 1).
 *
 * Existían como `<span className="pildora" style={...}>` repetido en Inicio,
 * la ficha, Clientes y el embudo, cada uno con su mapa de colores. Acá quedan
 * una vez. Sin hooks ni "use client": sirven igual en servidor y en cliente.
 */

export function Estado({
  tono = "neutro",
  children,
  punto = false,
  title,
}: {
  tono?: Tono;
  children: ReactNode;
  punto?: boolean;
  title?: string;
}) {
  const t = TONOS[tono];
  return (
    <span className="estado" style={{ background: t.fondo, color: t.texto }} title={title}>
      {punto && <span className="estado-punto" aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Etapa del embudo, con el motivo cuando agrega información («Perdido · Sin respuesta»). */
export function EtapaEstado({ etapa, motivo }: { etapa: string; motivo?: string | null }) {
  const e = metaEtapa(etapa);
  return (
    <span className="estado" style={{ background: e.fondo, color: e.color }} title={e.descripcion}>
      <span className="truncate">
        {e.label}
        {motivo ? <span style={{ fontWeight: 500 }}> · {motivo}</span> : null}
      </span>
    </span>
  );
}

export function PagoEstado({ pago, conDetalle = false }: { pago: EstadoPago; conDetalle?: boolean }) {
  const t = textoPago(pago);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Estado tono={t.tono} punto={pago.tipo !== "sin_cobro"}>
        {t.label}
      </Estado>
      {conDetalle && t.detalle && (
        <span className="cifra" style={{ fontSize: "var(--t-meta)", color: "var(--muted)" }}>
          {t.detalle}
        </span>
      )}
    </span>
  );
}

export function AvatarEmpleado({
  src,
  color,
  nombre,
  tamano = 32,
}: {
  src: string;
  color: string;
  nombre: string;
  tamano?: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={nombre}
      width={tamano}
      height={tamano}
      className="avatar"
      style={{ width: tamano, height: tamano, ["--anillo" as string]: color }}
    />
  );
}

/** Estado vacío corto: título y una línea. Sin ilustración. */
export function Vacio({ titulo, texto, children }: { titulo: string; texto?: string; children?: ReactNode }) {
  return (
    <div className="vacio py-8">
      <div className="vacio-titulo">{titulo}</div>
      {texto && <div className="vacio-texto">{texto}</div>}
      {children}
    </div>
  );
}
