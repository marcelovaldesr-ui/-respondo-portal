import Link from "next/link";
import { exigirUsuarioPortal } from "@/lib/auth";
import { listarClientes } from "@/lib/clientes";
import { ETAPAS, metaEtapa } from "@/lib/embudo";
import { metaEtiqueta } from "@/lib/etiquetas";

export const dynamic = "force-dynamic";

/**
 * Cuándo fue el último contacto, en el detalle que corresponde.
 *
 * Antes devolvía "hoy" para todo lo del día. La tabla está ordenada por último
 * contacto, así que las primeras once filas decían "hoy, hoy, hoy…": una
 * columna entera sin información, justo la que sirve para decidir a quién
 * retomar. Dentro del día lo que importa es la HORA; a partir de ayer, el día.
 */
function ultimoContacto(iso: string | null, dias: number | null): string {
  if (!iso || dias === null) return "—";
  if (dias === 0) {
    return new Intl.DateTimeFormat("es-CL", {
      timeZone: "America/Santiago",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  }
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} d`;
  const m = Math.floor(dias / 30);
  return `hace ${m} ${m === 1 ? "mes" : "meses"}`;
}

/**
 * Iniciales del cliente. Mismo criterio que en la bandeja: contactos que son
 * solo emoji, sin nombre o puro número existen de verdad en esta base.
 */
function Iniciales({ nombre }: { nombre: string }) {
  const letras = (nombre.match(/\p{L}+/gu) ?? [])
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  const texto = letras || nombre.replace(/\D/g, "").slice(-2) || "?";
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center font-semibold"
      style={{
        borderRadius: "var(--r-pill)",
        fontSize: "var(--t-micro)",
        background: "var(--fondo-hundido)",
        color: "var(--muted)",
      }}
    >
      {texto}
    </span>
  );
}

export default async function Clientes({
  searchParams,
}: {
  searchParams: { q?: string; etapa?: string; p?: string };
}) {
  const usuario = await exigirUsuarioPortal();
  const q = (searchParams.q ?? "").trim();
  const etapa = searchParams.etapa;
  const todos = await listarClientes(usuario.clienteId, { q, etapa });

  /**
   * PAGINACIÓN.
   *
   * Se pintaban los 101 clientes de una: 5.924 px de página. Con 400 clientes
   * al sexto mes serían ~23.000 px y el navegador montando 400 filas en cada
   * carga. Nadie recorre una tabla de 400 filas a scroll —para eso está el
   * buscador— así que el largo infinito no aporta nada y cuesta cada vez más.
   *
   * El corte se aplica DESPUÉS de filtrar, así el buscador sigue mirando todo.
   */
  const POR_PAGINA = 25;
  const paginas = Math.max(1, Math.ceil(todos.length / POR_PAGINA));
  // Si el filtro deja menos páginas que la actual, se vuelve a la primera en vez
  // de mostrar una tabla vacía sin explicación.
  const pagina = Math.min(Math.max(1, Number(searchParams.p ?? 1) || 1), paginas);
  const desde = (pagina - 1) * POR_PAGINA;
  const clientes = todos.slice(desde, desde + POR_PAGINA);

  const urlCon = (cambios: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    // Cualquier cambio de filtro vuelve a la página 1: quedarse en la 4 de un
    // resultado que ahora tiene 2 páginas es la forma más rápida de que el
    // usuario crea que su búsqueda no encontró nada.
    for (const [k, v] of Object.entries({ q, etapa, p: undefined, ...cambios }))
      if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/clientes?${s}` : "/clientes";
  };

  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      {/* Cabecera en una línea, igual que el resto del portal. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="h-pagina">Clientes</h1>
        <span className="sub-titulo">
          {todos.length} {todos.length === 1 ? "persona" : "personas"}
          {(q || etapa) && " que coinciden"}
        </span>
      </div>

      <form action="/clientes" method="get" className="mt-5 flex gap-2">
        {etapa && <input type="hidden" name="etapa" value={etapa} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre, número o nota…"
          className="campo w-full max-w-[380px]"
        />
        <button type="submit" className="btn-suave shrink-0">
          Buscar
        </button>
        {(q || etapa) && (
          <Link href="/clientes" className="btn-suave flex shrink-0 items-center">
            Limpiar
          </Link>
        )}
      </form>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Link
          href={urlCon({ etapa: undefined })}
          className="pildora"
          style={
            !etapa
              ? { background: "var(--indigo)", color: "#fff" }
              : { background: "#F1F2F7", color: "var(--muted)" }
          }
        >
          Todos
        </Link>
        {ETAPAS.map((e) => (
          <Link
            key={e.valor}
            href={urlCon({ etapa: e.valor })}
            className="pildora"
            style={
              etapa === e.valor
                ? { background: e.color, color: "#fff" }
                : { background: e.fondo, color: e.color }
            }
          >
            {e.label}
          </Link>
        ))}
      </div>

      {/* Se pregunta por el TOTAL, no por la página: con la paginación, mirar el
          slice haría que un número de página fuera de rango se viera como "no
          hay clientes" en vez de como lo que es. */}
      {todos.length === 0 ? (
        <div className="tarjeta vacio mt-4">
          <div className="vacio-titulo">
            {q || etapa ? "Nadie coincide con eso" : "Todavía no hay clientes"}
          </div>
          <p className="vacio-texto">
            {q || etapa
              ? "Prueba con otro nombre, número o etapa."
              : "Aparecen solos acá cuando alguien le escribe a tu asistente."}
          </p>
        </div>
      ) : (
        /* Tabla: es una lista de datos comparables, no tarjetas. Se lee más
           rápido y aprovecha el ancho. En móvil se desplaza en horizontal.
           Ahora usa la clase .tabla del sistema, así una pantalla nueva hereda
           el mismo tratamiento sin volver a escribirlo. */
        <div className="tarjeta mt-4 overflow-x-auto p-0">
          {/*
            EN MÓVIL SE ESCONDEN DOS COLUMNAS, NO SE ARRASTRA LA TABLA.

            Estaba a min-w-680px dentro de un contenedor con scroll horizontal:
            en un teléfono de 390px había que arrastrar de lado para ver la etapa
            y el último contacto, que son justo las dos cosas que uno viene a
            mirar. Y el dueño abre esto desde el celular entre un cliente y otro.

            "Mensajes" es contexto, no decisión, y "Ver ficha" sobra porque la
            fila entera ya es un enlace. Fuera las dos en pantalla chica y la
            tabla cabe sin arrastrar.
          */}
          <table className="tabla min-w-0 sm:min-w-[680px]">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Etapa</th>
                <th className="hidden text-right sm:table-cell">Mensajes</th>
                <th className="text-right">Último</th>
                <th className="hidden sm:table-cell" />
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => {
                const me = metaEtapa(c.etapa);
                // Una sola etiqueta en la tabla. Con dos, la columna Cliente
                // pasaba a tener más color que texto y el nombre —que es lo que
                // se busca— dejaba de destacar.
                const principal = c.etiquetas[0];
                const resto = c.etiquetas.length - (principal ? 1 : 0);
                return (
                  <tr key={c.chatId}>
                    <td>
                      <Link href={`/clientes/${c.chatId}`} className="flex items-center gap-2.5">
                        <Iniciales nombre={c.nombre} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                              {c.nombre}
                            </span>
                            {c.esperandoHumano && (
                              <span className="pildora-peligro shrink-0">Te espera</span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span
                              className="cifra"
                              style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
                            >
                              +{c.chatId}
                            </span>
                            {principal &&
                              (() => {
                                const m = metaEtiqueta(principal);
                                return (
                                  <span
                                    className="pildora"
                                    style={{ background: m.fondo, color: m.color }}
                                  >
                                    {m.label}
                                  </span>
                                );
                              })()}
                            {resto > 0 && (
                              <span
                                style={{ fontSize: "var(--t-micro)", color: "var(--muted-3)" }}
                                title={c.etiquetas.slice(1).map((v) => metaEtiqueta(v).label).join(", ")}
                              >
                                +{resto}
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <span className="pildora" style={{ background: me.fondo, color: me.color }}>
                        {me.label}
                      </span>
                    </td>
                    <td
                      className="cifra hidden text-right sm:table-cell"
                      style={{ color: "var(--muted)" }}
                    >
                      {c.mensajes}
                    </td>
                    <td className="cifra text-right" style={{ color: "var(--muted)" }}>
                      {ultimoContacto(c.ultimaVez, c.diasSinHablar)}
                    </td>
                    <td className="hidden text-right sm:table-cell">
                      <Link
                        href={`/clientes/${c.chatId}`}
                        className="font-semibold"
                        style={{ fontSize: "var(--t-menor)", color: "var(--indigo)" }}
                      >
                        Ver ficha →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pie de paginación. Solo aparece cuando hay más de una página: con
              12 clientes el primer día, un "1 de 1" es ruido. */}
          {paginas > 1 && (
            <div
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
              style={{ borderTop: "1px solid var(--borde)" }}
            >
              <span style={{ fontSize: "var(--t-menor)", color: "var(--muted-2)" }}>
                <span className="cifra">
                  {desde + 1}–{desde + clientes.length}
                </span>{" "}
                de <span className="cifra">{todos.length}</span>
              </span>
              <div className="flex items-center gap-2">
                {pagina > 1 ? (
                  <Link href={urlCon({ p: String(pagina - 1) })} className="btn-chico">
                    ← Anterior
                  </Link>
                ) : (
                  <span className="btn-chico" style={{ opacity: 0.4 }}>
                    ← Anterior
                  </span>
                )}
                <span
                  className="cifra"
                  style={{ fontSize: "var(--t-menor)", color: "var(--muted-2)" }}
                >
                  {pagina}/{paginas}
                </span>
                {pagina < paginas ? (
                  <Link href={urlCon({ p: String(pagina + 1) })} className="btn-chico">
                    Siguiente →
                  </Link>
                ) : (
                  <span className="btn-chico" style={{ opacity: 0.4 }}>
                    Siguiente →
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
