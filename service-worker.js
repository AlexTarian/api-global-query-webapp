const CACHE_NAME = 'globalquery-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest'
];

/*
 * Install
 *
 * Cache only the minimum application shell.
 * CSS/JS can be added here once the frontend structure
 * is finalized.
 */
self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
  );

  self.skipWaiting();
});


/*
 * Activate
 *
 * Remove caches belonging to older versions.
 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(cacheNames =>
        Promise.all(
          cacheNames
            .filter(
              cacheName =>
                cacheName !== CACHE_NAME
            )
            .map(
              cacheName =>
                caches.delete(cacheName)
            )
        )
      )
  );

  self.clients.claim();
});


/*
 * Fetch
 *
 * Network-first for same-origin GET requests.
 *
 * Supabase/API requests are deliberately ignored by
 * the service worker. Those should always go directly
 * to Supabase.
 */
self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  /*
   * Do not intercept requests to other origins.
   * This keeps Supabase requests out of the PWA cache.
   */
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        /*
         * Cache successful same-origin responses.
         */
        if (
          response &&
          response.status === 200 &&
          response.type === 'basic'
        ) {
          const responseClone =
            response.clone();

          caches
            .open(CACHE_NAME)
            .then(cache => {
              cache.put(
                request,
                responseClone
              );
            });
        }

        return response;
      })
      .catch(async () => {
        const cachedResponse =
          await caches.match(request);

        if (cachedResponse) {
          return cachedResponse;
        }

        /*
         * If navigation fails, fall back to the
         * cached application shell.
         */
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }

        return Response.error();
      })
  );
});
