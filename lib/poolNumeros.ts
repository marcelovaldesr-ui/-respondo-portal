import { db } from "@/lib/db";

/**
 * GESTIÓN DEL GRUPO DE NÚMEROS WAHA PARA KAMBAK (Marketing).
 *
 * Administra la rotación, rampa de calentamiento, cuota diaria y descansos
 * entre envíos para evitar bloqueos de WhatsApp.
 */

export const ZONA_CHILE = "America/Santiago";

export type WahaNumero = {
  id: string;
  cliente_id: string;
  sesion: string;
  telefono_hash?: string | null;
  etiqueta?: string | null;
  estado: "calentando" | "activo" | "pausado" | "caido" | "bloqueado" | "retirado";
  rol: "envio" | "respuesta";
  calentamiento_desde?: string | null; // 'YYYY-MM-DD'
  tope_diario: number;
  enviados_hoy: number;
  dia?: string | null; // 'YYYY-MM-DD'
  ultimo_envio_en?: string | null;
  proximo_envio_en?: string | null;
  pausado_hasta?: string | null;
  ultimo_ok_en?: string | null;
  ciclos_pausa?: number;
  ultimo_error?: string | null;
  fallos_seguidos: number;
  creado_en?: string;
};

/**
 * Fecha 'YYYY-MM-DD' en huso horario de Chile.
 */
export function fechaChile(fecha: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_CHILE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
}

const RAMPA_CALENTAMIENTO = [20, 40, 60, 90, 120];

/**
 * Calcula el tope de envíos permitido para un número en una fecha dada.
 * Si tiene `calentamiento_desde`, aplica la rampa:
 *   día 1: 20
 *   día 2: 40
 *   día 3: 60
 *   día 4: 90
 *   día 5: 120
 *   día 6+: tope_diario (default 150)
 */
export function topeDelDia(
  numero: {
    tope_diario?: number | null;
    calentamiento_desde?: string | null;
    estado?: string;
  },
  hoy: Date = new Date(),
): number {
  const topeBase = numero.tope_diario && numero.tope_diario > 0 ? numero.tope_diario : 150;
  if (!numero.calentamiento_desde) {
    return topeBase;
  }

  const strHoy = fechaChile(hoy);
  const tHoy = Date.parse(`${strHoy}T00:00:00Z`);
  const tDesde = Date.parse(`${numero.calentamiento_desde}T00:00:00Z`);
  if (Number.isNaN(tDesde) || Number.isNaN(tHoy)) {
    return topeBase;
  }

  const diffDias = Math.floor((tHoy - tDesde) / (24 * 3600 * 1000));
  const diaIndice = diffDias + 1; // día 1 si hoy == calentamiento_desde

  if (diaIndice <= 0) {
    return Math.min(RAMPA_CALENTAMIENTO[0], topeBase);
  }

  if (diaIndice <= RAMPA_CALENTAMIENTO.length) {
    return Math.min(RAMPA_CALENTAMIENTO[diaIndice - 1], topeBase);
  }

  return topeBase;
}

/**
 * Obtiene los envíos efectivos de hoy, considerando que si `dia` no coincide
 * con la fecha actual de Chile, el contador se considera 0.
 */
export function enviadosEfectivosHoy(numero: { dia?: string | null; enviados_hoy?: number | null }, ahora: Date = new Date()): number {
  const strHoy = fechaChile(ahora);
  if (numero.dia !== strHoy) return 0;
  return numero.enviados_hoy ?? 0;
}

/**
 * Consulta el canal configurado para marketing del cliente ('meta' o 'waha').
 * Si WAHA_POOL_APAGADO=1, siempre devuelve 'meta'.
 */
export async function canalMarketingDe(
  clienteId: string,
  supa = db(),
): Promise<"meta" | "waha"> {
  if (process.env.WAHA_POOL_APAGADO === "1") return "meta";
  const { data } = await supa
    .from("ed_clientes")
    .select("canal_marketing")
    .eq("id", clienteId)
    .maybeSingle();
  const c = (data?.canal_marketing as string | null) ?? "meta";
  return c === "waha" ? "waha" : "meta";
}

/**
 * Elige el mejor número disponible del pool para un cliente:
 *  1. Activo (`estado = 'activo'`) y con rol de envío (`rol = 'envio'`)
 *  2. Con cupo disponible hoy (`enviadosEfectivosHoy < topeDelDia`)
 *  3. Sin pausa vigente (`proximo_envio_en <= ahora` o nulo)
 *  4. El de menos envíos hoy (desempate: más tiempo sin enviar / más antiguo).
 */
export async function elegirNumero(
  clienteId: string,
  ahora: Date = new Date(),
  supa = db(),
  opts?: { excluirIds?: Set<string> | string[] },
): Promise<WahaNumero | null> {
  const { data, error } = await supa
    .from("ed_waha_numeros")
    .select("*")
    .eq("cliente_id", clienteId)
    .eq("estado", "activo")
    .eq("rol", "envio");

  if (error || !data || data.length === 0) {
    return null;
  }

  const excluidos = opts?.excluirIds
    ? (opts.excluirIds instanceof Set ? opts.excluirIds : new Set(opts.excluirIds))
    : null;

  const candidatos = (data as WahaNumero[]).filter((num) => {
    if (excluidos && excluidos.has(num.id)) {
      return false;
    }
    // Si tiene una pausa vigente para un instante futuro, no se puede usar aún
    if (num.proximo_envio_en && Date.parse(num.proximo_envio_en) > ahora.getTime()) {
      return false;
    }
    const enviados = enviadosEfectivosHoy(num, ahora);
    const tope = topeDelDia(num, ahora);
    return enviados < tope;
  });

  if (candidatos.length === 0) return null;

  // Ordenar:
  // 1. Menos envíos hoy
  // 2. Más tiempo sin enviar (ultimo_envio_en más antiguo o nulo primero)
  // 3. Más antiguo en el pool (creado_en)
  candidatos.sort((a, b) => {
    const envA = enviadosEfectivosHoy(a, ahora);
    const envB = enviadosEfectivosHoy(b, ahora);
    if (envA !== envB) return envA - envB;

    const tUltimoA = a.ultimo_envio_en ? Date.parse(a.ultimo_envio_en) : 0;
    const tUltimoB = b.ultimo_envio_en ? Date.parse(b.ultimo_envio_en) : 0;
    if (tUltimoA !== tUltimoB) return tUltimoA - tUltimoB;

    const tCreadoA = a.creado_en ? Date.parse(a.creado_en) : 0;
    const tCreadoB = b.creado_en ? Date.parse(b.creado_en) : 0;
    return tCreadoA - tCreadoB;
  });

  return candidatos[0];
}

/**
 * Registra un envío exitoso por un número del pool:
 *  - Incrementa enviados_hoy (o reinicia en 1 si cambió el día)
 *  - Actualiza ultimo_envio_en = ahora
 *  - Fija proximo_envio_en = ahora + pausa aleatoria (60 a 180 s)
 *  - Limpia fallos_seguidos = 0 y ultimo_error = null
 */
export async function registrarEnvio(
  numeroId: string,
  ahora: Date = new Date(),
  opts?: { pausaSegundos?: number },
  supa = db(),
): Promise<WahaNumero | null> {
  const { data: actual } = await supa
    .from("ed_waha_numeros")
    .select("*")
    .eq("id", numeroId)
    .maybeSingle();

  if (!actual) return null;

  const diaActual = fechaChile(ahora);
  const enviados = (actual.dia === diaActual ? (actual.enviados_hoy ?? 0) : 0) + 1;
  const pausa = opts?.pausaSegundos ?? (Math.floor(Math.random() * (180 - 60 + 1)) + 60);
  const proximo = new Date(ahora.getTime() + pausa * 1000).toISOString();

  const cambios = {
    dia: diaActual,
    enviados_hoy: enviados,
    ultimo_envio_en: ahora.toISOString(),
    proximo_envio_en: proximo,
    fallos_seguidos: 0,
    ultimo_error: null,
  };

  const { data: updated, error } = await supa
    .from("ed_waha_numeros")
    .update(cambios)
    .eq("id", numeroId)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[poolNumeros] error al registrar envío:", error.message);
    return null;
  }
  return (updated as WahaNumero) ?? null;
}

/**
 * Registra un fallo en un número del pool:
 *  - Suma 1 a fallos_seguidos
 *  - Registra ultimo_error
 *  - Si alcanza >= 3 fallos seguidos o error de desconexión/bloqueo, cambia a 'bloqueado' o 'caido'
 */
export async function registrarFallo(
  numeroId: string,
  errorMsg: string,
  supa = db(),
): Promise<{ fallos: number; estado: string }> {
  const { data: actual } = await supa
    .from("ed_waha_numeros")
    .select("fallos_seguidos, estado")
    .eq("id", numeroId)
    .maybeSingle();

  const fallos = ((actual?.fallos_seguidos as number | undefined) ?? 0) + 1;
  let estado = (actual?.estado as string) ?? "activo";

  if (fallos >= 3 || /logged out|banned|blocked|bloqueado/i.test(errorMsg)) {
    estado = "bloqueado";
  } else if (/failed|stopped|scan_qr_code|caido/i.test(errorMsg)) {
    estado = "caido";
  }

  await supa
    .from("ed_waha_numeros")
    .update({
      fallos_seguidos: fallos,
      ultimo_error: errorMsg.slice(0, 250),
      estado,
    })
    .eq("id", numeroId);

  return { fallos, estado };
}

/**
 * Restablece contador de fallos tras una operación exitosa.
 */
export async function registrarExito(
  numeroId: string,
  supa = db(),
): Promise<void> {
  await supa
    .from("ed_waha_numeros")
    .update({
      fallos_seguidos: 0,
      ultimo_error: null,
    })
    .eq("id", numeroId);
}
