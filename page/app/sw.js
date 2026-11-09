/* Slab Show Scanner's offline copy: the app and the barcode reader stay on the phone, so a show hall with weak signal still
   opens it at once. The app's own files: the copy on the phone first, a newer one fetched behind it for the next start.
   The card data: the network when it answers within 6 seconds, else the copy on the phone. */
const CACHE = 'ssc-v3';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'scan-worker.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'zxing/reader.js', 'zxing/zxing_reader.wasm'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const keep = (req, res) => { if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; };
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url), scope = new URL('./', self.location).pathname;
  if (e.request.method !== 'GET' || u.origin !== self.location.origin || !u.pathname.startsWith(scope)) return;   // PSA, ntfy, pictures: straight to the network
  if (u.pathname.endsWith('/data.bin')) {
    const req = e.request, cached = () => caches.match(req, {ignoreSearch: true});
    e.respondWith(new Promise(resolve => {
      let done = false;
      const t = setTimeout(async () => { const c = await cached(); if (c && !done) { done = true; resolve(c); } }, 6000);
      fetch(req).then(res => { keep(req, res); if (!done) { done = true; clearTimeout(t); resolve(res); } })
        .catch(async () => { const c = await cached(); if (!done) { done = true; clearTimeout(t); resolve(c || Response.error()); } });
    }));
    return;
  }
  e.respondWith(caches.match(e.request, {ignoreSearch: true}).then(hit => {
    const net = fetch(e.request).then(res => keep(e.request, res));
    if (hit) { net.catch(() => {}); return hit; }
    return net.catch(() => caches.match('index.html'));
  }));
});
