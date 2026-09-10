"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  cambiarEstadoCreatividadAccion,
  duplicarCreatividadAccion,
  eliminarCreatividadAccion,
  generarImagenCreativa,
  guardarCreatividadAccion,
} from "@/app/(marketing)/marketing/creatividades/acciones";
import { CTAS_META, LIMITES } from "@/lib/marketing/creatividadesCore";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import { OBJETIVOS, textoObjetivo, type Creatividad, type FormatoCreatividad, type PlataformaCreatividad } from "@/lib/marketing/tipos";
import VistaPreviaAnuncio from "@/components/marketing/VistaPreviaAnuncio";
import { Ico } from "@/components/marketing/Iconos";

/**
 * UNA CREATIVIDAD POR DENTRO — ver grande, editar, variar, usar.
 *
 * A la izquierda la vista previa (grande, en su formato real); a la derecha
 * el copy editable con los límites de Meta, el formato, la imagen y las
 * acciones. «Guardar» solo se enciende cuando algo cambió.
 */
const ESTADO: Record<Creatividad["estado"], { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "pildora-neutra" },
  lista: { texto: "Lista", clase: "pildora-indigo" },
  en_campana: { texto: "En campaña", clase: "pildora-ok" },
  archivada: { texto: "Archivada", clase: "pildora-neutra" },
};

const FORMATOS: FormatoCreatividad[] = ["1:1", "4:5", "9:16", "16:9"];

export default function EditorCreatividad({ c, negocio, monedaNegocio, demo, recienCreada }: { c: Creatividad; negocio: string; monedaNegocio: string; demo: boolean; recienCreada?: boolean }) {
  const router = useRouter();
  const [nombre, setNombre] = useState(c.nombre);
  const [gancho, setGancho] = useState(c.gancho);
  const [titular, setTitular] = useState(c.titular);
  const [texto, setTexto] = useState(c.texto);
  const [cta, setCta] = useState(c.cta || "Enviar mensaje");
  const [objetivo, setObjetivo] = useState(c.objetivo);
  const [plataforma, setPlataforma] = useState<PlataformaCreatividad>(c.plataforma);
  const [formato, setFormato] = useState<FormatoCreatividad>(c.formato);
  const [imagenPrompt, setImagenPrompt] = useState(c.imagenPrompt ?? "");
  const [imagenUrl, setImagenUrl] = useState<string | null>(c.imagenUrl);
  const [editandoImagen, setEditandoImagen] = useState(false);
  const [ocupado, setOcupado] = useState<"" | "imagen" | "guardar" | "estado" | "duplicar" | "eliminar">("");
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(recienCreada ? { tono: "ok", texto: "Creatividad guardada." } : null);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const [, iniciar] = useTransition();

  const cambio =
    nombre !== c.nombre || gancho !== c.gancho || titular !== c.titular || texto !== c.texto || cta !== c.cta || objetivo !== c.objetivo ||
    plataforma !== c.plataforma || formato !== c.formato || imagenPrompt !== (c.imagenPrompt ?? "") || imagenUrl !== c.imagenUrl;

  const guardar = () => {
    setAviso(null);
    setOcupado("guardar");
    iniciar(async () => {
      const r = await guardarCreatividadAccion(
        { nombre, objetivo, producto: c.producto, oferta: c.oferta, plataforma, formato, concepto: c.concepto, gancho, titular, texto, cta, imagenUrl, imagenPrompt, estado: c.estado, campanaId: c.campanaId, varianteDe: c.varianteDe },
        c.id,
      );
      setOcupado("");
      if (!r.ok) return setAviso({ tono: "error", texto: r.motivo });
      setAviso({ tono: "ok", texto: "Guardado." });
      router.refresh();
    });
  };

  const regenerarImagen = () => {
    setAviso(null);
    setOcupado("imagen");
    iniciar(async () => {
      const r = await generarImagenCreativa(imagenPrompt || `${c.producto}. ${c.concepto}`, formato);
      setOcupado("");
      if (!r.ok) return setAviso({ tono: "error", texto: r.motivo });
      if (r.demo) return setAviso({ tono: "error", texto: "En demostración la imagen es de muestra y no se guarda." });
      setImagenUrl(r.url);
      setEditandoImagen(false);
      setAviso({ tono: "ok", texto: "Imagen generada. Guarda para conservarla." });
    });
  };

  const cambiarEstado = (estado: Creatividad["estado"]) => {
    setOcupado("estado");
    iniciar(async () => {
      const r = await cambiarEstadoCreatividadAccion(c.id, estado);
      setOcupado("");
      if (!r.ok) return setAviso({ tono: "error", texto: r.motivo ?? "No se pudo." });
      router.refresh();
    });
  };

  const duplicar = () => {
    setOcupado("duplicar");
    iniciar(async () => {
      const r = await duplicarCreatividadAccion(c.id);
      setOcupado("");
      if (!r.ok) return setAviso({ tono: "error", texto: r.motivo });
      router.push(`/marketing/creatividades/${encodeURIComponent(r.id)}`);
    });
  };

  const eliminar = () => {
    setOcupado("eliminar");
    iniciar(async () => {
      const r = await eliminarCreatividadAccion(c.id);
      setOcupado("");
      if (!r.ok) return setAviso({ tono: "error", texto: r.motivo ?? "No se pudo eliminar." });
      router.push("/marketing/creatividades");
    });
  };

  const Contador = ({ n, max }: { n: number; max: number }) => (
    <span className="cifra" style={{ fontSize: "var(--t-micro)", color: n > max ? "var(--peligro)" : "var(--muted-3)" }}>{n}/{max}</span>
  );
  const r = c.rendimiento;

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {/* Vista grande */}
      <div className="lg:col-span-6">
        <div className="tarjeta-plana flex justify-center p-5" style={{ background: "var(--fondo-hundido)" }}>
          <VistaPreviaAnuncio negocio={negocio} titular={titular} texto={texto} cta={cta} imagenUrl={imagenUrl} formato={formato} plataforma={plataforma} ancho={formato === "9:16" ? 300 : 400} />
        </div>
        {r && (
          <div className="tarjeta mt-4 p-4">
            <div className="eyebrow">Rendimiento en Meta</div>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Dato etiqueta="Gasto" valor={r.gasto === null ? "—" : formatearMonto({ valor: r.gasto, moneda: monedaNegocio })} />
              <Dato etiqueta="Clics" valor={r.clics === null ? "—" : formatearNumero(r.clics)} />
              <Dato etiqueta="Conversaciones" valor={formatearNumero(r.conversaciones)} />
              <Dato etiqueta="Ventas" valor={formatearNumero(r.ventas)} fuerte />
            </div>
            {c.campanaId && (
              <Link href={`/marketing/campanas/${encodeURIComponent(c.campanaId)}`} className="mt-3 inline-block font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}>
                Ver campaña {c.campanaNombre ? `«${c.campanaNombre}»` : ""} →
              </Link>
            )}
          </div>
        )}
        <div className="tarjeta mt-4 p-4" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
          <div className="eyebrow mb-1">Brief</div>
          <div><strong style={{ color: "var(--tinta)" }}>Producto:</strong> {c.producto || "—"}</div>
          <div><strong style={{ color: "var(--tinta)" }}>Oferta:</strong> {c.oferta || "—"}</div>
          <div><strong style={{ color: "var(--tinta)" }}>Concepto:</strong> {c.concepto || "—"}</div>
          {c.varianteDe && (
            <div className="mt-1">
              Variación de{" "}
              <Link href={`/marketing/creatividades/${encodeURIComponent(c.varianteDe)}`} className="font-semibold" style={{ color: "var(--indigo)" }}>otra creatividad</Link>
            </div>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="lg:col-span-6">
        <section className="tarjeta p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={ESTADO[c.estado].clase}>{ESTADO[c.estado].texto}</span>
              <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{textoObjetivo(c.objetivo)}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {c.estado !== "lista" && c.estado !== "en_campana" && (
                <button type="button" className="btn-chico" disabled={ocupado !== ""} onClick={() => cambiarEstado("lista")}>Marcar lista</button>
              )}
              {c.estado !== "archivada" ? (
                <button type="button" className="btn-chico" disabled={ocupado !== ""} onClick={() => cambiarEstado("archivada")}>Archivar</button>
              ) : (
                <button type="button" className="btn-chico" disabled={ocupado !== ""} onClick={() => cambiarEstado("borrador")}>Desarchivar</button>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            <Campo etiqueta="Nombre interno" valor={nombre} onChange={setNombre} max={80} contador={Contador} />
            <Campo etiqueta="Gancho" valor={gancho} onChange={setGancho} max={LIMITES.gancho} contador={Contador} />
            <Campo etiqueta="Titular" valor={titular} onChange={setTitular} max={LIMITES.titular} contador={Contador} />
            <Campo etiqueta="Texto principal" valor={texto} onChange={setTexto} max={LIMITES.texto} contador={Contador} area />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Botón</span>
                <select className="campo mt-1" value={cta} onChange={(e) => setCta(e.target.value)}>
                  {CTAS_META.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Objetivo</span>
                <select className="campo mt-1" value={objetivo} onChange={(e) => setObjetivo(e.target.value)}>
                  {OBJETIVOS.map((o) => <option key={o.clave} value={o.clave}>{o.texto}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Plataforma</span>
                <select className="campo mt-1" value={plataforma} onChange={(e) => setPlataforma(e.target.value as PlataformaCreatividad)}>
                  <option value="ambas">Facebook e Instagram</option>
                  <option value="instagram">Solo Instagram</option>
                  <option value="facebook">Solo Facebook</option>
                </select>
              </label>
              <div>
                <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Formato</span>
                <div className="mk-segmentos mt-1">
                  {FORMATOS.map((f) => (
                    <button key={f} type="button" className="mk-segmento" aria-pressed={formato === f} onClick={() => setFormato(f)}>{f}</button>
                  ))}
                </div>
                {formato !== c.formato && imagenUrl && (
                  <span className="mt-1 block" style={{ fontSize: "var(--t-micro)", color: "var(--alerta)" }}>La imagen actual es {c.formato}: genera otra para el nuevo formato.</span>
                )}
              </div>
            </div>
          </div>

          {/* Imagen */}
          <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--borde)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Imagen</span>
              <div className="flex gap-1.5">
                <button type="button" className="btn-chico" onClick={() => setEditandoImagen((v) => !v)}>{editandoImagen ? "Cerrar" : "Editar descripción"}</button>
                <button type="button" className="btn-chico" disabled={ocupado !== "" || demo} onClick={regenerarImagen}>
                  {ocupado === "imagen" ? "Generando…" : imagenUrl ? "Generar otra" : "Generar imagen"}
                </button>
              </div>
            </div>
            {editandoImagen && (
              <textarea className="campo mt-2" rows={3} value={imagenPrompt} onChange={(e) => setImagenPrompt(e.target.value)} placeholder="Describe la fotografía: producto, contexto, luz. Sin texto ni logos." />
            )}
            {ocupado === "imagen" && <p className="mt-1" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>Unos 5 a 10 segundos.</p>}
            {demo && <p className="mt-1" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>En demostración no se generan imágenes nuevas.</p>}
          </div>

          {aviso && (
            <div className="mt-4 rounded-md px-3 py-2" style={{ background: aviso.tono === "ok" ? "var(--ok-suave)" : "var(--alerta-suave)", color: aviso.tono === "ok" ? "var(--ok)" : "var(--tinta)", fontSize: "var(--t-menor)" }}>
              {aviso.texto}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: "var(--borde)" }}>
            <button type="button" className="btn-primario" disabled={!cambio || ocupado !== ""} onClick={guardar}>
              {ocupado === "guardar" ? "Guardando…" : "Guardar cambios"}
            </button>
            <Link href={`/marketing/campanas/nueva?creatividad=${encodeURIComponent(c.id)}`} className="btn-suave">
              {Ico.campanas()} Usar en campaña
            </Link>
            <Link href={`/marketing/creatividades/nueva?variarDe=${encodeURIComponent(c.id)}`} className="btn-suave">
              {Ico.variar()} Crear variación
            </Link>
            <button type="button" className="btn-suave" disabled={ocupado !== ""} onClick={duplicar}>
              {Ico.copiar()} Duplicar
            </button>
            <span className="flex-1" />
            {confirmarBorrar ? (
              <>
                <button type="button" className="btn-peligro" disabled={ocupado !== ""} onClick={eliminar}>{ocupado === "eliminar" ? "Eliminando…" : "Sí, eliminar"}</button>
                <button type="button" className="btn-texto" onClick={() => setConfirmarBorrar(false)}>No</button>
              </>
            ) : (
              <button type="button" className="btn-texto" style={{ color: "var(--peligro)" }} onClick={() => setConfirmarBorrar(true)}>Eliminar</button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Campo({ etiqueta, valor, onChange, max, area, contador: Contador }: { etiqueta: string; valor: string; onChange: (v: string) => void; max: number; area?: boolean; contador: (p: { n: number; max: number }) => React.ReactElement }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>{etiqueta}</span>
        <Contador n={valor.length} max={max} />
      </span>
      {area ? <textarea className="campo mt-1" rows={4} value={valor} onChange={(e) => onChange(e.target.value)} /> : <input className="campo mt-1" value={valor} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

function Dato({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{etiqueta}</div>
      <div className="cifra" style={{ fontSize: "var(--t-fila)", fontWeight: 600, color: fuerte ? "var(--indigo)" : "var(--tinta)" }}>{valor}</div>
    </div>
  );
}
