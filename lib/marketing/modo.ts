import { cookies } from "next/headers";
import type { VarianteDemo } from "@/lib/marketing/demo";

/**
 * MODO DEMOSTRACIÓN — un interruptor, no un ambiente.
 *
 * Se guarda en una cookie del navegador (`mk_demo`), no en la base: es una
 * preferencia de QUIEN MIRA, no del negocio. Un vendedor de Respondo puede
 * encenderlo para mostrar el producto y apagarlo al terminar sin dejar rastro
 * en los datos del cliente.
 *
 * Con el modo encendido, `datos.ts` sirve los fixtures de `demo.ts` y NADA se
 * escribe en la base. Todas las pantallas muestran la píldora «Datos de
 * demostración»: la persona nunca puede confundir lo que ve con su negocio.
 */

const COOKIE = "mk_demo";

/**
 * QUÉ NEGOCIO SE DEMUESTRA (Fase 6).
 *
 * La cookie guardaba «1» y alcanzaba cuando había un solo tipo de cliente. Hoy
 * hay tres formas distintas de usar Marketing y cada una se ve distinta, así
 * que la demo tiene que poder mostrarlas: un negocio que solo pauta en Meta, uno
 * que solo pauta en Google, y uno con el circuito cerrado completo.
 *
 * ⚠️ «1» SIGUE VALIENDO y significa «completo». Una cookie vieja en el
 * navegador de alguien que estaba mostrando el producto no puede romperse
 * porque nosotros cambiamos el formato.
 */
const VARIANTES: VarianteDemo[] = ["completo", "meta", "google"];

function leerVariante(valor: string | undefined): VarianteDemo | null {
  if (!valor) return null;
  if (valor === "1") return "completo";
  return VARIANTES.includes(valor as VarianteDemo) ? (valor as VarianteDemo) : null;
}

export async function modoDemo(): Promise<boolean> {
  return (await varianteDemo()) !== null;
}

/** Qué variante está encendida, o null si la demostración está apagada. */
export async function varianteDemo(): Promise<VarianteDemo | null> {
  try {
    const store = await cookies();
    return leerVariante(store.get(COOKIE)?.value);
  } catch {
    return null;
  }
}

export async function fijarModoDemo(activo: boolean, variante: VarianteDemo = "completo"): Promise<void> {
  const store = await cookies();
  if (activo) {
    store.set({
      name: COOKIE,
      value: variante,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // Se apaga sola después de un día: nadie se queda viendo datos de
      // mentira por haber olvidado apagarla.
      maxAge: 60 * 60 * 24,
    });
  } else {
    store.set({ name: COOKIE, value: "", path: "/", maxAge: 0 });
  }
}

/**
 * Lo que necesita cualquier pantalla para cargar el Panorama: si la demo está
 * encendida y cuál. Un solo lugar para no repetir la lectura de la cookie —y,
 * sobre todo, para que agregar una variante mañana no obligue a tocar ocho
 * páginas.
 */
export async function opcionesDemo(): Promise<{ demo: boolean; variante: VarianteDemo }> {
  const v = await varianteDemo();
  return { demo: v !== null, variante: v ?? "completo" };
}
