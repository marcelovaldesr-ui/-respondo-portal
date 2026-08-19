import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * LOS ERRORES DEL NAVEGADOR, EN LOS REGISTROS DEL SERVIDOR.
 *
 * EL AGUJERO QUE TAPA: hasta hoy solo veíamos lo que fallaba en el servidor.
 * Si el portal se le rompía a Cecilia en su navegador, nosotros no nos
 * enterábamos nunca — ella recargaba, seguía trabajando, y el problema vivía
 * ahí meses. Pasó exactamente eso el 19-ago-2026: el portal se caía en todas
 * las pantallas, en varios computadores, y Vercel no registraba nada porque
 * nunca llegaba al servidor.
 *
 * Es el mismo criterio que /api/salud: si algo puede fallar en silencio, hay
 * que obligarlo a hacer ruido.
 *
 * QUÉ NO GUARDA: la URL llega sin parámetros. Las de este portal traen ids de
 * chat, y un identificador de conversación en un registro de diagnóstico es
 * justo el tipo de dato que no tiene por qué estar ahí.
 */

type Cuerpo = { mensaje?: string; pila?: string; ruta?: string; version?: string; origen?: string };

// Tope defensivo: esta ruta es pública y un bucle de errores en un navegador
// podría inundar los registros. Con esto, lo peor que pasa es que se pierdan
// repeticiones de algo que ya quedó anotado.
const VISTOS = new Map<string, number>();
const VENTANA_MS = 60_000;
const MAX_POR_VENTANA = 5;

function demasiados(clave: string): boolean {
  const ahora = Date.now();
  for (const [k, t] of VISTOS) if (ahora - t > VENTANA_MS) VISTOS.delete(k);
  const n = [...VISTOS.keys()].filter((k) => k.startsWith(clave)).length;
  if (n >= MAX_POR_VENTANA) return true;
  VISTOS.set(`${clave}:${ahora}`, ahora);
  return false;
}

export async function POST(req: NextRequest) {
  let c: Cuerpo;
  try {
    c = (await req.json()) as Cuerpo;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const mensaje = String(c.mensaje ?? "").slice(0, 400);
  if (!mensaje) return NextResponse.json({ ok: true });

  // La ruta SIN parámetros: /conversaciones, no /conversaciones?chat=ig:123.
  const ruta = String(c.ruta ?? "").split("?")[0].slice(0, 120);

  if (demasiados(mensaje.slice(0, 60))) return NextResponse.json({ ok: true, omitido: true });

  console.error(
    "[error-cliente]",
    JSON.stringify({
      mensaje,
      ruta,
      origen: String(c.origen ?? "").slice(0, 40),
      version: String(c.version ?? "").slice(0, 20),
      // La pila viene minificada, pero los nombres de archivo y las posiciones
      // igual sirven para ubicar el componente.
      pila: String(c.pila ?? "").slice(0, 1800),
    }),
  );

  return NextResponse.json({ ok: true });
}
