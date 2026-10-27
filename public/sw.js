/**
 * Whyte Automations — Production Progressive Web App Service Worker
 * Version: 1.0.0
 */

const CACHE_VERSION = "whyte-pwa-v2";
const STATIC_CACHE_NAME = `whyte-static-${CACHE_VERSION}`;
const IMAGE_CACHE_NAME = `whyte-images-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  "/offline.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/icon.svg",
  "/company-logo.png",
  "/company-logo-black.png",
];

const MAX_IMAGE_CACHE_ENTRIES = 150;
/** The client-rendered offline quotation builder; one cached copy serves every /quotation/draft/<id> URL. */
const BUILDER_SHELL_URL = "/quotation/draft/new";

/**
 * Trim cache to max items (LRU eviction)
 */
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      await cache.delete(keys[0]);
      trimCache(cacheName, maxItems);
    }
  } catch (err) {
    console.warn("[SW] Cache trim error:", err);
  }
}

// ── Lifecycle: Install ──────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE_NAME);
      await cache.addAll(PRECACHE_ASSETS);
      // Immediately take control
      await self.skipWaiting();
    })()
  );
});

// ── Lifecycle: Activate ─────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE_NAME)
          .map((name) => {
            console.log("[SW] Removing outdated cache:", name);
            return caches.delete(name);
          })
      );
      // Claim all clients immediately so the offline experience works on first visit
      await self.clients.claim();
    })()
  );
});

// ── Routing & Fetch Interception ────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Never cache non-GET requests (mutations always go straight to network)
  if (request.method !== "GET") {
    return;
  }

  // 2. Strict Security Boundary: Never cache NextAuth or sensitive authentication APIs
  if (
    url.pathname.startsWith("/api/auth") ||
    url.pathname.startsWith("/api/admin/register") ||
    url.pathname.startsWith("/api/company/register")
  ) {
    return;
  }

  // 3. Navigation Requests (HTML Pages)
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          // Network-first for fresh dynamic views
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.status === 200) {
            // Secure client shell caching for local offline draft builder
            if (url.pathname.startsWith("/quotation/draft")) {
              const cache = await caches.open(STATIC_CACHE_NAME);
              cache.put(request, networkResponse.clone());
            }
          }
          return networkResponse;
        } catch (networkError) {
          // Offline fallback: serve cached offline shell
          console.log("[SW] Navigation failed, serving offline shell:", url.pathname);
          const cachedResponse = await caches.match(request, { ignoreVary: true });
          if (cachedResponse) {
            return cachedResponse;
          }
          // The offline quotation builder is one client-side page for every draft id (it reads the draft id from the
          // URL), so the shell cached by PRECACHE_BUILDER serves /quotation/draft/<anything>.
          if (url.pathname.startsWith("/quotation/draft")) {
            const shell = await caches.match(BUILDER_SHELL_URL, { ignoreVary: true });
            if (shell) return shell;
          }
          // "New Quotation" while the network is down: open the offline builder instead of a dead end.
          if (url.pathname === "/quotation/new") {
            const shell = await caches.match(BUILDER_SHELL_URL, { ignoreVary: true });
            if (shell) return Response.redirect(BUILDER_SHELL_URL, 302);
          }
          const offlinePage = await caches.match("/offline.html");
          if (offlinePage) {
            return offlinePage;
          }
          return new Response("Offline mode active. Please connect to internet.", {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "text/plain" },
          });
        }
      })()
    );
    return;
  }

  // 4. Static Immutable Assets (_next/static, fonts, icons)
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname.endsWith(".woff2") ||
      url.pathname.endsWith(".woff") ||
      url.pathname.endsWith(".ttf"));

  if (isStaticAsset) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;

        try {
          const response = await fetch(request);
          if (response && response.status === 200) {
            const cache = await caches.open(STATIC_CACHE_NAME);
            cache.put(request, response.clone());
          }
          return response;
        } catch (err) {
          const fallback = await caches.match(request, { ignoreSearch: true });
          if (fallback) return fallback;
          return new Response("", { status: 404 });
        }
      })()
    );
    return;
  }

  // 5. Product & Remote Images:
  // Deliberately bypassed in global service-worker cache to prevent cross-tenant
  // image leakage on shared devices. Product images for offline use are managed
  // securely through the tenant-partitioned IndexedDB image store in Phase 3.
  // All other requests fall through directly to network.
});

// ── Offline quotation builder: cache its page and every script/style/font it needs ─────────────────────
// Called by the signed-in app while it is online, so the builder is already on the device when the connection
// drops. The builder is client-rendered, so its HTML plus the /_next/static files it references are all it needs.
// A redirect (not signed in) or an error is never cached.
async function precacheBuilderShell() {
  try {
    const response = await fetch(BUILDER_SHELL_URL, { credentials: "same-origin" });
    if (!response.ok || response.redirected) return false;
    const html = await response.clone().text();
    const cache = await caches.open(STATIC_CACHE_NAME);
    await cache.put(BUILDER_SHELL_URL, response);
    const assets = new Set(html.match(/\/_next\/static\/[^"'\\\s<>]+/g) || []);
    await Promise.all(
      [...assets].map(async (asset) => {
        if (await cache.match(asset)) return;
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn("[SW] Could not precache", asset, err);
        }
      })
    );
    console.log("[SW] Offline builder cached with", assets.size, "assets");
    return true;
  } catch (err) {
    console.warn("[SW] Offline builder precache failed:", err);
    return false;
  }
}

// ── Message Handling (Updates & Logout Cleanup) ──────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (event.data?.type === "PRECACHE_BUILDER") {
    event.waitUntil(precacheBuilderShell());
  }

  if (event.data?.type === "CLEAR_IMAGE_CACHE") {
    caches.delete(IMAGE_CACHE_NAME).then(() => {
      console.log("[SW] Image cache cleared on request");
    });
  }
});
