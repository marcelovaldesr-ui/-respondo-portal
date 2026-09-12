import Link from "next/link";
import type { FilaAtencion } from "@/lib/estadoComercial";
import type { AccionSugerida, GrupoAtencion } from "@/lib/estadoComercialCore";
import { GRUPOS_ATENCION, TONOS, haceCuanto, metaGrupo } from "@/lib/estadoComercialVista";
import { Vacio } from "@/components/estado/Estados";

/**
 * A · NECESITA TU ATENCIÓN.
 *
 * No es otra bandeja: muestra lo que exige una decisión, agrupado por por qué
 * urge, con UNA acción por fila que abre el contexto exacto. Lo de más de 7
 * días queda plegado y contado: no desaparece, pero no tapa lo de hoy.
 */

/** Filas visibles POR GRUPO antes de plegar (ver el comentario más abajo). */
const POR_GRUPO = 5;
const ANTIGUOS_VISIBLES = 12;
const MAS_VISIBLES = 20;

export function hrefConversacion(f: { chatId: string; empleadoId: string | null }): string {
  return f.empleadoId
    ? `/conversaciones?emp=${encodeURIComponent(f.empleadoId)}&chat=${encodeURIComponent(f.chatId)}`
    : `/clientes/${encodeURIComponent(f.chatId)}`;
}

function hrefAccion(f: FilaAtencion, a: AccionSugerida | null): string {
  if (a?.tipo === "revisar_propuesta") return "/seguimientos";
  // (Fase 2) Con el id se abre ESA hora, no el calendario entero.
  if (a?.tipo === "ver_cita") return a.citaId ? `/agenda?cita=${encodeURIComponent(a.citaId)}` : "/agenda";
  return hrefConversacion(f);
}

function Fila({ f, ahora }: { f: FilaAtencion; ahora: number }) {
  const p = f.atencion.principal!;
  const g = metaGrupo(f.atencion.grupo!);
  const accion = f.accion;
  const principal = p.prioridad === "urgente" && !p.antiguo;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        className="mt-[3px] h-2 w-2 shrink-0 self-start rounded-full"
        style={{ background: TONOS[g.tono].texto, opacity: g.valor === "antiguo" ? 0.5 : 1 }}
        aria-hidden
      />
      <Link href={hrefConversacion(f)} className="min-w-0 flex-1 hover:underline-offset-2">
        <span className="block truncate font-semibold" style={{ fontSize: "var(--t-fila)" }}>
          {f.nombre}
        </span>
        <span className="mt-0.5 block truncate" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
          {/* En el teléfono la columna de tiempo no cabe: va al inicio de la
              línea, para que el recorte se coma el final del texto y no la hora. */}
          {p.desde && <span className="cifra sm:hidden" style={{ color: "var(--muted-2)" }}>{haceCuanto(p.desde, ahora)} · </span>}
          {p.label}
          {f.otros.length > 0 && (
            <span style={{ color: "var(--muted-2)" }}> · también: {f.otros.join(", ").toLowerCase()}</span>
          )}
        </span>
      </Link>
      {p.desde && (
        <span
          className="cifra hidden shrink-0 text-right sm:block"
          style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)", minWidth: 52 }}
          title="Desde cuándo está pendiente"
        >
          {haceCuanto(p.desde, ahora)}
        </span>
      )}
      {accion && (
        <Link href={hrefAccion(f, accion)} className={principal ? "btn-fila-azul" : "btn-fila"}>
          {accion.label}
        </Link>
      )}
    </li>
  );
}

export default function NecesitaAtencion({
  filas,
  conteo,
  derivadas,
  ahora,
}: {
  filas: FilaAtencion[];
  conteo: Record<GrupoAtencion, number>;
  derivadas: number;
  ahora: number;
}) {
  const recientes = filas.filter((f) => f.atencion.grupo !== "antiguo");
  const antiguos = filas.filter((f) => f.atencion.grupo === "antiguo");
  // Lo antiguo, al revés: lo que acaba de cumplir la semana es lo más rescatable.
  const antiguosOrden = [...antiguos].sort(
    (a, b) => Date.parse(b.atencion.principal?.desde ?? "") - Date.parse(a.atencion.principal?.desde ?? "") || 0,
  );
  /**
   * CUÁNTAS FILAS POR GRUPO, NO EN TOTAL (12-sep, mirando Impresora en vivo).
   *
   * Con un tope global, «Para hoy» se comía las 8 filas y «Esta semana» y «Por
   * decidir» quedaban enteros dentro del desplegable: el dueño veía un resumen
   * que decía «Por decidir 4» y ni una sola de esas cuatro. Cada grupo muestra
   * sus primeras filas y el resto se pliega abajo, en orden.
   */
  const gruposVisibles = GRUPOS_ATENCION.filter((g) => g.valor !== "antiguo");
  const visibles: FilaAtencion[] = [];
  for (const g of gruposVisibles) {
    visibles.push(...recientes.filter((f) => f.atencion.grupo === g.valor).slice(0, POR_GRUPO));
  }
  const mostrados = new Set(visibles.map((f) => f.chatId));
  const resto = recientes.filter((f) => !mostrados.has(f.chatId));

  return (
    <section aria-labelledby="t-atencion">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="t-atencion" className="font-semibold" style={{ fontSize: "var(--t-titulo)" }}>
          Necesita tu atención
        </h2>
        <Link
          href="/conversaciones?estado=espera"
          className="font-semibold hover:underline"
          style={{ fontSize: "var(--t-menor)", color: "var(--azul)" }}
        >
          {derivadas > 0 ? `${derivadas} derivadas en la bandeja →` : "Ir a la bandeja →"}
        </Link>
      </div>

      {/* Resumen en una línea: cuánto hay de cada cosa, sin tarjetas KPI. */}
      <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
        {GRUPOS_ATENCION.map((g) => (
          <span key={g.valor} className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONOS[g.tono].texto }} aria-hidden />
            {g.label}
            <strong className="cifra" style={{ color: conteo[g.valor] ? "var(--tinta)" : "var(--muted-2)" }}>
              {conteo[g.valor]}
            </strong>
          </span>
        ))}
      </p>

      <div className="tarjeta overflow-hidden">
        {visibles.length === 0 ? (
          <Vacio
            titulo="Nada urgente por ahora"
            texto={
              antiguos.length
                ? "Lo de hoy está al día. Quedan pendientes antiguos más abajo."
                : "Nadie espera respuesta y no hay pagos ni sugerencias por revisar."
            }
          />
        ) : (
          gruposVisibles.map((g) => {
            const deGrupo = visibles.filter((f) => f.atencion.grupo === g.valor);
            if (!deGrupo.length) return null;
            return (
              <div key={g.valor}>
                <div
                  className="flex items-center justify-between border-b px-4 py-1.5"
                  style={{ background: "var(--fondo-hundido)", borderColor: "var(--borde)" }}
                >
                  <span className="rotulo">{g.label}</span>
                  {conteo[g.valor] > deGrupo.length && (
                    <span style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>
                      {deGrupo.length} de {conteo[g.valor]}
                    </span>
                  )}
                </div>
                <ul className="lista-filas">
                  {deGrupo.map((f) => (
                    <Fila key={f.chatId} f={f} ahora={ahora} />
                  ))}
                </ul>
              </div>
            );
          })
        )}

        {resto.length > 0 && (
          /* Se despliegan acá mismo: la bandeja «Te esperan» solo muestra
             derivaciones y no tendría pagos ni sugerencias. */
          <details className="border-t" style={{ borderColor: "var(--borde)" }}>
            <summary
              className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 hover:bg-[var(--fondo-hundido)]"
              style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
            >
              <span>
                <strong className="cifra" style={{ color: "var(--tinta)" }}>
                  {resto.length}
                </strong>{" "}
                más por revisar
              </span>
              <span aria-hidden>▾</span>
            </summary>
            <ul className="lista-filas border-t" style={{ borderColor: "var(--borde)" }}>
              {resto.slice(0, MAS_VISIBLES).map((f) => (
                <Fila key={f.chatId} f={f} ahora={ahora} />
              ))}
            </ul>
            {resto.length > MAS_VISIBLES && (
              <div className="border-t px-4 py-2.5" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)", borderColor: "var(--borde)" }}>
                y {resto.length - MAS_VISIBLES} más: ábrelos desde la bandeja
              </div>
            )}
          </details>
        )}

        {antiguos.length > 0 && (
          <details className="border-t" style={{ borderColor: "var(--borde)" }}>
            <summary
              className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 hover:bg-[var(--fondo-hundido)]"
              style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
            >
              <span>
                <strong className="cifra" style={{ color: "var(--tinta)" }}>
                  {antiguos.length}
                </strong>{" "}
                {antiguos.length === 1 ? "pendiente con más de 7 días" : "pendientes con más de 7 días"}
              </span>
              <span aria-hidden>▾</span>
            </summary>
            <p className="px-4 pb-2" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>
              Si ya se atendieron por teléfono o se perdieron, ciérralos desde la conversación y dejan de contar.
            </p>
            <ul className="lista-filas border-t" style={{ borderColor: "var(--borde)" }}>
              {antiguosOrden.slice(0, ANTIGUOS_VISIBLES).map((f) => (
                <Fila key={f.chatId} f={f} ahora={ahora} />
              ))}
            </ul>
            {antiguos.length > ANTIGUOS_VISIBLES && (
              <div className="border-t px-4 py-2.5" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)", borderColor: "var(--borde)" }}>
                y {antiguos.length - ANTIGUOS_VISIBLES} más en la bandeja
              </div>
            )}
          </details>
        )}
      </div>
    </section>
  );
}
