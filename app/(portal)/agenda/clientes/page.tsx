import { redirect } from "next/navigation";
import { exigirUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { commerceActivoParaCliente } from "@/lib/commerce/featureFlag";
import { buscarClientesOperacionales, obtenerFichaClienteOperacional } from "@/lib/clients/clientsOperations";
import AgendaSubnav from "@/components/agenda/AgendaSubnav";
import ClientesOperaciones from "@/components/agenda/ClientesOperaciones";
import {
  buscarClientesAccion,
  obtenerFichaClienteAccion,
  ajusteManualCreditosClienteAccion,
  renovarMembresiaClienteAccion,
} from "./acciones";

export const dynamic = "force-dynamic";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; contacto?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const busquedaInicial = typeof params?.q === "string" ? params.q.slice(0, 80) : "";
  const contactoInicialId = typeof params?.contacto === "string" ? params.contacto : null;
  const usuario = await exigirUsuarioPortal();
  const supa = db();

  const commerceActivo = await commerceActivoParaCliente(usuario.clienteId, supa);
  if (!commerceActivo) redirect("/agenda");

  const [clientesIniciales, fichaInicial] = await Promise.all([
    buscarClientesOperacionales(usuario.clienteId, busquedaInicial, supa),
    contactoInicialId
      ? obtenerFichaClienteOperacional(usuario.clienteId, contactoInicialId, supa)
      : Promise.resolve(null),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
      {/* ── Subnavegación unificada de Agenda ───────────────────────────── */}
      <AgendaSubnav activo="clientes" commerceActivo={commerceActivo} />

      {/* ── Cabecera ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Agenda · Clientes</div>
          <h1 className="h-pagina">Fichas de Clientes</h1>
          <p className="mt-1 text-[14.5px]" style={{ color: "var(--muted)" }}>
            Búsqueda rápida por nombre, teléfono o email con estado de membresía, reservas y créditos.
          </p>
        </div>
      </div>

      {/* ── Panel Operacional de Clientes ───────────────────────────────── */}
      <div className="mt-6">
        <ClientesOperaciones
          clientesIniciales={clientesIniciales}
          busquedaInicial={busquedaInicial}
          fichaInicial={fichaInicial}
          onBuscar={buscarClientesAccion}
          onObtenerFicha={obtenerFichaClienteAccion}
          onAjustarCreditos={ajusteManualCreditosClienteAccion}
          onRenovarMembresia={renovarMembresiaClienteAccion}
        />
      </div>
    </main>
  );
}
