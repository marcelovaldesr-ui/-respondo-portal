import { db } from "@/lib/db";
import { idsEmpleadosDeCliente } from "@/lib/empleadosCache";
import { configPorCliente, enviarTexto } from "@/lib/whatsapp";
import { enviarTextoWaha } from "@/lib/waha";
import {
  resumirFidelizacion,
  textoInformeFidelizacion,
  type CitaMinima,
  type Fidelizacion,
  type SeguimientoMinimo,
} from "@/lib/fidelizacionCore";

/**
 * FIDELIZACIÓN — la mitad del panel que le habla al dueño, no al operador.
 *
 * POR QUÉ SE CONSTRUYÓ (26-ago-2026)
 * En RS-Shop la decisión subió de Gaspar a gerencia y no teníamos UN SOLO
 * número del negocio de ellos que mostrar. `lib/analitica.ts` mide mensajes,
 * cobertura y ahorro de tiempo: todo cierto, todo sobre la conversación, y
 * ninguno responde la pregunta que hace un dueño de taller, que es si la gente
 * vuelve. Tecnom vende exactamente eso ("KPIs de fidelización: repeat rate,
 * ticket promedio, upsell") y nosotros teníamos el dato guardado sin mostrarlo.
 *
 * NO REQUIERE MIGRACIÓN NI CAMPO NUEVO. Todo sale de columnas que existen
 * desde la migración 220: `ed_citas.origen`, `ed_citas.empleado_id`, los
 * estados `completada`/`no_show`, y `ed_seguimientos.respuesta_recibida`.
 *
 * LO QUE ESTO NO MIDE, A PROPÓSITO: ticket promedio y upsell. No tenemos el
 * monto de ninguna orden de trabajo y no lo vamos a estimar. Un número
 * inventado en el panel que la gerencia usa para decidir es la forma más
 * rápida de perder la cuenta que estamos tratando de ganar.
 */

/** Ventana fija del retorno. Ver el comentario en fidelizacionCore. */
const DIAS_ANIO = 365;

/** PostgREST corta en 1.000 filas y `.limit()` no lo sube. Ver analitica.ts. */
const PAGINA = 1000;

async function paginar<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const filas: T[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await consulta(inicio, inicio + PAGINA - 1);
    const lote = (data as T[] | null) ?? [];
    if (error || !lote.length) break;
    filas.push(...lote);
    if (lote.length < PAGINA) break;
    if (inicio > 100_000) break; // tope de seguridad
  }
  return filas;
}

type FilaCita = {
  chat_id: string | null;
  telefono: string | null;
  estado: string;
  origen: string;
  empleado_id: string | null;
  creado_en: string;
  inicio: string;
};

/**
 * Calcula la fidelización del cliente.
 *
 * Devuelve null cuando el negocio no usa la agenda ni los seguimientos: no hay
 * nada que medir y el panel no debe mostrar una fila de ceros, que se lee como
 * "esto no funciona" en vez de "esto no lo tienes contratado".
 *
 * `hastaParam` (1-sep-2026): por defecto es ahora, igual que siempre. Se abrió
 * para poder pedir el MISMO cálculo con un corte en el pasado —el informe
 * mensual lo usa para comparar el período contra el anterior sin duplicar
 * ninguna de las reglas de acá— y ningún llamado existente cambia, porque el
 * valor por defecto es exactamente el de antes.
 */
export async function calcularFidelizacion(
  clienteId: string,
  dias = 30,
  hastaParam?: Date,
): Promise<Fidelizacion | null> {
  const supa = db();
  const hasta = hastaParam ?? new Date();
  const desdePeriodo = new Date(hasta.getTime() - dias * 86400_000).toISOString();
  const desdeAnio = new Date(hasta.getTime() - DIAS_ANIO * 86400_000).toISOString();
  const hastaIso = hasta.toISOString();

  const columnas = "chat_id, telefono, estado, origen, empleado_id, creado_en, inicio";

  /**
   * Un año de citas. Se filtra por `inicio` y no por `creado_en` porque una
   * lista importada trae la fecha REAL de la visita en `inicio` mientras que
   * `creado_en` es el día que se corrió el importador. Filtrar por creación
   * haría que todo el historial importado apareciera como si hubiera pasado
   * hoy, y el retorno saldría inflado.
   */
  const anio = await paginar<FilaCita>((a, b) =>
    supa
      .from("ed_citas")
      .select(columnas)
      .eq("cliente_id", clienteId)
      .gte("inicio", desdeAnio)
      .lte("inicio", hastaIso)
      .order("inicio", { ascending: true })
      .range(a, b),
  );

  const seguimientos = await leerSeguimientos(clienteId, desdePeriodo, hastaIso);

  if (!anio.length && !seguimientos.length) return null;

  const aCita = (f: FilaCita): CitaMinima => ({
    chatId: f.chat_id,
    telefono: f.telefono,
    estado: f.estado,
    origen: f.origen,
    empleadoId: f.empleado_id,
    creadoEn: f.creado_en,
  });

  /**
   * Las del período se sacan de las que ya se trajeron, filtrando por fecha de
   * CREACIÓN: la pregunta es "cuántas horas se agendaron esta semana", no
   * "cuántas horas caen esta semana". Se filtra en memoria para no hacer una
   * segunda consulta con los mismos datos.
   */
  const citasPeriodo = anio
    .filter((f) => f.creado_en >= desdePeriodo && f.creado_en <= hastaIso)
    .map(aCita);

  return resumirFidelizacion({
    citasPeriodo,
    citasAnio: anio.map(aCita),
    seguimientos,
  });
}

/**
 * Seguimientos enviados en el período.
 *
 * `ed_seguimientos` no tiene `cliente_id`: cuelga del empleado. Por eso hay que
 * resolver primero los empleados del cliente — el mismo camino que usa el
 * motor de envío.
 */
async function leerSeguimientos(
  clienteId: string,
  desde: string,
  hasta?: string,
): Promise<SeguimientoMinimo[]> {
  const supa = db();
  const ids = await idsEmpleadosDeCliente(clienteId);
  if (!ids.length) return [];

  const filas = await paginar<{
    chat_id: string;
    tipo: string;
    enviado_en: string | null;
    respuesta_recibida: boolean | null;
  }>((a, b) => {
    let q = supa
      .from("ed_seguimientos")
      .select("chat_id, tipo, enviado_en, respuesta_recibida")
      .in("empleado_id", ids)
      .not("enviado_en", "is", null);
    if (hasta) q = q.lte("enviado_en", hasta);
    return q
      .gte("enviado_en", desde)
      .order("enviado_en", { ascending: true })
      .range(a, b);
  });

  return filas.map((f) => ({
    chatId: f.chat_id,
    tipo: f.tipo,
    enviadoEn: f.enviado_en,
    respuestaRecibida: f.respuesta_recibida === true,
  }));
}

/**
 * EL INFORME REENVIABLE — punto 2 del "orden acordado" de la auditoría de
 * agosto (circuitos-abiertos-cita-y-resultados). Compone el texto (comparando
 * contra los 30 días anteriores) y lo manda por WhatsApp al teléfono del
 * dueño, con el MISMO mecanismo que ya usan los avisos de cupo — nada nuevo
 * que aprender a mantener.
 *
 * ⚠️ "Últimos 30 días", no "el mes de agosto": es una ventana móvil, no un mes
 * calendario, y decir otra cosa sería prometer un corte que este número no
 * tiene. Es la misma regla de honestidad que rige el resto del archivo.
 */
export async function enviarInformeFidelizacion(
  clienteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supa = db();
  const { data: cli } = await supa
    .from("ed_clientes")
    .select("nombre, transporte, telefono_escalacion, canal_escalacion")
    .eq("id", clienteId)
    .maybeSingle();
  if (!cli) return { ok: false, error: "Cliente no encontrado." };

  const destino = (cli.telefono_escalacion as string | null)?.trim();
  const canal = ((cli.canal_escalacion as string | null) ?? "whatsapp").toLowerCase();
  if (!destino || canal !== "whatsapp") {
    return {
      ok: false,
      error:
        "No hay un WhatsApp configurado para avisos del negocio. Se define en Información.",
    };
  }

  const ahora = new Date();
  const haceUnMes = new Date(ahora.getTime() - 30 * 86_400_000);
  const [actual, anterior] = await Promise.all([
    calcularFidelizacion(clienteId, 30, ahora),
    calcularFidelizacion(clienteId, 30, haceUnMes),
  ]);
  if (!actual) {
    return {
      ok: false,
      error: "Todavía no hay suficientes citas o seguimientos para armar un informe.",
    };
  }

  const texto = textoInformeFidelizacion({
    nombreNegocio: (cli.nombre as string) || "tu negocio",
    etiquetaPeriodo: "últimos 30 días",
    actual,
    anterior,
  });

  const transporte = ((cli.transporte as string | null) ?? "waha").toLowerCase();
  const envio =
    transporte === "cloud"
      ? await (async () => {
          const cfg = await configPorCliente(clienteId);
          // `sinEspera`: es un mensaje operativo al propio negocio, no una
          // conversación con un cliente — no debe respetar el debounce humano.
          return cfg
            ? enviarTexto(cfg, destino, texto, { sinEspera: true })
            : { ok: false as const, error: "cliente cloud sin credenciales" };
        })()
      : await enviarTextoWaha(destino, texto, { clienteId });

  if (!envio.ok) return { ok: false, error: envio.error ?? "No se pudo enviar." };
  return { ok: true };
}
