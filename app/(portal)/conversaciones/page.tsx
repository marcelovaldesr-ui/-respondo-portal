import Link from "next/link";
import { exigirUsuarioPortal } from "@/lib/auth";
import { metaEmpleado } from "@/lib/empleados";
import {
  listarConversaciones,
  obtenerConversacion,
  ETIQUETA_RESULTADO,
  ETIQUETA_TRIGGER,
  fechaCorta,
  fechaLarga,
} from "@/lib/conversaciones";
import InboxConversacion from "@/components/InboxConversacion";
import EtiquetasEditor from "@/components/EtiquetasEditor";
import RefrescarLista from "@/components/RefrescarLista";
import { metaEtiqueta } from "@/lib/etiquetas";
import { metaEtapa } from "@/lib/embudo";

export const dynamic = "force-dynamic";

/**
 * Iniciales del contacto para la lista.
 *
 * Sustituye a la foto del empleado, que se repetía idéntica en las 101 filas y
 * por lo tanto no distinguía nada — que es lo único que un avatar tiene que
 * hacer en una lista. El color sale del empleado que atiende, así que la
 * información de "quién atiende" no se pierde del todo.
 *
 * Casos borde reales de esta base: nombres que son solo emoji ("🌸🌸"), nombres
 * vacíos y contactos que son puro número. Por eso se filtran las letras y, si
 * no queda ninguna, se cae a los últimos dígitos del teléfono.
 */
function Iniciales({ nombre, color }: { nombre: string; color: string }) {
  const letras = (nombre.match(/\p{L}+/gu) ?? [])
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  const texto = letras || nombre.replace(/\D/g, "").slice(-2) || "?";
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center font-semibold"
      style={{
        borderRadius: "var(--r-pill)",
        fontSize: texto.length > 1 ? "var(--t-micro)" : "var(--t-menor)",
        background: "var(--fondo-hundido)",
        color,
      }}
    >
      {texto}
    </span>
  );
}

/**
 * Qué etiqueta merece el único espacio disponible en la fila.
 *
 * Menor número = más urgente de saber de un vistazo. Un reclamo cambia lo que
 * haces al abrir la conversación; "posible comprador" no.
 */
const ORDEN_ETIQUETA: Record<string, number> = {
  reclamo: 0,
  necesita_atencion: 1,
  cotizacion: 2,
  agendado: 3,
  posible_comprador: 4,
};
function prioridadEtiqueta(v: string): number {
  return ORDEN_ETIQUETA[v] ?? 9;
}

/** Rótulo de bloque en la columna de contexto. */
function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-semibold uppercase"
      style={{
        fontSize: "var(--t-columna)",
        letterSpacing: "0.07em",
        color: "var(--muted-3)",
      }}
    >
      {children}
    </div>
  );
}

/** Fila etiqueta/valor del bloque de contexto. */
function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>{etiqueta}</dt>
      <dd style={{ fontSize: "var(--t-menor)" }}>{children}</dd>
    </div>
  );
}

export default async function Conversaciones({
  searchParams,
}: {
  searchParams: { emp?: string; chat?: string; etiqueta?: string; q?: string; estado?: string };
}) {
  const usuario = await exigirUsuarioPortal();
  const todas = await listarConversaciones(usuario.clienteId);

  // Filtros: etiqueta, estado (triage) y búsqueda (?q=).
  const filtro = searchParams.etiqueta;
  const estado = searchParams.estado;
  const q = (searchParams.q ?? "").trim();
  const qDigits = q.replace(/\D/g, "");
  let lista = todas;
  if (filtro) lista = lista.filter((c) => c.etiquetas.includes(filtro));
  if (estado === "espera") lista = lista.filter((c) => c.esperandoHumano);
  else if (estado === "humano") lista = lista.filter((c) => c.modo === "humano" && !c.esperandoHumano);
  else if (estado === "bot") lista = lista.filter((c) => c.modo === "bot" && !c.esperandoHumano);
  if (q) {
    const ql = q.toLowerCase();
    lista = lista.filter(
      (c) =>
        c.contacto.toLowerCase().includes(ql) ||
        (!!qDigits && c.chatId.includes(qDigits)) ||
        c.ultimoMensaje.toLowerCase().includes(ql),
    );
  }

  // Conteos para los chips de estado (siempre sobre el total, no sobre el filtro).
  const nEspera = todas.filter((c) => c.esperandoHumano).length;
  const nHumano = todas.filter((c) => c.modo === "humano" && !c.esperandoHumano).length;
  const nBot = todas.filter((c) => c.modo === "bot" && !c.esperandoHumano).length;

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
  const esperando = nEspera;

  // URLs que COMBINAN filtros: cambiar uno no borra los demás (clave con
  // muchos chats: puedes buscar "rodrigo" Y filtrar "te esperan" a la vez).
  const urlCon = (cambios: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = { q, estado, etiqueta: filtro, ...cambios };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/conversaciones?${s}` : "/conversaciones";
  };

  // Chip de estado: helper para el estilo activo/inactivo.
  const chipEstado = (val: string | undefined, label: string, activoBg: string) => {
    const activo = estado === val;
    return {
      label,
      href: urlCon({ estado: val }),
      style: activo
        ? { background: activoBg, color: "#fff" }
        : { background: "#F1F2F7", color: "var(--muted)" },
    };
  };
  const chips = [
    chipEstado(undefined, `Todas (${todas.length})`, "var(--indigo)"),
    // Coral, no ámbar: en el sistema el coral significa exclusivamente "alguien
    // te está esperando". Este chip y la píldora de la fila tienen que ser el
    // mismo color o el coral deja de ser una señal.
    chipEstado("espera", `Te esperan (${nEspera})`, "var(--coral)"),
    chipEstado("humano", `Con tu equipo (${nHumano})`, "#334155"),
    chipEstado("bot", `Atiende Tino (${nBot})`, "var(--indigo)"),
  ];

  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      {/* La lista se actualiza sola cada 25s (el chat abierto ya lo hacía cada 4s) */}
      <RefrescarLista />
      {/*
        CABECERA EN UNA SOLA FILA: título + pestañas + buscador.

        Eran cuatro filas apiladas —título, bajada, chips de estado y chips de
        etiqueta— que se comían 180 px antes de la primera conversación. En la
        pantalla más usada del portal, ese alto es la diferencia entre ver seis
        conversaciones y ver diez.

        Las etiquetas bajaron a la barra de la lista, que es donde se filtra.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="h-pagina shrink-0">Conversaciones</h1>

        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((ch) => (
            <Link
              key={ch.label}
              href={ch.href}
              className="rounded-full px-2.5 py-1 font-semibold"
              style={{ fontSize: "var(--t-menor)", ...ch.style }}
            >
              {ch.label}
            </Link>
          ))}
        </div>

        {/* Buscador a la derecha. Los hidden conservan estado/etiqueta para que
            buscar no borre los filtros que ya estaban puestos. */}
        <form action="/conversaciones" method="get" className="ml-auto flex gap-2">
          {estado && <input type="hidden" name="estado" value={estado} />}
          {filtro && <input type="hidden" name="etiqueta" value={filtro} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar por nombre o número…"
            className="campo w-[210px] py-1.5"
          />
          {q && (
            <Link href={urlCon({ q: undefined })} className="btn-chico">
              Limpiar
            </Link>
          )}
        </form>
      </div>

      {/*
        Barra de filtro por etiqueta.

        El chip de reset decía "Todas (101)", igual que el de la fila de arriba:
        dos botones con el mismo texto que hacen cosas distintas (uno limpia el
        estado, el otro la etiqueta). Ahora solo aparece cuando hay una etiqueta
        activa, y dice qué es lo que quita.
      */}
      {etiquetasBarra.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {filtro && (
            <Link
              href={urlCon({ etiqueta: undefined })}
              className="rounded-full px-3 py-1.5 font-semibold"
              style={{
                fontSize: "var(--t-menor)",
                background: "var(--fondo-hundido)",
                color: "var(--muted)",
              }}
            >
              ✕ Quitar etiqueta
            </Link>
          )}
          {etiquetasBarra.map(([valor, n]) => {
            const m = metaEtiqueta(valor);
            const activa = filtro === valor;
            return (
              <Link
                key={valor}
                href={urlCon({ etiqueta: valor })}
                className="rounded-full px-3 py-1.5 font-semibold"
                style={{
                  fontSize: "var(--t-menor)",
                  ...(activa
                    ? { background: m.color, color: "#fff" }
                    : { background: m.fondo, color: m.color }),
                }}
              >
                {m.label} ({n})
              </Link>
            );
          })}
        </div>
      )}

      {/*
        ALTURA REAL DE LA PANTALLA.

        La bandeja estaba a max-h-72vh dentro de una página que hace scroll: se
        veían seis conversaciones y abajo quedaba un vacío muerto. En la pantalla
        que más se usa, cada fila que entra sin scrollear cuenta.

        Ahora la lista y el chat ocupan lo que queda de viewport y cada uno
        desplaza por dentro. El 210px descuenta cabecera, buscador y filtros.
      */}
      {/*
        TRES COLUMNAS: lista · chat · contexto.

        Antes eran dos, y todo lo que no era mensaje —etiquetas, resultados,
        el aviso de derivación— se apilaba ENCIMA del chat. Con una conversación
        larga, abrirla significaba scrollear pasando por cuatro bloques de meta
        antes de llegar al primer mensaje, que es a lo que uno entró.

        Ahora el medio es solo la conversación y lo que la describe vive al
        costado, donde se consulta sin estorbar. La tercera columna desaparece
        bajo 1280px: en un notebook chico, chat angosto es peor que sin panel.
      */}
      <div className="mt-3 grid gap-3 lg:h-[calc(100vh-150px)] lg:grid-cols-[330px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)_290px]">
        {/* Lista — en móvil se oculta cuando hay una conversación abierta,
            porque los dos paneles lado a lado no caben en un teléfono. */}
        <div
          className={
            "tarjeta overflow-y-auto p-0 max-lg:max-h-[70vh] lg:h-full " +
            (seleccion ? "hidden lg:block" : "block")
          }
        >
          {lista.length === 0 && (
            <div className="p-10 text-center" style={{ color: "var(--muted)" }}>
              {q || estado || filtro
                ? "No hay conversaciones que coincidan con la búsqueda o el filtro."
                : "Todavía no hay conversaciones registradas."}
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
                {/*
                  AVATAR = INICIALES DEL CONTACTO.

                  Antes acá iba la foto del empleado. Con 101 conversaciones
                  atendidas casi todas por Tino, eran 101 fotos idénticas: una
                  columna entera de píxeles que no distingue una fila de otra,
                  que es justo lo único que un avatar tiene que hacer en una
                  lista. Quién atiende ya está en el filtro de arriba y en el
                  panel de la derecha.
                */}
                <Iniciales nombre={c.contacto} color={meta.color} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                      {c.contacto}
                    </span>
                    <span
                      className="cifra shrink-0"
                      style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
                    >
                      {fechaCorta(c.ultimoEn)}
                    </span>
                  </div>
                  <div
                    className="mt-0.5 truncate"
                    style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
                  >
                    {/* Quién habló último. Sin esto, "Sí" o "Ya" no dicen si
                        estás esperando tú o el cliente. */}
                    {c.ultimoRol !== "cliente" && (
                      <span style={{ color: "var(--muted-3)" }}>Tú: </span>
                    )}
                    {c.ultimoMensaje}
                  </div>

                  {/*
                    COMO MÁXIMO DOS PÍLDORAS.

                    Cada fila mostraba el empleado + el estado + TODAS las
                    etiquetas: cinco o seis píldoras que ocupaban tres líneas y
                    empujaban el mensaje fuera de vista. Con seis colores por
                    fila ninguno significa nada.

                    Se conserva el estado —que es lo único que exige una
                    decisión— y la etiqueta más informativa. El resto se cuenta.
                  */}
                  {(() => {
                    const estadoPill = c.esperandoHumano ? (
                      <span className="pildora-peligro">Te espera</span>
                    ) : c.modo === "humano" && c.ultimoRol === "cliente" ? (
                      <span className="pildora-peligro">Responder</span>
                    ) : c.modo === "humano" ? (
                      <span className="pildora-indigo">Con tu equipo</span>
                    ) : c.modo === "pausado" ? (
                      <span className="pildora-neutra">Pausado</span>
                    ) : null;

                    const ordenadas = [...c.etiquetas].sort(
                      (a, b) => prioridadEtiqueta(a) - prioridadEtiqueta(b),
                    );
                    const principal = ordenadas[0];
                    const resto = ordenadas.length - (principal ? 1 : 0);
                    if (!estadoPill && !principal) return null;

                    return (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {estadoPill}
                        {principal &&
                          (() => {
                            const me = metaEtiqueta(principal);
                            return (
                              <span
                                className="pildora"
                                style={{ background: me.fondo, color: me.color }}
                              >
                                {me.label}
                              </span>
                            );
                          })()}
                        {resto > 0 && (
                          <span
                            style={{ fontSize: "var(--t-micro)", color: "var(--muted-3)" }}
                            title={ordenadas.slice(1).map((v) => metaEtiqueta(v).label).join(", ")}
                          >
                            +{resto}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </Link>
            );
          })}
        </div>

        {/* Detalle — en móvil ocupa toda la pantalla; el panel vacío solo tiene
            sentido en escritorio, donde convive con la lista. */}
        <div
          className={
            "tarjeta-plana min-w-0 overflow-y-auto p-4 sm:p-5 lg:h-full " +
            (seleccion ? "block" : "hidden lg:block")
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

              {/* Inbox en vivo: control (tomar/devolver) + mensajes + responder manual */}
              <InboxConversacion
                empleadoId={searchParams.emp!}
                chatId={seleccion.chatId}
                empleadoNombre={seleccion.empleadoNombre}
                color={colorSel}
                ventana={seleccion.ventana}
                mensajesIniciales={seleccion.mensajes.map((m) => ({
                  rol: m.rol,
                  texto: m.texto,
                  creadoEn: m.creadoEn,
                }))}
                modoInicial={seleccion.modo}
              />
            </>
          )}
        </div>

        {/*
          COLUMNA DE CONTEXTO — quién atiende, cómo está clasificada y qué
          historia tiene esta persona con el negocio.

          Todo sale de ed_contactos, que desde la migración 250 mantiene el total
          de mensajes y la fecha del primero por trigger. Sin eso, mostrar
          "cliente desde" habría obligado a buscar el mensaje más antiguo del
          chat cada vez que se abre una conversación.
        */}
        {seleccion && (
          <aside className="hidden min-w-0 flex-col gap-3 overflow-y-auto xl:flex xl:h-full">
            <div className="tarjeta p-3.5">
              <Rotulo>Quién atiende</Rotulo>
              <div className="mt-2 flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={metaSel!.avatar}
                  alt=""
                  width={30}
                  height={30}
                  className="avatar h-[30px] w-[30px]"
                  style={{ ["--anillo" as string]: colorSel }}
                />
                <div className="min-w-0">
                  <div className="truncate font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                    {seleccion.empleadoNombre}
                  </div>
                  <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
                    {seleccion.modo === "humano"
                      ? "en silencio · tú tienes el control"
                      : seleccion.modo === "pausado"
                        ? "pausado"
                        : "respondiendo"}
                  </div>
                </div>
              </div>
            </div>

            <div className="tarjeta p-3.5">
              <Rotulo>Etiquetas</Rotulo>
              <EtiquetasEditor chatId={seleccion.chatId} etiquetas={seleccion.etiquetas} />
            </div>

            <div className="tarjeta p-3.5">
              <Rotulo>Contexto</Rotulo>
              <dl className="mt-2 space-y-1.5">
                <Dato etiqueta="Etapa">
                  {(() => {
                    const e = metaEtapa(seleccion.etapa);
                    return (
                      <span className="pildora" style={{ background: e.fondo, color: e.color }}>
                        {e.label}
                      </span>
                    );
                  })()}
                </Dato>
                <Dato etiqueta="Mensajes">
                  <span className="cifra">{seleccion.mensajesTotal}</span>
                </Dato>
                {/* Un contacto anterior al trigger de la 250 puede no tener
                    primer mensaje registrado. Se omite la fila en vez de
                    mostrar una fecha inventada o un guion sin explicación. */}
                {seleccion.clienteDesde && (
                  <Dato etiqueta="Cliente desde">
                    <span className="cifra">{fechaLarga(seleccion.clienteDesde)}</span>
                  </Dato>
                )}
                {seleccion.ventana !== "desconocida" && (
                  <Dato etiqueta="Ventana 24 h">
                    <span
                      className="pildora"
                      style={
                        seleccion.ventana === "abierta"
                          ? { background: "var(--ok-suave)", color: "var(--ok)" }
                          : { background: "var(--fondo-hundido)", color: "var(--muted)" }
                      }
                    >
                      {seleccion.ventana === "abierta" ? "Abierta" : "Cerrada"}
                    </span>
                  </Dato>
                )}
              </dl>
            </div>

            {seleccion.resultados.length > 0 && (
              <div className="tarjeta p-3.5">
                <Rotulo>Resultados</Rotulo>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {seleccion.resultados.map((r, i) => (
                    <span key={`${r}-${i}`} className="pildora-ok">
                      {ETIQUETA_RESULTADO[r] ?? r}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {seleccion.notas && (
              <div className="tarjeta p-3.5">
                <Rotulo>Nota interna</Rotulo>
                <p
                  className="mt-2 whitespace-pre-wrap"
                  style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
                >
                  {seleccion.notas}
                </p>
                {/* Se dice explícito porque es la duda que aparece siempre: si
                    el cliente puede leer esto. */}
                <p className="mt-2" style={{ fontSize: "var(--t-micro)", color: "var(--muted-3)" }}>
                  Solo la ve tu equipo. El cliente nunca la lee.
                </p>
              </div>
            )}

            <Link
              href={`/clientes/${seleccion.chatId}`}
              className="btn-suave w-full justify-center"
            >
              Ver ficha completa →
            </Link>
          </aside>
        )}
      </div>
    </main>
  );
}
