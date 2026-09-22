# Verificación OAuth de Google — expediente del scope `adwords`

Proyecto de Cloud: **respondo-ads** (nº 436753905542) · Cliente OAuth: **Respondo Portal**
App: **Respondo** · Estado al 22-sep-2026: marca **verificada**; acceso a datos
(scope `adwords`) **sin enviar**; nivel de la Google Ads API: **Test** (la
solicitud de Explorer se resetea sola, ver `docs/GOOGLE_ADS_EXPLORER_SUPPORT_PACKET.md`).

Este archivo existe para que el texto que se le manda a Google quede versionado.
Si Google pide cambios, se edita acá y se vuelve a pegar — no se reescribe de
memoria en el formulario.

> ⚠️ **Corrección del 22-sep-2026.** Las versiones anteriores de este texto
> decían «Respondo only reads» y «no write call exists in our codebase». Dejó de
> ser cierto cuando entró el publicador de campañas de Búsqueda
> (`lib/ads/googlePublicar.ts`). Declararle a Google un uso distinto del real es
> motivo de rechazo o de revocación. La frase correcta es: **Respondo reads
> advertising performance and, with customer authorization, can create and
> manage Google Search campaigns.** Tampoco se dice que la publicación en
> cuentas reales ya funciona: con nivel Test sólo opera en cuentas de prueba.

---

## 1. Justificación del permiso `https://www.googleapis.com/auth/adwords`

> ⚠️ En INGLÉS a propósito. El equipo de revisión de OAuth de Google trabaja en
> inglés. La política de privacidad sí queda en español, que es el idioma de
> nuestros usuarios, y eso Google lo acepta.

```
Respondo is a SaaS used by small and medium businesses in Chile. Its Marketing
section shows a business how its advertising performs next to the conversations
and sales Respondo already records, and helps it prepare Google Search
campaigns.

Respondo reads advertising performance and, with the customer's authorization,
can create and manage Google Search campaigns in the Google Ads account that the
business itself connects.

Read: from the account the business explicitly authorizes we read the name,
status and type of its campaigns, budgets, ad groups, ads, keywords and search
terms, with their aggregated metrics for the selected period (impressions,
clicks, cost, conversions), plus the account's currency and time zone.

Write: only when a person in that business reviews a campaign draft and presses
"Publish", Respondo creates ONE Search campaign in a single atomic request:
campaign budget, campaign, location and language targeting, ad group, keywords
and one responsive search ad. Everything is created PAUSED; the business decides
in Google Ads whether to enable it and spend. Afterwards Respondo can read the
structure of those campaigns and pause them. Respondo never enables campaigns in
production accounts, never modifies campaigns it did not create, and does not
touch bids of existing campaigns, billing, payments or account users.

We do not access personal data of the end users who saw or clicked the ads.

This scope is the minimum possible: Google offers a single scope for the Google
Ads API and no narrower variant exists. We ask for no other Google scope for
this feature.
```

## 2. Información adicional (campo de 1.000 caracteres)

```
Respondo already passed Google's OAuth verification for a separate Cloud project
that uses Google Calendar. This project covers only Google Ads.

Where to see the scope in use, after connecting a Google Ads account:
- /marketing/integraciones: connect button and live read test
- /marketing/campanas: campaigns with metrics; "Publish" on a draft creates a
  PAUSED Search campaign and shows the IDs returned by Google
- /marketing/busqueda: keywords and search terms

Privacy policy section 5.2 (respon-do.com/privacidad) describes this integration:
what we read, what we create and when, that everything is created paused, and
that aggregated figures are sent to the Gemini API (paid tier) only when the user
asks the marketing copilot.

Test credentials for the portal: <PEGAR AQUÍ CORREO Y CLAVE DE UNA CUENTA DE
PRUEBA>
```

⚠️ Las credenciales las pones tú. Usa el usuario del tenant QA, no el tuyo ni
el de un cliente.

---

## 3. Guion del video de demostración

Requisitos de Google: subido a YouTube (puede ser **no listado**), sin cortes
que escondan pasos, y tiene que mostrarse la pantalla de consentimiento con el
nombre de la app y el permiso concreto.

1. Barra de direcciones visible con la URL del portal.
2. Iniciar sesión como un negocio.
3. Marketing → **Integraciones**. Se ve la tarjeta de Google Ads sin conectar.
4. Clic en **Conectar Google Ads**.
5. **Pantalla de consentimiento de Google**, sin cortar: tiene que leerse
   «Respondo» y el permiso «Ver, editar, crear y borrar tus cuentas y datos de
   Google Ads».
6. Autorizar. Elegir la cuenta.
7. Vuelta al portal: la tarjeta queda conectada con la prueba de lectura al lado.
8. `/marketing/campanas` con las campañas de la cuenta.
9. Abrir un borrador de campaña de Búsqueda → **Publicar** → se ve la
   confirmación «Estado inicial: PAUSADA» y los IDs que devolvió Google.
10. Mostrar esa campaña en Google Ads, **en pausa**.
11. Cerrar diciendo lo que Respondo no hace: no activa campañas en cuentas
    reales, no toca campañas que no creó, ni pujas ni facturación.

⚠️ **Dependencia**: con nivel **Test** los pasos 6 a 10 sólo se pueden grabar
contra una **cuenta de prueba** de Google Ads. Para una cuenta real hace falta
Explorer.
