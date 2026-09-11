"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

/** Cuántas tarjetas se pintan de una. Cada una trae imagen. */
const PAGINA = 24;
import type { Creatividad } from "@/lib/marketing/tipos";
import TarjetaCreatividad from "@/components/marketing/TarjetaCreatividad";
import { Ico } from "@/components/marketing/Iconos";

/**
 * LA GALERÍA DEL ESTUDIO — visual primero, nunca una tabla.
 *
 * Lo que se está mirando son imágenes; ordenarlas en filas de texto sería
 * negar de qué trata la pantalla. Los filtros son de estado y formato porque
 * son las dos preguntas reales («¿cuáles puedo usar?», «¿tengo algo para
 * historias?»), y el orden por rendimiento contesta la tercera: cuál repetir.
 */
const ESTADOS = [
  { clave: "todas", texto: "Todas", f: (c: Creatividad) => c.estado !== "archivada" },
  { clave: "lista", texto: "Listas", f: (c: Creatividad) => c.estado === "lista" },
  { clave: "en_campana", texto: "En campaña", f: (c: Creatividad) => c.estado === "en_campana" },
  { clave: "borrador", texto: "Borradores", f: (c: Creatividad) => c.estado === "borrador" },
  { clave: "archivada", texto: "Archivadas", f: (c: Creatividad) => c.estado === "archivada" },
];

const FORMATOS = ["1:1", "4:5", "9:16", "16:9"] as const;

export default function GaleriaCreatividades({ items, monedaNegocio }: { items: Creatividad[]; monedaNegocio: string }) {
  const [estado, setEstado] = useState("todas");
  const [formato, setFormato] = useState("");
  const [orden, setOrden] = useState<"recientes" | "rendimiento">("recientes");
  const [tope, setTope] = useState(PAGINA);
  const [busqueda, setBusqueda] = useState("");

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const f = ESTADOS.find((e) => e.clave === estado)?.f ?? (() => true);
    const out = items.filter(
      (c) =>
        f(c) &&
        (!formato || c.formato === formato) &&
        (!q ||
          c.nombre.toLowerCase().includes(q) ||
          c.titular.toLowerCase().includes(q) ||
          c.producto.toLowerCase().includes(q) ||
          (c.campanaNombre ?? "").toLowerCase().includes(q)),
    );
    if (orden === "rendimiento") {
      out.sort(
        (a, b) =>
          (b.rendimiento?.ventas ?? -1) - (a.rendimiento?.ventas ?? -1) ||
          (b.rendimiento?.conversaciones ?? -1) - (a.rendimiento?.conversaciones ?? -1),
      );
    } else {
      out.sort((a, b) => b.actualizadoEn.localeCompare(a.actualizadoEn));
    }
    return out;
  }, [items, estado, formato, orden, busqueda]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="mk-segmentos" role="group" aria-label="Estado">
          {ESTADOS.map((e) => (
            <button key={e.clave} type="button" className="mk-segmento" aria-pressed={estado === e.clave} onClick={() => { setTope(PAGINA); setEstado(e.clave); }}>
              {e.texto}
              <span className="mk-conteo">{items.filter(e.f).length}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mk-segmentos" role="group" aria-label="Formato">
            <button type="button" className="mk-segmento" aria-pressed={formato === ""} onClick={() => { setTope(PAGINA); setFormato(""); }}>
              Todos
            </button>
            {FORMATOS.map((f) => (
              <button key={f} type="button" className="mk-segmento" aria-pressed={formato === f} onClick={() => { setTope(PAGINA); setFormato(f); }}>
                {f}
              </button>
            ))}
          </div>
          <select
            className="campo py-2"
            style={{ fontSize: "13px", width: "auto" }}
            value={orden}
            onChange={(e) => setOrden(e.target.value as "recientes" | "rendimiento")}
            aria-label="Orden"
          >
            <option value="recientes">Más recientes</option>
            <option value="rendimiento">Mejor rendimiento</option>
          </select>
          <label className="relative flex items-center">
            <span className="pointer-events-none absolute left-3" style={{ color: "var(--muted-3)" }}>
              {Ico.buscar({ className: "h-4 w-4" })}
            </span>
            <input
              className="campo py-2 pl-9"
              style={{ width: 200, fontSize: "13px" }}
              placeholder="Buscar"
              value={busqueda}
              onChange={(e) => { setTope(PAGINA); setBusqueda(e.target.value); }}
            />
          </label>
        </div>
      </div>

      {visibles.length === 0 ? (
        <div className="mk-panel">
          <div className="vacio">
            <div className="vacio-titulo">Ninguna creatividad coincide</div>
            <p className="vacio-texto">Prueba con otro estado, otro formato o borrando el texto.</p>
            <Link href="/marketing/creatividades/nueva" className="btn-primario mk-btn-lg mt-5">
              Crear una nueva
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mk-galeria grande">
            {visibles.slice(0, tope).map((c) => (
              <TarjetaCreatividad key={c.id} c={c} monedaNegocio={monedaNegocio} />
            ))}
          </div>
          {/* Cada tarjeta trae una imagen: pintar 500 de una deja el navegador
              clavado varios segundos. Se muestran de a 24 y el resto se pide
              con un botón, que además es lo que la gente hace de verdad —mira
              las últimas, no las quinientas—. */}
          {visibles.length > tope && (
            <div className="mt-6 flex flex-col items-center gap-2">
              <button type="button" className="btn-suave mk-btn-lg" onClick={() => setTope((t) => t + PAGINA)}>
                Ver más creatividades
              </button>
              <span className="mk-meta">
                {tope} de {visibles.length}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
