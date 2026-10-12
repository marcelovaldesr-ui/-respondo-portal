# Marketing API Access Tier — registro
Requisito de Meta (desde el 4-may-2026): **500+ llamadas a la Marketing API en los últimos 15 días** y **tasa de error < 15 % en las últimas 500 llamadas**, más verificación de empresa, App Review y preguntas de manejo de datos.
Reglas: **nada de llamadas artificiales, spam ni gaming.** Solo uso normal del producto, QA legítimo y sincronizaciones reales.
Dónde leer el contador: developers.facebook.com → Respondo Ads → Casos de uso → "Crea y administra anuncios" → Personalizar → fila **Marketing API Access Tier** → "Requisitos".

| Fecha | Llamadas (panel) | Tasa de error | Ventana | Elegible full access | Nota |
|---|---|---|---|---|---|
| 22-sep-2026 | **226 / 500** | No visible en el panel | 15 días móviles | **NO** | Hoy hubo ~8 llamadas con error durante el diagnóstico (validate_only rechazados por permisos, un intento de asignación rechazado, un campo inexistente). Cuentan para la tasa de error: no repetirlas. |
| 06-oct-2026 | **162 / 500** (ads_management 161, ads_read 278, business_management 40) | No visible en el panel | 15 dias moviles | **NO** | Estado: Acceso limitado. En Requisitos: verificacion de empresa en verde; revision de la app y preguntas de datos en gris; el punto del requisito de 500 llamadas se ve verde pero con 162 no se cumple (lectura ambigua). Sin llamadas artificiales. |
