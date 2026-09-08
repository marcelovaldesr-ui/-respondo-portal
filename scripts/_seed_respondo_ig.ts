/**
 * Deja a Tino atendiendo el Instagram de Respondo (@respon.do) con información
 * REAL de Respondo, para que la cuenta sea su propia demo en vivo.
 *
 * POR QUÉ EXISTE
 * El 3-sep-2026 se conectó @respon.do desde el portal estando con la sesión de
 * hirespondo@gmail.com, que apuntaba a RS-Shop desde la demo del 19-ago. Meta
 * guardó las credenciales donde el portal dijo: en la fila de RS-Shop. Es decir,
 * hoy un DM al Instagram de Respondo lo contesta el Tino de una tienda de motos.
 *
 * QUÉ HACE
 *  1. Crea (o actualiza) el cliente "Respondo" 77777777-… con Tino, Beto y Vera.
 *  2. Carga la base de conocimiento con información real de Respondo.
 *  3. Mueve ig_user_id / ig_token_cifrado / ig_token_vence / ig_conectado_en /
 *     ig_usuario desde RS-Shop a Respondo. El índice único de ig_user_id obliga
 *     a limpiar el origen ANTES de escribir el destino.
 *  4. Apunta hirespondo@gmail.com al cliente Respondo en portal_usuarios.
 *
 * QUÉ NO HACE, A PROPÓSITO
 *  · No siembra conversaciones falsas. Esta es nuestra cuenta real: datos
 *    inventados ensuciarían las métricas que después vamos a mirar de verdad.
 *  · No toca el WhatsApp de RS-Shop (waba_*), ni su conocimiento, ni su
 *    historial. La demo de RS-Shop queda entera; solo deja de tener un Instagram
 *    que nunca fue suyo.
 *  · No asigna plan: como Impresora, Respondo es negocio propio y no paga, así
 *    el contador de cupos queda inerte (ver cupos-y-excedentes-precios-ago2026).
 *
 * Idempotente: se puede correr las veces que haga falta.
 *
 *   npx tsx scripts/_seed_respondo_ig.ts            # aplica
 *   npx tsx scripts/_seed_respondo_ig.ts --revertir # devuelve todo a RS-Shop
 */
import "./_env";
import { db } from "../lib/db";
import { CONOCIMIENTO, CORRECCIONES } from "./_conocimiento_respondo";

const RESPONDO = "77777777-7777-7777-7777-777777777777";
const RS_SHOP = "55555555-5555-5555-5555-555555555555";
const TINO = "a7777777-0000-0000-0000-000000000001";
const BETO = "a7777777-0000-0000-0000-000000000002";
const VERA = "a7777777-0000-0000-0000-000000000003";
const CORREO = "hirespondo@gmail.com";

const CAMPOS_IG = [
  "ig_user_id",
  "ig_token",
  "ig_token_cifrado",
  "ig_token_vence",
  "ig_conectado_en",
  "ig_usuario",
] as const;

const revertir = process.argv.includes("--revertir");

async function main() {
  const supa = db();

  // ── 1. Cliente ────────────────────────────────────────────────────────────
  if (!revertir) {
    console.log("1) Cliente Respondo...");
    const { error } = await supa.from("ed_clientes").upsert(
      {
        id: RESPONDO,
        nombre: "Respondo",
        // Va literal al prompt como {{rubro}}: describe el negocio, no el sector.
        rubro: "plataforma de empleados de IA para atención, agenda y ventas de pymes",
        slug: "respondo",
        telefono_escalacion: ["+56 9 6595 0344"],
        canal_escalacion: "whatsapp",
        destino_leads: "sheets",
        destino_config: {},
        transporte: "cloud",
        activo: true,
        plan: null,
        cupo_conversaciones: null,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error("ed_clientes: " + error.message);

    console.log("2) Empleados...");
    const { error: e2 } = await supa.from("ed_empleados").upsert(
      [
        {
          id: TINO,
          cliente_id: RESPONDO,
          rol: "tino",
          nombre_publico: "Tino",
          ficha_personalidad: {
            tono:
              "Encargada de comunicaciones de una empresa de tecnología: clara, directa y sin humo. " +
              "Responde la pregunta primero y explica después. Nada de venta agresiva ni de entusiasmo fingido.",
            palabras_clave_escalacion:
              "reclamo, urgente, abogado, factura, contrato, prensa, no funciona, se cayó, dar de baja, cancelar",
            umbral_monto: "$450.000",
          },
          activo: true,
        },
        {
          id: BETO,
          cliente_id: RESPONDO,
          rol: "rita",
          nombre_publico: "Beto",
          ficha_personalidad: {
            tono: "Retoma sin presionar. Una razón concreta para volver, nunca un reproche.",
          },
          activo: true,
        },
        {
          id: VERA,
          cliente_id: RESPONDO,
          rol: "vera",
          nombre_publico: "Vera",
          ficha_personalidad: { tono: "Escucha corto y actúa. Si algo salió mal, no defiende: avisa." },
          activo: true,
        },
      ],
      { onConflict: "id" },
    );
    if (e2) throw new Error("ed_empleados: " + e2.message);
  }

  // ── 3. Conocimiento ───────────────────────────────────────────────────────
  if (!revertir) {
    console.log("3) Base de conocimiento...");
    await supa.from("ed_conocimiento").delete().eq("cliente_id", RESPONDO);
    const { error } = await supa.from("ed_conocimiento").insert(
      CONOCIMIENTO.map((f) => ({ cliente_id: RESPONDO, ...f, vigente: true })),
    );
    if (error) throw new Error("ed_conocimiento: " + error.message);

    console.log("4) Correcciones (mandan sobre el núcleo)...");
    await supa.from("ed_correcciones").delete().eq("empleado_id", TINO);
    const { error: e4 } = await supa
      .from("ed_correcciones")
      .insert(CORRECCIONES.map((c) => ({ empleado_id: TINO, ...c, activa: true })));
    if (e4) throw new Error("ed_correcciones: " + e4.message);
  }

  // ── 5. Instagram: mover credenciales ──────────────────────────────────────
  const origen = revertir ? RESPONDO : RS_SHOP;
  const destino = revertir ? RS_SHOP : RESPONDO;

  console.log(`5) Moviendo Instagram de ${origen.slice(0, 8)} a ${destino.slice(0, 8)}...`);
  const { data: fila, error: eLeer } = await supa
    .from("ed_clientes")
    .select(CAMPOS_IG.join(","))
    .eq("id", origen)
    .maybeSingle();
  if (eLeer) throw new Error("leer origen: " + eLeer.message);

  const creds = fila as unknown as Record<string, unknown> | null;
  if (!creds?.ig_user_id) {
    console.log("   · el origen no tiene Instagram conectado, nada que mover.");
  } else {
    // El índice único de ig_user_id no admite dos filas con el mismo valor:
    // primero se vacía el origen, recién después se escribe el destino.
    const vacio = Object.fromEntries(CAMPOS_IG.map((c) => [c, null]));
    const { error: eLimpiar } = await supa.from("ed_clientes").update(vacio).eq("id", origen);
    if (eLimpiar) throw new Error("limpiar origen: " + eLimpiar.message);

    const { error: eEscribir } = await supa
      .from("ed_clientes")
      .update(Object.fromEntries(CAMPOS_IG.map((c) => [c, creds[c] ?? null])))
      .eq("id", destino);
    if (eEscribir) {
      // Si falla el destino, devolver el origen a como estaba: peor que no
      // moverlo es dejar la cuenta sin dueño y el webhook sin a quién entregar.
      await supa.from("ed_clientes").update(creds).eq("id", origen);
      throw new Error("escribir destino (revertido el origen): " + eEscribir.message);
    }
    console.log(`   · @${creds.ig_usuario ?? "?"} (${creds.ig_user_id}) movido.`);
  }

  // ── 6. Acceso al portal ───────────────────────────────────────────────────
  console.log(`6) ${CORREO} -> ${revertir ? "RS-Shop" : "Respondo"}...`);
  const { error: eAcc } = await supa
    .from("portal_usuarios")
    .update({ cliente_id: destino })
    .eq("email", CORREO);
  if (eAcc) throw new Error("portal_usuarios: " + eAcc.message);

  console.log("\nListo.");
  if (!revertir) {
    console.log("Comprobar: entrar al portal con " + CORREO + " y mandarse un DM a @respon.do.");
    console.log("Para devolver todo: npx tsx scripts/_seed_respondo_ig.ts --revertir");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FALLÓ:", e.message);
    process.exit(1);
  });
