/**
 * FIDELIZACIÓN — núcleo puro, sin base de datos.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO SEPARADO
 * Dos razones. La primera es técnica: el alias `@/` no resuelve bajo
 * `node --test`, así que todo lo que se quiera probar sin levantar Next tiene
 * que vivir en un archivo sin imports (mismo patrón de `agendaCore.ts` y
 * `generadorCore.ts`). La segunda es que estos números se los vamos a mostrar
 * a la gerencia de un cliente para que decida si sigue pagando: la aritmética
 * tiene que ser auditable línea por línea, no estar enterrada entre consultas.
 *
 * QUÉ MIDE Y QUÉ NO
 * `lib/analitica.ts` mide la conversación: cuántos mensajes, quién los
 * escribió, cuánto tiempo se ahorró. Eso responde «¿está funcionando?».
 * Esto responde otra pregunta, que es la que hace un dueño: **«¿la gente
 * vuelve?»**. Son las horas agendadas, las que se perdieron por inasistencia,
 * los clientes que volvieron una segunda vez y los que estaban dormidos y
 * reaccionaron a un mensaje.
 *
 * REGLA DE LA CASA (heredada de analitica.ts): solo se muestra lo que se puede
 * contar. Acá no hay ni un número derivado ni una proyección — todos salen de
 * filas que existen en `ed_citas` y `ed_seguimientos`.
 */

export type CitaMinima = {
  /** Teléfono de WhatsApp. Null si reservó por la web sin WhatsApp. */
  chatId: string | null;
  telefono: string | null;
  estado: string;
  origen: string;
  /** Qué empleado IA la agendó. Null si la cargó una persona o vino por la web. */
  empleadoId: string | null;
  /** Cuándo se creó la reserva (no cuándo es la hora). */
  creadoEn: string;
};

export type SeguimientoMinimo = {
  chatId: string;
  tipo: string;
  /** Null = programado pero todavía no salió. */
  enviadoEn: string | null;
  respuestaRecibida: boolean;
};

export type Fidelizacion = {
  /** Reservas creadas en el período. */
  citas: number;
  /** Reparto de quién la agendó. Suma `citas`. */
  porAsistente: number;
  porEnlace: number;
  porEquipo: number;
  /** % que se agendó sin que nadie del negocio interviniera. */
  porcentajeSinIntervencion: number;

  /** Reservas ya cerradas del período: se cumplieron o el cliente no llegó. */
  completadas: number;
  noShow: number;
  canceladas: number;
  porcentajeNoShow: number;

  /** Retorno — ventana fija de 12 meses, no del período elegido. */
  personasAtendidas: number;
  personasQueVolvieron: number;
  tasaRetorno: number;

  /** Seguimientos que salieron en el período. */
  seguimientosEnviados: number;
  seguimientosRespondidos: number;
  tasaRespuesta: number;
  /** Recibieron un seguimiento y agendaron dentro de la ventana. */
  reactivados: number;
  ventanaReactivacionDias: number;
};

/**
 * Identidad de una persona a lo largo del tiempo.
 *
 * El chat_id es lo bueno: es el número de WhatsApp normalizado y es el mismo
 * en todas las visitas. Cuando la reserva vino por la web sin WhatsApp no hay
 * chat_id y se cae al teléfono, del que se sacan los símbolos para que
 * "+56 9 8576 1941" y "56985761941" cuenten como la misma persona.
 *
 * Devuelve null cuando no hay ninguno de los dos: esa cita no se puede atribuir
 * a nadie y por lo tanto NO entra en el cálculo de retorno. Contarla como
 * persona nueva inflaría el denominador y bajaría la tasa; contarla como
 * repetida la inflaría. Se excluye, que es lo único honesto.
 */
export function clavePersona(c: {
  chatId: string | null;
  telefono: string | null;
}): string | null {
  const chat = (c.chatId ?? "").trim();
  if (chat) return chat;
  const tel = (c.telefono ?? "").replace(/\D+/g, "");
  return tel.length >= 8 ? tel : null;
}

/** Porcentaje entero con denominador cero seguro. */
export function pct(parte: number, total: number): number {
  if (!total) return 0;
  return Math.round((parte / total) * 100);
}

export type EntradaFidelizacion = {
  /** Citas creadas dentro del período elegido. */
  citasPeriodo: CitaMinima[];
  /**
   * Citas de los últimos 12 meses. Se usan para el retorno y para saber si
   * alguien agendó después de recibir un seguimiento. Es una ventana FIJA a
   * propósito: "cuántos clientes vuelven" medido sobre los últimos 7 días no
   * significa nada, y un número que no significa nada en un panel de gerencia
   * es peor que no mostrarlo.
   */
  citasAnio: CitaMinima[];
  /** Seguimientos con `enviado_en` dentro del período. */
  seguimientos: SeguimientoMinimo[];
  ventanaReactivacionDias?: number;
};

export function resumirFidelizacion(e: EntradaFidelizacion): Fidelizacion {
  const ventana = e.ventanaReactivacionDias ?? 14;

  let porAsistente = 0;
  let porEnlace = 0;
  let porEquipo = 0;
  let completadas = 0;
  let noShow = 0;
  let canceladas = 0;

  for (const c of e.citasPeriodo) {
    // Quién la agendó. El empleado_id manda sobre el origen: si un asistente
    // la creó, da igual por qué canal entró el mensaje.
    if (c.empleadoId) porAsistente += 1;
    else if (c.origen === "whatsapp") porAsistente += 1;
    else if (c.origen === "web") porEnlace += 1;
    else porEquipo += 1; // 'portal' e 'importada'

    if (c.estado === "completada") completadas += 1;
    else if (c.estado === "no_show") noShow += 1;
    else if (c.estado === "cancelada") canceladas += 1;
  }

  const citas = e.citasPeriodo.length;

  /**
   * La inasistencia se calcula sobre las citas CERRADAS, no sobre el total.
   * Una cita de la semana que viene todavía no es ni asistencia ni falta, y
   * meterla en el denominador hace que el número baje solo por agendar más
   * — justo al revés de lo que uno quiere que muestre el panel.
   *
   * Las canceladas tampoco entran: cancelar avisando no es lo mismo que no
   * aparecer, y el negocio pudo revender esa hora.
   */
  const cerradas = completadas + noShow;

  // --- Retorno, sobre la ventana fija de 12 meses ---
  const visitasPorPersona = new Map<string, number>();
  for (const c of e.citasAnio) {
    if (c.estado !== "completada") continue; // solo cuenta la que se cumplió
    const k = clavePersona(c);
    if (!k) continue;
    visitasPorPersona.set(k, (visitasPorPersona.get(k) ?? 0) + 1);
  }
  const personasAtendidas = visitasPorPersona.size;
  let personasQueVolvieron = 0;
  for (const n of visitasPorPersona.values()) if (n >= 2) personasQueVolvieron += 1;

  // --- Seguimientos y reactivación ---
  const enviados = e.seguimientos.filter((s) => s.enviadoEn);
  const respondidos = enviados.filter((s) => s.respuestaRecibida).length;

  /**
   * Reactivado = recibió un mensaje y AGENDÓ después.
   *
   * Es deliberadamente más exigente que "respondió". Contestar "gracias" no es
   * una venta; volver a la agenda sí. Se exige que la reserva se haya creado
   * DESPUÉS del envío y dentro de la ventana, porque una cita que ya existía
   * antes del mensaje no la produjo el mensaje.
   *
   * Se cuentan PERSONAS, no mensajes: si a alguien le llegaron tres
   * seguimientos y agendó una vez, es un reactivado, no tres.
   */
  const citasPorPersona = new Map<string, number[]>();
  for (const c of e.citasAnio) {
    const k = clavePersona(c);
    if (!k) continue;
    const t = Date.parse(c.creadoEn);
    if (Number.isNaN(t)) continue;
    const lista = citasPorPersona.get(k);
    if (lista) lista.push(t);
    else citasPorPersona.set(k, [t]);
  }

  const reactivadas = new Set<string>();
  for (const s of enviados) {
    const k = (s.chatId ?? "").trim();
    if (!k || reactivadas.has(k)) continue;
    const envio = Date.parse(s.enviadoEn as string);
    if (Number.isNaN(envio)) continue;
    const limite = envio + ventana * 86400_000;
    const citas = citasPorPersona.get(k) ?? [];
    if (citas.some((t) => t > envio && t <= limite)) reactivadas.add(k);
  }

  return {
    citas,
    porAsistente,
    porEnlace,
    porEquipo,
    porcentajeSinIntervencion: pct(porAsistente + porEnlace, citas),
    completadas,
    noShow,
    canceladas,
    porcentajeNoShow: pct(noShow, cerradas),
    personasAtendidas,
    personasQueVolvieron,
    tasaRetorno: pct(personasQueVolvieron, personasAtendidas),
    seguimientosEnviados: enviados.length,
    seguimientosRespondidos: respondidos,
    tasaRespuesta: pct(respondidos, enviados.length),
    reactivados: reactivadas.size,
    ventanaReactivacionDias: ventana,
  };
}

/**
 * EL INFORME REENVIABLE — texto para el WhatsApp del dueño, con comparación
 * al período anterior.
 *
 * POR QUÉ (1-sep-2026): el punto 2 del "orden acordado" de la auditoría de
 * agosto. Cuando la decisión de RS-Shop subió de Gaspar a gerencia, él no
 * tenía UN SOLO número que reenviar — la pantalla más completa del mundo no
 * sirve si el dueño no puede sacarla del portal para mostrarla. Este texto es
 * justo eso: algo que se copia y pega, o que llega solo al WhatsApp.
 *
 * Sigue la MISMA regla de honestidad que el resto del archivo: si no hay
 * período anterior con datos, no se inventa una comparación — se omite la
 * flecha entera en vez de mostrar un "+100%" que en realidad es "de cero a
 * algo" y no dice nada.
 */

/** "+8" / "-3" / "" (sin cambio o sin período anterior) — para conteos. */
function deltaCantidad(actual: number, anterior: number | null): string {
  if (anterior === null) return "";
  const d = actual - anterior;
  if (d === 0) return " (igual que el período anterior)";
  return ` (${d > 0 ? "+" : ""}${d} vs. período anterior)`;
}

/** Igual que arriba, pero en puntos porcentuales — para tasas. */
function deltaPuntos(actual: number, anterior: number | null): string {
  if (anterior === null) return "";
  const d = actual - anterior;
  if (d === 0) return " (igual que el período anterior)";
  return ` (${d > 0 ? "+" : ""}${d} pts vs. período anterior)`;
}

export function textoInformeFidelizacion(p: {
  nombreNegocio: string;
  etiquetaPeriodo: string;
  actual: Fidelizacion;
  /** null = sin datos suficientes en el período anterior; se omite la comparación. */
  anterior: Fidelizacion | null;
}): string {
  const { actual, anterior } = p;
  const lineas = [
    `📊 Resumen de ${p.nombreNegocio} — ${p.etiquetaPeriodo}`,
    "",
    `Horas agendadas: ${actual.citas}${deltaCantidad(actual.citas, anterior?.citas ?? null)}`,
    `Clientes que volvieron: ${actual.tasaRetorno}%${deltaPuntos(actual.tasaRetorno, anterior?.tasaRetorno ?? null)}`,
  ];

  // La inasistencia solo dice algo si hubo horas cerradas — mostrar "0%" sobre
  // cero citas cerradas sería el mismo error que ya se corrigió en el panel.
  if (actual.completadas + actual.noShow > 0) {
    lineas.push(
      `Inasistencia: ${actual.porcentajeNoShow}%${deltaPuntos(actual.porcentajeNoShow, anterior && anterior.completadas + anterior.noShow > 0 ? anterior.porcentajeNoShow : null)}`,
    );
  }

  if (actual.seguimientosEnviados > 0) {
    lineas.push(
      `Reactivados por seguimiento: ${actual.reactivados}${deltaCantidad(actual.reactivados, anterior && anterior.seguimientosEnviados > 0 ? anterior.reactivados : null)}`,
    );
  }

  lineas.push("", "Datos reales de tu WhatsApp — nada estimado.");
  return lineas.join("\n");
}
