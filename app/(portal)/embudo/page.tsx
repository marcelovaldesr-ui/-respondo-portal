import { exigirUsuarioPortal } from "@/lib/auth";
import { cargarEmbudo, ETAPAS } from "@/lib/embudo";
import { db } from "@/lib/db";
import TarjetaEmbudo from "@/components/TarjetaEmbudo";

export const dynamic = "force-dynamic";

export default async function Embudo() {
  const usuario = await exigirUsuarioPortal();
  const [tarjetas, empleadoR] = await Promise.all([
    cargarEmbudo(usuario.clienteId),
    db()
      .from("ed_empleados")
      .select("id")
      .eq("cliente_id", usuario.clienteId)
      .eq("rol", "tino")
      .maybeSingle(),
  ]);
  const empleadoId = (empleadoR.data?.id as string) ?? "";

  const porEtapa = new Map(ETAPAS.map((e) => [e.valor, tarjetas.filter((t) => t.etapa === e.valor)]));
  const activas = tarjetas.filter((t) => t.etapa !== "perdido" && t.etapa !== "ganado").length;
  const ganadas = porEtapa.get("ganado")?.length ?? 0;

  return (
    <main className="px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
      <div className="eyebrow">Ventas</div>
      <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight lg:text-[32px]">Embudo</h1>
      <p className="mt-1.5 max-w-2xl text-[15px]" style={{ color: "var(--muted)" }}>
        En qué va cada conversación. Tu asistente las mueve solo según lo que pasa; tú
        puedes moverlas cuando quieras y ahí se quedan.
      </p>

      {tarjetas.length === 0 ? (
        <div className="tarjeta mt-6 p-10 text-center" style={{ color: "var(--muted)" }}>
          Todavía no hay conversaciones en el embudo. Aparecen solas a medida que tus
          clientes escriben.
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13.5px]">
            <span style={{ color: "var(--muted)" }}>
              <strong style={{ color: "var(--tinta)" }}>{activas}</strong> por cerrar
            </span>
            <span style={{ color: "var(--muted)" }}>
              <strong style={{ color: "#166534" }}>{ganadas}</strong> ganadas
            </span>
            <span style={{ color: "var(--muted)" }}>
              <strong style={{ color: "var(--tinta)" }}>{tarjetas.length}</strong> en total
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
                      className="rounded-xl px-3.5 py-2.5"
                      style={{ background: e.fondo, border: `1px solid ${e.color}22` }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <h2 className="text-[14px] font-extrabold" style={{ color: e.color }}>
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

                    <div className="mt-3 space-y-2.5">
                      {items.length === 0 ? (
                        <div
                          className="rounded-xl border border-dashed px-3 py-6 text-center text-[12.5px]"
                          style={{ borderColor: "var(--borde-fuerte)", color: "var(--muted-2)" }}
                        >
                          Sin conversaciones
                        </div>
                      ) : (
                        items.map((t) => (
                          <TarjetaEmbudo key={t.chatId} {...t} empleadoId={empleadoId} />
                        ))
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
