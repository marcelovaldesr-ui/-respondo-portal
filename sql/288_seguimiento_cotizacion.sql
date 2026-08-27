-- ============================================================================
-- 288 · BETO PERSIGUE LAS COTIZACIONES QUE NADIE CONTESTÓ
-- ============================================================================
--
-- EL AGUJERO QUE TAPA
-- -------------------
-- Se rastrearon todos los puntos del código que programan un seguimiento. Eran
-- tres, y los tres dependen de una CITA o del rubro motos. **Una imprenta no
-- agenda horas**: Impresora Color tiene 356 conversaciones, ninguna cita, y 134
-- marcadas como cotización.
--
-- Resultado: Beto y Vera no le hacían absolutamente nada, y las plantillas que
-- se crearon el 26-ago quedaban inertes — existían en Meta y nada las disparaba.
--
-- Este generador usa la única señal que YA existe: Tino marca la conversación
-- con la etiqueta `cotizacion` cuando su motor decide cotizar.
--
-- ⚠️⚠️ ESTO CUESTA PLATA DE VERDAD
-- --------------------------------
-- `cotizacion_pendiente` es MARKETING para Meta (~$85 por envío) y no se puede
-- bajar a utilidad: se probaron dos redacciones y Meta movió las dos. Con 134
-- cotizaciones abiertas, una pasada sin freno serían ~$11.000 decididos por un
-- cron de madrugada.
--
-- Por eso: **nace apagado y con tope diario**. Encenderlo es una decisión del
-- negocio, y el tope es lo que impide una sorpresa en la factura.
-- ============================================================================

alter table ed_clientes
  add column if not exists cotizacion_seguimiento boolean not null default false;
comment on column ed_clientes.cotizacion_seguimiento is
  'Si Beto persigue cotizaciones sin respuesta. Apagado por defecto: cada envío es marketing (~$85).';

-- Diez al día. Con la ventana de 3 a 30 días, alcanza para cubrir el flujo
-- normal de una pyme sin que un lote viejo se vaya entero en una noche.
alter table ed_clientes
  add column if not exists cotizacion_tope_diario int not null default 10;
comment on column ed_clientes.cotizacion_tope_diario is
  'Máximo de seguimientos de cotización por día. Es un tope de GASTO, no de carga.';

-- ── Índice del barrido ──────────────────────────────────────────────────────
--
-- El generador busca contactos en etapa `cotizado` ordenados por su último
-- mensaje. Sin índice, cada pasada recorre la tabla entera de contactos.
create index if not exists idx_ed_contactos_cotizado
  on ed_contactos (cliente_id, ultimo_mensaje_en)
  where etapa = 'cotizado';

-- ── Verificación ────────────────────────────────────────────────────────────
-- Debe devolver 2 columnas nuevas y NINGÚN cliente encendido.
select
  (select count(*) from information_schema.columns
     where table_name = 'ed_clientes'
       and column_name in ('cotizacion_seguimiento', 'cotizacion_tope_diario')) as columnas,
  (select count(*) from ed_clientes where cotizacion_seguimiento)               as encendidos;
