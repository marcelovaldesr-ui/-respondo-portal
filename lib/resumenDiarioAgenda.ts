import { db } from "@/lib/db";
import { configPorCliente, enviarTexto } from "@/lib/whatsapp";
import { enviarTextoWaha } from "@/lib/waha";
import { fechaChileDe, horaChileAUtc, ZONA_AGENDA } from "@/lib/agendaCore";

/**
 * RESUMEN DIARIO DE AGENDA AL DUEÑO POR WHATSAPP.
 *
 * Todas las mañanas (entre 08:00 y 09:59 hora de Chile) revisa los negocios
 * activos que usan la agenda y les manda al WhatsApp del dueño
 * (`telefono_escalacion` o `whatsapp_negocio`) el panorama del día:
 *   - Cuántas horas hay agendadas hoy (confirmadas vs. por confirmar) y el
 *     ingreso estimado del día.
 *   - El desglose por profesional/barbero con la primera y siguientes horas.
 *   - Cuántas horas de ayer quedaron "Por cerrar" para que recuerde marcar
 *     "Sí, se atendió" (y así disparen el sello de Kambak y las comisiones).
 *
 * Idempotencia: guarda `resumen_diario_agenda:<clienteId>` en `ed_latidos` con
 * `detalle.fecha = YYYY-MM-DD` antes de enviar, para que nunca salga dos veces
 * el mismo día. Si un negocio no tiene citas hoy ni pendientes de ayer, no
 * molesta al dueño.
 */

export type CitaResumenDia = {
  id: string;
  nombreContacto: string;
  inicio: string;
  fin: string;
  estado: string;
  servicio: string;
  precioClp: number | null;
  profesional: string;
};

export type DatosResumenDiario = {
  nombreNegocio: string;
  claveHoy: string;
  citasHoy: CitaResumenDia[];
  porCerrarAyer: number;
};

const ESTADOS_ACTIVOS = new Set(["agendada", "confirmada", "reagendada", "completada"]);

export function claveFechaChile(d: Date): string {
  const f = fechaChileDe(d);
  return `${f.anio}-${String(f.mes).padStart(2, "0")}-${String(f.dia).padStart(2, "0")}`;
}

const DTF_HORA_CHILE = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA_AGENDA,
  hour: "2-digit",
  hour12: false,
});

export function esVentanaResumenMatutino(ahora: Date): boolean {
  const parteHora = DTF_HORA_CHILE.formatToParts(ahora).find((p) => p.type === "hour")?.value;
  const hora = Number(parteHora ?? -1) % 24;
  return hora >= 8 && hora < 10;
}

function hhmmChile(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA_AGENDA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function armarMensajeResumenDiario(datos: DatosResumenDiario): string | null {
  const activasHoy = datos.citasHoy
    .filter((c) => ESTADOS_ACTIVOS.has(c.estado))
    .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));

  if (activasHoy.length === 0 && datos.porCerrarAyer === 0) {
    return null;
  }

  const lineas: string[] = [
    `☀️ *Resumen de hoy (${datos.claveHoy}) — ${datos.nombreNegocio}*`,
  ];

  if (activasHoy.length === 0) {
    lineas.push("📅 Hoy no hay horas agendadas por ahora.");
  } else {
    const confirmadas = activasHoy.filter(
      (c) => c.estado === "confirmada" || c.estado === "completada",
    ).length;
    const porConfirmar = activasHoy.length - confirmadas;
    const ingresoEstimado = activasHoy.reduce((acc, c) => acc + (c.precioClp ?? 0), 0);

    const textoMonto =
      ingresoEstimado > 0 ? ` · ~$${ingresoEstimado.toLocaleString("es-CL")}` : "";

    lineas.push(
      `📅 *${activasHoy.length} ${activasHoy.length === 1 ? "reserva" : "reservas"} hoy* (${confirmadas} confirmada${confirmadas === 1 ? "" : "s"}, ${porConfirmar} por confirmar)${textoMonto}`,
    );

    const porProf = new Map<string, CitaResumenDia[]>();
    for (const c of activasHoy) {
      const prof = c.profesional || "General";
      const arr = porProf.get(prof) ?? [];
      arr.push(c);
      porProf.set(prof, arr);
    }

    for (const [prof, lista] of porProf.entries()) {
      const muestra = lista
        .slice(0, 5)
        .map((c) => `${hhmmChile(c.inicio)} ${c.nombreContacto} (${c.servicio})`)
        .join(", ");
      const extra = lista.length > 5 ? ` y ${lista.length - 5} más` : "";
      lineas.push(`• *${prof}* (${lista.length}): ${muestra}${extra}`);
    }
  }

  if (datos.porCerrarAyer > 0) {
    lineas.push(
      `⚠️ Tienes *${datos.porCerrarAyer}* ${datos.porCerrarAyer === 1 ? "hora pasada" : "horas pasadas"} sin cerrar en la agenda. Marca "Sí, se atendió" para registrar la visita y sumar el sello.`,
    );
  }

  return lineas.join("\n");
}

export type ResultadoResumenDiario = {
  revisados: number;
  enviados: number;
  omitidos: number;
  detalle: string[];
  errores: { clienteId: string; error: string }[];
};

export async function enviarResumenesDiariosAgenda(opts?: {
  ahora?: Date;
  forzar?: boolean;
  supa?: ReturnType<typeof db>;
  enviar?: (
    cliente: { id: string; nombre: string; transporte: string; destino: string },
    texto: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}): Promise<ResultadoResumenDiario> {
  const ahora = opts?.ahora ?? new Date();
  const out: ResultadoResumenDiario = {
    revisados: 0,
    enviados: 0,
    omitidos: 0,
    detalle: [],
    errores: [],
  };

  if (!opts?.forzar && !esVentanaResumenMatutino(ahora)) {
    return { ...out, detalle: ["fuera_de_ventana_matutina"] };
  }

  const supa = opts?.supa ?? db();
  const hoy = fechaChileDe(ahora);
  const claveHoy = claveFechaChile(ahora);

  const inicioHoyUtc = horaChileAUtc(hoy.anio, hoy.mes, hoy.dia, 0, 0);
  const finHoyUtc = horaChileAUtc(hoy.anio, hoy.mes, hoy.dia, 23, 59);
  const inicioAyerUtc = new Date(inicioHoyUtc.getTime() - 86_400_000);

  const { data: clientes, error } = await supa
    .from("ed_clientes")
    .select("id, nombre, transporte, telefono_escalacion, whatsapp_negocio, canal_escalacion")
    .eq("activo", true);

  if (error || !clientes?.length) {
    return { ...out, detalle: [error ? "error_clientes" : "sin_clientes"] };
  }

  const enviarFn =
    opts?.enviar ??
    (async (cli, texto) => {
      if (cli.transporte === "cloud") {
        const cfg = await configPorCliente(cli.id);
        if (!cfg) return { ok: false, error: "cliente cloud sin credenciales" };
        return enviarTexto(cfg, cli.destino, texto, { sinEspera: true });
      }
      return enviarTextoWaha(cli.destino, texto, { clienteId: cli.id });
    });

  for (const cli of clientes) {
    const clienteId = cli.id as string;
    const canal = ((cli.canal_escalacion as string | null) ?? "whatsapp").toLowerCase();
    const destino = (
      (cli.telefono_escalacion as string | null) ||
      (cli.whatsapp_negocio as string | null) ||
      ""
    ).trim();

    if (!destino || canal === "email") {
      out.omitidos++;
      continue;
    }

    const claveLatido = `resumen_diario_agenda:${clienteId}`;
    const { data: latidoPrevio } = await supa
      .from("ed_latidos")
      .select("corridas, detalle")
      .eq("clave", claveLatido)
      .maybeSingle();

    const fechaPrevia = (latidoPrevio?.detalle as { fecha?: string } | null)?.fecha;
    if (!opts?.forzar && fechaPrevia === claveHoy) {
      out.omitidos++;
      continue;
    }

    out.revisados++;

    const [citasR, serviciosR, profesionalesR] = await Promise.all([
      supa
        .from("ed_citas")
        .select("id, nombre_contacto, inicio, fin, estado, servicio_id, profesional_id")
        .eq("cliente_id", clienteId)
        .gte("inicio", inicioAyerUtc.toISOString())
        .lte("inicio", finHoyUtc.toISOString())
        .order("inicio", { ascending: true }),
      supa.from("ed_servicios").select("id, nombre, precio_clp").eq("cliente_id", clienteId),
      supa.from("ed_profesionales").select("id, nombre").eq("cliente_id", clienteId),
    ]);

    if (citasR.error) {
      out.errores.push({ clienteId, error: citasR.error.message });
      continue;
    }

    const mapaServicios = new Map<string, { nombre: string; precioClp: number | null }>();
    for (const s of serviciosR.data ?? []) {
      mapaServicios.set(s.id as string, {
        nombre: (s.nombre as string) || "Servicio",
        precioClp: (s.precio_clp as number | null) ?? null,
      });
    }
    const mapaProfesionales = new Map<string, string>();
    for (const p of profesionalesR.data ?? []) {
      mapaProfesionales.set(p.id as string, (p.nombre as string) || "General");
    }

    const citasHoy: CitaResumenDia[] = [];
    let porCerrarAyer = 0;

    for (const c of citasR.data ?? []) {
      const claveCita = claveFechaChile(new Date(c.inicio as string));
      const estado = (c.estado as string) || "agendada";
      if (claveCita === claveHoy) {
        const svc = mapaServicios.get(c.servicio_id as string);
        citasHoy.push({
          id: c.id as string,
          nombreContacto: (c.nombre_contacto as string) || "Cliente",
          inicio: c.inicio as string,
          fin: c.fin as string,
          estado,
          servicio: svc?.nombre ?? "Servicio",
          precioClp: svc?.precioClp ?? null,
          profesional: mapaProfesionales.get(c.profesional_id as string) ?? "General",
        });
      } else if (
        Date.parse(c.fin as string) < inicioHoyUtc.getTime() &&
        ["agendada", "confirmada", "reagendada"].includes(estado)
      ) {
        porCerrarAyer++;
      }
    }

    const texto = armarMensajeResumenDiario({
      nombreNegocio: (cli.nombre as string) || "Tu negocio",
      claveHoy,
      citasHoy,
      porCerrarAyer,
    });

    if (!texto) {
      out.omitidos++;
      continue;
    }

    // Reservamos el día antes de enviar para evitar doble disparo en corridas cercanas.
    const corridas = Number((latidoPrevio as { corridas?: number } | null)?.corridas ?? 0) + 1;
    await supa.from("ed_latidos").upsert(
      {
        clave: claveLatido,
        ultimo_en: ahora.toISOString(),
        corridas,
        detalle: { fecha: claveHoy, reservas_hoy: citasHoy.length, por_cerrar: porCerrarAyer },
      },
      { onConflict: "clave" },
    );

    const transporte = ((cli.transporte as string | null) ?? "waha").toLowerCase();
    const rEnvio = await enviarFn(
      {
        id: clienteId,
        nombre: (cli.nombre as string) || "Negocio",
        transporte,
        destino,
      },
      texto,
    );

    if (rEnvio.ok) {
      out.enviados++;
      out.detalle.push(`${cli.nombre}: resumen enviado`);
    } else {
      out.errores.push({ clienteId, error: rEnvio.error ?? "error al enviar resumen" });
      out.detalle.push(`${cli.nombre}: fallo envío (${rEnvio.error})`);
    }
  }

  return out;
}
