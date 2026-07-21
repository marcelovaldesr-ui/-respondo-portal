# Registrar resultados desde el motor (n8n)

## El problema

El portal muestra en la pantalla de Inicio lo que **logró** cada empleado:
cotizaciones enviadas, agendamientos, ventas recuperadas, reseñas conseguidas.
Esos números salen de la tabla `ed_resultados`.

Hoy esa tabla la llena el seed de demostración. **Si conectas un cliente real
sin este paso, las tarjetas de Beto y Vera mostrarán 0 para siempre** — y son
justo los números que justifican lo que cobras por ellos.

## La solución

Agregar un nodo **Code** en el flujo de n8n, **después** de que el LLM responde
y antes (o en paralelo) de enviar el mensaje por WhatsApp. Lee el JSON que
devuelve el asistente y registra el resultado que corresponda.

## Nodo Code para n8n

```javascript
// === Registrar resultado en ed_resultados ===
// Entrada esperada: el JSON del asistente (respuesta, escalar, trigger, lead, accion)
// más empleado_id, chat_id y el rol del empleado.

const SUPABASE_URL = '{{SUPABASE_URL}}';
const SERVICE_KEY  = '{{SUPABASE_SERVICE_ROLE_KEY}}';

const d          = $json.salida ?? $json;          // JSON del LLM
const empleadoId = $json.empleado_id;
const chatId     = $json.chat_id;
const rol        = $json.rol_empleado;             // 'tino' | 'rita' | 'vera'
const lead       = d.lead ?? {};
const datos      = lead.datos ?? {};

const resultados = [];
const add = (tipo, valor_clp = null) => resultados.push({
  empleado_id: empleadoId,
  chat_id: chatId,
  tipo,
  valor_clp,
  detectado_por: 'bot',
});

// --- Común a todos los roles ---
if (d.accion === 'agendar')  add('agendamiento', datos.monto ?? null);
if (d.accion === 'cotizar')  add('cotizacion_enviada', datos.monto ?? null);

// Lead capturado: solo si de verdad hay interés y un dato útil.
// Sin esta condición se infla la métrica con cualquier "hola".
if (['caliente', 'tibio'].includes(lead.clasificacion) && (lead.nombre || lead.necesidad)) {
  add('lead_capturado');
}

// --- Beto (rol interno 'rita'): seguimiento y reactivación ---
if (rol === 'rita') {
  // El cliente respondió a un seguimiento => la cotización se retomó.
  add('cotizacion_retomada', datos.monto ?? null);

  if (d.accion === 'agendar' || lead.clasificacion === 'caliente') {
    add('cliente_reactivado');
    // Solo cuenta como venta recuperada si hay monto real; si no, queda sin
    // valor y el portal muestra "—" en vez de inventar una cifra.
    if (datos.monto) add('venta_recuperada', datos.monto);
  }
}

// --- Vera: postventa ---
if (rol === 'vera') {
  const nps = datos.nps ?? null;
  if (nps !== null) add('encuesta_respondida');
  if (nps !== null && nps >= 4) add('resena_conseguida');   // ajustar si la escala es 1-10
  if (d.escalar && d.trigger === 'sentimiento_negativo') add('cliente_molesto');
}

if (resultados.length === 0) return [{ json: { registrados: 0 } }];

const r = await this.helpers.httpRequest({
  method: 'POST',
  url: `${SUPABASE_URL}/rest/v1/ed_resultados`,
  headers: {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  },
  body: resultados,
  json: true,
});

return [{ json: { registrados: resultados.length, tipos: resultados.map(x => x.tipo) } }];
```

## Ajustes que tienes que revisar

**La escala del NPS.** El prompt de Vera pide nota de 1 a 5, pero en los chats
de ejemplo la gente responde de 1 a 10. Define una sola escala y ajusta el
umbral de `resena_conseguida` — si Vera pide "del 1 al 10" y el código cuenta
reseña desde 4, vas a inflar la métrica.

**`resena_conseguida` es optimista.** Que el cliente diga "ya la dejé" no
comprueba que exista la reseña. Si quieres el dato duro, hay que contrastarlo
con el perfil de Google del negocio. Mientras tanto, entiéndelo como "reseña
solicitada y aceptada", y dilo así si un cliente pregunta.

**`venta_recuperada` necesita monto.** El asistente tiene que capturar
`datos.monto` para que la cifra en pesos aparezca. Si no lo captura, el portal
muestra "—" en vez de un número inventado — que es el comportamiento correcto.

## Contactos

El mismo flujo debería escribir en `ed_contactos` cuando captura un nombre, o la
lista de conversaciones mostrará puros números de teléfono:

```javascript
if (lead.nombre) {
  await this.helpers.httpRequest({
    method: 'POST',
    url: `${SUPABASE_URL}/rest/v1/ed_contactos`,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: {
      cliente_id: $json.cliente_id,
      chat_id: chatId,
      nombre: lead.nombre,
      telefono: `+${chatId}`,
      etiqueta: 'lead',
    },
    json: true,
  });
}
```

`ed_contactos` tiene índice único por `(cliente_id, chat_id)`, así que
`merge-duplicates` actualiza el contacto en vez de duplicarlo.

## Cómo verificar

1. Correr una conversación de prueba completa en un cliente de prueba.
2. Consultar `select tipo, count(*) from ed_resultados group by tipo;`
3. Abrir el portal y confirmar que los números de las tarjetas cuadran con esa
   consulta.
