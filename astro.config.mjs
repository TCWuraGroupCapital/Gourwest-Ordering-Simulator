import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Public origin used for canonical URLs, Open Graph and the sitemap. Set SITE_URL in the
// Cloudflare Pages build environment once the production domain is attached.
const site = process.env.SITE_URL || 'https://gourwest.example';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'ignore',
  devToolbar: { enabled: false },
  build: { format: 'directory', inlineStylesheets: 'auto' },
  // Checkout pages are noindex, so they stay out of the sitemap too.
  integrations: [sitemap({ filter: (page) => !/\/(order|cart)\//.test(page) })],
  vite: {
    // Never inline fonts/images as data: URIs, so the CSP can stay font-src 'self'.
    build: { chunkSizeWarningLimit: 700, assetsInlineLimit: 0 },
  },
});
