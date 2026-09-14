"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { opcionesDemo } from "@/lib/marketing/modo";
import { cupoDisponible } from "@/lib/marketing/cupo";
import { capacidadesDe, capacidadesDemo } from "@/lib/marketing/capacidades";
import { senalesDeNegocio } from "@/lib/marketing/senalesNegocio";
import { senalesVacias } from "@/lib/ads/senales";
import { disenarCampana, nombreSugerido, type ResultadoArquitecto } from "@/lib/marketing/arquitecto";
import { planEnTexto, type Destino, type PlanCampana } from "@/lib/marketing/arquitectoCore";
import { guardarBorrador } from "@/lib/marketing/campanas";
import { modificarEn } from "@/lib/marketing/tenant";
import { traducirFalla } from "@/lib/marketing/fallas";
import type { EstadoCampana } from "@/lib/marketing/tipos";

/**
 * ACCIONES DEL ARQUITECTO DE CAMPAÑAS.
 *
 * ⚠️ REGLA DE AISLAMIENTO: el `clienteId` sale de la sesión, nunca del
 * formulario, y las señales se leen del negocio de esa sesión. Un plan es
 * contenido generado con el contexto comercial del cliente: pedirlo con el id
 * de otro sería filtrar su ficha, sus precios y su forma de vender.
 */
const DEMO_BLOQUEADO =
  "Estás en datos de demostración: el plan se arma y se puede leer, pero no se guarda. Apaga la demo para guardarlo de verdad.";

export async function disenarCampanaAccion(entrada: {
  objetivo: string;
  presupuestoMensual: number | null;
  destino: Destino | null;
}): Promise<ResultadoArquitecto> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };

  // El mismo tope de uso que el estudio creativo: un plan es una llamada al
  // modelo y nadie debería poder gastar el cupo del negocio en un bucle.
  const topado = await cupoDisponible(usuario.clienteId, "texto");
  if (topado) return { ok: false, motivo: topado };

  const { demo, variante } = await opcionesDemo();
  const capacidades = demo ? capacidadesDemo(variante) : await capacidadesDe(usuario.clienteId);
  const senales = demo
    ? { ...senalesVacias(), ads: true, conversiones: true, conversaciones: variante === "completo", ingresos: variante === "completo" }
    : await senalesDeNegocio(usuario.clienteId);

  return disenarCampana({
    objetivo: entrada.objetivo,
    presupuestoMensual: entrada.presupuestoMensual,
    clienteId: usuario.clienteId,
    demo,
    senales,
    canalesConectados: capacidades.canales.filter((c) => c.conectado).map((c) => c.proveedor),
    tieneWhatsapp: capacidades.whatsappConectado,
    moneda: capacidades.monedaPublicidad ?? "CLP",
    destino: entrada.destino,
    sitio: null,
  });
}

/**
 * Guarda el plan como borrador de campaña.
 *
 * ⭐ NO se crea un sistema paralelo: el plan se guarda en `ed_mk_campanas`, la
 * MISMA tabla del asistente, y queda abierto en el mismo editor. El Arquitecto
 * PIENSA la campaña; el asistente la EDITA. Dos pantallas, un solo objeto.
 *
 * El plan completo va a la columna `plan` (jsonb). Si la migración 309 no está
 * aplicada, el borrador se guarda igual con los campos planos y se avisa: es
 * preferible perder el detalle del plan que perder el trabajo entero.
 */
export async function guardarPlanAccion(
  plan: PlanCampana,
): Promise<{ ok: true; id: string; estado: EstadoCampana; planGuardado: boolean } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemoActivo()) return { ok: false, motivo: DEMO_BLOQUEADO };

  const cap = await capacidadesDe(usuario.clienteId);
  const principal = plan.campanas[0];

  const r = await guardarBorrador(
    usuario.clienteId,
    {
      nombre: nombreSugerido(plan),
      objetivo: principal?.objetivo ?? "conversaciones",
      oferta: plan.angulos[0]?.gancho ?? plan.objetivoNegocio,
      audiencia: {
        ubicacion: principal?.conjuntos[0]?.ubicacion ?? "",
        edadDesde: principal?.conjuntos[0]?.edadDesde ?? null,
        edadHasta: principal?.conjuntos[0]?.edadHasta ?? null,
        intereses: principal?.conjuntos[0]?.intereses ?? [],
        nota: principal?.conjuntos[0]?.nota ?? "",
      },
      presupuestoDiario: principal?.presupuestoDiario ?? null,
      presupuestoTotal: plan.presupuestoMensual,
      moneda: plan.moneda,
      destino: "whatsapp",
      creatividadIds: [],
      copies: plan.angulos.slice(0, 3).map((a) => ({ titular: a.titular, texto: a.texto, cta: a.cta })),
      notas: planEnTexto(plan),
    },
    { metaConectada: cap.metaConectada, puedePublicar: cap.puedePublicarEnMeta },
  );
  if (!r.ok) return r;

  /**
   * El plan completo, aparte. Va en un update propio y no en el insert para
   * que una instalación sin la 309 no pierda el borrador entero: acá lo único
   * que se pierde es el detalle estructurado, y la pantalla lo dice.
   */
  let planGuardado = false;
  try {
    /**
     * Por `tenant.ts` y no con `db()` a mano: es la capa que estampa el
     * `.eq("cliente_id")` y el `.select("id")` para que PostgREST no conteste
     * «guardado» cuando no escribió nada. El test estructural de la Fase 5
     * falla si alguna pantalla de Marketing la esquiva — y esta acción, recién
     * escrita, fue el primer archivo que atrapó.
     */
    const { error } = await modificarEn(usuario.clienteId, "ed_mk_campanas", r.id, {
      plan,
      canal: plan.campanas.length > 1 ? "ambos" : (plan.campanas[0]?.canal ?? "meta"),
      destino: principal?.destino ?? "whatsapp",
    });
    planGuardado = !error;
  } catch {
    planGuardado = false;
  }

  revalidatePath("/marketing", "layout");
  return { ok: true, id: r.id, estado: r.estado, planGuardado };
}

/** El texto del plan, para copiar y pegar en la plataforma. */
export async function planComoTextoAccion(plan: PlanCampana): Promise<string> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return "";
  return planEnTexto(plan);
}

async function modoDemoActivo(): Promise<boolean> {
  const { demo } = await opcionesDemo();
  return demo;
}

/** Se deja exportado para que el log de fallas quede en un solo lugar. */
export async function registrarFallaArquitecto(clienteId: string, crudo: unknown): Promise<string> {
  return traducirFalla({ proveedor: "ia", operacion: "arquitecto", clienteId, crudo });
}
