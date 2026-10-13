-- Migración 328: locales de Kambak con agenda propia.
-- Cada local de Kambak (barbería, restaurante, cafetería) que activa "Agenda" en el panel de Kambak
-- se crea como un negocio hijo de la cuenta Kambak. Sus servicios, profesionales y citas viven en las
-- mismas tablas ed_* de siempre; solo se agrega el vínculo hijo -> cuenta madre.

alter table ed_clientes
  add column if not exists kambak_padre_id uuid references ed_clientes(id) on delete set null,
  add column if not exists kambak_local_slug text;

-- Un local de Kambak solo puede existir una vez bajo su cuenta madre.
create unique index if not exists ux_ed_clientes_kambak_local
  on ed_clientes (kambak_padre_id, kambak_local_slug)
  where kambak_padre_id is not null;
