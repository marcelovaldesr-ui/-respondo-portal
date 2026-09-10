"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { eliminarBorradorAccion, guardarBorradorAccion, sugerirCopiesAccion } from "@/app/(marketing)/marketing/campanas/acciones";
import { borradorEnTexto, faltantesDeBorrador } from "@/lib/marketing/campanasCore";
import { CTAS_META, LIMITES } from "@/lib/marketing/creatividadesCore";
import { ESTADO_CAMPANA, OBJETIVOS, type BorradorCampana, type Creatividad, type EstadoCampana } from "@/lib/marketing/tipos";
import VistaPreviaAnuncio from "@/components/marketing/VistaPreviaAnuncio";
import { Ico } from "@/components/marketing/Iconos";

/**
 * EL ASISTENTE DE CAMPAÑAS — ocho pasos, un borrador, estados honestos.
 *
 * Arma todo lo que Meta te va a pedir: objetivo, oferta, audiencia,
 * presupuesto, creatividad, copy, destino y revisión. Se guarda como
 * borrador en cualquier momento. Al final NO hay un botón «Publicar» que
 * finja: hay «Copiar configuración» (para pegarla en el Administrador de
 * Anuncios) y «Continuar en Meta». El estado que se muestra lo calcula el
 * servidor con lo que la instalación puede hacer hoy.
 */

const PASOS = ["Objetivo", "Oferta", "Audiencia", "Presupuesto", "Creatividades", "Copy", "Destino", "Revisión"];

type Copy = { titular: string; texto: string; cta: string };

export default function AsistenteCampana({
  borrador,
  creatividades,
  negocio,
  ofertas,
  zona,
  whatsapp,
  metaConectada,
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
  const [ocupado, setOcupado] = useState<"" | "guardar" | "copies" | "eliminar">("");
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [, iniciar] = useTransition();

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

  const usarCopyDeCreatividad = (c: Creatividad) => setCopies((cs) => [{ titular: c.titular, texto: c.texto, cta: c.cta }, ...cs.filter((x) => x.titular || x.texto)].slice(0, 6));

  const copiarConfiguracion = async () => {
    const texto = borradorEnTexto({ ...entrada(), id: id ?? "", estado, creadoEn: "", actualizadoEn: "" });
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setAviso({ tono: "error", texto: "No se pudo copiar. Selecciona el texto de abajo y cópialo a mano." });
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

  // El estado que se muestra sigue lo que hay en pantalla, no lo último guardado:
  // si ya tiene todo, dice qué le impide publicarse (Meta o el permiso).
  const estadoVisible: EstadoCampana = faltantes.length
    ? "borrador"
    : estado === "borrador"
      ? metaConectada
        ? "requiere_permiso"
        : "requiere_meta"
      : estado;
  const est = ESTADO_CAMPANA[estadoVisible];
  const copyPrincipal = copies.find((c) => c.titular || c.texto) ?? { titular: principal?.titular ?? "", texto: principal?.texto ?? "", cta: principal?.cta ?? "Enviar mensaje" };

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {/* Pasos */}
      <nav className="lg:col-span-3" aria-label="Pasos">
        <div className="tarjeta p-2">
          <ol className="mk-pasos">
            {PASOS.map((t, i) => {
              const n = i + 1;
              const listo = !faltantes.some((f) => f.paso === n) && n !== 8;
              return (
                <li key={t}>
                  <button type="button" className={`mk-paso ${listo ? "listo" : ""}`} aria-current={paso === n ? "step" : undefined} onClick={() => setPaso(n)}>
                    <span className="mk-paso-numero">{listo ? Ico.ok({ className: "h-3 w-3" }) : n}</span>
                    {t}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="tarjeta mt-3 p-3">
          <div className="flex items-center justify-between">
            <span className="eyebrow">Estado</span>
            <span className={est.clase}>{est.texto}</span>
          </div>
          <p className="mt-1.5 leading-snug" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
            {estadoVisible === "borrador" && "Le faltan cosas. Se puede guardar igual."}
            {estadoVisible === "lista" && "Tiene todo. Llévala a Meta con «Continuar en Meta»."}
            {estadoVisible === "requiere_meta" && "Tiene todo, pero la cuenta de Meta no está conectada: cuando corra no se verá su costo."}
            {estadoVisible === "requiere_permiso" && "Tiene todo. Publicar desde Respondo requiere un permiso de Meta que no está habilitado; se lleva a mano con «Continuar en Meta»."}
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            <button type="button" className="btn-suave w-full" disabled={ocupado !== ""} onClick={() => guardar()}>
              {ocupado === "guardar" ? "Guardando…" : id ? "Guardar cambios" : "Guardar borrador"}
            </button>
            {id && (
              <button type="button" className="btn-texto w-full" style={{ color: "var(--peligro)" }} disabled={ocupado !== ""} onClick={eliminar}>
                Eliminar borrador
              </button>
            )}
          </div>
          {demo && <p className="mt-2" style={{ fontSize: "var(--t-micro)", color: "var(--alerta)" }}>En demostración no se guarda.</p>}
        </div>
      </nav>

      {/* Contenido del paso */}
      <div className="lg:col-span-6">
        <section className="tarjeta p-5">
          {paso === 1 && (
            <>
              <h2 className="h-seccion">¿Qué quieres lograr?</h2>
              <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>Todas las campañas llevan a WhatsApp. El objetivo cambia cómo se escribe el anuncio y qué se mide como éxito.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {OBJETIVOS.map((o) => (
                  <button key={o.clave} type="button" className="mk-opcion" aria-pressed={objetivo === o.clave} onClick={() => setObjetivo(o.clave)}>
                    <span className="font-semibold" style={{ fontSize: "var(--t-fila)" }}>{o.texto}</span>
                    <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{o.ayuda}</span>
                  </button>
                ))}
              </div>
              <label className="mt-5 block">
                <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Nombre de la campaña</span>
                <input className="campo mt-1" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Pendones para ferias · Octubre" />
              </label>
            </>
          )}

          {paso === 2 && (
            <>
              <h2 className="h-seccion">¿Qué vas a ofrecer?</h2>
              <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>Una campaña, una oferta. Cuanto más concreta (producto, precio, plazo), mejor rinde.</p>
              <div className="mt-4 grid gap-3">
                <label className="block">
                  <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Producto o servicio</span>
                  <input className="campo mt-1" value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="Ej: pendón roller 80×200" list="ofertas-campana" />
                  <datalist id="ofertas-campana">{ofertas.map((o) => <option key={o.titulo} value={o.titulo} />)}</datalist>
                </label>
                <label className="block">
                  <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Oferta</span>
                  <textarea className="campo mt-1" rows={3} value={oferta} onChange={(e) => setOferta(e.target.value)} placeholder="Ej: Pendón roller desde $34.990, listo en 24 horas, diseño incluido." />
                </label>
              </div>
              {ofertas.length > 0 && (
                <div className="mt-3">
                  <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>Lo que Respondo sabe que vendes:</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ofertas.slice(0, 8).map((o) => (
                      <button key={o.titulo} type="button" className="btn-chico" title={o.detalle} onClick={() => { setProducto(o.titulo); setOferta(`${o.titulo}. ${o.detalle}`.slice(0, 300)); }}>
                        {o.titulo}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {paso === 3 && (
            <>
              <h2 className="h-seccion">¿A quién?</h2>
              <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>Lo mismo que Meta te va a pedir en el conjunto de anuncios. Empieza amplio: Meta encuentra sola a quien responde.</p>
              <div className="mt-4 grid gap-3">
                <label className="block">
                  <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Ubicación</span>
                  <input className="campo mt-1" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Ej: Chillán y 30 km a la redonda" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Edad desde</span>
                    <input className="campo cifra mt-1" type="number" min={18} max={65} value={edadDesde} onChange={(e) => setEdadDesde(e.target.value)} />
                  </label>
                  <label className="block">
                    <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Edad hasta</span>
                    <input className="campo cifra mt-1" type="number" min={18} max={65} value={edadHasta} onChange={(e) => setEdadHasta(e.target.value)} />
                  </label>
                </div>
                <label className="block">
                  <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Intereses (separados por coma)</span>
                  <input className="campo mt-1" value={intereses} onChange={(e) => setIntereses(e.target.value)} placeholder="Ej: emprendimiento, ferias, pequeñas empresas" />
                </label>
                <label className="block">
                  <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Nota</span>
                  <input className="campo mt-1" value={notaAudiencia} onChange={(e) => setNotaAudiencia(e.target.value)} placeholder="Ej: excluir a quienes ya escribieron" />
                </label>
              </div>
            </>
          )}

          {paso === 4 && (
            <>
              <h2 className="h-seccion">¿Cuánto?</h2>
              <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>Un presupuesto diario chico y constante enseña más que uno grande de tres días. Entre $2.000 y $10.000 diarios es un buen punto de partida para una pyme.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Diario (CLP)</span>
                  <input className="campo cifra mt-1" type="number" min={0} step={500} value={presupuestoDiario} onChange={(e) => setPresupuestoDiario(e.target.value)} placeholder="5000" />
                </label>
                <label className="block">
                  <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Tope total (opcional)</span>
                  <input className="campo cifra mt-1" type="number" min={0} step={1000} value={presupuestoTotal} onChange={(e) => setPresupuestoTotal(e.target.value)} placeholder="150000" />
                </label>
              </div>
              {presupuestoDiario && Number(presupuestoDiario) > 0 && (
                <p className="mt-3" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                  Son <strong className="cifra">${(Number(presupuestoDiario) * 30).toLocaleString("es-CL")}</strong> al mes si corre todos los días.
                </p>
              )}
            </>
          )}

          {paso === 5 && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="h-seccion">Creatividades</h2>
                <button type="button" className="btn-chico" disabled={ocupado !== ""} onClick={() => guardar((nuevoId) => router.push(`/marketing/creatividades/nueva?campana=${encodeURIComponent(nuevoId)}`))}>
                  {Ico.nueva()} Crear una nueva
                </button>
              </div>
              <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>Elige una o más del estudio. Con dos o tres, Meta prueba cuál rinde mejor.</p>
              {creatividades.length === 0 ? (
                <div className="vacio mt-2">
                  <div className="vacio-titulo">No hay creatividades todavía</div>
                  <p className="vacio-texto">Crea la primera con el estudio: escribe el anuncio con lo que Respondo sabe del negocio y genera la imagen. El borrador se guarda antes de salir.</p>
                </div>
              ) : (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {creatividades.map((c) => {
                    const sel = creatividadIds.includes(c.id);
                    return (
                      <button key={c.id} type="button" className="mk-opcion p-2" aria-pressed={sel} onClick={() => setCreatividadIds((ids) => (sel ? ids.filter((x) => x !== c.id) : [...ids, c.id]))}>
                        <span className="flex items-center gap-2.5">
                          <span className="h-12 w-12 shrink-0 overflow-hidden rounded" style={{ background: "var(--fondo-hundido)" }}>
                            {c.imagenUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={c.imagenUrl} alt="" className="h-full w-full object-cover" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold" style={{ fontSize: "var(--t-menor)" }}>{c.nombre}</span>
                            <span className="block truncate" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{c.formato} · {c.titular}</span>
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
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="h-seccion">Copy</h2>
                <div className="flex gap-1.5">
                  {principal && <button type="button" className="btn-chico" onClick={() => usarCopyDeCreatividad(principal)}>Usar el de la creatividad</button>}
                  <button type="button" className="btn-chico" disabled={ocupado !== ""} onClick={sugerirCopies}>{ocupado === "copies" ? "Escribiendo…" : "Sugerir con Respondo"}</button>
                </div>
              </div>
              <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>Hasta seis versiones. Titular de {LIMITES.titular} caracteres, texto de {LIMITES.texto}.</p>
              <div className="mt-4 space-y-3">
                {copies.map((c, i) => (
                  <div key={i} className="rounded-md border p-3" style={{ borderColor: "var(--borde)" }}>
                    <div className="flex items-center justify-between">
                      <span className="eyebrow">Anuncio {i + 1}</span>
                      {copies.length > 1 && <button type="button" className="btn-texto" onClick={() => setCopies((cs) => cs.filter((_, j) => j !== i))}>Quitar</button>}
                    </div>
                    <label className="mt-2 block">
                      <span className="flex justify-between" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}><span>Titular</span><span className="cifra" style={{ color: c.titular.length > LIMITES.titular ? "var(--peligro)" : undefined }}>{c.titular.length}/{LIMITES.titular}</span></span>
                      <input className="campo mt-0.5" value={c.titular} onChange={(e) => setCopies((cs) => cs.map((x, j) => (j === i ? { ...x, titular: e.target.value } : x)))} />
                    </label>
                    <label className="mt-2 block">
                      <span className="flex justify-between" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}><span>Texto</span><span className="cifra" style={{ color: c.texto.length > LIMITES.texto ? "var(--peligro)" : undefined }}>{c.texto.length}/{LIMITES.texto}</span></span>
                      <textarea className="campo mt-0.5" rows={3} value={c.texto} onChange={(e) => setCopies((cs) => cs.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} />
                    </label>
                    <label className="mt-2 block">
                      <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>Botón</span>
                      <select className="campo mt-0.5" value={c.cta} onChange={(e) => setCopies((cs) => cs.map((x, j) => (j === i ? { ...x, cta: e.target.value } : x)))}>
                        {CTAS_META.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </label>
                  </div>
                ))}
                {copies.length < 6 && (
                  <button type="button" className="btn-suave" onClick={() => setCopies((cs) => [...cs, { titular: "", texto: "", cta: "Enviar mensaje" }])}>Agregar otra versión</button>
                )}
              </div>
            </>
          )}

          {paso === 7 && (
            <>
              <h2 className="h-seccion">Destino</h2>
              <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>El botón del anuncio abre WhatsApp. Es lo que hace que Respondo pueda medir qué pasó después del clic.</p>
              <div className="tarjeta-plana mt-4 flex items-center gap-3 p-3">
                <span className="grid h-9 w-9 place-items-center rounded-md" style={{ background: "var(--ok-suave)", color: "var(--ok)" }}>{Ico.whatsapp()}</span>
                <div>
                  <div className="font-semibold" style={{ fontSize: "var(--t-fila)" }}>WhatsApp de {negocio}</div>
                  <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{whatsapp ? `Número conectado: ${whatsapp}` : "WhatsApp todavía no está conectado en Respondo; la campaña se puede armar igual."}</div>
                </div>
              </div>
              <label className="mt-4 block">
                <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Notas para quien la suba a Meta</span>
                <textarea className="campo mt-1" rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: activar solo de lunes a viernes; excluir Instagram Reels." />
              </label>
              {!metaConectada && (
                <p className="mt-3" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
                  Sin la cuenta de Meta conectada, cuando la campaña corra se verán sus conversaciones y ventas, pero no su costo.{" "}
                  <Link href="/marketing/integraciones" className="font-semibold" style={{ color: "var(--indigo)" }}>Conectar Meta</Link>
                </p>
              )}
            </>
          )}

          {paso === 8 && (
            <>
              <h2 className="h-seccion">Revisión</h2>
              {faltantes.length > 0 ? (
                <div className="mt-3 rounded-md border p-3" style={{ borderColor: "var(--alerta-borde)", background: "var(--alerta-suave)" }}>
                  <div className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Falta para que esté lista:</div>
                  <ul className="mt-1 space-y-0.5">
                    {faltantes.map((f) => (
                      <li key={f.texto}>
                        <button type="button" className="font-semibold" style={{ fontSize: "var(--t-menor)", color: "var(--indigo)" }} onClick={() => setPaso(f.paso)}>{f.texto} →</button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>Tiene todo. Guárdala y llévala a Meta.</p>
              )}
              <dl className="mt-4 grid gap-x-4 gap-y-2 sm:grid-cols-2" style={{ fontSize: "var(--t-menor)" }}>
                <Fila t="Nombre" v={entrada().nombre || "—"} />
                <Fila t="Objetivo" v={OBJETIVOS.find((o) => o.clave === objetivo)?.texto ?? objetivo} />
                <Fila t="Oferta" v={oferta || "—"} />
                <Fila t="Audiencia" v={`${ubicacion || "—"}${edadDesde ? ` · ${edadDesde}–${edadHasta}` : ""}${intereses ? ` · ${intereses}` : ""}`} />
                <Fila t="Presupuesto" v={presupuestoDiario ? `$${Number(presupuestoDiario).toLocaleString("es-CL")} diarios${presupuestoTotal ? ` · tope $${Number(presupuestoTotal).toLocaleString("es-CL")}` : ""}` : "—"} />
                <Fila t="Creatividades" v={seleccionadas.length ? seleccionadas.map((c) => c.nombre).join(", ") : "—"} />
                <Fila t="Copies" v={`${copies.filter((c) => c.titular && c.texto).length} completos`} />
                <Fila t="Destino" v="WhatsApp" />
              </dl>

              <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--borde)" }}>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primario" disabled={ocupado !== ""} onClick={() => guardar()}>{ocupado === "guardar" ? "Guardando…" : id ? "Guardar cambios" : "Guardar borrador"}</button>
                  <button type="button" className="btn-suave" onClick={copiarConfiguracion}>{Ico.copiar()} {copiado ? "Copiado" : "Copiar configuración"}</button>
                  <a href="https://www.facebook.com/adsmanager/creation" target="_blank" rel="noopener noreferrer" className="btn-suave">
                    {Ico.externo()} Continuar en Meta
                  </a>
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-md border px-3 py-2" style={{ borderColor: "var(--borde)", background: "var(--fondo-fila)", fontSize: "var(--t-micro)", color: "var(--muted)" }}>
                  <span className="btn-chico shrink-0" aria-disabled="true" style={{ opacity: 0.5 }}>Publicar desde Respondo</span>
                  <span>No disponible: requiere el permiso <code>ads_management</code> y la revisión de la aplicación en Meta. Nunca vas a ver «Publicada» acá sin que lo esté de verdad.</span>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>Ver la configuración en texto</summary>
                  <pre className="mt-2 overflow-x-auto rounded-md p-3" style={{ background: "var(--fondo-hundido)", fontSize: 11.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {borradorEnTexto({ ...entrada(), id: id ?? "", estado, creadoEn: "", actualizadoEn: "" })}
                  </pre>
                </details>
              </div>
            </>
          )}

          {aviso && (
            <div className="mt-4 rounded-md px-3 py-2" style={{ background: aviso.tono === "ok" ? "var(--ok-suave)" : "var(--alerta-suave)", color: aviso.tono === "ok" ? "var(--ok)" : "var(--tinta)", fontSize: "var(--t-menor)" }}>
              {aviso.texto}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between border-t pt-4" style={{ borderColor: "var(--borde)" }}>
            <button type="button" className="btn-texto" disabled={paso === 1} onClick={() => setPaso((p) => Math.max(1, p - 1))}>← Anterior</button>
            {paso < 8 ? (
              <button type="button" className="btn-primario" onClick={() => setPaso((p) => Math.min(8, p + 1))}>Siguiente →</button>
            ) : (
              <Link href="/marketing/campanas" className="btn-texto">Volver a campañas</Link>
            )}
          </div>
        </section>
      </div>

      {/* Vista previa */}
      <aside className="lg:col-span-3">
        <div className="lg:sticky lg:top-4">
          <div className="eyebrow mb-2">Vista previa</div>
          <div className="tarjeta-plana flex justify-center p-3" style={{ background: "var(--fondo-hundido)" }}>
            <VistaPreviaAnuncio negocio={negocio} titular={copyPrincipal.titular} texto={copyPrincipal.texto} cta={copyPrincipal.cta} imagenUrl={principal?.imagenUrl ?? null} formato={principal?.formato ?? "1:1"} plataforma={principal?.plataforma ?? "instagram"} ancho={260} />
          </div>
          {seleccionadas.length > 1 && <p className="mt-2" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>Se muestra la primera de {seleccionadas.length} creatividades.</p>}
        </div>
      </aside>
    </div>
  );
}

function Fila({ t, v }: { t: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{t}</dt>
      <dd className="truncate font-medium" title={v}>{v}</dd>
    </div>
  );
}
