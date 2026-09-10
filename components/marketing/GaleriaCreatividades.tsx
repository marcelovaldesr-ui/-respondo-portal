"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Creatividad } from "@/lib/marketing/tipos";
import TarjetaCreatividad from "@/components/marketing/TarjetaCreatividad";
import { Ico } from "@/components/marketing/Iconos";

/**
 * LA GALERÍA — visual primero. Filtros por estado y formato, buscador por
 * nombre, titular o producto; orden por rendimiento cuando lo hay.
 */
const ESTADOS = [
  { clave: "todas", texto: "Todas", f: (c: Creatividad) => c.estado !== "archivada" },
  { clave: "lista", texto: "Listas", f: (c: Creatividad) => c.estado === "lista" },
  { clave: "en_campana", texto: "En campaña", f: (c: Creatividad) => c.estado === "en_campana" },
  { clave: "borrador", texto: "Borradores", f: (c: Creatividad) => c.estado === "borrador" },
  { clave: "archivada", texto: "Archivadas", f: (c: Creatividad) => c.estado === "archivada" },
];

export default function GaleriaCreatividades({ items, monedaNegocio }: { items: Creatividad[]; monedaNegocio: string }) {
  const [estado, setEstado] = useState("todas");
  const [formato, setFormato] = useState("");
  const [orden, setOrden] = useState<"recientes" | "rendimiento">("recientes");
  const [busqueda, setBusqueda] = useState("");

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const f = ESTADOS.find((e) => e.clave === estado)?.f ?? (() => true);
    const out = items.filter(
      (c) =>
        f(c) &&
        (!formato || c.formato === formato) &&
        (!q || c.nombre.toLowerCase().includes(q) || c.titular.toLowerCase().includes(q) || c.producto.toLowerCase().includes(q) || (c.campanaNombre ?? "").toLowerCase().includes(q)),
    );
    if (orden === "rendimiento") {
      out.sort((a, b) => (b.rendimiento?.ventas ?? -1) - (a.rendimiento?.ventas ?? -1) || (b.rendimiento?.conversaciones ?? -1) - (a.rendimiento?.conversaciones ?? -1));
    } else {
      out.sort((a, b) => b.actualizadoEn.localeCompare(a.actualizadoEn));
    }
    return out;
  }, [items, estado, formato, orden, busqueda]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="mk-segmentos" role="group" aria-label="Estado">
          {ESTADOS.map((e) => (
            <button key={e.clave} type="button" className="mk-segmento" aria-pressed={estado === e.clave} onClick={() => setEstado(e.clave)}>
              {e.texto}
              <span className="ml-1" style={{ color: "var(--muted-3)", fontWeight: 500 }}>{items.filter(e.f).length}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="campo py-1.5" style={{ fontSize: "var(--t-menor)", width: "auto" }} value={formato} onChange={(e) => setFormato(e.target.value)} aria-label="Formato">
            <option value="">Todos los formatos</option>
            <option value="1:1">1:1</option>
            <option value="4:5">4:5</option>
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
          </select>
          <select className="campo py-1.5" style={{ fontSize: "var(--t-menor)", width: "auto" }} value={orden} onChange={(e) => setOrden(e.target.value as "recientes" | "rendimiento")} aria-label="Orden">
            <option value="recientes">Más recientes</option>
            <option value="rendimiento">Mejor rendimiento</option>
          </select>
          <label className="relative flex items-center">
            <span className="pointer-events-none absolute left-2.5" style={{ color: "var(--muted-3)" }}>{Ico.buscar()}</span>
            <input className="campo py-1.5 pl-8" style={{ width: 200, fontSize: "var(--t-menor)" }} placeholder="Buscar" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </label>
        </div>
      </div>

      {visibles.length === 0 ? (
        <div className="tarjeta">
          <div className="vacio">
            <div className="vacio-titulo">{items.length ? "Ninguna creatividad coincide" : "Todavía no hay creatividades"}</div>
            <p className="vacio-texto">
              {items.length ? "Prueba con otro filtro o texto." : "El estudio escribe el anuncio con lo que Respondo sabe de tu negocio y genera la imagen. No hace falta conectar nada."}
            </p>
            {!items.length && (
              <Link href="/marketing/creatividades/nueva" className="btn-primario mt-4">Crear la primera</Link>
            )}
          </div>
        </div>
      ) : (
        <div className="mk-galeria">
          {visibles.map((c) => (
            <TarjetaCreatividad key={c.id} c={c} monedaNegocio={monedaNegocio} />
          ))}
        </div>
      )}
    </div>
  );
}
