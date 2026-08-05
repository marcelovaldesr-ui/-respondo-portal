import Link from "next/link";
import { exigirUsuarioPortal } from "@/lib/auth";
import { cargarEmbudo, ETAPAS } from "@/lib/embudo";
import { db } from "@/lib/db";
import TarjetaEmbudo from "@/components/TarjetaEmbudo";

export const dynamic = "force-dynamic";

/** Máximo de tarjetas visibles por columna (el resto se ve en la bandeja). */
const TOPE_COLUMNA = 12;

const PERIODOS = [
  { d: 7, label: "7 días" },
  { d: 14, label: "14 días" },
  { d: 30, label: "30 días" },
  { d: 0, label: "Todas" },
];

export default async function Embudo({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const params = await searchParams;
  const usuario = await exigirUsuarioPortal();
  const dias = PERIODOS.some((p) => String(p.d) === params.dias)
    ? Number(params.dias)
    : 14;

  const [tarjetas, empleadoR] = await Promise.all([
    cargarEmbudo(usuario.clienteId, dias),
    db()
      .from("ed_empleados")
      .select("id")
      .eq("cliente_id", usuario.clienteId)
      .eq("rol", "tino")
      .maybeSingle(),
  ]);
  const empleadoId = (empleadoR.data?.id as string) ?? "";

  const porEtapa = new Map(ETAPAS.map((e) => [e.valor, tarjetas.filter((t) => t.etapa === e.valor)]));
  // "Por cerrar" son las oportunidades REALES: alguien que mostró interés o ya
  // tiene una cotización. Contar también las "Nuevo" infla el número y le hace
  // perder credibilidad al tablero.
  const porCerrar =
    (porEtapa.get("interesado")?.length ?? 0) + (porEtapa.get("cotizado")?.length ?? 0);
  const ganadas = porEtapa.get("ganado")?.length ?? 0;
  const esperan = tarjetas.filter((t) => t.esperandoHumano).length;

  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="h-pagina">Embudo</h1>
        <span className="sub-titulo">
          Tu asistente las mueve solo; si tú mueves una, ahí se queda
        </span>
      </div>

      {/* Corte por actividad: sin esto el tablero se llena de conversaciones ya
          terminadas y el número de "por cerrar" deja de significar algo. */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold" style={{ color: "var(--muted-2)" }}>
          Con actividad en:
        </span>
        {PERIODOS.map((p) => (
          <Link
            key={p.d}
            href={`/embudo?dias=${p.d}`}
            className="rounded-full px-3.5 py-1.5 text-[12.5px] font-bold"
            style={
              p.d === dias
                ? { background: "var(--indigo)", color: "#fff" }
                : { background: "#F1F2F7", color: "var(--muted)" }
            }
          >
            {p.label}
          </Link>
        ))}
      </div>

      {tarjetas.length === 0 ? (
        <div className="tarjeta mt-6 p-10 text-center" style={{ color: "var(--muted)" }}>
          No hay conversaciones con actividad en este período. Prueba con un rango más
          amplio.
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13.5px]">
            <span style={{ color: "var(--muted)" }}>
              <strong style={{ color: "var(--tinta)" }}>{porCerrar}</strong> oportunidades por
              cerrar
            </span>
            {esperan > 0 && (
              <span style={{ color: "var(--muted)" }}>
                <strong style={{ color: "var(--alerta)" }}>{esperan}</strong> te esperan
              </span>
            )}
            <span style={{ color: "var(--muted)" }}>
              <strong style={{ color: "#166534" }}>{ganadas}</strong> ganadas
            </span>
            <span style={{ color: "var(--muted)" }}>
              <strong style={{ color: "var(--tinta)" }}>{tarjetas.length}</strong> activas
            </span>
          </div>

          {/* Tablero: columnas desplazables en horizontal (funciona igual en móvil) */}
          <div className="mt-5 -mx-5 overflow-x-auto px-5 pb-3 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
            <div className="flex min-w-max gap-4">
              {ETAPAS.map((e) => {
                const items = porEtapa.get(e.valor) ?? [];
                return (
                  <section key={e.valor} className="w-[280px] shrink-0">
                    <div
                      className="rounded-[7px] px-3.5 py-2.5"
                      style={{ background: e.fondo, border: `1px solid ${e.color}22` }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <h2 className="text-[14px] font-semibold" style={{ color: e.color }}>
                          {e.label}
                        </h2>
                        <span className="text-[13px] font-bold" style={{ color: e.color }}>
                          {items.length}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11.5px]" style={{ color: e.color, opacity: 0.75 }}>
                        {e.descripcion}
                      </p>
                    </div>

                    {/* Tope de tarjetas por columna: una columna con decenas de
                        tarjetas no se lee, y las que importan quedan enterradas.
                        Se muestran las más recientes y el resto se ve en la
                        bandeja, que es la pantalla hecha para recorrer volumen. */}
                    <div className="mt-3 space-y-2.5">
                      {items.length === 0 ? (
                        <div
                          className="rounded-[7px] border border-dashed px-3 py-6 text-center text-[12.5px]"
                          style={{ borderColor: "var(--borde-fuerte)", color: "var(--muted-2)" }}
                        >
                          Sin conversaciones
                        </div>
                      ) : (
                        <>
                          {items.slice(0, TOPE_COLUMNA).map((t) => (
                            <TarjetaEmbudo key={t.chatId} {...t} empleadoId={empleadoId} />
                          ))}
                          {items.length > TOPE_COLUMNA && (
                            <Link
                              href="/conversaciones"
                              className="block rounded-[7px] border border-dashed px-3 py-3 text-center text-[12.5px] font-semibold"
                              style={{ borderColor: "var(--borde-fuerte)", color: "var(--muted)" }}
                            >
                              +{items.length - TOPE_COLUMNA} más · verlas en la bandeja
                            </Link>
                          )}
                        </>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
