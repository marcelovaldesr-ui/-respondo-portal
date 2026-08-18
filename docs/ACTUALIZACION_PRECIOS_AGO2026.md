# Actualización de precios — Impresora Color (18-ago-2026)

**Fuente:** `catalogo final.xlsx`, hoja "Catálogo Tienda Online", enviado por el dueño.
**Aplicado en:** ficha `[precios] Precios fijos — productos de tienda (con IVA)`
de `ed_conocimiento` (id `88a906a5-3e73-4946-8728-63fee87110e4`), que es la que
lee `armarPrompt()` y de donde Tino saca los precios que puede dar directo.

Se tomaron las **36 filas marcadas "Sí"** en la columna "¿INCLUIR EN TIENDA?",
usando la columna G (PRECIO FINAL con IVA). No había filas marcadas "No" ni
filas ocultas.

## Qué cambió

**Solo FLYERS / VOLANTES.** Tarjetas, Stickers, Pendones Roller, Tela PVC y
Credencial PVC quedaron **exactamente iguales** — se verificó línea a línea
(23 líneas de precio antes, 23 después, 4 líneas modificadas).

| Variante | Cantidad | Antes | Ahora | Diferencia |
|---|---:|---:|---:|---:|
| A6 · 1 cara | 100 | $13.000 | **$15.000** | +$2.000 (+15%) |
| A6 · 1 cara | 200 | $17.500 | **$22.000** | +$4.500 (+26%) |
| A6 · 1 cara | 500 | $35.000 | **$42.000** | +$7.000 (+20%) |
| A6 · 2 caras | 100 | $18.500 | **$22.000** | +$3.500 (+19%) |
| A6 · 2 caras | 200 | $28.000 | **$32.000** | +$4.000 (+14%) |
| A6 · 2 caras | 500 | $52.000 | **$58.000** | +$6.000 (+12%) |
| A5 · 1 cara | 100 | $14.000 | **$22.000** | +$8.000 (+57%) |
| A5 · 1 cara | 200 | $26.000 | **$32.000** | +$6.000 (+23%) |
| A5 · 1 cara | 500 | $58.000 | **$68.000** | +$10.000 (+17%) |
| A5 · 2 caras | 100 | $22.000 | **$28.000** | +$6.000 (+27%) |
| A5 · 2 caras | 200 | $35.000 | $35.000 | sin cambio |
| A5 · 2 caras | 500 | $75.000 | $75.000 | sin cambio |

## Reglas que NO se tocaron

- Rango de precio fijo: 100 a 500 unidades. Bajo 100 o sobre 500 → cotizar con Cecilia.
- Credencial PVC: precio fijo por 5 unidades; sobre 5, cotizar.
- Stickers: la forma (circular/rectangular/cuadrada) no cambia el precio.
- Todo lo que no está en la lista → Tino no inventa precio, toma datos y deriva a Cecilia.

## Verificación

`scripts/_test_precios_nuevos.ts` corre el cerebro real (armarPrompt + Gemini)
y comprueba 13 casos: los 8 precios de flyers que cambiaron (que aparezca el
nuevo y **no** el viejo), 3 precios que no cambiaron, y 2 casos fuera de rango
(50 u y 2000 u) donde Tino no debe dar precio. **13/13 en verde.**

## Ojo comercial

El alza de flyers es considerable, sobre todo A5 1 cara en 100 unidades (+57%).
Ya hubo el 31-jul una escalación por `sentimiento_negativo` de un cliente que
reaccionó con sorpresa al precio de volantes A6 **con la tarifa antigua**
($17.500 por 200 u, que ahora pasa a $22.000). Vale la pena que Cecilia esté
sobre aviso de posibles reacciones parecidas.
