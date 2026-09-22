import "./_env";
import {
  aprovisionarCliente,
  validarInsumosOnboarding,
  type DatosOnboarding,
  type PlanCliente,
} from "../lib/onboarding";

function parsearArgs(): { datos: DatosOnboarding; dryRun: boolean } | null {
  const args = process.argv.slice(2);
  const getArg = (flags: string[]): string | undefined => {
    for (const flag of flags) {
      const idx = args.indexOf(flag);
      if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) {
        return args[idx + 1];
      }
    }
    return undefined;
  };
  const getAllArgs = (flag: string): string[] => {
    const list: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === flag && args[i + 1] && !args[i + 1].startsWith("--")) {
        list.push(args[i + 1]);
      }
    }
    return list;
  };
  const hasFlag = (flag: string): boolean => args.includes(flag);

  const dryRun = hasFlag("--dry-run");
  const nombre = getArg(["--nombre"]);
  const rubro = getArg(["--rubro"]) || "general";
  const emailDueno = getArg(["--email-dueno", "--email"]);
  const telefonoEscalacion = getArg(["--telefono", "--escalacion"]);
  const slug = getArg(["--slug"]);
  const moneda = (getArg(["--moneda"]) || "CLP").toUpperCase();
  const planArg = getArg(["--plan"]);
  const plan = planArg as PlanCliente | undefined;
  const cupoStr = getArg(["--cupo", "--cupo-conversaciones"]);
  const cupoConversaciones = cupoStr ? parseInt(cupoStr, 10) : undefined;
  const conAgenda = hasFlag("--agenda") || hasFlag("--con-agenda");
  const transporte = (getArg(["--transporte"]) || "cloud") as DatosOnboarding["transporte"];
  const pagoLinkBase = getArg(["--pago-base", "--pago-link-base"]);
  const pagoRefEtiqueta = getArg(["--pago-etiqueta", "--pago-ref-etiqueta"]);

  // Recolectar emails de staff (pueden venir con múltiples --staff o con comas)
  const staffArgs = getAllArgs("--staff").concat(getAllArgs("--email-staff"));
  const staffList: string[] = [];
  for (const s of staffArgs) {
    for (const sub of s.split(",")) {
      const limpio = sub.trim();
      if (limpio) staffList.push(limpio);
    }
  }

  if (!nombre || !emailDueno || !telefonoEscalacion || !plan) {
    console.error(`
USO DE APROVISIONAMIENTO (CLI):
  npx tsx scripts/nuevo_cliente.ts \\
    --nombre "Clínica Dental San Lucas" \\
    --email-dueno "admin@sanlucas.cl" \\
    --telefono "+56912345678" \\
    --plan "inicial" \\
    [--rubro "odontologia"] \\
    [--staff "recepcion@sanlucas.cl"] \\
    [--slug "san-lucas"] \\
    [--moneda "CLP"] \\
    [--agenda] \\
    [--pago-base "https://webpay.cl/sanlucas"] \\
    [--pago-etiqueta "RUT Paciente"] \\
    [--dry-run]

PLANES REALES ADMITIDOS (OBLIGATORIO):
  tino_solo    (800 conversaciones)
  inicial      (1.200 conversaciones)
  crecimiento  (3.000 conversaciones)
  empresa      (6.000 conversaciones)
  a_medida     (cupo custom por --cupo)
`);
    return null;
  }

  return {
    dryRun,
    datos: {
      nombre,
      rubro,
      emailDueno,
      emailStaff: staffList.length > 0 ? staffList : undefined,
      telefonoEscalacion,
      slug,
      moneda,
      plan,
      cupoConversaciones,
      conAgenda,
      transporte,
      pagoLinkBase,
      pagoRefEtiqueta,
    },
  };
}

async function main() {
  const parsed = parsearArgs();
  if (!parsed) process.exit(1);

  const { datos, dryRun } = parsed;

  if (dryRun) {
    console.log(`\n🔍 MODO DRY-RUN: Validando insumos para "${datos.nombre}"...`);
    const val = validarInsumosOnboarding(datos);
    if (!val.ok) {
      console.error(`\n❌ Error de validación [${val.codigo}]:`);
      console.error(`   ${val.error}\n`);
      process.exit(1);
    }
    console.log("\n✓ Insumos válidos. Payload normalizado que se enviaría a la base de datos:");
    console.dir(val.normalizado, { depth: null });
    console.log("\n[dry-run terminado sin escribir en base de datos]");
    return;
  }

  console.log(`\n⏳ Aprovisionando cliente: "${datos.nombre}"...`);
  const resultado = await aprovisionarCliente(datos);

  if (!resultado.ok) {
    if (resultado.codigo === "MIGRACION_NO_APLICADA") {
      console.error(`\n❌ ERROR FATAL [${resultado.codigo}]:`);
      console.error(`   Falta aplicar la migración de aprovisionamiento en la base de datos.`);
      console.error(`   Ejecute 'sql/314_fn_onboarding_cliente.sql' en Supabase SQL Editor antes de dar de alta clientes.`);
    } else {
      console.error(`\n❌ Error de aprovisionamiento [${resultado.codigo}]:`);
      console.error(`   ${resultado.error}`);
    }
    console.error("\nOperación cancelada: ningún dato parcial fue registrado.\n");
    process.exit(1);
  }

  if (resultado.idempotente) {
    console.log(`
ℹ️ IDEMPOTENCIA DETECTADA:
  El tenant ya existía con datos idénticos y fue retornado sin duplicar filas.
`);
  } else {
    console.log(`
✅ ¡Cliente aprovisionado exitosamente en una sola transacción!
`);
  }

  console.log(`
  ID Cliente:    ${resultado.clienteId}
  Nombre:        ${resultado.nombre}
  Slug:          ${resultado.slug}
  Email Dueño:   ${resultado.emailDueno}
  Staff:         ${resultado.staffCount} registrados
  Transporte:    ${resultado.transporte}
  Moneda:        ${resultado.moneda}
  Plan:          ${resultado.plan}
  Cupo:          ${resultado.cupoConversaciones ?? "Sin límite"} conversaciones
  Agenda:        ${resultado.agendaActiva ? "Activada" : "Desactivada"}

Pasos siguientes recomendados:
  1. Conectar WhatsApp en: https://respondo-portal.vercel.app/whatsapp (usando ${resultado.emailDueno})
  2. Generar plantillas Meta: npx tsx scripts/crear_plantillas_meta.ts --cliente "${resultado.nombre}" --crear
  3. Validar estado completo: npx tsx scripts/readiness_tenant.ts --cliente "${resultado.slug}"
`);
}

main().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});
