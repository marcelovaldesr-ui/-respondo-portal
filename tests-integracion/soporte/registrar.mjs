import { register } from "node:module";

// Se carga con `node --import` ANTES que cualquier prueba, así el alias
// queda activo desde la primera línea que se ejecuta.
register("./cargadorAlias.mjs", import.meta.url);
