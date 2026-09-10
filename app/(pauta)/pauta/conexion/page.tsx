import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { conexionDe, metaAdsConfigurado, proveedorMeta } from "@/lib/ads/meta";
import { estadoDePauta } from "@/lib/ads/estado";
import { EVENTOS } from "@/lib/ads/eventos";
import FormularioDataset from "@/components/pauta/FormularioDataset";
import SelectorCuenta from "@/components/pauta/SelectorCuenta";

export const dynamic = "force-dynamic";

/** Mensajes de vuelta del OAuth. Cada uno dice qué pasó y qué hacer. */
const AVISOS: Record<string, { texto: string; tono: "ok" | "error" }> = {
  "1": { texto: "Cuenta publicitaria conectada.", tono: "ok" },
  elegir: {
    texto: "Meta autorizó el acceso. Elige cuál de tus cuentas publicitarias es la de este negocio.",
    tono: "ok",
  },
  cancelado: { texto: "Se canceló la autorización en Meta. No se guardó nada.", tono: "error" },
  sin_cuentas: {
    texto:
      "La cuenta de Meta con la que entraste no administra ninguna cuenta publicitaria. Entra con la cuenta que sí las administra.",
    tono: "error",
  },
  no_configurado: {
    texto: "La conexión con Meta todavía no está habilitada en esta instalación de Respondo.",
    tono: "error",
  },
  estado_invalido: {
    texto: "El enlace de vuelta venció o no era válido. Vuelve a intentarlo desde acá.",
    tono: "error",
  },
  respuesta_incompleta: { texto: "Meta devolvió una respuesta incompleta.", tono: "error" },
  no_se_guardo: { texto: "No pudimos guardar la conexión. Vuelve a intentarlo.", tono: "error" },
  token_vencido: { texto: "El permiso de Meta venció mientras conectábamos.", tono: "error" },
  sin_permiso: {
    texto: "Falta permiso para leer esa cuenta publicitaria en Meta.",
    tono: "error",
  },
  limite_api: { texto: "Meta nos pidió esperar. Reintenta en unos minutos.", tono: "error" },
  red: { texto: "No pudimos comunicarnos con Meta. Suele ser pasajero.", tono: "error" },
};

/**
 * CONEXIÓN — qué falta para ver más.
 *
 * ⭐ SON DOS INTEGRACIONES DISTINTAS Y SE MUESTRAN SEPARADAS, porque fallan por
 * separado y sirven para cosas distintas:
 *
 *   · **Leer la cuenta publicitaria** agrega el COSTO al lado de los
 *     resultados. Sin esto igual se ve qué anuncio trajo cada venta.
 *   · **Devolver las conversiones** hace que Meta reparta el presupuesto hacia
 *     los avisos que traen compradores. Es lo único de acá que mejora el
 *     resultado en vez de solo explicarlo.
 *
 * Mostrarlas como un solo interruptor «conectar Meta» haría creer que sin las
 * dos no hay nada, cuando la parte más valiosa —la atribución— ya funciona.
 */
export default async function Conexion({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; ok?: string }>;
}) {
  const usuario = await exigirPermisoPortal("gestionar_integraciones");
  const params = await searchParams;
  const aviso = AVISOS[params.ok ?? ""] ?? AVISOS[params.e ?? ""];

  const [estado, conexion, clienteRow] = await Promise.all([
    estadoDePauta(usuario.clienteId),
    conexionDe(usuario.clienteId),
    db()
      .from("ed_clientes")
      .select("ads_dataset_id, waba_id")
      .eq("id", usuario.clienteId)
      .maybeSingle(),
  ]);

  let dataset = String(clienteRow.data?.ads_dataset_id ?? "");
  let wabaId = String(clienteRow.data?.waba_id ?? "");

  /**
   * ⚠️ Si la migración 302 no está aplicada, `ads_dataset_id` no existe y
   * PostgREST rechaza **el select completo** — devolviendo el error, no
   * lanzándolo. Sin este reintento, `waba_id` quedaría vacío y la pantalla
   * diría «primero hay que conectar WhatsApp» a alguien que lo tiene conectado
   * hace meses: un mensaje falso, que es peor que un error.
   */
  if (clienteRow.error) {
    const soloWaba = await db()
      .from("ed_clientes")
      .select("waba_id")
      .eq("id", usuario.clienteId)
      .maybeSingle();
    wabaId = String(soloWaba.data?.waba_id ?? "");
    dataset = "";
  }

  /** ¿Falta la 302? Se dice explícitamente en vez de mostrar un formulario que no guarda. */
  const faltaMigracion = Boolean(clienteRow.error);

  /**
   * Solo se piden las cuentas cuando hace falta elegir. Es una llamada a la
   * Graph API: hacerla en cada visita a la pantalla sería pegarle a Meta para
   * nada y gastar cuota que después falta para lo que sí importa.
   */
  const necesitaElegir = Boolean(conexion && !conexion.cuentaId);
  const cuentas = necesitaElegir ? await proveedorMeta.cuentas(usuario.clienteId) : null;

  /** Estado de la cola de eventos. Tolerante a que la 302 no esté aplicada. */
  let cola = { pendientes: 0, enviados: 0, descartados: 0, fallidos: 0 };
  try {
    const conteo = async (e: string) =>
      (
        await db()
          .from("ed_ads_eventos")
          .select("id", { count: "exact", head: true })
          .eq("cliente_id", usuario.clienteId)
          .eq("estado", e)
      ).count ?? 0;
    const [p, en, d, f] = await Promise.all([
      conteo("pendiente"),
      conteo("enviado"),
      conteo("descartado"),
      conteo("fallido"),
    ]);
    cola = { pendientes: p, enviados: en, descartados: d, fallidos: f };
  } catch {
    // Sin la migración, la cola simplemente no existe todavía.
  }

  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      <h1 className="h-pagina">Conexión</h1>
      <p className="sub-pagina">Qué está midiendo Pauta hoy y qué falta para ver más</p>

      {aviso && (
        <div
          className="tarjeta mt-5 p-4"
          style={{
            borderLeft: `3px solid ${aviso.tono === "ok" ? "var(--ok)" : "var(--alerta)"}`,
          }}
        >
          <span style={{ fontSize: "var(--t-menor)" }}>{aviso.texto}</span>
        </div>
      )}

      {/* ── Checklist ─────────────────────────────────────────────────────── */}
      <section className="tarjeta mt-5 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="h-seccion">En qué pie estamos</h2>
          <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
            {estado.listos} de {estado.total} listos
          </span>
        </div>

        <div
          className="mt-3 h-1 w-full overflow-hidden rounded-full"
          style={{ background: "var(--fondo-hundido)" }}
          role="progressbar"
          aria-valuenow={estado.listos}
          aria-valuemin={0}
          aria-valuemax={estado.total}
          aria-label="Pasos completados"
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.round((estado.listos / Math.max(1, estado.total)) * 100)}%`,
              background: "var(--indigo)",
            }}
          />
        </div>

        <ul className="mt-4 space-y-3">
          {estado.items.map((i) => (
            <li key={i.titulo} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className="mt-[6px] h-2 w-2 shrink-0 rounded-full"
                style={{
                  background:
                    i.estado === "ok"
                      ? "var(--ok)"
                      : i.estado === "atencion"
                        ? "var(--alerta)"
                        : "var(--muted-3)",
                }}
              />
              <div className="min-w-0">
                <div style={{ fontSize: "var(--t-fila)", fontWeight: 600 }}>{i.titulo}</div>
                <div
                  className="leading-snug"
                  style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
                >
                  {i.detalle}
                </div>
                {i.accion && (
                  <Link
                    href={i.accion.href}
                    className="mt-1 inline-block font-semibold underline"
                    style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}
                  >
                    {i.accion.texto}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── 1. Leer la cuenta publicitaria ────────────────────────────────── */}
      <section className="tarjeta mt-5 p-5">
        <h2 className="h-seccion">Cuenta publicitaria de Meta</h2>
        <p className="mt-1 max-w-2xl leading-relaxed" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
          Con esto podemos poner el costo al lado de los resultados: cuánto invertiste, cuánto
          costó cada conversación y cada venta. Es <strong>solo lectura</strong> — Respondo no
          crea, no pausa ni cambia presupuestos de tus campañas.
        </p>

        {!metaAdsConfigurado() ? (
          <p className="mt-4" style={{ fontSize: "var(--t-menor)", color: "var(--alerta)" }}>
            Todavía no está habilitada en esta instalación de Respondo. Nos falta terminar el
            registro de la aplicación en Meta; te avisamos cuando esté.
          </p>
        ) : !conexion ? (
          <a href="/api/ads/conectar" className="btn-primario mt-4">
            Conectar Meta
          </a>
        ) : necesitaElegir ? (
          <div className="mt-4">
            {cuentas?.ok ? (
              <SelectorCuenta cuentas={cuentas.datos} />
            ) : (
              <p style={{ fontSize: "var(--t-menor)", color: "var(--alerta)" }}>
                {cuentas?.error.mensaje}
              </p>
            )}
          </div>
        ) : (
          <>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Dato titulo="Cuenta" valor={conexion.cuentaNombre || conexion.cuentaId} />
              <Dato titulo="Factura en" valor={conexion.moneda} />
              <Dato titulo="Zona horaria de la cuenta" valor={conexion.zonaHoraria} />
              <Dato
                titulo="Estado"
                valor={conexion.estado === "conectada" ? "Conectada" : "Requiere reconectar"}
              />
            </dl>
            {conexion.moneda.toUpperCase() !== "CLP" && (
              <p className="mt-3" style={{ fontSize: "var(--t-micro)", color: "var(--alerta)" }}>
                Tu cuenta factura en {conexion.moneda} y tus cobros están en pesos. No vamos a
                mezclarlas: el retorno va a aparecer como no disponible en vez de dar un número
                equivocado.
              </p>
            )}
            {conexion.ultimoError && (
              <p className="mt-3" style={{ fontSize: "var(--t-micro)", color: "var(--alerta)" }}>
                Último problema: {conexion.ultimoError}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <a href="/api/ads/conectar" className="btn-suave">
                Reconectar
              </a>
              <SelectorCuenta cuentas={[]} soloDesconectar />
            </div>
          </>
        )}
      </section>

      {/* ── 2. Devolverle las conversiones a Meta ─────────────────────────── */}
      <section className="tarjeta mt-5 p-5">
        <h2 className="h-seccion">Devolverle las ventas a Meta</h2>
        <p className="mt-1 max-w-2xl leading-relaxed" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
          Hoy Meta solo sabe que alguien te escribió, y con eso optimiza: busca gente que escriba.
          Si le avisamos quién <strong>compró</strong>, empieza a buscar compradores. Es lo único
          de esta pantalla que mejora el resultado en vez de solo explicarlo.
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {(Object.keys(EVENTOS) as (keyof typeof EVENTOS)[]).map((k) => (
            <div key={k} className="tarjeta-plana p-3">
              <div style={{ fontSize: "var(--t-fila)", fontWeight: 600 }}>
                {EVENTOS[k].etiqueta}
              </div>
              <div
                className="mt-0.5 leading-snug"
                style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
              >
                {EVENTOS[k].origen}
              </div>
            </div>
          ))}
        </div>

        {!wabaId ? (
          <p className="mt-4" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
            Primero hay que tener WhatsApp conectado: la venta ocurre ahí.{" "}
            <Link href="/whatsapp" className="font-semibold underline">
              Conectar WhatsApp
            </Link>
          </p>
        ) : faltaMigracion ? (
          <p className="mt-4" style={{ fontSize: "var(--t-menor)", color: "var(--alerta)" }}>
            Falta aplicar la migración <code>sql/302_ads.sql</code> en la base de datos. Hasta
            entonces no hay dónde guardar el conjunto de datos. Está en{" "}
            <code>ADS_OWNER_ACTIONS.md</code>, como P0.
          </p>
        ) : (
          <div className="mt-4">
            <FormularioDataset valor={dataset} />
          </div>
        )}

        {cola.pendientes + cola.enviados + cola.descartados + cola.fallidos > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="pildora-neutra">{cola.pendientes} por enviar</span>
            <span className="pildora-ok">{cola.enviados} enviados</span>
            {cola.fallidos > 0 && (
              <span className="pildora-alerta">{cola.fallidos} con problema</span>
            )}
            {cola.descartados > 0 && (
              <span className="pildora-neutra" title="Sin identificador del clic: Meta no podría atribuirlos">
                {cola.descartados} descartados
              </span>
            )}
          </div>
        )}
      </section>

      <p
        className="mt-6 max-w-3xl leading-relaxed"
        style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
      >
        Nada de lo de esta pantalla es necesario para que Pauta te sirva: de dónde viene cada
        venta se ve desde el primer día, sin conectar nada. Lo de acá agrega el costo y hace que
        Meta aprenda de tus resultados.
      </p>
    </main>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <dt style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{titulo}</dt>
      <dd className="mt-0.5" style={{ fontSize: "var(--t-fila)", fontWeight: 600 }}>
        {valor}
      </dd>
    </div>
  );
}
