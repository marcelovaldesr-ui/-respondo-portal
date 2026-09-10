import "./_env";
import { db } from "../lib/db";
import {
  DIAS_MAX,
  DIAS_MIN,
  cuposDisponibles,
  decidirCotizacion,
  type Candidato,
} from "../lib/generadorCotizacionCore";
import { empleadosDelCliente, juzgarCotizacion } from "../lib/juezCotizacion";
import { decidirConJuez } from "../lib/juezCotizacionCore";
import { plantillaPara, render, limpiarParam } from "../lib/plantillas";

/**
 * SIMULACIÓN DE BETO — A QUIÉN LE ESCRIBIRÍA HOY, Y POR QUÉ. **NO ENVÍA NADA.**
 *
 * POR QUÉ EXISTE (9-sep-2026)
 * ---------------------------
 * `cotizacion_seguimiento` está apagado en Impresora Color y cada plantilla que
 * mandaría cuesta ~$85 de MARKETING. Encenderlo a ciegas es decidir un gasto
 * sin haber visto nunca la lista. Esto imprime exactamente esa lista —la misma
 * consulta, la misma reja y el mismo juez que usaría el generador— para poder
 * mirarla antes de gastar un peso.
 *
 * ⚠️ NO ESCRIBE EN NINGUNA TABLA. No llama a `programarSeguimiento` ni inserta
 * en `ed_seguimientos` ni en `ed_propuestas_seguimiento`. Lo único que gasta
 * son las llamadas al juez (centavos con Gemini Flash).
 *
 * USO:
 *   npx tsx scripts/_simular_beto.ts --cliente "Impresora Color"
 *   npx tsx scripts/_simular_beto.ts --cliente "Impresora Color" --limite 15
 *   npx tsx scripts/_simular_beto.ts --cliente "Impresora Color" --sin-juez
 *
 * `--limite` topea cuántos candidatos van al juez (default: todos los que pasen
 * la reja). `--sin-juez` corre solo la reja, gratis y en segundos.
 */

function arg(nombre: string, porDefecto = ""): string {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}
const bandera = (nombre: string) => process.argv.includes(`--${nombre}`);

const NOMBRE_CLIENTE = arg("cliente", "Impresora Color");
const LIMITE = Number(arg("limite", "0")) || 0;
const SIN_JUEZ = bandera("sin-juez");

function dias(desde: string | null): number {
  if (!desde) return -1;
  return Math.floor((Date.now() - new Date(desde).getTime()) / 86_400_000);
}

async function main() {
  const supa = db();

  const { data: cli } = await supa
    .from("ed_clientes")
    .select("id, nombre, rubro, cotizacion_seguimiento, cotizacion_tope_diario")
    .ilike("nombre", NOMBRE_CLIENTE)
    .maybeSingle();

  if (!cli) {
    console.error(`No existe el cliente "${NOMBRE_CLIENTE}".`);
    process.exit(1);
  }

  const clienteId = cli.id as string;
  const topeDiario = (cli.cotizacion_tope_diario as number | null) ?? 10;

  console.log("=".repeat(78));
  console.log(`SIMULACIÓN DE BETO · ${cli.nombre}   (NO SE ENVÍA NADA)`);
  console.log(`interruptor cotizacion_seguimiento: ${cli.cotizacion_seguimiento ? "ENCENDIDO ⚠️" : "apagado"}`);
  console.log(`tope diario: ${topeDiario} envíos · ventana: ${DIAS_MIN}-${DIAS_MAX} días`);
  console.log(`fecha de la corrida: ${new Date().toISOString()}`);
  console.log("=".repeat(78));

  const { data: beto } = await supa
    .from("ed_empleados")
    .select("id, nombre_publico")
    .eq("cliente_id", clienteId)
    .eq("rol", "rita") // ⚠️ el rol de Beto en la base es "rita" (resabio)
    .eq("activo", true)
    .maybeSingle();

  if (!beto) {
    console.error("Este cliente no tiene a Beto activo: el generador se quedaría mudo.");
    process.exit(1);
  }
  const betoId = beto.id as string;

  // ── La misma consulta del generador, sin cambiar una coma ─────────────────
  const ahora = Date.now();
  const desde = new Date(ahora - DIAS_MAX * 86_400_000).toISOString();
  const hasta = new Date(ahora - DIAS_MIN * 86_400_000).toISOString();

  const { data: contactos } = await supa
    .from("ed_contactos")
    .select("chat_id, nombre, etapa, etiquetas, ultimo_mensaje_en, ultimo_mensaje_rol, ultimo_mensaje_texto")
    .eq("cliente_id", clienteId)
    .gte("ultimo_mensaje_en", desde)
    .lte("ultimo_mensaje_en", hasta)
    .order("ultimo_mensaje_en", { ascending: true })
    .limit(300);

  const total = contactos?.length ?? 0;
  console.log(`\nContactos en la ventana de ${DIAS_MIN}-${DIAS_MAX} días: ${total}`);
  if (total === 300) {
    console.log("⚠️  Son exactamente 300 = el límite de la consulta. Puede haber más quedando fuera.");
  }
  if (!total) return;

  const chatIds = (contactos ?? []).map((c) => c.chat_id as string);

  const { data: previos } = await supa
    .from("ed_seguimientos")
    .select("chat_id, programado_para")
    .eq("empleado_id", betoId)
    .eq("tipo", "cotizacion_sin_respuesta")
    .in("chat_id", chatIds)
    .limit(1000);

  const ultimoSeg = new Map<string, string>();
  for (const s of previos ?? []) {
    const k = s.chat_id as string;
    const v = s.programado_para as string;
    const prev = ultimoSeg.get(k);
    if (!prev || v > prev) ultimoSeg.set(k, v);
  }

  const pagados = new Set<string>();
  const { data: pagos } = await supa
    .from("ed_pagos")
    .select("chat_id, monto, concepto")
    .eq("cliente_id", clienteId)
    .eq("estado", "pagado")
    .gte("creado_en", desde)
    .in("chat_id", chatIds)
    .limit(1000);
  for (const p of pagos ?? []) pagados.add(p.chat_id as string);
  console.log(`Cobros pagados en la ventana que cruzan con estos chats: ${pagados.size}`);

  // ── La reja (gratis) ──────────────────────────────────────────────────────
  const motivos = new Map<string, number>();
  const pasanReja: { chatId: string; nombre: string; diasEsperando: number; ultimo: string }[] = [];

  for (const c of contactos ?? []) {
    const chatId = c.chat_id as string;
    const cand: Candidato = {
      chatId,
      etiquetas: (c.etiquetas as string[] | null) ?? [],
      etapa: (c.etapa as string | null) ?? null,
      ultimoMensajeEn: (c.ultimo_mensaje_en as string | null) ?? null,
      ultimoRol: (c.ultimo_mensaje_rol as string | null) ?? null,
      ultimoSeguimientoEn: ultimoSeg.get(chatId) ?? null,
      pagoPagadoEnVentana: pagados.has(chatId),
    };
    const v = decidirCotizacion(cand, ahora);
    if (v.enviar) {
      pasanReja.push({
        chatId,
        nombre: ((c.nombre as string | null) || "").trim(),
        diasEsperando: v.diasEsperando,
        ultimo: ((c.ultimo_mensaje_texto as string | null) ?? "").replace(/\s+/g, " ").slice(0, 110),
      });
    } else {
      // Se agrupan los motivos con número variable ("solo 2 día(s)") para que
      // el resumen no tenga 200 líneas distintas.
      const clave = v.motivo.replace(/\d+/g, "N");
      motivos.set(clave, (motivos.get(clave) ?? 0) + 1);
    }
  }

  console.log("\n── POR QUÉ SE DESCARTAN (reja barata, sin modelo) ".padEnd(78, "─"));
  for (const [m, n] of [...motivos.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${m}`);
  }
  console.log(`\n  → pasan la reja: ${pasanReja.length}`);

  const cupo = cuposDisponibles({ topeDiario, enviadosHoy: 0, candidatos: pasanReja.length });
  console.log(`  → con el tope diario de ${topeDiario}, hoy saldrían ${cupo} (los más antiguos primero)`);
  console.log(`  → costo si se enviaran los ${cupo}: ~$${(cupo * 85).toLocaleString("es-CL")}`);

  if (SIN_JUEZ || !pasanReja.length) return;

  // ── El juez (una llamada al modelo por candidato) ─────────────────────────
  const empleadoIds = await empleadosDelCliente(clienteId, supa);
  const aJuzgar = LIMITE > 0 ? pasanReja.slice(0, LIMITE) : pasanReja;

  console.log(`\n── VEREDICTO DEL JUEZ (${aJuzgar.length} candidatos, ${empleadoIds.length} empleados en el hilo) `.padEnd(78, "─"));

  const plantilla = plantillaPara("cotizacion_sin_respuesta");
  let sí = 0;
  let no = 0;
  let nulos = 0;

  for (const [i, cand] of aJuzgar.entries()) {
    const t0 = Date.now();
    const v = await juzgarCotizacion({
      chatId: cand.chatId,
      negocio: cli.nombre as string,
      diasEsperando: cand.diasEsperando,
      empleadoIds,
      supa,
    });
    const d = decidirConJuez(v);
    if (v.abierta === true) sí++;
    else if (v.abierta === false) no++;
    else nulos++;

    const marca = v.abierta === true ? "✅ ESCRIBIR" : v.abierta === false ? "⛔ NO" : "⚠️  NO SE PUDO";
    console.log(
      `\n${String(i + 1).padStart(3)}. ${marca}  ${cand.nombre || "(sin nombre)"}  ·  ${cand.chatId}  ·  ${cand.diasEsperando} días  ·  ${v.mensajes.length} msj  ·  ${Date.now() - t0} ms`,
    );
    console.log(`     último mensaje del hilo: ${cand.ultimo || "(vacío)"}`);
    console.log(`     juez: ${d.motivo}`);
    if (v.abierta === true) {
      console.log(`     qué se cotizó: ${d.cotizado}`);
      if (plantilla) {
        const texto = render(plantilla.cuerpo, [
          limpiarParam(cand.nombre || "hola"),
          limpiarParam(cli.nombre as string),
          limpiarParam(d.cotizado),
        ]);
        console.log(`     saldría: ${(texto ?? "(la plantilla no renderiza)").replace(/\n+/g, " ⏎ ")}`);
      }
    }
  }

  console.log("\n" + "=".repeat(78));
  console.log(`RESUMEN · de ${total} contactos en la ventana, ${pasanReja.length} pasaron la reja.`);
  console.log(`El juez revisó ${aJuzgar.length}: ${sí} abiertas · ${no} cerradas · ${nulos} sin determinar.`);
  console.log(`Beto escribiría a ${Math.min(sí, topeDiario)} hoy  →  ~$${(Math.min(sí, topeDiario) * 85).toLocaleString("es-CL")}`);
  console.log(`El juez evitó ${no + nulos} envíos que la reja sola habría dejado pasar  →  ~$${((no + nulos) * 85).toLocaleString("es-CL")} ahorrados.`);
  console.log("NO SE ENVIÓ NI SE GUARDÓ NADA.");
  console.log("=".repeat(78));
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
