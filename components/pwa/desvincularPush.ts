/**
 * DAR DE BAJA LOS AVISOS DE ESTE NAVEGADOR (Fase 1) — se llama al cerrar sesión.
 *
 *  1. `getRegistration("/")` y no `serviceWorker.ready`: `ready` no termina
 *     nunca si el service worker no se registró, y colgaría el botón de salir.
 *  2. Borra la fila en el servidor (con la sesión todavía viva).
 *  3. `unsubscribe()`: aunque el paso 2 falle, el servicio de push responde
 *     404/410 al próximo envío y lib/push.ts borra la fila solo.
 *  4. Cierra las notificaciones que quedaron en pantalla.
 *
 * Con tope de tiempo: cerrar sesión no puede depender de la red.
 */
export async function desvincularPushDeEsteNavegador(topeMs = 2000): Promise<void> {
  const trabajo = (async () => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg) return;
    const sus = await reg.pushManager?.getSubscription?.();
    if (sus) {
      await fetch("/api/push/suscribir", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sus.endpoint }),
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => undefined);
      await sus.unsubscribe().catch(() => undefined);
    }
    const abiertas = (await reg.getNotifications?.().catch(() => [])) ?? [];
    for (const n of abiertas) n.close();
  })().catch(() => undefined);
  await Promise.race([trabajo, new Promise<void>((r) => setTimeout(r, topeMs))]);
}
