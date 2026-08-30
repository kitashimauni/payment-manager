const STATIC_CACHE = "payment-log-static-v2";
const RUNTIME_CACHE = "payment-log-runtime-v2";
const PRECACHE_URLS = [
  "/",
  "/payments",
  "/groups",
  "/settings",
  "/settings/payment-methods",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

function extractStaticAssetUrls(html) {
  const urls = new Set();
  const pattern = /(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g;
  let match;
  while ((match = pattern.exec(html)) !== null) urls.add(match[1]);
  return [...urls];
}

async function precacheAppShell() {
  const cache = await caches.open(STATIC_CACHE);
  await cache.addAll(PRECACHE_URLS);

  const assets = new Set();
  for (const path of PRECACHE_URLS) {
    const response = await cache.match(path);
    if (!response || !response.headers.get("Content-Type")?.includes("text/html")) continue;
    for (const asset of extractStaticAssetUrls(await response.text())) assets.add(asset);
  }

  await Promise.all(
    [...assets].map(async (asset) => {
      try {
        const networkRequest = new Request(new URL(asset, self.location.origin), { cache: "no-store" });
        const response = await fetch(networkRequest);
        if (response.ok) await cache.put(new Request(networkRequest.url), response);
      } catch {
        // A single optional asset must not prevent the app shell from installing.
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    precacheAppShell().then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => ![STATIC_CACHE, RUNTIME_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isSameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isRscRequest(request, url) {
  if (isNavigationRequest(request)) return false;
  return request.headers.has("RSC") || request.headers.has("Next-Router-State-Tree") || url.searchParams.has("_rsc");
}

function isAssetRequest(request, url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/_next/image") || [
    "font",
    "image",
    "manifest",
    "script",
    "style",
    "worker",
  ].includes(request.destination);
}

function isNavigationRequest(request) {
  return request.mode === "navigate" || request.destination === "document";
}

function offlineResponse(contentType = "text/plain; charset=utf-8") {
  return new Response("オフラインのため、このリソースを読み込めません。", {
    status: 503,
    headers: { "Content-Type": contentType },
  });
}

function offlineApiResponse() {
  return new Response(JSON.stringify({ error: "offline" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

async function cacheResponse(cacheName, request, response) {
  if (!response.ok) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch {
    // A cache failure must not make an otherwise successful network request fail.
  }
}

async function cachedResponse(cacheName, request, ignoreSearch = false) {
  const cache = await caches.open(cacheName);
  return cache.match(request, { ignoreSearch });
}

async function handleNavigation(event) {
  try {
    const response = await fetch(event.request);
    await cacheResponse(RUNTIME_CACHE, event.request, response);
    return response;
  } catch {
    const cached =
      (await cachedResponse(RUNTIME_CACHE, event.request)) ||
      (await cachedResponse(STATIC_CACHE, event.request));
    return cached || offlineResponse("text/html; charset=utf-8");
  }
}

async function handleAsset(event) {
  const cached = await cachedResponse(STATIC_CACHE, event.request);
  if (cached) return cached;

  const runtimeCached = await cachedResponse(RUNTIME_CACHE, event.request);
  if (runtimeCached) return runtimeCached;

  try {
    const response = await fetch(event.request);
    await cacheResponse(RUNTIME_CACHE, event.request, response);
    return response;
  } catch {
    return offlineResponse();
  }
}

async function handleRsc(event) {
  try {
    const response = await fetch(event.request);
    await cacheResponse(RUNTIME_CACHE, event.request, response);
    return response;
  } catch {
    const cached =
      (await cachedResponse(RUNTIME_CACHE, event.request)) ||
      (await cachedResponse(RUNTIME_CACHE, event.request, true));
    return cached || offlineResponse("text/x-component; charset=utf-8");
  }
}

async function handleApi(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineApiResponse();
  }
}

async function handleRuntimeRequest(event) {
  try {
    const response = await fetch(event.request);
    await cacheResponse(RUNTIME_CACHE, event.request, response);
    return response;
  } catch {
    const cached = await cachedResponse(RUNTIME_CACHE, event.request);
    return cached || offlineResponse();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !isSameOrigin(request)) return;

  const url = new URL(request.url);
  if (url.pathname === "/sw.js") return;
  if (isApiRequest(url)) {
    event.respondWith(handleApi(request));
  } else if (isNavigationRequest(request)) {
    event.respondWith(handleNavigation(event));
  } else if (isRscRequest(request, url)) {
    event.respondWith(handleRsc(event));
  } else if (isAssetRequest(request, url)) {
    event.respondWith(handleAsset(event));
  } else {
    event.respondWith(handleRuntimeRequest(event));
  }
});
