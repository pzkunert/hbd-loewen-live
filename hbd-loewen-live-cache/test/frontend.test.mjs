import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('Frontend lädt ausschließlich eigene JSON-Cache-Dateien', () => {
  assert.match(app, /data\/matches\.json|`data\/\$\{name\}\.json/);
  assert.match(app, /data\/meta\.json|`data\/\$\{name\}\.json/);
  assert.doesNotMatch(app, /handball\.net\/api|api\/new\/matches/i);
  assert.doesNotMatch(html, /handball\.net\/api|api\/new\/matches/i);
});

test('mobile Kernnavigation bleibt auf Live, Spiele und Tabelle reduziert', () => {
  assert.match(html, /data-target="home"/);
  assert.match(html, /data-target="games"/);
  assert.match(html, /data-target="table"/);
  assert.match(html, /viewport-fit=cover/);
});
