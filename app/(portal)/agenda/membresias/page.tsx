import { exigirUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { listarMembresiasOperacionales } from "@/lib/memberships/membershipsOperations";
import AgendaSubnav from "@/components/agenda/AgendaSubnav";
import MembresiasOperaciones from "@/components/agenda/MembresiasOperaciones";
import {
  obtenerDetalleMembresiaAccion,
  ajusteManualCreditosAccion,
  renovarMembresiaAccion,
} from "./acciones";

export const dynamic = "force-dynamic";

export default async function MembresiasPage() {
  const usuario = await exigirUsuarioPortal();
  const supa = db();

  const [{ data: cliente }, { membresias, kpis }] = await Promise.all([
    supa
      .from("ed_clientes")
      .select("commerce_booking_v1_activo")
      .eq("id", usuario.clienteId)
      .maybeSingle(),
    listarMembresiasOperacionales(usuario.clienteId, supa),
  ]);

  const commerceActivo = Boolean(cliente?.commerce_booking_v1_activo);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
      {/* ── Subnavegación unificada de Agenda ───────────────────────────── */}
      <AgendaSubnav activo="membresias" commerceActivo={commerceActivo} />

      {/* ── Cabecera ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Agenda · Membresías</div>
          <h1 className="h-pagina">Membresías y Créditos</h1>
          <p className="mt-1 text-[14.5px]" style={{ color: "var(--muted)" }}>
            Supervisa los planes de tus socios, saldos de créditos y auditoría del ledger en tiempo real.
          </p>
        </div>
      </div>

      {/* ── Panel Operacional de Membresías ─────────────────────────────── */}
      <div className="mt-6">
        <MembresiasOperaciones
          membresias={membresias}
          kpis={kpis}
          onObtenerDetalle={obtenerDetalleMembresiaAccion}
          onAjustarCreditos={ajusteManualCreditosAccion}
          onRenovarMembresia={renovarMembresiaAccion}
        />
      </div>
    </main>
  );
}
