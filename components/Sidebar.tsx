"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactElement } from "react";

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
  cobros: <path d="M12 3v18M8 7.5C8 6 9.5 5 12 5s4 1 4 2.5S14.5 10 12 10s-4 1-4 2.5S9.5 15 12 15s4-1 4-2.5M8 16.5C8 18 9.5 19 12 19" />,
  clientes: <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.8a3.5 3.5 0 0 1 0 6.4" />,
  informe: (
    <path d="M9 4h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2V5a1 1 0 0 1 1-1zM9 12h6M9 16h4" />
  ),
  /* Plegar / desplegar la barra (solo escritorio). */
  plegar: <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />,
  desplegar: <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />,
};

/**
 * Recuerdo de "barra plegada" entre visitas, por dispositivo. Misma idea que
 * `ic_sidebar_colapsado` en Gestión: quien pliega el menú para ganar ancho no
 * quiere volver a plegarlo cada vez que entra.
 */
const CLAVE_PLEGADA = "respondo_sidebar_plegada";

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
  icono: ReactElement;
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
      { href: "/cobros", label: "Cobros", icono: Icono.cobros },
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
  plegado = false,
}: {
  item: ItemMenu;
  activo: boolean;
  /** Número a la derecha. 0 o undefined = no se pinta nada. */
  valor?: number;
  /**
   * Barra plegada (escritorio): solo el icono, centrado, con el nombre en el
   * tooltip y el contador como puntito en la esquina, para que "te esperan"
   * no desaparezca junto con la etiqueta.
   */
  plegado?: boolean;
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
      title={plegado ? (valor ? `${item.label} · ${valor}` : item.label) : undefined}
      className={`relative flex shrink-0 items-center whitespace-nowrap py-[7px] transition-colors duration-100 ${
        plegado ? "justify-center px-0" : "gap-2.5 px-3"
      }`}
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
      {plegado ? (
        valor ? (
          <span
            aria-hidden="true"
            className="absolute right-2 top-1.5 h-2 w-2 rounded-full"
            style={{ background: urgente ? "var(--coral)" : "var(--indigo)" }}
          />
        ) : null
      ) : (
        <span className="flex-1">{item.label}</span>
      )}
      {!plegado && valor ? (
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
  rol,
  esperando = 0,
  porCerrar = 0,
}: {
  clienteNombre: string;
  clienteRubro?: string;
  email: string;
  rol: "dueno" | "staff";
  /** Conversaciones derivadas sin atender. Va en coral: es lo único urgente. */
  esperando?: number;
  /** Oportunidades abiertas en el embudo. */
  porCerrar?: number;
}) {
  const ruta = usePathname();

  /**
   * PLEGAR LA BARRA (escritorio).
   *
   * Conversaciones es lista + chat + contexto: tres columnas que compiten con
   * estos 248px. En vez de angostarlas para siempre, la persona decide: pliega
   * la barra a solo iconos cuando necesita el ancho, y la despliega cuando
   * quiere leer las etiquetas. Se recuerda entre visitas. Bajo `lg` no aplica:
   * ahí el menú es la fila de arriba y no compite por ancho.
   */
  const [plegada, setPlegada] = useState(false);
  useEffect(() => {
    try {
      setPlegada(localStorage.getItem(CLAVE_PLEGADA) === "1");
    } catch {
      // Sin localStorage (privado/bloqueado): queda desplegada, como siempre.
    }
  }, []);
  function alternarPlegada() {
    setPlegada((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CLAVE_PLEGADA, next ? "1" : "0");
      } catch {
        // Se pierde el recuerdo entre visitas; el botón sigue funcionando.
      }
      return next;
    });
  }

  const visible = (it: ItemMenu) =>
    rol === "dueno" || !["/informacion", "/whatsapp"].includes(it.href);
  const contadores = { esperando, porCerrar } as const;
  const valorDe = (it: ItemMenu) => (it.contador ? contadores[it.contador] : undefined);

  return (
    <aside
      className={`flex shrink-0 flex-col py-3 transition-[width] duration-150 lg:min-h-screen lg:py-4 ${
        plegada ? "px-3 lg:w-[64px] lg:px-2" : "px-3 lg:w-[248px]"
      }`}
      style={{ background: "var(--nav-bg)", borderRight: "1px solid var(--nav-borde)" }}
    >
      {/* Marca */}
      <div className={`flex items-center justify-between gap-3 px-1 ${plegada ? "lg:flex-col lg:gap-2 lg:px-0" : ""}`}>
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/isotipo.svg" alt="" width={30} height={30} className="shrink-0" />
          <div className={`leading-tight ${plegada ? "lg:hidden" : ""}`}>
            <div className="font-semibold tracking-tight" style={{ fontSize: "var(--t-titulo)" }}>
              Respondo
            </div>
            <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
              Portal del cliente
            </div>
          </div>
        </div>

        {/* Plegar/desplegar: solo escritorio. En móvil el menú es la fila de
            arriba y no hay nada que plegar. */}
        <button
          type="button"
          onClick={alternarPlegada}
          title={plegada ? "Desplegar menú" : "Plegar menú"}
          aria-label={plegada ? "Desplegar menú" : "Plegar menú"}
          aria-expanded={!plegada}
          className="hidden shrink-0 rounded-md p-1.5 transition-colors lg:block"
          style={{ color: "var(--nav-texto)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--nav-hover)";
            e.currentTarget.style.color = "var(--nav-texto-activo)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--nav-texto)";
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {plegada ? Icono.desplegar : Icono.plegar}
          </svg>
        </button>

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
      <div className={`tarjeta mt-3 hidden px-2.5 py-2 ${plegada ? "" : "lg:block"}`}>
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
        {ITEMS.filter(visible).map((it) => (
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
        {GRUPOS.map((g) => ({ ...g, items: g.items.filter(visible) }))
          .filter((g) => g.items.length > 0)
          .map((g, i) => (
          <div key={g.titulo} className={i ? (plegada ? "mt-3" : "mt-4") : ""}>
            <div
              className={`px-3 pb-1 font-semibold uppercase ${plegada ? "hidden" : ""}`}
              style={{
                fontSize: "var(--t-columna)",
                color: "var(--nav-grupo)",
                letterSpacing: "0.07em",
              }}
            >
              {g.titulo}
            </div>
            {/* Plegada: una línea fina separa los grupos en vez del rótulo */}
            {plegada && i > 0 && (
              <div className="mx-2 mb-2" style={{ borderTop: "1px solid var(--nav-borde)" }} />
            )}
            <div className="flex flex-col gap-0.5">
              {g.items.map((it) => (
                <ItemNav
                  key={it.href}
                  item={it}
                  activo={ruta.startsWith(it.href)}
                  valor={valorDe(it)}
                  plegado={plegada}
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
          className={`truncate px-1 ${plegada ? "hidden" : ""}`}
          style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
          title={email}
        >
          {email}
        </div>
        <form action="/auth/salir" method="post" className={plegada ? "flex justify-center" : ""}>
          <button
            type="submit"
            className={plegada ? "rounded-md p-1.5" : "mt-1 px-1 font-medium"}
            style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
            title={plegada ? `Cerrar sesión (${email})` : undefined}
            aria-label="Cerrar sesión"
          >
            {plegada ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9" />
              </svg>
            ) : (
              "Cerrar sesión"
            )}
          </button>
        </form>
      </div>
    </aside>
  );
}
