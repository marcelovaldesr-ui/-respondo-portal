import Link from "next/link";
import type { ItemPauta } from "@/lib/ads/estado";
import { Ico } from "@/components/marketing/Iconos";

/**
 * BIENVENIDA — para el negocio que recién entra.
 *
 * No bloquea nada. Es una tarjeta arriba del inicio que dice qué hay listo,
 * qué falta y por dónde empezar. Tres puertas: explorar con datos de
 * demostración (para entender el producto), crear una creatividad (que
 * funciona sin conectar nada) y conectar Meta (que agrega el costo).
 */
export default function Onboarding({
  estado,
  creatividades,
}: {
  estado: { items: ItemPauta[]; listos: number; total: number };
  creatividades: number;
}) {
  const pasos = [
    ...estado.items.map((i) => ({ titulo: i.titulo, listo: i.estado === "ok", detalle: i.detalle, accion: i.accion })),
    {
      titulo: "Primera creatividad",
      listo: creatividades > 0,
      detalle: creatividades > 0 ? `${creatividades} en el estudio.` : "Escríbela con lo que Respondo ya sabe de tu negocio y genera la imagen.",
      accion: creatividades > 0 ? undefined : { texto: "Crear", href: "/marketing/creatividades/nueva" },
    },
  ];
  const listos = pasos.filter((p) => p.listo).length;

  return (
    <section className="tarjeta mb-5 overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-12">
        <div className="p-5 lg:col-span-5" style={{ background: "var(--indigo-suave)", borderRight: "1px solid var(--borde)" }}>
          <div className="eyebrow">Bienvenido a Marketing</div>
          <h2 className="mt-1 font-semibold" style={{ fontSize: "var(--t-ficha)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            Entiende qué anuncios te traen clientes y crea mejores campañas con lo que Respondo aprende de tus conversaciones.
          </h2>
          <p className="mt-2 leading-relaxed" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
            La atribución empieza sola: cuando alguien entra a WhatsApp desde un anuncio de Facebook o Instagram, queda registrado de qué aviso vino y qué pasó después.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/marketing/creatividades/nueva" className="btn-primario">
              {Ico.creatividades()} Crear una creatividad
            </Link>
            <Link href="/marketing/integraciones" className="btn-suave">
              Conectar Meta
            </Link>
          </div>
          <p className="mt-3" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
            ¿Quieres ver el producto completo antes? Enciende «Datos de demostración» abajo a la izquierda.
          </p>
        </div>
        <div className="p-5 lg:col-span-7">
          <div className="flex items-center justify-between">
            <span className="eyebrow">Puesta en marcha</span>
            <span className="cifra" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
              {listos} de {pasos.length}
            </span>
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--fondo-hundido)" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.round((listos / pasos.length) * 100)}%`, background: "var(--indigo)" }} />
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {pasos.map((p) => (
              <li key={p.titulo} className="flex gap-2.5 rounded-md border px-3 py-2.5" style={{ borderColor: "var(--borde)" }}>
                <span
                  className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full"
                  style={{ background: p.listo ? "var(--ok-suave)" : "var(--fondo-hundido)", color: p.listo ? "var(--ok)" : "var(--muted-3)" }}
                  aria-hidden="true"
                >
                  {p.listo ? Ico.ok({ className: "h-3 w-3" }) : <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold" style={{ fontSize: "var(--t-menor)", color: p.listo ? "var(--tinta)" : "var(--muted)" }}>
                    {p.titulo}
                  </div>
                  <div className="leading-snug" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
                    {p.detalle}
                  </div>
                  {!p.listo && p.accion && (
                    <Link href={p.accion.href.replace(/^\/pauta\/conexion/, "/marketing/integraciones")} className="mt-1 inline-block font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}>
                      {p.accion.texto} →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
