import { sanitizarMensajeError } from "@/lib/ads/publicacion";

/**
 * GESTIÓN MÍNIMA DE CAMPAÑAS DE GOOGLE ADS CREADAS POR RESPONDO (Search V1).
 *
 * No es un Administrador de anuncios. Son las primitivas que V1 necesita:
 *   · leer la estructura de una campaña (estado, presupuesto, grupos, anuncios
 *     y palabras clave) SIN métricas: una campaña recién creada o una cuenta de
 *     prueba no tienen impresiones y no por eso «no existen»;
 *   · pausarla;
 *   · reactivarla SÓLO si la cuenta es de PRUEBA de Google Ads (no sirve
 *     anuncios, no gasta). En una cuenta real, activar y gastar lo decide el
 *     negocio en Google Ads: esa es la regla de dinero del producto.
 *
 * ⭐ Guardia de tenant: sólo se opera una campaña cuyo id está guardado en
 * `ed_mk_campanas.google_campaign_id` de ESE negocio. Un id que llega de afuera
 * no alcanza para tocar nada — ni siquiera en la misma cuenta de Google, donde
 * puede haber campañas que el negocio maneja a mano.
 */

export type EstructuraCampanaGoogle = {
  cuentaId: string;
  cuentaDePrueba: boolean;
  campana: { id: string; nombre: string; estado: string; tipo: string; presupuestoMicros: number | null; budgetId: string | null };
  grupos: { id: string; nombre: string; estado: string }[];
  anuncios: { id: string; grupoId: string; estado: string; titulares: string[]; descripciones: string[]; urlFinal: string | null }[];
  palabras: { id: string; grupoId: string; texto: string; concordancia: string; estado: string }[];
};

type Res<T> = { ok: true; datos: T } | { ok: false; codigo: string; mensaje: string };

async function campanaDelNegocio(clienteId: string, campaignId: string): Promise<boolean> {
  const id = String(campaignId).replace(/\D+/g, "");
  if (!id) return false;
  const { leerDe } = await import("@/lib/marketing/tenant");
  const { data } = await leerDe(clienteId, "ed_mk_campanas").eq("google_campaign_id", id).limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function sesion(clienteId: string) {
  const { sesionGoogleDe } = await import("@/lib/ads/google");
  return sesionGoogleDe(clienteId);
}

function filas(r: { ok: boolean; datos?: Record<string, unknown>[] }): Record<string, unknown>[] {
  return r.ok && Array.isArray(r.datos) ? r.datos : [];
}

/** Lee estado, presupuesto, grupos, anuncios y palabras de UNA campaña de Respondo. */
export async function leerEstructuraCampanaGoogle(clienteId: string, campaignId: string): Promise<Res<EstructuraCampanaGoogle>> {
  if (!(await campanaDelNegocio(clienteId, campaignId))) {
    return { ok: false, codigo: "NO_ES_DE_RESPONDO", mensaje: "Esa campaña no fue creada por Respondo para este negocio." };
  }
  const s = await sesion(clienteId);
  if (!s.ok) return { ok: false, codigo: s.error.codigo, mensaje: s.error.mensaje };
  const { consultarComoNegocio } = await import("@/lib/ads/google");
  const id = String(campaignId).replace(/\D+/g, "");

  const [rCamp, rCli, rGrupos, rAds, rKw] = await Promise.all([
    consultarComoNegocio(s.datos, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
        campaign_budget.id, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${id}`),
    consultarComoNegocio(s.datos, `SELECT customer.id, customer.test_account FROM customer LIMIT 1`),
    consultarComoNegocio(s.datos, `SELECT ad_group.id, ad_group.name, ad_group.status FROM ad_group WHERE campaign.id = ${id}`),
    consultarComoNegocio(s.datos, `SELECT ad_group.id, ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad.final_urls,
        ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions
        FROM ad_group_ad WHERE campaign.id = ${id}`),
    consultarComoNegocio(s.datos, `SELECT ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type, ad_group_criterion.status
        FROM ad_group_criterion WHERE campaign.id = ${id} AND ad_group_criterion.type = 'KEYWORD'`),
  ]);
  if (!rCamp.ok) return { ok: false, codigo: rCamp.error.codigo, mensaje: rCamp.error.mensaje };
  const c = filas(rCamp)[0];
  if (!c) return { ok: false, codigo: "NO_EXISTE", mensaje: "Google Ads no tiene esa campaña (¿fue eliminada?)." };
  const camp = c.campaign as Record<string, unknown>;
  const bud = (c.campaignBudget ?? {}) as Record<string, unknown>;
  const cli = (filas(rCli)[0]?.customer ?? {}) as Record<string, unknown>;
  const textos = (xs: unknown) => (Array.isArray(xs) ? (xs as Record<string, unknown>[]).map((h) => String(h.text ?? "")) : []);

  return {
    ok: true,
    datos: {
      cuentaId: s.datos.cuentaId,
      cuentaDePrueba: cli.testAccount === true,
      campana: {
        id: String(camp.id),
        nombre: String(camp.name ?? ""),
        estado: String(camp.status ?? ""),
        tipo: String(camp.advertisingChannelType ?? ""),
        presupuestoMicros: bud.amountMicros != null ? Number(bud.amountMicros) : null,
        budgetId: bud.id != null ? String(bud.id) : null,
      },
      grupos: filas(rGrupos).map((f) => {
        const g = f.adGroup as Record<string, unknown>;
        return { id: String(g.id), nombre: String(g.name ?? ""), estado: String(g.status ?? "") };
      }),
      anuncios: filas(rAds).map((f) => {
        const aga = f.adGroupAd as Record<string, unknown>;
        const ad = (aga.ad ?? {}) as Record<string, unknown>;
        const rsa = (ad.responsiveSearchAd ?? {}) as Record<string, unknown>;
        const urls = Array.isArray(ad.finalUrls) ? (ad.finalUrls as string[]) : [];
        return {
          id: String(ad.id),
          grupoId: String((f.adGroup as Record<string, unknown>)?.id ?? ""),
          estado: String(aga.status ?? ""),
          titulares: textos(rsa.headlines),
          descripciones: textos(rsa.descriptions),
          urlFinal: urls[0] ?? null,
        };
      }),
      palabras: filas(rKw).map((f) => {
        const k = f.adGroupCriterion as Record<string, unknown>;
        const kw = (k.keyword ?? {}) as Record<string, unknown>;
        return {
          id: String(k.criterionId),
          grupoId: String((f.adGroup as Record<string, unknown>)?.id ?? ""),
          texto: String(kw.text ?? ""),
          concordancia: String(kw.matchType ?? ""),
          estado: String(k.status ?? ""),
        };
      }),
    },
  };
}

/**
 * Pausa (siempre permitido) o reactiva (sólo en cuentas de PRUEBA) una campaña
 * creada por Respondo. Decide sobre el dato de Google (`customer.test_account`),
 * no sobre una bandera nuestra.
 */
export async function cambiarEstadoCampanaGoogle(
  clienteId: string,
  campaignId: string,
  estado: "PAUSED" | "ENABLED",
): Promise<Res<{ campaignId: string; estado: string }>> {
  const est = await leerEstructuraCampanaGoogle(clienteId, campaignId);
  if (!est.ok) return est;
  if (estado === "ENABLED" && !est.datos.cuentaDePrueba) {
    return {
      ok: false,
      codigo: "ACTIVAR_SOLO_EN_GOOGLE",
      mensaje: "Respondo no activa campañas en cuentas reales: activarla (y empezar a gastar) se hace en Google Ads.",
    };
  }
  const s = await sesion(clienteId);
  if (!s.ok) return { ok: false, codigo: s.error.codigo, mensaje: s.error.mensaje };
  const id = est.datos.campana.id;
  const headers: Record<string, string> = { Authorization: `Bearer ${s.datos.token}`, "Content-Type": "application/json" };
  if (s.datos.login) headers["login-customer-id"] = s.datos.login;
  const dev = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (dev) headers["developer-token"] = dev;
  try {
    const r = await fetch(`https://googleads.googleapis.com/v25/customers/${s.datos.cuentaId}/campaigns:mutate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operations: [{ update: { resourceName: `customers/${s.datos.cuentaId}/campaigns/${id}`, status: estado }, updateMask: "status" }],
      }),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || j.error) {
      const { traducirErrorGoogleMutate } = await import("@/lib/ads/googlePublicar");
      const f = traducirErrorGoogleMutate(r.status, j);
      return { ok: false, codigo: f.codigo, mensaje: f.mensaje };
    }
    return { ok: true, datos: { campaignId: id, estado } };
  } catch (e) {
    return { ok: false, codigo: "RED", mensaje: `No se pudo hablar con Google Ads: ${sanitizarMensajeError(e).slice(0, 120)}` };
  }
}
