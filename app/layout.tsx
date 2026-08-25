import type { Metadata, Viewport } from "next";
import "./globals.css";
import VigilanteDeVersion from "@/components/VigilanteDeVersion";

export const metadata: Metadata = {
  title: "Portal Respondo",
  description: "Tus empleados IA, trabajando. Portal del cliente de Respondo.",
  icons: {
    icon: "/brand/isotipo.svg",
    /**
     * iOS ignora el manifest para el ícono de la pantalla de inicio: usa
     * `apple-touch-icon` y punto. Sin esto, al agregar el portal al iPhone
     * aparece una captura de la página en vez del logo.
     *
     * Además iOS NO respeta la transparencia —la rellena de negro—, así que ese
     * archivo va aplanado sobre el navy de marca.
     */
    apple: "/icono/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Respondo",
    // La barra de estado se funde con el navy del encabezado.
    statusBarStyle: "black-translucent",
  },
};

/**
 * `viewport` va aparte del metadata (Next lo exige desde la 14).
 *
 * `viewportFit: "cover"` + `themeColor` hacen que en un iPhone con notch la app
 * pinte hasta los bordes en vez de dejar dos franjas blancas arriba y abajo.
 */
export const viewport: Viewport = {
  themeColor: "#0A0E20",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        {/* Tipografía del portal: Geist (texto e interfaz) + Geist Mono (cifras).
            Cambio del rediseño 31-jul: Montserrat/Manrope son tipografías de
            marketing —Montserrat sobre todo, que es geométrica y ancha— y en una
            herramienta densa restan legibilidad a 12-13 px. Geist está diseñada
            para interfaz: alturas de x mayores, números tabulares reales y menos
            ruido en tamaños chicos. Es la misma familia que usa Vercel.

            Se cargan por <link> y no con next/font a propósito: next/font las
            descarga en tiempo de build, y si la red falla se cae el deploy.
            Montserrat y Manrope se quitaron el 31-jul, una vez migradas todas
            las pantallas: eran dos familias completas descargándose en cada
            primera carga sin que ninguna regla de CSS las usara ya. La clase
            .titular sigue existiendo, pero hereda Geist como el resto. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Ataja el desajuste de versión tras un deploy antes de que llegue a
            un borde de error. Ver components/VigilanteDeVersion.tsx. */}
        <VigilanteDeVersion />
        {children}
      </body>
    </html>
  );
}
