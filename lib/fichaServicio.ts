/**
 * FICHA PERSONALIZABLE POR SERVICIO (migración 277) — núcleo puro, sin base
 * de datos, para poder testearlo completo.
 *
 * POR QUÉ EXISTE
 * La reserva pedía siempre lo mismo: nombre y teléfono. Alcanza para una
 * barbería y se queda corto para casi todo lo demás. En vez de programar un
 * formulario por rubro —que no escala y nos deja manteniendo uno por cliente—,
 * cada negocio define SUS campos. Un solo mecanismo cubre la clínica que
 * necesita RUT y previsión, el taller que necesita patente y kilometraje, y el
 * rubro que todavía no conocemos.
 *
 * REGLA DE SEGURIDAD: esto valida en el SERVIDOR. El formulario del navegador
 * ayuda a que la persona no se equivoque, pero no es una barrera: cualquiera
 * puede mandar el POST a mano. Todo lo que se guarda pasa por acá.
 */

export type TipoCampo =
  | "texto"
  | "parrafo"
  | "numero"
  | "telefono"
  | "email"
  | "opciones"
  | "si_no"
  | "fecha"
  | "rut";

export type CampoFicha = {
  id: string;
  etiqueta: string;
  tipo: TipoCampo;
  opciones: string[] | null;
  obligatorio: boolean;
  ayuda: string | null;
  orden: number;
};

/** Tope por respuesta: evita que alguien use la ficha como depósito de texto. */
const MAX_LARGO: Record<TipoCampo, number> = {
  texto: 120,
  parrafo: 800,
  numero: 20,
  telefono: 25,
  email: 120,
  opciones: 120,
  si_no: 3,
  fecha: 10,
  rut: 13,
};

export const TIPOS_CAMPO: { valor: TipoCampo; nombre: string; pista: string }[] = [
  { valor: "texto", nombre: "Texto corto", pista: "Nombre de la mascota, patente, n° de póliza" },
  { valor: "parrafo", nombre: "Texto largo", pista: "Motivo de consulta, detalle del problema" },
  { valor: "opciones", nombre: "Lista de opciones", pista: "Previsión: Fonasa / Isapre / Particular" },
  { valor: "si_no", nombre: "Sí o no", pista: "¿Es tu primera vez? ¿Tienes alergias?" },
  { valor: "numero", nombre: "Número", pista: "Kilometraje, edad, cantidad" },
  { valor: "rut", nombre: "RUT", pista: "Se valida el dígito verificador" },
  { valor: "telefono", nombre: "Teléfono", pista: "Un contacto alternativo" },
  { valor: "email", nombre: "Correo", pista: "Para enviar la boleta" },
  { valor: "fecha", nombre: "Fecha", pista: "Fecha de nacimiento, última atención" },
];

// ---------------------------------------------------------------------------
// RUT chileno
// ---------------------------------------------------------------------------

/** Deja el RUT en "12345678-9" (sin puntos, K mayúscula). */
export function normalizarRut(valor: string): string {
  const limpio = valor.replace(/[^0-9kK]/g, "").toUpperCase();
  if (limpio.length < 2) return limpio;
  return `${limpio.slice(0, -1)}-${limpio.slice(-1)}`;
}

/**
 * Valida el dígito verificador (módulo 11).
 *
 * Vale la pena hacerlo bien: un RUT mal tipeado no se nota al reservar, se nota
 * cuando hay que emitir la boleta o buscar la ficha, con el paciente al frente.
 */
export function rutValido(valor: string): boolean {
  const norm = normalizarRut(valor);
  const [cuerpo, dv] = norm.split("-");
  if (!cuerpo || !dv || cuerpo.length < 7 || cuerpo.length > 8) return false;
  if (!/^\d+$/.test(cuerpo)) return false;

  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  return dv === esperado;
}

// ---------------------------------------------------------------------------
// Validación de respuestas
// ---------------------------------------------------------------------------

export type ResultadoFicha =
  | { ok: true; datos: Record<string, string> }
  | { ok: false; errores: Record<string, string> };

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida las respuestas contra la definición de la ficha.
 *
 * `entrada` viene del navegador: se asume hostil. Se ignora cualquier clave que
 * no corresponda a un campo definido —si no, se podría inflar `datos_extra` con
 * basura arbitraria— y se recorta todo a su largo máximo.
 *
 * Devuelve los datos indexados por ETIQUETA (no por id) porque así se leen
 * solos en el portal y en el WhatsApp del negocio, sin tener que cruzar ids.
 */
export function validarFicha(campos: CampoFicha[], entrada: unknown): ResultadoFicha {
  const errores: Record<string, string> = {};
  const datos: Record<string, string> = {};
  const crudo = (entrada && typeof entrada === "object" ? entrada : {}) as Record<string, unknown>;

  for (const campo of [...campos].sort((a, b) => a.orden - b.orden)) {
    const bruto = crudo[campo.id];
    const valor = typeof bruto === "string" ? bruto.trim() : bruto == null ? "" : String(bruto).trim();

    if (!valor) {
      if (campo.obligatorio) errores[campo.id] = "Falta completar este dato.";
      continue;
    }
    if (valor.length > MAX_LARGO[campo.tipo]) {
      errores[campo.id] = `Máximo ${MAX_LARGO[campo.tipo]} caracteres.`;
      continue;
    }

    switch (campo.tipo) {
      case "rut":
        if (!rutValido(valor)) {
          errores[campo.id] = "Ese RUT no es válido. Revisa el número y el dígito verificador.";
          continue;
        }
        datos[campo.etiqueta] = normalizarRut(valor);
        continue;

      case "email":
        if (!RE_EMAIL.test(valor)) {
          errores[campo.id] = "Ese correo no se ve válido.";
          continue;
        }
        datos[campo.etiqueta] = valor.toLowerCase();
        continue;

      case "numero":
        if (!/^-?\d+([.,]\d+)?$/.test(valor)) {
          errores[campo.id] = "Escribe solo números.";
          continue;
        }
        datos[campo.etiqueta] = valor.replace(",", ".");
        continue;

      case "telefono": {
        const digitos = valor.replace(/\D/g, "");
        if (digitos.length < 8 || digitos.length > 15) {
          errores[campo.id] = "Ese teléfono no se ve válido.";
          continue;
        }
        datos[campo.etiqueta] = valor;
        continue;
      }

      case "fecha":
        if (!RE_FECHA.test(valor) || Number.isNaN(Date.parse(valor))) {
          errores[campo.id] = "Elige una fecha válida.";
          continue;
        }
        datos[campo.etiqueta] = valor;
        continue;

      case "opciones":
        // Nunca aceptar un valor que el negocio no ofreció: si no, cualquiera
        // podría inyectar "previsión: gratis" mandando el POST a mano.
        if (!(campo.opciones ?? []).includes(valor)) {
          errores[campo.id] = "Elige una de las opciones.";
          continue;
        }
        datos[campo.etiqueta] = valor;
        continue;

      case "si_no":
        if (valor !== "Sí" && valor !== "No") {
          errores[campo.id] = "Responde Sí o No.";
          continue;
        }
        datos[campo.etiqueta] = valor;
        continue;

      default:
        datos[campo.etiqueta] = valor;
    }
  }

  if (Object.keys(errores).length) return { ok: false, errores };
  return { ok: true, datos };
}

/**
 * Resumen de una línea para el WhatsApp del negocio y para el aviso a Tino.
 * Se acota para no mandar un muro de texto por WhatsApp.
 */
export function resumenFicha(datos: Record<string, string> | null | undefined, max = 3): string {
  if (!datos) return "";
  const pares = Object.entries(datos).filter(([, v]) => v);
  if (!pares.length) return "";
  const visibles = pares.slice(0, max).map(([k, v]) => `${k}: ${v}`);
  const resto = pares.length - visibles.length;
  return visibles.join(" · ") + (resto > 0 ? ` (+${resto})` : "");
}
