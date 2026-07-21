import type { Config } from "tailwindcss";

// Paleta de marca Respondo (misma que la web viva Astro).
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        marca: {
          indigo: "#4F46E5",
          coral: "#F97362", // Tino (ventas)
          cobalto: "#2563EB", // Beto (seguimiento)
          malva: "#B84A86", // Vera (postventa)
          violeta: "#7C3AED", // Isabel (documental)
          tinta: "#0F172A",
          muted: "#5B6981",
        },
      },
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"],
        head: ["Montserrat", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
