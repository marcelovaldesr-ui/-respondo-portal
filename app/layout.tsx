import type { Metadata } from "next";
import "./globals.css";
import VigilanteDeVersion from "@/components/VigilanteDeVersion";

export const metadata: Metadata = {
  title: "Portal Respondo",
  description: "Tus empleados IA, trabajando. Portal del cliente de Respondo.",
  icons: { icon: "/brand/isotipo.svg" },
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
