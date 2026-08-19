-- 282 · Ficha del contacto: lo que el negocio sabe de su cliente
--
-- POR QUÉ
-- Beto tiene que decidir a quién le toca mantención. Para eso necesita saber
-- QUÉ tiene el cliente y CUÁNDO fue la última vez que vino. ed_contactos solo
-- guardaba nombre, teléfono y etiquetas: todo lo demás vivía en la cabeza del
-- equipo o en un sistema al que no nos conectamos.
--
-- DOS COLUMNAS, A PROPÓSITO
--   · ultima_atencion es una FECHA de verdad, con índice, porque es sobre lo
--     que se filtra en cada pasada del cron. Dentro de un jsonb obligaría a
--     castear en cada consulta y a leer la tabla entera.
--   · datos es un jsonb libre porque lo que se guarda cambia por rubro: una
--     moto y su kilometraje en RS-Shop, la raza y el peso en un veterinario,
--     la patente en un taller de autos. Meter una columna por rubro habría
--     llenado la tabla de campos nulos.
--
-- SEGURA DE APLICAR ANTES O DESPUÉS DEL DEPLOY: las dos columnas son
-- opcionales y el código las trata como ausentes si no están (el importador
-- avisa y no escribe, el generador no programa nada).

alter table ed_contactos add column if not exists ultima_atencion date;
alter table ed_contactos add column if not exists datos jsonb not null default '{}';

create index if not exists idx_ed_contactos_ultima_atencion
  on ed_contactos (cliente_id, ultima_atencion)
  where ultima_atencion is not null;

create index if not exists idx_ed_contactos_datos
  on ed_contactos using gin (datos);

comment on column ed_contactos.ultima_atencion is
  'Fecha de la última visita/compra. La usa el generador de seguimientos de Beto.';
comment on column ed_contactos.datos is
  'Ficha libre por rubro: {"vehiculo":"KTM 390 Duke 2023","ultimo_trabajo":"mantención 10.000 km","kilometraje":"9800"}.';

-- El intervalo entre mantenciones lo define cada negocio en la puesta en marcha
-- (una moto no es una consulta dental). Sin este campo el generador usaría 6
-- meses para todos, que es un promedio que no le sirve bien a nadie.
alter table ed_clientes add column if not exists intervalo_mantencion_meses int;

comment on column ed_clientes.intervalo_mantencion_meses is
  'Meses entre mantenciones/visitas. Si es null, el generador de Beto usa 6.';
