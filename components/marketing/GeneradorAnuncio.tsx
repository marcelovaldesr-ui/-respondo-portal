"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  generarImagenCreativa,
  generarTextoCreativo,
  guardarCreatividadAccion,
} from "@/app/(marketing)/marketing/creatividades/acciones";
import { CTAS_META, LIMITES, type PaqueteCreativo } from "@/lib/marketing/creatividadesCore";
import type { PlantillaCreativa } from "@/lib/marketing/plantillasCreativas";
import { OBJETIVOS, type FormatoCreatividad, type PlataformaCreatividad } from "@/lib/marketing/tipos";
import VistaPreviaAnuncio from "@/components/marketing/VistaPreviaAnuncio";
import { Ico } from "@/components/marketing/Iconos";

/**
 * EL ESTUDIO — de un brief de cuatro campos a un anuncio listo.
 *
 * COMPOSICIÓN: controles a la izquierda, LIENZO al centro. La creatividad es
 * el producto de esta pantalla, así que ocupa el centro y crece: cuando la
 * imagen llega, llega grande. No hay miniaturas.
 *
 * TRES MOMENTOS, uno por vez, y el lienzo cambia con cada uno:
 *   1. Brief     → el lienzo muestra qué se va a anunciar y con qué contexto.
 *   2. Texto     → el lienzo muestra el anuncio armado; los ángulos alternativos
 *                  se prueban con un clic y se ven al instante.
 *   3. Imagen    → el lienzo muestra la foto en su formato real.
 *
 * Nunca hay un spinner mudo: cada espera dice qué está pasando y cuánto tarda.
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

export default function GeneradorAnuncio({
  negocio,
  ofertas,
  saber,
  demo,
  campanaId,
  campanaNombre,
  base,
  plantilla,
}: {
  negocio: string;
  ofertas: { titulo: string; detalle: string }[];
  saber: number;
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
  const [plataforma, setPlataforma] = useState<PlataformaCreatividad>(base?.plataforma ?? plantilla?.plataforma ?? "ambas");
  const [formato, setFormato] = useState<FormatoCreatividad>(base?.formato ?? plantilla?.formato ?? "1:1");
  const [indicaciones, setIndicaciones] = useState(plantilla?.indicaciones ?? "");

  const [paquete, setPaquete] = useState<PaqueteCreativo | null>(null);
  const [nombre, setNombre] = useState("");
  const [concepto, setConcepto] = useState("");
  const [gancho, setGancho] = useState("");
  const [titular, setTitular] = useState("");
  const [texto, setTexto] = useState("");
  const [cta, setCta] = useState<string>("Enviar mensaje");
  const [imagenPrompt, setImagenPrompt] = useState("");
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [imagenEsDemo, setImagenEsDemo] = useState(false);

  const [ocupado, setOcupado] = useState<"" | "texto" | "imagen" | "guardar">("");
  const [error, setError] = useState<string | null>(null);
  const [, iniciar] = useTransition();

  const aplicar = (pk: PaqueteCreativo) => {
    setPaquete(pk);
    setNombre(pk.nombre);
    setConcepto(pk.concepto);
    setGancho(pk.gancho);
    setTitular(pk.titular);
    setTexto(pk.texto);
    setCta(pk.cta);
    setImagenPrompt(pk.imagenPrompt);
  };

  const generarTexto = () => {
    setError(null);
    setOcupado("texto");
    iniciar(async () => {
      const r = await generarTextoCreativo({
        objetivo,
        producto,
        oferta,
        plataforma,
        formato,
        indicaciones,
        base: base
          ? {
              nombre: base.nombre,
              concepto: base.concepto,
              gancho: base.gancho,
              titular: base.titular,
              texto: base.texto,
              cta: base.cta,
              imagenPrompt: base.imagenPrompt ?? "",
              variantes: [],
            }
          : null,
      });
      setOcupado("");
      if (!r.ok) return setError(r.motivo);
      aplicar(r.paquete);
      setPaso(2);
    });
  };

  const generarImagen = () => {
    setError(null);
    setOcupado("imagen");
    iniciar(async () => {
      const r = await generarImagenCreativa(imagenPrompt, formato);
      setOcupado("");
      if (!r.ok) return setError(r.motivo);
      setImagenUrl(r.url);
      setImagenEsDemo(r.demo);
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
        imagenPrompt,
        estado,
        campanaId: campanaId ?? null,
        varianteDe: base?.id ?? null,
      });
      setOcupado("");
      if (!r.ok) return setError(r.motivo);
      router.push(`/marketing/creatividades/${encodeURIComponent(r.id)}?nueva=1`);
    });
  };

  const usarVariante = (v: PaqueteCreativo["variantes"][number]) => {
    setGancho(v.gancho);
    setTitular(v.titular);
    setTexto(v.texto);
    setCta(v.cta);
  };

  const esHistoria = formato === "9:16";
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
                  aria-pressed={paso === s.n}
                  disabled={s.n > 1 && !paquete}
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
                Variación de <strong>{base.nombre}</strong>. El modelo cambia el ángulo, no lo repite.
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

                <div className="mk-campo-rotulo">¿Qué quieres lograr?</div>
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
                    <input className="campo" value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="Ej: pendón roller 80×200" list="ofertas-sugeridas" />
                    <datalist id="ofertas-sugeridas">
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
                            if (!oferta) setOferta(o.detalle.slice(0, 90));
                          }}
                        >
                          {o.titulo}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <label className="mt-5 block">
                  <span className="mk-campo-rotulo">Oferta o gancho</span>
                  <input className="campo" value={oferta} onChange={(e) => setOferta(e.target.value)} placeholder="Ej: listo en 24 horas, diseño incluido" />
                </label>

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
                    placeholder="Ej: tono cercano, sin mencionar precios, para gente de Chillán"
                  />
                </label>

                <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-5" style={{ borderColor: "var(--borde)" }}>
                  <button type="button" className="btn-primario mk-btn-lg" disabled={ocupado !== ""} onClick={generarTexto}>
                    {ocupado === "texto" ? "Escribiendo…" : paquete ? "Volver a escribir" : "Escribir el anuncio"}
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
                      Leyendo {saber > 0 ? `${saber} cosas que sabemos del negocio` : "tu ficha del negocio"}…
                    </span>
                  )}
                </div>
              </>
            )}

            {paso === 2 && paquete && (
              <>
                <div className="mk-hundido mb-5 px-4 py-3">
                  <div className="mk-hallazgo-tipo">Concepto</div>
                  <p className="mt-1" style={{ fontSize: "13px", color: "var(--tinta)", lineHeight: 1.5 }}>
                    {concepto}
                  </p>
                </div>

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
                      {CTAS_META.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Campo etiqueta="Nombre interno" valor={nombre} onChange={setNombre} max={80} />
                </div>

                {paquete.variantes.length > 0 && (
                  <div className="mt-5">
                    <div className="mk-campo-rotulo">Otros ángulos</div>
                    <div className="grid gap-2">
                      {paquete.variantes.map((v, i) => (
                        <button key={i} type="button" className="mk-opcion" onClick={() => usarVariante(v)}>
                          <span className="font-semibold" style={{ fontSize: "12.5px" }}>
                            {v.titular}
                          </span>
                          <span style={{ fontSize: "11.5px", color: "var(--muted-2)", lineHeight: 1.45 }}>{v.texto}</span>
                          <span className="mk-enlace mt-1" style={{ fontSize: "11.5px" }}>
                            Probar este ángulo
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-6 flex flex-wrap gap-2 border-t pt-5" style={{ borderColor: "var(--borde)" }}>
                  <button type="button" className="btn-primario mk-btn-lg" onClick={() => setPaso(3)} disabled={!titular.trim() || !texto.trim()}>
                    Seguir con la imagen
                  </button>
                  <button type="button" className="btn-suave mk-btn-lg" disabled={ocupado !== ""} onClick={generarTexto}>
                    {ocupado === "texto" ? "Escribiendo…" : "Pedir otra versión"}
                  </button>
                </div>
              </>
            )}

            {paso === 3 && paquete && (
              <>
                <label className="block">
                  <span className="mk-campo-rotulo">
                    Descripción de la fotografía
                    <span className="cifra" style={{ fontSize: "11px", color: imagenPrompt.length > LIMITES.imagenPrompt ? "var(--peligro)" : "var(--muted-3)" }}>
                      {imagenPrompt.length}/{LIMITES.imagenPrompt}
                    </span>
                  </span>
                  <textarea className="campo" rows={5} value={imagenPrompt} onChange={(e) => setImagenPrompt(e.target.value)} />
                  <span className="mk-ayuda">Sin texto ni logos dentro de la imagen: Meta penaliza las imágenes con mucho texto.</span>
                </label>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="button" className={imagenUrl ? "btn-suave mk-btn-lg" : "btn-primario mk-btn-lg"} disabled={ocupado !== "" || !imagenPrompt.trim()} onClick={generarImagen}>
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

                <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--borde)" }}>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-primario mk-btn-lg" disabled={ocupado !== ""} onClick={() => guardar("lista")}>
                      {ocupado === "guardar" ? "Guardando…" : "Guardar como lista"}
                    </button>
                    <button type="button" className="btn-suave mk-btn-lg" disabled={ocupado !== ""} onClick={() => guardar("borrador")}>
                      Guardar como borrador
                    </button>
                  </div>
                  <p className="mk-ayuda mt-2.5">
                    {imagenUrl ? "Se guarda con la imagen." : "Se puede guardar sin imagen y generarla después."}
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
            </span>
          </div>
          <div className="mk-lienzo">
            <VistaPreviaAnuncio
              negocio={negocio}
              titular={titular}
              texto={texto || (paquete ? "" : "Acá va a aparecer el anuncio cuando Respondo lo escriba.")}
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
          {paquete && (
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
      <span
        className="block rounded-[2px]"
        style={{ width: w * k, height: h * k, background: "currentColor", opacity: 0.28 }}
      />
    </span>
  );
}
