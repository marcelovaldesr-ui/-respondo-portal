/**
 * Verifica la migración 250 contra la base REAL.
 *
 * No basta con que el SQL haya corrido sin error: lo que importa es que el
 * resumen de cada contacto CUADRE con los mensajes que ya existen. Si el
 * relleno inicial quedó corto, las tres pantallas que ahora leen esas columnas
 * mostrarían menos conversaciones de las que hay, y en silencio — que es
 * exactamente el tipo de falla que ya nos pasó una vez.
 *
 * Correr:  npx tsx scripts/_verificar_250.ts
 */
import "./_env";
import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/** Trae TODAS las filas paginando: PostgREST corta en 1.000 aunque pidas más. */
async function todas<T>(tabla: string, columnas: string, filtro?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    let q = supa.from(tabla).select(columnas).range(desde, desde + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(`${tabla}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  let fallas = 0;
  const mal = (m: string) => {
    console.log(`  ✗ ${m}`);
    fallas++;
  };
  const bien = (m: string) => console.log(`  ✓ ${m}`);

  // 1) ¿Existen las columnas?
  console.log("\n1. Columnas nuevas en ed_contactos");
  const { error: e1 } = await supa
    .from("ed_contactos")
    .select(
      "chat_id, ultimo_mensaje_en, ultimo_mensaje_texto, ultimo_mensaje_rol, ultimo_empleado_id, primer_mensaje_en, total_mensajes",
    )
    .limit(1);
  if (e1) {
    mal(`no se pueden leer: ${e1.message}`);
    console.log("\n   La migración 250 NO está aplicada. Detengo la verificación.");
    process.exit(1);
  }
  bien("las 6 columnas existen y se leen");

  // 2) ¿El relleno cuadra con los mensajes reales?
  console.log("\n2. El resumen cuadra con ed_mensajes");
  const empleados = await todas<{ id: string; cliente_id: string }>(
    "ed_empleados",
    "id, cliente_id",
  );
  const clientePorEmpleado = new Map(empleados.map((e) => [e.id, e.cliente_id]));

  const mensajes = await todas<{ empleado_id: string; chat_id: string; creado_en: string }>(
    "ed_mensajes",
    "empleado_id, chat_id, creado_en",
  );
  console.log(`   (${mensajes.length.toLocaleString("es-CL")} mensajes en total)`);

  // Agregado real, calculado acá
  const real = new Map<string, { total: number; ultimo: string; primero: string }>();
  for (const m of mensajes) {
    const cli = clientePorEmpleado.get(m.empleado_id);
    if (!cli) continue;
    const k = `${cli}|${m.chat_id}`;
    const a = real.get(k);
    if (!a) real.set(k, { total: 1, ultimo: m.creado_en, primero: m.creado_en });
    else {
      a.total++;
      if (m.creado_en > a.ultimo) a.ultimo = m.creado_en;
      if (m.creado_en < a.primero) a.primero = m.creado_en;
    }
  }

  const contactos = await todas<{
    cliente_id: string;
    chat_id: string;
    ultimo_mensaje_en: string | null;
    total_mensajes: number | null;
  }>("ed_contactos", "cliente_id, chat_id, ultimo_mensaje_en, total_mensajes");
  const guardado = new Map(contactos.map((c) => [`${c.cliente_id}|${c.chat_id}`, c]));

  let faltantes = 0;
  let totalMal = 0;
  let fechaMal = 0;
  const ejemplos: string[] = [];

  for (const [k, r] of real) {
    const g = guardado.get(k);
    if (!g) {
      faltantes++;
      if (ejemplos.length < 3) ejemplos.push(`sin ficha: ${k} (${r.total} mensajes)`);
      continue;
    }
    if ((g.total_mensajes ?? 0) !== r.total) {
      totalMal++;
      if (ejemplos.length < 3)
        ejemplos.push(`total ${k}: guardado ${g.total_mensajes} vs real ${r.total}`);
    }
    // Se compara al segundo: el formato de timestamp puede diferir en decimales.
    const a = (g.ultimo_mensaje_en ?? "").slice(0, 19);
    const b = r.ultimo.slice(0, 19);
    if (a !== b) {
      fechaMal++;
      if (ejemplos.length < 3) ejemplos.push(`fecha ${k}: guardado ${a} vs real ${b}`);
    }
  }

  console.log(`   ${real.size} conversaciones con mensajes`);
  faltantes ? mal(`${faltantes} sin fila en ed_contactos`) : bien("todas tienen ficha");
  totalMal ? mal(`${totalMal} con total_mensajes distinto`) : bien("total_mensajes cuadra");
  fechaMal ? mal(`${fechaMal} con ultimo_mensaje_en distinto`) : bien("ultimo_mensaje_en cuadra");
  if (ejemplos.length) {
    console.log("   ejemplos:");
    ejemplos.forEach((e) => console.log(`     · ${e}`));
  }

  // 3) ¿El trigger está vivo? Se prueba con lo que ya existe, sin escribir nada.
  console.log("\n3. Cobertura del empleado que atiende");
  const sinEmpleado = contactos.filter(
    (c) => c.ultimo_mensaje_en && !(c as any).ultimo_empleado_id,
  ).length;
  const conResumen = contactos.filter((c) => c.ultimo_mensaje_en).length;
  console.log(`   ${conResumen} contactos con resumen`);
  // ultimo_empleado_id no vino en el select de arriba; se consulta aparte.
  const conEmp = await todas<{ ultimo_empleado_id: string | null }>(
    "ed_contactos",
    "ultimo_empleado_id",
    (q) => q.not("ultimo_mensaje_en", "is", null),
  );
  const huerfanos = conEmp.filter((c) => !c.ultimo_empleado_id).length;
  huerfanos
    ? mal(`${huerfanos} sin ultimo_empleado_id (la bandeja los enlazaría al empleado equivocado)`)
    : bien("todos tienen empleado asignado");
  void sinEmpleado;

  // 4) Lo que ve la bandeja, que es el número que importa
  console.log("\n4. Lo que va a mostrar la bandeja");
  const porCliente = new Map<string, number>();
  for (const c of contactos) {
    if (!c.ultimo_mensaje_en) continue;
    porCliente.set(c.cliente_id, (porCliente.get(c.cliente_id) ?? 0) + 1);
  }
  const clientes = await todas<{ id: string; nombre: string }>("ed_clientes", "id, nombre");
  for (const cl of clientes) {
    const n = porCliente.get(cl.id) ?? 0;
    console.log(`   ${cl.nombre}: ${n} conversaciones`);
  }

  console.log(
    fallas === 0
      ? "\n✅ Migración 250 verificada. Se puede desplegar.\n"
      : `\n❌ ${fallas} problema(s). NO desplegar todavía.\n`,
  );
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n💥", e.message);
  process.exit(1);
});
