import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { procesarSeguimientos } from "@/lib/seguimientos";
import { generarParaTodos } from "@/lib/generadorSeguimientos";
import { enviarTextoWaha } from "@/lib/waha";
import { configPorCliente, enviarTexto, enviarPlantilla } from "@/lib/whatsapp";
import { ventanaAbierta } from "@/lib/ventana24";
import { plantillaPara } from "@/lib/plantillas";
import { limitarDistribuido, secretoValido } from "@/lib/seguridad";
import { LATIDO_CRON_SEGUIMIENTOS, registrarLatido } from "@/lib/latidos";
import { correrPaso, registrarProcesos } from "@/lib/procesos";
import type { ResultadoPaso } from "@/lib/procesosCore";
import { generarInformesPendientes } from "@/lib/insightsAuto";
import { renovarTokensIg } from "@/lib/instagram";
import { reprocesarWebhooksPendientes } from "@/lib/webhookInbox";
import { revisarCuposYAvisar } from "@/lib/avisosCupo";
import { revisarAbandonadas } from "@/lib/reingresoTino";
import { reconciliarEstados } from "@/lib/reconciliarEstados";
import { detectarCierres } from "@/lib/cierreVentas";
import { recalcularEmbudos } from "@/lib/embudoCron";
import { archivarPendientes } from "@/lib/archivarMedia";
import { generarSeguimientosCotizacion } from "@/lib/generadorCotizacion";
import { destilarPendientes } from "@/lib/isabelDestilado";
import { procesarEventos } from "@/lib/ads/colaEventos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * CRON DE SEGUIMIENTOS — envía los mensajes proactivos programados
 * (recordatorios de cita, reactivación de cotizaciones) de ed_seguimientos.
 *
 * Disparo: un cron externo (cron-job.org) hace GET acá cada 5 min
 * con ?k=<secreto>. El endpoint es idempotente y barato: si no hay
 * pendientes, no hace nada. Salvaguardas (horario hábil Chile, tope diario,
 * max_intentos, no_contactar) viven en lib/seguimientos.ts.
 *
 * ES EL ÚNICO CRON DEL SISTEMA. De acá cuelgan los recordatorios y encuestas de
 * la agenda, las reactivaciones de Beto y el informe semanal de los lunes. No
 * hay que crear un segundo cron para la agenda: se activa todo junto.
 *
 * Transporte por cliente: 'cloud' → API oficial de Meta; resto → WAHA
 * (misma regla que el inbox en conversaciones/acciones.ts).
 */
export async function GET(request: NextRequest) {
  // CRON_SECRET es su propio secreto desde el 5-ago-2026 (antes caía al
  // EVOLUTION_WEBHOOK_SECRET compartido con el webhook de WAHA — resabio
  // del proveedor viejo ya eliminado). Sepáralos: rotar uno no debe romper
  // el otro.
  const secreto = process.env.CRON_SECRET;
  const k = new URL(request.url).searchParams.get("k");
  // Fail closed: esta ruta ejecuta envíos y usa service_role. Una variable
  // ausente no puede convertirla silenciosamente en un cron público.
  if (!secreto) return new NextResponse("Cron no configurado", { status: 503 });
  if (!secretoValido(k, secreto)) return new NextResponse("Forbidden", { status: 403 });

  // Desde cuándo corre esta invocación: los pasos que llaman al modelo (el
  // vigilante) reciben un techo derivado de acá para no pasarse de maxDuration.
  const inicioCron = Date.now();
  const supa = db();

  /**
   * UNA CORRIDA A LA VEZ (Fase 0, 11-sep-2026). Dos corridas simultáneas (un
   * disparo manual mientras corre la programada, o un reintento del servicio de
   * cron) leían las mismas filas pendientes y podían mandar el mismo
   * recordatorio dos veces. Si la base de límites no responde, el candado cae
   * al respaldo local y deja correr: un cron bloqueado es peor que el riesgo.
   */
  if (!(await limitarDistribuido("cron:seguimientos", 1, 55)).ok) {
    return NextResponse.json({ omitido: "otra corrida en curso" });
  }

  /**
   * OBSERVABILIDAD POR PASO (Fase 0). Cada paso deja su resultado acá —éxito,
   * fallo, sin trabajo, y qué negocio falló— y al final se guarda en
   * ed_latidos como `proceso:<paso>`. Antes cada paso tragaba su error con
   * console.error y solo quedaba constancia de que "el cron corrió": el informe
   * semanal podía fallar semanas sin que nada lo mostrara. Ver lib/procesos.ts.
   */
  const procesos: ResultadoPaso[] = [];

  /**
   * GENERAR ANTES DE ENVIAR.
   *
   * El generador crea los avisos de mantención con programado_para = ahora, así
   * que lo que aparezca acá sale en esta misma pasada en vez de esperar cinco
   * minutos. Va en su propio try: si el generador falla —por una migración sin
   * aplicar, por ejemplo— los seguimientos YA programados tienen que salir
   * igual. Es la parte que el negocio está viendo funcionar.
   */
  let generados = 0;
  await correrPaso(
    "generador_seguimientos",
    async () => {
      const g = await generarParaTodos({ supa });
      generados = g.total;
      return g;
    },
    (g) => ({ ok: true, resumen: { generados: g.total } }),
    procesos,
  );

  /**
   * ENVÍO DE SEGUIMIENTOS — antes sin try: si lanzaba, se caía el cron entero
   * (sin informe, sin archivado, sin latido) y /api/salud lo veía como "cron
   * muerto" en vez de "el envío falla". Ahora se registra y los demás siguen.
   */
  const rEnvio = await correrPaso(
    "seguimientos",
    () =>
      procesarSeguimientos({
        enviar: async (empleadoId, chatId, texto, extra) => {
          // Resolver el cliente del empleado para elegir transporte.
          const { data: emp } = await supa
            .from("ed_empleados")
            .select("cliente_id")
            .eq("id", empleadoId)
            .maybeSingle();
          const clienteId = (emp?.cliente_id as string) ?? null;
          if (!clienteId) return { ok: false, error: "empleado sin cliente" };

          const { data: cli } = await supa
            .from("ed_clientes")
            .select("transporte")
            .eq("id", clienteId)
            .maybeSingle();
          const transporte = ((cli as { transporte?: string } | null)?.transporte as string) ?? "waha";

          if (transporte === "cloud") {
            const cfg = await configPorCliente(clienteId);
            if (!cfg) return { ok: false, error: "cliente cloud sin credenciales" };

            /**
             * TEXTO LIBRE vs PLANTILLA (la regla de Meta, ver lib/ventana24.ts).
             *
             * Dentro de la ventana de 24 h el texto libre es gratis y se ve más
             * natural, así que se prefiere. Fuera de la ventana Meta lo rechaza y
             * la única vía es la plantilla aprobada — que dice exactamente lo
             * mismo, porque el texto se renderizó desde su cuerpo.
             */
            const abierta = await ventanaAbierta({ clienteId, chatId, supa });
            // `sinEspera`: un seguimiento no es una respuesta en vivo. Nadie está
            // esperando del otro lado, y la pausa solo gastaría tiempo del cron.
            if (abierta) return enviarTexto(cfg, chatId, texto, { sinEspera: true });

            const pl = plantillaPara(extra.plantilla);
            if (!pl || !extra.params.length) {
              // Texto libre con la ventana cerrada: no se envía y no se quema el
              // intento. Si el cliente escribe en las próximas horas, sale solo.
              return {
                ok: false,
                omitido: true,
                error: "ventana de 24h cerrada y el mensaje no tiene plantilla",
              };
            }
            return enviarPlantilla(cfg, chatId, {
              nombre: pl.nombre,
              idioma: pl.idioma,
              params: extra.params,
            });
          }
          // BARRERA MULTI-CLIENTE (auditoría 11-ago-2026): WAHA tiene UNA sola
          // sesión. Sin pasar el clienteId acá, los recordatorios de cualquier otro
          // cliente en transporte='waha' salían por el WhatsApp del dueño de esa
          // sesión y quedaban guardados en SU conversación. Ver lib/waha.ts.
          return enviarTextoWaha(chatId, texto, { clienteId });
        },
      }),
    (x) => ({
      ok: true,
      trabajo: !x.fueraDeHorario,
      resumen: { enviados: x.enviados, pasos: x.detalle.length },
      errores: x.errores,
    }),
    procesos,
  );
  const r = rEnvio ?? { enviados: 0, detalle: ["error"], errores: [] };

  /**
   * INFORME SEMANAL — se engancha acá y no en un cron aparte.
   *
   * lib/insightsAuto.ts se escribió para colgarse de este endpoint ("un solo
   * disparador externo que mantener"), pero la llamada nunca se agregó: el
   * módulo existía y no lo invocaba nadie. Por eso el informe del lunes no
   * aparecía solo y había que apretar el botón a mano.
   *
   * Va DESPUÉS de los seguimientos y envuelto en su propio try: generar un
   * informe usa el modelo y puede demorar o fallar, y eso jamás debe impedir
   * que salgan los recordatorios de citas, que son los que un cliente espera a
   * una hora concreta. Los días que no son lunes retorna al instante.
   */
  const rInformes = await correrPaso(
    "informe_semanal",
    () => generarInformesPendientes({ fechaLimite: inicioCron + 45_000 }),
    (x) => ({
      ok: true,
      // Si todo quedó "en espera" (reintento de la hora), la corrida no aporta
      // información nueva: no debe borrar un fallo anterior.
      trabajo: x.generados + x.omitidos + x.fallidos > 0 || x.enEspera === 0,
      resumen: { generados: x.generados, omitidos: x.omitidos, fallidos: x.fallidos, en_espera: x.enEspera },
      errores: x.errores,
    }),
    procesos,
  );
  // Solo conteos en la respuesta: el detalle nombra negocios.
  const informes = rInformes
    ? { generados: rInformes.generados, omitidos: rInformes.omitidos, fallidos: rInformes.fallidos, enEspera: rInformes.enEspera }
    : { generados: 0, error: true };

  /**
   * CONVERSIONES DE PAUTA — devolverle a Meta lo que pasó después del clic.
   *
   * Barre los hechos recientes (un cobro pagado, una cita creada, una
   * cotización enviada), los encola y manda lo pendiente. Es idempotente: el
   * identificador del evento se deriva del hecho y la base rechaza duplicados,
   * así que correrlo cada cinco minutos no manda nada dos veces.
   *
   * Retorna al instante si ningún negocio tiene configurado el conjunto de
   * datos, que es el caso hoy. Va en su propio try y después de los envíos:
   * hablar con Meta puede demorar y no puede frenar un recordatorio de cita.
   */
  const conversiones = (await correrPaso(
    "conversiones_pauta",
    () => procesarEventos({ fechaLimite: inicioCron + 50_000 }),
    (x) => {
      const errores = x.detalle.filter((d) => d.startsWith("error")).map((d) => ({ error: d }));
      return { ok: true, resumen: { encolados: x.encolados, enviados: x.enviados }, errores };
    },
    procesos,
  )) ?? { encolados: 0, enviados: 0, detalle: ["error"] };

  /**
   * EL DESTILADO NOCTURNO DE ISABEL — su memoria de largo plazo.
   *
   * Convierte las conversaciones de ayer en hechos durables (cómo llama la
   * gente a los productos, qué objeción se repite, qué no supo contestar el
   * asistente) y los acumula en ed_isabel_saber. Sin esto, Isabel relee
   * mensajes crudos en cada pregunta y no SABE nada del negocio.
   *
   * Se engancha acá y no en un cron nuevo, por lo mismo que el informe semanal:
   * un solo disparador externo que mantener. Corre solo de madrugada; el resto
   * del día retorna al instante.
   *
   * Va en su propio try y después de todo lo que envía mensajes: llama al
   * modelo, puede demorar, y jamás debe impedir que salga un recordatorio de
   * cita que un cliente está esperando a una hora concreta.
   */
  const destilado = (await correrPaso(
    "destilado_isabel",
    () => destilarPendientes({ fechaLimite: inicioCron + 50_000 }),
    (x) => ({ ok: true, trabajo: !x.sinTrabajo, resumen: { destilados: x.destilados }, errores: x.errores }),
    procesos,
  )) ?? { destilados: 0 };

  /**
   * TOKENS DE INSTAGRAM — se renuevan acá por la misma razón que el informe.
   *
   * Duran 60 días y vencen en silencio: la API deja de aceptar los envíos y en
   * el portal no se ve nada raro. Sin esta llamada, el canal se apaga solo a los
   * dos meses de conectarlo y nos enteramos por un cliente. La función retorna
   * al instante cuando no hay nada por vencer, así que correrla cada 5 minutos
   * no cuesta nada.
   */
  const rIg = await correrPaso(
    "tokens_instagram",
    () => renovarTokensIg(),
    (x) => ({ ok: true, resumen: { renovados: x.renovados }, errores: x.errores }),
    procesos,
  );
  // Solo el conteo de fallas: las líneas nombran negocios.
  const instagram = { renovados: rIg?.renovados ?? 0, fallas: rIg ? rIg.fallas.length : 1 };

  /**
   * AVISOS DE CUPO — "ya usaste 960 de 1.200 conversaciones este mes".
   *
   * Se engancha acá por lo mismo que el informe semanal: un solo disparador
   * externo que mantener. Se auto-limita a una revisión por hora (ver
   * esHoraDeRevisar) y no hace absolutamente nada mientras ningún cliente tenga
   * plan asignado, así que correrlo cada 5 minutos sale gratis.
   *
   * NUNCA corta el servicio: solo avisa.
   */
  const cupos = (await correrPaso(
    "avisos_cupo",
    () => revisarCuposYAvisar(),
    (x) => ({
      ok: true,
      trabajo: x.detalle[0] !== "fuera_de_ventana",
      resumen: { revisados: x.revisados, avisados: x.avisados },
      errores: x.errores ?? [],
    }),
    procesos,
  )) ?? { revisados: 0, avisados: 0, detalle: [] };

  // Acotado porque cada entrante puede invocar IA; el siguiente latido toma
  // los restantes sin arriesgar el timeout del cron principal.
  const webhooks = (await correrPaso(
    "reintento_webhooks",
    () => reprocesarWebhooksPendientes(2, { fechaLimite: inicioCron + 30_000 }),
    (x) => ({
      ok: true,
      resumen: { reintentados: x.reintentados, fallidos: x.fallidos, purgados: x.purgados, borrados: x.borrados },
      // Un entrante que no se pudo reprocesar es un mensaje de cliente sin atender.
      errores: x.fallidos ? [{ error: `${x.fallidos} mensaje(s) entrante(s) no se pudieron reprocesar` }] : [],
    }),
    procesos,
  )) ?? { reintentados: 0, fallidos: 0, purgados: 0, borrados: 0 };

  /**
   * VIGILANTE DE CONVERSACIONES ABANDONADAS (25-ago-2026).
   *
   * Tapa un agujero que existía desde siempre: cuando alguien del equipo toma el
   * control de un chat, Tino se apaga ahí PARA SIEMPRE. Si esa persona contesta
   * dos mensajes y se olvida, la conversación queda muerta y nadie se entera.
   *
   * ⚠️ Es INERTE hasta que un cliente active `reingreso_activo`. Mientras nadie
   * lo encienda cuesta una consulta por latido y nada más — mismo criterio que
   * los cupos.
   */
  let reingresos = { revisados: 0, reingresados: 0, callados: 0 };
  await correrPaso("vigilante_abandonadas", async () => {
    /**
     * Techo de tiempo: la función muere a los 60 s (`maxDuration`) y después
     * de esto todavía corren el archivado, las cotizaciones y el latido. Cada
     * decisión del modelo tarda de 2 a 17 s medidos; sin techo, el vigilante
     * podía llevarse la función entera. Lo que no alcance queda para el
     * siguiente latido, que llega en 5 minutos.
     */
    const rr = await revisarAbandonadas(supa, { fechaLimite: inicioCron + 45_000 });
    reingresos = { revisados: rr.revisados, reingresados: rr.reingresados, callados: rr.callados };
    if (rr.detalle.length) console.log("[cron] vigilante:", rr.detalle.join(" | "));
    return reingresos;
  }, (x) => ({ ok: true, resumen: x }), procesos);

  /**
   * QUE LAS ETIQUETAS DIGAN LA VERDAD (2-sep-2026).
   *
   * Dos pasos, en este orden:
   *  1. reconciliarEstados — determinista, sin modelo: cierra las derivaciones
   *     que una persona ya atendió (desde el teléfono, no solo desde el
   *     portal) y limpia las etiquetas abiertas de conversaciones ganadas o
   *     perdidas. Lo que Gestión muestra sale de acá, vía el puente.
   *  2. detectarCierres — el modelo lee las conversaciones con pista de cierre
   *     y decide: pagado (→ ganado), aprobado sin pago (→ "Falta pago") o
   *     abierto. Con techo de tiempo, como el vigilante.
   */
  const rRec = await correrPaso(
    "reconciliar_estados",
    () => reconciliarEstados(supa, { fechaLimite: inicioCron + 40_000 }),
    (x) => ({
      ok: true,
      resumen: {
        escalaciones_cerradas: x.escalacionesCerradas,
        contactos_limpiados: x.contactosLimpiados,
        contactos_reabiertos: x.contactosReabiertos,
        agendados_corregidos: x.agendadosCorregidos,
      },
      errores: (x.errores ?? []).map((error) => ({ error })),
    }),
    procesos,
  );
  const reconciliado = {
    escalacionesCerradas: rRec?.escalacionesCerradas ?? 0,
    contactosLimpiados: rRec?.contactosLimpiados ?? 0,
    contactosReabiertos: rRec?.contactosReabiertos ?? 0,
    agendadosCorregidos: rRec?.agendadosCorregidos ?? 0,
  };

  /**
   * ETAPAS DEL EMBUDO (Fase 0): antes se escribían al abrir /embudo. Una vez
   * por hora; el resto de las corridas retorna al instante. Ver lib/embudoCron.ts.
   */
  const rEmbudo = await correrPaso(
    "etapas_embudo",
    () => recalcularEmbudos({ fechaLimite: inicioCron + 45_000, supa }),
    (x) => ({ ok: true, trabajo: !x.sinTrabajo, resumen: { negocios: x.negocios, cambios: x.cambios }, errores: x.errores }),
    procesos,
  );

  let cierres = { revisados: 0, consultados: 0, pagados: 0, aprobados: 0, cotizados: 0 };
  await correrPaso("detector_cierres", async () => {
    const cc = await detectarCierres(supa, { fechaLimite: inicioCron + 50_000 });
    cierres = {
      revisados: cc.revisados,
      consultados: cc.consultados,
      pagados: cc.pagados,
      aprobados: cc.aprobados,
      cotizados: cc.cotizados,
    };
    if (cc.pagados || cc.aprobados || cc.cotizados) console.log("[cron] cierres:", cc.detalle.join(" | "));
    return cierres;
  }, (x) => ({ ok: true, resumen: x }), procesos);

  /**
   * ARCHIVAR ADJUNTOS ANTES DE QUE META LOS BORRE (26-ago-2026).
   *
   * Meta elimina el archivo que llega por webhook a los **7 días**. El portal
   * guardaba solo un puntero, así que cada foto que mandaba un cliente dejaba de
   * verse en una semana, sola.
   *
   * Va acá y no en el webhook a propósito: bajar 10 MB dentro del webhook se
   * come su presupuesto de tiempo y Meta lo reintentaría. Con el cron cada 5
   * minutos y 6 días de margen, tendría que estar caído casi una semana para
   * perder algo.
   */
  let adjuntos = { revisados: 0, archivados: 0, grandes: 0, fallidos: 0 };
  await correrPaso("archivado_adjuntos", async () => {
    const a = await archivarPendientes(supa, undefined, { fechaLimite: inicioCron + 55_000 });
    adjuntos = {
      revisados: a.revisados,
      archivados: a.archivados,
      grandes: a.grandes,
      fallidos: a.fallidos,
    };
    return adjuntos;
  }, (x) => ({
    ok: true,
    resumen: x,
    // Uno suelto que falla es normal (Meta ya lo borró, archivo corrupto).
    // Que TODOS fallen es que el archivado está roto (bucket, credenciales).
    errores:
      x.fallidos > 0 && x.archivados === 0
        ? [{ error: `${x.fallidos} adjunto(s) sin archivar y ninguno archivado en la corrida` }]
        : [],
  }), procesos);

  /**
   * BETO PERSIGUE LAS COTIZACIONES SIN RESPUESTA (26-ago-2026).
   *
   * Los tres generadores que había dependían de una CITA o del rubro motos, así
   * que a una imprenta —que no agenda— Beto y Vera no le hacían nada.
   *
   * ⚠️ Cada envío es una plantilla de MARKETING (~$85). Nace apagado por cliente
   * y con tope diario: el tope es de GASTO, no de carga.
   */
  let cotizaciones = { clientes: 0, candidatos: 0, programados: 0, frenadosPorJuez: 0, propuestos: 0 };
  let erroresCotizacion: { clienteId: string; error: string }[] = [];
  await correrPaso("seguimiento_cotizaciones", async () => {
    /**
     * Techo de tiempo, igual que el vigilante: desde el 9-sep este generador
     * consulta a un juez con IA por candidato (ver lib/juezCotizacion.ts), así
     * que ya no tarda lo mismo siempre. 55 s deja los últimos segundos para el
     * latido, que es lo único que no se puede saltar: sin él, /api/salud no
     * puede distinguir un cron muerto de un cron sin trabajo.
     */
    const c = await generarSeguimientosCotizacion(supa, { fechaLimite: inicioCron + 55_000 });
    cotizaciones = {
      clientes: c.clientes,
      candidatos: c.candidatos,
      programados: c.programados,
      frenadosPorJuez: c.frenadosPorJuez,
      propuestos: c.propuestos,
    };
    erroresCotizacion = c.errores;
    if (c.detalle.length) console.log("[cron] cotizaciones:", c.detalle.join(" | "));
    return cotizaciones;
  }, (x) => ({ ok: true, trabajo: x.clientes > 0, resumen: x, errores: erroresCotizacion }), procesos);

  // Deja constancia de que el cron corrió, aunque no haya enviado nada. Esto es
  // lo que permite que /api/salud detecte que el cron DEJÓ de correr; sin el
  // latido, un cron muerto se ve igual que un cron sin trabajo pendiente.
  await registrarProcesos(procesos);
  await registrarLatido(LATIDO_CRON_SEGUIMIENTOS, {
    enviados: r.enviados,
    // Solo el CONTEO del detalle: esas líneas traen chat_id y no deben quedar
    // guardadas en una tabla de diagnóstico.
    pasos: Array.isArray(r.detalle) ? r.detalle.length : 0,
    pasos_con_error: procesos.filter((p) => !p.ok || (p.errores?.length ?? 0) > 0).map((p) => p.nombre),
  });

  // El detalle de cupos nombra clientes: va el conteo, no las líneas.
  return NextResponse.json({
    // `errores` de los envíos se omite: ya quedó en ed_latidos sin chat_id.
    enviados: r.enviados,
    detalle: r.detalle,
    generados,
    informes,
    instagram,
    webhooks,
    cupos: { revisados: cupos.revisados, avisados: cupos.avisados },
    // El detalle nombra conversaciones: va el conteo, no las líneas.
    reingresos,
    reconciliado,
    embudo: rEmbudo ? { negocios: rEmbudo.negocios, cambios: rEmbudo.cambios } : { error: true },
    cierres,
    adjuntos,
    // El detalle nombra clientes y chats: va el conteo, no las líneas.
    cotizaciones,
    // Solo el conteo: el detalle del destilado nombra clientes.
    destilado: destilado.destilados,
    conversiones: { encolados: conversiones.encolados, enviados: conversiones.enviados },
  });
}
