import type { APIRoute } from 'astro';

/**
 * Demo simulator for a fictional brand: crawling stays allowed so search engines can read the site-wide
 * `X-Robots-Tag: noindex` (public/_headers), and no sitemap is advertised.
 */
export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
