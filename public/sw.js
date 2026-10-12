/* TrueRef offline support.
   Keeps a copy of the app's own files on the device so it opens without internet.
   It never stores anything a person types or uploads, and never touches Crossref lookups. */
const VERSION = 'trueref-v3';
const FILES = [
  './',
  'index.html',
  'app.js',
  'core.js',
  'theme.js',
  'manifest.webmanifest',
  'vendor/citeproc.js',
  'vendor/mammoth.browser.min.js',
  'vendor/pdf.min.mjs',
  'vendor/pdf.worker.min.mjs',
  'csl/harvard-cite-them-right.csl',
  'csl/apa.csl',
  'csl/chicago-author-date.csl',
  'csl/modern-language-association.csl',
  'csl/ieee.csl',
  'csl/vancouver.csl',
  'csl/locales-en-GB.xml',
  'csl/locales-en-US.xml',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  // Only this site's own files. Crossref and anything else go straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const isPage = req.mode === 'navigate';
  event.respondWith(
    caches.open(VERSION).then(async cache => {
      const cached = await cache.match(isPage ? './' : req, { ignoreSearch: true });
      const network = fetch(req)
        .then(res => {
          if (res && res.ok) cache.put(isPage ? './' : req, res.clone());
          return res;
        })
        .catch(() => null);
      // Show the saved copy straight away and refresh it in the background
      if (cached) { event.waitUntil(network); return cached; }
      const fresh = await network;
      return fresh || new Response('TrueRef is offline and this file has not been saved yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })
  );
});
