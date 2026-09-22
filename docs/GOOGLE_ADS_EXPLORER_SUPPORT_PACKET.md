# Google Ads API — Explorer access support packet

Prepared 22-Sep-2026 for escalation to Google Ads API support. **No secrets in
this file** (the OAuth client ID is public by design; the secret, refresh tokens
and access tokens are not included).

## 1. Summary (paste-ready, English)

Explorer access applications for our Google Cloud projects are silently reset.
Clicking "Apply for access" on the Google Ads API Overview page shows "Your
Explorer access level request is under review. Check back in a few minutes."
After reload the level is back to **Test** and "Apply for access" is available
again. No approval, rejection or email is ever received. It reproduces on a
brand-new project, so it does not look project-specific. This is **not** the
documented post-upgrade AUTHORIZATION_ERROR issue: our projects were never
upgraded. We need to know which eligibility check fails and on which resource.

## 2. Projects

| | Production project | Diagnostic project |
|---|---|---|
| Project ID | `respondo-ads` | `respondo-gads-explorer` |
| Display name | Respondo Ads | respondo-google-ads |
| Project number | 436753905542 | (see Cloud console) |
| Owner | hirespondo@gmail.com | hirespondo@gmail.com |
| Organization | none | none |
| Created | 15-Sep-2026 | 22-Sep-2026 |
| Google Ads API | enabled | enabled |
| Access level | **Test** | **Test** |
| API traffic | none in the last 30 days | none |
| OAuth client | "Respondo Portal" (web) `436753905542-ncaoh5peedne5rq6i1psrlrm8d113g4j.apps.googleusercontent.com` | none |

Other project on the same Google account: `respondo-agenda` (Google Calendar,
already verified). It does **not** have the Google Ads API enabled; it is kept
apart on purpose so its verification is not reopened.

## 3. OAuth configuration of `respondo-ads`

- Publishing status: **In production**, user type **External**.
- **Brand verification: verified** ("Branding status: verified and shown to users").
- Data access (sensitive scope `https://www.googleapis.com/auth/adwords`): not
  submitted yet.
- Redirect URIs: `https://respondo-portal.vercel.app/api/ads/google/callback`,
  `http://localhost:3000/api/ads/google/callback`.
- The production app sends this client ID (verified by opening
  `/api/ads/google/conectar` and reading the `client_id` in Google's redirect).
- User cap: 3 of 100 users granted.

## 4. Billing

- Billing account `013C97-303084-8898D4` ("Mi cuenta de facturación"), type
  Direct, status **Active**, paid account.
- It started as a Free Trial on 16-Sep-2026 and was upgraded the same day; a
  "FreeTrialUpgrade" credit is listed until 16-Dec-2026.
- Because the Developer token page lists "Free Trial / suspended billing" as a
  cause of Explorer rejection, we **unlinked billing from `respondo-ads` and
  re-applied**: same silent reset. Billing was re-linked afterwards.

## 5. Timeline (22-Sep-2026, approximate, UTC)

| Time (UTC) | Action | Result |
|---|---|---|
| ~18:30 | Apply for Explorer on `respondo-ads` (1st today) | "under review" → Test on reload |
| ~18:40 | Apply again, capturing network | same |
| ~19:40 | Billing unlinked from `respondo-ads`; apply again | same |
| ~19:50 | Billing re-linked | — |
| ~20:30 | New project `respondo-gads-explorer`; Google Ads API enabled; apply | same |

Earlier attempts on `respondo-ads` (16–19 Sep) behaved the same way (see §7).
Console load error request IDs seen on the overview page while doing this
(not API calls): 16053368451195371922, 5702830290759500538, 14137179923073308879.

## 6. Google Ads accounts

- Respondo's own advertiser account: **120-954-5727** (billing set up on 19-Sep-2026).
- Production customer we want to serve first: **137-965-2676** (Impresora Color,
  real spend, owned by a different Google account). Not used in any test.
- No manager account (not required since 9-Sep-2026 according to the
  documentation).

## 7. Previous support case

- Case **6-8057000041314** with general Google Ads Support (AI-generated
  replies), 16–19 Sep 2026. Support confirmed the application "is being
  instantly and silently reset by the system's automated compliance
  prerequisite checks", attributed it to account 120-954-5727 having no billing
  (fixed on 19-Sep, no change), and recommended creating an MCC and a developer
  token in the API Center — which contradicts the current documentation. The
  case was closed without escalation.

## 8. Test-account E2E (same credentials, Test access)

Status: see §9 of this file after the run. The official mechanism (test manager
→ test client) is used to validate the full stack — OAuth, account discovery,
read, create a PAUSED Search campaign, pause — with the production OAuth client
of `respondo-ads`, as Google documents that Test access works against test
accounts.

## 9. Test-account E2E results

_Pending — filled after the run._

## 10. Evidence routes (Cloud console)

- Access level: `console.cloud.google.com/google/ads-apis/overview?project=respondo-ads`
- OAuth client: `console.cloud.google.com/auth/clients/436753905542-ncaoh5peedne5rq6i1psrlrm8d113g4j.apps.googleusercontent.com?project=respondo-ads`
- Brand / verification: `console.cloud.google.com/auth/verification?project=respondo-ads`
- Billing credits: `console.cloud.google.com/billing/013C97-303084-8898D4/credits/all`
- Diagnostic project: `console.cloud.google.com/google/ads-apis/overview?project=respondo-gads-explorer`
