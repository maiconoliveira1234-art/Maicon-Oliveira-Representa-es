import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isModuleLoadError, recoverModuleLoad } from '../lib/moduleRecovery';

const handlers: Record<string, (event: any) => void> = {};
const entries = new Map<string, Response>();
const cache = {
  match: async (request: Request | string) => entries.get(typeof request === 'string' ? request : request.url)?.clone(),
  put: async (request: Request, response: Response) => { entries.set(request.url, response); },
};
let network: (request: Request) => Promise<Response>;
let fetchCount = 0;
vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), {
  self: {
    location: { origin: 'https://example.com' },
    addEventListener: (name: string, callback: any) => { handlers[name] = callback; },
  },
  caches: { open: async () => cache },
  URL, Request, Response,
  fetch: (request: Request) => { fetchCount++; return network(request); },
});
async function request(path: string, mode = 'cors', destination = '') {
  let result: Promise<Response> | undefined;
  handlers.fetch({
    request: { url: `https://example.com${path}`, method: 'GET', mode, destination },
    respondWith: (response: Promise<Response>) => { result = response; },
  });
  return result;
}

entries.set('/', new Response('<html>shell</html>', { headers: { 'content-type': 'text/html' } }));
network = async () => { throw new TypeError('offline'); };
assert.equal((await request('/assets/missing.js', 'cors', 'script'))?.type, 'error', 'Never return HTML for offline JavaScript');
assert.equal(await (await request('/cliente/123', 'navigate'))?.text(), '<html>shell</html>', 'Offline navigation keeps the shell');
assert.equal(await request('/api/clientes'), undefined, 'API requests bypass the shell cache');

network = async () => new Response('<html>rewrite</html>', { headers: { 'content-type': 'text/html' } });
assert.equal((await request('/assets/missing.js', 'cors', 'script'))?.type, 'error', 'Reject a 200 HTML rewrite for a script');
assert.equal(entries.has('https://example.com/assets/missing.js'), false, 'Never cache an HTML script response');
assert.equal((await request('/assets/missing.css', 'cors', 'style'))?.type, 'error', 'Reject HTML for CSS');

network = async () => new Response('export const value = 1;', { headers: { 'content-type': 'application/javascript' } });
assert.equal(await (await request('/assets/page-old.js', 'cors', 'script'))?.text(), 'export const value = 1;');
const previousFetches = fetchCount;
network = async () => { throw new TypeError('removed after deployment'); };
assert.equal(await (await request('/assets/page-old.js', 'cors', 'script'))?.text(), 'export const value = 1;');
assert.equal(fetchCount, previousFetches, 'Reuse valid hashed chunks across deployments');

assert.equal(isModuleLoadError(new TypeError("'text/html' is not a valid JavaScript MIME type.")), true);
assert.equal(isModuleLoadError(new TypeError('Importing a module script failed.')), true);
assert.equal(isModuleLoadError(new TypeError('Cannot read properties of null')), false);

const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
const fallback = new RegExp(`^${config.rewrites.at(-1).source}$`);
for (const path of ['/assets/missing.js', '/assets/missing.css', '/sw.js', '/icon-192.png']) assert.equal(fallback.test(path), false);
for (const path of ['/', '/cliente/123', '/contar-estoque/123']) assert.equal(fallback.test(path), true);

let reloads = 0;
let updates = 0;
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  onLine: true,
  serviceWorker: { getRegistration: async () => ({ update: async () => { updates++; } }) },
} });
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { reload: () => { reloads++; } } } });
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) || null,
  setItem: (key: string, value: string) => storage.set(key, value),
} });
assert.deepEqual(await Promise.all([recoverModuleLoad(), recoverModuleLoad()]), [true, true]);
assert.equal(reloads, 1, 'Concurrent preload/import errors must only reload once');
assert.equal(updates, 1, 'Update the worker before reloading');
assert.ok(Number(storage.get('promax-module-recovery')) > 0, 'Persist a guard for the next page load');
console.log('Module loading: offline fallback, MIME validation, chunk cache, recovery detection and SPA routing passed.');
