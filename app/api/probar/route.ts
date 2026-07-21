import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioPortal } from "@/lib/auth";
import { armarPrompt, type MensajePrueba } from "@/lib/promptEmpleado";
import { generarJSON } from "@/lib/gemini";

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
  // En un Route Handler no se puede redirigir: se responde 401 y la UI avisa.
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) {
    return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  }

  let cuerpo: { empleadoId?: string; historial?: MensajePrueba[] };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }

  const { empleadoId, historial } = cuerpo;
  if (!empleadoId || !Array.isArray(historial) || historial.length === 0) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  // Tope de contexto: una demo no necesita más y evita prompts gigantes.
  const recorte = historial.slice(-20);

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
    return NextResponse.json(
      { error: `El asistente no pudo responder: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
