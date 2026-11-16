import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.env.SERVE_DIR || new URL('../public', import.meta.url).pathname);
const port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    const candidate = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
    if (!candidate.startsWith(root)) throw new Error('Ungültiger Pfad');
    const info = await stat(candidate);
    const file = info.isDirectory() ? join(candidate, 'index.html') : candidate;
    response.writeHead(200, {
      'content-type': types[extname(file)] || 'application/octet-stream',
      'cache-control': file.includes('/data/') ? 'no-cache' : 'public, max-age=300'
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Nicht gefunden');
  }
}).listen(port, '0.0.0.0', () => console.log(`HBD Löwen Live: http://localhost:${port}`));
