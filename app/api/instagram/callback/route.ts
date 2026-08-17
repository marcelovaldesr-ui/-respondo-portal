import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  cifrarTokenIg,
  clienteDelEstadoIg,
  intercambiarCodigoIg,
  perfilIg,
  suscribirWebhooksIg,
  tokenLargoIg,
} from "@/lib/instagramOAuth";

export const dynamic = "force-dynamic";

/**
 * PASO 2 del botón "Conectar Instagram": la vuelta desde el login de Instagram.
 *
 * GET /api/instagram/callback?code=...&state=...
 *
 * Esta ruta es PÚBLICA por obligación: Instagram redirige acá el navegador del
 * dueño y no reenvía la sesión del portal. La única barrera es la firma del
 * `state` — por eso se verifica antes de tocar nada.
 *
 * Hace cuatro cosas, y las cuatro tienen que salir bien:
 *   1. código → token corto (1 hora)
 *   2. token corto → token de 60 días
 *   3. SUSCRIBIR la cuenta a los webhooks   ← sin esto no llega ni un DM
 *   4. guardar, con el token cifrado
 *
 * El paso 3 es el traicionero: si falla, todo lo demás dice "conectado" y el
 * canal está muerto en silencio. Por eso, si falla, NO se guarda como conectado
 * y el dueño ve un error de verdad.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const destino = (estado: string) => new URL(`/whatsapp?ig=${estado}`, req.url);

  // El dueño apretó "Cancelar" en la pantalla de Instagram.
  const errorIg = url.searchParams.get("error");
  if (errorIg) return NextResponse.redirect(destino("cancelado"));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(destino("faltan_datos"));

  const clienteId = clienteDelEstadoIg(state);
  if (!clienteId) return NextResponse.redirect(destino("estado_invalido"));

  const corto = await intercambiarCodigoIg(code);
  if (!corto.ok) {
    console.error("[instagram] intercambio de código falló:", corto.motivo);
    return NextResponse.redirect(destino("codigo"));
  }

  const largo = await tokenLargoIg(corto.datos.tokenCorto);
  if (!largo.ok) {
    console.error("[instagram] token de 60 días falló:", largo.motivo);
    return NextResponse.redirect(destino("token"));
  }

  // Suscribir ANTES de guardar: si esto falla, el canal no funcionaría y es
  // preferible que el dueño lo vea ahora y reintente, a que se entere dentro de
  // una semana porque un cliente reclamó que nadie le contestó por Instagram.
  const sub = await suscribirWebhooksIg(corto.datos.igUserId, largo.datos.token);
  if (!sub.ok) {
    console.error("[instagram] subscribed_apps falló:", sub.motivo);
    return NextResponse.redirect(destino("sin_webhook"));
  }

  const usuario = await perfilIg(corto.datos.igUserId, largo.datos.token);

  const { error } = await db()
    .from("ed_clientes")
    .update({
      ig_user_id: corto.datos.igUserId,
      ig_token_cifrado: cifrarTokenIg(largo.datos.token),
      // La columna vieja en claro queda explícitamente vacía: que una conexión
      // nueva no repueble lo que la migración 281 vino a limpiar.
      ig_token: null,
      ig_token_vence: largo.datos.venceIso,
      ig_conectado_en: new Date().toISOString(),
      ig_usuario: usuario,
    })
    .eq("id", clienteId);

  if (error) {
    console.error("[instagram] no se pudo guardar:", error.message);
    return NextResponse.redirect(destino("guardar"));
  }

  return NextResponse.redirect(destino("ok"));
}
