const CACHE_NAME = 'promax-shell-v2';
const APP_SHELL = ['/', '/manifest.json', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('promax-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const request = event.request;
  const url = new URL(request.url);
  const navigation = request.mode === 'navigate';
  const asset = url.pathname.startsWith('/assets/');
  // API responses are data, not part of the offline application shell.
  if (!navigation && !asset && !APP_SHELL.includes(url.pathname)) return;

  const validResponse = response => {
    if (!response || !response.ok) return false;
    const type = response.headers.get('content-type') || '';
    if (request.destination === 'script' || /\.(?:m?js)$/.test(url.pathname)) {
      return /(?:text|application)\/(?:javascript|ecmascript)/i.test(type);
    }
    if (request.destination === 'style' || url.pathname.endsWith('.css')) return /text\/css/i.test(type);
    return navigation || !/text\/html/i.test(type);
  };

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME).catch(() => null);
    const cached = await cache?.match(request).catch(() => undefined);
    // Hashed build assets never change: retain loaded chunks across deployments.
    if (asset && validResponse(cached)) return cached;
    try {
      const response = await fetch(navigation ? new Request(request, { cache: 'no-store' }) : request);
      if (!validResponse(response)) return asset ? Response.error() : response;
      // A full/unavailable cache must not turn a successful request into an error.
      await cache?.put(request, response.clone()).catch(() => {});
      return response;
    } catch {
      if (validResponse(cached)) return cached;
      // Only a document navigation may fall back to the HTML shell.
      if (navigation) return (await cache?.match('/').catch(() => undefined)) || Response.error();
      return Response.error();
    }
  })());
});
