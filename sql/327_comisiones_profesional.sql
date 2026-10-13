-- Migración 325: porcentaje de comisión por profesional / barbero.
-- Permite liquidar cuánto produjo cada profesional sobre citas en estado 'completada'.

alter table ed_profesionales
  add column if not exists comision_pct integer not null default 0
  check (comision_pct >= 0 and comision_pct <= 100);
