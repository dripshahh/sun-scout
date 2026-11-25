// Sun Scout service worker: opens fast on 4G, keeps the app (and places you've looked at) available with a weak signal.
// Bump VERSION whenever you upload a new version of the app files.
const VERSION = 'sunscout-v5';
const SHELL = ['./', './index.html', './style.css', './app.js', './scene3d.js', './terrain.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];
const LIBS = 'sunscout-libs-v1', TILES = 'sunscout-tiles-v1', MAX_TILES = 1500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('sunscout-v') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const isLib = u => /^(unpkg\.com|cdn\.jsdelivr\.net)$/.test(u.hostname);
// open-data tiles only (satellite photos stay under the browser's normal caching, per their terms)
const isTile = u => (u.hostname === 'tiles.openfreemap.org' && u.pathname.endsWith('.pbf'))
  || (u.hostname === 's3.amazonaws.com' && u.pathname.startsWith('/elevation-tiles-prod/'));

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);

  // app files: try the network first (so updates show up), fall back to the saved copy when offline / slow
  if (u.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await Promise.race([fetch(req, { cache: 'no-cache' }), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))]);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }
  // libraries (exact versions, never change) and map/elevation tiles: saved copy first
  if (isLib(u) || isTile(u)) {
    e.respondWith((async () => {
      const cache = await caches.open(isLib(u) ? LIBS : TILES);
      const hit = await cache.match(req); if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') { cache.put(req, res.clone()); if (!isLib(u)) trim(cache); }
      return res;
    })());
  }
  // everything else (weather, clouds, search) always comes live from the network
});
