/**
 * SERVICE WORKER DEL PORTAL.
 *
 * Es la pieza que permite tres cosas: que el portal se pueda INSTALAR, que
 * reciba NOTIFICACIONES aunque esté cerrado, y que con mala señal muestre algo
 * en vez del dinosaurio.
 *
 * ⚠️ REGLA QUE NO SE PUEDE ROMPER — LEER ANTES DE TOCAR NADA
 * ----------------------------------------------------------
 * Un service worker se queda instalado en el navegador de la persona y puede
 * servir contenido viejo durante días. Si acá se cachea de más, alguien puede
 * quedarse mirando una bandeja congelada sin saber por qué, y ni recargar lo
 * arregla.
 *
 * Por eso este archivo es DELIBERADAMENTE CONSERVADOR:
 *
 *  - **Las peticiones a /api NUNCA se cachean.** Son mensajes de clientes reales
 *    y estados que cambian cada segundo. Servir uno viejo sería mostrar una
 *    conversación que no existe.
 *  - **Las navegaciones van SIEMPRE a la red primero.** Solo si la red falla se
 *    muestra la pantalla de "sin conexión". Nada de servir HTML cacheado.
 *  - **Solo se cachea lo inmutable**: los archivos con hash de Next
 *    (`/_next/static/…`) y los íconos. Esos nunca cambian de contenido.
 *
 * Si en el futuro alguien quiere "que ande sin internet de verdad", que lo
 * piense despacio: para una bandeja de mensajes, mostrar datos viejos es peor
 * que no mostrar nada.
 */

const VERSION = "respondo-v1";
const CACHE_ESTATICO = `${VERSION}-estatico`;

/** Lo mínimo para que la pantalla de sin conexión exista aunque no haya red. */
const PRECARGA = ["/sin-conexion", "/icono/icono-192.png"];

self.addEventListener("install", (evento) => {
  // `skipWaiting`: al desplegar una versión nueva, toma el control enseguida en
  // vez de esperar a que se cierren todas las pestañas. Para una herramienta de
  // trabajo que se deja abierta todo el día, esa espera puede ser de horas.
  evento.waitUntil(
    caches
      .open(CACHE_ESTATICO)
      .then((c) => c.addAll(PRECARGA))
      .catch(() => undefined) // si algo falla, se instala igual
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      // Borrar cachés de versiones anteriores: sin esto se acumulan y algún día
      // el navegador empieza a desalojar cosas al azar.
      const nombres = await caches.keys();
      await Promise.all(
        nombres.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // ── Nunca tocar la API ni el stream en vivo ────────────────────────────────
  if (url.pathname.startsWith("/api/")) return;

  // ── Estáticos inmutables: caché primero, es gratis y son idénticos siempre ──
  const inmutable =
    url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icono/");
  if (inmutable) {
    evento.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copia = res.clone();
              caches.open(CACHE_ESTATICO).then((c) => c.put(req, copia));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // ── Navegaciones: red primero, y si no hay, la pantalla de sin conexión ────
  if (req.mode === "navigate") {
    evento.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(CACHE_ESTATICO);
        return (
          (await cache.match("/sin-conexion")) ||
          new Response("Sin conexión", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }),
    );
  }
});

/**
 * NOTIFICACIÓN ENTRANTE.
 *
 * Es lo que hace que suene el teléfono cuando un cliente necesita a una persona.
 * Sin esto, el portal instalado sería un acceso directo con logo.
 *
 * `tag` agrupa por conversación: si el mismo cliente manda tres mensajes, se ve
 * UNA notificación que se actualiza, no tres apiladas. `renotify` hace que igual
 * vibre en cada una, porque lo urgente es enterarse, no el conteo.
 */
self.addEventListener("push", (evento) => {
  let d = {};
  try {
    d = evento.data ? evento.data.json() : {};
  } catch {
    d = { titulo: "Respondo", cuerpo: evento.data ? evento.data.text() : "" };
  }

  const titulo = d.titulo || "Respondo";
  const opciones = {
    body: d.cuerpo || "",
    icon: "/icono/icono-192.png",
    badge: "/icono/icono-192.png",
    tag: d.tag || "respondo",
    renotify: true,
    data: { url: d.url || "/conversaciones" },
    // Vibración corta: se siente en el bolsillo sin ser un teléfono sonando.
    vibrate: [80, 40, 80],
  };
  evento.waitUntil(self.registration.showNotification(titulo, opciones));
});

/**
 * AL TOCAR LA NOTIFICACIÓN.
 *
 * Si el portal ya está abierto en alguna ventana, se REUSA esa y se navega ahí
 * dentro. Abrir una ventana nueva cada vez dejaría a la persona con cinco
 * copias del portal abiertas al final del día.
 */
self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const destino = (evento.notification.data && evento.notification.data.url) || "/conversaciones";

  evento.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const v of ventanas) {
        if (new URL(v.url).origin === self.location.origin) {
          await v.focus();
          if ("navigate" in v) await v.navigate(destino);
          return;
        }
      }
      await self.clients.openWindow(destino);
    })(),
  );
});
