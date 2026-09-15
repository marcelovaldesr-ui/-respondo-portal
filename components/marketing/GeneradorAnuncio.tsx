"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  generarCopyAccion,
  generarImagenDirigidaAccion,
  guardarCreatividadAccion,
  piezasExistentesAccion,
  subirDisenoAccion,
} from "@/app/(marketing)/marketing/creatividades/acciones";
import { LIMITES } from "@/lib/marketing/creatividadesCore";
import { ctasPara, type Angulo, type DireccionVisual, type PaqueteMeta, type Variante } from "@/lib/marketing/copyCore";
import type { Completitud, ContextoComercial } from "@/lib/marketing/contextoComercialCore";
import type { PlantillaCreativa } from "@/lib/marketing/plantillasCreativas";
import { OBJETIVOS, type FormatoCreatividad, type OrigenCreatividad, type PlataformaCreatividad } from "@/lib/marketing/tipos";
import VistaPreviaAnuncio from "@/components/marketing/VistaPreviaAnuncio";
import ContextoUsado from "@/components/marketing/ContextoUsado";
import { Ico } from "@/components/marketing/Iconos";

/**
 * EL ESTUDIO — de un brief a un anuncio que es de ESTE negocio.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LO QUE CAMBIÓ, Y POR QUÉ NO ES COSMÉTICO
 *
 * 1. Los chips de «Producto o servicio» ya no son títulos de fichas. Antes
 *    salían de una expresión regular sobre el nombre de la carpeta del
 *    conocimiento, y por eso el primero que ofrecía era «Cupos y qué cuenta
 *    como una conversación». Ahora salen de lo que el negocio VENDE.
 *
 * 2. Hacer clic en un chip ya NO rellena la oferta con los primeros 90
 *    caracteres del cuerpo de la ficha. Una oferta es una propuesta —una
 *    prueba, un precio, un plazo—, no el primer párrafo de un reglamento.
 *
 * 3. Cada paso se puede hacer con IA **o a mano**. Una empresa con equipo de
 *    diseño no puede estar obligada a usar el generador de imágenes, y quien
 *    sabe escribir no tiene por qué pedirle permiso a un modelo.
 *
 * 4. Se puede ver y corregir lo que Respondo entiende del negocio. Un contexto
 *    equivocado produce un anuncio equivocado en silencio; mostrarlo es lo que
 *    convierte un error invisible en un error de un minuto.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FORMATOS: { clave: FormatoCreatividad; texto: string; ayuda: string }[] = [
  { clave: "1:1", texto: "Cuadrado", ayuda: "Feed de Facebook e Instagram" },
  { clave: "4:5", texto: "Vertical", ayuda: "Feed de Instagram, ocupa más pantalla" },
  { clave: "9:16", texto: "Historia", ayuda: "Historias y reels" },
  { clave: "16:9", texto: "Horizontal", ayuda: "Feed de Facebook, enlaces" },
];

const PLATAFORMAS: { clave: PlataformaCreatividad; texto: string }[] = [
  { clave: "ambas", texto: "Facebook e Instagram" },
  { clave: "instagram", texto: "Solo Instagram" },
  { clave: "facebook", texto: "Solo Facebook" },
];

/** A dónde llega la persona que aprieta el botón. Decide el CTA y el texto. */
const DESTINOS: { clave: string; texto: string; ayuda: string }[] = [
  { clave: "WhatsApp del negocio", texto: "WhatsApp", ayuda: "La conversación empieza en WhatsApp" },
  { clave: "el formulario de contacto del sitio", texto: "Formulario", ayuda: "Deja sus datos en el sitio" },
  { clave: "el sitio web", texto: "Sitio web", ayuda: "Llega a una página" },
  { clave: "una hora agendada", texto: "Agendar", ayuda: "Reserva una hora o una llamada" },
];

/** Los retoques que se pueden pedir. Nunca se aplican solos. */
const RETOQUES: { clave: string; texto: string; instruccion: string }[] = [
  { clave: "acortar", texto: "Acortar", instruccion: "Escribe el texto principal en la mitad de palabras, sin perder lo concreto." },
  { clave: "concreto", texto: "Más concreto", instruccion: "Reemplaza cada frase general por un dato concreto del negocio." },
  { clave: "suave", texto: "Tono más suave", instruccion: "Baja la intensidad: menos imperativos, más descripción." },
  { clave: "directo", texto: "Tono más directo", instruccion: "Sube la franqueza: frases cortas, sin rodeos." },
  { clave: "angulo", texto: "Otro ángulo", instruccion: "Parte de un ángulo distinto al que usaste: otra situación y otra necesidad." },
];

export type BaseVariacion = {
  id: string;
  nombre: string;
  objetivo: string;
  producto: string;
  oferta: string;
  plataforma: PlataformaCreatividad;
  formato: FormatoCreatividad;
  concepto: string;
  gancho: string;
  titular: string;
  texto: string;
  cta: string;
  imagenPrompt: string | null;
};

type Pieza = { id: string; nombre: string; puntero: string; url: string };

export default function GeneradorAnuncio({
  negocio,
  contexto,
  completitud,
  contextoEditado = false,
  demo,
  campanaId,
  campanaNombre,
  base,
  plantilla,
}: {
  negocio: string;
  contexto: ContextoComercial;
  completitud: Completitud;
  /** El contexto tiene correcciones humanas: habilita la reconstrucción. */
  contextoEditado?: boolean;
  demo: boolean;
  campanaId?: string | null;
  campanaNombre?: string | null;
  base?: BaseVariacion | null;
  plantilla?: PlantillaCreativa | null;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<1 | 2 | 3>(1);

  const [objetivo, setObjetivo] = useState(base?.objetivo ?? plantilla?.objetivo ?? "conversaciones");
  const [producto, setProducto] = useState(base?.producto ?? "");
  const [oferta, setOferta] = useState(base?.oferta ?? "");
  const [destino, setDestino] = useState(DESTINOS[0].clave);
  const [plataforma, setPlataforma] = useState<PlataformaCreatividad>(base?.plataforma ?? plantilla?.plataforma ?? "ambas");
  const [formato, setFormato] = useState<FormatoCreatividad>(base?.formato ?? plantilla?.formato ?? "1:1");
  const [indicaciones, setIndicaciones] = useState(plantilla?.indicaciones ?? "");

  const [paquete, setPaquete] = useState<PaqueteMeta | null>(null);
  const [defectos, setDefectos] = useState<{ texto: string; grave: boolean }[]>([]);
  const [nombre, setNombre] = useState("");
  const [concepto, setConcepto] = useState("");
  const [gancho, setGancho] = useState("");
  const [titular, setTitular] = useState("");
  const [texto, setTexto] = useState("");
  const [cta, setCta] = useState<string>(ctasPara(DESTINOS[0].clave)[0]);
  const [anguloActual, setAnguloActual] = useState<Angulo>("problema");
  const [textoManual, setTextoManual] = useState(false);

  const [direccion, setDireccion] = useState<DireccionVisual | null>(null);
  const [direccionTexto, setDireccionTexto] = useState("");
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [imagenEsDemo, setImagenEsDemo] = useState(false);
  const [origen, setOrigen] = useState<OrigenCreatividad>("generada");
  const [avisoImagen, setAvisoImagen] = useState<string | null>(null);
  const [fuenteImagen, setFuenteImagen] = useState<"generar" | "subir" | "existente">("generar");
  const [piezas, setPiezas] = useState<Pieza[] | null>(null);

  const [ocupado, setOcupado] = useState<"" | "texto" | "imagen" | "subir" | "guardar">("");
  const [error, setError] = useState<string | null>(null);
  const [, iniciar] = useTransition();
  const archivoRef = useRef<HTMLInputElement>(null);

  const ctasPosibles = ctasPara(destino);

  const aplicarVariante = (v: Variante) => {
    setGancho(v.gancho);
    setTitular(v.titular);
    setTexto(v.texto);
    setCta(v.cta);
    setAnguloActual(v.angulo);
  };

  const escribir = (instruccionExtra?: string) => {
    setError(null);
    setOcupado("texto");
    iniciar(async () => {
      const r = await generarCopyAccion({
        objetivo,
        producto,
        oferta,
        destino,
        plataforma: "meta",
        formato,
        indicaciones: [indicaciones, instruccionExtra].filter(Boolean).join(". "),
      });
      setOcupado("");
      if (!r.ok) {
        // Cuando lo que falta es contexto, la pantalla lo PIDE en vez de
        // generar algo inventado. Es el caso que produjo el anuncio malo.
        setError(r.faltaContexto ? `${r.motivo} ${r.faltaContexto}` : r.motivo);
        return;
      }
      if (r.paquete.plataforma !== "meta") return;
      const pk = r.paquete;
      setPaquete(pk);
      setDefectos(r.revision.defectos.map((d) => ({ texto: d.texto, grave: d.grave })));
      setNombre(pk.nombre);
      setConcepto(pk.concepto);
      aplicarVariante(pk.principal);
      setDireccion(pk.direccionVisual);
      setTextoManual(false);
      setPaso(2);
    });
  };

  /** Escribir a mano: se salta el modelo y deja los campos en blanco. */
  const escribirYo = () => {
    setPaquete(null);
    setDefectos([]);
    setConcepto("");
    setGancho("");
    setTitular("");
    setTexto("");
    setNombre("");
    setCta(ctasPosibles[0]);
    setTextoManual(true);
    setPaso(2);
  };

  const generarImagen = () => {
    setError(null);
    setAvisoImagen(null);
    setOcupado("imagen");
    iniciar(async () => {
      const r = await generarImagenDirigidaAccion(direccion, anguloActual, formato, producto);
      setOcupado("");
      if (!r.ok) return setError(r.motivo);
      setImagenUrl(r.url);
      setImagenEsDemo(r.demo);
      setDireccionTexto(r.enPalabras);
      setOrigen("generada");
    });
  };

  const subirDiseno = (archivo: File) => {
    setError(null);
    setAvisoImagen(null);
    setOcupado("subir");
    iniciar(async () => {
      const datos = new FormData();
      datos.set("archivo", archivo);
      datos.set("formato", formato);
      // El aviso de recorte tiene que nombrar la plataforma correcta: Google no
      // recorta como Meta, y la persona ya la eligió más arriba.
      datos.set("plataforma", plataforma);
      const r = await subirDisenoAccion(datos);
      setOcupado("");
      if (!r.ok) return setError(r.motivo);
      setImagenUrl(r.url);
      setImagenEsDemo(false);
      setOrigen("subida");
      setAvisoImagen(r.aviso);
    });
  };

  const cargarPiezas = () => {
    setFuenteImagen("existente");
    if (piezas) return;
    iniciar(async () => {
      const r = await piezasExistentesAccion();
      setPiezas(r.map((p) => ({ id: p.id, nombre: p.nombre, puntero: p.puntero, url: p.url })));
    });
  };

  const guardar = (estado: "borrador" | "lista") => {
    setError(null);
    setOcupado("guardar");
    iniciar(async () => {
      const r = await guardarCreatividadAccion({
        nombre: nombre || titular,
        objetivo,
        producto,
        oferta,
        plataforma,
        formato,
        concepto,
        gancho,
        titular,
        texto,
        cta,
        imagenUrl: imagenEsDemo ? null : imagenUrl,
        imagenPrompt: direccionTexto || null,
        estado,
        campanaId: campanaId ?? null,
        varianteDe: base?.id ?? null,
        origen,
        textoManual,
        estrategia: paquete ? { ...paquete.estrategia, defectos } : null,
      });
      setOcupado("");
      if (!r.ok) return setError(r.motivo);
      router.push(`/marketing/creatividades/${encodeURIComponent(r.id)}?nueva=1`);
    });
  };

  const esHistoria = formato === "9:16";
  const hayTexto = Boolean(titular.trim() && texto.trim());
  const PASOS = [
    { n: 1 as const, t: "Brief", sub: "Qué anunciar" },
    { n: 2 as const, t: "Texto", sub: "Lo que dice" },
    { n: 3 as const, t: "Imagen", sub: "Cómo se ve" },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-12">
      {/* ── Controles ──────────────────────────────────────────────────── */}
      <div className="xl:col-span-5">
        <div className="mk-panel">
          <div className="mk-panel-cabecera" style={{ padding: "10px 12px" }}>
            <div className="mk-segmentos w-full" role="tablist" aria-label="Pasos">
              {PASOS.map((s) => (
                <button
                  key={s.n}
                  type="button"
                  role="tab"
                  className="mk-segmento flex-1"
                  aria-selected={paso === s.n}
                  disabled={s.n === 3 && !hayTexto}
                  onClick={() => setPaso(s.n)}
                >
                  {s.n}. {s.t}
                </button>
              ))}
            </div>
          </div>

          <div className="mk-panel-cuerpo">
            {campanaNombre && (
              <div className="mk-hundido mb-5 px-4 py-3" style={{ fontSize: "12.5px" }}>
                Va a quedar asociada a la campaña <strong>{campanaNombre}</strong>.
              </div>
            )}
            {base && (
              <div className="mk-hundido mb-5 px-4 py-3" style={{ fontSize: "12.5px" }}>
                Variación de <strong>{base.nombre}</strong>. Se parte de otro ángulo, no se repite el mismo.
              </div>
            )}

            {paso === 1 && (
              <>
                {plantilla && (
                  <div
                    className="mb-5 flex items-start gap-3 rounded-lg border px-4 py-3"
                    style={{ borderColor: "var(--indigo-borde)", background: "var(--indigo-suave)" }}
                  >
                    <span className="mk-arranque-icono" style={{ width: 30, height: 30 }}>
                      {Ico[plantilla.icono]({ className: "h-4 w-4" })}
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold" style={{ fontSize: "13px" }}>
                        {plantilla.titulo}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--muted)" }}>Objetivo, formato e indicaciones ya cargados. Cámbialos si quieres.</div>
                    </div>
                  </div>
                )}

                <ContextoUsado contexto={contexto} completitud={completitud} demo={demo} editado={contextoEditado} />

                <div className="mk-campo-rotulo mt-6">¿Qué quieres lograr?</div>
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

                <div className="mt-6">
                  <label className="block">
                    <span className="mk-campo-rotulo">Producto o servicio</span>
                    <input
                      className="campo"
                      value={producto}
                      onChange={(e) => setProducto(e.target.value)}
                      placeholder={contexto.vende[0]?.nombre ? `Ej: ${contexto.vende[0].nombre}` : "Escribe qué quieres promocionar"}
                      list="lo-que-vende"
                    />
                    <datalist id="lo-que-vende">
                      {contexto.vende.map((v) => (
                        <option key={v.nombre} value={v.nombre} />
                      ))}
                    </datalist>
                  </label>

                  {contexto.vende.length > 0 ? (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {contexto.vende.slice(0, 8).map((v) => (
                        <button
                          key={v.nombre}
                          type="button"
                          className="btn-chico"
                          title={[v.detalle, v.precio].filter(Boolean).join(" · ")}
                          /* ⚠️ NO toca la oferta. Antes copiaba acá los primeros
                             90 caracteres del cuerpo de la ficha, y con la ficha
                             de cupos eso escribía el reglamento del plan en el
                             campo «oferta». */
                          onClick={() => setProducto(v.nombre)}
                        >
                          {v.nombre}
                          {v.precio && <span style={{ color: "var(--muted-3)" }}> · {v.precio}</span>}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mk-ayuda mt-2">
                      Todavía no sé qué vende este negocio, así que no te propongo nada: escríbelo tú y lo uso tal cual.
                    </p>
                  )}
                </div>

                <label className="mt-5 block">
                  <span className="mk-campo-rotulo">Oferta (opcional)</span>
                  <input
                    className="campo"
                    value={oferta}
                    onChange={(e) => setOferta(e.target.value)}
                    placeholder="Sin oferta específica"
                  />
                  <span className="mk-ayuda">
                    Una oferta es una propuesta concreta: una prueba, un descuento, un plazo, un pack. Si no hay ninguna, déjalo
                    vacío — el anuncio se puede escribir igual y no se va a inventar una.
                  </span>
                  {contexto.ofertas.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {contexto.ofertas.slice(0, 3).map((o) => (
                        <button key={o.texto} type="button" className="btn-chico" onClick={() => setOferta(o.texto.slice(0, 120))}>
                          {o.texto.slice(0, 48)}
                          {o.texto.length > 48 ? "…" : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </label>

                <div className="mt-5">
                  <div className="mk-campo-rotulo">¿A dónde llega la persona?</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {DESTINOS.map((d) => (
                      <button
                        key={d.clave}
                        type="button"
                        className="mk-opcion py-2.5"
                        aria-pressed={destino === d.clave}
                        onClick={() => {
                          setDestino(d.clave);
                          setCta(ctasPara(d.clave)[0]);
                        }}
                      >
                        <span style={{ fontSize: "12.5px", fontWeight: 600 }}>{d.texto}</span>
                        <span style={{ fontSize: "11px", color: "var(--muted-2)" }}>{d.ayuda}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <div>
                    <div className="mk-campo-rotulo">Formato</div>
                    <div className="flex flex-col gap-1.5">
                      {FORMATOS.map((f) => (
                        <button key={f.clave} type="button" className="mk-opcion py-2.5" aria-pressed={formato === f.clave} onClick={() => setFormato(f.clave)}>
                          <span className="flex items-center gap-2.5" style={{ fontSize: "12.5px", fontWeight: 600 }}>
                            <Proporcion formato={f.clave} /> {f.texto} <span style={{ color: "var(--muted-3)", fontWeight: 500 }}>{f.clave}</span>
                          </span>
                          <span style={{ fontSize: "11px", color: "var(--muted-2)" }}>{f.ayuda}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mk-campo-rotulo">Plataforma</div>
                    <div className="flex flex-col gap-1.5">
                      {PLATAFORMAS.map((pf) => (
                        <button key={pf.clave} type="button" className="mk-opcion py-2.5" aria-pressed={plataforma === pf.clave} onClick={() => setPlataforma(pf.clave)}>
                          <span style={{ fontSize: "12.5px", fontWeight: 600 }}>{pf.texto}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <label className="mt-5 block">
                  <span className="mk-campo-rotulo">Indicaciones (opcional)</span>
                  <textarea
                    className="campo"
                    rows={3}
                    value={indicaciones}
                    onChange={(e) => setIndicaciones(e.target.value)}
                    placeholder="Ej: para gente de Chillán, sin mencionar precios"
                  />
                </label>

                <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-5" style={{ borderColor: "var(--borde)" }}>
                  <button type="button" className="btn-primario mk-btn-lg" disabled={ocupado !== ""} onClick={() => escribir()}>
                    {ocupado === "texto" ? "Escribiendo…" : paquete ? "Volver a escribir" : "Escribir el anuncio"}
                  </button>
                  <button type="button" className="btn-suave mk-btn-lg" disabled={ocupado !== ""} onClick={escribirYo}>
                    Escribir yo
                  </button>
                  {paquete && (
                    <button type="button" className="btn-suave mk-btn-lg" onClick={() => setPaso(2)}>
                      Seguir con el texto actual
                    </button>
                  )}
                  {ocupado === "texto" && (
                    <span className="mk-pensando">
                      <i />
                      <i />
                      <i />
                      Decidiendo el ángulo y escribiendo…
                    </span>
                  )}
                </div>
              </>
            )}

            {paso === 2 && (
              <>
                {paquete && (
                  <div className="mk-hundido mb-5 px-4 py-3">
                    <div className="mk-hallazgo-tipo">Estrategia</div>
                    <p className="mt-1" style={{ fontSize: "12.5px", color: "var(--tinta)", lineHeight: 1.55 }}>
                      Le habla a <strong>{paquete.estrategia.audiencia}</strong>, que {paquete.estrategia.situacion.toLowerCase()}{" "}
                      Se apoya en <strong>{etiquetaAngulo(paquete.estrategia.angulo)}</strong>.
                    </p>
                    <p className="mt-1.5" style={{ fontSize: "12px", color: "var(--muted)" }}>
                      {paquete.estrategia.prueba
                        ? `Se respalda en: ${paquete.estrategia.prueba}`
                        : "No afirma ningún resultado: este negocio todavía no tiene casos registrados con qué respaldarlo."}
                    </p>
                  </div>
                )}

                {textoManual && !paquete && (
                  <div className="mk-hundido mb-5 px-4 py-3" style={{ fontSize: "12.5px" }}>
                    Lo estás escribiendo tú. Nada de esto se reemplaza solo; si quieres una versión de Respondo, vuelve al brief.
                  </div>
                )}

                {defectos.length > 0 && (
                  <div className="mb-5 rounded-lg border px-4 py-3" style={{ borderColor: "var(--borde)" }}>
                    <div className="mk-hallazgo-tipo">Lo que la revisión todavía marca</div>
                    <ul className="mt-1.5" style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.5 }}>
                      {defectos.map((d, i) => (
                        <li key={i}>
                          {d.grave ? "· " : "· "}
                          {d.texto}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Campo etiqueta="Gancho (primera línea)" valor={gancho} onChange={setGancho} max={LIMITES.gancho} />
                <Campo etiqueta="Titular" valor={titular} onChange={setTitular} max={LIMITES.titular} ayuda="Meta lo corta después de 40 caracteres." />
                <Campo
                  etiqueta="Texto principal"
                  valor={texto}
                  onChange={setTexto}
                  max={LIMITES.texto}
                  area
                  ayuda={`Los primeros ${LIMITES.textoVisible} caracteres se ven sin apretar «Ver más».`}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mk-campo-rotulo">Botón</span>
                    <select className="campo" value={cta} onChange={(e) => setCta(e.target.value)}>
                      {ctasPosibles.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <span className="mk-ayuda">Los botones que aparecen son los que corresponden al destino que elegiste.</span>
                  </label>
                  <Campo etiqueta="Nombre interno" valor={nombre} onChange={setNombre} max={80} />
                </div>

                {paquete && paquete.variantes.length > 0 && (
                  <div className="mt-5">
                    <div className="mk-campo-rotulo">Otros ángulos</div>
                    <div className="grid gap-2">
                      {paquete.variantes.map((v, i) => (
                        <button key={i} type="button" className="mk-opcion" onClick={() => aplicarVariante(v)}>
                          <span className="mk-hallazgo-tipo">{etiquetaAngulo(v.angulo)}</span>
                          <span className="font-semibold" style={{ fontSize: "12.5px" }}>
                            {v.titular}
                          </span>
                          <span style={{ fontSize: "11.5px", color: "var(--muted-2)", lineHeight: 1.45 }}>{v.texto}</span>
                          <span className="mk-enlace mt-1" style={{ fontSize: "11.5px" }}>
                            Usar este ángulo
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-5">
                  <div className="mk-campo-rotulo">Pedirle un retoque</div>
                  <div className="flex flex-wrap gap-1.5">
                    {RETOQUES.map((r) => (
                      <button key={r.clave} type="button" className="btn-chico" disabled={ocupado !== ""} onClick={() => escribir(r.instruccion)}>
                        {r.texto}
                      </button>
                    ))}
                  </div>
                  <p className="mk-ayuda mt-2">Cada uno vuelve a escribir el anuncio. Nada se cambia solo: si escribiste tú, se queda tu texto.</p>
                </div>

                <div className="mt-6 flex flex-wrap gap-2 border-t pt-5" style={{ borderColor: "var(--borde)" }}>
                  <button type="button" className="btn-primario mk-btn-lg" onClick={() => setPaso(3)} disabled={!hayTexto}>
                    Seguir con la imagen
                  </button>
                </div>
              </>
            )}

            {paso === 3 && (
              <>
                <div className="mk-campo-rotulo">La imagen</div>
                <div className="mk-segmentos mb-5" role="tablist" aria-label="De dónde sale la imagen">
                  <button type="button" role="tab" className="mk-segmento flex-1" aria-selected={fuenteImagen === "generar"} onClick={() => setFuenteImagen("generar")}>
                    Generar
                  </button>
                  <button type="button" role="tab" className="mk-segmento flex-1" aria-selected={fuenteImagen === "subir"} onClick={() => setFuenteImagen("subir")}>
                    Subir mi diseño
                  </button>
                  <button type="button" role="tab" className="mk-segmento flex-1" aria-selected={fuenteImagen === "existente"} onClick={cargarPiezas}>
                    Usar una existente
                  </button>
                </div>

                {fuenteImagen === "generar" && (
                  <>
                    <div className="mk-hundido px-4 py-3">
                      <div className="mk-hallazgo-tipo">Dirección visual</div>
                      <p className="mt-1" style={{ fontSize: "12.5px", color: "var(--tinta)", lineHeight: 1.55 }}>
                        {direccionTexto || descripcionPrevia(direccion, anguloActual, producto)}
                      </p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button type="button" className={imagenUrl ? "btn-suave mk-btn-lg" : "btn-primario mk-btn-lg"} disabled={ocupado !== ""} onClick={generarImagen}>
                        {ocupado === "imagen" ? "Generando…" : imagenUrl ? "Generar otra" : "Generar la imagen"}
                      </button>
                      {ocupado === "imagen" && (
                        <span className="mk-pensando">
                          <i />
                          <i />
                          <i />
                          Unos 5 a 10 segundos
                        </span>
                      )}
                      {imagenEsDemo && <span className="mk-demo">Imagen de muestra</span>}
                    </div>
                    <p className="mk-ayuda mt-2">
                      Nunca se genera una captura de pantalla ni un logo: una interfaz inventada que parece real es material engañoso, y un
                      logo dibujado por un modelo sale deformado. Eso se pone después, en el editor.
                    </p>
                  </>
                )}

                {fuenteImagen === "subir" && (
                  <>
                    <input
                      ref={archivoRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) subirDiseno(f);
                        e.target.value = "";
                      }}
                    />
                    <button type="button" className="btn-primario mk-btn-lg" disabled={ocupado !== ""} onClick={() => archivoRef.current?.click()}>
                      {ocupado === "subir" ? "Subiendo…" : "Elegir archivo"}
                    </button>
                    <p className="mk-ayuda mt-2">
                      JPG, PNG o WEBP, hasta 8 MB. Tu pieza se guarda tal cual: no se recorta, no se reescala y no pasa por ningún modelo.
                    </p>
                    {demo && <p className="mk-ayuda mt-1">En demostración no se guarda nada. Apaga la demo para subir de verdad.</p>}
                  </>
                )}

                {fuenteImagen === "existente" && (
                  <>
                    {piezas === null ? (
                      <p className="mk-ayuda">Buscando…</p>
                    ) : piezas.length === 0 ? (
                      <p className="mk-ayuda">Todavía no hay piezas guardadas en este negocio.</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {piezas.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="mk-opcion overflow-hidden p-0"
                            aria-pressed={imagenUrl === p.url}
                            onClick={() => {
                              setImagenUrl(p.url);
                              setImagenEsDemo(false);
                              setOrigen("existente");
                              setAvisoImagen(null);
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.url} alt={p.nombre} className="h-20 w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {avisoImagen && (
                  <div className="mt-4 rounded-lg px-4 py-3" style={{ background: "var(--indigo-suave)", fontSize: "12.5px", lineHeight: 1.5 }}>
                    {avisoImagen}
                  </div>
                )}

                <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--borde)" }}>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-primario mk-btn-lg" disabled={ocupado !== "" || !hayTexto} onClick={() => guardar("lista")}>
                      {ocupado === "guardar" ? "Guardando…" : "Guardar como lista"}
                    </button>
                    <button type="button" className="btn-suave mk-btn-lg" disabled={ocupado !== "" || !hayTexto} onClick={() => guardar("borrador")}>
                      Guardar como borrador
                    </button>
                  </div>
                  <p className="mk-ayuda mt-2.5">
                    {imagenUrl ? "Se guarda con la imagen." : "Se puede guardar sin imagen y ponerla después."}
                    {demo && " En demostración no se guarda: apaga la demo para crear de verdad."}
                  </p>
                </div>
              </>
            )}

            {error && (
              <div className="mt-5 rounded-lg px-4 py-3" style={{ background: "#fdf1ee", color: "var(--tinta)", fontSize: "13px" }}>
                {error}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Lienzo ─────────────────────────────────────────────────────── */}
      <div className="xl:col-span-7">
        <div className="xl:sticky xl:top-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="mk-hallazgo-tipo">Cómo se va a ver</span>
            <span className="mk-meta">
              {formato} · {PLATAFORMAS.find((pf) => pf.clave === plataforma)?.texto}
              {origen !== "generada" && ` · ${origen === "subida" ? "diseño propio" : "pieza reutilizada"}`}
            </span>
          </div>
          <div className="mk-lienzo">
            <VistaPreviaAnuncio
              negocio={negocio}
              titular={titular}
              texto={texto || "Acá va a aparecer el anuncio cuando esté escrito."}
              cta={cta}
              imagenUrl={imagenUrl}
              formato={formato}
              plataforma={plataforma}
              superficie={esHistoria ? "historia" : "feed"}
              ancho={esHistoria ? 290 : formato === "16:9" ? 460 : 400}
            />
          </div>
          <p className="mt-3 leading-relaxed" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
            Reproduce la anatomía real del anuncio en Meta: cabecera, imagen en su formato, titular con botón y el corte de «Ver más» a los{" "}
            {LIMITES.textoVisible} caracteres. Lo que se corta acá se corta allá.
          </p>
          {hayTexto && (
            <p className="mt-2" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
              Guárdala y desde su ficha la puedes{" "}
              <Link href="/marketing/campanas/nueva" className="mk-enlace">
                usar en una campaña
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const ETIQUETAS: Record<Angulo, string> = {
  problema: "lo que hoy se pierde",
  operativo: "el trabajo repetitivo",
  venta: "los interesados que no avanzan",
  velocidad: "la respuesta a tiempo",
  capacidad: "lo que se puede resolver",
  control: "automatizar sin perder el mando",
  precio: "el precio de frente",
  prueba: "lo que ya pasó en otros casos",
  urgencia: "el plazo",
  publico: "a quién va dirigido",
};

function etiquetaAngulo(a: Angulo): string {
  return ETIQUETAS[a] ?? a;
}

/** Lo que se va a ver, antes de haber generado nada. */
function descripcionPrevia(d: DireccionVisual | null, angulo: Angulo, producto: string): string {
  if (d?.concepto) return `Se ve ${d.sujeto || producto || "el producto"}. La foto tiene que contar ${d.concepto}.`;
  return `Todavía no hay imagen. Se va a fotografiar ${producto || "el producto"} contando ${ETIQUETAS[angulo]}.`;
}

function Campo({
  etiqueta,
  valor,
  onChange,
  max,
  area,
  ayuda,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  max: number;
  area?: boolean;
  ayuda?: string;
}) {
  const largo = valor.length > max;
  return (
    <label className="mb-4 block">
      <span className="mk-campo-rotulo">
        {etiqueta}
        <span className="cifra" style={{ fontSize: "11px", fontWeight: 500, color: largo ? "var(--peligro)" : "var(--muted-3)" }}>
          {valor.length}/{max}
        </span>
      </span>
      {area ? (
        <textarea className="campo" rows={4} value={valor} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="campo" value={valor} onChange={(e) => onChange(e.target.value)} />
      )}
      {ayuda && <span className="mk-ayuda">{ayuda}</span>}
    </label>
  );
}

function Proporcion({ formato }: { formato: FormatoCreatividad }) {
  const [w, h] = formato.split(":").map(Number);
  const k = 14 / Math.max(w, h);
  return (
    // Relleno, no contorno: un cuadrado 1:1 dibujado solo con borde se lee como
    // una casilla de verificación sin marcar, no como una proporción.
    <span className="inline-grid h-4 w-4 place-items-center" aria-hidden="true">
      <span className="block rounded-[2px]" style={{ width: w * k, height: h * k, background: "currentColor", opacity: 0.28 }} />
    </span>
  );
}
