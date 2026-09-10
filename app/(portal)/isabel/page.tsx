import { exigirPermisoPortal } from "@/lib/auth";
import { historialDeConsultas, panoramaDelNegocio } from "@/lib/isabel";
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

  const [previos, panorama] = await Promise.all([
    historialDeConsultas(usuario.clienteId),
    panoramaDelNegocio(usuario.clienteId),
  ]);

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
            Isabel no habla con tus clientes. Trabaja para adentro: revisa lo que tienes cargado
            y el historial completo de conversaciones para contestarte a ti. Si algo no está,
            te lo dice en vez de inventarlo.
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
        />
      </div>

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
