import Link from "next/link";
import { exigirUsuarioPortal } from "@/lib/auth";
import { listarClientes } from "@/lib/clientes";
import { ETAPAS, metaEtapa } from "@/lib/embudo";
import { metaEtiqueta } from "@/lib/etiquetas";

export const dynamic = "force-dynamic";

/** "hace 3 días" · "hoy" · "—" */
function haceCuanto(dias: number | null): string {
  if (dias === null) return "—";
  if (dias === 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  const m = Math.floor(dias / 30);
  return `hace ${m} ${m === 1 ? "mes" : "meses"}`;
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
    <main className="px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
      <div className="eyebrow">Personas</div>
      <h1 className="h-pagina mt-1">Clientes</h1>
      <p className="sub-pagina max-w-2xl">
        Quién es cada persona que te escribió, qué han hecho juntos y desde cuándo no
        hablan.
      </p>

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
        <>
          <p className="mt-4 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
            {clientes.length} {clientes.length === 1 ? "cliente" : "clientes"}
          </p>

          {/* Tabla: es una lista de datos comparables, no tarjetas. Se lee más
              rápido y aprovecha el ancho. En móvil se desplaza en horizontal. */}
          <div className="tarjeta mt-2 overflow-x-auto p-0">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--borde)" }}>
                  {["Cliente", "Etapa", "Mensajes", "Último contacto", ""].map((h, i) => (
                    <th
                      key={h + i}
                      className="px-4 py-2.5 text-[11px] font-bold uppercase"
                      style={{ color: "var(--muted-2)", letterSpacing: "0.06em" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => {
                  const me = metaEtapa(c.etapa);
                  return (
                    <tr
                      key={c.chatId}
                      className="transition hover:bg-[#FAFAFD]"
                      style={{ borderBottom: "1px solid var(--borde)" }}
                    >
                      <td className="px-4 py-3">
                        <Link href={`/clientes/${c.chatId}`} className="block">
                          <div className="flex items-center gap-2">
                            <span className="text-[13.5px] font-semibold">{c.nombre}</span>
                            {c.esperandoHumano && (
                              <span className="pildora-alerta">Te espera</span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11.5px]" style={{ color: "var(--muted-2)" }}>
                              +{c.chatId}
                            </span>
                            {c.etiquetas.slice(0, 2).map((v) => {
                              const m = metaEtiqueta(v);
                              return (
                                <span
                                  key={v}
                                  className="pildora"
                                  style={{ background: m.fondo, color: m.color }}
                                >
                                  {m.label}
                                </span>
                              );
                            })}
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="pildora" style={{ background: me.fondo, color: me.color }}>
                          {me.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px]" style={{ color: "var(--muted)" }}>
                        {c.mensajes}
                      </td>
                      <td className="px-4 py-3 text-[13px]" style={{ color: "var(--muted)" }}>
                        {haceCuanto(c.diasSinHablar)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/clientes/${c.chatId}`}
                          className="text-[12.5px] font-semibold"
                          style={{ color: "var(--indigo)" }}
                        >
                          Ver ficha
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
