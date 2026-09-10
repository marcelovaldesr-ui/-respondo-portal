"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import { ETAPAS_LEAD, type Lead } from "@/lib/marketing/tipos";
import { Ico } from "@/components/marketing/Iconos";

/**
 * LAS PERSONAS QUE TRAJO LA PAUTA — con nombre, anuncio y qué pasó después.
 *
 * Los filtros son las mismas etapas del embudo, para que apretar «Calificados»
 * en el embudo y apretar «Calificados» acá muestre exactamente la misma gente.
 * Cada fila abre la ficha del cliente (y desde ahí la conversación), porque la
 * pregunta que sigue a «¿quién llegó?» es siempre «¿qué le dijimos?».
 *
 * En demo las fichas no existen: el enlace se reemplaza por una nota.
 */

export const FILTROS_LEADS: { clave: string; texto: string; f: (l: Lead) => boolean }[] = [
  { clave: "todos", texto: "Todos", f: () => true },
  { clave: "nuevos", texto: "Sin avanzar", f: (l) => !l.calificado && l.etapa !== "perdido" },
  { clave: "calificados", texto: "Calificados", f: (l) => l.calificado },
  { clave: "cotizados", texto: "Cotizaron", f: (l) => l.cotizo },
  { clave: "reservaron", texto: "Reservaron", f: (l) => l.agendo },
  { clave: "compraron", texto: "Compraron", f: (l) => l.compro },
  { clave: "perdidos", texto: "Perdidos", f: (l) => l.etapa === "perdido" },
];

type Clave = "nombre" | "campanaNombre" | "llegoEn" | "etapa" | "cobrado";

/** Filas por tanda. Doscientas personas en una tabla no se leen; cincuenta sí. */
const PAGINA = 50;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/**
 * «10 sept · 15:30» en hora de Chile, armado a mano. Se usan partes numéricas
 * en-US (idénticas en Node y en el navegador) y no el formato es-CL, que
 * cambia entre versiones de ICU y rompía la hidratación con un texto distinto
 * en el servidor y en el cliente.
 */
function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const v = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  const hora = v("hour") === "24" ? "00" : v("hour");
  return `${v("day")} ${MESES[Number(v("month")) - 1] ?? ""} · ${hora}:${v("minute")}`;
}

export default function TablaLeads({
  leads,
  monedaNegocio,
  filtroInicial = "todos",
  demo = false,
  ocultarCampana = false,
  campanas,
}: {
  leads: Lead[];
  monedaNegocio: string;
  filtroInicial?: string;
  demo?: boolean;
  ocultarCampana?: boolean;
  /** Para el selector de campaña, cuando se muestran todas. */
  campanas?: { id: string; nombre: string }[];
}) {
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState(FILTROS_LEADS.some((f) => f.clave === filtroInicial) ? filtroInicial : "todos");
  const [campana, setCampana] = useState("");
  const [orden, setOrden] = useState<{ clave: Clave; desc: boolean }>({ clave: "llegoEn", desc: true });
  const [limite, setLimite] = useState(PAGINA);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const f = FILTROS_LEADS.find((x) => x.clave === filtro)?.f ?? (() => true);
    const out = leads.filter(
      (l) =>
        f(l) &&
        (!campana || l.campanaId === campana) &&
        (!q || l.nombre.toLowerCase().includes(q) || l.telefono.includes(q) || l.anuncioTitular.toLowerCase().includes(q) || l.ultimoMensaje.toLowerCase().includes(q)),
    );
    const peso: Record<Lead["etapa"], number> = { nuevo: 0, interesado: 1, cotizado: 2, ganado: 3, perdido: -1 };
    out.sort((a, b) => {
      let r = 0;
      if (orden.clave === "etapa") r = peso[a.etapa] - peso[b.etapa];
      else if (orden.clave === "cobrado") r = a.cobrado - b.cobrado;
      else if (orden.clave === "llegoEn") r = a.llegoEn.localeCompare(b.llegoEn);
      else r = String(a[orden.clave]).localeCompare(String(b[orden.clave]), "es");
      return r * (orden.desc ? -1 : 1);
    });
    return out;
  }, [leads, busqueda, filtro, campana, orden]);

  const cambiarOrden = (clave: Clave) =>
    setOrden((o) => (o.clave === clave ? { clave, desc: !o.desc } : { clave, desc: clave !== "nombre" && clave !== "campanaNombre" }));

  const Th = ({ clave, texto, num }: { clave: Clave; texto: string; num?: boolean }) => (
    <th className={num ? "text-right" : ""}>
      <button type="button" onClick={() => cambiarOrden(clave)} aria-sort={orden.clave === clave ? (orden.desc ? "descending" : "ascending") : undefined}>
        {texto}
        <span aria-hidden="true" style={{ opacity: orden.clave === clave ? 1 : 0.25, fontSize: 9 }}>
          {orden.clave === clave && !orden.desc ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );

  return (
    <div className="tarjeta mk-seccion">
      <div className="mk-seccion-cabecera flex-wrap">
        <div className="mk-segmentos" role="group" aria-label="Etapa">
          {FILTROS_LEADS.map((f) => (
            <button key={f.clave} type="button" className="mk-segmento" aria-pressed={filtro === f.clave} onClick={() => setFiltro(f.clave)}>
              {f.texto}
              <span className="ml-1" style={{ color: "var(--muted-3)", fontWeight: 500 }}>
                {leads.filter(f.f).length}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {campanas && campanas.length > 1 && (
            <select className="campo py-1.5" style={{ fontSize: "var(--t-menor)", width: "auto", maxWidth: 240 }} value={campana} onChange={(e) => setCampana(e.target.value)} aria-label="Campaña">
              <option value="">Todas las campañas</option>
              {campanas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          )}
          <label className="relative flex items-center">
            <span className="pointer-events-none absolute left-2.5" style={{ color: "var(--muted-3)" }}>
              {Ico.buscar()}
            </span>
            <input
              className="campo py-1.5 pl-8"
              style={{ width: 220, fontSize: "var(--t-menor)" }}
              placeholder="Nombre, teléfono o anuncio"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </label>
        </div>
      </div>

      {visibles.length === 0 ? (
        <div className="vacio">
          <div className="vacio-titulo">{leads.length ? "Nadie coincide con ese filtro" : "Todavía no llega nadie desde un anuncio"}</div>
          <p className="vacio-texto">
            {leads.length
              ? "Prueba con otra etapa u otro texto."
              : "Cuando alguien entre a WhatsApp desde un anuncio de Facebook o Instagram, aparece acá con su nombre y en qué quedó."}
          </p>
          {!leads.length && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/marketing/campanas/nueva" className="btn-primario">Crear una campaña</Link>
              <Link href="/marketing/integraciones" className="btn-suave">Ver integraciones</Link>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="tabla min-w-[860px]">
            <thead>
              <tr>
                <Th clave="nombre" texto="Persona" />
                {!ocultarCampana && <Th clave="campanaNombre" texto="Campaña · anuncio" />}
                <Th clave="llegoEn" texto="Llegó" />
                <Th clave="etapa" texto="En qué quedó" />
                <th>Avances</th>
                <Th clave="cobrado" texto="Cobrado" num />
                <th />
              </tr>
            </thead>
            <tbody>
              {visibles.slice(0, limite).map((l) => (
                <tr key={l.chatId}>
                  <td className="max-w-[240px]">
                    <div className="truncate font-semibold">{l.nombre || l.telefono || "Sin nombre"}</div>
                    <div className="truncate" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }} title={l.ultimoMensaje}>
                      {l.ultimoMensaje || l.telefono}
                    </div>
                  </td>
                  {!ocultarCampana && (
                    <td className="max-w-[260px]">
                      {l.campanaId ? (
                        <Link href={`/marketing/campanas/${encodeURIComponent(l.campanaId)}`} className="block truncate font-medium hover:underline">
                          {l.campanaNombre}
                        </Link>
                      ) : (
                        <div className="truncate">{l.campanaNombre}</div>
                      )}
                      <div className="truncate" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
                        {l.anuncioTitular}
                      </div>
                    </td>
                  )}
                  <td className="cifra whitespace-nowrap" style={{ color: "var(--muted)" }}>
                    {fechaCorta(l.llegoEn)}
                  </td>
                  <td>
                    <span className={ETAPAS_LEAD[l.etapa].clase}>{ETAPAS_LEAD[l.etapa].texto}</span>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
                      {l.calificado && <span className="pildora-neutra">Calificado</span>}
                      {l.cotizo && <span className="pildora-neutra">Cotizó</span>}
                      {l.agendo && <span className="pildora-neutra">Reservó</span>}
                      {l.compro && <span className="pildora-ok">Compró</span>}
                      {!l.calificado && !l.cotizo && !l.agendo && !l.compro && <span>—</span>}
                    </div>
                  </td>
                  <td className="cifra text-right font-semibold" style={{ color: l.cobrado > 0 ? "var(--indigo)" : "var(--muted-3)" }}>
                    {l.cobrado > 0 ? formatearMonto({ valor: l.cobrado, moneda: monedaNegocio }) : "—"}
                  </td>
                  <td className="text-right">
                    {demo ? (
                      <span className="btn-chico" aria-disabled="true" title="En la demostración no hay conversaciones reales" style={{ opacity: 0.55 }}>
                        Conversación
                      </span>
                    ) : (
                      <Link href={`/clientes/${encodeURIComponent(l.chatId)}`} className="btn-chico">
                        Conversación
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t px-4 py-2.5 flex flex-wrap items-center justify-between gap-2" style={{ borderColor: "var(--borde)", fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
        <span className="flex items-center gap-2">
          {formatearNumero(Math.min(limite, visibles.length))} de {formatearNumero(visibles.length)} personas
          {visibles.length > limite && (
            <button type="button" className="btn-chico" onClick={() => setLimite((n) => n + PAGINA)}>
              Mostrar {Math.min(PAGINA, visibles.length - limite)} más
            </button>
          )}
        </span>
        <span>«Calificado» = avanzó a interesado o más, o cotizó, reservó o compró.</span>
      </div>
    </div>
  );
}
