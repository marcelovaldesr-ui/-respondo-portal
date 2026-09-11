import { db } from "@/lib/db";
import { obtenerUsuarioPortal } from "@/lib/auth";
import { esAdminRespondo } from "@/lib/adminRespondo";
import { leerProcesos, type ProcesoLeido } from "@/lib/procesos";

export const dynamic = "force-dynamic";

/**
 * Guarda de acceso: el diagnóstico expone conteos internos y nombres de
 * variables, así que NO puede ser público.
 *  - Si la config base está rota (no hay Supabase), obtenerUsuarioPortal lanza
 *    → mostramos SOLO el chequeo de variables (nombres, sin valores ni conteos),
 *    que es justo para lo que sirve esta página en ese escenario.
 *  - Si la config está OK pero nadie inició sesión → no mostramos nada sensible.
 */
async function usuarioAutorizado(): Promise<{ sesion: boolean; admin: boolean }> {
  try {
    const u = await obtenerUsuarioPortal();
    // Conteos globales y procesos internos: SOLO equipo Respondo (Fase 0).
    // Un usuario de un negocio ve que el portal conecta, nada más.
    return { sesion: Boolean(u), admin: esAdminRespondo(u?.email) };
  } catch {
    return { sesion: false, admin: false }; // config rota: se maneja abajo mostrando solo el env-check
  }
}

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
  const { sesion, admin } = await usuarioAutorizado();
  const autorizado = sesion;

  // Env-check base: nombres de variables faltantes, sin valores ni conteos.
  // Es lo único que se muestra a quien NO ha iniciado sesión (o si todo está roto).
  const faltantes = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter((v) => !process.env[v]);

  if (!autorizado) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="text-[13px] font-bold uppercase tracking-widest text-marca-indigo">
          Respondo · Diagnóstico
        </div>
        <h1 className="mt-3 text-[26px] font-bold text-marca-tinta">Estado del portal</h1>
        <div className="mt-6 rounded-2xl border border-[#E6E8EF] bg-white p-6">
          <div className="font-bold">Variables de entorno</div>
          {faltantes.length === 0 ? (
            <p className="mt-1 text-[#16A34A]">Todas configuradas.</p>
          ) : (
            <p className="mt-1 text-[#B91C1C]">
              Faltan en <code>.env.local</code>: {faltantes.join(", ")}
            </p>
          )}
          <p className="mt-4 text-[13px] text-[#5B6981]">
            Inicia sesión para ver el diagnóstico completo.{" "}
            <a href="/login" className="font-semibold underline">Entrar</a>
          </p>
        </div>
      </main>
    );
  }

  const r = await chequear();
  const procesos: ProcesoLeido[] | null = admin ? await leerProcesos() : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="text-[13px] font-bold uppercase tracking-widest text-marca-indigo">
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
            {admin && (
              <>
                <li>Clientes (ed_clientes): {r.clientes}</li>
                <li>Empleados IA (ed_empleados): {r.empleados}</li>
                <li>Usuarios del portal (portal_usuarios): {r.usuarios}</li>
              </>
            )}
          </ul>
        ) : (
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]">
            {r.error}
          </pre>
        )}
      </div>

      {admin && (
        <div className="mt-6 rounded-2xl border border-[#E6E8EF] bg-white p-6">
          <div className="font-bold">Procesos automáticos (cron)</div>
          {procesos === null ? (
            <p className="mt-1 text-[#5B6981]">Sin registro (falta la migración 260).</p>
          ) : procesos.length === 0 ? (
            <p className="mt-1 text-[#5B6981]">Todavía no hay corridas registradas.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="text-[#5B6981]">
                    <th className="py-1 pr-3">Proceso</th>
                    <th className="py-1 pr-3">Estado</th>
                    <th className="py-1 pr-3">Última corrida</th>
                    <th className="py-1">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {procesos.map((p) => {
                    const d = (p.detalle ?? {}) as { errores?: { clienteId: string | null; error: string; en: string }[] };
                    const ultimo = d.errores?.[0];
                    return (
                      <tr key={p.nombre} className="border-t border-[#E6E8EF] align-top">
                        <td className="py-1 pr-3 font-semibold">{p.nombre}</td>
                        <td
                          className={`py-1 pr-3 ${
                            p.estado === "fallando" ? "text-[#B91C1C]" : p.estado === "con_errores" ? "text-[#B45309]" : "text-[#16A34A]"
                          }`}
                        >
                          {p.estado}
                        </td>
                        <td className="py-1 pr-3 whitespace-nowrap">{p.ultimoEn ?? "—"}</td>
                        <td className="py-1">
                          {p.texto}
                          {ultimo?.clienteId ? ` · negocio ${ultimo.clienteId.slice(0, 8)}` : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
