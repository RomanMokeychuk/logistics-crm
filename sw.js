/* FURA — фоновий помічник браузера: лише сповіщення (нічого не кешує, сторінки завжди свіжі) */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
    let d = {};
    try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "FURA", body: e.data ? e.data.text() : "" }; }
    e.waitUntil(self.registration.showNotification(d.title || "FURA", {
        body: d.body || "",
        icon: "icon-192.png",
        badge: "icon-192.png",
        tag: d.tag || undefined,
        renotify: !!d.tag,
        data: { url: d.url || "home.html" },
    }));
});

self.addEventListener("notificationclick", (e) => {
    e.notification.close();
    const url = new URL(e.notification.data?.url || "home.html", self.registration.scope).href;
    e.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const mine = all.find((c) => c.url.startsWith(self.registration.scope));
        if (mine) {
            try { await mine.focus(); } catch (_) { /* */ }
            try { return await mine.navigate(url); } catch (_) { /* */ }
        }
        return self.clients.openWindow(url);
    })());
});
