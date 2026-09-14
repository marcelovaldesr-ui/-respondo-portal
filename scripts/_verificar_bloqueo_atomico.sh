#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# _verificar_bloqueo_atomico.sh · prueba de integración contra Postgres REAL
# (auditoría externa 13-sep-2026, Hallazgo P2 — ver sql/308_agenda_bloqueo_atomico.sql)
#
# QUÉ PRUEBA. Que una cita nunca puede confirmarse dentro de un bloqueo activo
# —ni al revés— NI SIQUIERA bajo concurrencia real, con dos transacciones que
# de verdad corren al mismo tiempo en dos conexiones separadas a Postgres. No
# es un mock: crea su propio cluster Postgres desechable, aplica el esquema
# mínimo de ed_citas/ed_bloqueos y la migración 308, y mide con
# clock_timestamp() y \timing que la segunda transacción REALMENTE esperó al
# advisory lock de la primera (no que "le tocó ganar por orden de llegada").
#
# Corre TRES escenarios:
#   1) SIN la migración 308 (el bug tal cual estaba): una cita se crea en
#      silencio encima de un bloqueo. Prueba que el hallazgo era real.
#   2) CON la migración 308, bloqueo primero (interleaving exacto de la
#      auditoría: T1 dueño bloquea, T2/T3 cliente confirma): la cita queda
#      bloqueada, con el mensaje correcto.
#   3) CON la migración 308, cita primero: el bloqueo que caería encima queda
#      rechazado (garantía inversa).
#
# REQUIERE: un binario de PostgreSQL 16 instalable/arrancable localmente
# (postgresql-16 + postgresql-client-16 vía apt, o ya instalado) y permiso
# para iniciar el cluster. NO toca la base de datos real del proyecto — todo
# ocurre en un cluster Postgres aparte, con bases de datos "agenda_test*" que
# este script crea y destruye.
#
# USO:  bash scripts/_verificar_bloqueo_atomico.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
# El cluster corre como el usuario del sistema "postgres" (via `su postgres`):
# necesita poder ATRAVESAR y LEER este directorio temporal, que por defecto
# nace 700 y de otro dueño.
chmod 755 "$WORKDIR"
umask 022

CID=11111111-1111-1111-1111-111111111111
PID=22222222-2222-2222-2222-222222222222
SID=33333333-3333-3333-3333-333333333333

echo "→ Cluster Postgres local (arranca si no está corriendo)…"
if command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_lsclusters 2>/dev/null | grep -q "online" || pg_ctlcluster 16 main start
else
  echo "No hay pg_ctlcluster; asume que hay un Postgres accesible como usuario 'postgres' sin contraseña." >&2
fi

psql_pg() { su postgres -c "psql -v ON_ERROR_STOP=1 $*"; }

cat > "$WORKDIR/esquema.sql" <<'SQL'
create extension if not exists pgcrypto;
create extension if not exists btree_gist;
create table ed_clientes (id uuid primary key default gen_random_uuid());
create table ed_servicios (id uuid primary key default gen_random_uuid(), cliente_id uuid not null references ed_clientes(id));
create table ed_profesionales (id uuid primary key default gen_random_uuid(), cliente_id uuid not null references ed_clientes(id));
create table ed_bloqueos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references ed_clientes(id) on delete cascade,
  profesional_id uuid references ed_profesionales(id) on delete cascade,
  desde timestamptz not null, hasta timestamptz not null, motivo text,
  check (desde < hasta)
);
create table ed_citas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references ed_clientes(id) on delete cascade,
  servicio_id uuid not null references ed_servicios(id),
  profesional_id uuid not null references ed_profesionales(id),
  chat_id text, nombre_contacto text not null, telefono text,
  inicio timestamptz not null, fin timestamptz not null,
  estado text not null default 'agendada' check (estado in
    ('agendada','confirmada','reagendada','cancelada','no_show','completada')),
  origen text not null default 'whatsapp', clase_id uuid,
  creado_en timestamptz not null default now(),
  check (inicio < fin),
  constraint ed_citas_sin_solape exclude using gist (
    profesional_id with =, tstzrange(inicio, fin) with &&
  ) where (estado in ('agendada','confirmada','reagendada') and clase_id is null)
);
SQL

fila() { # fila <db> <sql> — ejecuta y muestra
  su postgres -c "psql -d $1 -tAc \"$2\""
}

# ms_de_bloqueo <archivo_de_salida> — milisegundos que tardó la sentencia que
# esperó el advisory lock (la línea "Time:" pegada al ERROR/resultado del
# INSERT). Sin esto, el script solo comprobaría que el conflicto fue
# rechazado — no que REALMENTE esperó el lock en vez de ganar por casualidad
# de orden de llegada.
ms_de_bloqueo() {
  # psql antepone "psql:<archivo>:<línea>: " a sus propios ERROR, así que no
  # alcanza con anclar al inicio de línea. `|| true` al final: con `set -e`
  # activo, un grep sin coincidencias no debe abortar el script ACÁ — el
  # llamador (afirmar_espero_lock) es quien decide qué hacer con un resultado
  # vacío, con su propio mensaje.
  # -A2 porque un RAISE EXCEPTION con CONTEXT mete una línea "CONTEXT:" entre
  # el ERROR y el "Time:" — con -A1 sola la línea de tiempo queda afuera.
  { grep -A2 -E "ERROR:|^INSERT " "$1" | grep "^Time:" | head -1 | sed -E 's/^Time: ([0-9.]+) ms.*/\1/'; } || true
}

# afirmar_espero_lock <archivo> — falla el script si la sentencia no tardó al
# menos 1000ms (la otra sesión duerme 2s con el lock tomado; 0.4s de arranque
# + de sobra hasta el commit deja un margen amplio y nada frágil).
afirmar_espero_lock() {
  local ms
  ms=$(ms_de_bloqueo "$1")
  if [ -z "$ms" ]; then
    echo "✗ No se pudo leer el tiempo de la sentencia bloqueada en $1 (¿cambió el formato de salida de psql?)." >&2
    exit 1
  fi
  # Comparación entera (bash no hace floats): trunca a milisegundos enteros.
  local ms_entero=${ms%%.*}
  if [ "$ms_entero" -lt 1000 ]; then
    echo "✗ La sentencia tardó solo ${ms}ms — no hay evidencia de que haya esperado el advisory lock (se esperaban ≥1000ms)." >&2
    exit 1
  fi
  echo "  (esperó ${ms}ms al advisory lock antes de fallar — coincide con los ~2s que la otra sesión lo mantuvo tomado)"
}

seed() {
  su postgres -c "psql -d $1 -v ON_ERROR_STOP=1 -c \"
    insert into ed_clientes (id) values ('$CID');
    insert into ed_profesionales (id, cliente_id) values ('$PID','$CID');
    insert into ed_servicios (id, cliente_id) values ('$SID','$CID');
  \""
}

echo "── Escenario 1/3: SIN la migración 308 (reproduce el hallazgo) ──────────"
su postgres -c "psql -v ON_ERROR_STOP=1 -c 'drop database if exists agenda_test_sinfix;' -c 'create database agenda_test_sinfix;'" >/dev/null
su postgres -c "psql -d agenda_test_sinfix -v ON_ERROR_STOP=1 -f $WORKDIR/esquema.sql" >/dev/null
seed agenda_test_sinfix >/dev/null
su postgres -c "psql -d agenda_test_sinfix -v ON_ERROR_STOP=1 -c \"
  insert into ed_bloqueos (cliente_id, profesional_id, desde, hasta, motivo)
    values ('$CID','$PID','2026-12-01 09:00-03','2026-12-01 18:00-03','Vacaciones');
  insert into ed_citas (cliente_id, servicio_id, profesional_id, nombre_contacto, inicio, fin)
    values ('$CID','$SID','$PID','Cliente (sin fix)','2026-12-01 10:00-03','2026-12-01 10:30-03');
\"" >/dev/null
DENTRO=$(fila agenda_test_sinfix "select count(*) from ed_citas c join ed_bloqueos b on b.cliente_id=c.cliente_id and b.profesional_id=c.profesional_id and tstzrange(b.desde,b.hasta) && tstzrange(c.inicio,c.fin);")
if [ "$DENTRO" = "1" ]; then
  echo "✓ CONFIRMADO: sin la migración 308, la cita se creó DENTRO del bloqueo sin ningún error. El hallazgo era real."
else
  echo "✗ INESPERADO: el escenario base no reprodujo el hallazgo (¿cambió el esquema?)." >&2
  exit 1
fi

echo
echo "── Escenario 2/3: CON la migración 308 — bloqueo primero, cita después (interleaving de la auditoría) ──"
su postgres -c "psql -v ON_ERROR_STOP=1 -c 'drop database if exists agenda_test_fix;' -c 'create database agenda_test_fix;'" >/dev/null
su postgres -c "psql -d agenda_test_fix -v ON_ERROR_STOP=1 -f $WORKDIR/esquema.sql" >/dev/null
# SIN ON_ERROR_STOP a propósito: 308 incluye REVOKE/GRANT a roles de Supabase
# (anon, authenticated, service_role) que no existen en este Postgres local
# desechable. Esos errores son esperados e inocuos — lo que importa es que
# las funciones y los triggers (que sí corren en este cluster) se creen.
su postgres -c "psql -d agenda_test_fix -f $RAIZ/sql/308_agenda_bloqueo_atomico.sql" 2>&1 | grep -v 'role .* does not exist' | grep -v 'skipping' || true
TRIGGERS=$(fila agenda_test_fix "select count(*) from pg_trigger where tgname in ('trg_ed_citas_verificar_bloqueo','trg_ed_bloqueos_verificar_cita');")
if [ "$TRIGGERS" != "2" ]; then
  echo "✗ No se pudieron crear los dos triggers de la migración 308 (encontrados: $TRIGGERS/2)." >&2
  exit 1
fi
seed agenda_test_fix >/dev/null

cat > "$WORKDIR/bloqueo_primero.sql" <<SQL
BEGIN;
INSERT INTO ed_bloqueos (cliente_id, profesional_id, desde, hasta, motivo)
  VALUES ('$CID','$PID','2026-11-05 09:00-03','2026-11-05 18:00-03','Feriado');
SELECT pg_sleep(2);
COMMIT;
SQL
cat > "$WORKDIR/cita_despues.sql" <<SQL
\timing on
SELECT pg_sleep(0.4);
SELECT clock_timestamp() AS intento_insert;
BEGIN;
INSERT INTO ed_citas (cliente_id, servicio_id, profesional_id, nombre_contacto, inicio, fin)
  VALUES ('$CID','$SID','$PID','Cliente (llega tarde)','2026-11-05 10:00-03','2026-11-05 10:30-03');
COMMIT;
SELECT clock_timestamp() AS termino;
SQL
su postgres -c "psql -d agenda_test_fix -f $WORKDIR/bloqueo_primero.sql" > "$WORKDIR/out_bloqueo.txt" 2>&1 &
PB=$!
su postgres -c "psql -d agenda_test_fix -f $WORKDIR/cita_despues.sql" > "$WORKDIR/out_cita.txt" 2>&1 &
PC=$!
wait $PB $PC
echo "  (cita, la que llegó después, esperó el lock y luego:)"
afirmar_espero_lock "$WORKDIR/out_cita.txt"
CITAS_FIN=$(fila agenda_test_fix "select count(*) from ed_citas;")
if grep -q "Ese horario está bloqueado" "$WORKDIR/out_cita.txt" && [ "$CITAS_FIN" = "0" ]; then
  echo "✓ CONFIRMADO: con la migración 308, la cita concurrente fue rechazada (ED001) y no quedó ninguna fila corrupta."
else
  echo "✗ FALLÓ: la cita no fue rechazada como se esperaba." >&2
  cat "$WORKDIR/out_cita.txt" >&2
  exit 1
fi

echo
echo "── Escenario 3/3: CON la migración 308 — cita primero, bloqueo después (garantía inversa) ──"
su postgres -c "psql -d agenda_test_fix -v ON_ERROR_STOP=1 -c 'delete from ed_citas; delete from ed_bloqueos;'" >/dev/null
cat > "$WORKDIR/cita_primero.sql" <<SQL
BEGIN;
INSERT INTO ed_citas (cliente_id, servicio_id, profesional_id, nombre_contacto, inicio, fin)
  VALUES ('$CID','$SID','$PID','Cliente A','2026-10-01 10:00-03','2026-10-01 10:30-03');
SELECT pg_sleep(2);
COMMIT;
SQL
cat > "$WORKDIR/bloqueo_despues.sql" <<SQL
\timing on
SELECT pg_sleep(0.4);
BEGIN;
INSERT INTO ed_bloqueos (cliente_id, profesional_id, desde, hasta, motivo)
  VALUES ('$CID','$PID','2026-10-01 09:00-03','2026-10-01 12:00-03','Bloqueo tardío');
COMMIT;
SQL
su postgres -c "psql -d agenda_test_fix -f $WORKDIR/cita_primero.sql" > "$WORKDIR/out_cita2.txt" 2>&1 &
PD=$!
su postgres -c "psql -d agenda_test_fix -f $WORKDIR/bloqueo_despues.sql" > "$WORKDIR/out_bloqueo2.txt" 2>&1 &
PE=$!
wait $PD $PE
echo "  (bloqueo, el que llegó después, esperó el lock y luego:)"
afirmar_espero_lock "$WORKDIR/out_bloqueo2.txt"
BLOQUEOS_FIN=$(fila agenda_test_fix "select count(*) from ed_bloqueos;")
if grep -q "Ese rango ya tiene una cita activa" "$WORKDIR/out_bloqueo2.txt" && [ "$BLOQUEOS_FIN" = "0" ]; then
  echo "✓ CONFIRMADO: el bloqueo concurrente sobre una cita activa fue rechazado (garantía inversa)."
else
  echo "✗ FALLÓ: el bloqueo no fue rechazado como se esperaba." >&2
  cat "$WORKDIR/out_bloqueo2.txt" >&2
  exit 1
fi

echo
echo "Limpieza…"
su postgres -c "psql -v ON_ERROR_STOP=1 -c 'drop database if exists agenda_test_sinfix;' -c 'drop database if exists agenda_test_fix;'" >/dev/null
echo "OK — los tres escenarios se comportaron como se esperaba."
