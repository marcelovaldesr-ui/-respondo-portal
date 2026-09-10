import { exigirPermisoPortal } from "@/lib/auth";
import Link from "next/link";
import { historialDeConsultas, panoramaDelNegocio, preguntasSinRespuesta } from "@/lib/isabel";
import { situacionDelNegocio } from "@/lib/isabelDatos";
import { sugerenciasSegunSituacion } from "@/lib/isabelCore";
import IsabelConsulta from "@/components/IsabelConsulta";

export const dynamic = "force-dynamic";
/**
 * Isabel lee cientos de mensajes antes de contestar: medido entre 20 y 40 s.
 * Sin esta línea Vercel corta la función mucho antes y la pregunta falla sin
 * explicación. Las Server Actions de esta ruta heredan el tope.
 */
export const maxDuration = 60;

export default async function Isabel() {
  const usuario = await exigirPermisoPortal("preguntar_isabel");

  const [previos, panorama, situacion, sinRespuesta] = await Promise.all([
    historialDeConsultas(usuario.clienteId),
    panoramaDelNegocio(usuario.clienteId),
    situacionDelNegocio(usuario.clienteId),
    preguntasSinRespuesta(usuario.clienteId),
  ]);

  const sugerencias = sugerenciasSegunSituacion(situacion);

  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      <div className="flex flex-wrap items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/isabel.webp"
          alt=""
          width={54}
          height={54}
          className="h-[54px] w-[54px] shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="h-pagina">Isabel</h1>
            <span className="sub-titulo">
              Pregúntale lo que quieras de tu negocio: ella leyó todo
            </span>
          </div>
          <p
            className="mt-1 max-w-2xl leading-relaxed"
            style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
          >
            Isabel no habla con tus clientes. Trabaja para adentro: revisa lo que tienes
            cargado, el historial de conversaciones —lo que escriben ellos y lo que responden
            ustedes— y todo lo que el portal ya detectó: quién quedó esperando, qué cobro no se
            pagó, qué cierre se dio por hecho y el informe de la semana. Si algo no está, te lo
            dice en vez de inventarlo.
          </p>
        </div>
      </div>

      {/* Lo que Isabel tiene a la vista ahora mismo. Que se vea de dónde saca
          las respuestas es lo que hace que se le crea. */}
      <div className="mt-5 flex flex-wrap gap-2">
        {[
          {
            label: `${panorama.conversaciones} conversaciones en ${panorama.dias} días`,
            destacar: false,
          },
          { label: `${panorama.esperando} esperando respuesta`, destacar: panorama.esperando > 0 },
          { label: `${panorama.citasProximas} citas por delante`, destacar: false },
          { label: `${panorama.cobrosPendientes} cobros pendientes`, destacar: false },
        ].map((c) => (
          <span
            key={c.label}
            className="rounded-full px-3 py-1.5 font-semibold"
            style={{
              fontSize: "var(--t-micro)",
              background: c.destacar ? "var(--coral)" : "#F1F2F7",
              color: c.destacar ? "#fff" : "var(--muted)",
            }}
          >
            {c.label}
          </span>
        ))}
      </div>

      <div className="mt-5">
        <IsabelConsulta
          previos={previos.map((c) => ({ pregunta: c.pregunta, respuesta: c.respuesta }))}
          sugerencias={sugerencias}
        />
      </div>

      {/* ⭐ LO QUE ISABEL NO SUPO: la lista de fichas que le faltan al negocio,
          escrita por el propio dueño. Las mismas fichas alimentan a Tino, así
          que cada línea de acá es también una pregunta que Tino no habría
          sabido contestarle a un cliente. */}
      {sinRespuesta.length > 0 && (
        <div className="tarjeta mt-6 p-5" style={{ borderLeft: "3px solid #F59E0B" }}>
          <h2 className="h-seccion">Lo que no supe responder</h2>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
            Esto no está cargado en tu negocio. Ojo: son las mismas fichas que usa Tino para
            contestarle a tus clientes, así que si a mí me faltó, a él también.
          </p>
          <ul className="mt-3 space-y-2">
            {sinRespuesta.map((p, i) => (
              <li key={i} className="flex gap-2.5 leading-snug" style={{ fontSize: "var(--t-fila)" }}>
                <span
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: "#F59E0B" }}
                />
                <span>{p.pregunta}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/informacion"
            className="mt-4 inline-block font-semibold underline"
            style={{ fontSize: "var(--t-menor)", color: "var(--indigo)" }}
          >
            Cargarlo en Información
          </Link>
        </div>
      )}

      <p
        className="mt-6 max-w-2xl px-1 leading-relaxed"
        style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
      >
        Isabel lee una muestra del historial, no los mensajes uno por uno: para contar usa las
        cifras exactas de tu panel, no su lectura. Si te da un número que no cuadra con
        Analítica, el bueno es el de Analítica — avísanos y lo corregimos.
      </p>
    </main>
  );
}
