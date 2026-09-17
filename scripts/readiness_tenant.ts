import "./_env";
import { verificarReadinessTenant, formatearReadinessTexto } from "../lib/onboarding";

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
  };

  const cliente = getArg("--cliente") || args[0];

  if (!cliente) {
    console.error(`
USO:
  npx tsx scripts/readiness_tenant.ts --cliente <UUID o SLUG>
  npx tsx scripts/readiness_tenant.ts impresora-color
`);
    process.exit(1);
  }

  const r = await verificarReadinessTenant(cliente);
  if (!r) {
    console.error(`\n❌ No se encontró ningún cliente con identificador: "${cliente}".\n`);
    process.exit(1);
  }

  console.log(formatearReadinessTexto(r));
}

main().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});
