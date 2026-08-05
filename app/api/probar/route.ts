import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { armarPrompt, type MensajePrueba } from "@/lib/promptEmpleado";
import { generarJSON } from "@/lib/gemini";
import { limitarDistribuido } from "@/lib/seguridad";
import { esUuid, parsearJsonAcotado } from "@/lib/reservasPublicas";
import { idSolicitud, logOperacion } from "@/lib/observabilidad";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RespuestaMotor = {
  respuesta?: string;
  escalar?: boolean;
  trigger?: string | null;
  resumen_para_humano?: string | null;
  lead?: { clasificacion?: string };
  accion?: string | null;
};

export async function POST(request: NextRequest) {
  const requestId = idSolicitud(request.headers);
  // En un Route Handler no se puede redirigir: se responde 401 y la UI avisa.
  const usuario = await obtenerUsuarioConPermiso("editar_conocimiento");
  if (!usuario) {
    return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  }

  // COSTO: cada llamada consume créditos de IA. Un usuario con sesión podría
  // (por error o a propósito) disparar miles en bucle. Tope por usuario.
  const cuota = await limitarDistribuido(`probar:${usuario.email}`, 30, 60);
  if (!cuota.ok) {
    return NextResponse.json(
      { error: "Demasiadas pruebas seguidas. Espera un momento y vuelve a intentar." },
      { status: 429 },
    );
  }

  const cuerpo = parsearJsonAcotado(await request.text(), 64 * 1024) as {
    empleadoId?: unknown;
    historial?: unknown;
  } | null;
  if (!cuerpo) {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }

  const { empleadoId, historial } = cuerpo;
  if (
    typeof empleadoId !== "string" ||
    !esUuid(empleadoId) ||
    !Array.isArray(historial) ||
    historial.length === 0 ||
    historial.length > 50
  ) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  // Tope de contexto: una demo no necesita más y evita prompts gigantes.
  const recorte: MensajePrueba[] = [];
  for (const entrada of historial.slice(-20)) {
    if (!entrada || typeof entrada !== "object") {
      return NextResponse.json({ error: "Historial inválido" }, { status: 400 });
    }
    const { rol, texto } = entrada as { rol?: unknown; texto?: unknown };
    if (
      !["cliente", "empleado", "humano"].includes(String(rol)) ||
      typeof texto !== "string" ||
      texto.length === 0 ||
      texto.length > 2_000
    ) {
      return NextResponse.json({ error: "Historial inválido" }, { status: 400 });
    }
    recorte.push({ rol: rol as MensajePrueba["rol"], texto });
  }

  const prompt = await armarPrompt(usuario.clienteId, empleadoId, recorte);
  if (!prompt) {
    // El empleado no pertenece a este cliente.
    return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  }

  try {
    const crudo = await generarJSON(prompt);
    let datos: RespuestaMotor;
    try {
      datos = JSON.parse(crudo);
    } catch {
      // Si el modelo devolvió texto suelto, lo usamos igual en vez de romper la demo.
      return NextResponse.json({ respuesta: crudo.trim(), escalar: false });
    }

    return NextResponse.json({
      respuesta:
        datos.respuesta?.trim() ||
        "Prefiero confirmar eso con el equipo para no darte un dato malo 👍",
      escalar: Boolean(datos.escalar),
      trigger: datos.trigger ?? null,
      resumen: datos.resumen_para_humano ?? null,
      lead: datos.lead?.clasificacion ?? null,
      accion: datos.accion ?? null,
    });
  } catch (e) {
    logOperacion("error", "prueba_asistente_fallida", { requestId }, {
      error: (e as Error).message.slice(0, 200),
    });
    return NextResponse.json(
      { error: "El asistente no pudo responder", requestId },
      { status: 502 },
    );
  }
}
