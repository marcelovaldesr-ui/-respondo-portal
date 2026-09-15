import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { db } from "@/lib/db";
import { rutaDeImagen, rutaEsDelCliente, tipoDeRuta, PREFIJO } from "@/lib/marketing/imagenes";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const BUCKET = "creatividades";

/**
 * LA IMAGEN DE UNA CREATIVIDAD, DETRÁS DE LA SESIÓN.
 *
 * El bucket era público: bastaba con la URL para ver el material publicitario
 * de cualquier negocio, sin cuenta y para siempre. Y la ruta era adivinable
 * —`<uuid del cliente>/<milisegundos>.jpg`, con el uuid visible en la URL del
 * logo del propio negocio—, así que no era ni siquiera oscuridad.
 *
 * SE RESPONDE CON EL BINARIO, NO CON UNA URL FIRMADA. Es la misma decisión que
 * `app/api/whatsapp/media`, y por la misma razón: mandarle al navegador un
 * enlace directo a Storage saltaría la comprobación de negocio que se hace acá
 * arriba, y una URL firmada sobrevive a la sesión que la pidió.
 *
 * TRES PUERTAS, en orden:
 *   1. Sesión con permiso de Marketing.
 *   2. La ruta tiene la forma exacta que escribimos nosotros:
 *      `<uuid>/<ms>.<jpg|png|webp>`, sin traversal, sin rutas absolutas y sin
 *      ninguna otra extensión.
 *   3. La ruta pertenece al prefijo de ESTE negocio.
 *
 * Con esas tres, un usuario solo puede leer objetos bajo su propio prefijo —que
 * es exactamente su propio material—. NO se exige además que exista una fila
 * apuntando a esa ruta: se probó y rompe el estudio. La imagen se sube en
 * cuanto se genera, y la creatividad se guarda después; con esa cuarta puerta,
 * la persona generaba una imagen y veía un recuadro vacío hasta guardarla, que
 * es justo lo que la pantalla existe para evitar. Y no aportaba aislamiento:
 * una ruta ajena ya muere en la puerta 3.
 */
export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return new NextResponse("No autorizado", { status: 401 });

  const cruda = request.nextUrl.searchParams.get("r") ?? "";
  const ruta = rutaDeImagen(`${PREFIJO}${cruda}`);
  // 404 y no 403: un 403 confirmaría que el archivo existe.
  if (!ruta || !rutaEsDelCliente(ruta, usuario.clienteId)) {
    return new NextResponse("No encontrado", { status: 404 });
  }

  const { data, error } = await db().storage.from(BUCKET).download(ruta);
  if (error || !data) return new NextResponse("No disponible", { status: 502 });

  return new NextResponse(data, {
    headers: {
      // El tipo sale de la RUTA que escribimos nosotros, nunca de lo que dijo
      // el navegador al subir. Con `nosniff`, un archivo que se colara con
      // otro contenido no se interpretaría como nada ejecutable.
      "Content-Type": tipoDeRuta(ruta),
      // `private`: fuera de cualquier CDN compartida. La ruta lleva marca de
      // tiempo y el contenido nunca cambia, así que se puede cachear fuerte.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
