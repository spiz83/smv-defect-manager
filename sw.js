/* Defect Manager service worker — lets the app OPEN with no connection.
 *
 * Strategy:
 *  - App shell (index.html, cloud-sync.js, the Supabase library, icons) is
 *    precached on install and served so the app loads offline.
 *  - HTML + app code are network-FIRST (fresh when online, cached fallback when
 *    offline) so deploys still roll out. cloud-sync.js is also cache-busted via
 *    ?v=, so a new version is a new URL = always re-fetched.
 *  - Static assets (icons, Supabase lib, fonts) are cache-first.
 *  - The Supabase API/auth/storage/realtime (*.supabase.co) is NEVER cached or
 *    intercepted — it must hit the network; offline failures are handled in-app
 *    by the outbox in cloud-sync.js.
 *
 * Bump CACHE (and the cloud-sync ?v= below) whenever the shell changes.
 */
const CACHE = 'deffixer-shell-2026-06-16f';

// Same-origin shell. All of these must exist or install precache will fail.
const CORE = [
  './',
  './index.html',
  './cloud-sync.js?v=2026-06-16f',
  './manifest.webmanifest',
  './icon.svg',
  './favicon-48.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];
// Cross-origin, needed to boot cloud sync offline. Best-effort (don't fail install).
const EXTRA = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await cache.addAll(CORE); } catch (e) { console.warn('[SW] core precache failed', e); }
    await Promise.all(EXTRA.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Never touch the Supabase backend — it must reach the network.
  if (url.hostname.endsWith('supabase.co')) return;

  const isNav = req.mode === 'navigate';
  const isAppCode = url.origin === self.location.origin &&
    (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/cloud-sync.js'));

  // Network-first for navigations + app code: fresh online, cached when offline.
  // Use cache:'reload' to BYPASS the browser HTTP cache — GitHub Pages serves
  // index.html with a 10-min max-age, which would otherwise hand back stale code
  // for minutes after a deploy.
  if (isNav || isAppCode) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'reload' });
        const cache = await caches.open(CACHE);
        cache.put(isNav ? './index.html' : req, res.clone());
        return res;
      } catch (e) {
        const cached = await caches.match(isNav ? './index.html' : req);
        return cached || caches.match('./index.html');
      }
    })());
    return;
  }

  // Everything else (icons, Supabase lib, fonts): cache-first, refresh in bg.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        caches.open(CACHE).then((c) => c.put(req, res.clone()));
      }
      return res;
    }).catch(() => cached);
    return cached || network;
  })());
});
