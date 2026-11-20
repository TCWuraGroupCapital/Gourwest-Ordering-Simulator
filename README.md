# Gourwest — ordering website

The customer-facing ordering site for **Gourwest** (a fictional fast-casual brand), wired into **Luminara CRM**.
Guests browse the menu, customise a bowl, check out for pickup with an optional Gourwest Club number, and the
order lands in the CRM as a signed `online_order.completed` event that updates the member's points and tier live.

> **Demo simulator — synthetic data.** No payments are taken. Menu, prices, kitchens and history are demo content.
> The CRM contract this site implements is `Luminara-CRM/docs/gourwest-ordering-simulator-spec.md`.

## Use this as a template

A complete, tested ordering site you can clone and rebrand: Astro 7 static pages, Cloudflare Pages Functions,
a menu-driven data model, a customiser, checkout, loyalty tiers, an AI menu concierge and a strict CSP.

```powershell
git clone https://github.com/TCWuraGroupCapital/Gourwest-Ordering-Simulator.git
cd Gourwest-Ordering-Simulator
npm ci
npm run dev        # http://localhost:4321
```

- **Rebrand:** `src/styles/tokens.css` (colour, type, spacing), `public/brand/`, and the design system in
  `design/warm_editorial_hospitality/DESIGN.md`.
- **Your menu and kitchens:** `src/data/menu.ts` (prices in cents) and `src/data/stores.ts`; photos go in
  `public/images/food/` as `<name>-640.webp` and `<name>-1200.webp`.
- **Your back office:** `functions/_lib/crm.ts` posts HMAC-signed JSON events to any HTTPS endpoint that implements
  the webhook contract below; swap it for your own POS or CRM.
- **Deploy:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (create your own KV namespace and Turnstile widget; set `SITE_URL`).

The UI works with no configuration. Checkout needs `ORDERS_KV` plus a CRM endpoint (`npm run preview` simulates KV locally).

## What's in it

| Area | Pages / endpoints |
| --- | --- |
| Ordering | `/` (3D kitchen globe), `/menu/`, `/menu/<dish>/` customiser, `/cart/` checkout, `/order/confirmed/` |
| Brand | `/our-story/`, `/locations/` (globe + hours), `/rewards/` (tiers + points calculator), `/catering/` |
| Help & legal | `/contact/`, `/allergens/` (matrix generated from the menu data), `/privacy/`, `/terms/`, 404 |
| AI | Menu concierge on every page — Groq (`openai/gpt-oss-120b`), then NVIDIA NIM, then a built-in, menu-grounded fallback; it sees the bag and the kitchen's local time to round out the meal, and its picks go into the bag with one "Add all" tap |
| Reorder | "Your usual" on the menu and empty bag: the last order's dishes (no name, member number or note) back in the bag in one tap, with Forget |
| Search & AI answers | One linked JSON-LD `@graph` per page (`src/lib/seo.ts`: WebSite, Organization, Restaurant, Menu/MenuItem, BreadcrumbList), visible answer-first FAQs with FAQPage markup (`Faq.astro`, generated from the menu, kitchen and Club data), `/llms.txt`. The whole site is `X-Robots-Tag: noindex` and Restaurant markup gives cities only, so the fictional kitchens never surface in search as real venues at real addresses |
| API (Cloudflare Pages Functions) | `POST /api/orders`, `POST /api/enquiries`, `POST /api/concierge`, `GET /api/health` |

## Architecture

```
Browser (static pages + small islands)
  │  bag + chosen kitchen in localStorage; prices computed with src/lib/pricing.ts
  ▼
Cloudflare Pages Functions  (functions/)
  ├─ /api/orders      re-prices the bag server-side → HMAC-signs → CRM online_ordering webhook
  ├─ /api/enquiries   signed sync event (no personal data) → optional Krayin web-form lead
  ├─ /api/concierge   Groq → NVIDIA NIM structured output, or the house recommender (src/lib/recommend.ts)
  └─ /api/health      which integrations are configured (never their values)
  ▼
Luminara CRM  POST {CRM_BASE_URL}/api/gourwest/webhooks/{online_ordering|customer_support}
              X-Gourwest-Signature: sha256=<HMAC-SHA256(raw body, GOURWEST_WEBHOOK_SECRET)>
```

- **One source of truth for the menu:** `src/data/menu.ts` drives the pages, the cart, the server-side price check,
  the allergen matrix, the concierge prompt and the structured data.
- **The browser never sees the CRM secret** and never calls the CRM. Client totals are ignored; the function re-prices.
- **No double-counted points:** the CRM keeps one event per order reference (since 2026-11-18), and the site adds its own layer: each checkout gets one id, the client
  never auto-retries, and the required `ORDERS_KV` store replays the first result instead of re-sending.
- **A CRM outage doesn't stop orders:** if the CRM is unreachable, slow, busy or answers with a 5xx, the order is
  still taken (202, receipt shows "Queued for Luminara CRM") and its event is parked in `ORDERS_KV` under `outbox:<ref>`.
  It is resent with the same reference on later API traffic (orders and `/api/health`, at most every 2 minutes) until
  the CRM confirms; the CRM's one-event-per-reference rule makes the resend safe.
- **Enquiries are never dropped:** they are stored as a CRM person + lead through a Krayin web form
  (`CRM_WEB_FORM_ID`); if that is missing or fails, the guest is told and the form keeps their text.
- **Security headers and a strict CSP** are in `public/_headers`; `scripts/csp.mjs` hashes inline scripts at build.

## Run it locally

Requires Node 22.23.4+ (CI uses Node 24).

```powershell
npm ci
copy .dev.vars.example .dev.vars   # then edit the values
npm run dev        # UI only, http://localhost:4321 (API routes are not served by astro dev)
npm run preview    # full site + functions in the Cloudflare runtime, http://localhost:8788
```

### Connect the local Luminara CRM

1. In `Luminara-CRM/.env` set `GOURWEST_WEBHOOK_SECRET` to a long random string (if it is empty the CRM signs with
   `APP_KEY`, which must never be shared), then restart the CRM container.
2. Put the **same** value in this project's `.dev.vars`, with `CRM_BASE_URL` pointing at the CRM
   (the Docker app on this machine listens on `http://127.0.0.1:8888`).
3. Seed demo members in the CRM: Gourwest hub → Seed demo, or `php artisan luminara:seed-gourwest --force`.
4. `npm run preview`, order about $120 as `GW-AU-1006`, and watch Noah move from Silver to Gold in `/admin/gourwest`.

For catering and contact enquiries, create a Krayin web form (Settings → Web Forms, "create lead" on, with name,
email, phone, lead title and description attributes) and set `CRM_WEB_FORM_ID` to its numeric id.
Set `GROQ_API_KEY` (and optionally `NVIDIA_API_KEY` as the fallback) to switch the concierge to AI answers.

After checkout, `/order/confirmed/` is a pickup tracker (stages estimated from the kitchen's prep time; the CRM reports no kitchen status), and the header shows a countdown pill until the order is collected.

## Quality gates

```powershell
npm run verify     # astro check + functions/tests type-check + 65 unit/integration tests + production build
```

Tests cover pricing, tamper and size limits, the recommender, shared field rules, the CRM HMAC (checked against
Node's own HMAC, which matches the CRM's PHP `hash_hmac`), idempotent replay, queuing and resending orders through
CRM outages, 401 mapping, origin, content-type and honeypot guards, enquiry lead handling, and the
concierge fallback.

## Deploy

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the Cloudflare Pages and GitHub Actions setup and the go-live checklist.

## Project layout

```
src/data/        menu, kitchens, Club tiers, globe land points, icons (generated)
src/lib/         pricing + recommender (pure, shared by browser and functions)
src/components/  header, footer, globe, concierge, dish card, enquiry fields…
src/pages/       every route
src/scripts/     browser state, globe renderer, enquiry form handler
functions/       Cloudflare Pages Functions and their shared CRM/HTTP helpers
scripts/         build helpers (CSP hashes, globe points, icon set)
design/          original Stitch exports and the Warm Editorial Hospitality design system
tests/           Vitest suites
```

## License

Code is MIT licensed (see [LICENSE](LICENSE)). Gourwest is a fictional brand: replace its name, logo and photos with
your own before using this for a real business.
