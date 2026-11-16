import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const required = [
  'public/index.html', 'public/app.js', 'public/styles.css', 'public/sw.js',
  'public/data/matches.json', 'public/data/live.json', 'public/data/events.json',
  'public/data/standings.json', 'public/data/teams.json', 'public/data/meta.json',
  'scripts/fetch-data.mjs', 'config/teams.json', '.github/workflows/pages.yml', 'README.md'
];
for (const path of required) await access(`${root}/${path}`);
for (const path of required.filter((entry) => entry.endsWith('.json'))) JSON.parse(await readFile(`${root}/${path}`, 'utf8'));
const app = await readFile(`${root}/public/app.js`, 'utf8');
if (/handball\.net\/api|api\/new\/matches/i.test(app)) throw new Error('Frontend enthält einen verbotenen Direktabruf zu handball.net.');
if (!app.includes('data/${name}.json')) throw new Error('Frontend liest die Cache-Dateien nicht.');
console.log(`Projektprüfung erfolgreich (${required.length} Pflichtdateien).`);
