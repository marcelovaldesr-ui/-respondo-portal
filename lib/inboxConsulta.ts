import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * CONSULTAS DEL INBOX — la forma en que el chat lee mensajes.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO (21-ago-2026)
 * ------------------------------------------
 * El inbox pedía **los 200 mensajes completos cada 4 segundos** y reemplazaba
 * el arreglo entero en React. Tres consecuencias, todas malas:
 *
 *  1. Red: el mismo contenido viajaba una y otra vez, por cada pestaña abierta.
 *  2. Render: cambiar el arreglo completo hacía que React volviera a dibujar
 *     toda la conversación — y como las burbujas usaban el índice como clave,
 *     además las re-montaba. Las imágenes parpadeaban en cada ciclo.
 *  3. Percepción: 4 segundos de espera promedio. WhatsApp entrega en menos de
 *     uno, y esa diferencia es exactamente la que hace que una herramienta se
 *     sienta lenta aunque "funcione".
 *
 * Acá vive la consulta **incremental**: dame lo que pasó DESPUÉS de este
 * momento. Devuelve casi siempre una lista vacía, que es justamente el punto.
 *
 * También vive la de historial hacia atrás, para no cargar la vida entera de un
 * chat en la primera pantalla.
 */

/** Columnas con adjunto (migración 270). */
const COLS = "id, rol, texto, creado_en, estado_envio, media_tipo, media_mime, media_nombre";
/** Respaldo si la 270 no está aplicada en algún entorno. */
const COLS_MINIMO = "id, rol, texto, creado_en";

/**
 * Estados de entrega (migración 213), de menor a mayor.
 *
 * Se declara acá porque es el servidor el que los produce, y la interfaz importa
 * ESTE tipo en vez de tener su propia copia. Dos listas separadas de los mismos
 * valores es cómo se cuela un estado que una mitad entiende y la otra no.
 */
export type EstadoEnvio =
  | "pendiente"
  | "server_ack"
  | "entregado"
  | "leido"
  | "error"
  | null;

export type MensajeInbox = {
  id: string;
  rol: string;
  texto: string;
  creadoEn: string;
  estado: EstadoEnvio;
  media: { tipo: string; mime: string | null; nombre: string | null; url: string } | null;
};

/**
 * Normaliza una fila cruda a lo que consume el inbox.
 *
 * La URL del adjunto NO es la del proveedor: es la de nuestro proxy autenticado,
 * que resuelve por WAHA o por Meta según corresponda y nunca expone credenciales
 * al navegador.
 */
function aMensaje(fila: Record<string, unknown>): MensajeInbox {
  const tipo = (fila.media_tipo as string | null) ?? null;
  return {
    id: String(fila.id),
    rol: fila.rol as string,
    texto: (fila.texto as string) ?? "",
    creadoEn: fila.creado_en as string,
    estado: ((fila.estado_envio as string | null) ?? null) as EstadoEnvio,
    media: tipo
      ? {
          tipo,
          mime: (fila.media_mime as string | null) ?? null,
          nombre: (fila.media_nombre as string | null) ?? null,
          url: `/api/whatsapp/media?id=${encodeURIComponent(String(fila.id))}`,
        }
      : null,
  };
}

/**
 * Corre la consulta pidiendo las columnas de adjunto y, si esas columnas no
 * existen todavía, la repite sin ellas.
 *
 * Es el mismo patrón que usa `leerCliente` en lib/whatsapp.ts y responde a la
 * convención del repo de desplegar ANTES de migrar: el código nuevo no puede
 * asumir que la migración ya corrió, porque si asume de más el inbox se queda
 * en blanco.
 */
async function conRespaldoDeColumnas(
  ejecutar: (cols: string) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Record<string, unknown>[]> {
  const rica = await ejecutar(COLS);
  if (!rica.error) return (rica.data ?? []) as Record<string, unknown>[];
  // Las columnas de adjunto (migración 270) todavía no existen en este entorno.
  const simple = await ejecutar(COLS_MINIMO);
  return (simple.data ?? []) as Record<string, unknown>[];
}

/**
 * Mensajes NUEVOS desde un instante dado, en orden cronológico.
 *
 * EL FILTRO ES INCLUSIVO (`>=`) A PROPÓSITO, y conviene entender por qué.
 *
 * Lo natural sería pedir "estrictamente posterior al último que tengo". El
 * problema es que dos mensajes pueden compartir el mismo `creado_en` al
 * milisegundo —pasa cuando el cliente manda una ráfaga— y con `>` el segundo se
 * perdería **para siempre**, sin error y sin forma de notarlo.
 *
 * Perder un mensaje de un cliente es inaceptable; repetir uno no cuesta nada
 * porque quien llama deduplica por id. Por eso se acota por fecha y se garantiza
 * por id: es la combinación que no pierde nada.
 *
 * `excluir` evita el efecto secundario de eso: sin él, cada ciclo devolvería el
 * último mensaje conocido una y otra vez y el "delta" nunca estaría vacío.
 */
export async function mensajesNuevos(
  supa: SupabaseClient,
  params: {
    empleadoId: string;
    chatId: string;
    desde: string;
    limite?: number;
    /** Ids que quien pregunta ya tiene: se filtran de la respuesta. */
    excluir?: Set<string>;
  },
): Promise<MensajeInbox[]> {
  const filas = await conRespaldoDeColumnas((cols) =>
    supa
      .from("ed_mensajes")
      .select(cols)
      .eq("empleado_id", params.empleadoId)
      .eq("chat_id", params.chatId)
      .gte("creado_en", params.desde)
      .order("creado_en", { ascending: true })
      .limit(params.limite ?? 100),
  );
  const out = filas.map(aMensaje);
  return params.excluir?.size ? out.filter((m) => !params.excluir!.has(m.id)) : out;
}

/**
 * El tramo más reciente de la conversación, en orden cronológico.
 *
 * Se leen los más nuevos primero (que es lo que el índice
 * `idx_ed_mensajes_emp_chat_fecha` sabe hacer barato) y se invierten acá.
 */
export async function ultimosMensajes(
  supa: SupabaseClient,
  params: { empleadoId: string; chatId: string; limite?: number },
): Promise<MensajeInbox[]> {
  const filas = await conRespaldoDeColumnas((cols) =>
    supa
      .from("ed_mensajes")
      .select(cols)
      .eq("empleado_id", params.empleadoId)
      .eq("chat_id", params.chatId)
      .order("creado_en", { ascending: false })
      .limit(params.limite ?? 60),
  );
  return filas.reverse().map(aMensaje);
}

/**
 * Mensajes ANTERIORES a un instante dado (para "cargar más" hacia arriba).
 *
 * Devuelve `hayMas` para que la interfaz sepa si sigue ofreciendo el botón, en
 * vez de dejar a la persona apretando en el vacío. Se pide uno más del límite y
 * ese sobrante es la respuesta.
 */
export async function mensajesAnteriores(
  supa: SupabaseClient,
  params: { empleadoId: string; chatId: string; antesDe: string; limite?: number },
): Promise<{ mensajes: MensajeInbox[]; hayMas: boolean }> {
  const limite = params.limite ?? 50;
  const filas = await conRespaldoDeColumnas((cols) =>
    supa
      .from("ed_mensajes")
      .select(cols)
      .eq("empleado_id", params.empleadoId)
      .eq("chat_id", params.chatId)
      .lt("creado_en", params.antesDe)
      .order("creado_en", { ascending: false })
      .limit(limite + 1),
  );
  const hayMas = filas.length > limite;
  return {
    mensajes: filas.slice(0, limite).reverse().map(aMensaje),
    hayMas,
  };
}

/**
 * Estados de entrega que cambiaron entre los mensajes que el navegador ya tiene.
 *
 * POR QUÉ VA APARTE de `mensajesNuevos`: un mensaje que ya se envió no vuelve a
 * aparecer en la consulta incremental —su fecha es vieja— pero su estado sí
 * cambia después: se entrega, y más tarde lo leen. Sin esto los ✓✓ se quedarían
 * congelados hasta recargar la página.
 *
 * Solo se preguntan los que todavía pueden cambiar, no la conversación entera.
 */
export async function estadosDe(
  supa: SupabaseClient,
  params: { empleadoId: string; ids: string[] },
): Promise<Record<string, string>> {
  if (params.ids.length === 0) return {};
  const { data, error } = await supa
    .from("ed_mensajes")
    .select("id, estado_envio")
    .eq("empleado_id", params.empleadoId)
    .in("id", params.ids.slice(0, 60));
  if (error) return {}; // columna inexistente: sin estados, pero el chat funciona
  const out: Record<string, string> = {};
  for (const f of data ?? []) {
    const e = (f as { estado_envio?: string | null }).estado_envio;
    if (e) out[String((f as { id: string }).id)] = e;
  }
  return out;
}
