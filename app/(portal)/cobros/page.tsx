import Link from "next/link";
import { exigirUsuarioPortal } from "@/lib/auth";
import { listarPagos, resumenPagos } from "@/lib/pagos";
import { formatearMonto, type EstadoPago } from "@/lib/pagosCore";
import { CobrosLista } from "@/components/CobrosLista";

export const dynamic = "force-dynamic";

/**
 * /COBROS — LA VISTA GLOBAL DEL DINERO.
 *
 * La tarjeta de Inicio dice CUÁNTO; esta página dice QUIÉN. Es la respuesta a la
 * pregunta que un dueño se hace cada mañana: «¿a quién le mandé cobro y no me ha
 * pagado?» — la misma que Cecilia respondía revisando conversaciones una por una
 * para perseguir comprobantes.
 *
 * El filtro por defecto es PENDIENTES a propósito: es la lista de trabajo. Los
 * pagados son historial; los anulados, ruido.
 */
export default async function PaginaCobros({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const usuario = await exigirUsuarioPortal();
  const crudo = (await searchParams).estado ?? "pendiente";
  const estado = (["pendiente", "pagado", "anulado", "todos"].includes(crudo)
    ? crudo
    : "pendiente") as EstadoPago | "todos";

  const [pagos, resumen] = await Promise.all([
    // Si la migración 289 no está aplicada, lista vacía en vez de página rota.
    listarPagos({ clienteId: usuario.clienteId, estado }).catch(() => []),
    resumenPagos(usuario.clienteId).catch(() => ({
      pendientes: 0,
      pagadosMes: 0,
      montoMes: 0,
    })),
  ]);

  const filtros: { valor: string; label: string }[] = [
    { valor: "pendiente", label: `Pendientes (${resumen.pendientes})` },
    { valor: "pagado", label: "Pagados" },
    { valor: "anulado", label: "Anulados" },
    { valor: "todos", label: "Todos" },
  ];

  return (
    <main className="mx-auto max-w-3xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="h-pagina">Cobros</h1>
        <span className="sub-titulo">
          {formatearMonto(resumen.montoMes)} cobrado este mes
        </span>
      </div>
      <p className="sub-pagina max-w-2xl" style={{ color: "var(--muted)" }}>
        Todo lo que se ha cobrado por WhatsApp. Cuando llegue la plata a tu cuenta, busca la
        referencia y márcalo pagado — o hazlo directo desde la conversación.
      </p>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {filtros.map((f) => (
          <Link
            key={f.valor}
            href={f.valor === "pendiente" ? "/cobros" : `/cobros?estado=${f.valor}`}
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
        <CobrosLista pagos={pagos} />
      </div>
    </main>
  );
}
