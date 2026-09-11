"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import type { Lead } from "@/lib/marketing/tipos";
import { FILTROS_LEADS } from "@/lib/marketing/leadsCore";
import { EstadoDeLead } from "@/components/marketing/Estado";
import { Ico } from "@/components/marketing/Iconos";

/**
 * LAS PERSONAS QUE TRAJO LA PAUTA.
 *
 * No es una tabla administrativa: es la prueba de la atribución con nombre y
 * apellido. Por eso la primera columna trae inicial, nombre y la última línea
 * que escribió esa persona —así se reconoce a alguien— y la segunda dice de
 * qué campaña y de qué anuncio vino.
 *
 * Los filtros son las mismas etapas del embudo, para que apretar
 * «Calificados» arriba y apretar «Calificados» acá muestren exactamente la
 * misma gente. «Avance» resume en tres pasos lo que la conversación logró.
 *
 * En demostración no hay conversaciones reales: el enlace se apaga y lo dice.
 */
export { FILTROS_LEADS } from "@/lib/marketing/leadsCore";

type Clave = "nombre" | "campanaNombre" | "llegoEn" | "etapa" | "cobrado";

const PAGINA = 40;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/**
 * «10 sept · 15:30» en hora de Chile, armado a mano. Se usan partes numéricas
 * en-US (idénticas en Node y en el navegador) y no el formato es-CL, que
 * cambia entre versiones de ICU y rompía la hidratación.
 */
function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
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
        (!q ||
          l.nombre.toLowerCase().includes(q) ||
          l.telefono.includes(q) ||
          l.anuncioTitular.toLowerCase().includes(q) ||
          l.ultimoMensaje.toLowerCase().includes(q)),
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

  const th = (clave: Clave, texto: string, num?: boolean) => (
    <Th key={clave} clave={clave} texto={texto} num={num} orden={orden} alOrdenar={cambiarOrden} />
  );

  return (
    <section className="mk-panel">
      <div className="mk-panel-cabecera flex-wrap">
        <div className="mk-segmentos" role="group" aria-label="Etapa">
          {FILTROS_LEADS.map((f) => (
            <button key={f.clave} type="button" className="mk-segmento" aria-pressed={filtro === f.clave} onClick={() => { setFiltro(f.clave); setLimite(PAGINA); }}>
              {f.texto}
              <span className="mk-conteo">{leads.filter(f.f).length}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {campanas && campanas.length > 1 && (
            <select
              className="campo py-2"
              style={{ fontSize: "13px", width: "auto", maxWidth: 230 }}
              value={campana}
              onChange={(e) => setCampana(e.target.value)}
              aria-label="Campaña"
            >
              <option value="">Todas las campañas</option>
              {campanas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          )}
          <label className="relative flex items-center">
            <span className="pointer-events-none absolute left-3" style={{ color: "var(--muted-3)" }}>
              {Ico.buscar({ className: "h-4 w-4" })}
            </span>
            <input
              className="campo py-2 pl-9"
              style={{ width: 230, fontSize: "13px" }}
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
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link href="/marketing/campanas/nueva" className="btn-primario mk-btn-lg">
                Crear una campaña
              </Link>
              <Link href="/marketing/integraciones" className="btn-suave mk-btn-lg">
                Ver integraciones
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="mk-tabla min-w-[900px]">
            <thead>
              <tr>
                {th("nombre", "Persona")}
                {!ocultarCampana && th("campanaNombre", "De dónde vino")}
                {th("llegoEn", "Llegó")}
                {th("etapa", "Estado")}
                <th>Avance</th>
                {th("cobrado", "Valor", true)}
              </tr>
            </thead>
            <tbody>
              {visibles.slice(0, limite).map((l) => (
                <tr key={l.chatId}>
                  <td className="max-w-[260px]">
                    <div className="flex items-center gap-3">
                      <span className="mk-avatar" aria-hidden="true">
                        {(l.nombre || l.telefono || "?").trim().charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        {demo ? (
                          <div className="truncate font-semibold" style={{ fontSize: "13.5px" }} data-tip="En la demostración no hay conversaciones reales">
                            {l.nombre || l.telefono || "Sin nombre"}
                          </div>
                        ) : (
                          <Link
                            href={`/clientes/${encodeURIComponent(l.chatId)}`}
                            className="block truncate font-semibold hover:underline"
                            style={{ fontSize: "13.5px" }}
                            title="Abrir la conversación"
                          >
                            {l.nombre || l.telefono || "Sin nombre"}
                          </Link>
                        )}
                        <div className="truncate" style={{ fontSize: "11.5px", color: "var(--muted-2)" }} title={l.ultimoMensaje}>
                          {l.ultimoMensaje || l.telefono}
                        </div>
                      </div>
                    </div>
                  </td>
                  {!ocultarCampana && (
                    <td className="max-w-[250px]">
                      {l.campanaId ? (
                        <Link href={`/marketing/campanas/${encodeURIComponent(l.campanaId)}`} className="block truncate font-medium hover:underline">
                          {l.campanaNombre}
                        </Link>
                      ) : (
                        <div className="truncate font-medium">{l.campanaNombre}</div>
                      )}
                      <div className="truncate" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
                        {l.anuncioTitular}
                      </div>
                    </td>
                  )}
                  <td className="cifra whitespace-nowrap" style={{ color: "var(--muted)" }}>
                    {fechaCorta(l.llegoEn)}
                  </td>
                  <td>
                    <EstadoDeLead etapa={l.etapa} />
                  </td>
                  <td>
                    <Avance l={l} />
                  </td>
                  <td className="num cifra plata">
                    {l.cobrado > 0 ? formatearMonto({ valor: l.cobrado, moneda: monedaNegocio }) : <span className="nulo">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mk-panel-pie flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          {formatearNumero(Math.min(limite, visibles.length))} de {formatearNumero(visibles.length)} personas
          {visibles.length > limite && (
            <button type="button" className="btn-chico" onClick={() => setLimite((n) => n + PAGINA)}>
              Mostrar {Math.min(PAGINA, visibles.length - limite)} más
            </button>
          )}
        </span>
        <span>
          {demo ? "En la demostración no hay conversaciones reales." : "El nombre abre la conversación."} «Calificado» = avanzó a
          interesado o más, o cotizó, reservó o compró.
        </span>
      </div>
    </section>
  );
}

/** Tres pasos en una línea: qué logró la conversación. Lo apagado no pasó. */
function Avance({ l }: { l: Lead }) {
  const pasos = [
    { t: "Calificó", on: l.calificado },
    { t: "Cotizó", on: l.cotizo || l.agendo },
    { t: "Compró", on: l.compro },
  ];
  return (
    <span className="flex items-center gap-1.5">
      {pasos.map((p, i) => (
        <span key={p.t} className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1.5"
            style={{ fontSize: "11.5px", fontWeight: p.on ? 600 : 400, color: p.on ? "var(--tinta)" : "var(--muted-3)" }}
          >
            <i
              className="inline-block h-[7px] w-[7px] rounded-full"
              style={{ background: p.on ? (i === 2 ? "var(--ok)" : "var(--indigo)") : "var(--borde-fuerte)" }}
            />
            {p.t}
          </span>
          {i < 2 && <span style={{ color: "var(--borde-fuerte)", fontSize: 10 }}>›</span>}
        </span>
      ))}
    </span>
  );
}


/**
 * Cabecera ordenable, fuera del cuerpo del componente: definida adentro, React
 * la veía como un tipo nuevo en cada render y remontaba toda la fila con cada
 * tecla del buscador.
 */
function Th({
  clave,
  texto,
  num,
  orden,
  alOrdenar,
}: {
  clave: Clave;
  texto: string;
  num?: boolean;
  orden: { clave: Clave; desc: boolean };
  alOrdenar: (c: Clave) => void;
}) {
  const activa = orden.clave === clave;
  return (
    // `aria-sort` va en la celda de encabezado, no en el botón: es propiedad de
    // la columna. En el botón el lector de pantalla simplemente lo ignora.
    <th className={num ? "num" : ""} aria-sort={activa ? (orden.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => alOrdenar(clave)}>
        {texto}
        <span aria-hidden="true" style={{ opacity: activa ? 1 : 0.22, fontSize: 8 }}>
          {activa && !orden.desc ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}
