import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const source = `${root}/public`;
const destination = `${root}/dist`;
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
console.log(`Statische App erstellt: ${destination}`);
