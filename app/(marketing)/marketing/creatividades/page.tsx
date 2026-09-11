import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearNumero } from "@/lib/ads/moneda";
import { cargarMarketing } from "@/lib/marketing/datos";
import { contextoDeMarca } from "@/lib/marketing/contextoMarca";
import { modoDemo } from "@/lib/marketing/modo";
import { PLANTILLAS_CREATIVAS } from "@/lib/marketing/plantillasCreativas";
import Cabecera from "@/components/marketing/Cabecera";
import GaleriaCreatividades from "@/components/marketing/GaleriaCreatividades";
import AvisoMigracion from "@/components/marketing/AvisoMigracion";
import { Ico } from "@/components/marketing/Iconos";

export const dynamic = "force-dynamic";

/**
 * ESTUDIO CREATIVO.
 *
 * Es el único lugar del producto donde se CREA en vez de mirar, y la pantalla
 * tiene que decirlo desde el primer segundo. Por eso, cuando no hay nada, no
 * hay un «no hay datos»: hay una invitación con seis arranques que funcionan
 * de verdad —cada uno precarga el brief y corre el mismo motor— y la lista de
 * lo que Respondo ya sabe del negocio, que es la materia prima.
 *
 * Cuando sí hay creatividades, la galería manda y los arranques bajan a una
 * fila discreta.
 */
export default async function Creatividades({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const rango = resolverRango((await searchParams).p ?? "30d");
  const [p, marca] = await Promise.all([
    cargarMarketing(usuario.clienteId, rango, { demo }),
    contextoDeMarca(usuario.clienteId, demo),
  ]);
  const hay = p.creatividades.length > 0;
  const conRendimiento = p.creatividades.filter((c) => c.rendimiento && c.estado !== "archivada").length;
  // El resumen tiene que cuadrar con las pestañas de abajo: «8 creatividades ·
  // 6 listas» arriba de una pestaña que dice «Listas 1» destruye la confianza
  // en toda la pantalla. Acá se cuenta lo mismo que ahí.
  const archivadas = p.creatividades.filter((c) => c.estado === "archivada").length;
  const vivas = p.creatividades.length - archivadas;

  return (
    <main className="mk-pagina">
      <Cabecera
        titulo="Estudio creativo"
        bajada={
          hay
            ? undefined
            : `Respondo escribe el anuncio con lo que ya aprendió de ${marca.nombre} y genera la imagen. No hace falta conectar nada.`
        }
        demo={p.demo}
        controles={
          hay ? (
            <span className="mk-meta">
              {formatearNumero(vivas)} {vivas === 1 ? "creatividad" : "creatividades"} ·{" "}
              {formatearNumero(conRendimiento)} con rendimiento
              {archivadas > 0 && ` · ${formatearNumero(archivadas)} ${archivadas === 1 ? "archivada" : "archivadas"}`}
            </span>
          ) : undefined
        }
        acciones={
          <Link href="/marketing/creatividades/nueva" className="btn-primario mk-btn-lg">
            {Ico.copiloto({ className: "h-4 w-4" })} Crear con IA
          </Link>
        }
      />

      {!p.almacenListo && <AvisoMigracion />}

      {!hay ? (
        <>
          <section className="mk-panel overflow-hidden">
            <div className="grid lg:grid-cols-12">
              <div className="p-8 lg:col-span-7">
                <div className="mk-hallazgo-tipo" style={{ color: "var(--indigo)" }}>
                  Por dónde empezar
                </div>
                <h2 className="mt-2 font-semibold" style={{ fontSize: "20px", letterSpacing: "-0.025em", lineHeight: 1.3 }}>
                  Elige qué quieres anunciar. El resto lo escribe Respondo.
                </h2>
                <div className="mk-arranques mt-6">
                  {PLANTILLAS_CREATIVAS.map((t) => (
                    <Link key={t.clave} href={`/marketing/creatividades/nueva?plantilla=${t.clave}`} className="mk-arranque">
                      <span className="mk-arranque-icono">{Ico[t.icono]({ className: "h-[18px] w-[18px]" })}</span>
                      <span className="mk-arranque-titulo">{t.titulo}</span>
                      <span className="mk-arranque-texto">{t.texto}</span>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="p-8 lg:col-span-5" style={{ background: "var(--mk-superficie-2)", borderLeft: "1px solid var(--borde)" }}>
                <div className="mk-hallazgo-tipo">Lo que Respondo ya sabe</div>
                <p className="mt-2 leading-relaxed" style={{ fontSize: "13px", color: "var(--muted)" }}>
                  El anuncio no se escribe en el vacío: usa tu ficha del negocio y las palabras con que tus clientes piden las cosas.
                </p>
                <dl className="mt-5 grid gap-4">
                  <Hecho n={marca.ofertas.length} etiqueta="productos o servicios en tu ficha" />
                  <Hecho n={marca.saber.length} etiqueta="cosas aprendidas de tus conversaciones" />
                  {marca.zona && <HechoTexto valor={marca.zona} etiqueta="zona del negocio" />}
                  {marca.whatsapp && <HechoTexto valor="WhatsApp conectado" etiqueta="destino de los anuncios" />}
                </dl>
                {marca.ofertas.length > 0 && (
                  <div className="mt-5">
                    <div className="mk-hallazgo-tipo mb-2">Puedes anunciar</div>
                    <div className="flex flex-wrap gap-1.5">
                      {marca.ofertas.slice(0, 6).map((o) => (
                        <span
                          key={o.titulo}
                          className="rounded-md border px-2.5 py-1"
                          style={{ borderColor: "var(--borde)", background: "var(--superficie)", fontSize: "12px", color: "var(--muted)" }}
                          title={o.detalle}
                        >
                          {o.titulo}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <p className="mt-6 max-w-3xl leading-relaxed" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
            El texto se genera con el contexto de tu negocio y la imagen con un modelo de imagen; las dos cosas se pueden editar antes de
            guardar. Los límites de Meta (titular de 40 caracteres, texto de 300) se muestran mientras escribes, no después de publicar.
          </p>
        </>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="mk-meta mr-1">Crear:</span>
            {PLANTILLAS_CREATIVAS.map((t) => (
              <Link key={t.clave} href={`/marketing/creatividades/nueva?plantilla=${t.clave}`} className="btn-chico">
                {Ico[t.icono]({ className: "h-3.5 w-3.5" })} {t.titulo}
              </Link>
            ))}
          </div>
          <GaleriaCreatividades items={p.creatividades} monedaNegocio={p.monedaNegocio} />
        </>
      )}
    </main>
  );
}

function Hecho({ n, etiqueta }: { n: number; etiqueta: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <dd className="cifra" style={{ fontSize: "24px", fontWeight: 600, letterSpacing: "-0.03em", color: n > 0 ? "var(--indigo)" : "var(--muted-3)", minWidth: 38 }}>
        {n}
      </dd>
      <dt style={{ fontSize: "12.5px", color: "var(--muted)" }}>{etiqueta}</dt>
    </div>
  );
}

function HechoTexto({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <dd style={{ fontSize: "14px", fontWeight: 600, color: "var(--tinta)", minWidth: 38 }}>{valor}</dd>
      <dt style={{ fontSize: "12.5px", color: "var(--muted)" }}>{etiqueta}</dt>
    </div>
  );
}
