// FURA: локальна пам'ять браузера (IndexedDB) для великих довідників.
// Дані зберігаються лише на цьому комп'ютері, прив'язані до користувача; при вході в FURA очищаються.
(function () {
    const DB = "fura-cache";
    let dbp = null;
    function db() {
        if (!("indexedDB" in window)) return Promise.reject(new Error("no idb"));
        if (!dbp) {
            dbp = new Promise((res, rej) => {
                const r = indexedDB.open(DB, 1);
                r.onupgradeneeded = () => r.result.createObjectStore("kv");
                r.onsuccess = () => res(r.result);
                r.onerror = () => rej(r.error);
            });
        }
        return dbp;
    }
    async function tx(mode, fn) {
        const d = await db();
        return new Promise((res, rej) => {
            const t = d.transaction("kv", mode);
            const out = fn(t.objectStore("kv"));
            t.oncomplete = () => res(out && out.result);
            t.onerror = t.onabort = () => rej(t.error);
        });
    }
    async function me() {
        try {
            const { data } = await sbClient.auth.getSession();
            return (data?.session?.user?.email || "").toLowerCase();
        } catch (e) { return ""; }
    }
    window.furaCache = {
        async get(key) {
            try {
                const v = await tx("readonly", (s) => s.get(key));
                if (!v || v.owner !== (await me())) return null;
                return v.value;
            } catch (e) { return null; }
        },
        async set(key, value) {
            try { const owner = await me(); if (owner) await tx("readwrite", (s) => s.put({ owner, value }, key)); } catch (e) { /* без кешу */ }
        },
        async clear() {
            try { await tx("readwrite", (s) => s.clear()); } catch (e) { /* немає */ }
        },
    };
})();
