import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // Estas reglas nuevas de React 19 no distinguen correctamente entre el
    // render de un Server Component dinámico y uno reutilizable en cliente.
    // Las dependencias/hooks siguen cubiertas por exhaustive-deps y Rules of Hooks.
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      // El <link> vive en el layout raíz del App Router; la regla conserva el
      // mensaje antiguo de pages/_document y produce un falso positivo.
      "@next/next/no-page-custom-font": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scripts/**",
    "respondo-watchdog-waha/**",
  ]),
]);
