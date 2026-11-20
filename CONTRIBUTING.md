# Contributing

Thanks for helping improve the Gourwest ordering site.

## Set up

```bash
npm ci
npm run dev       # UI at http://localhost:4321
npm run preview   # site + API functions at http://localhost:8788 (copy .dev.vars.example to .dev.vars first)
```

## Before you open a pull request

1. Run `npm run verify`. It type-checks the site, functions and tests, runs Vitest and builds production. CI runs the same command.
2. Add or update a test when you change pricing, API handling, the recommender or structured data.
3. Keep `src/data/menu.ts` the single source of truth: pages, the bag, server pricing and the allergen matrix all read from it.
4. If you change the UI, include before and after screenshots in the pull request.

## Ground rules

- Never commit `.dev.vars` or any secret. Runtime secrets are Cloudflare encrypted variables.
- New inline scripts must stay CSP-safe: `scripts/csp.mjs` hashes them at build time, so no `eval` or inline event handlers.
- Keep the demo notices (footer, `noindex`, city-only structured data) unless the site is being launched as a real brand.
