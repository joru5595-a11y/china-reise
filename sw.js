// Offline-Cache für den Reiseplan China (GitHub Pages).
// Cache zuerst: startet sofort, auch ohne Netz. Mit Netz wird im Hintergrund aktualisiert.
const C = "reiseplan-china-202611281717";
const FILES = ["./", "./index.html", "./sw.js", "./manifest.json", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).catch(() => {}));
});
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("reiseplan-china-") && k !== C).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return; // Live-Daten (Kurs, Wetter) nie cachen
  e.respondWith(caches.open(C).then(async c => {
    const nav = r.mode === "navigate";
    const hit = await c.match(nav ? "./" : r, { ignoreSearch: true });
    const net = fetch(r, nav ? { cache: "no-store" } : undefined)
      .then(res => { if (res && res.ok && res.type === "basic") c.put(nav ? "./" : r, res.clone()); return res; })
      .catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    if (res) return res;
    return new Response("Offline – bitte einmal mit Internet öffnen.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }));
});
