import { type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { db } from "@/lib/db";
import { limitarDistribuido } from "@/lib/seguridad";
import { estadosDe, mensajesNuevos } from "@/lib/inboxConsulta";
import { idsEmpleadosDeCliente } from "@/lib/empleadosCache";

export const dynamic = "force-dynamic";
/**
 * Duración del stream. Vercel corta la función igual, así que en vez de que la
 * conexión muera de forma sucia y el navegador reintente contra un socket roto,
 * se cierra ordenadamente antes y `EventSource` reconecta solo.
 */
export const maxDuration = 60;

/** Cuánto espera el servidor entre consultas. Es lo que fija la latencia real. */
const LATIDO_MS = 900;
/** Cuándo cerrar para dejar que el navegador reconecte con margen. */
const VIDA_MS = 50_000;

/**
 * EMPUJE EN VIVO DEL INBOX (Server-Sent Events).
 *
 * QUÉ PROBLEMA RESUELVE
 * ---------------------
 * El inbox preguntaba «¿hay algo nuevo?» cada 4 segundos. Un mensaje del cliente
 * tardaba en promedio 2 segundos en aparecer, y hasta 4 en el peor caso. WhatsApp
 * y las apps nativas entregan en menos de uno; esa diferencia es exactamente la
 * que hace que una herramienta se sienta lenta aunque funcione.
 *
 * Acá el servidor mantiene la conexión abierta y **empuja** apenas hay algo. La
 * consulta que corre cada 900 ms es la incremental sobre el índice
 * `idx_ed_mensajes_emp_chat_fecha`: en el 99% de los ciclos devuelve cero filas.
 *
 * POR QUÉ SSE Y NO SUPABASE REALTIME
 * ----------------------------------
 * Realtime habría sido menos código, pero conecta el NAVEGADOR directo a la base
 * y en este portal **el aislamiento entre clientes está hecho por código, no por
 * RLS**: cada consulta filtra por `cliente_id`. Abrir un canal directo se saltaría
 * esa barrera y dejaría el aislamiento dependiendo de políticas que hoy no
 * existen. Sería repetir el hallazgo de WAHA —donde un cliente podía escribir por
 * el WhatsApp de otro— pero para lectura.
 *
 * Con SSE la barrera sigue siendo la misma de siempre: sesión de portal, empleado
 * del cliente logueado, un solo punto de control.
 *
 * POR QUÉ NO REEMPLAZA AL SONDEO
 * ------------------------------
 * Algunos proxies corporativos y extensiones rompen SSE. El navegador cae a
 * sondeo incremental solo (ver `useMensajesEnVivo`), que es peor pero funciona.
 * Nunca quedarse sin mensajes es más importante que la elegancia.
 *
 * COSTO: una conexión abierta ocupa una función mientras dura. Para un inbox de
 * pyme —una o dos personas mirando— es despreciable. Si algún día hay decenas de
 * pestañas abiertas por cliente, conviene revisar esto antes que cualquier otra
 * cosa.
 */
export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) return new Response("Sesión no válida", { status: 401 });

  const { searchParams } = new URL(request.url);
  const empleadoId = searchParams.get("emp") ?? "";
  const chatId = searchParams.get("chat") ?? "";
  const desdeInicial = searchParams.get("desde") ?? new Date().toISOString();
  const idsEstado = (searchParams.get("estados") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);

  if (!empleadoId || !chatId) return new Response("Faltan datos", { status: 400 });

  /**
   * TECHO DE CONEXIONES SIMULTÁNEAS (auditoría 24-ago-2026).
   *
   * Cada stream mantiene una función viva hasta 50 segundos. Con una o dos
   * personas mirando la bandeja es despreciable —lo dice el comentario de más
   * arriba— pero nada impedía abrir veinte pestañas y tener veinte funciones
   * corriendo a la vez por el mismo usuario.
   *
   * Seis por minuto deja trabajar con varias pestañas y con reconexiones (el
   * stream se reabre cada 50 s), y corta el caso raro. Al superarlo se devuelve
   * 429 y el navegador cae solo al sondeo, que sigue funcionando: nadie se queda
   * sin mensajes, solo con un segundo más de latencia.
   */
  if (!(await limitarDistribuido(`sse:${usuario.email}`, 6, 60)).ok) {
    return new Response("Demasiadas conexiones", { status: 429 });
  }

  const supa = db();
  const { data: emp } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("id", empleadoId)
    .eq("cliente_id", usuario.clienteId)
    .maybeSingle();
  if (!emp) return new Response("No encontrado", { status: 404 });

  // El hilo es por NÚMERO (todos los empleados del cliente); el modo, del pedido.
  const hilo = await idsEmpleadosDeCliente(usuario.clienteId);

  const encoder = new TextEncoder();
  let cerrado = false;

  const stream = new ReadableStream({
    async start(controller) {
      const nacimiento = Date.now();
      let cursor = desdeInicial;
      /**
       * Ids ya enviados en este stream. El filtro por fecha es inclusivo (para
       * no perder mensajes que compartan milisegundo), así que sin esto el
       * último conocido volvería a viajar cada 900 ms.
       */
      const yaEnviados = new Set<string>();
      let modoPrevio: string | null = null;
      // Ids cuyo estado de entrega todavía puede cambiar. Se van sumando los
      // mensajes propios que aparecen durante el stream.
      const vigilados = new Set(idsEstado);

      const enviar = (evento: string, dato: unknown) => {
        if (cerrado) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${evento}\ndata: ${JSON.stringify(dato)}\n\n`),
          );
        } catch {
          cerrado = true;
        }
      };

      // Comentario inicial: abre la conexión y desarma el buffering de algunos
      // proxies, que si no retienen la respuesta hasta tener "suficiente".
      enviar("listo", { desde: cursor });

      // Si la persona cierra la pestaña o cambia de chat, cortar de inmediato:
      // sin esto la función seguiría consultando contra nadie.
      request.signal.addEventListener("abort", () => {
        cerrado = true;
      });

      try {
        while (!cerrado && Date.now() - nacimiento < VIDA_MS) {
          await new Promise((r) => setTimeout(r, LATIDO_MS));
          if (cerrado) break;

          const [nuevos, estado, estados] = await Promise.all([
            mensajesNuevos(supa, { empleadoId: hilo, chatId, desde: cursor, limite: 50, excluir: yaEnviados }),
            supa
              .from("ed_chat_estado")
              .select("modo")
              .eq("empleado_id", empleadoId)
              .eq("chat_id", chatId)
              .maybeSingle(),
            vigilados.size
              ? estadosDe(supa, { empleadoId: hilo, ids: [...vigilados] })
              : Promise.resolve({} as Record<string, string>),
          ]);

          if (nuevos.length) {
            cursor = nuevos[nuevos.length - 1].creadoEn;
            for (const m of nuevos) {
              yaEnviados.add(m.id);
              if (m.rol !== "cliente") vigilados.add(m.id);
              // Un mensaje leído ya no cambia más: dejar de preguntar por él.
              if (m.estado === "leido" || m.estado === "error") vigilados.delete(m.id);
            }
            // Solo hace falta recordar los del borde del cursor, no el historial.
            if (yaEnviados.size > 200) {
              for (const id of [...yaEnviados].slice(0, 100)) yaEnviados.delete(id);
            }
            enviar("mensajes", { mensajes: nuevos, hasta: cursor });
          }

          const modo = (estado.data?.modo as string) ?? "bot";
          if (modo !== modoPrevio) {
            modoPrevio = modo;
            enviar("modo", { modo });
          }

          if (Object.keys(estados).length) {
            for (const [id, e] of Object.entries(estados)) {
              if (e === "leido" || e === "error") vigilados.delete(id);
            }
            enviar("estados", { estados });
          }
        }
        // Cierre ordenado: le avisa al navegador que reconecte enseguida en vez
        // de esperar el reintento por error.
        enviar("fin", { desde: cursor });
      } catch (e) {
        enviar("error", { detalle: (e as Error).message });
      } finally {
        cerrado = true;
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      }
    },
    cancel() {
      cerrado = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Sin esto, algunos proxies acumulan la respuesta y el "en vivo" deja de
      // serlo: los mensajes llegan todos juntos al cerrar.
      "X-Accel-Buffering": "no",
    },
  });
}
