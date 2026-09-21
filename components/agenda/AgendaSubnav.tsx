"use client";

import Link from "next/link";

export type SeccionAgenda = "calendario" | "clases" | "membresias" | "clientes" | "configuracion";

export default function AgendaSubnav({
  activo,
  commerceActivo = true,
}: {
  activo: SeccionAgenda;
  commerceActivo?: boolean;
}) {
  const tabs = [
    { id: "calendario", label: "Calendario", href: "/agenda", visible: true },
    { id: "clases", label: "Clases", href: "/agenda/clases", visible: commerceActivo },
    { id: "membresias", label: "Membresías", href: "/agenda/membresias", visible: commerceActivo },
    { id: "clientes", label: "Clientes", href: "/agenda/clientes", visible: commerceActivo },
    { id: "configuracion", label: "Configuración", href: "/agenda/configuracion", visible: true },
  ].filter((t) => t.visible);

  return (
    <nav
      className="mb-6 flex items-center gap-2 overflow-x-auto border-b pb-2 pt-1"
      style={{ borderColor: "var(--borde)" }}
      aria-label="Subnavegación de Agenda"
    >
      {tabs.map((tab) => {
        const esActivo = activo === tab.id;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`whitespace-nowrap px-3.5 py-1.5 text-[14px] font-medium transition-colors ${
              esActivo
                ? "rounded-md font-semibold text-[var(--texto)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--texto)]"
            }`}
            style={{
              background: esActivo ? "var(--fondo-fila, #f1f5f9)" : "transparent",
              color: esActivo ? "var(--texto)" : "var(--muted)",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
