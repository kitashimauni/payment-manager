const RUNTIME_CACHE = "payment-log-runtime-v2";
const warmingRoutes = new Map<string, Promise<void>>();

export const PWA_SHELL_ROUTES = [
  "/",
  "/payments",
  "/groups",
  "/settings",
  "/settings/payment-methods",
] as const;

function isWarmableAsset(url: URL) {
  return url.origin === window.location.origin && url.pathname.startsWith("/_next/static/");
}

function extractAssetUrls(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const urls = new Set<string>();

  for (const element of document.querySelectorAll("script[src], link[href]")) {
    const value = element.getAttribute("src") ?? element.getAttribute("href");
    if (!value) continue;
    try {
      const url = new URL(value, window.location.origin);
      if (isWarmableAsset(url)) urls.add(url.toString());
    } catch {
      // Ignore malformed optional resource references in the generated HTML.
    }
  }

  return [...urls];
}

async function warmOfflineRoute(path: string) {
  if (typeof window === "undefined" || !navigator.onLine || !("caches" in window)) return;

  const routeUrl = new URL(path, window.location.origin);
  if (routeUrl.origin !== window.location.origin) return;

  try {
    const response = await fetch(routeUrl, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    });
    if (!response.ok) return;

    const html = await response.clone().text();
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(new Request(routeUrl), response);

    await Promise.allSettled(
      extractAssetUrls(html).map(async (assetUrl) => {
        const assetResponse = await fetch(assetUrl, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (assetResponse.ok) await cache.put(new Request(assetUrl), assetResponse);
      }),
    );
  } catch {
    // Offline warming is best effort and must not interrupt local-first UI work.
  }
}

export async function warmOfflineRoutes(paths: readonly string[]) {
  const uniquePaths = [...new Set(paths)];
  await Promise.allSettled(
    uniquePaths.map((path) => {
      const existing = warmingRoutes.get(path);
      if (existing) return existing;

      const warming = warmOfflineRoute(path).finally(() => warmingRoutes.delete(path));
      warmingRoutes.set(path, warming);
      return warming;
    }),
  );
}
