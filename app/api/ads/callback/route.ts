import { NextResponse, type NextRequest } from "next/server";
import { nombreCookieVinculo, vinculoValido } from "@/lib/oauthVinculo";
import { db } from "@/lib/db";
import { cifrar, verificarEstado } from "@/lib/cifrado";
import { intercambiarCodigoAds, metaAdsConfigurado, proveedorMeta } from "@/lib/ads/meta";
import type { PaginaMeta } from "@/lib/ads/proveedor";

export const dynamic = "force-dynamic";

/** Misma convención que googleOAuth/instagramOAuth: variable con respaldo a producción. */
const PORTAL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://respondo-portal.vercel.app"
).replace(/\/+$/, "");

function volver(motivo: string): NextResponse {
  return NextResponse.redirect(new URL(`/marketing/integraciones?e=${motivo}`, PORTAL));
}

/**
 * Vuelta de Meta después de autorizar.
 *
 * ORDEN DE LAS VERIFICACIONES, QUE IMPORTA:
 *   1. **La firma del `state` primero.** De ahí sale el `cliente_id`, y de
 *      ninguna otra parte. Aceptar un `cliente_id` que venga en la URL sería
 *      dejar que cualquiera escriba una conexión en el negocio de otro.
 *   2. Recién después se canjea el código, que es la llamada cara.
 *   3. El token se guarda CIFRADO. Este token lee el gasto publicitario del
 *      negocio: en claro, una fuga de la base lo entrega directo.
 *
 * ⚠️ NO se elige cuenta acá. Si el usuario administra varias, elegir por él
 * significaría mostrarle las cifras de otro negocio sin que se note. La
 * conexión queda en `pendiente` y la pantalla le pide que elija.
 */
export async function GET(request: NextRequest) {
  if (!metaAdsConfigurado()) return volver("no_configurado");

  const url = new URL(request.url);
  const codigo = url.searchParams.get("code");
  const estado = url.searchParams.get("state");

  // El usuario apretó «cancelar» en la pantalla de Meta. No es un error.
  if (url.searchParams.get("error")) return volver("cancelado");
  if (!codigo || !estado) return volver("respuesta_incompleta");

  const datos = verificarEstado(estado, "ads-estado");
  const clienteId = datos?.clienteId;
  if (!clienteId) return volver("estado_invalido");
  // El `state` tiene que haber salido de ESTE navegador (Fase 0, CSRF de OAuth).
  if (!vinculoValido(estado, request.cookies.get(nombreCookieVinculo("ads"))?.value)) {
    return volver("estado_invalido");
  }

  const token = await intercambiarCodigoAds(codigo);
  if (!token.ok) return volver(token.error.codigo);

  /**
   * Se pregunta por las cuentas ANTES de guardar: si el token no llega a
   * ninguna —porque el usuario no administra ninguna cuenta publicitaria— vale
   * más decirlo ahora que dejar una conexión guardada que nunca va a mostrar
   * nada y que el dueño va a creer que está funcionando.
   */
  const cuentas = await proveedorMeta.cuentasConToken(token.datos);
  if (!cuentas.ok) return volver(cuentas.error.codigo);
  if (!cuentas.datos.length) return volver("sin_cuentas");

  /**
   * QUÉ CUENTA QUEDA ELEGIDA, EN ORDEN:
   *   1. Si hay una sola, esa. No hay nada que preguntar.
   *   2. Si el negocio YA tenía una elegida y sigue entre las autorizadas, se
   *      conserva. Este es el caso de reconectar cuando venció el token: sin
   *      esto la conexión volvería a «pendiente» y la pantalla le pediría al
   *      dueño que vuelva a elegir la misma cuenta que ya tenía — y hasta que
   *      lo hiciera, el gasto no se vería.
   *   3. Si no, `pendiente`: que elija. Adivinar sería mostrarle las cifras de
   *      otro de sus negocios sin que se note.
   */
  let elegida = cuentas.datos.length === 1 ? cuentas.datos[0] : null;
  const { data: previa } = await db()
    .from("ed_ads_conexion")
    .select("cuenta_id, datos")
    .eq("cliente_id", clienteId)
    .eq("proveedor", "meta")
    .maybeSingle();
  if (!elegida) {
    const anterior = String(previa?.cuenta_id ?? "");
    if (anterior) elegida = cuentas.datos.find((c) => c.id === anterior) ?? null;
  }

  /**
   * DESCUBRIMIENTO DE PÁGINA/INSTAGRAM — mismo criterio que la cuenta de
   * arriba: una sola Página, se elige sola; si ya había una elegida y sigue
   * entre las autorizadas, se conserva; si no, queda para elegir después.
   *
   * ⚠️ NO ES BLOQUEANTE. Si el token todavía no tiene el activo «Páginas»
   * autorizado (reconexión pendiente) o el negocio no tiene ninguna Página,
   * esto devuelve una lista vacía y la conexión de todos modos se guarda con
   * la cuenta publicitaria: leer el gasto no depende de tener una Página.
   */
  const datosPrevios = (previa?.datos ?? {}) as Record<string, unknown>;
  let paginas: PaginaMeta[] = [];
  try {
    const r = await proveedorMeta.paginasConToken(token.datos);
    if (r.ok) paginas = r.datos;
  } catch (e) {
    console.error("[ads] no se pudo listar páginas (no bloqueante):", (e as Error).message);
  }

  let paginaElegida: PaginaMeta | null = paginas.length === 1 ? paginas[0] : null;
  if (!paginaElegida) {
    const anteriorPaginaId = String(datosPrevios.paginaId ?? "");
    if (anteriorPaginaId) {
      paginaElegida = paginas.find((p) => p.id === anteriorPaginaId) ?? null;
    }
  }

  const datosActualizados: Record<string, unknown> = {
    ...datosPrevios,
    // Lista completa para cuando el selector de Integraciones deje elegir
    // entre varias — hoy no bloquea nada, mañana no exige otra llamada a Meta.
    paginasDisponibles: paginas.map((p) => ({ id: p.id, nombre: p.nombre })),
  };
  if (paginaElegida) {
    datosActualizados.paginaId = paginaElegida.id;
    datosActualizados.paginaNombre = paginaElegida.nombre;
    if (paginaElegida.instagramId) {
      datosActualizados.instagramId = paginaElegida.instagramId;
      datosActualizados.instagramUsuario = paginaElegida.instagramUsuario;
    } else {
      delete datosActualizados.instagramId;
      delete datosActualizados.instagramUsuario;
    }
  }

  try {
    const { error } = await db()
      .from("ed_ads_conexion")
      .upsert(
        {
          cliente_id: clienteId,
          proveedor: "meta",
          token_cifrado: cifrar(token.datos, "ads-token"),
          /**
           * `token_vence` va NULO a propósito. El ajuste de Meta está creado
           * como usuario del sistema **sin caducidad**, así que no hay fecha
           * que guardar. Poner 60 días «por si acaso» haría que el checklist
           * avisara de un vencimiento que no existe — y un aviso falso enseña
           * a ignorar los avisos verdaderos. Si el token muere por otra razón
           * (lo revocan, cambian la clave), Meta responde 190 y eso ya se
           * traduce a «Reconectar».
           */
          token_vence: null,
          // Con una sola cuenta no hay nada que elegir: se deja lista.
          ...(elegida
            ? {
                cuenta_id: elegida.id,
                cuenta_nombre: elegida.nombre,
                moneda: elegida.moneda,
                zona_horaria: elegida.zonaHoraria,
                estado: "conectada",
              }
            : { estado: "pendiente" }),
          datos: datosActualizados,
          ultimo_error: null,
          actualizado_en: new Date().toISOString(),
        },
        { onConflict: "cliente_id,proveedor" },
      );
    if (error) throw new Error(error.message);
  } catch (e) {
    // El detalle va al log del servidor, nunca a la URL: puede traer nombres
    // de columnas y detalles internos.
    console.error("[ads] no se pudo guardar la conexión:", (e as Error).message);
    return volver("no_se_guardo");
  }

  return NextResponse.redirect(new URL(`/marketing/integraciones?ok=${elegida ? "1" : "elegir"}`, PORTAL));
}
