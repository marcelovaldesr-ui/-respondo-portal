import { cargarPauta, personasDeAnuncios, type PersonaAtribuida } from "@/lib/ads/atribucion";
import { estadoDePauta } from "@/lib/ads/estado";
import { hallazgos } from "@/lib/ads/insights";
import { proveedorMeta } from "@/lib/ads/meta";
import { armarMetricas, type DatosPlataforma } from "@/lib/ads/metricas";
import { diaChile, diasEntre, sumarDias, type Rango } from "@/lib/ads/periodos";
import type { RendimientoAnuncio } from "@/lib/ads/proveedor";
import { listarBorradores } from "@/lib/marketing/campanas";
import { listarCreatividades } from "@/lib/marketing/creatividades";
import { capacidadesDe } from "@/lib/marketing/capacidades";
import { armarEmbudo, panoramaDemo } from "@/lib/marketing/demo";
import type {
  Creatividad,
  FilaAnuncio,
  FilaCampana,
  Lead,
  Panorama,
  PuntoDiario,
} from "@/lib/marketing/tipos";

/**
 * LA CARGA REAL DEL CENTRO DE MARKETING.
 *
 * Compone lo que ya existía —la atribución de `lib/ads`, el adaptador de
 * Meta, el checklist— y lo que es nuevo —creatividades y borradores— en un
 * solo `Panorama`. Las pantallas reciben esta forma y nada más.
 *
 * CÓMO SE ARMAN LAS CAMPAÑAS SIN TOCAR LA BASE
 * Meta no nos manda el id de campaña en el `referral`: manda el id del
 * ANUNCIO. Con la cuenta conectada, `rendimiento()` trae cada anuncio con su
 * campaña y ahí se cruza. Sin conexión, cada anuncio es su propia fila
 * (origen «atribucion») y la pantalla lo dice: no se inventa una jerarquía
 * que no podemos ver.
 *
 * LEADS: una fila por conversación atribuida, con la etapa REAL del embudo
 * (la que el negocio mueve con la mano si quiere). «Calificado» = avanzó a
 * interesado o más, o cotizó, reservó o compró. Definición única, usada
 * igual en el embudo, las campañas y la lista de leads.
 */

export async function cargarMarketing(
  clienteId: string,
  rango: Rango,
  opciones?: { demo?: boolean },
): Promise<Panorama> {
  if (opciones?.demo) return panoramaDemo(rango);

  const largo = diasEntre(rango.desde, rango.hasta);
  const anterior: Rango = {
    ...rango,
    desde: sumarDias(rango.desde, -largo),
    hasta: sumarDias(rango.desde, -1),
  };

  /**
   * Todo en paralelo y cada integración aparte: si Meta se cae, las cifras
   * propias, los leads y las creatividades aparecen igual.
   */
  const [pauta, personas, estado, rendimiento, rendimientoAntes, creatividades, borradores, capacidades] =
    await Promise.all([
      cargarPauta(clienteId, rango),
      personasDeAnuncios(clienteId, rango),
      estadoDePauta(clienteId),
      proveedorMeta.rendimiento(clienteId, rango, { porDia: true }),
      proveedorMeta.rendimiento(clienteId, anterior),
      listarCreatividades(clienteId),
      listarBorradores(clienteId),
      capacidadesDe(clienteId),
    ]);

  /**
   * «Hay cifras de publicidad» y «la cuenta está conectada» son dos cosas. Un
   * 429 de Meta no significa que el dueño no haya conectado nada, y decirle
   * «conecta tu cuenta» cuando ya la tiene conectada es el tipo de mentira
   * pequeña que hace que deje de creerle a la pantalla entera.
   */
  const metaConectada = rendimiento.ok;
  const errorPublicidad = rendimiento.ok ? null : rendimiento.error.codigo;
  if (!rendimiento.ok) {
    /**
     * Diagnosticable sin pedirle una captura a nadie: qué negocio, qué
     * operación, qué código nuestro y el detalle del proveedor acotado. NUNCA
     * el token ni datos de personas.
     */
    console.error(
      JSON.stringify({
        evento: "marketing.falla",
        proveedor: "meta",
        operacion: "rendimiento",
        cliente: clienteId,
        clase: rendimiento.error.codigo,
        detalle: (rendimiento.error.detalle ?? "").slice(0, 300),
      }),
    );
  }
  const filasMeta: RendimientoAnuncio[] = rendimiento.ok ? rendimiento.datos : [];
  const moneda = filasMeta[0]?.gasto.moneda ?? "CLP";

  /* ── Meta por anuncio y por día ─────────────────────────────────────────── */
  const metaPorAnuncio = new Map<
    string,
    { gasto: number; impresiones: number; clics: number; campanaId: string; campanaNombre: string; nombre: string }
  >();
  const metaPorDia = new Map<string, { gasto: number; impresiones: number; clics: number }>();
  for (const f of filasMeta) {
    const a = metaPorAnuncio.get(f.anuncioId) ?? {
      gasto: 0,
      impresiones: 0,
      clics: 0,
      campanaId: f.campanaId,
      campanaNombre: f.campanaNombre,
      nombre: f.anuncioNombre,
    };
    a.gasto += f.gasto.valor;
    a.impresiones += f.impresiones;
    a.clics += f.clics;
    metaPorAnuncio.set(f.anuncioId, a);
    if (f.dia) {
      const d = metaPorDia.get(f.dia) ?? { gasto: 0, impresiones: 0, clics: 0 };
      d.gasto += f.gasto.valor;
      d.impresiones += f.impresiones;
      d.clics += f.clics;
      metaPorDia.set(f.dia, d);
    }
  }
  const totalMeta = [...metaPorAnuncio.values()].reduce(
    (acc, a) => ({ gasto: acc.gasto + a.gasto, impresiones: acc.impresiones + a.impresiones, clics: acc.clics + a.clics }),
    { gasto: 0, impresiones: 0, clics: 0 },
  );
  const totalMetaAntes = rendimientoAntes.ok
    ? rendimientoAntes.datos.reduce(
        (acc, f) => ({ gasto: acc.gasto + f.gasto.valor, impresiones: acc.impresiones + f.impresiones, clics: acc.clics + f.clics }),
        { gasto: 0, impresiones: 0, clics: 0 },
      )
    : null;

  /* ── Leads ──────────────────────────────────────────────────────────────── */
  /**
   * Una fila por CONVERSACIÓN, no por contacto. La atribución ya deduplica por
   * chat al armar el embudo; acá no lo hacía, así que un contacto duplicado en
   * la base hacía que «Llegaron por un anuncio» superara al escalón
   * «Conversaciones» de la misma pantalla.
   */
  const vistos = new Set<string>();
  const leads: Lead[] = [];
  for (const persona of personas) {
    if (vistos.has(persona.chatId)) continue;
    vistos.add(persona.chatId);
    leads.push(aLead(persona, metaPorAnuncio));
  }

  /* ── Anuncios (desde nuestros datos, enriquecidos con Meta) ─────────────── */
  const anuncios: FilaAnuncio[] = pauta.filas.map((f) => {
    const m = f.anuncioId ? metaPorAnuncio.get(f.anuncioId) : undefined;
    const deEste = leads.filter((l) => l.anuncioId === f.clave);
    return {
      id: f.clave,
      campanaId: m?.campanaId ?? f.clave,
      campanaNombre: m?.campanaNombre ?? f.titular,
      titular: f.titular,
      cuerpo: "",
      url: f.url,
      imagenUrl: null,
      gasto: m ? m.gasto : null,
      impresiones: m ? m.impresiones : null,
      clics: m ? m.clics : null,
      conversaciones: f.conversaciones,
      calificados: deEste.filter((l) => l.calificado).length,
      cotizaciones: f.cotizaciones,
      agendadas: f.agendadas,
      avanzados: f.avanzados,
      ventas: f.ventas,
      cobrado: f.pagado,
      conClid: f.conClid,
    };
  });

  /* ── Campañas ───────────────────────────────────────────────────────────── */
  const porCampana = new Map<string, FilaCampana>();
  for (const a of anuncios) {
    const c = porCampana.get(a.campanaId) ?? {
      id: a.campanaId,
      nombre: a.campanaNombre,
      origen: metaPorAnuncio.has(a.id) ? ("meta" as const) : ("atribucion" as const),
      estado: "activa" as const,
      objetivo: null,
      gasto: metaPorAnuncio.has(a.id) ? 0 : null,
      moneda,
      impresiones: metaPorAnuncio.has(a.id) ? 0 : null,
      clics: metaPorAnuncio.has(a.id) ? 0 : null,
      conversaciones: 0,
      calificados: 0,
      avanzados: 0,
      ventas: 0,
      cobrado: 0,
      costoPorConversacion: null,
      costoPorVenta: null,
      roas: null,
      anuncios: 0,
      desde: null,
      hasta: null,
    };
    if (a.gasto !== null) c.gasto = (c.gasto ?? 0) + a.gasto;
    if (a.impresiones !== null) c.impresiones = (c.impresiones ?? 0) + a.impresiones;
    if (a.clics !== null) c.clics = (c.clics ?? 0) + a.clics;
    c.conversaciones += a.conversaciones;
    c.calificados += a.calificados;
    // Personas, no eventos: quien cotizó Y agendó vale uno, no dos.
    c.avanzados += a.avanzados;
    c.ventas += a.ventas;
    c.cobrado += a.cobrado;
    c.anuncios += 1;
    porCampana.set(a.campanaId, c);
  }
  // Campañas que Meta reporta con gasto pero que no trajeron a nadie por
  // WhatsApp todavía: existen y cuestan plata, así que se muestran.
  for (const [anuncioId, m] of metaPorAnuncio) {
    if (anuncios.some((a) => a.id === anuncioId)) continue;
    const c = porCampana.get(m.campanaId) ?? {
      id: m.campanaId,
      nombre: m.campanaNombre,
      origen: "meta" as const,
      estado: "activa" as const,
      objetivo: null,
      gasto: 0,
      moneda,
      impresiones: 0,
      clics: 0,
      conversaciones: 0,
      calificados: 0,
      avanzados: 0,
      ventas: 0,
      cobrado: 0,
      costoPorConversacion: null,
      costoPorVenta: null,
      roas: null,
      anuncios: 0,
      desde: null,
      hasta: null,
    };
    c.gasto = (c.gasto ?? 0) + m.gasto;
    c.impresiones = (c.impresiones ?? 0) + m.impresiones;
    c.clics = (c.clics ?? 0) + m.clics;
    porCampana.set(m.campanaId, c);
  }
  /**
   * El retorno solo se calcula si lo cobrado y lo gastado están en la MISMA
   * moneda. `lib/ads/metricas.ts` ya se negaba a hacerlo para el total del
   * período, pero acá se dividía igual: con la cuenta publicitaria en dólares y
   * los cobros en pesos, la columna ROAS mostraba un número inventado —y peor,
   * uno enorme— junto a un KPI que decía «—».
   */
  const mismaMoneda = moneda === "CLP";
  const campanas = [...porCampana.values()].map((c) => ({
    ...c,
    costoPorConversacion: c.gasto !== null && c.conversaciones ? c.gasto / c.conversaciones : null,
    costoPorVenta: c.gasto !== null && c.ventas ? c.gasto / c.ventas : null,
    roas: c.gasto && mismaMoneda ? c.cobrado / c.gasto : null,
  }));
  for (const b of borradores.items) {
    campanas.push({
      id: b.id,
      nombre: b.nombre,
      origen: "borrador",
      estado: b.estado,
      objetivo: b.objetivo,
      gasto: null,
      moneda: b.moneda,
      impresiones: null,
      clics: null,
      conversaciones: 0,
      calificados: 0,
      avanzados: 0,
      ventas: 0,
      cobrado: 0,
      costoPorConversacion: null,
      costoPorVenta: null,
      roas: null,
      anuncios: b.creatividadIds.length,
      desde: null,
      hasta: null,
    });
  }

  /* ── Serie diaria ───────────────────────────────────────────────────────── */
  const serie: PuntoDiario[] = [];
  const porDia = new Map<string, PuntoDiario>();
  for (let i = 0; i < largo; i++) {
    const dia = sumarDias(rango.desde, i);
    const m = metaPorDia.get(dia);
    const p: PuntoDiario = {
      dia,
      gasto: metaConectada ? (m?.gasto ?? 0) : null,
      impresiones: metaConectada ? (m?.impresiones ?? 0) : null,
      clics: metaConectada ? (m?.clics ?? 0) : null,
      conversaciones: 0,
      calificados: 0,
      ventas: 0,
      cobrado: 0,
    };
    serie.push(p);
    porDia.set(dia, p);
  }
  for (const l of leads) {
    const d = porDia.get(diaDe(l.llegoEn));
    if (d) {
      d.conversaciones += 1;
      if (l.calificado) d.calificados += 1;
    }
    if (l.compro) {
      const persona = personas.find((p) => p.chatId === l.chatId);
      const dv = porDia.get(diaDe(persona?.compradoEn ?? l.llegoEn)) ?? d;
      if (dv) {
        dv.ventas += 1;
        dv.cobrado += l.cobrado;
      }
    }
  }

  /* ── Métricas, embudo, hallazgos ────────────────────────────────────────── */
  const plataforma: DatosPlataforma = metaConectada
    ? { impresiones: totalMeta.impresiones, clics: totalMeta.clics, gasto: { valor: totalMeta.gasto, moneda } }
    : null;
  const plataformaAntes: DatosPlataforma =
    metaConectada && totalMetaAntes
      ? { impresiones: totalMetaAntes.impresiones, clics: totalMetaAntes.clics, gasto: { valor: totalMetaAntes.gasto, moneda } }
      : null;

  const metricas = armarMetricas({
    plataforma,
    propios: pauta.propios,
    anteriores: pauta.propiosAntes ? { plataforma: plataformaAntes, propios: pauta.propiosAntes } : null,
  });

  const calificados = leads.filter((l) => l.calificado).length;
  const embudo = armarEmbudo({
    impresiones: metaConectada ? totalMeta.impresiones : null,
    clics: metaConectada ? totalMeta.clics : null,
    conversaciones: pauta.propios.conversaciones,
    calificados,
    avanzados: pauta.propios.avanzados,
    ventas: pauta.propios.ventas,
  });

  const senales = hallazgos({
    filas: pauta.filas,
    resumen: pauta.resumen,
    propios: pauta.propios,
    propiosAntes: pauta.propiosAntes,
    periodo: rango.etiqueta.toLowerCase(),
  });

  // Creatividades: se cruzan con el rendimiento por meta_ad_id cuando exista.
  const creas: Creatividad[] = creatividades.items;

  return {
    rango,
    demo: false,
    monedaNegocio: "CLP",
    capacidades: { ...capacidades, puedeGuardar: creatividades.disponible && borradores.disponible },
    metaConectada,
    errorPublicidad,
    metricas,
    serie,
    embudo,
    campanas: campanas.sort((a, b) => b.cobrado - a.cobrado || b.conversaciones - a.conversaciones || (b.gasto ?? 0) - (a.gasto ?? 0)),
    anuncios: anuncios.sort((a, b) => b.cobrado - a.cobrado || b.conversaciones - a.conversaciones),
    leads,
    creatividades: creas,
    borradores: borradores.items,
    hallazgos: senales,
    estado: {
      items: estado.items,
      listos: estado.listos,
      total: estado.total,
      hayAtribucion: estado.hayAtribucion,
    },
    sinAnuncio: pauta.sinAnuncio,
    almacenListo: creatividades.disponible && borradores.disponible,
  };
}

function diaDe(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : diaChile(d);
}

function aLead(
  p: PersonaAtribuida,
  meta: Map<string, { campanaId: string; campanaNombre: string }>,
): Lead {
  const m = meta.get(p.anuncioId);
  const etapa = (["nuevo", "interesado", "cotizado", "ganado", "perdido"].includes(p.etapa)
    ? p.etapa
    : "nuevo") as Lead["etapa"];
  const calificado =
    etapa === "interesado" || etapa === "cotizado" || etapa === "ganado" || p.cotizo || p.agendo || p.compro;
  return {
    chatId: p.chatId,
    nombre: p.nombre,
    telefono: p.telefono,
    origen: /instagram/i.test(p.anuncio) ? "instagram" : "meta",
    campanaId: m?.campanaId ?? p.anuncioId,
    campanaNombre: m?.campanaNombre ?? p.anuncio,
    anuncioId: p.anuncioId,
    anuncioTitular: p.anuncio,
    llegoEn: p.desde,
    /**
     * Quien pagó compró, punto. Antes se respetaba la etapa «perdido» aunque
     * hubiera un cobro pagado, y la misma fila salía en «Compraron» y en
     * «Perdidos» con dos estados contradictorios a 300 px de distancia.
     */
    etapa: p.compro ? "ganado" : etapa,
    calificado,
    cotizo: p.cotizo,
    agendo: p.agendo,
    compro: p.compro,
    cobrado: p.pagado,
    ultimoMensaje: p.ultimoMensaje,
    conClid: p.conClid,
  };
}
