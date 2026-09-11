import Link from "next/link";
import type { ItemPauta } from "@/lib/ads/estado";
import type { Capacidades } from "@/lib/marketing/capacidades";
import { Ico } from "@/components/marketing/Iconos";

/**
 * PUESTA EN MARCHA — para el negocio que recién entra.
 *
 * No bloquea nada: es un panel arriba del inicio que dice qué ya funciona,
 * qué falta y por dónde empezar. Tres puertas, y las tres sirven hoy: crear
 * una creatividad (funciona sin conectar nada), conectar Meta (agrega el
 * costo) y encender la demostración (para entender el producto completo).
 *
 * Desaparece solo, sin que nadie lo cierre, en cuanto llega la primera
 * conversación desde un anuncio.
 */
export default function Onboarding({
  estado,
  creatividades,
  capacidades,
}: {
  estado: { items: ItemPauta[]; listos: number; total: number };
  creatividades: number;
  capacidades: Capacidades;
}) {
  /**
   * Un paso que la instalación NO ofrece —el estado `manual`— no puede contar
   * en el denominador: dejaba el contador clavado en «0 de 6» sin forma de
   * llegar nunca a 6, que es la manera más rápida de que alguien deje de mirar
   * esta lista. Se sigue mostrando (es información honesta sobre qué falta),
   * pero aparte de la cuenta.
   */
  const pasos = [
    ...estado.items.map((i) => ({
      titulo: i.titulo,
      listo: i.estado === "ok",
      cuenta: i.estado !== "manual",
      detalle: i.detalle,
      accion: i.accion,
    })),
    {
      titulo: "Primera creatividad",
      listo: creatividades > 0,
      cuenta: true,
      detalle:
        creatividades > 0
          ? `${creatividades} en el estudio.`
          : "Respondo la escribe con lo que ya sabe de tu negocio y genera la imagen.",
      accion: creatividades > 0 ? undefined : { texto: "Crear", href: "/marketing/creatividades/nueva" },
    },
  ];
  const contables = pasos.filter((p) => p.cuenta);
  const listos = contables.filter((p) => p.listo).length;

  return (
    <section className="mk-panel mb-7 overflow-hidden">
      <div className="grid lg:grid-cols-12">
        <div className="p-7 lg:col-span-5" style={{ background: "var(--indigo-suave)", borderRight: "1px solid var(--indigo-borde)" }}>
          <div className="mk-hallazgo-tipo" style={{ color: "var(--indigo)" }}>
            Bienvenido a Marketing
          </div>
          <h2 className="mt-2 font-semibold" style={{ fontSize: "19px", letterSpacing: "-0.025em", lineHeight: 1.3 }}>
            Descubre qué anuncios te traen clientes y crea la próxima campaña con lo que Respondo aprende de tus conversaciones.
          </h2>
          <p className="mt-3 leading-relaxed" style={{ fontSize: "13.5px", color: "var(--muted)" }}>
            La atribución empieza sola: cuando alguien entra a WhatsApp desde un anuncio, queda registrado de qué aviso vino y qué pasó
            después.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {/* La primera puerta funciona SIEMPRE: escribir un anuncio no
                necesita ninguna integración. Por eso es la primaria. */}
            {capacidades.puedeGenerarConIa && (
              <Link href="/marketing/creatividades/nueva" className="btn-primario mk-btn-lg">
                {Ico.creatividades({ className: "h-4 w-4" })} Crear una creatividad
              </Link>
            )}
            {/* La segunda solo existe si de verdad se puede conectar. Ofrecer
                «Conectar Meta» en una instalación sin la app de Meta mandaba al
                dueño a una pantalla que le decía «no disponible». */}
            {capacidades.puedeConectarMeta && !capacidades.metaConectada && (
              <Link href="/marketing/integraciones" className="btn-suave mk-btn-lg">
                Conectar Meta
              </Link>
            )}
          </div>
          <p className="mt-4" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
            ¿Quieres ver el producto completo antes? Enciende «Datos de demostración» abajo a la izquierda.
          </p>
        </div>

        <div className="p-7 lg:col-span-7">
          <div className="flex items-center justify-between">
            <span className="mk-hallazgo-tipo">Puesta en marcha</span>
            <span className="cifra" style={{ fontSize: "12px", color: "var(--muted-2)" }}>
              {listos} de {contables.length}
            </span>
          </div>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--fondo-hundido)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.round((listos / pasos.length) * 100)}%`, background: "var(--indigo)" }}
            />
          </div>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {pasos.map((p) => (
              <li key={p.titulo} className="mk-hundido flex gap-3 px-3.5 py-3">
                <span
                  className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full"
                  style={{ background: p.listo ? "var(--ok-suave)" : "var(--superficie)", color: p.listo ? "var(--ok)" : "var(--muted-3)", border: p.listo ? "0" : "1px solid var(--borde-fuerte)" }}
                  aria-hidden="true"
                >
                  {p.listo ? Ico.ok({ className: "h-3 w-3" }) : <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold" style={{ fontSize: "12.5px", color: p.listo ? "var(--tinta)" : "var(--muted)" }}>
                    {p.titulo}
                  </div>
                  <div className="mt-0.5 leading-snug" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
                    {p.detalle}
                  </div>
                  {!p.listo && p.accion && (
                    <Link href={p.accion.href.replace(/^\/pauta\/conexion/, "/marketing/integraciones")} className="mk-enlace mt-1.5 inline-flex" style={{ fontSize: "11.5px" }}>
                      {p.accion.texto} {Ico.flecha({ className: "h-3 w-3" })}
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
