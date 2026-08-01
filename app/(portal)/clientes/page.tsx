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
  searchParams: { q?: string; etapa?: string };
}) {
  const usuario = await exigirUsuarioPortal();
  const q = (searchParams.q ?? "").trim();
  const etapa = searchParams.etapa;
  const clientes = await listarClientes(usuario.clienteId, { q, etapa });

  const urlCon = (cambios: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, etapa, ...cambios })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/clientes?${s}` : "/clientes";
  };

  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      {/* Cabecera en una línea, igual que el resto del portal. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="h-pagina">Clientes</h1>
        <span className="sub-titulo">
          {clientes.length} {clientes.length === 1 ? "persona" : "personas"}
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

      {clientes.length === 0 ? (
        <div className="tarjeta mt-5 p-10 text-center text-[13px]" style={{ color: "var(--muted)" }}>
          {q || etapa
            ? "Ningún cliente coincide con la búsqueda."
            : "Todavía no hay clientes. Aparecen solos cuando alguien te escribe."}
        </div>
      ) : (
        /* Tabla: es una lista de datos comparables, no tarjetas. Se lee más
           rápido y aprovecha el ancho. En móvil se desplaza en horizontal.
           Ahora usa la clase .tabla del sistema, así una pantalla nueva hereda
           el mismo tratamiento sin volver a escribirlo. */
        <div className="tarjeta mt-4 overflow-x-auto p-0">
          <table className="tabla min-w-[680px]">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Etapa</th>
                <th className="text-right">Mensajes</th>
                <th className="text-right">Último contacto</th>
                <th />
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
                    <td className="cifra text-right" style={{ color: "var(--muted)" }}>
                      {c.mensajes}
                    </td>
                    <td className="cifra text-right" style={{ color: "var(--muted)" }}>
                      {ultimoContacto(c.ultimaVez, c.diasSinHablar)}
                    </td>
                    <td className="text-right">
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
        </div>
      )}
    </main>
  );
}
