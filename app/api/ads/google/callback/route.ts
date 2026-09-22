import { NextResponse, type NextRequest } from "next/server";
import { nombreCookieVinculo, vinculoValido } from "@/lib/oauthVinculo";
import { db } from "@/lib/db";
import { verificarEstado } from "@/lib/cifrado";
import { origenCanonico } from "@/lib/origenes";
import type { ErrorAds } from "@/lib/ads/proveedor";
import {
  cifrarRefreshToken,
  cuentasDeGoogle,
  googleAdsConfigurado,
  intercambiarCodigoGoogleAds,
} from "@/lib/ads/google";

export const dynamic = "force-dynamic";

/**
 * ⚠️ EL DETALLE NO PUEDE SALIR A LA URL, PERO TAMPOCO PUEDE PERDERSE.
 *
 * `fallo()` guarda en `detalle` lo que Google respondió de verdad. Ese texto no
 * viaja a la URL a propósito —puede traer fragmentos de la respuesta— pero
 * hasta acá tampoco iba a ningún otro lado: se perdía en el `return`. El
 * resultado práctico fue una tarde entera de diagnóstico a ciegas: la pantalla
 * decía `respuesta_rara` y ese código tiene DOS orígenes que se arreglan de
 * formas opuestas —el canje del código contra `oauth2.googleapis.com`, que es
 * un problema de credenciales nuestras, y la primera llamada a la API de Ads,
 * que es un problema de nivel de acceso o de token de desarrollador—. Sin el
 * detalle no hay forma de saber cuál de los dos fue.
 *
 * Es el mismo principio que ya está escrito en `lib/ads/proveedor.ts`: un
 * diagnóstico que el producto tiene y no dice es un diagnóstico que no tiene.
 * Lo único que cambia acá es el destino correcto: el log del servidor, no la
 * pantalla.
 */
function registrar(etapa: string, error: ErrorAds): void {
  console.error(`[ads-google] falló ${etapa}:`, error.codigo, error.detalle ?? "(sin detalle)");
}

/**
 * ⚠️ `p=google` viaja en la URL y NO es un detalle cosmético.
 *
 * El catálogo de avisos de la pantalla de Integraciones se escribió cuando Meta
 * era el único canal y dice «Meta» en cada texto. Sin saber de qué plataforma
 * vino el fallo, un error de Google salía como «falta permiso para leer esa
 * cuenta publicitaria en Meta» y mandaba a revisar la conexión equivocada.
 *
 * Solo viaja el CÓDIGO y la plataforma. El `detalle` técnico sigue sin salir
 * nunca a la URL: puede traer fragmentos de la respuesta de Google.
 */
function volver(motivo: string): NextResponse {
  return NextResponse.redirect(new URL(`/marketing/integraciones?e=${motivo}&p=google`, origenCanonico()));
}

/**
 * Vuelta de Google después de autorizar Google Ads (lectura y publicación en pausa).
 *
 * MISMO ORDEN DE VERIFICACIONES QUE EN META, POR LAS MISMAS RAZONES:
 *   1. **La firma del `state` primero**, porque de ahí sale el `cliente_id` y
 *      de ningún otro lado. Un `cliente_id` en la URL sería dejar que
 *      cualquiera escriba una conexión en el negocio de otro.
 *   2. La cookie de vínculo: el `state` tiene que haber salido de ESTE
 *      navegador. Cierra el CSRF de OAuth.
 *   3. Recién después se canjea el código, que es la llamada cara.
 *   4. El refresh token se guarda CIFRADO y con propósito propio.
 *
 * ⚠️ LA CUENTA NO SE ELIGE ACÁ. Google devuelve con frecuencia varias cuentas
 * —quien administra su negocio y el de un familiar, o una agencia con
 * veinte—. Elegir la primera le mostraría a alguien las cifras de otro negocio
 * durante semanas sin que se note. Con una sola, se deja lista; con varias, la
 * conexión queda `pendiente` y la pantalla pide elegir.
 */
export async function GET(request: NextRequest) {
  if (!googleAdsConfigurado()) return volver("no_configurado");

  const url = new URL(request.url);
  const codigo = url.searchParams.get("code");
  const estado = url.searchParams.get("state");

  // El dueño apretó «cancelar» en la pantalla de Google. No es un error.
  if (url.searchParams.get("error")) return volver("cancelado");
  if (!codigo || !estado) return volver("respuesta_incompleta");

  const datos = verificarEstado(estado, "ads-google-estado");
  const clienteId = datos?.clienteId;
  if (!clienteId) return volver("estado_invalido");
  if (!vinculoValido(estado, request.cookies.get(nombreCookieVinculo("ads-google"))?.value)) {
    return volver("estado_invalido");
  }

  const refresh = await intercambiarCodigoGoogleAds(codigo);
  if (!refresh.ok) {
    registrar("el canje del código por el refresh token", refresh.error);
    return volver(refresh.error.codigo);
  }

  /**
   * Se preguntan las cuentas ANTES de guardar: si el token no llega a ninguna
   * —porque el usuario de Google no administra ninguna cuenta publicitaria, o
   * porque el token de desarrollador todavía es de prueba— vale más decirlo
   * ahora que dejar guardada una conexión que nunca va a mostrar nada.
   */
  const cuentas = await cuentasDeGoogle(refresh.datos);
  if (!cuentas.ok) {
    registrar("la lectura de cuentas accesibles en la API de Ads", cuentas.error);
    return volver(cuentas.error.codigo);
  }

  const operativas = cuentas.datos.filter((c) => !c.administradora);
  if (!operativas.length) return volver("sin_cuentas");

  let elegida = operativas.length === 1 ? operativas[0] : null;
  if (!elegida) {
    /**
     * Reconexión: si el negocio YA tenía una cuenta elegida y sigue entre las
     * autorizadas, se conserva. Sin esto, renovar el permiso devolvería la
     * conexión a «pendiente» y el gasto desaparecería de las pantallas hasta
     * que alguien volviera a elegir la misma cuenta de antes.
     */
    const { data: previa } = await db()
      .from("ed_ads_conexion")
      .select("cuenta_id")
      .eq("cliente_id", clienteId)
      .eq("proveedor", "google")
      .maybeSingle();
    const anterior = String(previa?.cuenta_id ?? "").replace(/\D+/g, "");
    if (anterior) elegida = operativas.find((c) => c.id === anterior) ?? null;
  }

  try {
    const fila: Record<string, unknown> = {
      cliente_id: clienteId,
      proveedor: "google",
      token_cifrado: cifrarRefreshToken(refresh.datos),
      /**
       * Un refresh token de Google no tiene fecha de vencimiento: muere cuando
       * lo revocan o cuando se borra el cliente OAuth. Guardar una fecha
       * inventada haría que el checklist avise de un vencimiento que no existe.
       */
      token_vence: null,
      ultimo_error: null,
      actualizado_en: new Date().toISOString(),
      ...(elegida
        ? {
            cuenta_id: elegida.id,
            cuenta_nombre: elegida.nombre,
            cuenta_padre_id: elegida.padreId,
            moneda: elegida.moneda,
            zona_horaria: elegida.zonaHoraria,
            estado: "conectada",
          }
        : { estado: "pendiente" }),
    };

    const { error } = await db().from("ed_ads_conexion").upsert(fila, { onConflict: "cliente_id,proveedor" });

    /**
     * Sin la migración 309, `cuenta_padre_id` no existe y PostgREST rechaza el
     * upsert ENTERO (no ignora la columna). Se reintenta sin ella para que
     * conectar funcione igual: lo único que se pierde es poder leer cuentas
     * que cuelgan de una administradora, y eso la pantalla lo dice.
     */
    if (error && /cuenta_padre_id/.test(error.message)) {
      delete fila.cuenta_padre_id;
      const segundo = await db().from("ed_ads_conexion").upsert(fila, { onConflict: "cliente_id,proveedor" });
      if (segundo.error) throw new Error(segundo.error.message);
    } else if (error) {
      throw new Error(error.message);
    }
  } catch (e) {
    // El detalle va al log del servidor, nunca a la URL.
    console.error("[ads-google] no se pudo guardar la conexión:", (e as Error).message);
    return volver("no_se_guardo");
  }

  return NextResponse.redirect(
    new URL(`/marketing/integraciones?ok=${elegida ? "google" : "elegir_google"}`, origenCanonico()),
  );
}
