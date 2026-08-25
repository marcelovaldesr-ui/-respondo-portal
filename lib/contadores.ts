import { db } from "@/lib/db";
import { DIAS_SILENCIO } from "@/lib/embudo";
import { idsEmpleadosDeCliente } from "@/lib/empleadosCache";

/**
 * Filtro de "oportunidad viva", en el lenguaje de PostgREST.
 *
 * Es la MISMA regla que aplica cargarEmbudo al escribir (ver enSilencio): una
 * oportunidad está viva si el cliente fue el último en hablar, o si el negocio
 * habló hace menos de una semana.
 *
 * Existe en dos formas —esta de lectura y la de escritura del embudo— por un
 * motivo concreto: el embudo solo escribe cuando alguien abre esa pantalla, y
 * el menú se dibuja en cada navegación. Si el contador esperara a la escritura,
 * mostraría oportunidades muertas hasta que alguien pasara por el tablero.
 * Aplicando el filtro también al leer, los dos números coinciden siempre,
 * incluso antes de que el embudo se haya abierto una sola vez.
 */
function soloVivas<T>(q: { or: (filtro: string) => T }): T {
  const corte = new Date(Date.now() - DIAS_SILENCIO * 86400_000).toISOString();
  return q.or(`ultimo_mensaje_rol.eq.cliente,ultimo_mensaje_en.gte.${corte}`);
}

/**
 * CONTADORES DEL MENÚ — los dos números que van al lado de Conversaciones y de
 * Embudo en la barra lateral.
 *
 * POR QUÉ VIVEN EN SU PROPIO ARCHIVO
 * Los pide el layout, o sea que se calculan en CADA navegación del portal. Eso
 * obliga a que sean baratos de verdad, y a que nadie los "reutilice" llamando
 * de paso a una función pesada. Teniéndolos aparte, la restricción queda
 * explícita: acá adentro solo entran consultas que la base resuelve sin
 * devolver filas.
 *
 * CÓMO SE CUENTAN
 * Con `count: "exact", head: true`. Postgres cuenta por índice y PostgREST
 * devuelve el número en una cabecera, cero filas de datos. Da lo mismo que el
 * cliente tenga 40 conversaciones o 4.000: se transfiere lo mismo.
 *
 * SI FALLA, DEVUELVE CERO
 * Un contador es un adorno útil, no información crítica. Si la consulta falla
 * —columna que todavía no existe, permiso, lo que sea— el menú se dibuja sin
 * número. Nunca puede tumbar el layout, porque el layout envuelve TODAS las
 * pantallas: un error acá dejaría al cliente sin portal por un badge.
 */

export type ContadoresMenu = {
  /** Conversaciones derivadas a una persona y todavía sin atender. */
  esperando: number;
  /** Oportunidades abiertas en el embudo (interesado + cotizado). */
  porCerrar: number;
  /** El desglose, para que la portada no tenga que volver a contar. */
  interesados: number;
  cotizados: number;
};

const VACIO: ContadoresMenu = {
  esperando: 0,
  porCerrar: 0,
  interesados: 0,
  cotizados: 0,
};

/**
 * Ventana de actividad para considerar viva una oportunidad. Es el valor por
 * defecto de cargarEmbudo y se repite acá a propósito, con nombre: los tres
 * lugares que muestran este número tienen que usar el mismo corte.
 */
export const DIAS_ACTIVIDAD = 14;

/**
 * Las oportunidades abiertas, con nombre y lo último que dijeron.
 *
 * POR QUÉ NO ALCANZA CON EL CONTADOR
 * La portada mostraba "1 interesado · 8 cotizados" en dos cifras enormes. Es
 * información, pero no permite hacer nada: para saber A QUIÉN hay que insistir
 * había que ir al embudo y leerlo entero. Un panel que obliga a ir a otra
 * pantalla para actuar no ahorró nada.
 *
 * Con nombre, qué pidieron y hace cuánto, el dueño decide desde la portada.
 *
 * Barato: lee ed_contactos, que ya tiene el último mensaje mantenido por el
 * trigger de la 250. No toca ed_mensajes.
 */
export type Oportunidad = {
  chatId: string;
  contacto: string;
  etapa: string;
  ultimoMensaje: string;
  ultimoEn: string | null;
};

export async function oportunidadesAbiertas(
  clienteId: string,
  limite = 4,
  /**
   * Solo lo que tuvo actividad en los últimos N días. Es el MISMO corte que
   * usa el embudo (ver el comentario de cargarEmbudo) y por el mismo motivo:
   * sin él salen conversaciones que ya terminaron —"ya muchas gracias",
   * "recibido"— que quedaron marcadas como cotizadas y nunca se cerraron.
   *
   * Se comprobó con datos reales: de las 4 primeras oportunidades, dos eran
   * despedidas. Una portada que te manda a insistirle a alguien que ya te
   * agradeció y se fue es peor que no mostrar nada: te hace perder tiempo y te
   * enseña a desconfiar del panel.
   */
  diasActividad = DIAS_ACTIVIDAD,
): Promise<Oportunidad[]> {
  try {
    const corte = new Date(
      Date.now() - diasActividad * 86400_000,
    ).toISOString();
    const { data } = await soloVivas(
      db()
        .from("ed_contactos")
        .select(
          "chat_id, nombre, etapa, ultimo_mensaje_texto, ultimo_mensaje_en",
        )
        .eq("cliente_id", clienteId)
        .in("etapa", ["interesado", "cotizado"])
        .gte("ultimo_mensaje_en", corte),
    )
      // Ascendente pone "cotizado" antes que "interesado" (c < i): primero lo
      // que está más cerca de cerrarse.
      .order("etapa", { ascending: true })
      .order("ultimo_mensaje_en", { ascending: false, nullsFirst: false })
      /**
       * Límite EXPLÍCITO. Sin él, PostgREST igual corta en 1.000 pero sin que
       * nadie lo sepa. Acá son las oportunidades que se muestran en pantalla:
       * nadie revisa doscientas de una sentada, y el número real vive en el
       * contador de arriba, que sí cuenta en la base.
       */
      .limit(200)
      .limit(limite);

    // La forma de la fila se declara acá para no perder el tipo hacia afuera.
    type Fila = {
      chat_id: string;
      nombre: string | null;
      etapa: string | null;
      ultimo_mensaje_texto: string | null;
      ultimo_mensaje_en: string | null;
    };

    return ((data ?? []) as Fila[]).map((c) => ({
      chatId: c.chat_id,
      contacto: c.nombre || `+${c.chat_id}`,
      etapa: c.etapa ?? "interesado",
      ultimoMensaje: c.ultimo_mensaje_texto ?? "",
      ultimoEn: c.ultimo_mensaje_en,
    }));
  } catch {
    return [];
  }
}

/**
 * SE CUENTAN FILAS EN JS, NO CON `count: exact`.
 *
 * Parece al revés —contar en la base suena siempre mejor— pero medido contra la
 * base real el 31-jul:
 *
 *   count exact de etapa=interesado (con el filtro `or`)    326 ms
 *   count exact de etapa=cotizado   (con el filtro `or`)    529 ms
 *   traer TODAS las filas de etapa abierta                  188 ms
 *
 * El motivo es que `count exact` obliga a Postgres a recorrer el conjunto
 * filtrado, y el `or` del filtro de silencio le impide resolverlo por índice.
 * Traer las filas, en cambio, aprovecha el índice y devuelve poquísimas: son
 * las oportunidades abiertas de una pyme, no un dataset.
 *
 * `head: true` sigue siendo la opción correcta cuando el conjunto es GRANDE
 * (como en resumenAhorro, que cuenta decenas de miles de mensajes). Acá no lo
 * es, y la regla general se equivocaba.
 */
export async function contadoresMenu(
  clienteId: string,
): Promise<ContadoresMenu> {
  try {
    const supa = db();

    // Compartida con el resto de la petición: no vuelve a consultarse.
    const ids = await idsEmpleadosDeCliente(clienteId);
    if (!ids.length) return VACIO;

    /**
     * MISMO CORTE DE ACTIVIDAD QUE EL EMBUDO Y QUE oportunidadesAbiertas.
     *
     * Sin esto el badge diría 9 y la pantalla de embudo mostraría 4, porque
     * ella sí descarta lo inactivo. Los tres lugares donde aparece este número
     * —badge del menú, encabezado de la portada y tablero— tienen que contar lo
     * mismo o el cliente deja de creerle a los tres.
     */
    const corte = new Date(
      Date.now() - DIAS_ACTIVIDAD * 86400_000,
    ).toISOString();

    /**
     * ⚠️ SE CUENTA EN POSTGRES, NO LEYENDO FILAS (auditoría 24-ago-2026).
     *
     * Antes esto traía las filas y las contaba en JavaScript. El problema es que
     * **PostgREST corta toda respuesta en 1.000 filas** por configuración del
     * servidor, y `.limit(n)` mayor NO la sube. O sea que un cliente con más de
     * mil oportunidades abiertas vería un número tope de 1.000 en el menú, sin
     * ningún error: un dato creíble y falso.
     *
     * Es EXACTAMENTE el bug que ya se pagó en la analítica el 31-jul, donde se
     * reportaba 0% de cobertura de IA con el bot funcionando a todo dar. Un
     * panel que el cliente usa para decidir si sigue pagando no se puede
     * equivocar en silencio.
     *
     * `count: "exact", head: true` cuenta en la base y no transfiere ni una
     * fila: es más correcto Y más barato que lo anterior.
     */
    const porEtapa = (etapa: string) =>
      soloVivas(
        supa
          .from("ed_contactos")
          .select("chat_id", { count: "exact", head: true })
          .eq("cliente_id", clienteId)
          .eq("etapa", etapa)
          .gte("ultimo_mensaje_en", corte),
      );

    const [escalaciones, nInteresados, nCotizados] = await Promise.all([
      supa
        .from("ed_escalaciones")
        .select("chat_id", { count: "exact", head: true })
        .in("empleado_id", ids)
        .is("atendida_en", null),
      porEtapa("interesado"),
      porEtapa("cotizado"),
    ]);

    const interesados = nInteresados.count ?? 0;
    const cotizados = nCotizados.count ?? 0;

    return {
      esperando: escalaciones.count ?? 0,
      porCerrar: interesados + cotizados,
      interesados,
      cotizados,
    };
  } catch {
    return VACIO;
  }
}
