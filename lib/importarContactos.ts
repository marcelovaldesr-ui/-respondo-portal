/**
 * IMPORTADOR DE LA LISTA DE CLIENTES (la que manda el negocio en un Excel).
 *
 * Este archivo es SOLO parseo y normalización: no toca la base. Así se puede
 * probar entero sin Supabase, que es donde de verdad se cazan los errores —
 * un teléfono con formato raro o una fecha en dd/mm/aaaa no se notan hasta
 * que Beto le escribe al número equivocado.
 *
 * QUÉ ESPERA
 * Un CSV con una fila de cabecera. Los nombres de las columnas NO están
 * fijados: cada sistema exporta como quiere ("Teléfono", "fono", "CELULAR",
 * "Nº de contacto"), así que se reconocen por aproximación. Si una columna
 * obligatoria no aparece, se dice cuál falta y se corta; nunca se adivina.
 *
 * POR QUÉ CSV Y NO XLSX
 * El repo tiene tres dependencias y ninguna sirve para leer xlsx. Meter una
 * librería de Excel por un archivo que el negocio manda una vez no vale la
 * pena: "Guardar como CSV" es un paso, y el que arma el export ya está en
 * Excel. Si llega un xlsx, se convierte antes.
 */

export type FilaCruda = Record<string, string>;

export type ContactoImportado = {
  chatId: string; // 56912345678 — el formato que usa WhatsApp
  telefono: string; // +56912345678 — legible para el portal
  nombre: string;
  ultimaAtencion: string | null; // YYYY-MM-DD
  datos: Record<string, string>; // vehículo, último trabajo, kilometraje…
};

export type ResultadoImportacion = {
  contactos: ContactoImportado[];
  descartadas: { fila: number; motivo: string; crudo: string }[];
  columnas: Record<string, string | null>;
};

/* ────────────────────────────── CSV ────────────────────────────── */

/**
 * Parser de CSV con comillas. No usa split(",") porque un campo tan común como
 * "Pérez, Juan" o una dirección con coma parten la fila en dos y corren todas
 * las columnas siguientes — y el resultado es un teléfono en la columna del
 * nombre, que nadie revisa hasta que sale el mensaje.
 *
 * Detecta solo si el separador es coma o punto y coma: Excel en español exporta
 * con punto y coma y es el caso más probable acá.
 */
export function parsearCsv(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, ""); // BOM de Excel
  const sep = detectarSeparador(limpio);
  const filas: string[][] = [];
  let campo = "";
  let fila: string[] = [];
  let enComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (enComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i++;
        } else enComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { enComillas = true; continue; }
    if (c === sep) { fila.push(campo); campo = ""; continue; }
    if (c === "\n") {
      fila.push(campo.replace(/\r$/, ""));
      campo = "";
      if (fila.some((v) => v.trim() !== "")) filas.push(fila);
      fila = [];
      continue;
    }
    campo += c;
  }
  fila.push(campo.replace(/\r$/, ""));
  if (fila.some((v) => v.trim() !== "")) filas.push(fila);
  return filas;
}

function detectarSeparador(texto: string): string {
  const primera = texto.split(/\r?\n/, 1)[0] ?? "";
  const comas = (primera.match(/,/g) ?? []).length;
  const puntoYComa = (primera.match(/;/g) ?? []).length;
  return puntoYComa > comas ? ";" : ",";
}

/* ────────────────────── reconocer las columnas ────────────────────── */

const SINONIMOS: Record<string, string[]> = {
  nombre: ["nombre", "cliente", "nombre cliente", "nombre completo", "razon social", "contacto"],
  telefono: ["telefono", "fono", "celular", "movil", "whatsapp", "numero", "n de contacto", "contacto telefonico"],
  vehiculo: ["moto", "vehiculo", "modelo", "maquina", "producto", "bicicleta", "moto modelo"],
  ultimaAtencion: [
    "ultima atencion", "fecha", "fecha atencion", "ultima visita", "ultima compra",
    "fecha ultima atencion", "fecha de la ultima atencion", "fecha servicio", "ingreso",
  ],
  ultimoTrabajo: ["que se le hizo", "trabajo", "servicio", "detalle", "trabajo realizado", "observacion", "descripcion"],
  kilometraje: ["kilometraje", "km", "kms", "kilometros"],
};

/**
 * Cabeceras que contienen una palabra de un alias pero significan otra cosa.
 * Sin esta lista, "Fecha de nacimiento" se lleva el campo de última atención
 * solo por tener "fecha", y Beto termina calculando la mantención sobre el
 * cumpleaños del cliente.
 */
const EXCLUIR = [
  "nacimiento", "cumpleanos", "cumple", "emision", "vencimiento", "expira",
  "creacion", "registro", "ingreso sistema", "factura", "boleta", "garantia",
];

/** Sin tildes, minúsculas y sin puntuación: así "Teléfono" y "TELEFONO." son lo mismo. */
export function normalizarCabecera(v: string): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Asocia cada campo que nos interesa con la columna del archivo.
 *
 * Primero busca coincidencia exacta y solo después "contiene". El orden importa:
 * con "contiene" a secas, una columna llamada "fecha de nacimiento" se llevaría
 * el campo `ultimaAtencion` solo por tener "fecha".
 */
export function detectarColumnas(cabeceras: string[]): Record<string, string | null> {
  const norm = cabeceras.map(normalizarCabecera);
  const salida: Record<string, string | null> = {};
  const usadas = new Set<number>();
  // Se marcan como usadas de entrada: así ninguna regla las puede tomar.
  norm.forEach((h, i) => {
    if (EXCLUIR.some((x) => h.includes(x))) usadas.add(i);
  });

  for (const [campo, alias] of Object.entries(SINONIMOS)) {
    let idx = -1;
    for (const a of alias) {
      idx = norm.findIndex((h, i) => !usadas.has(i) && h === a);
      if (idx >= 0) break;
    }
    if (idx < 0) {
      for (const a of alias) {
        idx = norm.findIndex((h, i) => !usadas.has(i) && h.includes(a));
        if (idx >= 0) break;
      }
    }
    if (idx >= 0) usadas.add(idx);
    salida[campo] = idx >= 0 ? cabeceras[idx] : null;
  }
  return salida;
}

/* ────────────────────────── normalizaciones ────────────────────────── */

/**
 * Deja el teléfono como lo espera WhatsApp: 56 + 9 dígitos, sin símbolos.
 *
 * Casos reales que aparecen en un export chileno y que acá se resuelven:
 * "+56 9 8576 1941", "9 8576 1941", "098576194" (viejo formato de 8 dígitos con
 * 0 adelante), "56985761941", y un fijo "42 252 4930" que NO sirve para WhatsApp
 * y por eso se rechaza en vez de convertirse en un número inventado.
 */
export function normalizarTelefono(valor: string): string | null {
  let d = String(valor ?? "").replace(/\D/g, "");
  if (!d) return null;

  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("56")) d = d.slice(2);
  // "09 8576 1941": el 0 de troncal nacional, que ya no se usa.
  if (d.startsWith("0")) d = d.replace(/^0+/, "");

  // Celular chileno: 9 + 8 dígitos. Es el ÚNICO formato que se acepta.
  if (d.length === 9 && d.startsWith("9")) return "56" + d;

  /**
   * Un valor de 8 dígitos casi siempre es un celular al que Excel le comió el
   * 9 de adelante... o un fijo de Santiago. No hay forma de distinguirlos, y
   * ponerle un 9 a ojo significa mandarle un WhatsApp a un desconocido con el
   * nombre de otra persona. Se rechaza y se informa, que es reparable; enviarlo
   * mal, no.
   */
  return null;
}

/** Por qué se rechazó un teléfono, para que el informe diga algo accionable. */
export function motivoTelefono(valor: string): string {
  const d = String(valor ?? "").replace(/\D/g, "").replace(/^(00)?(56)?/, "").replace(/^0+/, "");
  if (!d) return "sin teléfono";
  if (d.length === 8) return "tiene 8 dígitos: probablemente le falta el 9 inicial";
  if (d.length === 9 && !d.startsWith("9")) return "no es celular (los celulares parten con 9)";
  if (d.length < 8) return "teléfono incompleto";
  return "formato de teléfono no reconocido";
}

/**
 * Fecha a YYYY-MM-DD.
 *
 * Acepta dd-mm-aaaa y dd/mm/aaaa (lo normal en Chile), aaaa-mm-dd (lo que
 * exportan los sistemas), y el número serial de Excel, que aparece cuando
 * alguien guarda como CSV una columna con formato de fecha.
 *
 * Ante ambigüedad manda el formato chileno: 03/04/2026 es el 3 de abril, no el
 * 4 de marzo. Es lo que va a mandar el negocio.
 */
export function parsearFecha(valor: string): string | null {
  const v = String(valor ?? "").trim();
  if (!v) return null;

  // Serial de Excel (días desde 1899-12-30). Rango razonable: 1990–2100.
  if (/^\d{4,5}$/.test(v)) {
    const n = Number(v);
    if (n > 32800 && n < 73500) {
      const ms = Date.UTC(1899, 11, 30) + n * 86400_000;
      return new Date(ms).toISOString().slice(0, 10);
    }
    return null;
  }

  const iso = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return armarFecha(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const cl = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (cl) {
    let anio = Number(cl[3]);
    if (anio < 100) anio += anio < 70 ? 2000 : 1900;
    return armarFecha(anio, Number(cl[2]), Number(cl[1]));
  }
  return null;
}

function armarFecha(anio: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  if (anio < 1990 || anio > 2100) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  // Rebote: 31 de febrero se convierte en 3 de marzo, y eso es un dato falso.
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d.toISOString().slice(0, 10);
}

/* ─────────────────────────── el importador ─────────────────────────── */

/**
 * Convierte el CSV en contactos listos para escribir.
 *
 * Todo lo que no se puede normalizar se DESCARTA con motivo, no se corrige a
 * ojo. Una lista de 100 personas con 3 descartes explicados es mucho mejor que
 * una de 100 donde 3 mensajes salieron a un número equivocado.
 *
 * Los duplicados por teléfono se quedan con la atención MÁS RECIENTE: si el
 * cliente vino tres veces, lo que importa para la próxima mantención es la
 * última.
 */
export function importarDesdeCsv(textoCsv: string): ResultadoImportacion {
  const filas = parsearCsv(textoCsv);
  const descartadas: ResultadoImportacion["descartadas"] = [];
  if (filas.length < 2) {
    return { contactos: [], descartadas, columnas: {} };
  }

  const cabeceras = filas[0].map((h) => h.trim());
  const col = detectarColumnas(cabeceras);
  const idx = (nombre: string | null) => (nombre ? cabeceras.indexOf(nombre) : -1);

  const iNombre = idx(col.nombre);
  const iTel = idx(col.telefono);
  const iVeh = idx(col.vehiculo);
  const iFecha = idx(col.ultimaAtencion);
  const iTrabajo = idx(col.ultimoTrabajo);
  const iKm = idx(col.kilometraje);

  const porTelefono = new Map<string, ContactoImportado>();

  for (let f = 1; f < filas.length; f++) {
    const fila = filas[f];
    const crudo = fila.join(" | ").slice(0, 120);
    const celda = (i: number) => (i >= 0 ? String(fila[i] ?? "").trim() : "");

    const chatId = normalizarTelefono(celda(iTel));
    if (!chatId) {
      descartadas.push({
        fila: f + 1,
        motivo: iTel < 0 ? "el archivo no trae columna de teléfono" : motivoTelefono(celda(iTel)),
        crudo,
      });
      continue;
    }

    const nombre = celda(iNombre);
    if (!nombre) {
      descartadas.push({ fila: f + 1, motivo: "sin nombre", crudo });
      continue;
    }

    const datos: Record<string, string> = {};
    const vehiculo = celda(iVeh);
    const trabajo = celda(iTrabajo);
    const km = celda(iKm);
    if (vehiculo) datos.vehiculo = vehiculo;
    if (trabajo) datos.ultimo_trabajo = trabajo;
    if (km) datos.kilometraje = km;

    const contacto: ContactoImportado = {
      chatId,
      telefono: "+" + chatId,
      // Solo el primer nombre y el apellido: los nombres completos de un
      // sistema de facturación vienen en MAYÚSCULAS y con segundo apellido, y
      // eso en un WhatsApp se lee a kilómetros como un mensaje automático.
      nombre: prolijarNombre(nombre),
      ultimaAtencion: parsearFecha(celda(iFecha)),
      datos,
    };

    const previo = porTelefono.get(chatId);
    if (!previo) {
      porTelefono.set(chatId, contacto);
    } else {
      const a = previo.ultimaAtencion ?? "";
      const b = contacto.ultimaAtencion ?? "";
      if (b > a) porTelefono.set(chatId, contacto);
    }
  }

  return { contactos: [...porTelefono.values()], descartadas, columnas: col };
}

/**
 * "PEREZ GONZALEZ, JUAN CARLOS" → "Juan Carlos Pérez" no se puede reconstruir
 * (las tildes se perdieron en el sistema de origen), pero sí se puede evitar lo
 * peor: dejarlo en mayúsculas sostenidas. Se pasa a capitalización normal y se
 * da vuelta el "Apellido, Nombre" cuando viene con coma.
 */
export function prolijarNombre(v: string): string {
  let s = String(v ?? "").trim().replace(/\s+/g, " ");
  if (s.includes(",")) {
    const [apellidos, nombres] = s.split(",", 2);
    if (nombres?.trim()) s = `${nombres.trim()} ${apellidos.trim()}`;
  }
  const esGritado = s === s.toUpperCase();
  if (esGritado) {
    s = s
      .toLowerCase()
      .split(" ")
      .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
      .join(" ");
  }
  return s;
}

/** Primer nombre, que es como se saluda a alguien por WhatsApp. */
export function primerNombre(v: string): string {
  return String(v ?? "").trim().split(/\s+/)[0] ?? "";
}
