Trabajo largo y autónomo (varias horas). Nadie responderá preguntas: decide con el criterio conservador del plan y anótalo.

CONTEXTO: Ya hiciste las fases 1–5 del pool WAHA para las campañas de Kambak (rama feat/kambak-waha-pool, HEAD c7ecfaa). Revisé tu código y encontré defectos y huecos de integración con la web de Kambak. Todo el detalle está en:

  docs/PLAN_KAMBAK_WAHA_POOL_V2_NOCHE.md

LÉELO COMPLETO ANTES DE EMPEZAR, además de docs/PLAN_KAMBAK_WAHA_POOL_OCT2026.md (reglas de oro siguen vigentes) y KAMBAK.md.

QUÉ HACER
1. Portal (repo respondo-portal): crea la rama feat/kambak-waha-pool-v2 desde feat/kambak-waha-pool y ejecuta las fases P0→P13 en orden (M primero, luego S, luego C). Un commit por fase, push tras cada commit, tests nuevos por fase, `npm test` y `npm run lint` verdes (los 5 fallos de whatsapp-booking-actions.test.mjs son preexistentes).
2. Kambak (repo fideliza98-lab/sello-fidelizacion): ejecuta la Pista B (K0→K9) siguiendo SU CLAUDE.md al pie de la letra: leer README/GUIA/CONTEXTO/TAREAS/CAMBIOS, reservar archivos en TAREAS.md (único commit permitido a main), rama claude/pool-waha-avisos, commits pequeños en español, pull --rebase antes de push, pruebas en test/ con emulador de Firestore, anotar en CAMBIOS.md, y abrir Pull Request SIN mergear.
3. Mantén docs/PROGRESO_NOCHE_POOL.md actualizado al cerrar cada fase (hecho / archivos / tests / decisiones / pendientes) y entrega al final docs/INFORME_NOCHE_POOL_V2.md con las 7 secciones del §4 del plan.

REGLAS NO NEGOCIABLES
- Meta no cambia: con canal_marketing='meta' el comportamiento es idéntico al actual (tests de regresión).
- Archivos protegidos intactos: lib/waha.ts, lib/inboundWaha.ts, app/api/whatsapp/webhook-waha/route.ts, lib/whatsapp.ts, lib/inboundMeta.ts, lib/plantillas.ts, lib/plantillasKambak.ts y migraciones 322–325. Todo cambio de esquema va en sql/326_waha_pool_v2.sql nueva, idempotente, con rollback, SIN aplicar.
- No toques producción: sin SQL real, sin llamar a WAHA real, sin claves, sin .env, sin scripts que modifiquen datos reales; en Kambak solo emulador.
- Nada visible para los locales sobre WAHA, canal o números del pool (UI, HTML público, políticas, respuestas de API hacia la web).
- Ante la duda entre enviar o no enviar: no enviar. Nunca registres BAJA ni respondas sobre un teléfono no verificado (LID).
- No inventes nombres de campos/endpoints de WAHA: verifícalos en su documentación oficial o impleméntalos tolerantes con fixtures de test, y lista cada supuesto para validar con WAHA real.
- Si una fase se traba más de 45 min: documenta el bloqueo, deja lo estable y sigue. Nunca dejes tests rojos por tu causa en un commit.
- Textos para el usuario en español simple, breves, tono profesional.

Empieza por P0 y K0 (lectura), y no pares hasta completar todas las fases M y S; las C solo si sobra tiempo.
