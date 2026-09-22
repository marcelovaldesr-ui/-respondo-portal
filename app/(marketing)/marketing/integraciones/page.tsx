import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { conexionDe, metaAdsConfigurado, proveedorMeta } from "@/lib/ads/meta";
import {
  conexionGoogleDe,
  cuentasDeGoogle,
  formatearIdCuenta,
  googleAdsConfigurado,
  pruebaDeLecturaGoogle,
} from "@/lib/ads/google";
import { estadoDePauta, type EstadoItem } from "@/lib/ads/estado";
import { mensajeDeFalla } from "@/lib/ads/canales";
import { ERRORES, type CodigoErrorAds } from "@/lib/ads/proveedor";
import type { Proveedor } from "@/lib/ads/canal";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import { resolverRango } from "@/lib/ads/periodos";
import { EVENTOS } from "@/lib/ads/eventos";
import { modoDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import FormularioDataset from "@/components/marketing/FormularioDataset";
import SelectorCuenta from "@/components/marketing/SelectorCuenta";
import SelectorCuentaGoogle from "@/components/marketing/SelectorCuentaGoogle";
import { Pildora } from "@/components/marketing/Estado";
import { Ico } from "@/components/marketing/Iconos";

export const dynamic = "force-dynamic";

/** Mensajes de vuelta del OAuth. Cada uno dice qué pasó y qué hacer. */
const AVISOS: Record<string, { texto: string; tono: "ok" | "error" }> = {
  "1": { texto: "Cuenta publicitaria conectada.", tono: "ok" },
  google: { texto: "Cuenta de Google Ads conectada.", tono: "ok" },
  elegir_google: {
    texto: "Google autorizó el acceso. Elige cuál de tus cuentas de Google Ads es la de este negocio.",
    tono: "ok",
  },
  elegir: { texto: "Meta autorizó el acceso. Elige cuál de tus cuentas publicitarias es la de este negocio.", tono: "ok" },
  cancelado: { texto: "Se canceló la autorización en Meta. No se guardó nada.", tono: "error" },
  sin_cuentas: { texto: "La cuenta de Meta con la que entraste no administra ninguna cuenta publicitaria. Entra con la cuenta que sí las administra.", tono: "error" },
  no_configurado: { texto: "La lectura de tu cuenta publicitaria todavía no está activada. La activamos nosotros; escríbenos.", tono: "error" },
  estado_invalido: { texto: "El enlace de vuelta venció o no era válido. Vuelve a intentarlo desde acá.", tono: "error" },
  respuesta_incompleta: { texto: "Meta devolvió una respuesta incompleta.", tono: "error" },
  no_se_guardo: { texto: "No pudimos guardar la conexión. Vuelve a intentarlo.", tono: "error" },
  token_vencido: { texto: "El permiso de Meta venció mientras conectábamos.", tono: "error" },
  sin_permiso: { texto: "Falta permiso para leer esa cuenta publicitaria en Meta.", tono: "error" },
  limite_api: { texto: "Meta nos pidió esperar. Reintenta en unos minutos.", tono: "error" },
  red: { texto: "No pudimos comunicarnos con Meta. Suele ser pasajero.", tono: "error" },
};

/** ¿Este texto de la URL es uno de nuestros códigos de error? */
function esCodigoDeError(v: string): v is CodigoErrorAds {
  return Object.prototype.hasOwnProperty.call(ERRORES, v);
}

const PILDORA: Record<EstadoItem, { texto: string; tono: "ok" | "alerta" | "neutro" }> = {
  ok: { texto: "Activo", tono: "ok" },
  atencion: { texto: "Requiere atención", tono: "alerta" },
  falta: { texto: "Requiere configuración", tono: "neutro" },
  manual: { texto: "No disponible", tono: "neutro" },
};

/**
 * INTEGRACIONES — cuatro tarjetas, una por integración real.
 *
 * Se muestran separadas porque fallan por separado y sirven para cosas
 * distintas: la atribución por WhatsApp funciona sin configurar nada, Meta
 * agrega el costo, la API de conversiones mejora el resultado y el enlace de
 * pago permite calcular el retorno.
 *
 * Cada tarjeta dice lo mismo en el mismo orden: qué es, en qué estado está,
 * dos o tres hechos verificables, y la acción. El detalle técnico —la cola de
 * eventos, el identificador del conjunto de datos, la prueba de lectura— vive
 * dentro de «Ver detalles», que se abre solo cuando alguien lo necesita.
 */
export default async function Integraciones({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; ok?: string; p?: string }>;
}) {
  const usuario = await exigirPermisoPortal("gestionar_integraciones");
  const demo = await modoDemo();
  const params = await searchParams;
  /**
   * El aviso, con el nombre de la plataforma correcta.
   *
   * `AVISOS` nombra a Meta en cada texto porque se escribió cuando era el único
   * canal. Cuando el fallo viene de Google (`?p=google`), el mensaje sale del
   * catálogo de errores traducido con `mensajeDeFalla`, que es la función que
   * ya hace esa sustitución para el resto del módulo. Así no hay dos catálogos
   * de textos que se desincronicen.
   */
  const proveedorDelAviso: Proveedor = params.p === "google" ? "google" : "meta";
  const codigo = params.e ?? "";
  const aviso =
    AVISOS[params.ok ?? ""] ??
    (proveedorDelAviso === "google" && esCodigoDeError(codigo)
      ? { texto: mensajeDeFalla("google", codigo), tono: "error" as const }
      : AVISOS[codigo]);

  const [estado, conexion, clienteRow, conexionGoogle] = await Promise.all([
    estadoDePauta(usuario.clienteId),
    conexionDe(usuario.clienteId),
    db().from("ed_clientes").select("ads_dataset_id, waba_id, pago_link_base").eq("id", usuario.clienteId).maybeSingle(),
    googleAdsConfigurado() ? conexionGoogleDe(usuario.clienteId) : Promise.resolve(null),
  ]);

  let dataset = String(clienteRow.data?.ads_dataset_id ?? "");
  let wabaId = String(clienteRow.data?.waba_id ?? "");
  let pagoLink = String(clienteRow.data?.pago_link_base ?? "");
  // Sin la 302, `ads_dataset_id` no existe y PostgREST rechaza el select completo.
  if (clienteRow.error) {
    const solo = await db().from("ed_clientes").select("waba_id, pago_link_base").eq("id", usuario.clienteId).maybeSingle();
    wabaId = String(solo.data?.waba_id ?? "");
    pagoLink = String(solo.data?.pago_link_base ?? "");
    dataset = "";
  }
  const faltaMigracion = Boolean(clienteRow.error);

  const necesitaElegir = Boolean(conexion && !conexion.cuentaId);
  const cuentas = necesitaElegir ? await proveedorMeta.cuentas(usuario.clienteId) : null;
  const prueba = conexion && conexion.cuentaId ? await proveedorMeta.rendimiento(usuario.clienteId, resolverRango("30d")) : null;
  const leido = prueba?.ok
    ? prueba.datos.reduce((acc, r) => ({ anuncios: acc.anuncios + 1, gasto: acc.gasto + r.gasto.valor }), { anuncios: 0, gasto: 0 })
    : null;

  /**
   * Google, con el MISMO criterio que Meta: la lista de cuentas solo se pide
   * cuando falta elegir, y la prueba de lectura solo cuando ya hay una cuenta.
   * Preguntar las dos cosas siempre serían dos viajes a Google en cada carga de
   * una pantalla que casi siempre se abre para mirar, no para configurar.
   */
  const googleNecesitaElegir = Boolean(conexionGoogle && !conexionGoogle.cuentaId);
  const [cuentasGoogle, pruebaGoogle] = await Promise.all([
    googleNecesitaElegir && conexionGoogle ? cuentasDeGoogle(conexionGoogle.refreshToken) : Promise.resolve(null),
    conexionGoogle && conexionGoogle.cuentaId
      ? pruebaDeLecturaGoogle(usuario.clienteId, resolverRango("30d"))
      : Promise.resolve(null),
  ]);

  let cola = { pendientes: 0, enviados: 0, descartados: 0, fallidos: 0 };
  try {
    const conteo = async (e: string) =>
      (await db().from("ed_ads_eventos").select("id", { count: "exact", head: true }).eq("cliente_id", usuario.clienteId).eq("estado", e)).count ?? 0;
    const [p, en, d, f] = await Promise.all([conteo("pendiente"), conteo("enviado"), conteo("descartado"), conteo("fallido")]);
    cola = { pendientes: p, enviados: en, descartados: d, fallidos: f };
  } catch {
    // Sin la migración, la cola no existe todavía.
  }

  const item = (titulo: string) => estado.items.find((i) => i.titulo === titulo);
  const iAtrib = item("Anuncios que llevan a WhatsApp");
  const iClid = item("Identificador del clic");
  const iMeta = item("Cuenta publicitaria de Meta");
  const iCapi = item("Devolverle las ventas a Meta");
  const iPago = item("Cobro por enlace de pago");
  const conversaciones = Number((iAtrib?.detalle ?? "").match(/^(\d+)/)?.[1] ?? 0);
  const clids = Number((iClid?.detalle ?? "").match(/^(\d+)/)?.[1] ?? 0);

  return (
    <main className="mk-pagina">
      <Cabecera
        titulo="Integraciones"
        bajada="Qué está midiendo Marketing hoy. Nada de esto es necesario para crear anuncios."
        controles={
          <span
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-[7px]"
            style={{ borderColor: "var(--borde)", background: "var(--superficie)", fontSize: "12.5px", fontWeight: 600, color: "var(--muted)" }}
          >
            {/* El contador cuenta TARJETAS, no chequeos internos: decir «0/5»
                arriba de cuatro tarjetas manda a buscar una quinta. */}
            <span className="cifra" style={{ color: "var(--tinta)" }}>
              {[iAtrib, iMeta, iCapi, iPago].filter((i) => i?.estado === "ok").length +
                (conexionGoogle && conexionGoogle.cuentaId ? 1 : 0)}
              /{googleAdsConfigurado() ? 5 : 4}
            </span>
            integraciones listas
          </span>
        }
      />

      {demo && (
        <div className="mk-panel mk-aviso mb-6" style={{ borderLeft: "3px solid var(--alerta)" }}>
          <strong>Esta pantalla muestra tu configuración real</strong>, aunque el resto de Marketing esté con datos de demostración. Lo
          que conectes acá queda conectado de verdad.
        </div>
      )}

      {aviso && (
        <div
          className="mk-panel mk-aviso mb-6"
          style={{ borderLeft: `3px solid ${aviso.tono === "ok" ? "var(--ok)" : "var(--alerta)"}` }}
        >
          {aviso.texto}
        </div>
      )}

      <div className="mk-integraciones">
        {/* ── 1. WhatsApp: la atribución ────────────────────────────────── */}
        <Tarjeta
          logo="whatsapp"
          icono={Ico.whatsapp({ className: "h-5 w-5" })}
          titulo="Atribución por WhatsApp"
          descripcion="Cuando alguien entra a WhatsApp desde un anuncio, Meta marca de qué aviso vino y Respondo lo guarda con la conversación."
          estado={iAtrib?.estado ?? "falta"}
          hechos={[
            { etiqueta: "Conversaciones atribuidas", valor: conversaciones > 0 ? formatearNumero(conversaciones) : "Ninguna todavía" },
            { etiqueta: "Con identificador de clic", valor: clids > 0 ? formatearNumero(clids) : "—" },
          ]}
          pie={
            !wabaId ? (
              <Link href="/whatsapp" className="btn-primario">
                Conectar WhatsApp
              </Link>
            ) : (
              <span className="mk-meta">No hay nada que configurar: funciona solo.</span>
            )
          }
          detalles={
            <ul className="space-y-3">
              <Linea item={iAtrib} />
              <Linea item={iClid} />
            </ul>
          }
        />

        {/* ── 2. Meta Ads ───────────────────────────────────────────────── */}
        <Tarjeta
          logo="meta"
          icono={Ico.meta({ className: "h-5 w-5" })}
          titulo="Meta Ads"
          descripcion="Pone el costo al lado de los resultados. Solo lectura: Respondo no crea, pausa ni cambia presupuestos."
          estado={iMeta?.estado ?? "falta"}
          hechos={
            conexion && conexion.cuentaId
              ? [
                  { etiqueta: "Cuenta", valor: conexion.cuentaNombre || conexion.cuentaId },
                  ...(conexion.negocioNombre
                    ? [{ etiqueta: "Portafolio", valor: conexion.negocioNombre }]
                    : []),
                  { etiqueta: "Factura en", valor: conexion.moneda },
                  { etiqueta: "Zona horaria", valor: conexion.zonaHoraria },
                  {
                    etiqueta: "Última lectura",
                    valor: leido ? `${formatearNumero(leido.anuncios)} anuncios · 30 días` : "—",
                  },
                  {
                    etiqueta: "Página",
                    valor: conexion.paginaNombre || "Sin vincular todavía",
                  },
                  ...(conexion.instagramUsuario
                    ? [{ etiqueta: "Instagram", valor: `@${conexion.instagramUsuario}` }]
                    : []),
                ]
              : []
          }
          pie={
            !metaAdsConfigurado() ? (
              <span style={{ fontSize: "12.5px", color: "var(--alerta)" }}>Todavía no está activada.</span>
            ) : !conexion ? (
              <a href="/api/ads/conectar" className="btn-primario">
                Conectar Meta
              </a>
            ) : necesitaElegir ? (
              <span style={{ fontSize: "12.5px", color: "var(--alerta)" }}>Falta elegir la cuenta publicitaria.</span>
            ) : (
              <>
                <a href="/api/ads/conectar" className="btn-chico">
                  Reconectar
                </a>
                <SelectorCuenta cuentas={[]} soloDesconectar />
              </>
            )
          }
          detalles={
            <>
              {necesitaElegir &&
                (cuentas?.ok ? (
                  <div className="mb-4">
                    <SelectorCuenta cuentas={cuentas.datos} />
                  </div>
                ) : (
                  <p style={{ fontSize: "12.5px", color: "var(--alerta)" }}>{cuentas?.error.mensaje}</p>
                ))}
              {prueba && (
                <div className="mk-hundido px-4 py-3" style={{ fontSize: "12.5px" }}>
                  {prueba.ok && leido ? (
                    leido.anuncios > 0 ? (
                      <>
                        <strong style={{ color: "var(--ok)" }}>Leyendo bien.</strong> Últimos 30 días: {formatearNumero(leido.anuncios)}{" "}
                        {leido.anuncios === 1 ? "anuncio" : "anuncios"} con actividad y{" "}
                        <strong>{formatearMonto({ valor: leido.gasto, moneda: conexion!.moneda }, { monedaDelNegocio: "CLP" })}</strong>{" "}
                        invertidos. Tiene que cuadrar con tu Administrador de Anuncios.
                      </>
                    ) : (
                      <>
                        <strong>La conexión funciona</strong>, pero esta cuenta no tuvo anuncios con actividad en los últimos 30 días.
                      </>
                    )
                  ) : (
                    <span style={{ color: "var(--alerta)" }}>{prueba.ok ? "" : prueba.error.mensaje}</span>
                  )}
                </div>
              )}
              {conexion && conexion.moneda.toUpperCase() !== "CLP" && (
                <p className="mt-3" style={{ fontSize: "11.5px", color: "var(--alerta)" }}>
                  Tu cuenta factura en {conexion.moneda} y tus cobros están en pesos. No se mezclan: el retorno aparece como no disponible
                  en vez de dar un número equivocado.
                </p>
              )}
              {conexion?.ultimoError && (
                <p className="mt-3" style={{ fontSize: "11.5px", color: "var(--alerta)" }}>
                  Último problema: {conexion.ultimoError}
                </p>
              )}
              <p className="mt-3" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
                Respondo lee tu cuenta publicitaria pero no la modifica: no crea, no pausa ni cambia presupuestos.
                Por ahora el asistente arma la campaña completa y la dejas en Meta en dos minutos.
              </p>
            </>
          }
        />

        {/* ── 3. Google Ads ─────────────────────────────────────────────── */}
        <Tarjeta
          logo="indigo"
          icono={Ico.grafico({ className: "h-5 w-5" })}
          titulo="Google Ads"
          descripcion="Campañas, grupos, anuncios, palabras clave y términos de búsqueda. Solo lectura: Respondo no crea, pausa ni cambia pujas."
          estado={
            !googleAdsConfigurado()
              ? "manual"
              : conexionGoogle && conexionGoogle.cuentaId
                ? "ok"
                : conexionGoogle
                  ? "atencion"
                  : "falta"
          }
          hechos={
            conexionGoogle && conexionGoogle.cuentaId
              ? [
                  { etiqueta: "Cuenta", valor: conexionGoogle.cuentaNombre || formatearIdCuenta(conexionGoogle.cuentaId) },
                  { etiqueta: "Identificador", valor: formatearIdCuenta(conexionGoogle.cuentaId) },
                  { etiqueta: "Factura en", valor: conexionGoogle.moneda },
                  {
                    etiqueta: "Última lectura",
                    valor:
                      pruebaGoogle?.ok
                        ? `${formatearNumero(pruebaGoogle.datos.campanas)} campañas · 30 días`
                        : "—",
                  },
                ]
              : []
          }
          pie={
            !googleAdsConfigurado() ? (
              <span style={{ fontSize: "12.5px", color: "var(--alerta)" }}>Todavía no está activada.</span>
            ) : !conexionGoogle ? (
              <a href="/api/ads/google/conectar" className="btn-primario">
                Conectar Google Ads
              </a>
            ) : googleNecesitaElegir ? (
              <span style={{ fontSize: "12.5px", color: "var(--alerta)" }}>Falta elegir la cuenta.</span>
            ) : (
              <>
                <a href="/api/ads/google/conectar" className="btn-chico">
                  Reconectar
                </a>
                <SelectorCuentaGoogle cuentas={[]} soloDesconectar />
              </>
            )
          }
          detalles={
            <>
              {googleNecesitaElegir &&
                (cuentasGoogle?.ok ? (
                  <div className="mb-4">
                    <SelectorCuentaGoogle
                      cuentas={cuentasGoogle.datos.map((c) => ({
                        id: c.id,
                        nombre: c.nombre,
                        moneda: c.moneda,
                        administradora: c.administradora,
                        idLegible: formatearIdCuenta(c.id),
                      }))}
                    />
                  </div>
                ) : (
                  <p style={{ fontSize: "12.5px", color: "var(--alerta)" }}>{cuentasGoogle?.error.mensaje}</p>
                ))}

              {pruebaGoogle && (
                <div className="mk-hundido px-4 py-3" style={{ fontSize: "12.5px" }}>
                  {pruebaGoogle.ok ? (
                    pruebaGoogle.datos.campanas > 0 ? (
                      <>
                        <strong style={{ color: "var(--ok)" }}>Leyendo bien.</strong> Últimos 30 días:{" "}
                        {formatearNumero(pruebaGoogle.datos.campanas)}{" "}
                        {pruebaGoogle.datos.campanas === 1 ? "campaña" : "campañas"} con actividad y{" "}
                        <strong>
                          {formatearMonto(pruebaGoogle.datos.gasto, { monedaDelNegocio: "CLP" })}
                        </strong>{" "}
                        invertidos. Tiene que cuadrar con tu cuenta de Google Ads.
                      </>
                    ) : (
                      <>
                        <strong>La conexión funciona</strong>, pero esta cuenta no tuvo campañas con actividad en los
                        últimos 30 días.
                      </>
                    )
                  ) : (
                    <span style={{ color: "var(--alerta)" }}>{pruebaGoogle.error.mensaje}</span>
                  )}
                </div>
              )}

              {conexionGoogle?.cuentaPadreId && (
                <p className="mt-3" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
                  Se entra por la cuenta administradora {formatearIdCuenta(conexionGoogle.cuentaPadreId)}.
                </p>
              )}
              {conexionGoogle?.ultimoError && (
                <p className="mt-3" style={{ fontSize: "11.5px", color: "var(--alerta)" }}>
                  Último problema: {conexionGoogle.ultimoError}
                </p>
              )}
              <p className="mt-3" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
                Respondo lee tu cuenta de Google Ads pero no la modifica: no crea campañas, no pausa palabras clave ni
                agrega negativas. Los cambios propuestos se muestran para que los apliques tú.
              </p>
            </>
          }
        />

        {/* ── 4. API de conversiones ────────────────────────────────────── */}
        <Tarjeta
          logo="indigo"
          icono={Ico.atribucion({ className: "h-5 w-5" })}
          titulo="API de conversiones"
          descripcion="Hoy Meta solo sabe que alguien te escribió. Si le avisamos quién compró, empieza a buscar compradores."
          estado={iCapi?.estado ?? "falta"}
          hechos={[
            { etiqueta: "Eventos enviados", valor: formatearNumero(cola.enviados) },
            { etiqueta: "Por enviar", valor: formatearNumero(cola.pendientes) },
          ]}
          pie={
            !wabaId ? (
              <Link href="/whatsapp" className="btn-primario">
                Conectar WhatsApp
              </Link>
            ) : dataset ? (
              <span className="mk-meta">Conjunto de datos configurado.</span>
            ) : (
              <span style={{ fontSize: "12.5px", color: "var(--muted)" }}>Falta el identificador del conjunto de datos.</span>
            )
          }
          detalles={
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(EVENTOS) as (keyof typeof EVENTOS)[]).map((k) => (
                  <div key={k} className="mk-hundido p-3">
                    <div style={{ fontSize: "12.5px", fontWeight: 600 }}>{EVENTOS[k].etiqueta}</div>
                    <div className="mt-0.5 leading-snug" style={{ fontSize: "11px", color: "var(--muted-2)" }}>
                      {EVENTOS[k].origen}
                    </div>
                  </div>
                ))}
              </div>
              {faltaMigracion ? (
                <p className="mt-4" style={{ fontSize: "12.5px", color: "var(--alerta)" }}>
                  Todavía no está habilitado el guardado del conjunto de datos en tu cuenta. Es un paso nuestro y ya está avisado.
                </p>
              ) : (
                wabaId && (
                  <div className="mt-4">
                    <FormularioDataset valor={dataset} />
                  </div>
                )
              )}
              {cola.pendientes + cola.enviados + cola.descartados + cola.fallidos > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Pildora tono="neutro">{cola.pendientes} por enviar</Pildora>
                  <Pildora tono="ok">{cola.enviados} enviados</Pildora>
                  {cola.fallidos > 0 && <Pildora tono="alerta">{cola.fallidos} con problema</Pildora>}
                  {cola.descartados > 0 && (
                    <Pildora tono="neutro" tip="Sin identificador del clic: Meta no podría atribuirlos">
                      {cola.descartados} descartados
                    </Pildora>
                  )}
                </div>
              )}
            </>
          }
        />

        {/* ── 4. Enlace de pago ─────────────────────────────────────────── */}
        <Tarjeta
          logo="indigo"
          icono={Ico.pago({ className: "h-5 w-5" })}
          titulo="Enlace de pago"
          descripcion="Lo que se cobra por enlace queda unido a la conversación y, por lo tanto, al anuncio. Es lo que hace posible el ROAS."
          estado={iPago?.estado ?? (pagoLink ? "ok" : "falta")}
          hechos={[{ etiqueta: "Estado", valor: pagoLink ? "Configurado" : "Sin configurar" }]}
          pie={
            <Link href="/informacion" className={pagoLink ? "btn-chico" : "btn-primario"}>
              {pagoLink ? "Administrar" : "Configurar"}
            </Link>
          }
          detalles={
            <p style={{ fontSize: "12.5px", color: "var(--muted)", lineHeight: 1.55 }}>
              {pagoLink
                ? "Cada pago por enlace se atribuye al anuncio que trajo a la persona. Los ingresos que ves en Marketing son un piso: solo cuentan lo que pasó por acá."
                : "Sin enlace de pago las ventas igual se cuentan (por la etapa «ganado» del embudo), pero la columna de ingresos queda en raya y no se puede calcular el retorno."}
            </p>
          }
        />
      </div>

      <p className="mt-7 max-w-3xl leading-relaxed" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
        De dónde vienen las ventas que llegan por WhatsApp se ve desde el primer día, sin conectar nada, y el estudio creativo y el
        asistente de campañas funcionan igual. Lo de esta pantalla agrega el costo y hace que Meta aprenda de tus resultados.
      </p>
    </main>
  );
}

function Tarjeta({
  logo,
  icono,
  titulo,
  descripcion,
  estado,
  hechos,
  pie,
  detalles,
}: {
  logo: "meta" | "whatsapp" | "indigo";
  icono: React.ReactNode;
  titulo: string;
  descripcion: string;
  estado: EstadoItem;
  hechos: { etiqueta: string; valor: string }[];
  pie: React.ReactNode;
  detalles: React.ReactNode;
}) {
  const p = PILDORA[estado];
  return (
    <section className="mk-integracion">
      <div className="mk-integracion-cabecera">
        <span className={`mk-integracion-logo ${logo}`} aria-hidden="true">
          {icono}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="mk-integracion-titulo">{titulo}</h2>
            <Pildora tono={p.tono}>{p.texto}</Pildora>
          </div>
          <p className="mt-1.5 leading-relaxed" style={{ fontSize: "12.5px", color: "var(--muted)" }}>
            {descripcion}
          </p>
        </div>
      </div>

      {hechos.length > 0 && (
        <dl className="mk-integracion-hechos">
          {hechos.map((h) => (
            <div key={h.etiqueta} className="min-w-0">
              <dt className="mk-dato-mini-etiqueta">{h.etiqueta}</dt>
              <dd className="truncate" style={{ fontSize: "13px", fontWeight: 600, color: "var(--tinta)" }} title={h.valor}>
                {h.valor}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mk-integracion-pie">
        <div className="flex flex-wrap items-center gap-2">{pie}</div>
      </div>

      <details>
        <summary>Ver detalles</summary>
        <div>{detalles}</div>
      </details>
    </section>
  );
}

function Linea({ item }: { item?: { titulo: string; estado: EstadoItem; detalle: string; accion?: { texto: string; href: string } } }) {
  if (!item) return null;
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden="true"
        className="mt-[7px] h-2 w-2 shrink-0 rounded-full"
        style={{ background: item.estado === "ok" ? "var(--ok)" : item.estado === "atencion" ? "var(--alerta)" : "var(--muted-3)" }}
      />
      <div className="min-w-0">
        <div style={{ fontSize: "12.5px", fontWeight: 600 }}>{item.titulo}</div>
        <div className="leading-snug" style={{ fontSize: "11.5px", color: "var(--muted)" }}>
          {item.detalle}
        </div>
        {item.accion && (
          <Link href={item.accion.href} className="mk-enlace mt-1 inline-flex" style={{ fontSize: "11.5px" }}>
            {item.accion.texto} →
          </Link>
        )}
      </div>
    </li>
  );
}
