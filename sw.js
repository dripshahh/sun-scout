// Sun Scout service worker: opens fast on 4G, keeps the app (and places you've looked at) available with a weak signal.
// Bump VERSION whenever you upload a new version of the app files.
const VERSION = 'sunscout-v10';
const SHELL = ['./', './index.html', './style.css', './app.js', './scene3d.js', './terrain.js', './fx.js', './ar.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];
const LIBS = 'sunscout-libs-v1', TILES = 'sunscout-tiles-v1', MAX_TILES = 1500;

const LIB_URLS = ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'https://unpkg.com/suncalc@1.9.0/suncalc.js'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    // fresh copies straight from the server (not the browser's short-term cache), so a new version is really new
    const c = await caches.open(VERSION);
    await c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    const libs = await caches.open(LIBS);
    await Promise.all(LIB_URLS.map(async u => { if (!(await libs.match(u))) { try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await libs.put(u, r); } catch { /* fetched later */ } } }));
    // From 1.9 on, the app shows "New version, tap to update" and tells us when. Copies older than that (v8 and before)
    // have no such button, so they get this one update straight away, as before.
    const old = (await caches.keys()).some(k => /^sunscout-v[1-8]$/.test(k));
    if (old) await self.skipWaiting();
  })());
});
self.addEventListener('message', e => { if (e.data === 'update-now') self.skipWaiting(); });
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

  // app files: open instantly from the saved copy, then refresh it in the background.
  // A new version arrives as a new service worker (VERSION above), and the app reloads itself once it's in.
  if (u.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
      const net = fetch(req, { cache: 'no-cache' }).then(res => { if (res.ok && !u.search) cache.put(req, res.clone()); return res; });
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      try { return await net; } catch { return Response.error(); }
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
