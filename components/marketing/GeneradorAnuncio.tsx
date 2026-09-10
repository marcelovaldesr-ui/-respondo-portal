"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { generarImagenCreativa, generarTextoCreativo, guardarCreatividadAccion } from "@/app/(marketing)/marketing/creatividades/acciones";
import { CTAS_META, LIMITES, type PaqueteCreativo } from "@/lib/marketing/creatividadesCore";
import { OBJETIVOS, type FormatoCreatividad, type PlataformaCreatividad } from "@/lib/marketing/tipos";
import VistaPreviaAnuncio from "@/components/marketing/VistaPreviaAnuncio";

/**
 * EL GENERADOR — de un brief de cuatro campos a un anuncio listo.
 *
 * Tres pasos y una vista previa que se actualiza sola:
 *   1. Brief: objetivo, producto, oferta, plataforma, formato. Las ofertas
 *      se sugieren desde el conocimiento del negocio; se puede escribir otra.
 *   2. Texto: el modelo escribe concepto, gancho, titular, texto y CTA, más
 *      dos variantes. Todo se edita a mano; los límites de Meta se muestran
 *      mientras se escribe, no después de publicar.
 *   3. Imagen: se genera con la descripción propuesta (editable). Si falla,
 *      la creatividad se guarda igual, sin imagen, y lo dice.
 *
 * Nunca hay un spinner sin texto: cada espera dice qué está pasando.
 */

const FORMATOS: { clave: FormatoCreatividad; texto: string; ayuda: string }[] = [
  { clave: "1:1", texto: "Cuadrado 1:1", ayuda: "Feed de Facebook e Instagram" },
  { clave: "4:5", texto: "Vertical 4:5", ayuda: "Feed de Instagram, ocupa más pantalla" },
  { clave: "9:16", texto: "Historia 9:16", ayuda: "Historias y reels" },
  { clave: "16:9", texto: "Horizontal 16:9", ayuda: "Feed de Facebook, enlaces" },
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
  demo,
  campanaId,
  campanaNombre,
  base,
}: {
  negocio: string;
  ofertas: { titulo: string; detalle: string }[];
  demo: boolean;
  campanaId?: string | null;
  campanaNombre?: string | null;
  /** Cuando se crea una variación de otra creatividad. */
  base?: BaseVariacion | null;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [objetivo, setObjetivo] = useState(base?.objetivo ?? "conversaciones");
  const [producto, setProducto] = useState(base?.producto ?? "");
  const [oferta, setOferta] = useState(base?.oferta ?? "");
  const [plataforma, setPlataforma] = useState<PlataformaCreatividad>(base?.plataforma ?? "ambas");
  const [formato, setFormato] = useState<FormatoCreatividad>(base?.formato ?? "1:1");
  const [indicaciones, setIndicaciones] = useState("");

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

  const aplicar = (p: PaqueteCreativo) => {
    setPaquete(p);
    setNombre(p.nombre);
    setConcepto(p.concepto);
    setGancho(p.gancho);
    setTitular(p.titular);
    setTexto(p.texto);
    setCta(p.cta);
    setImagenPrompt(p.imagenPrompt);
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
          ? { nombre: base.nombre, concepto: base.concepto, gancho: base.gancho, titular: base.titular, texto: base.texto, cta: base.cta, imagenPrompt: base.imagenPrompt ?? "", variantes: [] }
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

  const Contador = ({ n, max }: { n: number; max: number }) => (
    <span className="cifra" style={{ fontSize: "var(--t-micro)", color: n > max ? "var(--peligro)" : "var(--muted-3)" }}>
      {n}/{max}
    </span>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <div className="lg:col-span-7">
        {/* Pasos */}
        <div className="mk-segmentos mb-4" role="tablist" aria-label="Pasos">
          {[
            { n: 1 as const, t: "Brief" },
            { n: 2 as const, t: "Texto" },
            { n: 3 as const, t: "Imagen y guardar" },
          ].map((s) => (
            <button key={s.n} type="button" role="tab" className="mk-segmento" aria-pressed={paso === s.n} disabled={s.n > 1 && !paquete} onClick={() => setPaso(s.n)}>
              <span className="mk-paso-numero mr-1.5" style={{ width: 16, height: 16, fontSize: 9.5 }}>{s.n}</span>
              {s.t}
            </button>
          ))}
        </div>

        {campanaNombre && (
          <div className="mb-4 rounded-md border px-3 py-2" style={{ borderColor: "var(--indigo-borde)", background: "var(--indigo-suave)", fontSize: "var(--t-menor)" }}>
            Esta creatividad va a quedar asociada a la campaña <strong>{campanaNombre}</strong>.
          </div>
        )}
        {base && (
          <div className="mb-4 rounded-md border px-3 py-2" style={{ borderColor: "var(--borde)", background: "var(--fondo-fila)", fontSize: "var(--t-menor)" }}>
            Variación de <strong>{base.nombre}</strong>. El modelo va a cambiar el ángulo, no repetirlo.
          </div>
        )}

        {paso === 1 && (
          <section className="tarjeta p-5">
            <h2 className="h-seccion">¿Qué vamos a anunciar?</h2>
            <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
              Respondo ya sabe cómo hablan tus clientes y qué preguntan. Con esto escribe el anuncio en sus palabras.
            </p>

            <div className="mt-5">
              <div className="eyebrow mb-2">Objetivo</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {OBJETIVOS.map((o) => (
                  <button key={o.clave} type="button" className="mk-opcion" aria-pressed={objetivo === o.clave} onClick={() => setObjetivo(o.clave)}>
                    <span className="font-semibold" style={{ fontSize: "var(--t-fila)" }}>{o.texto}</span>
                    <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{o.ayuda}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Producto o servicio</span>
                <input className="campo mt-1" value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="Ej: pendón roller 80×200" list="ofertas-sugeridas" />
                <datalist id="ofertas-sugeridas">
                  {ofertas.map((o) => (
                    <option key={o.titulo} value={o.titulo} />
                  ))}
                </datalist>
              </label>
              <label className="block">
                <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Oferta o gancho</span>
                <input className="campo mt-1" value={oferta} onChange={(e) => setOferta(e.target.value)} placeholder="Ej: listo en 24 horas, diseño incluido" />
              </label>
            </div>

            {ofertas.length > 0 && (
              <div className="mt-3">
                <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>Lo que Respondo sabe que vendes:</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {ofertas.slice(0, 8).map((o) => (
                    <button
                      key={o.titulo}
                      type="button"
                      className="btn-chico"
                      title={o.detalle}
                      onClick={() => {
                        setProducto(o.titulo);
                        if (!oferta) setOferta(o.detalle.slice(0, 80));
                      }}
                    >
                      {o.titulo}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="eyebrow mb-2">Plataforma</div>
                <div className="flex flex-col gap-1.5">
                  {PLATAFORMAS.map((p) => (
                    <button key={p.clave} type="button" className="mk-opcion py-2" aria-pressed={plataforma === p.clave} onClick={() => setPlataforma(p.clave)}>
                      <span style={{ fontSize: "var(--t-menor)", fontWeight: 600 }}>{p.texto}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="eyebrow mb-2">Formato</div>
                <div className="flex flex-col gap-1.5">
                  {FORMATOS.map((f) => (
                    <button key={f.clave} type="button" className="mk-opcion py-2" aria-pressed={formato === f.clave} onClick={() => setFormato(f.clave)}>
                      <span className="flex items-center gap-2" style={{ fontSize: "var(--t-menor)", fontWeight: 600 }}>
                        <Proporcion formato={f.clave} /> {f.texto}
                      </span>
                      <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{f.ayuda}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="mt-5 block">
              <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Indicaciones (opcional)</span>
              <input className="campo mt-1" value={indicaciones} onChange={(e) => setIndicaciones(e.target.value)} placeholder="Ej: tono cercano, sin mencionar precios, para gente de Chillán" />
            </label>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primario" disabled={ocupado !== ""} onClick={generarTexto}>
                {ocupado === "texto" ? "Escribiendo el anuncio…" : paquete ? "Volver a escribir" : "Escribir el anuncio"}
              </button>
              {paquete && (
                <button type="button" className="btn-suave" onClick={() => setPaso(2)}>
                  Seguir con el texto actual
                </button>
              )}
              {ocupado === "texto" && (
                <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>Leyendo lo que Respondo sabe del negocio y redactando. Unos 10 segundos.</span>
              )}
            </div>
          </section>
        )}

        {paso === 2 && paquete && (
          <section className="tarjeta p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="h-seccion">El texto del anuncio</h2>
              <button type="button" className="btn-texto" onClick={() => setPaso(1)}>
                Cambiar el brief
              </button>
            </div>
            <p className="mt-1 leading-relaxed" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
              <strong style={{ color: "var(--tinta)" }}>Concepto:</strong> {concepto}
            </p>

            <div className="mt-4 grid gap-3">
              <Campo etiqueta="Nombre interno" valor={nombre} onChange={setNombre} max={80} contador={Contador} />
              <Campo etiqueta="Gancho (primera línea)" valor={gancho} onChange={setGancho} max={LIMITES.gancho} contador={Contador} />
              <Campo etiqueta="Titular" valor={titular} onChange={setTitular} max={LIMITES.titular} contador={Contador} ayuda="Meta lo corta después de 40 caracteres." />
              <Campo etiqueta="Texto principal" valor={texto} onChange={setTexto} max={LIMITES.texto} contador={Contador} area ayuda={`Los primeros ${LIMITES.textoVisible} caracteres se ven sin apretar «Ver más».`} />
              <label className="block">
                <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>Botón</span>
                <select className="campo mt-1" value={cta} onChange={(e) => setCta(e.target.value)}>
                  {CTAS_META.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>

            {paquete.variantes.length > 0 && (
              <div className="mt-5">
                <div className="eyebrow mb-2">Otros ángulos</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {paquete.variantes.map((v, i) => (
                    <button key={i} type="button" className="mk-opcion" onClick={() => usarVariante(v)}>
                      <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>{v.titular}</span>
                      <span className="line-clamp-3" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{v.texto}</span>
                      <span className="mt-1 font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}>Usar este ángulo</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className="btn-primario" onClick={() => setPaso(3)} disabled={!titular.trim() || !texto.trim()}>
                Seguir con la imagen
              </button>
              <button type="button" className="btn-suave" disabled={ocupado !== ""} onClick={generarTexto}>
                {ocupado === "texto" ? "Escribiendo…" : "Pedir otra versión"}
              </button>
            </div>
          </section>
        )}

        {paso === 3 && paquete && (
          <section className="tarjeta p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="h-seccion">La imagen</h2>
              <button type="button" className="btn-texto" onClick={() => setPaso(2)}>
                Volver al texto
              </button>
            </div>
            <Campo etiqueta="Descripción de la fotografía" valor={imagenPrompt} onChange={setImagenPrompt} max={LIMITES.imagenPrompt} contador={Contador} area ayuda="Sin texto ni logos dentro de la imagen: Meta penaliza las imágenes con mucho texto." />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className={imagenUrl ? "btn-suave" : "btn-primario"} disabled={ocupado !== "" || !imagenPrompt.trim()} onClick={generarImagen}>
                {ocupado === "imagen" ? "Generando la imagen…" : imagenUrl ? "Generar otra" : "Generar la imagen"}
              </button>
              {ocupado === "imagen" && <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>Unos 5 a 10 segundos.</span>}
              {imagenEsDemo && <span className="pildora-alerta">Imagen de muestra (demo)</span>}
            </div>

            <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--borde)" }}>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primario" disabled={ocupado !== ""} onClick={() => guardar("lista")}>
                  {ocupado === "guardar" ? "Guardando…" : "Guardar como lista"}
                </button>
                <button type="button" className="btn-suave" disabled={ocupado !== ""} onClick={() => guardar("borrador")}>
                  Guardar como borrador
                </button>
              </div>
              <p className="mt-2" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
                {imagenUrl ? "Se guarda con la imagen." : "Se puede guardar sin imagen y generarla después desde la creatividad."}
                {demo && " En demostración no se guarda: apaga la demo para crear de verdad."}
              </p>
            </div>
          </section>
        )}

        {error && (
          <div className="tarjeta mt-4 p-3" style={{ borderLeft: "3px solid var(--peligro)", fontSize: "var(--t-menor)" }}>
            {error}
          </div>
        )}
      </div>

      {/* Vista previa */}
      <aside className="lg:col-span-5">
        <div className="lg:sticky lg:top-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="eyebrow">Cómo se va a ver</span>
            <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{formato} · {PLATAFORMAS.find((p) => p.clave === plataforma)?.texto}</span>
          </div>
          <div className="tarjeta-plana flex justify-center p-4" style={{ background: "var(--fondo-hundido)" }}>
            <VistaPreviaAnuncio
              negocio={negocio}
              titular={titular}
              texto={texto || (paquete ? "" : "El texto del anuncio aparece acá cuando lo escribas o lo genere el estudio.")}
              cta={cta}
              imagenUrl={imagenUrl}
              formato={formato}
              plataforma={plataforma}
            />
          </div>
          {!paquete && (
            <p className="mt-3 leading-relaxed" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
              La vista previa reproduce la anatomía real del anuncio en Meta: cabecera, imagen en su formato, titular con botón y texto con el corte de «Ver más». Lo que se corta acá se corta allá.
            </p>
          )}
          {paquete && (
            <p className="mt-3" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
              ¿Quieres usarla en una campaña? Guárdala y desde la creatividad tienes <Link href="/marketing/campanas/nueva" className="font-semibold" style={{ color: "var(--indigo)" }}>Usar en campaña</Link>.
            </p>
          )}
        </div>
      </aside>
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
  contador: Contador,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  max: number;
  area?: boolean;
  ayuda?: string;
  contador: (p: { n: number; max: number }) => React.ReactElement;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="font-semibold" style={{ fontSize: "var(--t-menor)" }}>{etiqueta}</span>
        <Contador n={valor.length} max={max} />
      </span>
      {area ? (
        <textarea className="campo mt-1" rows={4} value={valor} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="campo mt-1" value={valor} onChange={(e) => onChange(e.target.value)} />
      )}
      {ayuda && <span className="mt-0.5 block" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{ayuda}</span>}
    </label>
  );
}

function Proporcion({ formato }: { formato: FormatoCreatividad }) {
  const [w, h] = formato.split(":").map(Number);
  const k = 14 / Math.max(w, h);
  return (
    <span className="inline-grid h-4 w-4 place-items-center" aria-hidden="true">
      <span className="block rounded-[2px] border" style={{ width: w * k, height: h * k, borderColor: "currentColor" }} />
    </span>
  );
}
