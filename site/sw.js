// Temporarily retire the introduction site's service worker during CSS work.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith('whiteboard-introduction-')).map(key => caches.delete(key)));
  await self.registration.unregister();
  await self.clients.claim();
})()));
