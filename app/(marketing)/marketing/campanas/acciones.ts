"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { eliminarBorrador, guardarBorrador, type EntradaBorrador } from "@/lib/marketing/campanas";
import { generarPaquete } from "@/lib/marketing/creatividades";
import { modoDemo } from "@/lib/marketing/modo";
import { cupoDisponible } from "@/lib/marketing/cupo";
import type { EstadoCampana } from "@/lib/marketing/tipos";
import { capacidadesDe } from "@/lib/marketing/capacidades";

/**
 * ACCIONES DEL ASISTENTE DE CAMPAÑAS.
 *
 * El estado del borrador lo calcula `estadoDeBorrador` con lo que la
 * instalación PUEDE hacer hoy. Esas capacidades ya no se recalculan acá: salen
 * de `lib/marketing/capacidades.ts`, el mismo lugar del que las lee la pantalla.
 * Antes eran dos expresiones copiadas, y si una cambiaba sin la otra la píldora
 * que veía el dueño dejaba de coincidir con el estado que se guardaba.
 */
const DEMO_BLOQUEADO = "Estás en datos de demostración: se puede probar, pero no se guarda. Apaga la demo para crear de verdad.";

export async function guardarBorradorAccion(
  entrada: EntradaBorrador,
  id?: string,
): Promise<{ ok: true; id: string; estado: EstadoCampana } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };
  const cap = await capacidadesDe(usuario.clienteId);
  const r = await guardarBorrador(
    usuario.clienteId,
    entrada,
    { metaConectada: cap.metaConectada, puedePublicar: cap.puedePublicarEnMeta },
    id,
  );
  if (r.ok) revalidatePath("/marketing", "layout");
  return r;
}

export async function eliminarBorradorAccion(id: string): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };
  const ok = await eliminarBorrador(usuario.clienteId, id);
  if (ok) revalidatePath("/marketing", "layout");
  return ok ? { ok } : { ok, motivo: "No se pudo eliminar." };
}

/**
 * Escribe dos copies para la campaña con el mismo motor del estudio
 * creativo: mismo contexto del negocio, mismas reglas de Meta.
 */
export async function sugerirCopiesAccion(entrada: {
  objetivo: string;
  oferta: string;
  producto: string;
}): Promise<{ ok: true; copies: { titular: string; texto: string; cta: string }[] } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  const topado = await cupoDisponible(usuario.clienteId, "texto");
  if (topado) return { ok: false, motivo: topado };
  const demo = await modoDemo();
  const r = await generarPaquete(
    usuario.clienteId,
    { objetivo: entrada.objetivo, producto: entrada.producto, oferta: entrada.oferta, plataforma: "ambas", formato: "1:1" },
    demo,
  );
  if (!r.ok) return r;
  const p = r.paquete;
  return {
    ok: true,
    copies: [{ titular: p.titular, texto: p.texto, cta: p.cta }, ...p.variantes.slice(0, 1).map((v) => ({ titular: v.titular, texto: v.texto, cta: v.cta }))],
  };
}

/**
 * Prepara la vista previa rigurosa antes de mutar en Meta Ads o Google Ads.
 */
export async function obtenerVistaPreviaPublicacionAccion(
  borradorId: string,
  proveedor: "meta" | "google",
): Promise<{ ok: true; vistaPrevia: import("@/lib/ads/publicacion").VistaPreviaPublicacion } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };

  const demo = await modoDemo();
  const { obtenerBorrador } = await import("@/lib/marketing/campanas");
  const borrador = await obtenerBorrador(usuario.clienteId, borradorId, demo);
  if (!borrador) return { ok: false, motivo: "No se encontró el borrador de campaña." };

  const { db } = await import("@/lib/db");
  const { data: con } = await db()
    .from("ed_ads_conexion")
    .select("cuenta_id, cuenta_nombre, moneda, estado")
    .eq("cliente_id", usuario.clienteId)
    .eq("proveedor", proveedor)
    .maybeSingle();

  const bloqueos: string[] = [];
  const advertencias: string[] = [];

  if (!demo && (!con || !con.cuenta_id || con.estado !== "conectada")) {
    bloqueos.push(`No hay una cuenta de ${proveedor === "meta" ? "Meta Ads" : "Google Ads"} conectada.`);
  }

  const diario = borrador.presupuestoDiario ?? 0;
  if (diario <= 0) {
    bloqueos.push("Falta configurar un presupuesto diario mayor a 0.");
  }

  const copysValidos = borrador.copies.filter((c) => c.titular.trim() && c.texto.trim());
  if (!copysValidos.length) {
    bloqueos.push("La campaña debe tener al menos un titular y un texto configurados.");
  }

  const audienciaResumen = borrador.audiencia.ubicacion
    ? `${borrador.audiencia.ubicacion} (${borrador.audiencia.edadDesde ?? 18}-${borrador.audiencia.edadHasta ?? 65} años)`
    : "Sin ubicación definida (se usará Chile completo)";

  const plan = borrador.plan as import("@/lib/marketing/arquitectoCore").PlanCampana | null;
  const campanaPlan = plan?.campanas?.find((c) => c.canal === proveedor);

  const palabrasClave = campanaPlan?.grupos?.flatMap((g) => g.palabras) || [];
  const negativas = campanaPlan?.grupos?.flatMap((g) => g.negativasSugeridas) || [];

  if (proveedor === "google" && !palabrasClave.length) {
    advertencias.push("Google Ads Search recomienda incluir al menos 3 a 5 palabras clave para aprender.");
  }

  const trackingUtm: Record<string, string> = {
    utm_source: proveedor === "meta" ? "facebook" : "google",
    utm_medium: proveedor === "meta" ? "cpc" : "search",
    utm_campaign: borrador.nombre.trim().replace(/\s+/g, "_").toLowerCase(),
    utm_content: copysValidos[0]?.titular ? copysValidos[0].titular.trim().replace(/\s+/g, "_").toLowerCase() : "anuncio",
  };

  const vistaPrevia: import("@/lib/ads/publicacion").VistaPreviaPublicacion = {
    plataforma: proveedor,
    cuentaId: con?.cuenta_id ? String(con.cuenta_id) : demo ? "act_demo_12345" : "",
    cuentaNombre: con?.cuenta_nombre ? String(con.cuenta_nombre) : demo ? "Cuenta Demo" : "Sin nombre",
    moneda: con?.moneda ? String(con.moneda) : borrador.moneda || "CLP",
    objetivo: borrador.objetivo,
    destino: borrador.destino,
    destinoDetalle: borrador.destino === "whatsapp" ? "WhatsApp oficial" : "Sitio web",
    presupuesto: {
      diario: diario > 0 ? { valor: diario, moneda: con?.moneda || borrador.moneda || "CLP" } : null,
      total: borrador.presupuestoTotal ? { valor: borrador.presupuestoTotal, moneda: con?.moneda || borrador.moneda || "CLP" } : null,
    },
    audienciaResumen,
    ubicaciones: [borrador.audiencia.ubicacion || "Chile"],
    anuncios: copysValidos.map((c) => ({
      titular: c.titular,
      texto: c.texto,
      cta: c.cta || "Más información",
    })),
    palabrasClave: palabrasClave.map((p) => ({ texto: p.texto, concordancia: p.concordancia })),
    negativas,
    trackingUtm,
    estadoInicial: "PAUSED",
    puedePublicar: bloqueos.length === 0,
    advertencias,
    bloqueos,
  };

  return { ok: true, vistaPrevia };
}

/**
 * Publica una campaña en la plataforma real en estado PAUSADA.
 */
export async function publicarCampanaNativaAccion(
  borradorId: string,
  proveedor: "meta" | "google",
  idempotencyKey?: string,
): Promise<import("@/lib/ads/publicacion").ResultadoPublicacion> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) {
    return {
      ok: false,
      plataforma: proveedor,
      clienteId: "",
      cuentaId: "",
      status: "error",
      createdAt: new Date().toISOString(),
      idempotencyKey: idempotencyKey || "",
      mensaje: "Sesión no válida.",
    };
  }

  const demo = await modoDemo();
  if (demo) {
    return {
      ok: true,
      plataforma: proveedor,
      clienteId: usuario.clienteId,
      cuentaId: "demo_account_123",
      campaignId: `demo_camp_${Date.now()}`,
      adGroupOrAdSetId: `demo_group_${Date.now()}`,
      adIds: [`demo_ad_${Date.now()}`],
      status: "pausada",
      createdAt: new Date().toISOString(),
      urlNativa: proveedor === "meta" ? "https://adsmanager.facebook.com" : "https://ads.google.com",
      idempotencyKey: idempotencyKey || "demo-key",
      mensaje: "Modo demostración: campaña simulada creada en estado PAUSADA.",
    };
  }

  const { obtenerBorrador, registrarPublicacionCampana } = await import("@/lib/marketing/campanas");
  const borrador = await obtenerBorrador(usuario.clienteId, borradorId);
  if (!borrador) {
    return {
      ok: false,
      plataforma: proveedor,
      clienteId: usuario.clienteId,
      cuentaId: "",
      status: "error",
      createdAt: new Date().toISOString(),
      idempotencyKey: idempotencyKey || "",
      mensaje: "No se encontró el borrador de campaña.",
    };
  }

  let resultado: import("@/lib/ads/publicacion").ResultadoPublicacion;

  if (proveedor === "meta") {
    const { publicarCampanaEnMeta } = await import("@/lib/ads/metaPublicar");
    /**
     * `pageId` sale de la Página que el propio negocio vinculó en
     * Integraciones (descubierta en app/api/ads/callback/route.ts), NUNCA de
     * un valor fijo en el código: cada tenant tiene la suya (Impresora Color,
     * AYP Abogados, ...) y un ID de otro negocio publicaría con su identidad.
     * Sin Página vinculada todavía, se manda `undefined` a propósito: el
     * publicador arma Campaign + AdSet igual y se detiene ahí (documentado en
     * metaPublicar.ts), en vez de fallar la campaña completa por algo que el
     * negocio puede resolver después desde Integraciones.
     */
    const { db } = await import("@/lib/db");
    const { data: conexionMeta } = await db()
      .from("ed_ads_conexion")
      .select("datos")
      .eq("cliente_id", usuario.clienteId)
      .eq("proveedor", "meta")
      .maybeSingle();
    const pageId = (conexionMeta?.datos as Record<string, unknown> | null)?.paginaId as
      | string
      | undefined;

    resultado = await publicarCampanaEnMeta({
      clienteId: usuario.clienteId,
      borradorId,
      nombre: borrador.nombre,
      objetivo: borrador.objetivo,
      destino: borrador.destino,
      presupuestoDiario: borrador.presupuestoDiario ?? 0,
      moneda: borrador.moneda,
      audiencia: borrador.audiencia,
      copies: borrador.copies,
      pageId,
    });
  } else {
    const { publicarCampanaEnGoogle } = await import("@/lib/ads/googlePublicar");
    const plan = borrador.plan as import("@/lib/marketing/arquitectoCore").PlanCampana | null;
    const campanaPlan = plan?.campanas?.find((c) => c.canal === "google");
    const grupo = campanaPlan?.grupos?.[0];

    const palabras = grupo?.palabras?.map((p) => ({
      texto: p.texto,
      concordancia: p.concordancia,
    })) || [{ texto: borrador.nombre, concordancia: "frase" as const }];

    const titulares = grupo?.titulares?.length
      ? grupo.titulares
      : borrador.copies.map((c) => c.titular).filter(Boolean);
    const descripciones = grupo?.descripciones?.length
      ? grupo.descripciones
      : borrador.copies.map((c) => c.texto).filter(Boolean);

    resultado = await publicarCampanaEnGoogle({
      clienteId: usuario.clienteId,
      borradorId,
      nombre: borrador.nombre,
      objetivo: borrador.objetivo,
      presupuestoDiario: borrador.presupuestoDiario ?? 0,
      moneda: borrador.moneda,
      urlFinal: "https://respondo.cl",
      palabrasClave: palabras,
      negativas: grupo?.negativasSugeridas || [],
      titulares,
      descripciones,
    });
  }

  if (resultado.ok) {
    await registrarPublicacionCampana(usuario.clienteId, borradorId, resultado);
    revalidatePath("/marketing", "layout");
  }

  return resultado;
}

