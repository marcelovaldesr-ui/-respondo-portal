import "./_env";
import { db } from "../lib/db";
import { cifrar, descifrar } from "../lib/cifrado";

/**
 * Cifra los `ed_clientes.waba_token` que todavía están en texto plano.
 *
 * Paso 3 de la migración 279. Antes hay que haber aplicado la migración y
 * desplegado el código; después hay que VERIFICAR que los clientes siguen
 * enviando mensajes y recién ahí correr la 280, que borra el texto plano.
 *
 * Es idempotente: los que ya tienen `waba_token_cifrado` se saltan. Se puede
 * correr las veces que haga falta.
 *
 *   npx tsx scripts/cifrar_tokens.ts          → muestra qué haría
 *   npx tsx scripts/cifrar_tokens.ts --aplicar → escribe
 */
async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const supa = db();

  const { data, error } = await supa
    .from("ed_clientes")
    .select("id, nombre, waba_token, waba_token_cifrado")
    .not("waba_token", "is", null);

  if (error) {
    console.error("❌ No se pudo leer. ¿Está aplicada la migración 279?", error.message);
    process.exit(1);
  }
  if (!data?.length) {
    console.log("✅ No queda ningún token en texto plano.");
    return;
  }

  console.log(aplicar ? "APLICANDO\n" : "SIMULACRO (agrega --aplicar para escribir)\n");
  let hechos = 0;

  for (const c of data) {
    const nombre = String(c.nombre);
    const claro = c.waba_token as string;

    if (c.waba_token_cifrado) {
      console.log(`  ${nombre.padEnd(32)} ya estaba cifrado, se salta`);
      continue;
    }

    const cifradoTexto = cifrar(claro, "waba-token");

    // Comprobar ANTES de escribir que lo cifrado se puede volver a leer. Si
    // esto fallara, escribir sería dejar al cliente sin token recuperable.
    if (descifrar(cifradoTexto, "waba-token") !== claro) {
      console.error(`  ❌ ${nombre}: el cifrado no se pudo verificar. NO se escribe nada.`);
      process.exit(1);
    }

    if (!aplicar) {
      console.log(`  ${nombre.padEnd(32)} se cifraría (${claro.length} caracteres)`);
      continue;
    }

    // Solo se escribe la columna nueva. `waba_token` se deja intacto a
    // propósito: es la única copia de respaldo hasta que se verifique en vivo.
    const { error: errUpd } = await supa
      .from("ed_clientes")
      .update({ waba_token_cifrado: cifradoTexto })
      .eq("id", c.id as string);

    if (errUpd) {
      console.error(`  ❌ ${nombre}: ${errUpd.message}`);
      process.exit(1);
    }
    console.log(`  ✅ ${nombre.padEnd(32)} cifrado`);
    hechos++;
  }

  if (aplicar) {
    console.log(`\n${hechos} token(es) cifrado(s).`);
    console.log("SIGUIENTE: probar que cada cliente sigue enviando de verdad;");
    console.log("recién después aplicar sql/280_waba_token_limpieza.sql.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
