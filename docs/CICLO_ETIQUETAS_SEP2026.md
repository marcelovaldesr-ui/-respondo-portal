# Que las etiquetas digan la verdad — 2-sep-2026

## El problema, en palabras de Marcelo

> No tiene sentido que diga "te espera" pero yo ya lo atendí, o que diga
> "cotización" pero se cerró la venta.

Tenía razón, y eran tres agujeros distintos:

| Lo que se veía | Por qué | Medido en Impresora Color |
|---|---|---|
| "Te esperan N" con conversaciones ya atendidas | La escalación solo se cerraba si la persona respondía **desde el portal**. Cecilia responde desde el WhatsApp del teléfono: ese camino pasaba el chat a modo humano pero dejaba la escalación abierta. | 236 abiertas; 190 ya atendidas |
| "Cotización" en conversaciones ganadas o perdidas | Las etiquetas automáticas solo se **sumaban** (`etiquetasDesdeMotor`). Nada las quitaba. | 60 contactos cerrados con etiquetas abiertas |
| Nada pasaba a "Ganado" aunque el cliente pagara | `venta_confirmada` existía en `ed_resultados` desde la migración 201 pero **nadie lo escribía**. El motor de chat no corre en modo humano, que es donde ocurre el cierre. | 0 ventas registradas |

## Las tres piezas

### 1. `lib/escalaciones.ts` — una sola puerta para cerrar derivaciones

`cerrarEscalacionesPendientes()` es el único lugar que marca `atendida_en`.
La llaman **todos** los caminos por los que una persona le escribe al cliente:
portal (texto, adjunto, plantilla), teléfono (eco `toma_humana` en
inboundMeta/inboundWaha/inboundInstagram) y el barrido del cron. Además retira
la etiqueta `necesita_atencion` del contacto.

### 2. `lib/reconciliarEstados.ts` — barrido determinista en el cron

Cada 5 minutos, sin modelo:

- Cierra las derivaciones abiertas donde una persona escribió después (con la
  fecha real en que escribió). Es lo que limpia el arrastre histórico.
- Limpia las etiquetas abiertas de contactos en ganado/perdido y avisa a
  Gestión por el puente.

Qué es "abierta" y qué es "hecho" está en `lib/etiquetasCiclo.ts` (puro, con
tests):

```
abiertas: posible_comprador · cotizacion · necesita_atencion · pago_pendiente
hechos:   cliente_nuevo · agendado · reclamo · cliente · resuelto
```

Ganado → se van las abiertas y aparece `cliente`. Perdido → se van las abiertas.

### 3. `lib/cierreVentas.ts` — la IA detecta el cierre en la conversación

En el cron, con techo de tiempo. Para cada conversación con actividad en los
últimos 3 días que no esté cerrada ni movida a mano:

1. ¿Hay una **pista** de cierre en lo nuevo? (`hayPistaDeCierre`: comprobante,
   transferí, abono, dale, aprobado…). Si no, se anota "revisado" y no gasta
   modelo. Y si nunca habló una persona ni hay intención detectada, tampoco:
   es la barrera contra las notificaciones del banco.
2. El modelo lee la conversación y propone `pagado`, `aprobado_sin_pago` o
   `abierto`, **con una cita literal** como evidencia.
3. La reja (`decidirCierre`) solo acepta si la cita existe en la conversación,
   tiene al menos dos palabras y no es el marcador de un adjunto sin nombre.

Resultado:

| Estado | Qué pasa |
|---|---|
| `pagado` | `ed_resultados` (`venta_confirmada`), contacto → **ganado**, etiquetas limpias + `cliente`, puente a Gestión, push. |
| `aprobado_sin_pago` | Etiqueta **"Falta pago"** (`pago_pendiente`). En Impresora Color es la tarea que se olvida: pedir el 50 %. Push la primera vez. |
| `abierto` | Nada. Se anota hasta qué mensaje se revisó. |

Todo queda en `ed_cierres_detectados` (migración 291), con la propuesta del
modelo y lo que decidió la reja.

## Prueba en seco antes de desplegar (12 conversaciones reales)

| Chat | Modelo | Reja | Correcto |
|---|---|---|---|
| Cliente mandó "Abono ok" (documento) | pagado | pagado | ✓ |
| "Comprobante de pago de Alvaro Matamala" | pagado | pagado | ✓ |
| "y el comprobante del primer pago" | pagado | pagado | ✓ |
| "AHORA CANCELO 1 QUEDARIAN 2" | pagado | pagado | ✓ (pago parcial de deuda) |
| "Correcto, solo que querré 4 cartas, todo el resto correcto" | aprobado_sin_pago | aprobado_sin_pago | ✓ |
| Cliente mandó una imagen sin descripción | pagado | **abierto** | ✓ la reja lo paró |
| Evidencia «15» | aprobado_sin_pago | **abierto** | ✓ la reja lo paró |
| Cecilia pidió el 50 % y el cliente no ha pagado | abierto | abierto | – (conservador; el próximo mensaje lo reabre) |

## Cómo saber si está funcionando

```sql
-- Qué decidió el detector esta semana
select estado, propuesta, count(*) from ed_cierres_detectados
 where creado_en > now() - interval '7 days' group by 1, 2 order by 3 desc;

-- Derivaciones abiertas de verdad (deberían ser pocas)
select count(*) from ed_escalaciones where atendida_en is null;

-- Contactos con "Falta pago" ahora mismo
select chat_id, nombre from ed_contactos where 'pago_pendiente' = any(etiquetas);
```

## Lo que NO hace, a propósito

- No pisa una etapa movida a mano (`etapa_manual`).
- No baja una etapa: si algo está en ganado, un mensaje nuevo no lo devuelve.
- No le escribe al cliente. Detectar "Falta pago" y que Tino pida el abono
  solo sería el paso siguiente (vigilante, categoría `medios_pago`), y se
  decide aparte.
