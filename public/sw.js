/* Only cache the public offline screen. Reports, API responses and OAuth stay network-only. */
const CACHE = "hanabi-offline-v2";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/offline.html"])));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("hanabi-offline-") && key !== CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode !== "navigate" || event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  event.respondWith((async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(event.request, { signal: controller.signal });
      if (response.status >= 500) throw new Error("Server unavailable");
      return response;
    } catch {
      const fallback = await caches.match("/offline.html");
      return fallback ? new Response(await fallback.arrayBuffer(), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      }) : Response.error();
    } finally {
      clearTimeout(timeout);
    }
  })());
});
