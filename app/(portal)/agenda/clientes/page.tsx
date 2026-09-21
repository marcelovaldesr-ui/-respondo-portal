import { exigirUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { buscarClientesOperacionales } from "@/lib/clients/clientsOperations";
import AgendaSubnav from "@/components/agenda/AgendaSubnav";
import ClientesOperaciones from "@/components/agenda/ClientesOperaciones";
import {
  buscarClientesAccion,
  obtenerFichaClienteAccion,
  ajusteManualCreditosClienteAccion,
  renovarMembresiaClienteAccion,
} from "./acciones";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const usuario = await exigirUsuarioPortal();
  const supa = db();

  const [{ data: cliente }, clientesIniciales] = await Promise.all([
    supa
      .from("ed_clientes")
      .select("commerce_booking_v1_activo")
      .eq("id", usuario.clienteId)
      .maybeSingle(),
    buscarClientesOperacionales(usuario.clienteId, "", supa),
  ]);

  const commerceActivo = Boolean(cliente?.commerce_booking_v1_activo);

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
          onBuscar={buscarClientesAccion}
          onObtenerFicha={obtenerFichaClienteAccion}
          onAjustarCreditos={ajusteManualCreditosClienteAccion}
          onRenovarMembresia={renovarMembresiaClienteAccion}
        />
      </div>
    </main>
  );
}
