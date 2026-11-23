const cacheName = 'burrow-brigade-__BUILD__';
const files = ['/', '/index.html', '/style.css', '/game.js', '/mark.svg', '/app.webmanifest',
  '/apple-touch-icon.png', '/app-icon-192.png', '/app-icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files.map(file => new Request(file, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('burrow-brigade-') && key !== cacheName).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      event.respondWith(caches.open(cacheName).then(cache => cache.match('/')).then(cached => cached || fetch(event.request)));
    }
  } else if (files.includes(url.pathname)) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(url.pathname)).then(cached => cached || fetch(event.request)));
  }
});
