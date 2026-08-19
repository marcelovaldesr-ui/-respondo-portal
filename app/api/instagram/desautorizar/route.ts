import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * DESAUTORIZACIÓN — Meta llama acá cuando un cliente le quita el permiso a
 * Respondo desde los ajustes de su Instagram.
 *
 * Meta EXIGE esta URL antes de aceptar la solicitud de revisión, pero además
 * hace falta de verdad: sin ella, un negocio que nos desconecta queda con su
 * token guardado en nuestra base y el portal seguiría diciendo "conectado"
 * mientras nada funciona. Guardar una credencial que el dueño ya revocó no
 * tiene ninguna justificación.
 *
 * Meta manda un POST con `signed_request` en el cuerpo, en formato
 * `<firma>.<payload>`, ambos en base64url, firmado con HMAC-SHA256 usando el
 * secreto de la app. Sin verificar esa firma, cualquiera podría desconectar a
 * los clientes de Respondo mandando un POST con el id que se le ocurra.
 */

type Payload = { user_id?: string; algorithm?: string; issued_at?: number };

function verificarSignedRequest(signed: string, secreto: string): Payload | null {
  const [firmaB64, payloadB64] = signed.split(".");
  if (!firmaB64 || !payloadB64) return null;

  const esperada = createHmac("sha256", secreto).update(payloadB64).digest();
  const recibida = Buffer.from(firmaB64, "base64url");
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;

  try {
    const p = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Payload;
    // Meta documenta HMAC-SHA256; si algún día mandaran otro algoritmo, mejor
    // rechazar que asumir.
    if (p.algorithm && p.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
    return p;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const secreto = process.env.IG_APP_SECRET;
  // Fail closed: sin secreto no se puede verificar nada, y una ruta pública que
  // desconecta clientes no puede quedar abierta por una variable ausente.
  if (!secreto) return new NextResponse("no configurado", { status: 503 });

  let signed: string | null = null;
  try {
    const form = await req.formData();
    signed = (form.get("signed_request") as string) ?? null;
  } catch {
    signed = null;
  }
  if (!signed) return new NextResponse("falta signed_request", { status: 400 });

  const payload = verificarSignedRequest(signed, secreto);
  if (!payload?.user_id) return new NextResponse("firma inválida", { status: 403 });

  // Se borra la conexión, no el cliente ni sus conversaciones: el negocio sigue
  // existiendo y su historial también. Lo único que desaparece es la credencial
  // y el vínculo con la cuenta de Instagram.
  const { error } = await db()
    .from("ed_clientes")
    .update({
      ig_token_cifrado: null,
      ig_token: null,
      ig_token_vence: null,
      ig_user_id: null,
      ig_usuario: null,
      ig_conectado_en: null,
    })
    .eq("ig_user_id", payload.user_id);

  if (error) {
    console.error("[instagram] desautorización: no se pudo limpiar:", error.message);
    // 200 igual: Meta reintenta si respondemos error, y el reintento no va a
    // arreglar un problema de base de datos. Queda en el log para revisarlo.
  } else {
    console.warn(`[instagram] cuenta desautorizada por el dueño (ig_user_id ${payload.user_id})`);
  }

  return NextResponse.json({ ok: true });
}

/** Meta a veces sondea con GET al guardar la URL. */
export async function GET() {
  return NextResponse.json({ ok: true });
}
