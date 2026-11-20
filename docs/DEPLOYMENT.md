# Production and deployment plan

Redeploy after a change: `npm run verify`, then `npx wrangler pages deploy dist --project-name gourwest --branch main`.

Target: **Cloudflare Pages** (static site + Pages Functions), source on **GitHub**, CI in **GitHub Actions**,
Luminara CRM reachable from Cloudflare over HTTPS (for example through the CRM's Cloudflare Tunnel,
`Luminara-CRM/docs/deployment-cloudflare-github.md`).

## 1. One-time setup

### Cloudflare
1. Create a Pages project (Workers & Pages → Create → Pages → *Direct Upload*), e.g. `gourwest`.
   CI deploys with Wrangler, so no Git integration is needed on the Cloudflare side.
2. Set the runtime settings as **encrypted variables** (`wrangler.toml` is the project's config source, so plain
   dashboard variables would be ignored), for Production and Preview:

   | Name | Required | Value |
   | --- | --- | --- |
   | `CRM_BASE_URL` | yes | Public HTTPS origin of Luminara CRM, e.g. `https://crm.example.com` |
   | `GOURWEST_WEBHOOK_SECRET` | yes | Same value as `GOURWEST_WEBHOOK_SECRET` in the CRM `.env` |
   | `CRM_WEB_FORM_ID` | yes, for enquiries | Numeric Krayin web form id (see the CRM steps below) |
   | `GROQ_API_KEY` | optional | AI concierge (Groq, `openai/gpt-oss-120b`); without any key the house recommender answers |
   | `NVIDIA_API_KEY` | optional | Fallback AI concierge (NVIDIA NIM) when Groq fails |

   `npx wrangler pages secret put CRM_BASE_URL --project-name gourwest` (repeat per name).
3. Create the order replay store: `npx wrangler kv namespace create gourwest-orders`, and put the returned id in
   `wrangler.toml` (binding `ORDERS_KV`). It replays the first result for a repeated checkout (the CRM also rejects repeats since 2026-11-18), and `/api/orders` answers 503 without it.
4. Bot check: create a Turnstile widget for your domain, put its site key in `.env.production` as
   `PUBLIC_TURNSTILE_SITE_KEY` (public, safe to commit) and its secret as the encrypted variable `TURNSTILE_SECRET_KEY`.
   Without them the widget uses Cloudflare's always-pass test key and the server skips the check.
5. Recommended: a WAF rate-limiting rule on `/api/*` (e.g. 30 requests per minute per IP) to protect the CRM's
   120/min limit and the concierge's API spend.
6. Attach the custom domain and set the GitHub variable `SITE_URL` to it (used for canonical URLs, Open Graph, the sitemap
   and `llms.txt`).
7. Optional: turn on Web Analytics for the Pages project (Workers & Pages → `gourwest` → Metrics → Web Analytics).
   Pages injects the cookieless beacon itself; `public/_headers` already allows `static.cloudflareinsights.com` (script)
   and `cloudflareinsights.com` (beacon POST).

### Luminara CRM
1. Set `GOURWEST_WEBHOOK_SECRET` explicitly (never leave it empty: the CRM would fall back to `APP_KEY`). Rebuild/restart.
2. Create the enquiry lead form: Settings → Web Forms → new form with **Create lead** on, add the person
   *name*, *emails*, *contact numbers* and lead *title* and *description* attributes, and note its numeric id
   (`CRM_WEB_FORM_ID`). Without it the site refuses enquiries (503) instead of dropping them.
3. Make the CRM reachable at `CRM_BASE_URL` over HTTPS. Only `/api/gourwest/webhooks/*` and, if used,
   `/web-forms/forms/*` need to be reachable by the site.
4. Seed demo data for demonstrations: `php artisan luminara:seed-gourwest --force`.

### GitHub
1. Push this folder to a new repository (default branch `main`).
2. Repository → Settings → Secrets and variables → Actions:
   - Secrets: `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers", scoped to the account), `CLOUDFLARE_ACCOUNT_ID`.
   - Variables: `CLOUDFLARE_PAGES_PROJECT` (e.g. `gourwest`), `SITE_URL` (e.g. `https://order.gourwest.example`).
3. Create an Environment named `production` (optionally with required reviewers) — the deploy job uses it.

## 2. Pipeline

`.github/workflows/ci.yml`:
- Every pull request and push: `npm ci` → `npm run verify` (Astro + functions type-check, Vitest, production build with CSP hashing).
- Push to `main`: the verified `dist/` is deployed with `wrangler pages deploy`. The deploy job is skipped until
  `CLOUDFLARE_PAGES_PROJECT` is set, so forks and fresh repos stay green.
- Dependabot opens weekly npm and monthly Actions updates.

## 3. Go-live checklist

- [ ] `GET /api/health` on the production URL returns `"crm": true`, `"leadForm": true` and `"idempotency": true`.
- [ ] Place a real test order with a seeded member; the confirmation shows a CRM event id and the member's points move in `/admin/gourwest`.
- [ ] Send a request with a wrong secret (or rotate it temporarily) and confirm the site shows "The kitchen system declined the request" and the CRM security audit log records a 401.
- [ ] Submit the catering and contact forms; confirm a person + lead and a sync event for each in the CRM.
- [ ] Concierge: with a key set, `source` is `ai`; with both removed, `house` — both return dish cards.
- [ ] Response headers include the CSP, HSTS, `X-Frame-Options: DENY` and `nosniff` (`curl -I https://…/menu/`).
- [ ] Lighthouse on `/` and `/menu/` (mobile): no accessibility errors; LCP under 2.5 s.
- [ ] Footer still carries "Demo simulator — synthetic data".

## 4. Operations

- **Rollback:** Cloudflare dashboard → the project → Deployments → pick the previous deployment → *Rollback*.
- **Logs:** `npx wrangler pages deployment tail --project-name gourwest` streams function logs. Errors are logged
  with the CRM status code only — no secrets, bodies or personal data.
- **CRM outages:** orders keep flowing and park in KV (`outbox:<ref>` keys; list them with
  `npx wrangler kv key list --binding ORDERS_KV --prefix outbox: --remote`). They resend on API traffic once the CRM
  is back. Point any free uptime monitor at `GET /api/health` every 5 minutes so the outbox drains even with no
  new orders. Parked events expire after 14 days; resend failures are logged as "Outbox resend stopped".
- **Secret rotation:** set the new value in the CRM and in Cloudflare within the same few minutes; orders sent in
  between get a 401 → the guest sees a clear failure and nothing is double-counted.
- **Changing the menu:** edit `src/data/menu.ts` (prices in cents) and add photos to `public/images/food/` as
  `<name>-640.webp` and `<name>-1200.webp`. Tests check every default option prices correctly.

## 5. Known limits and follow-ups

| Limit | Why it matters | Mitigation in place / next step |
| --- | --- | --- |
| CRM webhook signatures carry no timestamp | A captured request could be replayed | The CRM keeps one event per `external_ref` (DEF-01), so a replay changes nothing; the site also keeps one checkout id per attempt and a KV replay copy. Next step CRM-side: timestamped signatures. |
| The CRM is unreachable | Orders cannot be confirmed live | Orders are still taken and resent through the KV outbox; members see their points once it drains. |
| Order size | Points can be minted with large fake orders against published demo members | Server re-prices every order and caps it at A$600; add the WAF rule and Turnstile for a public launch. |
| No loyalty sign-up or balance API in the CRM | Guests can't join or see points online | Rewards page explains in-store joining; demo members documented. |
| Rate limiting | Scripted abuse of `/api/*` (points minting, concierge cost) | Turnstile on checkout and enquiries, same-origin check, honeypot, order cap. Add a zone WAF rate-limiting rule on `/api/*` for your host before a public launch. |
| Synthetic kitchens in structured data | `/locations/` shows the demo kitchens at real street addresses under a fictional brand | The whole site is `X-Robots-Tag: noindex`, and Restaurant JSON-LD, the kitchens FAQ and `/llms.txt` give cities only. Footer and `/llms.txt` say the brand and data are synthetic. Before marketing Gourwest as a real brand, replace `src/data/stores.ts` with real kitchens (and add phone numbers), then drop those notices. |
| Concierge cost | Each Groq / NIM call uses the account's quota | Messages capped (10 turns × 600 chars), reasoning effort `low`, 8 s / 9 s timeouts; add the WAF rate limit. |
