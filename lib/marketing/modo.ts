import { cookies } from "next/headers";

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

export async function modoDemo(): Promise<boolean> {
  try {
    const store = await cookies();
    return store.get(COOKIE)?.value === "1";
  } catch {
    return false;
  }
}

export async function fijarModoDemo(activo: boolean): Promise<void> {
  const store = await cookies();
  if (activo) {
    store.set({
      name: COOKIE,
      value: "1",
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
