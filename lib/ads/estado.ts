import { db } from "@/lib/db";
import { conexionDe, metaAdsConfigurado } from "@/lib/ads/meta";

/**
 * EN QUÉ PIE ESTÁ PAUTA PARA ESTE NEGOCIO.
 *
 * Esto NO es una pantalla de configuración disfrazada de checklist: es la
 * respuesta a la pregunta que se hace cualquiera que entra por primera vez y ve
 * poco —«¿está roto o todavía no lo configuré?»—. Cada ítem dice qué falta, por
 * qué importa y cómo se resuelve.
 *
 * ⭐ EL ORDEN NO ES CASUAL, ES LA TESIS DEL PRODUCTO.
 * Los dos primeros ítems no dependen de ninguna integración: **la atribución
 * funciona sola**, desde el primer día, sin conectar nada. Conectar la cuenta
 * publicitaria agrega el costo, y el dataset permite devolverle las ventas a
 * Meta. Si el checklist empezara por «conectá Meta», el dueño creería que sin
 * eso no hay nada que ver — y hay bastante.
 *
 * Se reutiliza el vocabulario de estados de `lib/conexion.ts` (la puesta en
 * marcha de WhatsApp) a propósito: es la misma idea, el mismo componente y la
 * misma forma de leerse. Pauta no estrena un sistema paralelo.
 */

export type EstadoItem = "ok" | "falta" | "atencion" | "manual";

export type ItemPauta = {
  titulo: string;
  estado: EstadoItem;
  detalle: string;
  /** Qué hacer, cuando hay algo que hacer. */
  accion?: { texto: string; href: string };
};

export type EstadoPauta = {
  items: ItemPauta[];
  /** ¿Se puede mostrar algo útil ya? */
  hayAtribucion: boolean;
  /** ¿Podemos poner el costo al lado de los resultados? */
  hayCosto: boolean;
  /** ¿Podemos devolverle las ventas a Meta? */
  puedeDevolverEventos: boolean;
  /** Cuántos de los pasos están listos, para la barra de avance. */
  listos: number;
  total: number;
};

export async function estadoDePauta(clienteId: string): Promise<EstadoPauta> {
  const supa = db();
  const items: ItemPauta[] = [];

  /* ── 1. ¿Llega gente desde anuncios? ────────────────────────────────────── */
  let conversacionesDesdeAnuncios = 0;
  let conClid = 0;
  try {
    const { count } = await supa
      .from("ed_contactos")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .not("datos->campana", "is", null);
    conversacionesDesdeAnuncios = count ?? 0;

    const { count: clids } = await supa
      .from("ed_contactos")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .not("datos->campana->>ctwaClid", "is", null);
    conClid = clids ?? 0;
  } catch {
    // Sin la 282 la columna no existe: se trata como que no hay nada aún.
  }

  items.push(
    conversacionesDesdeAnuncios > 0
      ? {
          titulo: "Anuncios que llevan a WhatsApp",
          estado: "ok",
          detalle: `${conversacionesDesdeAnuncios} conversaciones entraron desde un anuncio. Esto no hubo que configurarlo: llega solo.`,
        }
      : {
          titulo: "Anuncios que llevan a WhatsApp",
          estado: "falta",
          detalle:
            "Todavía no entró nadie desde un anuncio. Si ya estás pauteando, revisa que los avisos lleven a WhatsApp y no a un formulario o al perfil: es lo único que hace falta para que esta sección se llene sola.",
        },
  );

  /* ── 2. El identificador del clic ────────────────────────────────────────── */
  items.push(
    conClid > 0
      ? {
          titulo: "Identificador del clic",
          estado: "ok",
          detalle: `${conClid} de ${conversacionesDesdeAnuncios} conversaciones lo traen. Son las que se le pueden devolver a Meta como venta.`,
        }
      : conversacionesDesdeAnuncios > 0
        ? {
            titulo: "Identificador del clic",
            estado: "atencion",
            detalle:
              "Las conversaciones que ya estaban guardadas no lo tienen: Meta lo manda solo en el primer mensaje y antes lo descartábamos. Las nuevas sí lo van a traer.",
          }
        : {
            titulo: "Identificador del clic",
            estado: "falta",
            detalle: "Va a aparecer con la primera conversación que entre por un anuncio.",
          },
  );

  /* ── 3. La cuenta publicitaria ───────────────────────────────────────────── */
  const conexion = await conexionDe(clienteId);
  if (!metaAdsConfigurado()) {
    items.push({
      titulo: "Cuenta publicitaria de Meta",
      estado: "manual",
      detalle:
        "La conexión con Meta todavía no está habilitada en esta instalación de Respondo. Sin ella igual ves de dónde viene cada venta; lo que falta es cuánto costó.",
    });
  } else if (conexion && conexion.estado === "conectada") {
    items.push({
      titulo: "Cuenta publicitaria de Meta",
      estado: "ok",
      /**
       * ⚠️ Acá decía «· sin sincronizar todavía» cuando `ultima_sync` venía
       * nula, y NADA escribe esa columna: la etiqueta iba a quedar puesta para
       * siempre, avisando de un problema inexistente. Un aviso permanentemente
       * falso enseña a ignorar los avisos de verdad. La columna se deja en la
       * tabla para cuando exista una sincronización real que la escriba; la
       * prueba de que la conexión lee se muestra en la pantalla de Conexión,
       * consultando a Meta en vivo.
       */
      detalle: `${conexion.cuentaNombre} · factura en ${conexion.moneda}`,
      accion: { texto: "Ver la conexión", href: "/marketing/integraciones" },
    });
  } else if (conexion && conexion.estado === "token_vencido") {
    items.push({
      titulo: "Cuenta publicitaria de Meta",
      estado: "atencion",
      detalle: "El permiso venció. Mientras tanto se ven los resultados, pero no el gasto.",
      accion: { texto: "Reconectar", href: "/marketing/integraciones" },
    });
  } else {
    items.push({
      titulo: "Cuenta publicitaria de Meta",
      estado: "falta",
      detalle:
        "Conectarla agrega el costo al lado de los resultados: cuánto se invirtió, cuánto costó cada conversación y cada venta.",
      accion: { texto: "Conectar Meta", href: "/marketing/integraciones" },
    });
  }

  /* ── 4 y 5. Lo que se lee del cliente ─────────────────────────────────────
     Las tres columnas van en UNA consulta y no en dos: son la misma fila, y
     esta función corre en cada carga del Resumen. */
  let dataset: string | null = null;
  let wabaId: string | null = null;
  let cobraPorEnlace = false;

  const texto = (v: unknown): string | null => (String(v ?? "").trim() || null);

  /**
   * ⚠️ PostgREST NO lanza: devuelve `{ data: null, error }`. Si la migración 302
   * todavía no está aplicada, `ads_dataset_id` no existe y **el select entero**
   * falla — no solo esa columna. Por eso hay un segundo intento sin ella: sin
   * el reintento, un checklist recién instalado mostraría también WhatsApp y el
   * enlace de pago como pendientes, que es justo la información que alguien
   * necesita en ese momento. Se mira `error`, no un catch, porque no hay
   * excepción que atrapar.
   */
  const conDataset = await supa
    .from("ed_clientes")
    .select("ads_dataset_id, waba_id, pago_link_base")
    .eq("id", clienteId)
    .maybeSingle();

  if (!conDataset.error && conDataset.data) {
    const d = conDataset.data as Record<string, unknown>;
    dataset = texto(d.ads_dataset_id);
    wabaId = texto(d.waba_id);
    cobraPorEnlace = Boolean(texto(d.pago_link_base));
  } else {
    const sinDataset = await supa
      .from("ed_clientes")
      .select("waba_id, pago_link_base")
      .eq("id", clienteId)
      .maybeSingle();
    if (!sinDataset.error && sinDataset.data) {
      const d = sinDataset.data as Record<string, unknown>;
      wabaId = texto(d.waba_id);
      cobraPorEnlace = Boolean(texto(d.pago_link_base));
    }
  }

  items.push(
    dataset && wabaId
      ? {
          titulo: "Devolverle las ventas a Meta",
          estado: "ok",
          detalle:
            "Cuando una conversación termina en venta, se lo avisamos a Meta. Así aprende a buscar compradores y no curiosos.",
        }
      : !wabaId
        ? {
            titulo: "Devolverle las ventas a Meta",
            estado: "falta",
            detalle: "Primero hay que tener WhatsApp conectado: la venta ocurre ahí.",
            accion: { texto: "Conectar WhatsApp", href: "/whatsapp" },
          }
        : {
            titulo: "Devolverle las ventas a Meta",
            estado: "falta",
            detalle:
              "Es lo que hace que Meta reparta tu presupuesto hacia los avisos que traen compradores, en vez de hacia los que traen conversaciones.",
            accion: { texto: "Configurar", href: "/marketing/integraciones" },
          },
  );

  /* ── 5. Poder medir la plata ─────────────────────────────────────────────── */
  items.push(
    cobraPorEnlace
      ? {
          titulo: "Cobro por enlace de pago",
          estado: "ok",
          detalle:
            "Lo que se paga por el enlace queda atribuido al anuncio que trajo a esa persona. Una transferencia directa no la vemos.",
        }
      : {
          titulo: "Cobro por enlace de pago",
          estado: "atencion",
          detalle:
            "Sin esto se ve cuántas ventas trajo cada anuncio, pero no cuánta plata. Es lo que convierte «14 ventas» en «$890.000».",
          accion: { texto: "Configurarlo", href: "/informacion" },
        },
  );

  const listos = items.filter((i) => i.estado === "ok").length;

  return {
    items,
    hayAtribucion: conversacionesDesdeAnuncios > 0,
    hayCosto: Boolean(conexion && conexion.estado === "conectada"),
    puedeDevolverEventos: Boolean(dataset && wabaId),
    listos,
    total: items.length,
  };
}
