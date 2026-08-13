import { db } from "@/lib/db";
import { configPorCliente, enviarTexto } from "@/lib/whatsapp";
import { enviarTextoWaha } from "@/lib/waha";
import {
  cicloActual,
  estadoDeCupo,
  mensajeDeAviso,
  reservarAviso,
} from "@/lib/cupoConversaciones";

/**
 * AVISOS DE CUPO — "ya usaste 960 de 1.200 conversaciones".
 *
 * Se cuelga del cron de seguimientos (el único del sistema) igual que el
 * informe semanal y la renovación de tokens de Instagram. No se crea un cron
 * nuevo: un disparador externo más es una cosa más que se puede morir sin que
 * nos enteremos.
 *
 * LO QUE ESTO NO HACE, A PROPÓSITO: no corta el servicio, no pausa al
 * asistente, no bloquea nada. Pasarse del cupo genera un aviso y un cobro de
 * excedente. Cliengo corta la recepción de mensajes al llegar al límite; una
 * pyme sin atención a mitad de mes pierde ventas y nos culpa a nosotros.
 *
 * INERTE MIENTRAS NADIE TENGA PLAN. Los clientes sin `plan` asignado se saltan
 * enteros. Es la red de seguridad: si el contador tuviera un error, no le llega
 * un mensaje equivocado a ningún cliente real.
 */

export type ResultadoAvisos = {
  revisados: number;
  avisados: number;
  detalle: string[];
};

/**
 * Solo se revisa una vez por hora, no en cada latido.
 *
 * El cron corre cada 5 minutos. Contar conversaciones recorre los mensajes del
 * mes del cliente, así que hacerlo 288 veces al día por cliente sería gastar
 * base de datos para nada: nadie necesita enterarse de que cruzó el 80% con
 * cinco minutos de precisión. Con la ventana de los primeros 5 minutos de cada
 * hora alcanza y sobra.
 */
function esHoraDeRevisar(ahora: Date): boolean {
  return ahora.getUTCMinutes() < 5;
}

export async function revisarCuposYAvisar(ahora: Date = new Date()): Promise<ResultadoAvisos> {
  const vacio: ResultadoAvisos = { revisados: 0, avisados: 0, detalle: [] };
  if (!esHoraDeRevisar(ahora)) return { ...vacio, detalle: ["fuera_de_ventana"] };

  const supa = db();
  const ciclo = cicloActual(ahora);

  // Solo clientes activos CON plan. Si la migración 278 no está aplicada, esta
  // consulta falla por columna inexistente y salimos sin hacer nada.
  const { data: clientes, error } = await supa
    .from("ed_clientes")
    .select("id, nombre, plan, transporte, telefono_escalacion, canal_escalacion")
    .eq("activo", true)
    .not("plan", "is", null);
  if (error || !clientes?.length) return { ...vacio, detalle: [error ? "migracion_pendiente" : "sin_clientes_con_plan"] };

  // Quién ya recibió el aviso de 100% en este ciclo no necesita revisarse otra
  // vez: es el último umbral que existe. Ahorra la consulta pesada justo en los
  // clientes que más conversaciones tienen.
  const { data: yaAl100 } = await supa
    .from("ed_avisos_cupo")
    .select("cliente_id")
    .eq("ciclo", ciclo.id)
    .eq("umbral", 100);
  const cerrados = new Set((yaAl100 ?? []).map((a) => a.cliente_id as string));

  const resultado: ResultadoAvisos = { revisados: 0, avisados: 0, detalle: [] };

  for (const cli of clientes) {
    const clienteId = cli.id as string;
    if (cerrados.has(clienteId)) continue;

    try {
      resultado.revisados++;
      const estado = await estadoDeCupo(clienteId, supa, ahora);
      if (!estado) continue;

      // reservarAviso() inserta ANTES de mandar. El índice único de
      // ed_avisos_cupo es lo único que impide que un cliente al 81% reciba un
      // mensaje cada vez que corre esto.
      const umbral = await reservarAviso(estado, supa);
      if (umbral === null) continue;

      const texto = mensajeDeAviso(estado, umbral);
      const destino = (cli.telefono_escalacion as string | null)?.trim();
      const canal = ((cli.canal_escalacion as string | null) ?? "whatsapp").toLowerCase();

      if (!destino || canal !== "whatsapp") {
        // El aviso queda registrado igual y el dueño lo ve en el panel. No es
        // motivo para reintentar: el estado ya está a la vista.
        resultado.detalle.push(`${cli.nombre}: ${umbral}% registrado, sin destino de aviso`);
        continue;
      }

      const transporte = ((cli.transporte as string | null) ?? "waha").toLowerCase();
      const envio =
        transporte === "cloud"
          ? await (async () => {
              const cfg = await configPorCliente(clienteId);
              return cfg
                ? enviarTexto(cfg, destino, texto)
                : { ok: false as const, error: "cliente cloud sin credenciales" };
            })()
          : // Misma barrera multi-cliente que los seguimientos: WAHA tiene UNA
            // sesión y sin clienteId el aviso saldría por el WhatsApp de otro.
            await enviarTextoWaha(destino, texto, { clienteId });

      if (envio.ok) {
        resultado.avisados++;
        resultado.detalle.push(`${cli.nombre}: avisado ${umbral}%`);
      } else {
        resultado.detalle.push(`${cli.nombre}: ${umbral}% registrado, envío falló (${envio.error})`);
      }
    } catch (e) {
      resultado.detalle.push(`${cli.nombre}: error ${(e as Error).message}`);
    }
  }

  return resultado;
}
