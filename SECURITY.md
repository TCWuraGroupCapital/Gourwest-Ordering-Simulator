# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub:
**Security → Report a vulnerability** on this repository. Do not open a public issue.

Include the affected route or file, steps to reproduce, and the impact you expect. You should hear back within a few
working days.

## Scope

In scope: the site in `src/`, the Pages Functions in `functions/`, the security headers in `public/_headers` and the CI workflow.

Out of scope: your own deployment's Cloudflare, CRM or AI-provider configuration, and findings that need a leaked secret.

## Design notes

- The webhook secret and AI keys exist only as Cloudflare encrypted variables; the browser never sees them.
- Orders are re-priced on the server, signed with HMAC-SHA256 and replay-protected by checkout id.
- Write endpoints check the origin, content type, a honeypot and Cloudflare Turnstile.
- A strict Content Security Policy with build-time script hashes is set in `public/_headers`.
