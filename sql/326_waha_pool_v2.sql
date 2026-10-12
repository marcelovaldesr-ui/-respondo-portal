-- 326 · Endurecimiento del pool WAHA de Kambak (v2)
-- Idempotente. NO se aplica solo: la aplica un humano en Supabase.
-- Incorpora:
--  - ed_waha_lids: cache para resolución de WhatsApp LIDs a teléfonos reales (P1)
--  - ed_waha_pool_estado: estado global del pool y último resumen diario (P2, P9)
--  - Columnas en ed_waha_numeros para salud y pausas transitorias (P2)
--  - Columnas en ed_envios_api para reintentos y justicia de cola (P3, P4)
--  - Funciones atómicas de reserva y devolución de cupos (P5)
--  - Soporte de waha_opt_in en canal_marketing (P11)

-- (Poblado en las fases siguientes)

-- Rollback:
-- (Documentado al pie en cada fase)
