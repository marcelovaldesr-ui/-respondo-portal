"use client";

import type { DetalleConversacion } from "@/lib/conversaciones";

/**
 * CACHÉ DE CONVERSACIONES DEL NAVEGADOR.
 *
 * ⚠️ POR QUÉ EXISTE ESTE ARCHIVO: LA PRECARGA ANTERIOR NO SERVÍA PARA NADA.
 *
 * Al pasar el mouse por una fila se disparaba un `fetch` del detalle "para
 * adelantar trabajo". Pero **la respuesta se tiraba a la basura**: no se
 * guardaba en ningún lado, y el endpoint responde `Cache-Control: no-store`, así
 * que el navegador tampoco la conservaba. Lo único que lograba era calentar la
 * función de Vercel.
 *
 * Al hacer clic se volvía a pedir todo desde cero. La precarga era decorativa.
 *
 * Acá la precarga y la lectura comparten el MISMO almacén, así que pasar el
 * mouse por una fila hace que el clic sea instantáneo de verdad.
 *
 * DOS NIVELES, A PROPÓSITO
 * ------------------------
 *  - **Memoria**: instantáneo, se pierde al recargar.
 *  - **sessionStorage**: sobrevive a recargas y a cerrar y abrir la pestaña
 *    dentro de la misma sesión. Se usa `session` y no `local` porque son
 *    conversaciones de clientes reales: no deben quedar en el disco de nadie
 *    más tiempo del necesario.
 *
 * Lo que se guarda es solo un ADELANTO. El transporte en vivo se encarga de
 * ponerlo al día en menos de un segundo, así que servir algo de hace un minuto
 * no muestra nada falso: muestra lo mismo, un instante antes.
 */

const memoria = new Map<string, DetalleConversacion>();
/** Peticiones en curso, para no pedir dos veces lo mismo al pasar el mouse. */
const enVuelo = new Map<string, Promise<DetalleConversacion | null | undefined>>();

/**
 * ⚠️ LA VERSIÓN EN EL PREFIJO INVALIDA EL CACHÉ VIEJO EN CADA CAMBIO DE FORMA.
 *
 * sessionStorage sobrevive al deploy. Cuando `DetalleConversacion` gana campos
 * (pagos, rubro, puedeAvisarPedido…), lo guardado con la forma anterior queda
 * incompleto y puede romper componentes que asumen el campo nuevo. Subir la
 * versión acá hace que lo viejo simplemente no se encuentre y se vuelva a pedir.
 * Súbela cada vez que cambies el tipo del detalle.
 */
const PREFIJO = "respondo:chat:v3:";
/**
 * Cuánto se acepta de sessionStorage. Diez minutos: pasado eso, la conversación
 * pudo cambiar tanto que mostrarla completa antes de refrescar sería confuso.
 * En memoria no caduca porque el stream la mantiene viva.
 */
const VIGENCIA_MS = 10 * 60_000;

export function clave(empleadoId: string, chatId: string): string {
  return `${empleadoId}|${chatId}`;
}

/** Lee de memoria y, si no está, de sessionStorage. */
export function leer(k: string): DetalleConversacion | null {
  const enMemoria = memoria.get(k);
  if (enMemoria) return enMemoria;

  try {
    const crudo = sessionStorage.getItem(PREFIJO + k);
    if (!crudo) return null;
    const { en, d } = JSON.parse(crudo) as { en: number; d: DetalleConversacion };
    if (Date.now() - en > VIGENCIA_MS) {
      sessionStorage.removeItem(PREFIJO + k);
      return null;
    }
    memoria.set(k, d);
    return d;
  } catch {
    // Modo incógnito con almacenamiento bloqueado, o JSON corrupto.
    return null;
  }
}

export function guardar(k: string, d: DetalleConversacion): void {
  memoria.set(k, d);
  try {
    sessionStorage.setItem(PREFIJO + k, JSON.stringify({ en: Date.now(), d }));
  } catch {
    /**
     * Sin espacio o almacenamiento bloqueado. La memoria ya quedó, que es lo
     * que importa; perder la parte persistente no rompe nada.
     */
  }
}

export function olvidar(k: string): void {
  memoria.delete(k);
  try {
    sessionStorage.removeItem(PREFIJO + k);
  } catch {
    /* sin almacenamiento */
  }
}

/**
 * Pide el detalle y lo guarda. Si ya está, no pide nada.
 *
 * `enVuelo` evita el caso real de pasar el mouse por una fila y hacer clic de
 * inmediato: sin él serían dos peticiones idénticas compitiendo, y la segunda
 * no llegaría antes por ser la segunda.
 */
/**
 * Devuelve el detalle; `null` si el servidor dijo que NO EXISTE (404: enlace
 * viejo o chat de otro negocio); `undefined` si no se pudo saber (red, 5xx).
 * La distinción importa para no decirle «corte de conexión» a alguien que
 * abrió un enlace que ya no vale (auditoría 3-sep-2026).
 */
export function traer(
  empleadoId: string,
  chatId: string,
  opts: { forzar?: boolean } = {},
): Promise<DetalleConversacion | null | undefined> {
  const k = clave(empleadoId, chatId);

  if (!opts.forzar) {
    const guardado = leer(k);
    if (guardado) return Promise.resolve(guardado);
  }

  // La deduplicación se comprueba SIEMPRE, también al forzar: si ya hay una
  // petición idéntica viajando, sumar otra no la hace llegar antes.
  const yaVa = enVuelo.get(k);
  if (yaVa) return yaVa;

  const p = fetch(
    `/api/conversaciones/detalle?emp=${encodeURIComponent(empleadoId)}&chat=${encodeURIComponent(chatId)}`,
    { cache: "no-store" },
  )
    .then((r) =>
      r.ok ? (r.json() as Promise<DetalleConversacion>) : r.status === 404 ? null : undefined,
    )
    .then((d) => {
      if (d) guardar(k, d);
      return d;
    })
    .catch(() => undefined)
    .finally(() => {
      enVuelo.delete(k);
    });

  enVuelo.set(k, p);
  return p;
}

/**
 * Precarga en segundo plano las primeras conversaciones de la lista.
 *
 * POR QUÉ: la precarga al pasar el mouse no cubre el PRIMER clic —nadie pasa el
 * mouse antes de decidir— ni sirve en un teléfono, donde no hay mouse. Adelantar
 * las de arriba mientras el navegador está desocupado hace que la mayoría de los
 * primeros clics ya no esperen nada.
 *
 * Es lo mismo que hace WhatsApp Web al abrir: cuando llegas, las recientes ya
 * están.
 *
 * De a una y espaciadas: son peticiones reales contra la base y no vale la pena
 * pelearle ancho de banda a lo que la persona está mirando ahora.
 */
export function precargarLista(
  filas: { empleadoId: string; chatId: string }[],
  cuantas = 6,
): void {
  if (typeof window === "undefined") return;

  const pendientes = filas.slice(0, cuantas).filter((f) => !leer(clave(f.empleadoId, f.chatId)));
  if (!pendientes.length) return;

  let i = 0;
  const siguiente = () => {
    const f = pendientes[i++];
    if (!f) return;
    void traer(f.empleadoId, f.chatId).finally(() => {
      // 250 ms entre una y otra: adelanta trabajo sin competir con la pantalla.
      setTimeout(siguiente, 250);
    });
  };

  const arrancar = () => siguiente();
  if ("requestIdleCallback" in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void, o?: object) => void })
      .requestIdleCallback(arrancar, { timeout: 2000 });
  } else {
    // Safari no lo tiene: se espera a que la primera pintada termine.
    setTimeout(arrancar, 600);
  }
}
