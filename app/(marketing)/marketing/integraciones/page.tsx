import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { conexionDe, metaAdsConfigurado, proveedorMeta } from "@/lib/ads/meta";
import { estadoDePauta, type EstadoItem } from "@/lib/ads/estado";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import { resolverRango } from "@/lib/ads/periodos";
import { EVENTOS } from "@/lib/ads/eventos";
import { modoDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import FormularioDataset from "@/components/marketing/FormularioDataset";
import SelectorCuenta from "@/components/marketing/SelectorCuenta";
import { Ico } from "@/components/marketing/Iconos";

export const dynamic = "force-dynamic";

/** Mensajes de vuelta del OAuth. Cada uno dice qué pasó y qué hacer. */
const AVISOS: Record<string, { texto: string; tono: "ok" | "error" }> = {
  "1": { texto: "Cuenta publicitaria conectada.", tono: "ok" },
  elegir: { texto: "Meta autorizó el acceso. Elige cuál de tus cuentas publicitarias es la de este negocio.", tono: "ok" },
  cancelado: { texto: "Se canceló la autorización en Meta. No se guardó nada.", tono: "error" },
  sin_cuentas: { texto: "La cuenta de Meta con la que entraste no administra ninguna cuenta publicitaria. Entra con la cuenta que sí las administra.", tono: "error" },
  no_configurado: { texto: "La conexión con Meta todavía no está habilitada en esta instalación de Respondo.", tono: "error" },
  estado_invalido: { texto: "El enlace de vuelta venció o no era válido. Vuelve a intentarlo desde acá.", tono: "error" },
  respuesta_incompleta: { texto: "Meta devolvió una respuesta incompleta.", tono: "error" },
  no_se_guardo: { texto: "No pudimos guardar la conexión. Vuelve a intentarlo.", tono: "error" },
  token_vencido: { texto: "El permiso de Meta venció mientras conectábamos.", tono: "error" },
  sin_permiso: { texto: "Falta permiso para leer esa cuenta publicitaria en Meta.", tono: "error" },
  limite_api: { texto: "Meta nos pidió esperar. Reintenta en unos minutos.", tono: "error" },
  red: { texto: "No pudimos comunicarnos con Meta. Suele ser pasajero.", tono: "error" },
};

const PILDORA: Record<EstadoItem, { texto: string; clase: string }> = {
  ok: { texto: "Conectado", clase: "pildora-ok" },
  atencion: { texto: "Requiere atención", clase: "pildora-alerta" },
  falta: { texto: "Pendiente", clase: "pildora-neutra" },
  manual: { texto: "No disponible", clase: "pildora-neutra" },
};

/**
 * INTEGRACIONES — qué está midiendo Marketing hoy y qué falta para ver más.
 *
 * Cuatro tarjetas, una por integración, porque fallan por separado y sirven
 * para cosas distintas. La atribución (WhatsApp) funciona sin configurar
 * nada; Meta agrega el costo; la API de conversiones mejora el resultado;
 * el enlace de pago pone la plata al lado.
 *
 * Nada de acá bloquea el estudio creativo ni el asistente de campañas.
 */
export default async function Integraciones({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const usuario = await exigirPermisoPortal("gestionar_integraciones");
  const demo = await modoDemo();
  const params = await searchParams;
  const aviso = AVISOS[params.ok ?? ""] ?? AVISOS[params.e ?? ""];

  const [estado, conexion, clienteRow] = await Promise.all([
    estadoDePauta(usuario.clienteId),
    conexionDe(usuario.clienteId),
    db().from("ed_clientes").select("ads_dataset_id, waba_id, pago_link_base").eq("id", usuario.clienteId).maybeSingle(),
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
  const leido = prueba?.ok ? prueba.datos.reduce((acc, r) => ({ anuncios: acc.anuncios + 1, gasto: acc.gasto + r.gasto.valor }), { anuncios: 0, gasto: 0 }) : null;

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

  return (
    <main className="mk-pagina">
      <Cabecera
        eyebrow={`Marketing · ${usuario.clienteNombre}`}
        titulo="Integraciones"
        bajada="Qué está midiendo Marketing hoy y qué falta para ver más. Nada de acá es necesario para crear anuncios."
        acciones={
          <span className="cifra pildora-neutra" title="Pasos listos">
            {estado.listos} de {estado.total} listos
          </span>
        }
      />

      {demo && (
        <div className="tarjeta mb-5 p-4" style={{ borderLeft: "3px solid var(--alerta)", fontSize: "var(--t-menor)" }}>
          Estás viendo el resto de Marketing con datos de demostración, pero esta pantalla muestra <strong>tu configuración real</strong>. Lo que conectes acá queda conectado de verdad.
        </div>
      )}

      {aviso && (
        <div className="tarjeta mb-5 p-4" style={{ borderLeft: `3px solid ${aviso.tono === "ok" ? "var(--ok)" : "var(--alerta)"}`, fontSize: "var(--t-menor)" }}>
          {aviso.texto}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── WhatsApp: atribución ─────────────────────────────────────────── */}
        <Tarjeta
          icono={Ico.whatsapp()}
          titulo="Atribución por WhatsApp"
          descripcion="Cuando alguien entra a WhatsApp desde un anuncio, Meta marca de qué aviso vino y Respondo lo guarda con la conversación. Es la base de toda la sección y no hay nada que configurar."
          estado={iAtrib?.estado ?? "falta"}
        >
          <ul className="space-y-2" style={{ fontSize: "var(--t-menor)" }}>
            <Linea estado={iAtrib?.estado ?? "falta"} titulo={iAtrib?.titulo ?? ""} detalle={iAtrib?.detalle ?? ""} accion={iAtrib?.accion} />
            <Linea estado={iClid?.estado ?? "falta"} titulo={iClid?.titulo ?? ""} detalle={iClid?.detalle ?? ""} accion={iClid?.accion} />
          </ul>
          {!wabaId && (
            <p className="mt-3" style={{ fontSize: "var(--t-menor)", color: "var(--alerta)" }}>
              WhatsApp no está conectado todavía.{" "}
              <Link href="/whatsapp" className="font-semibold underline">Conectar WhatsApp</Link>
            </p>
          )}
        </Tarjeta>

        {/* ── Meta Ads ────────────────────────────────────────────────────── */}
        <Tarjeta
          icono={Ico.campanas()}
          titulo="Cuenta publicitaria de Meta"
          descripcion="Pone el costo al lado de los resultados: cuánto invertiste, cuánto costó cada conversación y cada venta. Solo lectura: Respondo no crea, pausa ni cambia presupuestos."
          estado={iMeta?.estado ?? "falta"}
        >
          {!metaAdsConfigurado() ? (
            <p style={{ fontSize: "var(--t-menor)", color: "var(--alerta)" }}>
              Todavía no está habilitada en esta instalación de Respondo. Faltan las variables de la aplicación de Meta en el servidor.
            </p>
          ) : !conexion ? (
            <div>
              <p style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                Vas a entrar con la cuenta de Facebook que administra la cuenta publicitaria. Meta te va a preguntar qué activos compartir; alcanza con la cuenta publicitaria.
              </p>
              <a href="/api/ads/conectar" className="btn-primario mt-3">Conectar Meta</a>
            </div>
          ) : necesitaElegir ? (
            cuentas?.ok ? (
              <SelectorCuenta cuentas={cuentas.datos} />
            ) : (
              <p style={{ fontSize: "var(--t-menor)", color: "var(--alerta)" }}>{cuentas?.error.mensaje}</p>
            )
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <Dato titulo="Cuenta" valor={conexion.cuentaNombre || conexion.cuentaId} />
                <Dato titulo="Factura en" valor={conexion.moneda} />
                <Dato titulo="Zona horaria" valor={conexion.zonaHoraria} />
                <Dato titulo="Estado" valor={conexion.estado === "conectada" ? "Conectada" : "Requiere reconectar"} />
              </dl>
              {conexion.moneda.toUpperCase() !== "CLP" && (
                <p className="mt-3" style={{ fontSize: "var(--t-micro)", color: "var(--alerta)" }}>
                  Tu cuenta factura en {conexion.moneda} y tus cobros están en pesos. No se mezclan: el retorno aparece como no disponible en vez de dar un número equivocado.
                </p>
              )}
              {prueba && (
                <div className="tarjeta-plana mt-3 p-3" style={{ fontSize: "var(--t-menor)" }}>
                  {prueba.ok && leido ? (
                    leido.anuncios > 0 ? (
                      <>
                        <span style={{ color: "var(--ok)", fontWeight: 600 }}>Leyendo bien.</span> Últimos 30 días: {formatearNumero(leido.anuncios)} {leido.anuncios === 1 ? "anuncio" : "anuncios"} con actividad y{" "}
                        <strong>{formatearMonto({ valor: leido.gasto, moneda: conexion.moneda }, { monedaDelNegocio: "CLP" })}</strong> invertidos. Tiene que cuadrar con tu Administrador de Anuncios.
                      </>
                    ) : (
                      <>
                        <span style={{ fontWeight: 600 }}>La conexión funciona</span>, pero esta cuenta no tuvo anuncios con actividad en los últimos 30 días. Si esperabas ver gasto, revisa que sea la cuenta correcta.
                      </>
                    )
                  ) : (
                    <span style={{ color: "var(--alerta)" }}>{prueba.ok ? "" : prueba.error.mensaje}</span>
                  )}
                </div>
              )}
              {conexion.ultimoError && (
                <p className="mt-3" style={{ fontSize: "var(--t-micro)", color: "var(--alerta)" }}>Último problema: {conexion.ultimoError}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <a href="/api/ads/conectar" className="btn-suave">Reconectar</a>
                <SelectorCuenta cuentas={[]} soloDesconectar />
              </div>
            </>
          )}
          <p className="mt-3 border-t pt-3" style={{ borderColor: "var(--borde)", fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
            Publicar campañas desde Respondo requiere el permiso <code>ads_management</code> y una revisión de la aplicación en Meta. Por ahora el asistente arma la campaña completa y la dejas en Meta en dos minutos con «Continuar en Meta».
          </p>
        </Tarjeta>

        {/* ── API de conversiones ──────────────────────────────────────────── */}
        <Tarjeta
          icono={Ico.atribucion()}
          titulo="Devolverle las ventas a Meta"
          descripcion="Hoy Meta solo sabe que alguien te escribió, y optimiza para eso. Si le avisamos quién compró, empieza a buscar compradores. Es lo único de acá que mejora el resultado en vez de solo explicarlo."
          estado={iCapi?.estado ?? "falta"}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(EVENTOS) as (keyof typeof EVENTOS)[]).map((k) => (
              <div key={k} className="tarjeta-plana p-2.5">
                <div style={{ fontSize: "var(--t-menor)", fontWeight: 600 }}>{EVENTOS[k].etiqueta}</div>
                <div className="mt-0.5 leading-snug" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{EVENTOS[k].origen}</div>
              </div>
            ))}
          </div>
          {!wabaId ? (
            <p className="mt-3" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
              Primero hay que tener WhatsApp conectado: la venta ocurre ahí.{" "}
              <Link href="/whatsapp" className="font-semibold underline">Conectar WhatsApp</Link>
            </p>
          ) : faltaMigracion ? (
            <p className="mt-3" style={{ fontSize: "var(--t-menor)", color: "var(--alerta)" }}>
              Falta aplicar la migración <code>sql/302_ads.sql</code>. Hasta entonces no hay dónde guardar el conjunto de datos. Está en <code>ADS_OWNER_ACTIONS.md</code>, como P0.
            </p>
          ) : (
            <div className="mt-3">
              <FormularioDataset valor={dataset} />
            </div>
          )}
          {cola.pendientes + cola.enviados + cola.descartados + cola.fallidos > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="pildora-neutra">{cola.pendientes} por enviar</span>
              <span className="pildora-ok">{cola.enviados} enviados</span>
              {cola.fallidos > 0 && <span className="pildora-alerta">{cola.fallidos} con problema</span>}
              {cola.descartados > 0 && (
                <span className="pildora-neutra" title="Sin identificador del clic: Meta no podría atribuirlos">{cola.descartados} descartados</span>
              )}
            </div>
          )}
        </Tarjeta>

        {/* ── Enlace de pago ───────────────────────────────────────────────── */}
        <Tarjeta
          icono={Ico.leads()}
          titulo="Enlace de pago"
          descripcion="Lo que se cobra por enlace queda unido a la conversación y, por lo tanto, al anuncio. Es lo que llena la columna «Cobrado» y hace posible el ROAS."
          estado={iPago?.estado ?? (pagoLink ? "ok" : "falta")}
        >
          <p style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
            {pagoLink
              ? "Configurado. Cada pago por enlace se atribuye al anuncio que trajo a la persona."
              : "Sin enlace de pago las ventas igual se cuentan (por la etapa «ganado» del embudo), pero la columna «Cobrado» queda en raya y no se puede calcular el retorno."}
          </p>
          <Link href="/informacion" className={pagoLink ? "btn-suave mt-3" : "btn-primario mt-3"}>
            {pagoLink ? "Ver enlace de pago" : "Configurar enlace de pago"}
          </Link>
        </Tarjeta>
      </div>

      <p className="mt-6 max-w-3xl leading-relaxed" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
        Nada de esta pantalla es necesario para que Marketing sirva: de dónde viene cada venta se ve desde el primer día, sin conectar nada, y el estudio creativo y el asistente de campañas funcionan siempre. Lo de acá agrega el costo y hace que Meta aprenda de tus resultados.
      </p>
    </main>
  );
}

function Tarjeta({ icono, titulo, descripcion, estado, children }: { icono: React.ReactNode; titulo: string; descripcion: string; estado: EstadoItem; children: React.ReactNode }) {
  const p = PILDORA[estado];
  return (
    <section className="tarjeta flex flex-col">
      <div className="flex items-start gap-3 border-b p-4" style={{ borderColor: "var(--borde)" }}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md" style={{ background: "var(--indigo-suave)", color: "var(--indigo)" }}>
          {icono}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold" style={{ fontSize: "var(--t-fila)" }}>{titulo}</h2>
            <span className={p.clase}>{p.texto}</span>
          </div>
          <p className="mt-1 leading-relaxed" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>{descripcion}</p>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Linea({ estado, titulo, detalle, accion }: { estado: EstadoItem; titulo: string; detalle: string; accion?: { texto: string; href: string } }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden="true" className="mt-[6px] h-2 w-2 shrink-0 rounded-full" style={{ background: estado === "ok" ? "var(--ok)" : estado === "atencion" ? "var(--alerta)" : "var(--muted-3)" }} />
      <div className="min-w-0">
        <div style={{ fontWeight: 600 }}>{titulo}</div>
        <div className="leading-snug" style={{ fontSize: "var(--t-micro)", color: "var(--muted)" }}>{detalle}</div>
        {accion && (
          <Link href={accion.href} className="mt-1 inline-block font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}>
            {accion.texto} →
          </Link>
        )}
      </div>
    </li>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{titulo}</dt>
      <dd className="mt-0.5 truncate" style={{ fontSize: "var(--t-fila)", fontWeight: 600 }}>{valor}</dd>
    </div>
  );
}
