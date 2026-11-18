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

    // Лічильник у меню «Пошта» — непрочитані у Вхідних (спільний для всіх вкладок)
    const UNSEEN = () => "fura_mail_unseen:" + (user || "");
    window.furaSetMailUnseen = (n) => { if (user) ls.set(UNSEEN(), Number(n) || 0); window.furaNavBadge?.("mail.html", n); };
    addEventListener("storage", (e) => { if (user && e.key === UNSEEN()) window.furaNavBadge?.("mail.html", Number(ls.get(UNSEEN())) || 0); });
    async function countUnseen() {
        const { data } = await client().functions.invoke("fura-sales", { body: { action: "mail_folders" } });
        const inbox = (data?.folders || []).find((f) => f.kind === "\\Inbox");
        if (inbox) window.furaSetMailUnseen(inbox.unseen || 0);
    }
    (async () => {
        try { const { data } = await client().auth.getSession(); user = (data?.session?.user?.email || "").toLowerCase(); } catch (_) { /* */ }
        if (user) window.furaNavBadge?.("mail.html", Number(ls.get(UNSEEN())) || 0);
    })();

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
        countUnseen().catch(() => {});
        const top = list.reduce((m, x) => Math.max(m, Number(x.uid) || 0), 0);
        const last = Number(ls.get(KEY)) || 0;
        if (!last) { ls.set(KEY, top); return; } // перший запуск — лише запам'ятовуємо
        const fresh = list.filter((x) => Number(x.uid) > last && !x.seen).sort((a, b) => a.uid - b.uid);
        if (top > last) ls.set(KEY, top);
        // на цьому пристрої вже приходять push-сповіщення — не дублюємо (лише оновимо пошту)
        if (fresh.length && pushOn()) { window.dispatchEvent(new CustomEvent("fura-mail-new", { detail: fresh })); return; }
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
    /* ---------- Push: сповіщення приходять, навіть коли FURA закрита (телефон і комп'ютер) ---------- */
    const PUSH = "fura_push_endpoint";
    const pushOn = () => { try { return !!localStorage.getItem(PUSH) && Notification.permission === "granted"; } catch (_) { return false; } };
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const keyBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
    async function call(body) {
        const { data, error } = await client().functions.invoke("fura-sales", { body });
        if (error) { let m = ""; try { m = (await error.context?.json())?.error || ""; } catch (_) { /* */ } throw new Error(m || "Сервер не відповів"); }
        return data;
    }
    async function enablePush(test) {
        if (!canPush) {
            if (isIOS && !standalone) {
                alert("Щоб сповіщення приходили на iPhone, навіть коли FURA закрита:\n\n1) Відкрийте FURA в Safari.\n2) Натисніть «Поділитися» (квадрат зі стрілкою) → «На екран Додому».\n3) Відкрийте FURA з іконки на екрані.\n4) Натисніть 🔔 угорі і дозвольте сповіщення.");
            }
            return false;
        }
        if (Notification.permission === "default") await Notification.requestPermission().catch(() => {});
        if (Notification.permission !== "granted") return false;
        const reg = await navigator.serviceWorker.register("sw.js");
        await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        const { key } = await call({ action: "push_key" });
        if (sub) {
            // ключ сервера змінився — перепідписуємось
            const cur = sub.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
            const want = keyBytes(key);
            if (cur && (cur.length !== want.length || cur.some((b, i) => b !== want[i]))) { await sub.unsubscribe().catch(() => {}); sub = null; }
        }
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
        const j = sub.toJSON();
        let saved = ""; try { saved = localStorage.getItem(PUSH) || ""; } catch (_) { /* */ }
        if (test || saved !== j.endpoint) {
            const device = (isIOS ? "iPhone/iPad" : /Android/.test(navigator.userAgent) ? "Android" : /Mac/.test(navigator.platform) ? "Mac" : /Win/.test(navigator.platform) ? "Windows" : "інше") + " · " + (standalone ? "застосунок" : "браузер");
            await call({ action: "push_subscribe", sub: j, device, test: !!test });
            try { localStorage.setItem(PUSH, j.endpoint); } catch (_) { /* */ }
        }
        return true;
    }
    window.furaPushEnable = (test) => enablePush(test).catch((e) => { console.warn("push", e); return false; });
    // Сповіщення вже дозволені — тихо підписуємо цей пристрій (раз на вкладку)
    setTimeout(() => {
        if (!canPush || Notification.permission !== "granted") return;
        try { if (sessionStorage.getItem("fura_push_checked")) return; sessionStorage.setItem("fura_push_checked", "1"); } catch (_) { /* */ }
        window.furaPushEnable(false);
    }, 5000);
    // Натиснули 🔔 угорі — вмикаємо і push (з тестовим сповіщенням)
    document.addEventListener("click", (e) => {
        if (!e.target.closest?.(".fura-bell")) return;
        if (isIOS && !standalone && !canPush) return setTimeout(() => window.furaPushEnable(true), 300);
        // чекаємо, поки людина натисне «Дозволити» (до 30 с)
        let n = 0;
        const wait = setInterval(() => {
            if (!("Notification" in window) || ++n > 60 || Notification.permission === "denied") return clearInterval(wait);
            if (Notification.permission === "granted") { clearInterval(wait); window.furaPushEnable(true); }
        }, 500);
    }, true);

    setInterval(tick, 15000);
    setTimeout(tick, 4000);
})();
