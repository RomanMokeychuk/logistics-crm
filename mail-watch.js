/* ================================================================= *
 * FURA — НОВІ ЛИСТИ НА ПОШТІ → сповіщення                            *
 * Працює на будь-якій сторінці FURA: раз на ~1,5 хв дивиться Вхідні  *
 * (лише одна вкладка, щоб не дублювати) і показує спливаюче вікно    *
 * в CRM + системне сповіщення на комп'ютері (якщо дозволено 🔔).     *
 * ================================================================= */
(function () {
    if (window.top !== window.self) return;
    const client = () => (typeof sbClient !== "undefined" ? sbClient : null);
    if (!client()) return;

    const EVERY = 90 * 1000;        // як часто перевіряти
    const LOCK = "fura_mailwatch_lock";
    const me = Math.random().toString(36).slice(2);
    const ls = {
        get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (_) { return null; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* без пам'яті */ } },
    };
    let user = "";
    let off = false;

    // Лише одна вкладка FURA перевіряє пошту (інші — відпочивають)
    function leader() {
        const l = ls.get(LOCK);
        const now = Date.now();
        if (!l || l.id === me || now - l.ts > 45000) { ls.set(LOCK, { id: me, ts: now, next: l?.next || 0 }); return true; }
        return false;
    }
    addEventListener("pagehide", () => { const l = ls.get(LOCK); if (l?.id === me) try { localStorage.removeItem(LOCK); } catch (_) { /* */ } });

    const strip = (s) => String(s || "").replace(/<[^>]*>/g, "").replace(/["']/g, "").trim();

    async function check() {
        if (off) return;
        if (!user) {
            const { data } = await client().auth.getSession();
            user = (data?.session?.user?.email || "").toLowerCase();
            if (!user) return;
        }
        const KEY = "fura_mail_last_uid:" + user;
        const { data, error } = await client().functions.invoke("fura-sales", { body: { action: "mail_list", folder: "INBOX", limit: 10 } });
        if (error) {
            let msg = "";
            try { msg = (await error.context?.json())?.error || ""; } catch (_) { /* */ }
            if (/Підключіть|403|доступ/i.test(msg) || error.context?.status === 403) off = true; // пошту не підключено — не смикаємо
            return;
        }
        const list = data?.list || [];
        const top = list.reduce((m, x) => Math.max(m, Number(x.uid) || 0), 0);
        const last = Number(ls.get(KEY)) || 0;
        if (!last) { ls.set(KEY, top); return; } // перший запуск — лише запам'ятовуємо
        const fresh = list.filter((x) => Number(x.uid) > last && !x.seen).sort((a, b) => a.uid - b.uid);
        if (top > last) ls.set(KEY, top);
        if (!fresh.length || typeof window.furaToast !== "function") return;
        const show = fresh.slice(-3);
        show.forEach((m) => window.furaToast({
            kind: "chat", icon: "✉️",
            title: "Новий лист: " + (strip(m.from) || m.from_email || "пошта"),
            text: (m.att ? "📎 " : "") + strip(m.subject || "(без теми)"),
            tag: "mail-" + m.uid,
            href: "mail.html?uid=" + m.uid,
        }));
        if (fresh.length > show.length) {
            window.furaToast({ kind: "chat", icon: "✉️", title: `Ще ${fresh.length - show.length} нових листів`, text: "Відкрити пошту", href: "mail.html" });
        }
        // на сторінці «Пошта» — одразу оновити список
        window.dispatchEvent(new CustomEvent("fura-mail-new", { detail: fresh }));
    }

    async function tick() {
        if (off || !leader()) return;
        const l = ls.get(LOCK) || {};
        if (Date.now() < (l.next || 0)) return;
        ls.set(LOCK, { ...l, id: me, ts: Date.now(), next: Date.now() + EVERY });
        try { await check(); } catch (_) { /* мережа — наступного разу */ }
    }
    setInterval(tick, 15000);
    setTimeout(tick, 4000);
})();
