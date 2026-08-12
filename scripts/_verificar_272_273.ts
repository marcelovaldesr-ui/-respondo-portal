/**
 * VERIFICACIÓN EN VIVO de las migraciones 272_security_hardening.sql y
 * 273_operational_hardening.sql contra la base real.
 *
 * Comprueba que existan las tablas, columnas y funciones nuevas, y ejercita
 * las funciones con datos de prueba inofensivos (que borra al terminar).
 * No toca datos de clientes reales.
 *
 *   npx tsx scripts/_verificar_272_273.ts
 */
import "./_env";
import { db } from "../lib/db";

const AURORA = "11111111-1111-1111-1111-111111111111"; // cliente demo del seed

let ok = 0;
let fallos = 0;
function check(nombre: string, cond: boolean, extra?: string) {
  if (cond) {
    ok++;
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos++;
    console.error(`  ✗ ${nombre}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main() {
  const supa = db();

  console.log("\n=== 272_security_hardening.sql ===");

  // Índice único anti doble-reserva en clases (verificación indirecta: que la
  // tabla ed_citas responda y que clase_id exista como columna).
  {
    const { error } = await supa.from("ed_citas").select("clase_id").limit(1);
    check("ed_citas.clase_id existe (migración 260/272)", !error, error?.message);
  }

  console.log("\n=== 273_operational_hardening.sql — tablas ===");

  for (const tabla of ["ed_rate_limits", "ed_webhook_eventos", "ed_auditoria_portal"]) {
    const { error } = await supa.from(tabla).select("*", { count: "exact", head: true });
    check(`tabla ${tabla} existe`, !error, error?.message);
  }

  {
    const { error } = await supa.from("ed_webhook_eventos").select("payload_purgado_en").limit(1);
    check("ed_webhook_eventos.payload_purgado_en existe", !error, error?.message);
  }

  {
    const { error } = await supa.from("ed_servicio_profesional").select("cliente_id").limit(1);
    check("ed_servicio_profesional.cliente_id existe", !error, error?.message);
  }

  console.log("\n=== 273 — funciones (con datos de prueba, se limpian solas) ===");

  // ed_consumir_limite: clave de prueba, se borra al final.
  {
    const claveTest = "verif-273-rate-" + Date.now();
    const { data, error } = await supa.rpc("ed_consumir_limite", {
      p_clave: claveTest,
      p_max: 5,
      p_ventana_seg: 60,
    });
    check("ed_consumir_limite() responde", !error && Array.isArray(data) && data.length === 1, error?.message);
    await supa.from("ed_rate_limits").delete().eq("clave", claveTest);
  }

  // ed_reclamar_webhook: evento de prueba con proveedor válido, se borra al final.
  {
    const eventoTest = "verif-273-webhook-" + Date.now();
    const { data, error } = await supa.rpc("ed_reclamar_webhook", {
      p_proveedor: "waha",
      p_evento_id: eventoTest,
      p_payload: { test: true },
    });
    check("ed_reclamar_webhook() responde", !error && Array.isArray(data) && data.length === 1, error?.message);
    await supa.from("ed_webhook_eventos").delete().eq("evento_id", eventoTest);
  }

  // Funciones de solo lectura (stable), sobre el cliente demo — no escriben nada.
  {
    const { data, error } = await supa.rpc("ed_listar_conversaciones_portal", {
      p_cliente_id: AURORA,
      p_limite: 1,
    });
    check("ed_listar_conversaciones_portal() responde", !error, error?.message);
    void data;
  }
  {
    const { data, error } = await supa.rpc("ed_resumen_conversaciones_portal", {
      p_cliente_id: AURORA,
    });
    check("ed_resumen_conversaciones_portal() responde", !error && data !== null, error?.message);
  }

  // Trigger de integridad servicio/profesional: intentar cruzar dos clientes
  // distintos debe fallar con la excepción del trigger, no con un error genérico.
  {
    const { data: svc } = await supa.from("ed_servicios").select("id").eq("cliente_id", AURORA).limit(1).single();
    const { data: otroProf } = await supa
      .from("ed_profesionales")
      .select("id")
      .neq("cliente_id", AURORA)
      .limit(1)
      .single();
    if (svc && otroProf) {
      const { error } = await supa
        .from("ed_servicio_profesional")
        .insert({ servicio_id: svc.id, profesional_id: otroProf.id });
      check(
        "trigger tenant ed_servicio_profesional bloquea cruce de clientes",
        !!error && /mismo cliente/i.test(error.message),
        error?.message ?? "no dio error, se insertó igual (MAL)",
      );
      if (!error) {
        await supa.from("ed_servicio_profesional").delete().eq("servicio_id", svc.id).eq("profesional_id", otroProf.id);
      }
    } else {
      console.log("  (sin datos de otro cliente para probar el trigger — omitido, no es una falla)");
    }
  }

  console.log(`\n=== Resultado: ${ok} ok, ${fallos} fallos ===\n`);
  process.exit(fallos > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Error inesperado:", e);
  process.exit(1);
});
