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
import { OBJETIVOS, type Creatividad, type FormatoCreatividad, type PlataformaCreatividad } from "@/lib/marketing/tipos";
import VistaPreviaAnuncio from "@/components/marketing/VistaPreviaAnuncio";
import { EstadoDeCreatividad } from "@/components/marketing/Estado";
import { Ico } from "@/components/marketing/Iconos";

/**
 * UNA CREATIVIDAD POR DENTRO — ver grande, editar, variar, usar.
 *
 * El anuncio va a la izquierda y GRANDE, sobre el lienzo, porque es lo que se
 * está juzgando; los controles van a la derecha. Cuando el formato lo permite
 * se puede alternar feed e historia, que son dos lecturas distintas del mismo
 * material.
 *
 * «Guardar» solo se enciende cuando algo cambió, para que el botón signifique
 * algo. Las acciones peligrosas viven al final y piden confirmación.
 */
const FORMATOS: FormatoCreatividad[] = ["1:1", "4:5", "9:16", "16:9"];

export default function EditorCreatividad({
  c,
  negocio,
  monedaNegocio,
  demo,
  recienCreada,
}: {
  c: Creatividad;
  negocio: string;
  monedaNegocio: string;
  demo: boolean;
  recienCreada?: boolean;
}) {
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
  const [superficie, setSuperficie] = useState<"feed" | "historia">(c.formato === "9:16" ? "historia" : "feed");
  const [ocupado, setOcupado] = useState<"" | "imagen" | "guardar" | "estado" | "duplicar" | "eliminar">("");
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(
    recienCreada ? { tono: "ok", texto: "Creatividad guardada." } : null,
  );
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const [, iniciar] = useTransition();

  const cambio =
    nombre !== c.nombre ||
    gancho !== c.gancho ||
    titular !== c.titular ||
    texto !== c.texto ||
    cta !== c.cta ||
    objetivo !== c.objetivo ||
    plataforma !== c.plataforma ||
    formato !== c.formato ||
    imagenPrompt !== (c.imagenPrompt ?? "") ||
    imagenUrl !== c.imagenUrl;

  const guardar = () => {
    setAviso(null);
    setOcupado("guardar");
    iniciar(async () => {
      const r = await guardarCreatividadAccion(
        {
          nombre,
          objetivo,
          producto: c.producto,
          oferta: c.oferta,
          plataforma,
          formato,
          concepto: c.concepto,
          gancho,
          titular,
          texto,
          cta,
          imagenUrl,
          imagenPrompt,
          estado: c.estado,
          campanaId: c.campanaId,
          varianteDe: c.varianteDe,
        },
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

  const r = c.rendimiento;
  const puedeHistoria = formato === "9:16" || formato === "4:5";
  const superficieReal = puedeHistoria && superficie === "historia" ? "historia" : "feed";

  return (
    <div className="grid gap-6 xl:grid-cols-12">
      {/* ── El anuncio ─────────────────────────────────────────────────── */}
      <div className="xl:col-span-6">
        <div className="xl:sticky xl:top-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="mk-hallazgo-tipo">Vista previa</span>
            {puedeHistoria && (
              <div className="mk-segmentos">
                <button type="button" className="mk-segmento" aria-pressed={superficieReal === "feed"} onClick={() => setSuperficie("feed")}>
                  Feed
                </button>
                <button type="button" className="mk-segmento" aria-pressed={superficieReal === "historia"} onClick={() => setSuperficie("historia")}>
                  Historia
                </button>
              </div>
            )}
          </div>
          <div className="mk-lienzo">
            <VistaPreviaAnuncio
              negocio={negocio}
              titular={titular}
              texto={texto}
              cta={cta}
              imagenUrl={imagenUrl}
              formato={formato}
              plataforma={plataforma}
              superficie={superficieReal}
              ancho={superficieReal === "historia" ? 300 : formato === "16:9" ? 470 : 410}
            />
          </div>

          {r && (
            <div className="mk-panel mt-4">
              <div className="mk-panel-cabecera">
                <h2 className="mk-h2">Rendimiento en Meta</h2>
                {c.campanaId && (
                  <Link href={`/marketing/campanas/${encodeURIComponent(c.campanaId)}`} className="mk-enlace">
                    {c.campanaNombre ?? "Ver campaña"} {Ico.flecha({ className: "h-3.5 w-3.5" })}
                  </Link>
                )}
              </div>
              <div className="mk-panel-cuerpo grid grid-cols-2 gap-5 sm:grid-cols-4">
                <Dato etiqueta="Invertido" valor={r.gasto === null ? "—" : formatearMonto({ valor: r.gasto, moneda: monedaNegocio })} />
                <Dato etiqueta="Clics" valor={r.clics === null ? "—" : formatearNumero(r.clics)} />
                <Dato etiqueta="Conversaciones" valor={formatearNumero(r.conversaciones)} />
                <Dato etiqueta="Ventas" valor={formatearNumero(r.ventas)} fuerte />
              </div>
            </div>
          )}

          <div className="mk-panel mt-4 p-5" style={{ fontSize: "12.5px", color: "var(--muted)", lineHeight: 1.6 }}>
            <div className="mk-hallazgo-tipo mb-2">Brief</div>
            <div>
              <strong style={{ color: "var(--tinta)" }}>Producto:</strong> {c.producto || "—"}
            </div>
            <div>
              <strong style={{ color: "var(--tinta)" }}>Oferta:</strong> {c.oferta || "—"}
            </div>
            <div>
              <strong style={{ color: "var(--tinta)" }}>Concepto:</strong> {c.concepto || "—"}
            </div>
            {c.varianteDe && (
              <div className="mt-1.5">
                Variación de{" "}
                <Link href={`/marketing/creatividades/${encodeURIComponent(c.varianteDe)}`} className="mk-enlace">
                  otra creatividad
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Los controles ──────────────────────────────────────────────── */}
      <div className="xl:col-span-6">
        <section className="mk-panel">
          <div className="mk-panel-cabecera">
            <div className="flex items-center gap-2.5">
              <EstadoDeCreatividad estado={c.estado} />
              <span className="mk-meta">{OBJETIVOS.find((o) => o.clave === c.objetivo)?.texto ?? c.objetivo}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {c.estado !== "lista" && c.estado !== "en_campana" && (
                <button type="button" className="btn-chico" disabled={ocupado !== ""} onClick={() => cambiarEstado("lista")}>
                  Marcar lista
                </button>
              )}
              {c.estado !== "archivada" ? (
                <button type="button" className="btn-chico" disabled={ocupado !== ""} onClick={() => cambiarEstado("archivada")}>
                  Archivar
                </button>
              ) : (
                <button type="button" className="btn-chico" disabled={ocupado !== ""} onClick={() => cambiarEstado("borrador")}>
                  Desarchivar
                </button>
              )}
            </div>
          </div>

          <div className="mk-panel-cuerpo">
            <Campo etiqueta="Nombre interno" valor={nombre} onChange={setNombre} max={80} />
            <Campo etiqueta="Gancho" valor={gancho} onChange={setGancho} max={LIMITES.gancho} />
            <Campo etiqueta="Titular" valor={titular} onChange={setTitular} max={LIMITES.titular} />
            <Campo etiqueta="Texto principal" valor={texto} onChange={setTexto} max={LIMITES.texto} area />

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mk-campo-rotulo">Botón</span>
                <select className="campo" value={cta} onChange={(e) => setCta(e.target.value)}>
                  {CTAS_META.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mk-campo-rotulo">Objetivo</span>
                <select className="campo" value={objetivo} onChange={(e) => setObjetivo(e.target.value)}>
                  {OBJETIVOS.map((o) => (
                    <option key={o.clave} value={o.clave}>
                      {o.texto}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mk-campo-rotulo">Plataforma</span>
                <select className="campo" value={plataforma} onChange={(e) => setPlataforma(e.target.value as PlataformaCreatividad)}>
                  <option value="ambas">Facebook e Instagram</option>
                  <option value="instagram">Solo Instagram</option>
                  <option value="facebook">Solo Facebook</option>
                </select>
              </label>
              <div>
                <span className="mk-campo-rotulo">Formato</span>
                <div className="mk-segmentos">
                  {FORMATOS.map((f) => (
                    <button key={f} type="button" className="mk-segmento" aria-pressed={formato === f} onClick={() => setFormato(f)}>
                      {f}
                    </button>
                  ))}
                </div>
                {formato !== c.formato && imagenUrl && (
                  <span className="mk-ayuda" style={{ color: "var(--alerta)" }}>
                    La imagen actual es {c.formato}: genera otra para el nuevo formato.
                  </span>
                )}
              </div>
            </div>

            <div className="mt-5 border-t pt-5" style={{ borderColor: "var(--borde)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="mk-campo-rotulo" style={{ marginBottom: 0 }}>
                  Imagen
                </span>
                <div className="flex gap-1.5">
                  <button type="button" className="btn-chico" onClick={() => setEditandoImagen((v) => !v)}>
                    {editandoImagen ? "Cerrar" : "Editar descripción"}
                  </button>
                  <button type="button" className="btn-chico" disabled={ocupado !== "" || demo} onClick={regenerarImagen}>
                    {ocupado === "imagen" ? "Generando…" : imagenUrl ? "Generar otra" : "Generar imagen"}
                  </button>
                </div>
              </div>
              {editandoImagen && (
                <textarea
                  className="campo mt-2.5"
                  rows={4}
                  value={imagenPrompt}
                  onChange={(e) => setImagenPrompt(e.target.value)}
                  placeholder="Describe la fotografía: producto, contexto, luz. Sin texto ni logos."
                />
              )}
              {ocupado === "imagen" && (
                <span className="mk-pensando mt-2">
                  <i />
                  <i />
                  <i />
                  Unos 5 a 10 segundos
                </span>
              )}
              {demo && <p className="mk-ayuda">En demostración no se generan imágenes nuevas.</p>}
            </div>

            {aviso && (
              <div
                className="mt-5 rounded-lg px-4 py-3"
                style={{ background: aviso.tono === "ok" ? "var(--ok-suave)" : "#fdf1ee", color: aviso.tono === "ok" ? "var(--ok)" : "var(--tinta)", fontSize: "13px" }}
              >
                {aviso.texto}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t px-5 py-4" style={{ borderColor: "var(--borde)" }}>
            <button type="button" className="btn-primario mk-btn-lg" disabled={!cambio || ocupado !== ""} onClick={guardar}>
              {ocupado === "guardar" ? "Guardando…" : "Guardar cambios"}
            </button>
            <Link href={`/marketing/campanas/nueva?creatividad=${encodeURIComponent(c.id)}`} className="btn-suave">
              {Ico.campanas({ className: "h-4 w-4" })} Usar en campaña
            </Link>
            <Link href={`/marketing/creatividades/nueva?variarDe=${encodeURIComponent(c.id)}`} className="btn-suave">
              {Ico.variar({ className: "h-4 w-4" })} Crear variación
            </Link>
            <button type="button" className="btn-suave" disabled={ocupado !== ""} onClick={duplicar}>
              {Ico.copiar({ className: "h-4 w-4" })} Duplicar
            </button>
            <span className="flex-1" />
            {confirmarBorrar ? (
              <>
                <button type="button" className="btn-peligro" disabled={ocupado !== ""} onClick={eliminar}>
                  {ocupado === "eliminar" ? "Eliminando…" : "Sí, eliminar"}
                </button>
                <button type="button" className="btn-texto" onClick={() => setConfirmarBorrar(false)}>
                  No
                </button>
              </>
            ) : (
              <button type="button" className="btn-texto" style={{ color: "var(--peligro)" }} onClick={() => setConfirmarBorrar(true)}>
                Eliminar
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Campo({ etiqueta, valor, onChange, max, area }: { etiqueta: string; valor: string; onChange: (v: string) => void; max: number; area?: boolean }) {
  return (
    <label className="mb-4 block">
      <span className="mk-campo-rotulo">
        {etiqueta}
        <span className="cifra" style={{ fontSize: "11px", fontWeight: 500, color: valor.length > max ? "var(--peligro)" : "var(--muted-3)" }}>
          {valor.length}/{max}
        </span>
      </span>
      {area ? (
        <textarea className="campo" rows={4} value={valor} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="campo" value={valor} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

function Dato({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div>
      <div className="mk-dato-mini-etiqueta">{etiqueta}</div>
      <div className="cifra mt-1" style={{ fontSize: "18px", fontWeight: 600, letterSpacing: "-0.02em", color: fuerte ? "var(--indigo)" : "var(--tinta)" }}>
        {valor}
      </div>
    </div>
  );
}
