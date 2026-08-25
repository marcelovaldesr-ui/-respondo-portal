import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { metaEmpleado } from "@/lib/empleados";
import {
  listarConversacionesPagina,
  obtenerConversacion,
  fechaCorta,
} from "@/lib/conversaciones";
import PanelChat from "@/components/inbox/PanelChat";
import { SeleccionChatProvider, FilaChat } from "@/components/inbox/SeleccionChat";
import RefrescarLista from "@/components/RefrescarLista";
import { metaEtiqueta } from "@/lib/etiquetas";

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



export default async function Conversaciones({
  searchParams,
}: {
  searchParams: Promise<{ emp?: string; chat?: string; etiqueta?: string; q?: string; estado?: string; p?: string }>;
}) {
  const params = await searchParams;
  const usuario = await exigirPermisoPortal("operar_conversaciones");
  const filtro = params.etiqueta;
  const estado = params.estado;
  const q = (params.q ?? "").trim();
  const POR_PAGINA = 50;
  const solicitada = Math.max(1, Number(params.p ?? 1) || 1);
  let paginaDatos = await listarConversacionesPagina(usuario.clienteId, {
    q,
    estado,
    etiqueta: filtro,
    pagina: solicitada,
    porPagina: POR_PAGINA,
  });
  const paginas = Math.max(1, Math.ceil(paginaDatos.totalFiltrado / POR_PAGINA));
  const pagina = Math.min(solicitada, paginas);
  if (pagina !== solicitada) {
    paginaDatos = await listarConversacionesPagina(usuario.clienteId, {
      q,
      estado,
      etiqueta: filtro,
      pagina,
      porPagina: POR_PAGINA,
    });
  }
  const lista = paginaDatos.items;
  const totalFiltrado = paginaDatos.totalFiltrado;
  const { total: totalConversaciones, espera: nEspera, humano: nHumano, bot: nBot } =
    paginaDatos.resumen;
  const etiquetasBarra = Object.entries(paginaDatos.resumen.etiquetas).sort(
    (a, b) => b[1] - a[1],
  );

  const seleccion =
    params.emp && params.chat
      ? await obtenerConversacion(usuario.clienteId, params.emp, params.chat)
      : null;


  // URLs que COMBINAN filtros: cambiar uno no borra los demás (clave con
  // muchos chats: puedes buscar "rodrigo" Y filtrar "te esperan" a la vez).
  const urlCon = (cambios: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q,
      estado,
      etiqueta: filtro,
      p: pagina > 1 ? String(pagina) : undefined,
      ...cambios,
    };
    if (
      ["q", "estado", "etiqueta"].some((k) =>
        Object.prototype.hasOwnProperty.call(cambios, k),
      ) &&
      !("p" in cambios)
    ) {
      merged.p = undefined;
    }
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
    chipEstado(undefined, `Todas (${totalConversaciones})`, "var(--indigo)"),
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
      <SeleccionChatProvider
        empleadoIdInicial={params.emp ?? ""}
        chatIdInicial={params.chat ?? ""}
      >
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
            return (
              <FilaChat
                key={`${c.empleadoId}|${c.chatId}`}
                empleadoId={c.empleadoId}
                chatId={c.chatId}
                href={urlCon({ emp: c.empleadoId, chat: c.chatId })}
                className="flex gap-3 border-b px-4 py-3.5 transition last:border-0 hover:bg-[#FAFAFD]"
                estilo={{ borderColor: "var(--borde)" }}
                estiloActivo={{ background: "var(--indigo-suave)" }}
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
              </FilaChat>
            );
          })}
          {totalFiltrado > POR_PAGINA && (
            <nav
              aria-label="Paginación de conversaciones"
              className="flex items-center justify-between gap-3 border-t px-4 py-3"
              style={{ borderColor: "var(--borde)" }}
            >
              <span style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                Página {pagina} de {paginas} · {totalFiltrado} resultados
              </span>
              <div className="flex gap-2">
                {pagina > 1 && (
                  <Link
                    href={urlCon({ p: String(pagina - 1), emp: undefined, chat: undefined })}
                    className="btn-chico"
                  >
                    Anterior
                  </Link>
                )}
                {pagina < paginas && (
                  <Link
                    href={urlCon({ p: String(pagina + 1), emp: undefined, chat: undefined })}
                    className="btn-chico"
                  >
                    Siguiente
                  </Link>
                )}
              </div>
            </nav>
          )}
        </div>

        {/*
          EL CHAT Y SU CONTEXTO, DEL LADO DEL CLIENTE.

          Este bloque vivía acá, renderizado en el servidor, y por eso cambiar
          de conversación obligaba a reconstruir la página entera —lista y
          resumen incluidos— y a tapar toda la pantalla con el esqueleto.

          Ahora se mueve tal cual a PanelChat, que pide solo el chat que se
          necesita y recuerda los que ya se abrieron. El marcado es el mismo.
        */}
        <PanelChat inicial={seleccion} claveInicial={seleccion ? `${params.emp}|${params.chat}` : ""} />
      </div>
      </SeleccionChatProvider>
    </main>
  );
}
