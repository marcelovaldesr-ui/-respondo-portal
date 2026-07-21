import { redirect } from "next/navigation";
import { supabaseServidor } from "@/lib/supabaseAuth";

export const dynamic = "force-dynamic";

// Puerta de entrada: con sesión va al portal, sin sesión al login.
//
// OJO: redirect() de Next funciona lanzando una excepción interna
// (NEXT_REDIRECT). Por eso NUNCA va dentro de un try/catch — el catch se la
// tragaría y el redirect no ocurriría. Se calcula el estado adentro y se
// redirige afuera.
export default async function Home() {
  let logueado = false;
  let configOk = true;

  try {
    const supa = supabaseServidor();
    const {
      data: { user },
    } = await supa.auth.getUser();
    logueado = Boolean(user);
  } catch {
    configOk = false; // faltan variables de entorno
  }

  if (!configOk) redirect("/estado");
  redirect(logueado ? "/inicio" : "/login");
}
