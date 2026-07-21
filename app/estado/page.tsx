import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Diagnóstico. Confirma que el portal se conecta a la Supabase del motor 2.0
// y que la migración 200 está aplicada. Útil cuando algo no carga.
async function chequear() {
  const faltantes = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter((v) => !process.env[v]);

  try {
    const supa = db();
    const [clientes, empleados, usuarios] = await Promise.all([
      supa.from("ed_clientes").select("*", { count: "exact", head: true }),
      supa.from("ed_empleados").select("*", { count: "exact", head: true }),
      supa.from("portal_usuarios").select("*", { count: "exact", head: true }),
    ]);
    return {
      ok: true as const,
      faltantes,
      clientes: clientes.count,
      empleados: empleados.count,
      usuarios: usuarios.count,
    };
  } catch (e) {
    return { ok: false as const, faltantes, error: (e as Error).message };
  }
}

export default async function Estado() {
  const r = await chequear();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="text-[13px] font-extrabold uppercase tracking-widest text-marca-indigo">
        Respondo · Diagnóstico
      </div>
      <h1 className="mt-3 text-[26px] font-bold text-marca-tinta">
        Estado del portal
      </h1>

      <div className="mt-6 rounded-2xl border border-[#E6E8EF] bg-white p-6">
        <div className="font-bold">Variables de entorno</div>
        {r.faltantes.length === 0 ? (
          <p className="mt-1 text-[#16A34A]">Todas configuradas.</p>
        ) : (
          <p className="mt-1 text-[#B91C1C]">
            Faltan en <code>.env.local</code>: {r.faltantes.join(", ")}
          </p>
        )}

        <div className="mt-5 font-bold">Conexión a Supabase</div>
        {r.ok ? (
          <ul className="mt-1 list-disc pl-5">
            <li className="text-[#16A34A]">Conexión OK</li>
            <li>Clientes (ed_clientes): {r.clientes}</li>
            <li>Empleados IA (ed_empleados): {r.empleados}</li>
            <li>Usuarios del portal (portal_usuarios): {r.usuarios}</li>
          </ul>
        ) : (
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]">
            {r.error}
          </pre>
        )}
      </div>
    </main>
  );
}
