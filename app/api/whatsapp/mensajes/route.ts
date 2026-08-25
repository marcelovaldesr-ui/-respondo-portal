import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  estadosDe,
  mensajesAnteriores,
  mensajesNuevos,
  ultimosMensajes,
} from "@/lib/inboxConsulta";

export const dynamic = "force-dynamic";

/**
 * Mensajes de un chat en JSON, para el inbox en vivo.
 *
 * TRES MODOS, según los parámetros:
 *
 *  - `?desde=<iso>&estados=<id,id,…>` → **INCREMENTAL**. Devuelve solo lo que
 *    llegó después de ese instante, más los estados de entrega que cambiaron.
 *    Es el modo normal: la respuesta típica es `{mensajes:[],estados:{}}`, unos
 *    pocos bytes.
 *  - `?antesDe=<iso>` → **HISTORIAL** hacia atrás, para "ver mensajes anteriores".
 *  - sin nada → el tramo reciente completo (primera carga o recuperación).
 *
 * ⚠️ ANTES ESTE ENDPOINT DEVOLVÍA SIEMPRE 200 MENSAJES COMPLETOS, y el navegador
 * lo llamaba cada 4 segundos. El costo no era solo de red: reemplazar el arreglo
 * entero obligaba a React a volver a dibujar toda la conversación.
 *
 * Seguridad: sesión de portal + el empleado debe ser del cliente logueado.
 */
export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const empleadoId = searchParams.get("emp") ?? "";
  const chatId = searchParams.get("chat") ?? "";
  if (!empleadoId || !chatId) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const supa = db();

  // Barrera de acceso: el empleado tiene que ser del cliente logueado.
  const { data: emp } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("id", empleadoId)
    .eq("cliente_id", usuario.clienteId)
    .maybeSingle();
  if (!emp) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const antesDe = searchParams.get("antesDe");
  if (antesDe) {
    const r = await mensajesAnteriores(supa, { empleadoId, chatId, antesDe });
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  }

  const desde = searchParams.get("desde");
  const idsEstado = (searchParams.get("estados") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [mensajes, estado, estados] = await Promise.all([
    desde
      ? mensajesNuevos(supa, { empleadoId, chatId, desde })
      : ultimosMensajes(supa, { empleadoId, chatId }),
    supa
      .from("ed_chat_estado")
      .select("modo")
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .maybeSingle(),
    idsEstado.length ? estadosDe(supa, { empleadoId, ids: idsEstado }) : Promise.resolve({}),
  ]);

  return NextResponse.json(
    {
      modo: (estado.data?.modo as string) ?? "bot",
      mensajes,
      estados,
      // Marca de "hasta acá leí": el navegador la usa como cursor siguiente.
      // Va explícita para no depender de que el cliente sepa deducirla.
      hasta: mensajes.length ? mensajes[mensajes.length - 1].creadoEn : (desde ?? null),
      completo: !desde,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
