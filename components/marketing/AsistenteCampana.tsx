"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { eliminarBorradorAccion, guardarBorradorAccion, sugerirCopiesAccion } from "@/app/(marketing)/marketing/campanas/acciones";
import { borradorEnTexto, faltantesDeBorrador } from "@/lib/marketing/campanasCore";
import { CTAS_META, LIMITES } from "@/lib/marketing/creatividadesCore";
import { OBJETIVOS, type BorradorCampana, type Creatividad, type EstadoCampana } from "@/lib/marketing/tipos";
import VistaPreviaAnuncio from "@/components/marketing/VistaPreviaAnuncio";
import { EstadoDeCampana } from "@/components/marketing/Estado";
import { Ico } from "@/components/marketing/Iconos";
import { urlDeImagen } from "@/lib/marketing/imagenes";
import ModalPublicarCampana from "@/components/marketing/ModalPublicarCampana";
import type { Proveedor } from "@/lib/ads/canal";

/**
 * EL ASISTENTE DE CAMPAÑAS — hacer simple lo que Meta hace complejo.
 *
 * Tres columnas y cada una tiene un trabajo:
 *   IZQUIERDA  el camino: ocho pasos con su estado real (listo, actual,
 *              pendiente) y el estado de la campaña, que el servidor calcula.
 *   CENTRO     el paso, con aire. Un solo tema por pantalla y las ayudas
 *              donde importan, no en un párrafo bajo el título.
 *   DERECHA    la vista previa, pegada, que cambia con cada tecla: imagen,
 *              titular, texto, botón y negocio. En formato historia se puede
 *              alternar entre feed y pantalla completa, porque sí sabemos
 *              representar las dos.
 *
 * El estado NUNCA miente: al final no hay un botón «Publicar» que finja. Hay
 * «Copiar configuración» —que deja todo listo para pegar en el Administrador
 * de Anuncios— y «Continuar en Meta».
 */
const PASOS = [
  { t: "Objetivo", sub: "Qué quieres lograr" },
  { t: "Oferta", sub: "Qué vas a ofrecer" },
  { t: "Audiencia", sub: "A quién" },
  { t: "Presupuesto", sub: "Cuánto" },
  { t: "Creatividades", sub: "Con qué imagen" },
  { t: "Copy", sub: "Qué dice" },
  { t: "Destino", sub: "A dónde llega" },
  { t: "Revisión", sub: "Todo junto" },
];

type Copy = { titular: string; texto: string; cta: string };

export default function AsistenteCampana({
  borrador,
  creatividades,
  negocio,
  ofertas,
  zona,
  whatsapp,
  metaConectada,
  puedeConectarMeta,
  puedePublicar,
  puedeGenerarConIa,
  demo,
  creatividadInicial,
}: {
  borrador: BorradorCampana | null;
  creatividades: Creatividad[];
  negocio: string;
  ofertas: { titulo: string; detalle: string }[];
  zona: string | null;
  whatsapp: string | null;
  metaConectada: boolean;
  /** Si la instalación permite conectar una cuenta publicitaria. */
  puedeConectarMeta: boolean;
  /** Si Respondo puede publicar campañas en Meta por API. Hoy: no, a propósito. */
  puedePublicar: boolean;
  /** Si hay motor de IA para sugerir copies. */
  puedeGenerarConIa: boolean;
  demo: boolean;
  creatividadInicial?: string | null;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState(borrador ? 8 : 1);
  const [id, setId] = useState<string | null>(borrador?.id ?? null);
  const [estado, setEstado] = useState<EstadoCampana>(borrador?.estado ?? "borrador");
  const [nombre, setNombre] = useState(borrador?.nombre ?? "");
  const [objetivo, setObjetivo] = useState(borrador?.objetivo ?? "conversaciones");
  const [producto, setProducto] = useState("");
  const [oferta, setOferta] = useState(borrador?.oferta ?? "");
  const [ubicacion, setUbicacion] = useState(borrador?.audiencia.ubicacion ?? (zona ? `${zona} y alrededores` : ""));
  const [edadDesde, setEdadDesde] = useState<string>(String(borrador?.audiencia.edadDesde ?? 25));
  const [edadHasta, setEdadHasta] = useState<string>(String(borrador?.audiencia.edadHasta ?? 55));
  const [intereses, setIntereses] = useState(borrador?.audiencia.intereses.join(", ") ?? "");
  const [notaAudiencia, setNotaAudiencia] = useState(borrador?.audiencia.nota ?? "");
  const [presupuestoDiario, setPresupuestoDiario] = useState<string>(borrador?.presupuestoDiario ? String(borrador.presupuestoDiario) : "");
  const [presupuestoTotal, setPresupuestoTotal] = useState<string>(borrador?.presupuestoTotal ? String(borrador.presupuestoTotal) : "");
  const [creatividadIds, setCreatividadIds] = useState<string[]>(borrador?.creatividadIds ?? (creatividadInicial ? [creatividadInicial] : []));
  const [copies, setCopies] = useState<Copy[]>(borrador?.copies.length ? borrador.copies : [{ titular: "", texto: "", cta: "Enviar mensaje" }]);
  const [notas, setNotas] = useState(borrador?.notas ?? "");
  const [superficie, setSuperficie] = useState<"feed" | "historia">("feed");
  const [ocupado, setOcupado] = useState<"" | "guardar" | "copies" | "eliminar">("");
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const [modalPublicar, setModalPublicar] = useState(false);
  const [proveedorModal, setProveedorModal] = useState<Proveedor>("meta");
  const [, iniciar] = useTransition();

  const abrirPublicar = (prov: Proveedor) => {
    setProveedorModal(prov);
    if (!id) {
      guardar(() => {
        setModalPublicar(true);
      });
    } else {
      setModalPublicar(true);
    }
  };

  const seleccionadas = creatividades.filter((c) => creatividadIds.includes(c.id));
  const principal = seleccionadas[0] ?? null;
  const entrada = () => ({
    nombre: nombre || (producto ? `${producto} · ${new Date().toLocaleDateString("es-CL", { month: "long" })}` : ""),
    objetivo,
    oferta,
    audiencia: {
      ubicacion,
      edadDesde: edadDesde ? Number(edadDesde) : null,
      edadHasta: edadHasta ? Number(edadHasta) : null,
      intereses: intereses.split(",").map((s) => s.trim()).filter(Boolean),
      nota: notaAudiencia,
    },
    presupuestoDiario: presupuestoDiario ? Number(presupuestoDiario) : null,
    presupuestoTotal: presupuestoTotal ? Number(presupuestoTotal) : null,
    moneda: "CLP",
    destino: "whatsapp" as const,
    creatividadIds,
    copies: copies.filter((c) => c.titular.trim() || c.texto.trim()),
    notas,
  });
  const faltantes = faltantesDeBorrador({ ...entrada(), copies });

  const estadoVisible: EstadoCampana = faltantes.length
    ? "borrador"
    : estado === "borrador"
      ? metaConectada
        ? "requiere_permiso"
        : "requiere_meta"
      : estado;

  const guardar = (despues?: (id: string) => void) => {
    setAviso(null);
    setOcupado("guardar");
    iniciar(async () => {
      const r = await guardarBorradorAccion(entrada(), id ?? undefined);
      setOcupado("");
      if (!r.ok) return setAviso({ tono: "error", texto: r.motivo });
      setId(r.id);
      setEstado(r.estado);
      setAviso({ tono: "ok", texto: "Borrador guardado." });
      if (!id) window.history.replaceState(null, "", `/marketing/campanas/nueva?id=${encodeURIComponent(r.id)}`);
      despues?.(r.id);
    });
  };

  const sugerirCopies = () => {
    setAviso(null);
    setOcupado("copies");
    iniciar(async () => {
      const r = await sugerirCopiesAccion({ objetivo, oferta, producto: producto || principal?.producto || "" });
      setOcupado("");
      if (!r.ok) return setAviso({ tono: "error", texto: r.motivo });
      setCopies(r.copies);
    });
  };

  const copiarConfiguracion = async () => {
    const t = borradorEnTexto({ ...entrada(), id: id ?? "", estado, creadoEn: "", actualizadoEn: "" });
    try {
      await navigator.clipboard.writeText(t);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setAviso({ tono: "error", texto: "No se pudo copiar. Abre «Ver la configuración en texto» y cópiala a mano." });
    }
  };

  const eliminar = () => {
    if (!id) return;
    setOcupado("eliminar");
    iniciar(async () => {
      const r = await eliminarBorradorAccion(id);
      setOcupado("");
      if (!r.ok) return setAviso({ tono: "error", texto: r.motivo ?? "No se pudo eliminar." });
      router.push("/marketing/campanas");
    });
  };

  const copyPrincipal = copies.find((c) => c.titular || c.texto) ?? {
    titular: principal?.titular ?? "",
    texto: principal?.texto ?? "",
    cta: principal?.cta ?? "Enviar mensaje",
  };
  const formatoPrev = principal?.formato ?? "1:1";
  const puedeHistoria = formatoPrev === "9:16" || formatoPrev === "4:5";
  const superficieReal = puedeHistoria && superficie === "historia" ? "historia" : "feed";

  return (
    <div className="grid gap-6 xl:grid-cols-12">
      {/* ── El camino ──────────────────────────────────────────────────── */}
      <nav className="xl:col-span-3" aria-label="Pasos">
        <div className="xl:sticky xl:top-6">
          <div className="mk-panel p-2.5">
            <ol className="mk-pasos">
              {PASOS.map((s, i) => {
                const n = i + 1;
                const listo = !faltantes.some((f) => f.paso === n) && n !== 8;
                return (
                  <li key={s.t}>
                    <button type="button" className={`mk-paso ${listo ? "listo" : ""}`} aria-current={paso === n ? "step" : undefined} onClick={() => setPaso(n)}>
                      <span className="mk-paso-numero">{listo ? Ico.ok({ className: "h-3 w-3" }) : n}</span>
                      <span className="min-w-0">
                        {s.t}
                        <span className="mk-paso-sub">{s.sub}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="mk-panel mt-4 p-4">
            <div className="flex items-center justify-between">
              <span className="mk-hallazgo-tipo">Estado</span>
              <EstadoDeCampana estado={estadoVisible} />
            </div>
            <p className="mt-2 leading-snug" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
              {estadoVisible === "borrador" && "Le faltan cosas. Se puede guardar igual."}
              {estadoVisible === "lista" && "Tiene todo. Llévala a Meta con «Continuar en Meta»."}
              {estadoVisible === "requiere_meta" && "Tiene todo, pero la cuenta de Meta no está conectada: cuando corra no se verá su costo."}
              {estadoVisible === "requiere_permiso" && "Tiene todo. Se lleva a Meta con «Copiar configuración»."}
            </p>
            {/* Guardar vive SIEMPRE abajo a la derecha del paso, en un solo lugar.
                Acá queda únicamente lo que no es parte del avance: borrar. */}
            {/* Confirmación en dos pasos, igual que en el editor de
                creatividades: eliminar un borrador con todo el trabajo de ocho
                pasos no puede ser un clic suelto y sin vuelta atrás. */}
            {id &&
              (confirmarBorrar ? (
                <div className="mt-3 flex items-center gap-2">
                  <button type="button" className="btn-peligro flex-1" disabled={ocupado !== ""} onClick={eliminar}>
                    {ocupado === "eliminar" ? "Eliminando…" : "Sí, eliminar"}
                  </button>
                  <button type="button" className="btn-texto" onClick={() => setConfirmarBorrar(false)}>
                    No
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-texto mt-3 w-full"
                  style={{ color: "var(--peligro)" }}
                  disabled={ocupado !== ""}
                  onClick={() => setConfirmarBorrar(true)}
                >
                  Eliminar borrador
                </button>
              ))}
            {demo && (
              <p className="mt-2.5" style={{ fontSize: "11px", color: "var(--alerta)" }}>
                En demostración no se guarda.
              </p>
            )}
          </div>
        </div>
      </nav>

      {/* ── El paso ────────────────────────────────────────────────────── */}
      <div className="xl:col-span-5">
        <section className="mk-panel">
          <div className="mk-panel-cabecera">
            <h2 className="mk-h2">
              {paso}. {PASOS[paso - 1].t}
            </h2>
            <span className="mk-meta">
              Paso {paso} de {PASOS.length}
            </span>
          </div>
          <div className="mk-panel-cuerpo">
            {paso === 1 && (
              <>
                <p className="mb-5" style={{ fontSize: "13px", color: "var(--muted)" }}>
                  Todas las campañas llevan a WhatsApp. El objetivo cambia cómo se escribe el anuncio y qué se mide como éxito.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {OBJETIVOS.map((o) => (
                    <button key={o.clave} type="button" className="mk-opcion" aria-pressed={objetivo === o.clave} onClick={() => setObjetivo(o.clave)}>
                      <span className="font-semibold" style={{ fontSize: "13px" }}>
                        {o.texto}
                      </span>
                      <span style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>{o.ayuda}</span>
                    </button>
                  ))}
                </div>
                <label className="mt-6 block">
                  <span className="mk-campo-rotulo">Nombre de la campaña</span>
                  <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Pendones para ferias · Octubre" />
                  <span className="mk-ayuda">Solo lo ves tú y quien suba la campaña a Meta.</span>
                </label>
              </>
            )}

            {paso === 2 && (
              <>
                <p className="mb-5" style={{ fontSize: "13px", color: "var(--muted)" }}>
                  Una campaña, una oferta. Cuanto más concreta —producto, precio, plazo— mejor rinde.
                </p>
                <label className="block">
                  <span className="mk-campo-rotulo">Producto o servicio</span>
                  <input className="campo" value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="Ej: pendón roller 80×200" list="ofertas-campana" />
                  <datalist id="ofertas-campana">
                    {ofertas.map((o) => (
                      <option key={o.titulo} value={o.titulo} />
                    ))}
                  </datalist>
                </label>
                {ofertas.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {ofertas.slice(0, 6).map((o) => (
                      <button
                        key={o.titulo}
                        type="button"
                        className="btn-chico"
                        title={o.detalle}
                        onClick={() => {
                          setProducto(o.titulo);
                          setOferta(`${o.titulo}. ${o.detalle}`.slice(0, 300));
                        }}
                      >
                        {o.titulo}
                      </button>
                    ))}
                  </div>
                )}
                <label className="mt-5 block">
                  <span className="mk-campo-rotulo">Oferta</span>
                  <textarea className="campo" rows={4} value={oferta} onChange={(e) => setOferta(e.target.value)} placeholder="Ej: Pendón roller desde $34.990, listo en 24 horas, diseño incluido." />
                </label>
              </>
            )}

            {paso === 3 && (
              <>
                <p className="mb-5" style={{ fontSize: "13px", color: "var(--muted)" }}>
                  Lo mismo que Meta te va a pedir en el conjunto de anuncios. Empieza amplio: Meta encuentra sola a quien responde.
                </p>
                <label className="block">
                  <span className="mk-campo-rotulo">Ubicación</span>
                  <input className="campo" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Ej: Chillán y 30 km a la redonda" />
                </label>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className="mk-campo-rotulo">Edad desde</span>
                    <input className="campo cifra" type="number" min={18} max={65} value={edadDesde} onChange={(e) => setEdadDesde(e.target.value)} />
                  </label>
                  <label className="block">
                    <span className="mk-campo-rotulo">Edad hasta</span>
                    <input className="campo cifra" type="number" min={18} max={65} value={edadHasta} onChange={(e) => setEdadHasta(e.target.value)} />
                  </label>
                </div>
                <label className="mt-4 block">
                  <span className="mk-campo-rotulo">Intereses</span>
                  <input className="campo" value={intereses} onChange={(e) => setIntereses(e.target.value)} placeholder="Ej: emprendimiento, ferias, pequeñas empresas" />
                  <span className="mk-ayuda">Separados por coma. Dos o tres bastan.</span>
                </label>
                <label className="mt-4 block">
                  <span className="mk-campo-rotulo">Nota</span>
                  <input className="campo" value={notaAudiencia} onChange={(e) => setNotaAudiencia(e.target.value)} placeholder="Ej: excluir a quienes ya escribieron" />
                </label>
              </>
            )}

            {paso === 4 && (
              <>
                <p className="mb-5" style={{ fontSize: "13px", color: "var(--muted)" }}>
                  Un presupuesto diario chico y constante enseña más que uno grande de tres días.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mk-campo-rotulo">Diario (CLP)</span>
                    <input className="campo cifra" type="number" min={0} step={500} value={presupuestoDiario} onChange={(e) => setPresupuestoDiario(e.target.value)} placeholder="5000" />
                  </label>
                  <label className="block">
                    <span className="mk-campo-rotulo">Tope total (opcional)</span>
                    <input className="campo cifra" type="number" min={0} step={1000} value={presupuestoTotal} onChange={(e) => setPresupuestoTotal(e.target.value)} placeholder="150000" />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {[3000, 5000, 8000, 12000].map((v) => (
                    <button key={v} type="button" className="btn-chico" onClick={() => setPresupuestoDiario(String(v))}>
                      ${v.toLocaleString("es-CL")}
                    </button>
                  ))}
                </div>
                {presupuestoDiario && Number(presupuestoDiario) > 0 && (
                  <div className="mk-hundido mt-5 px-4 py-3.5">
                    <div className="cifra" style={{ fontSize: "20px", fontWeight: 600, letterSpacing: "-0.025em" }}>
                      ${(Number(presupuestoDiario) * 30).toLocaleString("es-CL")}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--muted-2)" }}>al mes si corre todos los días</div>
                  </div>
                )}
              </>
            )}

            {paso === 5 && (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <p style={{ fontSize: "13px", color: "var(--muted)" }}>Con dos o tres, Meta prueba cuál rinde mejor.</p>
                  <button
                    type="button"
                    className="btn-chico"
                    disabled={ocupado !== ""}
                    onClick={() => guardar((nuevoId) => router.push(`/marketing/creatividades/nueva?campana=${encodeURIComponent(nuevoId)}`))}
                  >
                    {Ico.nueva({ className: "h-3.5 w-3.5" })} Crear una nueva
                  </button>
                </div>
                {creatividades.length === 0 ? (
                  <div className="vacio">
                    <div className="vacio-titulo">No hay creatividades todavía</div>
                    <p className="vacio-texto">
                      Crea la primera con el estudio: Respondo escribe el anuncio con lo que sabe del negocio y genera la imagen. El
                      borrador se guarda antes de salir.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {creatividades.map((c) => {
                      const sel = creatividadIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className="mk-opcion p-2.5"
                          aria-pressed={sel}
                          onClick={() => setCreatividadIds((ids) => (sel ? ids.filter((x) => x !== c.id) : [...ids, c.id]))}
                        >
                          <span className="flex items-center gap-3">
                            <span className="mk-miniatura">
                              {c.imagenUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={urlDeImagen(c.imagenUrl) ?? ""} alt="" />
                              )}
                            </span>
                            <span className="min-w-0 flex-1 text-left">
                              <span className="block truncate font-semibold" style={{ fontSize: "13px" }}>
                                {c.nombre}
                              </span>
                              <span className="block truncate" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
                                {c.formato} · {c.titular}
                              </span>
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {paso === 6 && (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <p style={{ fontSize: "13px", color: "var(--muted)" }}>
                    Titular de {LIMITES.titular}, texto de {LIMITES.texto}.
                  </p>
                  <div className="flex gap-1.5">
                    {principal && (
                      <button
                        type="button"
                        className="btn-chico"
                        onClick={() => setCopies((cs) => [{ titular: principal.titular, texto: principal.texto, cta: principal.cta }, ...cs.filter((x) => x.titular || x.texto)].slice(0, 6))}
                      >
                        Usar el de la creatividad
                      </button>
                    )}
                    {/* Sin motor de IA no se ofrece: el botón terminaba en un
                        error que nombraba una variable de entorno. */}
                    {puedeGenerarConIa && (
                      <button type="button" className="btn-chico" disabled={ocupado !== ""} onClick={sugerirCopies}>
                        {ocupado === "copies" ? "Escribiendo…" : "Sugerir con IA"}
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  {copies.map((c, i) => (
                    <div key={i} className="mk-hundido p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="mk-hallazgo-tipo">Anuncio {i + 1}</span>
                        {copies.length > 1 && (
                          <button type="button" className="btn-texto" onClick={() => setCopies((cs) => cs.filter((_, j) => j !== i))}>
                            Quitar
                          </button>
                        )}
                      </div>
                      <label className="block">
                        <span className="mk-campo-rotulo" style={{ marginBottom: 3 }}>
                          Titular
                          <span className="cifra" style={{ fontSize: "11px", fontWeight: 500, color: c.titular.length > LIMITES.titular ? "var(--peligro)" : "var(--muted-3)" }}>
                            {c.titular.length}/{LIMITES.titular}
                          </span>
                        </span>
                        <input className="campo" value={c.titular} onChange={(e) => setCopies((cs) => cs.map((x, j) => (j === i ? { ...x, titular: e.target.value } : x)))} />
                      </label>
                      <label className="mt-3 block">
                        <span className="mk-campo-rotulo" style={{ marginBottom: 3 }}>
                          Texto
                          <span className="cifra" style={{ fontSize: "11px", fontWeight: 500, color: c.texto.length > LIMITES.texto ? "var(--peligro)" : "var(--muted-3)" }}>
                            {c.texto.length}/{LIMITES.texto}
                          </span>
                        </span>
                        <textarea className="campo" rows={3} value={c.texto} onChange={(e) => setCopies((cs) => cs.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} />
                      </label>
                      <label className="mt-3 block">
                        <span className="mk-campo-rotulo" style={{ marginBottom: 3 }}>Botón</span>
                        <select className="campo" value={c.cta} onChange={(e) => setCopies((cs) => cs.map((x, j) => (j === i ? { ...x, cta: e.target.value } : x)))}>
                          {CTAS_META.map((x) => (
                            <option key={x} value={x}>
                              {x}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ))}
                  {copies.length < 6 && (
                    <button type="button" className="btn-suave w-full" onClick={() => setCopies((cs) => [...cs, { titular: "", texto: "", cta: "Enviar mensaje" }])}>
                      Agregar otra versión
                    </button>
                  )}
                </div>
              </>
            )}

            {paso === 7 && (
              <>
                <p className="mb-5" style={{ fontSize: "13px", color: "var(--muted)" }}>
                  El botón del anuncio abre WhatsApp. Es lo que hace que Respondo pueda medir qué pasó después del clic.
                </p>
                <div className="mk-hundido flex items-center gap-3.5 p-4">
                  <span className="mk-integracion-logo whatsapp" style={{ width: 38, height: 38 }}>
                    {Ico.whatsapp({ className: "h-[18px] w-[18px]" })}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold" style={{ fontSize: "13.5px" }}>
                      WhatsApp de {negocio}
                    </div>
                    <div style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
                      {whatsapp ? `Número conectado: ${whatsapp}` : "WhatsApp todavía no está conectado; la campaña se puede armar igual."}
                    </div>
                  </div>
                </div>
                <label className="mt-5 block">
                  <span className="mk-campo-rotulo">Notas para quien la suba a Meta</span>
                  <textarea className="campo" rows={4} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: activar solo de lunes a viernes; excluir Instagram Reels." />
                </label>
                {!metaConectada && (
                  <p className="mk-ayuda mt-3">
                    Sin las cifras de tu cuenta publicitaria, cuando la campaña corra se verán sus conversaciones y ventas, pero no su
                    costo.{" "}
                    {/* El enlace solo si conectar es posible: en una instalación
                        sin la app de Meta este botón llevaba a una pantalla que
                        decía «no disponible». */}
                    {puedeConectarMeta && (
                      <Link href="/marketing/integraciones" className="mk-enlace">
                        Conectar la cuenta
                      </Link>
                    )}
                  </p>
                )}
              </>
            )}

            {paso === 8 && (
              <>
                {faltantes.length > 0 ? (
                  <div className="mb-5 rounded-lg border px-4 py-3.5" style={{ borderColor: "var(--alerta-borde)", background: "var(--alerta-suave)" }}>
                    <div className="font-semibold" style={{ fontSize: "12.5px" }}>
                      Falta para que esté lista:
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {faltantes.map((f) => (
                        <li key={f.texto}>
                          <button type="button" className="mk-enlace" onClick={() => setPaso(f.paso)}>
                            {f.texto} →
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mb-5" style={{ fontSize: "13px", color: "var(--muted)" }}>
                    Tiene todo. Guárdala y llévala a Meta.
                  </p>
                )}
                <dl className="grid gap-x-5 gap-y-3.5 sm:grid-cols-2" style={{ fontSize: "13px" }}>
                  <Fila t="Nombre" v={entrada().nombre || "—"} />
                  <Fila t="Objetivo" v={OBJETIVOS.find((o) => o.clave === objetivo)?.texto ?? objetivo} />
                  <Fila t="Oferta" v={oferta || "—"} />
                  <Fila t="Audiencia" v={`${ubicacion || "—"}${edadDesde ? ` · ${edadDesde}–${edadHasta}` : ""}${intereses ? ` · ${intereses}` : ""}`} />
                  <Fila
                    t="Presupuesto"
                    v={presupuestoDiario ? `$${Number(presupuestoDiario).toLocaleString("es-CL")} diarios${presupuestoTotal ? ` · tope $${Number(presupuestoTotal).toLocaleString("es-CL")}` : ""}` : "—"}
                  />
                  <Fila t="Creatividades" v={seleccionadas.length ? seleccionadas.map((c) => c.nombre).join(", ") : "—"} />
                  <Fila t="Copies" v={`${copies.filter((c) => c.titular && c.texto).length} completos`} />
                  <Fila t="Destino" v="WhatsApp" />
                </dl>

                <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--borde)" }}>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-suave mk-btn-lg" onClick={copiarConfiguracion}>
                      {Ico.copiar({ className: "h-4 w-4" })} {copiado ? "Copiado" : "Copiar configuración"}
                    </button>
                    <a href="https://www.facebook.com/adsmanager/creation" target="_blank" rel="noopener noreferrer" className="btn-primario mk-btn-lg">
                      {Ico.externo({ className: "h-4 w-4" })} Continuar en Meta
                    </a>
                  </div>
                  <div className="mt-5 rounded-lg border p-4" style={{ borderColor: "var(--borde)", background: "var(--fondo-2)" }}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold" style={{ fontSize: "13px" }}>
                        Publicación nativa en plataforma
                      </span>
                      <span className="mk-pildora uppercase" style={{ fontSize: "10.5px" }}>
                        Estado inicial: Pausada
                      </span>
                    </div>
                    <p className="mt-1" style={{ fontSize: "12px", color: "var(--muted-2)" }}>
                      Crea la campaña directamente en tu cuenta de Meta Ads o Google Ads. Se creará en estado <strong>PAUSADA</strong> para que no gaste hasta que la actives.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-primario mk-btn-lg"
                        onClick={() => abrirPublicar("meta")}
                        disabled={ocupado !== "" || (!puedePublicar && !demo)}
                      >
                        {Ico.nueva({ className: "h-4 w-4" })} Publicar en Meta Ads
                      </button>
                      <button
                        type="button"
                        className="btn-suave mk-btn-lg"
                        onClick={() => abrirPublicar("google")}
                        disabled={ocupado !== ""}
                      >
                        {Ico.nueva({ className: "h-4 w-4" })} Publicar en Google Ads
                      </button>
                    </div>
                  </div>
                  <details className="mt-4">
                    <summary className="cursor-pointer font-semibold" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
                      Ver la configuración en texto
                    </summary>
                    <pre className="mt-2 overflow-x-auto rounded-lg p-4" style={{ background: "var(--fondo-hundido)", fontSize: 11.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                      {borradorEnTexto({ ...entrada(), id: id ?? "", estado, creadoEn: "", actualizadoEn: "" })}
                    </pre>
                  </details>
                </div>
              </>
            )}

            {aviso && (
              <div
                className="mt-5 rounded-lg px-4 py-3"
                style={{ background: aviso.tono === "ok" ? "var(--ok-suave)" : "#fdf1ee", color: aviso.tono === "ok" ? "var(--ok)" : "var(--tinta)", fontSize: "13px" }}
              >
                {aviso.texto}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t px-5 py-3.5" style={{ borderColor: "var(--borde)" }}>
            <button type="button" className="btn-texto" disabled={paso === 1} onClick={() => setPaso((x) => Math.max(1, x - 1))}>
              ← Anterior
            </button>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-suave" disabled={ocupado !== ""} onClick={() => guardar()}>
                {ocupado === "guardar" ? "Guardando…" : id ? "Guardar cambios" : "Guardar borrador"}
              </button>
              {paso < 8 && (
                <button type="button" className="btn-primario mk-btn-lg" onClick={() => setPaso((x) => Math.min(8, x + 1))}>
                  Continuar →
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ── La vista previa ────────────────────────────────────────────── */}
      <aside className="xl:col-span-4">
        <div className="xl:sticky xl:top-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="mk-hallazgo-tipo">Cómo se va a ver</span>
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
          <div className="mk-lienzo" style={{ minHeight: 360, padding: 22 }}>
            <VistaPreviaAnuncio
              negocio={negocio}
              titular={copyPrincipal.titular}
              texto={copyPrincipal.texto}
              cta={copyPrincipal.cta}
              imagenUrl={principal?.imagenUrl ?? null}
              formato={formatoPrev}
              plataforma={principal?.plataforma ?? "instagram"}
              superficie={superficieReal}
              ancho={superficieReal === "historia" ? 260 : 330}
            />
          </div>
          {seleccionadas.length > 1 && (
            <p className="mt-2.5" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
              Se muestra la primera de {seleccionadas.length} creatividades.
            </p>
          )}
        </div>
      </aside>

      {modalPublicar && (
        <ModalPublicarCampana
          borradorId={id ?? ""}
          nombreBorrador={nombre || entrada().nombre}
          proveedorInicial={proveedorModal}
          abierto={modalPublicar}
          alCerrar={() => setModalPublicar(false)}
          alPublicarExitoso={(res) => {
            setEstado("publicada");
            setAviso({
              tono: "ok",
              texto: `Campaña publicada exitosamente en ${res.plataforma === "meta" ? "Meta Ads" : "Google Ads"} (Pausada). ID: ${res.campaignId}`,
            });
          }}
        />
      )}
    </div>
  );
}

function Fila({ t, v }: { t: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="mk-dato-mini-etiqueta">{t}</dt>
      <dd className="truncate font-medium" title={v}>
        {v}
      </dd>
    </div>
  );
}
