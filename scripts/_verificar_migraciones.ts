/**
 * VERIFICACIÓN EN VIVO de las migraciones 214/216/220/221 contra la base real.
 *
 * No se limita a mirar el esquema: ejercita el módulo de agenda de punta a
 * punta (crear servicio/profesional/horario → calcular cupos → agendar →
 * provocar una doble reserva a propósito → cancelar) y LIMPIA todo lo que creó,
 * incluso si algo falla.
 *
 * Usa el cliente demo "Estética Aurora" del seed, nunca datos de clientes reales.
 *
 *   npx tsx scripts/_verificar_migraciones.ts
 */
import "./_env"; // PRIMERO: carga .env.local (si no, db() no encuentra las llaves)
import { db } from "../lib/db";
import { disponibilidad, crearCita, citasDe, cambiarEstado, listarServicios } from "../lib/agenda";
import { formatearSlot, fechaChileDe, horaChileAUtc } from "../lib/agendaCore";

const AURORA = "11111111-1111-1111-1111-111111111111";

let ok = 0;
let fallos = 0;
const notas: string[] = [];
function check(nombre: string, cond: boolean, extra?: string) {
  if (cond) {
    ok++;
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos++;
    console.error(`  ✗ ${nombre}${extra ? ` — ${extra}` : ""}`);
  }
}

const supa = db();
const creados = {
  servicioId: null as string | null,
  profesionalId: null as string | null,
  horarioIds: [] as string[],
  citaIds: [] as string[],
  seguimientoIds: [] as string[],
};

async function limpiar() {
  console.log("\n🧹 Limpiando lo creado por esta prueba…");
  for (const id of creados.seguimientoIds) await supa.from("ed_seguimientos").delete().eq("id", id);
  for (const id of creados.citaIds) await supa.from("ed_citas").delete().eq("id", id);
  for (const id of creados.horarioIds) await supa.from("ed_horarios").delete().eq("id", id);
  if (creados.profesionalId) await supa.from("ed_profesionales").delete().eq("id", creados.profesionalId);
  if (creados.servicioId) await supa.from("ed_servicios").delete().eq("id", creados.servicioId);

  // Confirmar que no quedó basura
  const { count: citasQuedan } = await supa
    .from("ed_citas")
    .select("id", { count: "exact", head: true })
    .eq("cliente_id", AURORA);
  const { count: svcQuedan } = await supa
    .from("ed_servicios")
    .select("id", { count: "exact", head: true })
    .eq("cliente_id", AURORA);
  console.log(`   Quedan en Aurora: ${citasQuedan ?? 0} citas, ${svcQuedan ?? 0} servicios (debe ser 0 y 0).`);
}

async function main() {
  console.log("\n═══ 1) ESQUEMA: ¿existen las tablas y columnas? ═══");

  const t1 = await supa.from("ed_servicios").select("id").limit(1);
  check("tabla ed_servicios (220)", !t1.error, t1.error?.message);
  const t2 = await supa.from("ed_profesionales").select("id").limit(1);
  check("tabla ed_profesionales (220)", !t2.error, t2.error?.message);
  const t3 = await supa.from("ed_horarios").select("id").limit(1);
  check("tabla ed_horarios (220)", !t3.error, t3.error?.message);
  const t4 = await supa.from("ed_bloqueos").select("id").limit(1);
  check("tabla ed_bloqueos (220)", !t4.error, t4.error?.message);
  const t5 = await supa.from("ed_citas").select("id").limit(1);
  check("tabla ed_citas (220)", !t5.error, t5.error?.message);
  const t6 = await supa.from("ed_servicio_profesional").select("servicio_id").limit(1);
  check("tabla ed_servicio_profesional (220)", !t6.error, t6.error?.message);

  const c1 = await supa
    .from("ed_clientes")
    .select("slug, reservas_online, confirmacion_automatica, anticipacion_min_horas, horizonte_dias")
    .eq("id", AURORA)
    .maybeSingle();
  check("columnas de config en ed_clientes (220)", !c1.error, c1.error?.message);
  if (!c1.error && c1.data) {
    notas.push(
      `Config de Aurora: reservas_online=${c1.data.reservas_online}, anticipacion=${c1.data.anticipacion_min_horas}h, horizonte=${c1.data.horizonte_dias}d`,
    );
    check("defaults correctos (reservas apagadas, 2h, 30d)",
      c1.data.reservas_online === false && c1.data.anticipacion_min_horas === 2 && c1.data.horizonte_dias === 30,
      JSON.stringify(c1.data));
  }

  const c2 = await supa.from("ed_clientes").select("ical_token").eq("id", AURORA).maybeSingle();
  check("columna ical_token (221)", !c2.error, c2.error?.message);
  const token = (c2.data as { ical_token?: string } | null)?.ical_token ?? "";
  check("ical_token generado y con formato válido", /^[a-f0-9]{48}$/.test(token), `largo ${token.length}`);

  const c3 = await supa
    .from("ed_profesionales")
    .select("gcal_id, gcal_sync, gcal_ultimo_error, gcal_ultima_sync")
    .limit(1);
  check("columnas gcal_* en ed_profesionales (221)", !c3.error, c3.error?.message);

  const c4 = await supa.from("ed_clientes").select("transporte").eq("id", AURORA).maybeSingle();
  check("columna transporte (216)", !c4.error, c4.error?.message);

  console.log("\n═══ 2) MIGRACIÓN 214: ¿acepta los tipos de seguimiento nuevos? ═══");
  const { data: empAurora } = await supa
    .from("ed_empleados")
    .select("id, rol")
    .eq("cliente_id", AURORA)
    .eq("rol", "tino")
    .maybeSingle();
  if (!empAurora) {
    check("empleado Tino de Aurora encontrado", false, "no está el seed");
  } else {
    for (const tipo of ["recordatorio_cita", "confirmacion_cita", "encuesta_postventa"]) {
      const { data, error } = await supa
        .from("ed_seguimientos")
        .insert({
          empleado_id: empAurora.id,
          chat_id: "56900000000",
          tipo,
          plantilla_meta: "texto_libre",
          variables: { texto: "prueba de verificación", prueba: true },
          programado_para: new Date(Date.now() + 86_400_000).toISOString(),
          max_intentos: 1,
          intento: 0,
        })
        .select("id")
        .single();
      check(`tipo '${tipo}' aceptado`, !error, error?.message);
      if (data?.id) creados.seguimientoIds.push(data.id as string);
    }
    // Control negativo: un tipo inventado DEBE ser rechazado por el CHECK.
    const { error: errInvalido } = await supa.from("ed_seguimientos").insert({
      empleado_id: empAurora.id,
      chat_id: "56900000000",
      tipo: "tipo_que_no_existe",
      plantilla_meta: "texto_libre",
      variables: {},
      programado_para: new Date().toISOString(),
    });
    check("un tipo inválido SÍ es rechazado (el CHECK sigue vivo)", !!errInvalido, "se insertó y no debía");
  }

  console.log("\n═══ 3) CIRCUITO REAL: crear agenda, calcular cupos y agendar ═══");

  const { data: svc, error: errSvc } = await supa
    .from("ed_servicios")
    .insert({
      cliente_id: AURORA,
      nombre: "PRUEBA VERIFICACION (borrar)",
      duracion_min: 30,
      precio_clp: 15000,
    })
    .select("id")
    .single();
  check("crear servicio", !errSvc, errSvc?.message);
  creados.servicioId = (svc?.id as string) ?? null;

  const { data: prof, error: errProf } = await supa
    .from("ed_profesionales")
    .insert({ cliente_id: AURORA, nombre: "PRUEBA VERIFICACION (borrar)" })
    .select("id")
    .single();
  check("crear profesional", !errProf, errProf?.message);
  creados.profesionalId = (prof?.id as string) ?? null;

  // Horario todos los días 10:00-19:00 para asegurar cupos disponibles.
  if (creados.profesionalId) {
    const filas = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      profesional_id: creados.profesionalId,
      dia_semana: d,
      desde: "10:00",
      hasta: "19:00",
    }));
    const { data: hs, error: errH } = await supa.from("ed_horarios").insert(filas).select("id");
    check("crear horario semanal (7 tramos)", !errH && (hs?.length ?? 0) === 7, errH?.message);
    creados.horarioIds = (hs ?? []).map((h) => h.id as string);
  }

  const servicios = await listarServicios(AURORA, supa);
  check("listarServicios ve el servicio nuevo", servicios.some((s) => s.id === creados.servicioId));

  const disp = await disponibilidad(AURORA, creados.servicioId!, { supa, maxSlots: 50 });
  check("disponibilidad() responde ok", disp.ok, disp.ok ? "" : (disp as { motivo: string }).motivo);
  if (!disp.ok) {
    await limpiar();
    return;
  }
  check("hay cupos calculados", disp.slots.length > 0, `${disp.slots.length} cupos`);
  notas.push(`Primer cupo ofrecido: ${formatearSlot(disp.slots[0].inicio)} (hora de Chile)`);

  // La hora de pared en Chile del primer cupo debe caer dentro del horario.
  const f = fechaChileDe(new Date(disp.slots[0].inicio));
  const inicioDia = horaChileAUtc(f.anio, f.mes, f.dia, 10, 0).getTime();
  const finDia = horaChileAUtc(f.anio, f.mes, f.dia, 19, 0).getTime();
  const tCupo = Date.parse(disp.slots[0].inicio);
  check("el cupo cae dentro del horario 10:00–19:00 de Chile", tCupo >= inicioDia && tCupo < finDia,
    `${formatearSlot(disp.slots[0].inicio)}`);

  // Respeta la anticipación mínima de 2 horas.
  check("respeta la anticipación mínima (2h)", tCupo >= Date.now() + 2 * 3600_000 - 60_000);

  const slot = disp.slots[0];
  const r1 = await crearCita(
    {
      clienteId: AURORA,
      servicioId: creados.servicioId!,
      profesionalId: slot.profesionalId,
      inicioIso: slot.inicio,
      nombreContacto: "Verificación Automática",
      chatId: "56900000000",
      origen: "portal",
    },
    supa,
  );
  check("crearCita() funciona", r1.ok, r1.ok ? "" : `${r1.motivo} ${r1.detalle ?? ""}`);
  if (r1.ok) creados.citaIds.push(r1.cita.id);

  console.log("\n═══ 4) LA PRUEBA CLAVE: ¿Postgres impide la doble reserva? ═══");
  const r2 = await crearCita(
    {
      clienteId: AURORA,
      servicioId: creados.servicioId!,
      profesionalId: slot.profesionalId,
      inicioIso: slot.inicio,
      nombreContacto: "Segundo Cliente (no debe entrar)",
      chatId: "56911111111",
      origen: "web",
    },
    supa,
  );
  check("el MISMO cupo es rechazado con 'cupo_tomado'", !r2.ok && r2.motivo === "cupo_tomado",
    r2.ok ? "¡SE CREÓ LA DOBLE RESERVA! el constraint no está activo" : `motivo: ${(r2 as { motivo: string }).motivo}`);
  if (r2.ok) creados.citaIds.push(r2.cita.id);

  // Solape parcial: 15 minutos después también debe chocar.
  const parcial = new Date(Date.parse(slot.inicio) + 15 * 60_000).toISOString();
  const r3 = await crearCita(
    {
      clienteId: AURORA,
      servicioId: creados.servicioId!,
      profesionalId: slot.profesionalId,
      inicioIso: parcial,
      nombreContacto: "Solape parcial (no debe entrar)",
      origen: "web",
    },
    supa,
  );
  check("un solape PARCIAL también se rechaza", !r3.ok && r3.motivo === "cupo_tomado",
    r3.ok ? "se creó y no debía" : `motivo: ${(r3 as { motivo: string }).motivo}`);
  if (r3.ok) creados.citaIds.push(r3.cita.id);

  // El cupo tomado ya no debe aparecer en disponibilidad.
  const disp2 = await disponibilidad(AURORA, creados.servicioId!, { supa, maxSlots: 50 });
  if (disp2.ok) {
    check("el cupo ocupado desaparece de la disponibilidad",
      !disp2.slots.some((s) => s.inicio === slot.inicio));
  }

  console.log("\n═══ 5) Lectura y cambio de estado ═══");
  const misCitas = await citasDe(AURORA, "56900000000", supa);
  check("citasDe() encuentra la cita del contacto", misCitas.some((c) => c.id === creados.citaIds[0]));

  if (creados.citaIds[0]) {
    const rc = await cambiarEstado(AURORA, creados.citaIds[0], "cancelada", supa);
    check("cambiarEstado() a cancelada", rc.ok, rc.error);

    // Cancelada libera el cupo: ahora sí debe poder reservarse.
    const r4 = await crearCita(
      {
        clienteId: AURORA,
        servicioId: creados.servicioId!,
        profesionalId: slot.profesionalId,
        inicioIso: slot.inicio,
        nombreContacto: "Después de cancelar (sí debe entrar)",
        origen: "web",
      },
      supa,
    );
    check("al cancelar, el cupo queda libre de nuevo", r4.ok,
      r4.ok ? "" : (r4 as { motivo: string }).motivo);
    if (r4.ok) creados.citaIds.push(r4.cita.id);
  }

  console.log("\n═══ 6) Aislamiento: otro cliente no ve nada de esto ═══");
  const NOGAL = "22222222-2222-2222-2222-222222222222";
  const svcNogal = await listarServicios(NOGAL, supa);
  check("Barbería Nogal NO ve los servicios de Aurora",
    !svcNogal.some((s) => s.id === creados.servicioId), `${svcNogal.length} servicios`);
  const dispCruzada = await disponibilidad(NOGAL, creados.servicioId!, { supa });
  check("no se puede pedir disponibilidad de un servicio ajeno",
    !dispCruzada.ok && dispCruzada.motivo === "servicio_invalido");
}

main()
  .catch((e) => {
    fallos++;
    console.error("\n💥 Excepción:", (e as Error).message);
  })
  .finally(async () => {
    await limpiar();
    if (notas.length) {
      console.log("\n📋 Datos observados:");
      for (const n of notas) console.log(`   · ${n}`);
    }
    console.log(`\n═══ RESULTADO: ${ok} OK, ${fallos} fallos ═══\n`);
    process.exit(fallos > 0 ? 1 : 0);
  });
