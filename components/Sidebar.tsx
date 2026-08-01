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
  agenda: (
    <path d="M8 3v3m8-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM9 14l2 2 4-4" />
  ),
  analitica: <path d="M4 20V10m5 10V4m5 16v-7m5 7V8" />,
  embudo: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  clientes: <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.8a3.5 3.5 0 0 1 0 6.4" />,
  informe: (
    <path d="M9 4h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2V5a1 1 0 0 1 1-1zM9 12h6M9 16h4" />
  ),
};

/**
 * Menú agrupado por VERBO, no por funcionalidad.
 *
 * Antes eran 10 secciones planas en una sola lista. Diez opciones sin jerarquía
 * obligan a leerlas todas cada vez, y las tres que se usan a diario quedaban al
 * mismo nivel que las que se tocan una vez al mes (WhatsApp, Información).
 *
 * Los cuatro grupos responden a lo que la persona viene a hacer:
 *  · Atender  — hay alguien esperando ahora
 *  · Vender   — en qué va cada oportunidad
 *  · Entender — funcionó o no funcionó
 *  · Configurar — se toca al principio y casi nunca más
 *
 * "Inicio" queda fuera de los grupos a propósito: no es una tarea, es el punto
 * de partida que responde las tres preguntas de una.
 */
type ItemMenu = {
  href: string;
  label: string;
  icono: JSX.Element;
  /** De dónde sale el número que va a la derecha, si corresponde. */
  contador?: "esperando" | "porCerrar";
};

const GRUPOS: { titulo: string; items: ItemMenu[] }[] = [
  {
    titulo: "Atender",
    items: [
      { href: "/inicio", label: "Inicio", icono: Icono.inicio },
      {
        href: "/conversaciones",
        label: "Conversaciones",
        icono: Icono.chat,
        contador: "esperando",
      },
      { href: "/agenda", label: "Agenda", icono: Icono.agenda },
    ],
  },
  {
    titulo: "Vender",
    items: [
      { href: "/embudo", label: "Embudo", icono: Icono.embudo, contador: "porCerrar" },
      { href: "/clientes", label: "Clientes", icono: Icono.clientes },
    ],
  },
  {
    titulo: "Entender",
    items: [
      { href: "/analitica", label: "Analítica", icono: Icono.analitica },
      { href: "/insights", label: "Informe", icono: Icono.informe },
    ],
  },
  {
    titulo: "Configurar",
    items: [
      { href: "/informacion", label: "Información", icono: Icono.info },
      { href: "/probar", label: "Probar ahora", icono: Icono.probar },
      { href: "/whatsapp", label: "WhatsApp", icono: Icono.enchufe },
    ],
  },
];

/** Lista plana. La usa el móvil, donde el menú es una fila desplazable y los
    rótulos de grupo no caben ni aportan. */
const ITEMS = GRUPOS.flatMap((g) => g.items);

/**
 * Un ítem del menú. Vive aparte porque ahora se pinta en dos lugares —la fila
 * de móvil y la columna agrupada de escritorio— y tenerlo duplicado garantizaba
 * que tarde o temprano quedaran distintos.
 *
 * Ítem activo: fondo tenue + barra de acento a la izquierda, el patrón de
 * Linear/Notion. Antes era un bloque índigo sólido con resplandor: llamaba más
 * la atención que el contenido de la página, que es lo que el usuario vino a
 * mirar.
 */
function ItemNav({
  item,
  activo,
  valor,
}: {
  item: ItemMenu;
  activo: boolean;
  /** Número a la derecha. 0 o undefined = no se pinta nada. */
  valor?: number;
}) {
  /**
   * El contador de "te esperan" va en coral y el resto en índigo tenue.
   *
   * Es la única regla de color fuerte del sistema: el coral significa
   * EXCLUSIVAMENTE "alguien te está esperando". Si se usara también para el
   * embudo o para cualquier otro contador, dejaría de significar nada y el
   * dueño perdería la señal que más le importa.
   */
  const urgente = item.contador === "esperando";
  return (
    <Link
      href={item.href}
      aria-current={activo ? "page" : undefined}
      className="flex shrink-0 items-center gap-2.5 whitespace-nowrap px-3 py-[7px] transition-colors duration-100"
      style={{
        borderRadius: "var(--r-input)",
        fontSize: "var(--t-fila)",
        fontWeight: activo ? 600 : 500,
        border: "1px solid transparent",
        ...(activo
          ? {
              background: "var(--nav-activo)",
              color: "var(--nav-texto-activo)",
              borderColor: "var(--nav-borde)",
              boxShadow: "var(--sombra)",
            }
          : { color: "var(--nav-texto)" }),
      }}
      onMouseEnter={(e) => {
        if (activo) return;
        e.currentTarget.style.background = "var(--nav-hover)";
        e.currentTarget.style.color = "var(--nav-texto-activo)";
      }}
      onMouseLeave={(e) => {
        if (activo) return;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--nav-texto)";
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={activo ? "opacity-90" : "opacity-50"}
      >
        {item.icono}
      </svg>
      <span className="flex-1">{item.label}</span>
      {valor ? (
        <span
          className="cifra shrink-0 px-1.5 py-[1px] font-semibold"
          style={{
            borderRadius: "var(--r-chico)",
            fontSize: "var(--t-micro)",
            background: urgente ? "var(--coral)" : "var(--indigo-suave)",
            color: urgente ? "#fff" : "var(--indigo)",
          }}
        >
          {valor}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Barra lateral CLARA (cambio del rediseño 31-jul).
 *
 * Antes era un riel oscuro #12142e, por el patrón de Linear/Notion. Funcionaba,
 * pero traía dos costos: obligaba a mantener una paleta de grises aparte que no
 * conversaba con el resto del sistema, y en móvil —donde el menú es una franja
 * arriba— ponía una banda negra sobre una pantalla clara cada vez que se abría
 * el portal. En claro, el ítem activo se resuelve como lo que realmente es: una
 * tarjeta blanca sobre el lienzo, con el mismo borde de 1 px que todo lo demás.
 *
 * En escritorio es barra lateral con los cuatro grupos; bajo 1024px, fila
 * desplazable arriba.
 */
export default function Sidebar({
  clienteNombre,
  clienteRubro,
  email,
  esperando = 0,
  porCerrar = 0,
}: {
  clienteNombre: string;
  clienteRubro?: string;
  email: string;
  /** Conversaciones derivadas sin atender. Va en coral: es lo único urgente. */
  esperando?: number;
  /** Oportunidades abiertas en el embudo. */
  porCerrar?: number;
}) {
  const ruta = usePathname();
  const contadores = { esperando, porCerrar } as const;
  const valorDe = (it: ItemMenu) => (it.contador ? contadores[it.contador] : undefined);

  return (
    <aside
      className="flex shrink-0 flex-col px-3 py-3 lg:min-h-screen lg:w-[248px] lg:py-4"
      style={{ background: "var(--nav-bg)", borderRight: "1px solid var(--nav-borde)" }}
    >
      {/* Marca */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/isotipo.svg" alt="" width={30} height={30} className="shrink-0" />
          <div className="leading-tight">
            <div className="font-semibold tracking-tight" style={{ fontSize: "var(--t-titulo)" }}>
              Respondo
            </div>
            <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
              Portal del cliente
            </div>
          </div>
        </div>

        {/* En móvil la salida va aquí, para no gastar una fila entera */}
        <form action="/auth/salir" method="post" className="lg:hidden">
          <button
            type="submit"
            className="font-semibold underline"
            style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
          >
            Salir
          </button>
        </form>
      </div>

      {/* Negocio — tarjeta blanca sobre el lienzo, igual que el ítem activo */}
      <div className="tarjeta mt-3 hidden px-2.5 py-2 lg:block">
        <div className="flex items-center gap-2">
          <span className="punto-vivo" aria-hidden="true" />
          <div className="truncate font-semibold" style={{ fontSize: "var(--t-fila)" }}>
            {clienteNombre}
          </div>
        </div>
        {clienteRubro && (
          <div
            className="mt-0.5 truncate pl-4 capitalize"
            style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
          >
            {clienteRubro}
          </div>
        )}
      </div>

      {/* Móvil: fila desplazable, sin rótulos de grupo (no caben y estorban) */}
      <nav className="-mx-1 mt-3 flex gap-1 overflow-x-auto px-1 pb-1 lg:hidden">
        {ITEMS.map((it) => (
          <ItemNav
            key={it.href}
            item={it}
            activo={ruta.startsWith(it.href)}
            valor={valorDe(it)}
          />
        ))}
      </nav>

      {/* Escritorio: los cuatro grupos */}
      <nav className="mt-5 hidden flex-col lg:flex">
        {GRUPOS.map((g, i) => (
          <div key={g.titulo} className={i ? "mt-4" : ""}>
            <div
              className="px-3 pb-1 font-semibold uppercase"
              style={{
                fontSize: "var(--t-columna)",
                color: "var(--nav-grupo)",
                letterSpacing: "0.07em",
              }}
            >
              {g.titulo}
            </div>
            <div className="flex flex-col gap-0.5">
              {g.items.map((it) => (
                <ItemNav
                  key={it.href}
                  item={it}
                  activo={ruta.startsWith(it.href)}
                  valor={valorDe(it)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Pie (solo escritorio) */}
      <div
        className="mt-auto hidden pt-3 lg:block"
        style={{ borderTop: "1px solid var(--nav-borde)" }}
      >
        <div
          className="truncate px-1"
          style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
          title={email}
        >
          {email}
        </div>
        <form action="/auth/salir" method="post">
          <button
            type="submit"
            className="mt-1 px-1 font-medium"
            style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  );
}
