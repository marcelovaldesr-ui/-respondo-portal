import type { MetadataRoute } from "next";

/**
 * MANIFEST DE LA APP INSTALABLE.
 *
 * Esto es lo que convierte el portal en algo que se agrega a la pantalla de
 * inicio del teléfono. No es una app aparte: es el MISMO código y el MISMO
 * despliegue. Cuando se hace `git push`, el cambio le llega a todos al instante,
 * sin republicar nada ni esperar la revisión de nadie.
 *
 * DECISIONES QUE IMPORTAN
 * -----------------------
 *  - `display: "standalone"` → se abre sin barra de direcciones ni pestañas. En
 *    un teléfono eso es ~15% más de pantalla, que es una conversación entera más
 *    a la vista.
 *  - `start_url: "/inicio"` → la app abre en el panel, no en el login. Si la
 *    sesión está viva —que es lo normal— se entra directo.
 *  - **Dos juegos de íconos.** Los `any` se muestran tal cual. Los `maskable`
 *    son para Android, que recorta el ícono en círculo o "squircle" según el
 *    fabricante y se come hasta el 20% de cada borde: por eso ahí la marca va al
 *    55% del lienzo, sobre el degradado a sangre. Sin un maskable propio, el
 *    logo sale decapitado en la mitad de los teléfonos.
 *  - `id` fijo: si algún día cambia `start_url`, el navegador sigue reconociendo
 *    la app instalada en vez de ofrecer instalar una segunda.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/respondo-portal",
    name: "Respondo · Portal",
    short_name: "Respondo",
    description:
      "Atiende las conversaciones de tu negocio, revisa la agenda y sigue a tus clientes.",
    start_url: "/inicio",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "es-CL",
    dir: "ltr",
    // Navy de marca: pinta la barra de estado del teléfono cuando la app abre.
    theme_color: "#0A0E20",
    background_color: "#FBFCFE",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icono/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icono/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icono/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icono/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    /**
     * Accesos rápidos: al mantener presionado el ícono aparecen estos atajos.
     * Son los dos destinos a los que se entra con una intención concreta.
     */
    shortcuts: [
      {
        name: "Conversaciones",
        short_name: "Chats",
        url: "/conversaciones",
        icons: [{ src: "/icono/icono-192.png", sizes: "192x192" }],
      },
      {
        name: "Agenda",
        short_name: "Agenda",
        url: "/agenda",
        icons: [{ src: "/icono/icono-192.png", sizes: "192x192" }],
      },
    ],
  };
}
