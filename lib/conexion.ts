import { db } from "@/lib/db";
import { tokenDeFila } from "@/lib/whatsapp";
import { plantillasParaRubro } from "@/lib/plantillas";

/**
 * PUESTA EN MARCHA: el checklist calculado desde el ESTADO REAL.
 *
 * POR QUÉ EXISTE (27-ago-2026)
 * ----------------------------
 * Cada paso de este checklist es una herida real de agosto:
 *
 *  - «cada cliente necesita SU portafolio» apareció recién al validar
 *    coexistencia (error #1690130);
 *  - el método de pago del WABA bloqueó a Beto y Vera DÍAS y no estaba anotado
 *    en ningún formulario;
 *  - las plantillas viven en el WABA de cada cliente y sin rubro no se sabe
 *    cuáles crear;
 *  - el rubro vacío deja al cliente solo con las plantillas universales.
 *
 * Un checklist en papel se desactualiza; este se calcula contra la base y
 * contra Meta cada vez que se mira. Es la diferencia entre «creo que quedó» y
 * «está verde».
 *
 * QUÉ NO COMPRUEBA, Y LO DICE
 * ---------------------------
 * El método de pago del portafolio NO se puede leer por la API con el token del
 * WABA. En vez de inventar un estado, el ítem queda «manual» con la instrucción
 * — un checklist que finge saber lo que no sabe es peor que uno incompleto.
 */

export type EstadoItem = "ok" | "falta" | "atencion" | "manual";

export type ItemConexion = {
  titulo: string;
  estado: EstadoItem;
  detalle: string;
  /** Qué hacer si no está ok. */
  accion?: string;
};

export type PlantillaEstado = {
  nombre: string;
  categoria: string;
  /** APPROVED | PENDING | REJECTED | NO_EXISTE */
  estado: string;
};

export type EstadoConexion = {
  items: ItemConexion[];
  /** Las plantillas que le corresponden al rubro, con su estado real en Meta. */
  plantillas: PlantillaEstado[];
  /** true si Meta no se pudo consultar (sin credenciales o sin red). */
  metaInaccesible: boolean;
};

const GRAPH = "https://graph.facebook.com/v21.0";

async function graph<T>(path: string, token: string): Promise<T | null> {
  try {
    const r = await fetch(`${GRAPH}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      // La página no puede quedarse pegada porque Meta ande lento.
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function estadoConexion(clienteId: string): Promise<EstadoConexion> {
  const supa = db();

  const [{ data: cli }, susc] = await Promise.all([
    supa
      .from("ed_clientes")
      .select(
        "nombre, rubro, transporte, waba_id, waba_phone_id, waba_token, waba_token_cifrado, pago_link_base",
      )
      .eq("id", clienteId)
      .maybeSingle(),
    supa
      .from("ed_push_suscripciones")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .then(
        (r) => r.count ?? 0,
        () => null, // migración 283 sin aplicar: no verificable, no rojo
      ),
  ]);

  const items: ItemConexion[] = [];
  const rubro = (cli?.rubro as string | null) ?? null;
  const wabaId = (cli?.waba_id as string | null) ?? null;
  const phoneId = (cli?.waba_phone_id as string | null) ?? null;
  const token = cli ? tokenDeFila(cli as Parameters<typeof tokenDeFila>[0]) : null;
  const conectado = Boolean(wabaId && phoneId && token);

  // ── 1 · Número conectado a la vía oficial ─────────────────────────────────
  items.push(
    conectado
      ? { titulo: "Número conectado (Cloud API)", estado: "ok", detalle: "Credenciales completas." }
      : {
          titulo: "Número conectado (Cloud API)",
          estado: "falta",
          detalle: "Faltan waba_id, phone_id o el token.",
          accion: "Conectar el número desde el panel de Meta (portafolio PROPIO del cliente, nunca el de Respondo — falla #1690130).",
        },
  );

  // ── 2 · Rubro ─────────────────────────────────────────────────────────────
  items.push(
    rubro
      ? { titulo: "Rubro del negocio", estado: "ok", detalle: `«${rubro}» — define plantillas y botones.` }
      : {
          titulo: "Rubro del negocio",
          estado: "falta",
          detalle: "Sin rubro solo aplican las plantillas universales.",
          accion: "update ed_clientes set rubro = '<rubro>' — vocabulario de lib/plantillas.ts.",
        },
  );

  // ── 3 · Plantillas del rubro contra Meta ──────────────────────────────────
  const debidas = plantillasParaRubro(rubro);
  let plantillas: PlantillaEstado[] = debidas.map((p) => ({
    nombre: p.nombre,
    categoria: p.categoria,
    estado: "NO_EXISTE",
  }));
  let metaInaccesible = true;

  if (conectado) {
    const rem = await graph<{ data?: { name: string; status: string }[] }>(
      `${wabaId}/message_templates?limit=100`,
      token!,
    );
    if (rem?.data) {
      metaInaccesible = false;
      const porNombre = new Map(rem.data.map((t) => [t.name, t.status]));
      plantillas = debidas.map((p) => ({
        nombre: p.nombre,
        categoria: p.categoria,
        estado: porNombre.get(p.nombre) ?? "NO_EXISTE",
      }));
    }
  }

  const aprobadas = plantillas.filter((p) => p.estado === "APPROVED").length;
  const rechazadas = plantillas.filter((p) => p.estado === "REJECTED").length;
  items.push(
    metaInaccesible
      ? {
          titulo: "Plantillas de mensajes",
          estado: conectado ? "atencion" : "falta",
          detalle: conectado
            ? "No se pudo consultar Meta ahora. Recarga en un momento."
            : "Requiere el número conectado.",
        }
      : rechazadas > 0
        ? {
            titulo: "Plantillas de mensajes",
            estado: "atencion",
            detalle: `${rechazadas} rechazada(s) por Meta — corregirlas en WhatsApp Manager.`,
          }
        : aprobadas === plantillas.length && plantillas.length > 0
          ? { titulo: "Plantillas de mensajes", estado: "ok", detalle: `Las ${aprobadas} del rubro están aprobadas.` }
          : {
              titulo: "Plantillas de mensajes",
              estado: "atencion",
              detalle: `${aprobadas}/${plantillas.length} aprobadas. Detalle abajo.`,
              accion: "Crear las que faltan: npx tsx scripts/crear_plantillas_meta.ts --cliente <nombre> --crear",
            },
  );

  // ── 4 · Método de pago del WABA (manual, y se dice) ───────────────────────
  items.push({
    titulo: "Método de pago en Meta",
    estado: "manual",
    detalle:
      "No se puede verificar por API. Sin tarjeta asociada AL WABA, ninguna plantilla sale aunque esté aprobada.",
    accion:
      "Business Manager → Facturación y pagos → agregar tarjeta → pestaña «Cuentas de WhatsApp Business» → asociarla al WABA. La prueba real: enviar una plantilla con la ventana cerrada.",
  });

  // ── 5 · Enlace de pago (cobros en conversación) ───────────────────────────
  items.push(
    cli?.pago_link_base
      ? { titulo: "Cobros por WhatsApp", estado: "ok", detalle: "Enlace de pago configurado: el botón Cobrar está activo." }
      : {
          titulo: "Cobros por WhatsApp",
          estado: "atencion",
          detalle: "Sin enlace de pago, el botón Cobrar está apagado. Es opcional.",
          accion: "Información → Cobros por WhatsApp → pegar el link de Mercado Pago/Flow/Getnet.",
        },
  );

  // ── 6 · Avisos al teléfono ────────────────────────────────────────────────
  items.push(
    susc === null
      ? { titulo: "Avisos al teléfono", estado: "atencion", detalle: "No verificable (falta la migración 283)." }
      : susc > 0
        ? { titulo: "Avisos al teléfono", estado: "ok", detalle: `${susc} dispositivo(s) recibiendo avisos.` }
        : {
            titulo: "Avisos al teléfono",
            estado: "atencion",
            detalle: "Nadie recibe avisos cuando un cliente necesita a una persona.",
            accion: "Inicio → Activar avisos. En iPhone hay que instalar el portal primero (Compartir → Agregar a inicio).",
          },
  );

  return { items, plantillas, metaInaccesible };
}
