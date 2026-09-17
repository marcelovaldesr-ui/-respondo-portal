import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { PLANES, type NombrePlan } from "@/lib/cupoConversaciones";

export type PlanCliente = NombrePlan;

export type DatosOnboarding = {
  nombre: string;
  rubro?: string;
  emailDueno: string;
  emailStaff?: string | string[];
  telefonoEscalacion: string | string[];
  slug?: string | null;
  moneda?: string;
  plan?: PlanCliente;
  cupoConversaciones?: number;
  conAgenda?: boolean;
  transporte?: "cloud" | "waha" | "ambos";
  pagoLinkBase?: string | null;
  pagoRefEtiqueta?: string | null;
  clienteId?: string;
};

export type CodigoErrorOnboarding =
  | "PARAMETRO_INVALIDO"
  | "EMAIL_INVALIDO"
  | "EMAIL_EN_USO"
  | "EMAIL_STAFF_INVALIDO"
  | "EMAIL_STAFF_EN_USO"
  | "STAFF_DUPLICADO"
  | "SLUG_INVALIDO"
  | "SLUG_EN_USO"
  | "CONFLICTO_IDEMPOTENCIA"
  | "CONFLICTO_CARRERA"
  | "ID_EN_USO"
  | "MONEDA_INVALIDA"
  | "PLAN_REQUERIDO"
  | "PLAN_INVALIDO"
  | "CUPO_INVALIDO"
  | "TRANSPORTE_INVALIDO"
  | "TELEFONO_INVALIDO"
  | "MIGRACION_NO_APLICADA"
  | "ERROR_BASE_DATOS";

export type ResultadoOnboarding =
  | {
      ok: true;
      idempotente: boolean;
      status: "CREADO" | "EXISTENTE_NO_MODIFICADO";
      clienteId: string;
      nombre: string;
      slug: string;
      emailDueno: string;
      transporte: string;
      moneda: string;
      plan: string;
      cupoConversaciones: number | null;
      agendaActiva: boolean;
      staffCount: number;
    }
  | {
      ok: false;
      error: string;
      codigo: CodigoErrorOnboarding;
    };

export type DatosNormalizadosOnboarding = {
  nombre: string;
  rubro: string;
  emailDueno: string;
  emailStaff: string[];
  telefonoEscalacion: string[];
  slug: string;
  moneda: string;
  plan: PlanCliente;
  cupoConversaciones: number | null;
  conAgenda: boolean;
  transporte: "cloud" | "waha" | "ambos";
  pagoLinkBase: string | null;
  pagoRefEtiqueta: string | null;
  clienteId?: string;
};

/**
 * Normaliza y genera un slug válido para el negocio a partir de su nombre.
 */
export function generarSlug(nombre: string): string {
  return nombre
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar tildes
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/**
 * Normaliza y valida teléfonos de escalación.
 */
export function normalizarEscalacion(
  tel: string | string[] | null | undefined,
): string[] {
  if (!tel) return [];
  const list = Array.isArray(tel) ? tel : [tel];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const limpio = item.trim();
    const soloDigitos = limpio.replace(/\D/g, "");
    if (soloDigitos.length >= 8) {
      out.push(limpio);
    }
  }
  return out;
}

/**
 * Valida los insumos de onboarding en tiempo de ejecución de manera pura (sin side effects).
 */
export function validarInsumosOnboarding(
  datos: DatosOnboarding,
): { ok: true; normalizado: DatosNormalizadosOnboarding } | { ok: false; error: string; codigo: CodigoErrorOnboarding } {
  // 1. Nombre
  const nombre = datos.nombre?.trim() ?? "";
  if (nombre.length < 2) {
    return {
      ok: false,
      error: "El nombre de la empresa debe tener al menos 2 caracteres.",
      codigo: "PARAMETRO_INVALIDO",
    };
  }

  // 2. Rubro
  const rubro = datos.rubro?.trim() || "general";

  // 3. Email Dueño
  const emailDueno = datos.emailDueno?.trim().toLowerCase() ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailDueno)) {
    return {
      ok: false,
      error: `El email de dueño no es válido: "${emailDueno}".`,
      codigo: "EMAIL_INVALIDO",
    };
  }

  // 4. Staff
  const staffRaw = Array.isArray(datos.emailStaff)
    ? datos.emailStaff
    : datos.emailStaff
      ? [datos.emailStaff]
      : [];
  const emailStaff: string[] = [];
  for (const s of staffRaw) {
    if (typeof s !== "string") continue;
    const limpio = s.trim().toLowerCase();
    if (!limpio) continue;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpio)) {
      return {
        ok: false,
        error: `El email de staff no es válido: "${limpio}".`,
        codigo: "EMAIL_STAFF_INVALIDO",
      };
    }
    if (limpio === emailDueno) {
      return {
        ok: false,
        error: `El email de staff "${limpio}" no puede ser el mismo del dueño.`,
        codigo: "STAFF_DUPLICADO",
      };
    }
    if (emailStaff.includes(limpio)) {
      return {
        ok: false,
        error: `El email de staff "${limpio}" está duplicado.`,
        codigo: "STAFF_DUPLICADO",
      };
    }
    emailStaff.push(limpio);
  }

  // 5. Slug
  const slug = (datos.slug?.trim().toLowerCase() || generarSlug(nombre));
  if (!/^[a-z0-9-]+$/.test(slug) || slug.length < 2) {
    return {
      ok: false,
      error: `El slug no es válido: "${slug}". Solo minúsculas, números y guiones.`,
      codigo: "SLUG_INVALIDO",
    };
  }

  // 6. Moneda (ISO-4217, 3 letras mayúsculas)
  const moneda = (datos.moneda?.trim().toUpperCase() || "CLP");
  if (!/^[A-Z]{3}$/.test(moneda)) {
    return {
      ok: false,
      error: `La moneda debe ser código ISO de 3 letras (ej: CLP, USD): "${moneda}".`,
      codigo: "MONEDA_INVALIDA",
    };
  }

  // 7. Plan Real (Obligatorio, sin defaults implícitos)
  if (!datos.plan) {
    return {
      ok: false,
      error: "El plan es requerido explícitamente ('tino_solo', 'inicial', 'crecimiento', 'empresa', 'a_medida').",
      codigo: "PLAN_REQUERIDO",
    };
  }
  const plan = datos.plan;
  const planesValidos: NombrePlan[] = ["tino_solo", "inicial", "crecimiento", "empresa", "a_medida"];
  if (!planesValidos.includes(plan)) {
    return {
      ok: false,
      error: `Plan inválido: "${plan}". Debe ser uno de: ${planesValidos.join(", ")}.`,
      codigo: "PLAN_INVALIDO",
    };
  }

  // 8. Cupo
  let cupo = datos.cupoConversaciones ?? null;
  if (cupo === null && plan in PLANES) {
    cupo = PLANES[plan].cupo;
  }
  if (cupo !== null && (typeof cupo !== "number" || cupo < 0)) {
    return {
      ok: false,
      error: "El cupo de conversaciones no puede ser negativo.",
      codigo: "CUPO_INVALIDO",
    };
  }

  // 9. Transporte
  const transporte = datos.transporte ?? "cloud";
  if (!["cloud", "waha", "ambos"].includes(transporte)) {
    return {
      ok: false,
      error: `Transporte inválido: "${transporte}". Debe ser cloud, waha o ambos.`,
      codigo: "TRANSPORTE_INVALIDO",
    };
  }

  // 10. Teléfono de Escalación
  const arrEscalacion = normalizarEscalacion(datos.telefonoEscalacion);
  if (arrEscalacion.length === 0) {
    return {
      ok: false,
      error: "Teléfono de escalación requerido con al menos 8 dígitos.",
      codigo: "TELEFONO_INVALIDO",
    };
  }

  return {
    ok: true,
    normalizado: {
      nombre,
      rubro,
      emailDueno,
      emailStaff,
      telefonoEscalacion: arrEscalacion,
      slug,
      moneda,
      plan,
      cupoConversaciones: cupo,
      conAgenda: datos.conAgenda ?? false,
      transporte,
      pagoLinkBase: datos.pagoLinkBase?.trim() || null,
      pagoRefEtiqueta: datos.pagoRefEtiqueta?.trim() || null,
      clienteId: datos.clienteId?.trim() || undefined,
    },
  };
}

/**
 * Prepara la especificación canónica de los 3 empleados de IA iniciales.
 * Encapsula la convención de negocio: 'Beto' en UI -> rol 'rita' en DB.
 */
export function prepararFichaEmpleados(): Array<{
  rol: "tino" | "rita" | "vera";
  nombrePublico: string;
  ficha: Record<string, unknown>;
}> {
  return [
    {
      rol: "tino",
      nombrePublico: "Tino",
      ficha: {
        tono: "cálido, empático, claro y profesional",
        emoji: "moderado",
        objetivo: "atender consultas y agendar",
        umbral_monto: 50000,
        palabras_clave_escalacion: [
          "reclamo",
          "humano",
          "gerente",
          "abogado",
          "urgencia",
        ],
      },
    },
    {
      rol: "rita", // Convención tribal encapsulada: Beto = rol interno 'rita'
      nombrePublico: "Beto",
      ficha: {
        tono: "amable y proactivo",
        emoji: "moderado",
        objetivo: "retomar cotizaciones y reactivar clientes",
        dias_espera_reactivacion: 30,
      },
    },
    {
      rol: "vera",
      nombrePublico: "Vera",
      ficha: {
        tono: "empático y cuidadoso",
        emoji: "suave",
        objetivo: "postventa, NPS y reseñas",
        criterio_estricto: true,
      },
    },
  ];
}

/**
 * Aprovisiona atómicamente un cliente nuevo en Respondo.
 * Invoca la función almacenada PostgreSQL `public.ed_aprovisionar_cliente`.
 * Si la función no está aplicada en base de datos, FALLA CERRADO sin crear tenants parciales.
 */
export async function aprovisionarCliente(
  datos: DatosOnboarding,
  supa: SupabaseClient = db(),
): Promise<ResultadoOnboarding> {
  // 1. Validar insumos en runtime
  const val = validarInsumosOnboarding(datos);
  if (!val.ok) return val;

  const n = val.normalizado;

  // 2. Construir payload JSON para RPC
  const payloadRpc = {
    nombre: n.nombre,
    rubro: n.rubro,
    email_dueno: n.emailDueno,
    email_staff: n.emailStaff,
    telefono_escalacion: n.telefonoEscalacion,
    slug: n.slug,
    moneda: n.moneda,
    plan: n.plan,
    cupo_conversaciones: n.cupoConversaciones,
    con_agenda: n.conAgenda,
    transporte: n.transporte,
    pago_link_base: n.pagoLinkBase,
    pago_ref_etiqueta: n.pagoRefEtiqueta,
    cliente_id: n.clienteId,
  };

  // 3. Ejecutar transacción atómica en DB
  const { data, error } = await supa.rpc("ed_aprovisionar_cliente", {
    p_datos: payloadRpc,
  });

  if (error) {
    const msg = error.message || "";

    // Detección de migración no aplicada (fail-closed)
    if (
      error.code === "42883" ||
      msg.includes("could not find the function") ||
      msg.includes("does not exist")
    ) {
      return {
        ok: false,
        codigo: "MIGRACION_NO_APLICADA",
        error:
          "Falta aplicar la migración de aprovisionamiento (sql/314_fn_onboarding_cliente.sql) en la base de datos.",
      };
    }

    // Mapeo de errores estructurados de la función PostgreSQL
    if (msg.includes("PLAN_REQUERIDO")) {
      return { ok: false, codigo: "PLAN_REQUERIDO", error: msg };
    }
    if (msg.includes("CONFLICTO_CARRERA")) {
      return { ok: false, codigo: "CONFLICTO_CARRERA", error: msg };
    }
    if (msg.includes("SLUG_EN_USO") || msg.includes("CONFLICTO_IDEMPOTENCIA")) {
      return { ok: false, codigo: "CONFLICTO_IDEMPOTENCIA", error: msg };
    }
    if (msg.includes("EMAIL_EN_USO")) {
      return { ok: false, codigo: "EMAIL_EN_USO", error: msg };
    }
    if (msg.includes("EMAIL_STAFF_EN_USO")) {
      return { ok: false, codigo: "EMAIL_STAFF_EN_USO", error: msg };
    }
    if (msg.includes("STAFF_DUPLICADO")) {
      return { ok: false, codigo: "STAFF_DUPLICADO", error: msg };
    }
    if (msg.includes("ID_EN_USO")) {
      return { ok: false, codigo: "ID_EN_USO", error: msg };
    }
    if (msg.includes("PLAN_INVALIDO")) {
      return { ok: false, codigo: "PLAN_INVALIDO", error: msg };
    }
    if (msg.includes("MONEDA_INVALIDA")) {
      return { ok: false, codigo: "MONEDA_INVALIDA", error: msg };
    }
    if (msg.includes("TELEFONO_INVALIDO")) {
      return { ok: false, codigo: "TELEFONO_INVALIDO", error: msg };
    }
    if (msg.includes("PARAMETRO_INVALIDO") || msg.includes("EMAIL_INVALIDO") || msg.includes("SLUG_INVALIDO")) {
      return { ok: false, codigo: "PARAMETRO_INVALIDO", error: msg };
    }

    return {
      ok: false,
      codigo: "ERROR_BASE_DATOS",
      error: `Error en base de datos: ${msg}`,
    };
  }

  const res = data as Record<string, unknown> | null;
  if (!res || !res.ok) {
    return {
      ok: false,
      codigo: "ERROR_BASE_DATOS",
      error: (res?.error as string) || "La función retornó un estado inesperado.",
    };
  }

  return {
    ok: true,
    idempotente: !!res.idempotente,
    status: (res.status as "CREADO" | "EXISTENTE_NO_MODIFICADO") ?? "CREADO",
    clienteId: res.cliente_id as string,
    nombre: res.nombre as string,
    slug: res.slug as string,
    emailDueno: res.email_dueno as string,
    transporte: res.transporte as string,
    moneda: res.moneda as string,
    plan: res.plan as string,
    cupoConversaciones: (res.cupo_conversaciones as number | null) ?? null,
    agendaActiva: !!res.agenda_activa,
    staffCount: (res.staff_count as number) ?? 0,
  };
}

// ── READINESS / SALUD DEL TENANT ──────────────────────────────────────────────

export type ReadinessTenant = {
  clienteId: string;
  nombre: string;
  slug: string | null;
  plan: string | null;
  core: {
    tenantRegistrado: boolean;
    activo: boolean;
    duenoConfigurado: boolean;
    emailDueno: string | null;
    staffRegistrados: number;
    tinoActivo: boolean;
    betoActivo: boolean;
    veraActiva: boolean;
  };
  canales: {
    whatsapp: {
      conectado: boolean;
      transporte: string;
      wabaId: string | null;
      coexistencia: boolean | null;
    };
    instagram: {
      conectado: boolean;
      igUserId: string | null;
    };
  };
  modulosOpcionales: {
    agenda: {
      contratada: boolean;
      rutaPublica: string | null;
      serviciosActivos: number;
      profesionalesActivos: number;
    };
    marketing: {
      conectado: boolean;
      datasetId: string | null;
    };
    cobros: {
      linkConfigurado: boolean;
      linkBase: string | null;
      etiquetaRef: string | null;
    };
  };
};

/**
 * Audita el estado de implementación de un tenant en la base de datos real.
 * Distingue estrictamente entre CORE (vital) y módulos opcionales (no contratados).
 */
export async function verificarReadinessTenant(
  clienteIdOSlug: string,
  supa: SupabaseClient = db(),
): Promise<ReadinessTenant | null> {
  const esUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      clienteIdOSlug,
    );

  let consulta = supa
    .from("ed_clientes")
    .select(
      "id, nombre, slug, plan, activo, transporte, waba_id, waba_coexistencia, ig_user_id, ig_token, reservas_online, ads_dataset_id, pago_link_base, pago_ref_etiqueta",
    );

  if (esUuid) {
    consulta = consulta.eq("id", clienteIdOSlug);
  } else {
    consulta = consulta.eq("slug", clienteIdOSlug);
  }

  const { data: cliente, error: errCliente } = await consulta.maybeSingle();
  if (errCliente || !cliente) return null;

  const clienteId = cliente.id as string;

  const [usuariosRes, empleadosRes, serviciosRes, profesionalesRes] =
    await Promise.all([
      supa
        .from("portal_usuarios")
        .select("email, rol, activo")
        .eq("cliente_id", clienteId),
      supa
        .from("ed_empleados")
        .select("rol, nombre_publico, activo")
        .eq("cliente_id", clienteId),
      supa
        .from("ed_servicios")
        .select("id, activo")
        .eq("cliente_id", clienteId)
        .eq("activo", true),
      supa
        .from("ed_profesionales")
        .select("id, activo")
        .eq("cliente_id", clienteId)
        .eq("activo", true),
    ]);

  const usuarios = usuariosRes.data ?? [];
  const empleados = empleadosRes.data ?? [];
  const servicios = serviciosRes.data ?? [];
  const profesionales = profesionalesRes.data ?? [];

  const dueno = usuarios.find((u) => u.rol === "dueno" && u.activo);
  const staffCount = usuarios.filter((u) => u.rol === "staff" && u.activo).length;

  const tino = empleados.some((e) => e.rol === "tino" && e.activo);
  const beto = empleados.some((e) => e.rol === "rita" && e.activo);
  const vera = empleados.some((e) => e.rol === "vera" && e.activo);

  const tieneAgenda = !!cliente.reservas_online;

  return {
    clienteId,
    nombre: cliente.nombre as string,
    slug: cliente.slug as string | null,
    plan: (cliente.plan as string | null) ?? null,
    core: {
      tenantRegistrado: true,
      activo: !!cliente.activo,
      duenoConfigurado: !!dueno,
      emailDueno: dueno?.email ?? null,
      staffRegistrados: staffCount,
      tinoActivo: tino,
      betoActivo: beto,
      veraActiva: vera,
    },
    canales: {
      whatsapp: {
        conectado: !!cliente.waba_id,
        transporte: (cliente.transporte as string) ?? "cloud",
        wabaId: (cliente.waba_id as string) ?? null,
        coexistencia: (cliente.waba_coexistencia as boolean | null) ?? null,
      },
      instagram: {
        conectado: !!cliente.ig_user_id || !!cliente.ig_token,
        igUserId: (cliente.ig_user_id as string | null) ?? null,
      },
    },
    modulosOpcionales: {
      agenda: {
        contratada: tieneAgenda,
        rutaPublica: tieneAgenda && cliente.slug ? `/reservar/${cliente.slug}` : null,
        serviciosActivos: servicios.length,
        profesionalesActivos: profesionales.length,
      },
      marketing: {
        conectado: !!cliente.ads_dataset_id,
        datasetId: (cliente.ads_dataset_id as string | null) ?? null,
      },
      cobros: {
        linkConfigurado: !!cliente.pago_link_base,
        linkBase: (cliente.pago_link_base as string | null) ?? null,
        etiquetaRef: (cliente.pago_ref_etiqueta as string | null) ?? null,
      },
    },
  };
}

/**
 * Formatea el reporte de readiness para consumo en terminal/CLI.
 */
export function formatearReadinessTexto(r: ReadinessTenant): string {
  const coreOk =
    r.core.tenantRegistrado &&
    r.core.activo &&
    r.core.duenoConfigurado &&
    r.core.tinoActivo &&
    r.core.betoActivo &&
    r.core.veraActiva;

  return `
==================================================
ESTADO DE IMPLEMENTACIÓN: ${r.nombre}
ID: ${r.clienteId} | Slug: ${r.slug ?? "—"} | Plan: ${r.plan ?? "Sin plan asignado"}
==================================================

CORE (${coreOk ? "✓ COMPLETO" : "✗ INCOMPLETO"}):
  ${r.core.tenantRegistrado && r.core.activo ? "✓" : "✗"} Tenant activo en base de datos
  ${r.core.duenoConfigurado ? "✓" : "✗"} Dueño: ${r.core.emailDueno ?? "SIN DUEÑO CONFIGURADO"}
  ${r.core.staffRegistrados > 0 ? "✓" : "○"} Colaboradores Staff: ${r.core.staffRegistrados}
  ${r.core.tinoActivo ? "✓" : "✗"} Tino (Ventas)
  ${r.core.betoActivo ? "✓" : "✗"} Beto (Seguimiento / rol rita)
  ${r.core.veraActiva ? "✓" : "✗"} Vera (Calidad)

CANALES:
  WhatsApp: ${r.canales.whatsapp.conectado ? "✓ CONECTADO" : "○ NO CONECTADO"}
    Transporte: ${r.canales.whatsapp.transporte.toUpperCase()}
    WABA ID: ${r.canales.whatsapp.wabaId ?? "Pendiente (vía /whatsapp)"}
    Coexistencia: ${r.canales.whatsapp.coexistencia === true ? "Activa" : r.canales.whatsapp.coexistencia === false ? "Solo Cloud API" : "Sin verificar"}
  Instagram: ${r.canales.instagram.conectado ? "✓ CONECTADO" : "○ NO CONECTADO"}
    ID Usuario: ${r.canales.instagram.igUserId ?? "Pendiente (vía /configuracion)"}

MÓDULOS OPCIONALES:
  Agenda: ${r.modulosOpcionales.agenda.contratada ? "✓ ACTIVA" : "○ NO CONTRATADA"}
    Ruta pública: ${r.modulosOpcionales.agenda.rutaPublica ?? "Desactivada"}
    Servicios activos: ${r.modulosOpcionales.agenda.serviciosActivos}
    Profesionales activos: ${r.modulosOpcionales.agenda.profesionalesActivos}
  Marketing CAPI: ${r.modulosOpcionales.marketing.conectado ? "✓ CONFIGURADO" : "○ NO CONFIGURADO"}
    Meta Dataset ID: ${r.modulosOpcionales.marketing.datasetId ?? "No asignado"}
  Cobros Asistidos: ${r.modulosOpcionales.cobros.linkConfigurado ? "✓ CONFIGURADO" : "○ NO CONFIGURADO"}
    Link Base: ${r.modulosOpcionales.cobros.linkBase ?? "No asignado"}
    Referencia: ${r.modulosOpcionales.cobros.etiquetaRef ?? "No asignada"}
==================================================
`.trim();
}
