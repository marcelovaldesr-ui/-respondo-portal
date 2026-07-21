import type { Metadata } from "next";
import "./globals.css";

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
        {/* Tipografías de marca: Montserrat (titulares) + Manrope (texto).
            Se cargan por <link> y no con next/font a propósito: next/font las
            descarga en tiempo de build, y si la red falla se cae el deploy. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
