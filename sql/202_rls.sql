-- ============================================================================
-- 202_rls.sql  ·  Segunda barrera de seguridad (Row Level Security)
-- ----------------------------------------------------------------------------
-- QUÉ HACE: enciende RLS en todas las tablas del motor y del portal, SIN crear
-- políticas. Es decir: por defecto nadie puede leer ni escribir estas tablas,
-- salvo quien use la llave secreta (service_role), que salta RLS por diseño.
--
-- POR QUÉ: hoy el aislamiento entre clientes lo garantiza el código del portal
-- (todo se filtra por cliente_id) y está verificado. Pero si algún día se filtra
-- la llave publicable —que es pública, va en el navegador— sin RLS cualquiera
-- podría leer la base entera desde afuera. Con RLS encendido, esa llave no
-- sirve para nada contra estas tablas.
--
-- QUÉ NO ROMPE:
--  - El portal: usa la llave secreta en el servidor. Sigue igual.
--  - El motor n8n: también usa la llave secreta. Sigue igual.
--  - El login: Supabase Auth vive en el esquema auth, no se toca.
--
-- CUÁNDO HABRÍA QUE AGREGAR POLÍTICAS: solo si algún día el navegador consulta
-- estas tablas directamente. Hoy no pasa: todo va por el servidor.
--
-- REVERSIBLE: cambiar "enable" por "disable" en cada línea.
-- ============================================================================

alter table ed_clientes      enable row level security;
alter table ed_empleados     enable row level security;
alter table ed_conocimiento  enable row level security;
alter table ed_correcciones  enable row level security;
alter table ed_test_bank     enable row level security;
alter table ed_test_runs     enable row level security;
alter table ed_escalaciones  enable row level security;
alter table ed_chat_estado   enable row level security;
alter table ed_metricas      enable row level security;
alter table ed_seguimientos  enable row level security;
alter table ed_mensajes      enable row level security;
alter table ed_contactos     enable row level security;
alter table ed_resultados    enable row level security;
alter table portal_usuarios  enable row level security;

-- ---------------------------------------------------------------------------
-- Verificación: todas deben aparecer con rowsecurity = true
-- ---------------------------------------------------------------------------
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and (tablename like 'ed\_%' or tablename = 'portal_usuarios')
order by tablename;
