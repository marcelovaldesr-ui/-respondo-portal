import Link from "next/link";
import { exigirUsuarioPortal } from "@/lib/auth";
import { listarPropuestas } from "@/lib/propuestasSeguimiento";
import { PropuestasLista } from "@/components/PropuestasLista";

export const dynamic = "force-dynamic";

/**
 * /SEGUIMIENTOS — LO QUE BETO QUIERE ESCRIBIR, ANTES DE QUE SALGA.
 *
 * Cada aprobación de esta pantalla es un mensaje de MARKETING de ~$85 a un
 * número real. Por eso la página no está armada como una bandeja de tareas sino
 * como una decisión: primero lo que se cotizó, después por qué el asistente
 * cree que quedó abierta, y al lado el último mensaje REAL de la conversación
 * —leído recién ahora, no cuando se generó la propuesta— por si el cliente
 * escribió en el intertanto y el «¿sigue en pie?» quedó fuera de lugar.
 *
 * «No» no es descartar: queda guardado. Es el único dato que va a decir si el
 * juez afina o se equivoca, y con eso se ajusta el prompt con evidencia.
 */
export default async function PaginaSeguimientos({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const usuario = await exigirUsuarioPortal();
  const crudo = (await searchParams).estado ?? "propuesto";
  const estado = ["propuesto", "aprobado", "rechazado"].includes(crudo) ? crudo : "propuesto";

  // Si la migración 297 no está aplicada, lista vacía en vez de página rota.
  const propuestas = await listarPropuestas({ clienteId: usuario.clienteId, estado }).catch(
    () => [],
  );

  const filtros = [
    { valor: "propuesto", label: "Por revisar" },
    { valor: "aprobado", label: "Aprobados" },
    { valor: "rechazado", label: "Descartados" },
  ];

  return (
    <main className="mx-auto max-w-3xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="h-pagina">Seguimientos</h1>
        {estado === "propuesto" && propuestas.length > 0 && (
          <span className="sub-titulo">{propuestas.length} por revisar</span>
        )}
      </div>
      <p className="sub-pagina max-w-2xl" style={{ color: "var(--muted)" }}>
        Cotizaciones que quedaron sin respuesta y que el asistente propone retomar. Revisa
        cada una: al aprobar sale un mensaje de WhatsApp a esa persona.
      </p>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {filtros.map((f) => (
          <Link
            key={f.valor}
            href={f.valor === "propuesto" ? "/seguimientos" : `/seguimientos?estado=${f.valor}`}
            className="rounded-full px-3 py-1.5 text-[12.5px] font-medium"
            style={
              estado === f.valor
                ? { background: "var(--indigo)", color: "#fff" }
                : { background: "#F1F2F7", color: "var(--muted)" }
            }
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="mt-4">
        <PropuestasLista
          propuestas={propuestas}
          negocio={usuario.clienteNombre}
          soloLectura={estado !== "propuesto"}
        />
      </div>
    </main>
  );
}
