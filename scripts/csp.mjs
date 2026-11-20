// Post-build: hash every inline <script> in dist/**/*.html and write the hashes into dist/_headers,
// so the Content-Security-Policy can forbid 'unsafe-inline' scripts. Fails the build if the
// placeholder is missing, so a stale policy can never ship silently.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.html')) files.push(path);
  }
})(dist);

const hashes = new Set();
for (const file of files) {
  const html = readFileSync(file, 'utf8');
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(attrs) || /type="application\/(ld\+)?json"/.test(attrs) || body.trim() === '') continue;
    hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
}

const headersPath = join(dist, '_headers');
const headers = readFileSync(headersPath, 'utf8');
if (!headers.includes('{{SCRIPT_HASHES}}')) throw new Error('dist/_headers is missing the {{SCRIPT_HASHES}} placeholder.');
writeFileSync(headersPath, headers.replace('{{SCRIPT_HASHES}}', [...hashes].sort().join(' ')));
console.log(`CSP: ${hashes.size} inline script hash(es) across ${files.length} pages.`);
