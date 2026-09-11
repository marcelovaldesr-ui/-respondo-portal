import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { programarSeguimiento } from "@/lib/seguimientos";
import {
  DIAS_MAX,
  DIAS_MIN,
  cuposDisponibles,
  decidirCotizacion,
  type Candidato,
} from "@/lib/generadorCotizacionCore";
import { empleadosDelCliente, juzgarCotizacion } from "@/lib/juezCotizacion";
import { decidirConJuez } from "@/lib/juezCotizacionCore";
import {
  contarVivas,
  inicioDiaChile,
  memoriaDePropuestas,
  modoDe,
  proponerSeguimiento,
  registrarFrenado,
} from "@/lib/propuestasSeguimiento";
import { bloqueoPorPropuesta, PREFIJO_SIN_VEREDICTO } from "@/lib/propuestasCore";

/**
 * GENERADOR: BETO PERSIGUE LAS COTIZACIONES QUE NADIE CONTESTÓ.
 *
 * Por qué existe y qué cuesta: ver `sql/288_seguimiento_cotizacion.sql` y
 * `lib/generadorCotizacionCore.ts`. Resumen: hasta hoy los tres generadores que
 * había dependían de una CITA o del rubro motos, así que a una imprenta —que no
 * agenda— Beto y Vera no le hacían nada.
 *
 * ⚠️ INERTE HASTA QUE ALGUIEN LO ENCIENDA. `cotizacion_seguimiento` nace en
 * false. Mientras nadie lo active, esto cuesta una consulta por latido.
 *
 * ⚠️ EL TOPE ES DE GASTO, NO DE CARGA. Cada envío es una plantilla de marketing
 * (~$85). Ese es el motivo del tope diario, no el rendimiento.
 */

export type ResumenCotizacion = {
  clientes: number;
  candidatos: number;
  programados: number;
  /** Frenados por el juez después de pasar la reja. Cada uno son ~$85 no gastados. */
  frenadosPorJuez: number;
  /** Propuestas dejadas para que una persona apruebe en /seguimientos. */
  propuestos: number;
  /** Candidatos saltados porque ya hay una decisión vigente (propuesta, rechazo, freno). */
  yaDecididos: number;
  detalle: string[];
  /** Fallos por negocio, sin chat_id (observabilidad del cron). */
  errores: { clienteId: string; error: string }[];
};

export async function generarSeguimientosCotizacion(
  supa: SupabaseClient = db(),
  /**
   * ⚠️ TECHO DE TIEMPO — obligatorio desde que el juez entró al circuito
   * (9-sep-2026). Antes esto era puro SQL y tardaba lo mismo siempre; ahora
   * hace hasta `topeDiario` llamadas al modelo. En el peor caso de Gemini
   * (2 modelos × 2 intentos) diez candidatos se llevarían minutos dentro de una
   * función que Vercel corta a los 60 s, y el cron moriría ANTES del latido —
   * que es la señal con la que /api/salud detecta que el cron dejó de correr.
   * Se vería como "todo bien" mientras nada funciona.
   *
   * Lo que no alcanza no se pierde: queda para el siguiente latido, en 5 min.
   */
  opciones?: {
    fechaLimite?: number;
    /** Para pruebas: juez falso y reloj fijo. Nada de esto se usa en producción. */
    juzgar?: typeof juzgarCotizacion;
    ahora?: number;
  },
): Promise<ResumenCotizacion> {
  const out: ResumenCotizacion = {
    clientes: 0,
    candidatos: 0,
    programados: 0,
    frenadosPorJuez: 0,
    propuestos: 0,
    yaDecididos: 0,
    detalle: [],
    errores: [],
  };

  const { data: clientes, error: errClientes } = await supa
    .from("ed_clientes")
    .select("id, nombre, cotizacion_tope_diario")
    .eq("cotizacion_seguimiento", true)
    .order("id", { ascending: true })
    .limit(50);
  if (errClientes) {
    out.errores.push({ clienteId: "", error: `no se pudo leer negocios: ${errClientes.message}` });
    return out;
  }

  if (!clientes?.length) return out;
  out.clientes = clientes.length;

  const ahora = opciones?.ahora ?? Date.now();
  const juzgar = opciones?.juzgar ?? juzgarCotizacion;
  const desde = new Date(ahora - DIAS_MAX * 86_400_000).toISOString();
  const hasta = new Date(ahora - DIAS_MIN * 86_400_000).toISOString();
  // Día de CHILE, no del servidor: en Vercel `toDateString()` es UTC y el día
  // del tope cambiaba a las 20:00/21:00 de Chile (Fase 0).
  const hoy = inicioDiaChile(new Date(ahora)).toISOString();

  for (const cli of clientes) {
    const clienteId = cli.id as string;
    const topeDiario = (cli.cotizacion_tope_diario as number | null) ?? 10;

    /**
     * El empleado que manda esto es Beto. Si el cliente no lo tiene contratado,
     * no hay a quién colgarle el seguimiento — y es correcto: alguien que solo
     * pagó por Tino no debe recibir mensajes proactivos por accidente.
     */
    /**
     * ⚠️ EL ROL DE BETO EN LA BASE ES `rita`, NO «beto» NI «seguimiento».
     *
     * Es un resabio: el empleado se llamaba Rita y el cambio de nombre se hizo
     * solo en la marca, nunca en los datos (está anotado en `lib/empleados.ts`).
     * Buscar por «seguimiento» devuelve null y el generador se queda mudo **sin
     * ningún error** — que es la peor forma de fallar. Mismo criterio que usa
     * `generadorSeguimientos.ts`, que sí funciona.
     */
    const { data: beto } = await supa
      .from("ed_empleados")
      .select("id")
      .eq("cliente_id", clienteId)
      .eq("rol", "rita")
      .eq("activo", true)
      .maybeSingle();
    if (!beto) {
      out.detalle.push(`${cli.nombre}: sin Beto activo`);
      continue;
    }
    const betoId = beto.id as string;

    // Cuánto se lleva enviado hoy: el tope es diario y de plata.
    const { count: enviadosHoy, error: errHoy } = await supa
      .from("ed_seguimientos")
      .select("id", { count: "exact", head: true })
      .eq("empleado_id", betoId)
      .eq("tipo", "cotizacion_sin_respuesta")
      .gte("programado_para", hoy);
    if (errHoy) {
      // Sin saber cuánto se gastó hoy, no se programa nada (fail-closed).
      out.errores.push({ clienteId, error: `no se pudo contar el tope del día: ${errHoy.message}` });
      continue;
    }

    /**
     * Candidatos: cotizados dentro de la ventana. El `limit` es explícito
     * —PostgREST corta en 1.000 sin avisar— y sobra: el tope diario va a
     * recortar mucho antes.
     */
    const { data: contactos, error: errContactos } = await supa
      .from("ed_contactos")
      .select("chat_id, nombre, etapa, etapa_motivo, etiquetas, ultimo_mensaje_en, ultimo_mensaje_rol")
      .eq("cliente_id", clienteId)
      .gte("ultimo_mensaje_en", desde)
      .lte("ultimo_mensaje_en", hasta)
      .order("ultimo_mensaje_en", { ascending: true })
      .limit(300);

    if (errContactos) {
      out.errores.push({ clienteId, error: `no se pudieron leer contactos: ${errContactos.message}` });
      continue;
    }
    if (!contactos?.length) continue;

    /**
     * QUIÉN HABLÓ ÚLTIMO: `ed_contactos.ultimo_mensaje_rol`, mantenido por el
     * trigger de la migración 250 con CADA mensaje de CUALQUIER empleado.
     *
     * 🔴 BUG CAZADO EN AUDITORÍA (27-ago): acá se leía solo el hilo de Beto.
     * 🔴 BUG CAZADO EN AUDITORÍA (3-sep): la corrección anterior leía hasta
     * 1.000 mensajes de la ventana de 30 días ORDENADOS ASCENDENTE y se
     * quedaba con el último de ESOS. Impresora Color tiene ~8.200 mensajes en
     * 30 días: la consulta devolvía los 1.000 más VIEJOS (PostgREST corta ahí
     * sin avisar), y "el último que habló" era el de hace tres semanas. Con
     * eso, Beto le habría insistido con una plantilla pagada a quien respondió
     * ayer. Estaba latente porque `cotizacion_seguimiento` sigue apagado.
     *
     * El campo del contacto es exacto, gratis y ya viene en la consulta de
     * arriba. Si es null (contacto anterior al trigger), la regla pura hace
     * fail-closed y no envía.
     */
    const chatIds = contactos.map((c) => c.chat_id as string);

    // Seguimientos previos de este tipo, para no insistir dos veces.
    const { data: previos, error: errPrevios } = await supa
      .from("ed_seguimientos")
      .select("chat_id, programado_para")
      .eq("empleado_id", betoId)
      .eq("tipo", "cotizacion_sin_respuesta")
      .in("chat_id", chatIds)
      .limit(1000);
    if (errPrevios) {
      // Sin saber a quién ya se le insistió, se podría insistir dos veces.
      out.errores.push({ clienteId, error: `no se pudieron leer seguimientos previos: ${errPrevios.message}` });
      continue;
    }

    // Decisiones previas (propuesta viva, rechazo, freno del juez). Si no se
    // pueden leer, se falla cerrado: juzgar a ciegas es pagar dos veces.
    const memoria = await memoriaDePropuestas({ clienteId, tipo: "cotizacion_sin_respuesta", chatIds, supa });
    if (!memoria) {
      out.errores.push({ clienteId, error: "no se pudo leer la memoria de propuestas (¿migración 297?)" });
      continue;
    }

    const ultimoSeg = new Map<string, string>();
    for (const s of previos ?? []) {
      const k = s.chat_id as string;
      const v = s.programado_para as string;
      const prev = ultimoSeg.get(k);
      if (!prev || v > prev) ultimoSeg.set(k, v);
    }

    /**
     * COBROS PAGADOS EN LA VENTANA (9-sep-2026). La señal de cierre más dura
     * que hay: no es una etiqueta ni una etapa calculada, es plata confirmada.
     *
     * Se pide en UNA consulta para todos los chats, no una por candidato. Si la
     * migración 289 no está aplicada en algún entorno, la consulta falla y esto
     * queda como un conjunto vacío: se pierde el cruce, pero el generador sigue
     * funcionando con el resto de las reglas.
     */
    const pagados = new Set<string>();
    {
      const { data: pagos, error: errPagos } = await supa
        .from("ed_pagos")
        .select("chat_id")
        .eq("cliente_id", clienteId)
        .eq("estado", "pagado")
        .gte("creado_en", desde)
        .in("chat_id", chatIds)
        .limit(1000);
      /**
       * FAIL-CLOSED (Fase 0). Antes el error se ignoraba (PostgREST no lanza,
       * así que el try/catch nunca atrapaba nada) y el cruce quedaba vacío: a
       * quien ya pagó se le podía proponer «¿sigue en pie tu cotización?».
       */
      if (errPagos) {
        out.errores.push({ clienteId, error: `no se pudieron leer los cobros pagados: ${errPagos.message}` });
        continue;
      }
      for (const p of pagos ?? []) pagados.add(p.chat_id as string);
    }

    const elegibles: { chatId: string; nombre: string; diasEsperando: number }[] = [];
    for (const c of contactos) {
      const chatId = c.chat_id as string;
      const cand: Candidato = {
        chatId,
        etiquetas: ((c.etiquetas as string[] | null) ?? []),
        etapa: (c.etapa as string | null) ?? null,
        ultimoMensajeEn: (c.ultimo_mensaje_en as string | null) ?? null,
        ultimoRol: (c.ultimo_mensaje_rol as string | null) ?? null,
        etapaMotivo: (c.etapa_motivo as string | null) ?? null,
        ultimoSeguimientoEn: ultimoSeg.get(chatId) ?? null,
        pagoPagadoEnVentana: pagados.has(chatId),
      };
      const v = decidirCotizacion(cand, ahora);
      if (v.enviar) {
        const b = bloqueoPorPropuesta(memoria.get(chatId), cand.ultimoMensajeEn, ahora);
        if (b.bloquea) {
          out.yaDecididos++;
          continue;
        }
        elegibles.push({
          chatId,
          nombre: (c.nombre as string | null) || "",
          diasEsperando: v.diasEsperando,
        });
      }
    }

    out.candidatos += elegibles.length;

    const modo = await modoDe(clienteId, supa);
    /**
     * En modo aprobación el límite es la LISTA, no el gasto del día: una
     * propuesta no cuesta nada hasta que alguien la aprueba (y ahí se aplica el
     * tope diario, ver aprobarPropuesta). Sin esto, las propuestas nunca
     * consumían cupo y el juez corría hasta el tope en CADA pasada.
     */
    let usados = enviadosHoy ?? 0;
    if (modo === "aprobacion") {
      const vivas = await contarVivas(clienteId, "cotizacion_sin_respuesta", supa);
      if (vivas === null) {
        out.errores.push({ clienteId, error: "no se pudieron contar las propuestas pendientes" });
        continue;
      }
      usados = vivas;
    }
    const cupo = cuposDisponibles({
      topeDiario,
      enviadosHoy: usados,
      candidatos: elegibles.length,
    });
    if (cupo <= 0) {
      out.detalle.push(
        `${cli.nombre}: ${elegibles.length} en espera, tope diario alcanzado (${topeDiario})`,
      );
      continue;
    }

    /**
     * Los MÁS ANTIGUOS primero: `contactos` viene ordenado por fecha ascendente,
     * así que `elegibles` conserva ese orden. Son los que están más cerca de
     * salirse de la ventana de 30 días y perderse del todo.
     */
    /**
     * SEGUNDA VUELTA: EL JUEZ LEE EL HILO (9-sep-2026).
     *
     * La reja de arriba descartó el 99% con metadatos y sin gastar un peso.
     * Recién sobre los pocos que quedan se le paga al modelo por LEER la
     * conversación, porque hay falsos positivos que ningún metadato ve: la
     * cotización que nunca se envió, la que se cerró en el mesón, el «muy caro»
     * respondido con un «ok», y la etiqueta de julio que nadie borró (las
     * etiquetas son acumulativas).
     *
     * En la simulación contra Impresora Color, de 20 que pasaron la reja el juez
     * frenó 8 — entre ellos uno que ya había transferido el total y otro que
     * había pedido la devolución del dinero. Son ~$680 en mensajes que habrían
     * hecho quedar mal al negocio.
     */
    let empleadoIds: string[];
    try {
      empleadoIds = await empleadosDelCliente(clienteId, supa);
    } catch (e) {
      out.errores.push({ clienteId, error: (e as Error).message });
      continue;
    }

    let resueltos = 0;
    let sinTiempo = 0;
    let sinVeredicto = 0;
    let ultimoSinVeredicto = "";
    const frenadosAntes = out.frenadosPorJuez;
    for (const e of elegibles.slice(0, cupo)) {
      /**
       * Si no queda tiempo útil, se corta acá y no se marca nada. En el próximo
       * latido estos mismos candidatos vuelven a aparecer: la reja es
       * determinista y no consumieron ningún cupo.
       */
      if (typeof opciones?.fechaLimite === "number" && Date.now() > opciones.fechaLimite - 9_000) {
        sinTiempo = cupo - resueltos - (out.frenadosPorJuez - frenadosAntes);
        break;
      }

      const v = await juzgar({
        fechaLimite: opciones?.fechaLimite,
        chatId: e.chatId,
        negocio: (cli.nombre as string) || "",
        diasEsperando: e.diasEsperando,
        empleadoIds,
        supa,
      });
      const d = decidirConJuez(v);

      if (!d.enviar) {
        if (v.abierta === null) {
          // El juez no pudo decidir (hilo ilegible, modelo caído): no es un "no".
          // Se guarda con marca de reintento a las 24 h para no volver a pagar
          // el mismo hilo cada 5 minutos, y cuenta UN error por negocio por
          // corrida (no uno por candidato).
          sinVeredicto++;
          ultimoSinVeredicto = v.motivo;
          const f = await registrarFrenado({
            clienteId,
            empleadoId: betoId,
            chatId: e.chatId,
            tipo: "cotizacion_sin_respuesta",
            motivoJuez: `${PREFIJO_SIN_VEREDICTO} ${v.motivo}`.slice(0, 500),
            evidencia: { diasEsperando: e.diasEsperando },
            supa,
          });
          if (!f.ok) out.errores.push({ clienteId, error: `no se pudo guardar el reintento del juez: ${f.error}` });
          continue;
        }
        out.frenadosPorJuez++;
        const f = await registrarFrenado({
          clienteId,
          empleadoId: betoId,
          chatId: e.chatId,
          tipo: "cotizacion_sin_respuesta",
          motivoJuez: d.motivo,
          evidencia: { diasEsperando: e.diasEsperando, mensajesLeidos: v.mensajes.length },
          supa,
        });
        if (!f.ok) out.errores.push({ clienteId, error: `no se pudo guardar el freno del juez: ${f.error}` });
        continue;
      }

      /**
       * ⭐ `d.cotizado` es la variable {{3}} de la plantilla. Con el juez, el
       * mensaje pasa de «por la cotización de lo que nos consultaste» a «por la
       * cotización de 200 carpetas tamaño oficio». Cuando el juez no logra
       * nombrarlo, `decidirConJuez` deja la fórmula neutra de siempre: nunca se
       * inventa un producto.
       */
      if (modo === "aprobacion") {
        /**
         * MODO APROBACIÓN (el default): no sale nada todavía. Queda una
         * propuesta en /seguimientos con el veredicto y la evidencia, y una
         * persona decide. Recién al aprobar se llama a `programarSeguimiento`.
         */
        const r = await proponerSeguimiento({
          clienteId,
          empleadoId: betoId,
          chatId: e.chatId,
          tipo: "cotizacion_sin_respuesta",
          cotizado: d.cotizado,
          motivoJuez: d.motivo,
          evidencia: {
            diasEsperando: e.diasEsperando,
            mensajesLeidos: v.mensajes.length,
            nombre: e.nombre,
          },
          supa,
        });
        if (r.ok) {
          out.propuestos++;
          resueltos++;
        } else {
          out.detalle.push(`${e.chatId}: no se pudo proponer (${r.error})`);
          out.errores.push({ clienteId, error: `no se pudo proponer: ${r.error}` });
        }
        continue;
      }

      const r = await programarSeguimiento({
        empleadoId: betoId,
        chatId: e.chatId,
        tipo: "cotizacion_sin_respuesta",
        // La plantilla pide: nombre, negocio, y de qué era la cotización.
        paramsPlantilla: [e.nombre || "hola", (cli.nombre as string) || "", d.cotizado],
        programadoPara: new Date(),
        supa,
      });
      if (r.ok) {
        out.programados++;
        resueltos++;
      } else {
        out.detalle.push(`${e.chatId}: no se pudo programar (${r.error})`);
        out.errores.push({ clienteId, error: `no se pudo programar: ${r.error}` });
      }
    }

    if (sinVeredicto) {
      out.errores.push({ clienteId, error: `juez sin veredicto en ${sinVeredicto} candidato(s): ${ultimoSinVeredicto}` });
    }
    out.detalle.unshift(
      `${cli.nombre}: ${elegibles.length} elegibles · ${out.frenadosPorJuez - frenadosAntes} frenados por el juez · ` +
        `${resueltos} ${modo === "aprobacion" ? "propuestos para aprobar" : "programados"}` +
        (sinTiempo > 0 ? ` · ${sinTiempo} quedaron para el próximo latido (sin tiempo)` : ""),
    );
  }

  return out;
}
