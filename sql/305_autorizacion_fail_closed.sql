-- ═══════════════════════════════════════════════════════════════════════════
-- 305 · El rol por omisión deja de ser el rol más poderoso
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Auditoría 11-sep-2026, hallazgo 1 (`lib/auth.ts` tenía `rol ?? "dueno"`).
--
-- LO QUE SE COMPROBÓ CONTRA ESTA BASE, antes de tocar nada:
--
--   · `portal_usuarios.rol` es NOT NULL            → el `??` del código nunca
--                                                     llegaba a dispararse.
--   · tiene `check (rol in ('dueno','staff'))`     → 'admin', 'Dueno', 'zzz' y
--                                                     cualquier otro valor ya
--                                                     eran rechazados (23514).
--   · `email` es UNIQUE                            → no existe el escenario de
--                                                     dos filas activas para el
--                                                     mismo correo.
--
-- O sea: la escalada de privilegios NO era alcanzable hoy. Lo que había era una
-- seguridad que dependía por completo de invariantes de la base sin que el
-- código lo dijera en ninguna parte, y un `default` que empuja en la dirección
-- contraria. Esto arregla lo segundo.
--
-- EL DEFAULT ERA 'dueno'. Nadie crea usuarios del portal desde la aplicación —
-- no hay pantalla de invitaciones; las filas se insertan a mano por SQL. Así
-- que `insert into portal_usuarios (email, cliente_id) values (...)`, que es
-- exactamente como se escribe un insert apurado, creaba en silencio un DUEÑO:
-- acceso a integraciones, a la publicidad y al historial completo de
-- conversaciones del negocio. Olvidar una columna no puede otorgar permisos.
--
-- Con 'staff' por omisión, el mismo insert apurado crea a alguien que puede
-- atender el mesón y nada más. Si hacía falta un dueño, se nota enseguida y se
-- corrige con un update; el error pasa a ser visible y barato, en vez de
-- silencioso y caro.
--
-- No cambia ninguna fila existente: un `default` solo aplica a inserts futuros.
-- Las 6 filas de hoy siguen siendo 'dueno'.

alter table portal_usuarios alter column rol set default 'staff';

comment on column portal_usuarios.rol is
  'dueno | staff (ver el check). Por omisión staff: olvidar la columna no puede '
  'crear un dueño. La matriz de permisos vive en lib/permisos.ts y un rol que no '
  'esté en ella no abre sesión.';

-- ── Verificación ────────────────────────────────────────────────────────────
select
  column_name,
  is_nullable,
  column_default
from information_schema.columns
where table_name = 'portal_usuarios' and column_name = 'rol';
-- Esperado: rol | NO | 'staff'::text

-- Y el reparto actual, que no debe haber cambiado:
select rol, activo, count(*) from portal_usuarios group by 1, 2 order by 1, 2;
