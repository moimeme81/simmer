/*
 * Simmer service worker. It makes the app installable on a phone and shows the app shell when the network is down.
 * It always asks the server first, so updates arrive as soon as Simmer restarts, and it never stores recipes,
 * lists, photos or anything from /api, so nothing private is kept on the device by it.
 */
const CACHE = 'simmer-shell-v1';
const STATIC = /\.(?:js|css|png|svg|woff2?|webmanifest)$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  const nav = r.mode === 'navigate';
  if (!nav && !STATIC.test(u.pathname)) return;   // /api, /images, /avatars and the rest go straight to the network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = nav ? '/' : r;
    try {
      const res = await fetch(r);
      if (res.ok) cache.put(key, res.clone());
      return res;
    } catch {
      return (await cache.match(key)) || (await cache.match(r, { ignoreSearch: true })) || Response.error();
    }
  })());
});
