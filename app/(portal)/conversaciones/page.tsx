import Link from "next/link";
import { exigirUsuarioPortal } from "@/lib/auth";
import { metaEmpleado } from "@/lib/empleados";
import {
  listarConversaciones,
  obtenerConversacion,
  ETIQUETA_RESULTADO,
  ETIQUETA_TRIGGER,
  fechaCorta,
} from "@/lib/conversaciones";
import { cambiarModo } from "./acciones";
import Compositor from "@/components/Compositor";
import EtiquetasEditor from "@/components/EtiquetasEditor";
import { metaEtiqueta } from "@/lib/etiquetas";

export const dynamic = "force-dynamic";

/** Botón de control del chat: cada uno manda su modo destino. */
function BotonModo({
  empleadoId,
  chatId,
  modo,
  children,
  primario = false,
}: {
  empleadoId: string;
  chatId: string;
  modo: "bot" | "humano" | "pausado";
  children: React.ReactNode;
  primario?: boolean;
}) {
  return (
    <form action={cambiarModo}>
      <input type="hidden" name="empleadoId" value={empleadoId} />
      <input type="hidden" name="chatId" value={chatId} />
      <input type="hidden" name="modo" value={modo} />
      <button
        type="submit"
        className={
          (primario ? "btn-primario" : "btn-suave") + " px-3.5 py-2 text-[13px]"
        }
      >
        {children}
      </button>
    </form>
  );
}

function Burbuja({
  rol,
  texto,
  creadoEn,
  color,
}: {
  rol: string;
  texto: string;
  creadoEn: string;
  color: string;
}) {
  const delCliente = rol === "cliente";
  const esHumano = rol === "humano";
  return (
    <div className={`flex ${delCliente ? "justify-start" : "justify-end"}`}>
      <div
        className={
          "max-w-[76%] px-4 py-2.5 text-[14.5px] leading-relaxed " +
          (delCliente
            ? "rounded-2xl rounded-bl-md border bg-white"
            : "rounded-2xl rounded-br-md text-white")
        }
        style={
          delCliente
            ? { borderColor: "var(--borde)" }
            : { background: esHumano ? "#334155" : color }
        }
      >
        {esHumano && (
          <div className="mb-0.5 text-[10px] font-extrabold uppercase tracking-widest opacity-80">
            Tu equipo
          </div>
        )}
        <div className="whitespace-pre-wrap">{texto}</div>
        <div
          className={"mt-1 text-[10.5px] " + (delCliente ? "" : "opacity-75")}
          style={delCliente ? { color: "var(--muted-2)" } : undefined}
        >
          {fechaCorta(creadoEn)}
        </div>
      </div>
    </div>
  );
}

export default async function Conversaciones({
  searchParams,
}: {
  searchParams: { emp?: string; chat?: string; etiqueta?: string };
}) {
  const usuario = await exigirUsuarioPortal();
  const todas = await listarConversaciones(usuario.clienteId);

  // Filtro por etiqueta (si viene en la URL).
  const filtro = searchParams.etiqueta;
  const lista = filtro
    ? todas.filter((c) => c.etiquetas.includes(filtro))
    : todas;

  // Etiquetas presentes en las conversaciones, con su conteo, para la barra.
  const conteo = new Map<string, number>();
  for (const c of todas) for (const e of c.etiquetas) conteo.set(e, (conteo.get(e) ?? 0) + 1);
  const etiquetasBarra = [...conteo.entries()].sort((a, b) => b[1] - a[1]);

  const seleccion =
    searchParams.emp && searchParams.chat
      ? await obtenerConversacion(usuario.clienteId, searchParams.emp, searchParams.chat)
      : null;

  const metaSel = seleccion ? metaEmpleado(seleccion.empleadoRol) : null;
  const colorSel = metaSel?.color ?? "var(--indigo)";
  const esperando = todas.filter((c) => c.esperandoHumano).length;

  return (
    <main className="px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
      <div className="eyebrow">Bandeja</div>
      <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight lg:text-[32px]">
        Conversaciones
      </h1>
      <p className="mt-1.5 text-[15px]" style={{ color: "var(--muted)" }}>
        Todo lo que atendieron tus empleados, tal como lo vivió el cliente.
        {esperando > 0 && (
          <>
            {" "}
            <strong style={{ color: "var(--alerta)" }}>
              {esperando} te {esperando > 1 ? "esperan" : "espera"}.
            </strong>
          </>
        )}
      </p>

      {/* Barra de filtro por etiqueta */}
      {etiquetasBarra.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href="/conversaciones"
            className="rounded-full px-3 py-1.5 text-[12.5px] font-bold"
            style={
              filtro
                ? { background: "#F1F2F7", color: "var(--muted)" }
                : { background: "var(--indigo)", color: "#fff" }
            }
          >
            Todas ({todas.length})
          </Link>
          {etiquetasBarra.map(([valor, n]) => {
            const m = metaEtiqueta(valor);
            const activa = filtro === valor;
            return (
              <Link
                key={valor}
                href={`/conversaciones?etiqueta=${valor}`}
                className="rounded-full px-3 py-1.5 text-[12.5px] font-bold"
                style={
                  activa
                    ? { background: m.color, color: "#fff" }
                    : { background: m.fondo, color: m.color }
                }
              >
                {m.label} ({n})
              </Link>
            );
          })}
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[380px_1fr]">
        {/* Lista — en móvil se oculta cuando hay una conversación abierta,
            porque los dos paneles lado a lado no caben en un teléfono. */}
        <div
          className={
            "tarjeta max-h-[72vh] overflow-y-auto p-0 " +
            (seleccion ? "hidden lg:block" : "block")
          }
        >
          {lista.length === 0 && (
            <div className="p-10 text-center" style={{ color: "var(--muted)" }}>
              Todavía no hay conversaciones registradas.
            </div>
          )}
          {lista.map((c) => {
            const meta = metaEmpleado(c.empleadoRol);
            const activo =
              searchParams.emp === c.empleadoId && searchParams.chat === c.chatId;
            return (
              <Link
                key={`${c.empleadoId}|${c.chatId}`}
                href={`/conversaciones?emp=${c.empleadoId}&chat=${c.chatId}`}
                className="flex gap-3 border-b px-4 py-3.5 transition last:border-0 hover:bg-[#FAFAFD]"
                style={{
                  borderColor: "var(--borde)",
                  background: activo ? "var(--indigo-suave)" : undefined,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={meta.avatar}
                  alt={c.empleadoNombre}
                  width={38}
                  height={38}
                  className="avatar mt-0.5 h-[38px] w-[38px]"
                  style={{ ["--anillo" as string]: meta.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[15px] font-bold">{c.contacto}</span>
                    <span className="shrink-0 text-[11px]" style={{ color: "var(--muted-2)" }}>
                      {fechaCorta(c.ultimoEn)}
                    </span>
                  </div>
                  <div
                    className="mt-0.5 truncate text-[13px]"
                    style={{ color: "var(--muted)" }}
                  >
                    {c.ultimoMensaje}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="pildora" style={{ background: "#F1F2F7", color: meta.color }}>
                      {c.empleadoNombre}
                    </span>
                    {c.esperandoHumano && <span className="pildora-alerta">Te espera</span>}
                    {c.modo === "humano" && !c.esperandoHumano && (
                      <span className="pildora-indigo">Con tu equipo</span>
                    )}
                    {c.modo === "pausado" && (
                      <span
                        className="pildora"
                        style={{ background: "#F1F2F7", color: "var(--muted)" }}
                      >
                        Pausado
                      </span>
                    )}
                    {c.etiquetas.map((v) => {
                      const me = metaEtiqueta(v);
                      return (
                        <span
                          key={v}
                          className="pildora"
                          style={{ background: me.fondo, color: me.color }}
                        >
                          {me.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Detalle — en móvil ocupa toda la pantalla; el panel vacío solo tiene
            sentido en escritorio, donde convive con la lista. */}
        <div
          className={
            "tarjeta-plana p-4 sm:p-5 " + (seleccion ? "block" : "hidden lg:block")
          }
          style={{ background: "var(--fondo)" }}
        >
          {seleccion && (
            <Link
              href="/conversaciones"
              className="mb-3 inline-flex items-center gap-1.5 text-[14px] font-semibold lg:hidden"
              style={{ color: "var(--indigo)" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Volver a la lista
            </Link>
          )}
          {!seleccion ? (
            <div
              className="flex h-full min-h-[340px] flex-col items-center justify-center gap-2 text-center"
              style={{ color: "var(--muted)" }}
            >
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--muted-2)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a8 8 0 0 1-8 8H4l1.8-3.2A8 8 0 1 1 21 12z" />
              </svg>
              Elige una conversación para ver el chat completo.
            </div>
          ) : (
            <>
              <div
                className="flex flex-wrap items-center justify-between gap-3 border-b pb-4"
                style={{ borderColor: "var(--borde)" }}
              >
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={metaSel!.avatar}
                    alt={seleccion.empleadoNombre}
                    width={42}
                    height={42}
                    className="avatar h-[42px] w-[42px]"
                    style={{ ["--anillo" as string]: colorSel }}
                  />
                  <div>
                    <div className="titular text-[19px] font-bold">{seleccion.contacto}</div>
                    <div className="text-[13px]" style={{ color: "var(--muted)" }}>
                      {seleccion.telefono ?? `+${seleccion.chatId}`}
                      {seleccion.etiqueta ? ` · ${seleccion.etiqueta}` : ""} · atendido por{" "}
                      <span style={{ color: colorSel, fontWeight: 700 }}>
                        {seleccion.empleadoNombre}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Etiquetas de la conversación (auto + manual por el negocio) */}
              <EtiquetasEditor chatId={seleccion.chatId} etiquetas={seleccion.etiquetas} />

              {seleccion.escalacion && (
                <div
                  className="mt-4 rounded-xl border p-4"
                  style={{
                    borderColor: "var(--alerta-borde)",
                    background: "var(--alerta-suave)",
                  }}
                >
                  <div className="text-[13.5px] font-bold" style={{ color: "var(--alerta)" }}>
                    {ETIQUETA_TRIGGER[seleccion.escalacion.trigger] ?? "Derivada a tu equipo"}
                    {seleccion.escalacion.atendida ? " · ya atendida" : " · te espera"}
                  </div>
                  <p className="mt-1 text-[14px]">{seleccion.escalacion.resumen}</p>
                </div>
              )}

              {seleccion.resultados.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {seleccion.resultados.map((r, i) => (
                    <span key={`${r}-${i}`} className="pildora-ok">
                      {ETIQUETA_RESULTADO[r] ?? r}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-5 flex max-h-[50vh] flex-col gap-2.5 overflow-y-auto pr-1">
                {seleccion.mensajes.map((m, i) => (
                  <Burbuja
                    key={i}
                    rol={m.rol}
                    texto={m.texto}
                    creadoEn={m.creadoEn}
                    color={colorSel}
                  />
                ))}
              </div>

              {/* Control del dueño sobre el chat */}
              <div
                className="mt-4 border-t pt-4"
                style={{ borderColor: "var(--borde)" }}
              >
                {seleccion.modo === "bot" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px]" style={{ color: "var(--muted)" }}>
                      {seleccion.empleadoNombre} está respondiendo.
                    </span>
                    <div className="ml-auto flex flex-wrap gap-2">
                      <BotonModo
                        empleadoId={searchParams.emp!}
                        chatId={seleccion.chatId}
                        modo="pausado"
                      >
                        Pausar asistente
                      </BotonModo>
                      <BotonModo
                        empleadoId={searchParams.emp!}
                        chatId={seleccion.chatId}
                        modo="humano"
                        primario
                      >
                        Tomar la conversación
                      </BotonModo>
                    </div>
                  </div>
                )}

                {seleccion.modo === "humano" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold">
                      Tu equipo tiene esta conversación. {seleccion.empleadoNombre} no
                      responderá.
                    </span>
                    <div className="ml-auto">
                      <BotonModo
                        empleadoId={searchParams.emp!}
                        chatId={seleccion.chatId}
                        modo="bot"
                        primario
                      >
                        Devolver a {seleccion.empleadoNombre}
                      </BotonModo>
                    </div>
                  </div>
                )}

                {seleccion.modo === "pausado" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold">
                      Asistente pausado en este chat. Nadie está respondiendo
                      automáticamente.
                    </span>
                    <div className="ml-auto">
                      <BotonModo
                        empleadoId={searchParams.emp!}
                        chatId={seleccion.chatId}
                        modo="bot"
                        primario
                      >
                        Reactivar a {seleccion.empleadoNombre}
                      </BotonModo>
                    </div>
                  </div>
                )}

              </div>

              {/* Inbox: escribirle al cliente desde el portal (Opción B) */}
              <Compositor
                empleadoId={searchParams.emp!}
                chatId={seleccion.chatId}
                ventana={seleccion.ventana}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
