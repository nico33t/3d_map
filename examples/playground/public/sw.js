// Network-only: do not cache GPS positions, credentials or camera streams.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
