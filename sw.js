const SHELL_CACHE = 'speen-shell-v1';
const RUNTIME_CACHE = 'speen-runtime-v1';
const APP_SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './icon.svg',
    './icon-192.png',
    './icon-512.png',
];

function isRuntimeDependency(url) {
    return (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))
        || (url.hostname === 'esm.sh' && url.pathname.startsWith('/libphonenumber-js@'))
        || url.hostname === 'fonts.googleapis.com'
        || url.hostname === 'fonts.gstatic.com';
}

self.addEventListener('install', event => {
    event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith('speen-') && ![SHELL_CACHE, RUNTIME_CACHE].includes(name)).map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);

    if (url.origin === self.location.origin && request.mode === 'navigate') {
        event.respondWith(fetch(request).then(response => {
            if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone()));
            return response;
        }).catch(async () => (await caches.match(request)) || caches.match('./index.html')));
        return;
    }

    if (url.origin !== self.location.origin && !isRuntimeDependency(url)) return;
    event.respondWith((async () => {
        const cache = await caches.open(url.origin === self.location.origin ? SHELL_CACHE : RUNTIME_CACHE);
        const cached = await cache.match(request);
        if (cached) {
            fetch(request).then(response => {
                if (response.ok) cache.put(request, response);
            }).catch(() => {});
            return cached;
        }
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
    })());
});
