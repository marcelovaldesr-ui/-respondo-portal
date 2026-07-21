# Decisión de producto: cómo conecta Respondo el WhatsApp

Comparación a fondo de las dos rutas para que Tino (y luego Beto/Vera) respondan
en el WhatsApp de un cliente, con el cliente tomando control cuando quiera.

**Aclaración de base (importante):** en las DOS rutas el humano puede tomar
control de la conversación — es la promesa central de Respondo y se cumple en
ambas. La diferencia es **desde dónde** contesta el humano y **quién construye
esa bandeja**.

---

## Las tres rutas reales (no dos)

### A. No oficial — Evolution API / QR
El bot se engancha al WhatsApp que el cliente YA usa, como dispositivo vinculado.
El teléfono del cliente ES la bandeja: toma control contestando desde su app
normal.

### B. Oficial propia — WhatsApp Cloud API + inbox construido por nosotros
El número se registra en la API de Meta (deja de estar en la app del teléfono).
El cliente toma control desde un **inbox que Respondo construye** dentro del
portal (la pantalla de Conversaciones + un cuadro para escribir).

### C. Oficial vía BSP — API oficial + inbox de un tercero
Igual que B, pero el inbox y la conexión los pone un proveedor (respond.io,
360dialog, Wati, Zoko). Respondo configura y le suma su IA encima.

---

## Comparación por criterio

| Criterio | A · No oficial | B · Oficial propia | C · Oficial vía BSP |
|---|---|---|---|
| **Costo mensual** | ~US$6 de VPS para varios clientes; sin costo por mensaje | VPS + costo por conversación/mensaje de Meta (sube en oct-2026, verificar) | Plan del BSP por cliente (US$20–100+/mes) + costo Meta |
| **Velocidad a estar vivo** | Horas, mismo día | Semanas (verificación Meta + plantillas + construir inbox) | Días (alta en el BSP) |
| **¿Toma control el humano?** | Sí, desde su teléfono | Sí, desde el inbox nuestro | Sí, desde el inbox del BSP |
| **¿Hay que construir inbox?** | No (el teléfono lo es) | **Sí** (trabajo real: escribir, tiempo real, ventana 24h, plantillas) | No (lo pone el BSP) |
| **Riesgo técnico** | Alto: bloqueo permanente del número, se rompe si WhatsApp cambia | Bajo | Bajo |
| **Contra términos de WhatsApp** | Sí | No | No |
| **Control / dependencia** | Control total, sin terceros | Control total, sin terceros | Dependes del BSP y su precio |
| **Facilidad para vender** | Difícil venderlo como "seguro/oficial" | Alta: profesional, oficial | Alta, pero el cliente ve la marca del BSP a veces |
| **Escala a muchos clientes** | Cada uno = un QR que hay que mantener conectado; un update rompe todo junto | Limpia: cada cliente conecta su número por OAuth | Limpia, pero el costo por cliente crece |
| **Mantenimiento (2 personas)** | Frágil: bloqueos impredecibles, caídas por updates | Estable día a día, pero mantener el inbox es trabajo continuo | El más liviano de mantener; pagas por eso |
| **Quién asume si cae el número** | Nosotros/el cliente (su línea de ventas) | No aplica | No aplica |

> Nota de costos: Meta anunció un cambio de precios de WhatsApp para **oct-2026**
> que encarece los mensajes de servicio. **Verificar en la fuente oficial antes
> de fijar precios anuales.** No inventar cifras.

---

## Lo que significa para Respondo (2 personas, buscando primeros clientes)

**El cuello de botella de la ruta oficial "propia" (B) es el inbox.** Construir
una bandeja de WhatsApp buena —escribir al cliente, ver mensajes en tiempo real,
manejar la ventana de 24 horas, mandar plantillas fuera de esa ventana, varios
agentes— es un producto en sí, de días a semanas. Para un equipo de 2 sin
clientes pagando todavía en el motor, es una apuesta grande y prematura.

**La ruta A es imbatible para aprender y para los primeros pilotos** (tu propio
negocio, o clientes que aceptan el riesgo en un número secundario). Rápida,
barata, cero construcción. Su precio es el riesgo de bloqueo, que en un cliente
que paga es un problema serio.

**La ruta C (BSP) es el atajo a "oficial + inbox" sin construir nada.** Pagas
por cliente, pero saltas todo el trabajo de la bandeja. Buena cuando tengas un
cliente que exige la vía segura y no quieras frenar la venta.

---

## Recomendación

**No comprometerse a construir el inbox todavía.** Ir por etapas:

1. **Ahora — Impresora Color y pilotos amistosos: Ruta A.** Es tu negocio, tu
   mamá contesta en su teléfono, riesgo asumido. Aprendes el producto de verdad
   con conversaciones reales, que es lo que falta. Cero construcción extra.

2. **Primer cliente que paga y exige seguridad: Ruta C (BSP).** Le das la vía
   oficial con inbox sin construir nada, cerrando la venta rápido. Evalúas 360dialog
   o respond.io cuando llegue el caso.

3. **Cuando tengas volumen y patrón repetible: Ruta B (inbox propio).** Recién
   ahí vale la pena construir el inbox en el portal —la pantalla de Conversaciones
   ya es la base—, porque tienes clientes que lo justifican y márgenes que lo
   pagan. Coincide con la "Etapa 4" que ya estaba en el plan.

Dicho corto: **A para aprender, C para vender rápido y seguro, B cuando escales.**
No saltar directo a construir el inbox.

## Primer paso concreto

Seguir con **Ruta A para Impresora Color**: contratar el VPS (Hostinger KVM 1,
4 GB, alcanza) y conseguir el número de prueba. El resto del plan está en
`NIVEL_B_CONECTAR_WHATSAPP.md`.
