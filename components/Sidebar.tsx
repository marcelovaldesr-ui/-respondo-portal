"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* Iconos line-art, en línea con la identidad de la web (nada de emojis). */
const Icono = {
  inicio: <path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  chat: <path d="M21 12a8 8 0 0 1-8 8H4l1.8-3.2A8 8 0 1 1 21 12z" />,
  probar: (
    <path d="M12 3v3m0 12v3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M3 12h3m12 0h3M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 1 0 12 8.5z" />
  ),
  info: <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 11h8M8 15h5" />,
  enchufe: (
    <path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5zM12 16v5" />
  ),
};

const ITEMS = [
  { href: "/inicio", label: "Inicio", icono: Icono.inicio },
  { href: "/conversaciones", label: "Conversaciones", icono: Icono.chat },
  { href: "/probar", label: "Probar ahora", icono: Icono.probar },
  { href: "/informacion", label: "Información", icono: Icono.info },
  { href: "/whatsapp", label: "WhatsApp", icono: Icono.enchufe },
];

/**
 * En escritorio es una barra lateral; bajo 1024px se convierte en una barra
 * superior con la navegación en fila. Sin cajón desplegable a propósito: un
 * menú hamburguesa necesita estado y se rompe de formas raras — con 4 ítems,
 * una fila que se desplaza es más simple y no falla.
 */
export default function Sidebar({
  clienteNombre,
  clienteRubro,
  email,
}: {
  clienteNombre: string;
  clienteRubro?: string;
  email: string;
}) {
  const ruta = usePathname();

  return (
    <aside
      className="flex shrink-0 flex-col border-b bg-white px-4 py-3 lg:min-h-screen lg:w-[252px] lg:border-b-0 lg:border-r lg:py-5"
      style={{ borderColor: "var(--borde)" }}
    >
      {/* Marca + salida rápida en móvil */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 px-0 lg:px-2 lg:pt-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/isotipo.svg" alt="" width={34} height={34} className="shrink-0" />
          <div className="leading-tight">
            <div className="titular text-[18px] font-extrabold tracking-tight">
              Respondo
            </div>
            <div
              className="text-[10.5px] font-bold uppercase"
              style={{ color: "var(--muted-2)", letterSpacing: "0.1em" }}
            >
              Portal del cliente
            </div>
          </div>
        </div>

        {/* En móvil el negocio va aquí, a la derecha, para no gastar una fila */}
        <div className="text-right lg:hidden">
          <div className="truncate text-[14px] font-bold">{clienteNombre}</div>
          <form action="/auth/salir" method="post">
            <button
              type="submit"
              className="text-[12px] font-semibold underline"
              style={{ color: "var(--muted-2)" }}
            >
              Salir
            </button>
          </form>
        </div>
      </div>

      {/* Negocio (solo escritorio) */}
      <div
        className="mt-5 hidden rounded-xl px-3 py-3 lg:block"
        style={{ background: "var(--fondo)" }}
      >
        <div className="truncate text-[15px] font-bold">{clienteNombre}</div>
        {clienteRubro && (
          <div className="truncate text-[12px] capitalize" style={{ color: "var(--muted)" }}>
            {clienteRubro}
          </div>
        )}
      </div>

      {/* Navegación: fila desplazable en móvil, columna en escritorio */}
      <nav className="-mx-1 mt-3 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:mt-6 lg:flex-col lg:overflow-visible lg:pb-0">
        {ITEMS.map((it) => {
          const activo = ruta.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={
                "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-[14.5px] font-semibold transition lg:gap-3 lg:text-[15px] " +
                (activo ? "text-white" : "hover:bg-[#F3F4F9]")
              }
              style={activo ? { background: "var(--indigo)" } : { color: "var(--tinta)" }}
            >
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={activo ? "opacity-95" : "opacity-55"}
              >
                {it.icono}
              </svg>
              {it.label}
            </Link>
          );
        })}
      </nav>

      {/* Pie (solo escritorio) */}
      <div
        className="mt-auto hidden border-t pt-4 lg:block"
        style={{ borderColor: "var(--borde)" }}
      >
        <div
          className="truncate px-1 text-[12px]"
          style={{ color: "var(--muted-2)" }}
          title={email}
        >
          {email}
        </div>
        <form action="/auth/salir" method="post">
          <button
            type="submit"
            className="mt-1.5 px-1 text-[13px] font-semibold transition hover:underline"
            style={{ color: "var(--muted)" }}
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  );
}
