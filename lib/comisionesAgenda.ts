/**
 * LIQUIDACIÓN DE COMISIONES POR PROFESIONAL / BARBERO.
 *
 * Módulo puro (sin base de datos) para calcular cuánto produjo cada profesional
 * y cuánto le corresponde de comisión según su `comision_pct` (0 a 100%).
 *
 * REGLA DE NEGOCIO:
 * Solo suman comisión las citas en estado `completada` ("Sí, se atendió" o
 * cerradas por encuesta de Vera). Las citas agendadas, confirmadas, canceladas
 * o `no_show` no generan pago al profesional.
 */

export type ProfesionalComisionInput = {
  id: string;
  nombre: string;
  comisionPct?: number | null;
};

export type CitaComisionInput = {
  id: string;
  profesionalId: string | null;
  estado: string;
  inicio: string;
  precioClp: number | null;
};

export type FilaComisionProfesional = {
  profesionalId: string;
  nombre: string;
  comisionPct: number;
  atenciones: number;
  totalVendidoClp: number;
  comisionClp: number;
  retencionLocalClp: number;
};

export type ResumenComisiones = {
  filas: FilaComisionProfesional[];
  totalAtenciones: number;
  totalVendidoClp: number;
  totalComisionClp: number;
  totalRetencionLocalClp: number;
};

export function normalizarPorcentajeComision(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function calcularComisionesProfesionales(params: {
  profesionales: ProfesionalComisionInput[];
  citas: CitaComisionInput[];
  desdeIso?: string;
  hastaIso?: string;
}): ResumenComisiones {
  const desdeMs = params.desdeIso ? Date.parse(params.desdeIso) : null;
  const hastaMs = params.hastaIso ? Date.parse(params.hastaIso) : null;

  const acumulador = new Map<
    string,
    { nombre: string; comisionPct: number; atenciones: number; totalVendidoClp: number }
  >();

  for (const p of params.profesionales) {
    acumulador.set(p.id, {
      nombre: p.nombre,
      comisionPct: normalizarPorcentajeComision(p.comisionPct),
      atenciones: 0,
      totalVendidoClp: 0,
    });
  }

  for (const c of params.citas) {
    if (c.estado !== "completada") continue;
    if (!c.profesionalId) continue;

    const inicioMs = Date.parse(c.inicio);
    if (desdeMs !== null && Number.isFinite(desdeMs) && inicioMs < desdeMs) continue;
    if (hastaMs !== null && Number.isFinite(hastaMs) && inicioMs > hastaMs) continue;

    const item = acumulador.get(c.profesionalId);
    if (!item) continue;

    const precio = Number(c.precioClp ?? 0);
    item.atenciones += 1;
    if (Number.isFinite(precio) && precio > 0) {
      item.totalVendidoClp += Math.round(precio);
    }
  }

  const filas: FilaComisionProfesional[] = [];
  let totalAtenciones = 0;
  let totalVendidoClp = 0;
  let totalComisionClp = 0;

  for (const [profesionalId, item] of acumulador.entries()) {
    const comisionClp = Math.round((item.totalVendidoClp * item.comisionPct) / 100);
    const retencionLocalClp = item.totalVendidoClp - comisionClp;
    filas.push({
      profesionalId,
      nombre: item.nombre,
      comisionPct: item.comisionPct,
      atenciones: item.atenciones,
      totalVendidoClp: item.totalVendidoClp,
      comisionClp,
      retencionLocalClp,
    });
    totalAtenciones += item.atenciones;
    totalVendidoClp += item.totalVendidoClp;
    totalComisionClp += comisionClp;
  }

  return {
    filas,
    totalAtenciones,
    totalVendidoClp,
    totalComisionClp,
    totalRetencionLocalClp: totalVendidoClp - totalComisionClp,
  };
}
