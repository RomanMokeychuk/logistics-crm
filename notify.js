/* ================================================================= *
 * FURA — СПОВІЩЕННЯ В CRM (спливаюче вікно збоку + звук)            *
 *                                                                    *
 *  • логісту:  новий запит / вам надіслали запит                     *
 *  • Sales:    логіст відповів на ваш запит                          *
 *  • логісту:  Sales обрав ваш варіант                               *
 *                                                                    *
 * Підключається на кожній сторінці ПІСЛЯ основного скрипта:          *
 *   <script src="notify.js"></script>                                *
 * ================================================================= */

(function () {
    // sbClient вже створений основним скриптом сторінки
    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) {
        console.warn(
            "FURA сповіщення: не знайдено sbClient — notify.js має стояти ПІСЛЯ основного скрипта сторінки",
        );
        return;
    }

    const STATUS_CHOSEN = "В роботі";
    let me = null; // запис зі staff для поточного користувача
    const known = new Map(); // id запиту → { logists, answers, status }
    let unread = 0;
    const baseTitle = document.title;

    /* ---------------- Стилі (щоб не чіпати style.css) ---------------- */
    const css = `
    .fura-toasts { position: fixed; right: 20px; bottom: 20px; z-index: 99999;
        display: flex; flex-direction: column-reverse; gap: 10px; width: 360px; max-width: calc(100vw - 32px); }
    .fura-toast { display: flex; gap: 12px; padding: 14px 14px 14px 16px; background: #ffffff;
        border-radius: 12px; border-left: 5px solid #f59e0b; cursor: pointer;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08);
        animation: fura-toast-in 0.25s ease-out; font-family: inherit; }
    .fura-toast.answer { border-left-color: #10b981; }
    .fura-toast.chosen { border-left-color: #2563eb; }
    .fura-toast-icon { font-size: 26px; line-height: 1; }
    .fura-toast-body { flex: 1; min-width: 0; }
    .fura-toast-title { font-weight: 700; font-size: 14px; color: #0f172a; margin-bottom: 3px; }
    .fura-toast-text { font-size: 13px; color: #334155; line-height: 1.4; word-break: break-word; }
    .fura-toast-hint { font-size: 11px; color: #94a3b8; margin-top: 6px; }
    .fura-toast-close { border: none; background: transparent; color: #94a3b8; font-size: 20px;
        line-height: 1; cursor: pointer; padding: 0 2px; align-self: flex-start; }
    .fura-toast-close:hover { color: #0f172a; }
    @keyframes fura-toast-in { from { transform: translateX(120%); opacity: 0; } to { transform: none; opacity: 1; } }`;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    let box = null;
    function toastBox() {
        if (!box) {
            box = document.createElement("div");
            box.className = "fura-toasts";
            document.body.appendChild(box);
        }
        return box;
    }

    const esc = (s) =>
        String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

    /* ---------------- Звук ---------------- */
    let audioCtx = null;
    // Браузер дозволяє звук тільки після першого кліку на сторінці
    document.addEventListener(
        "click",
        () => {
            try {
                audioCtx =
                    audioCtx ||
                    new (window.AudioContext || window.webkitAudioContext)();
                audioCtx.resume();
            } catch (_) {}
            if (
                "Notification" in window &&
                Notification.permission === "default"
            ) {
                Notification.requestPermission().catch(() => {});
            }
        },
        { once: true },
    );

    function beep() {
        try {
            audioCtx =
                audioCtx ||
                new (window.AudioContext || window.webkitAudioContext)();
            const t = audioCtx.currentTime;
            [880, 1175].forEach((freq, i) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = "sine";
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.0001, t + i * 0.18);
                gain.gain.exponentialRampToValueAtTime(
                    0.25,
                    t + i * 0.18 + 0.02,
                );
                gain.gain.exponentialRampToValueAtTime(
                    0.0001,
                    t + i * 0.18 + 0.16,
                );
                osc.connect(gain).connect(audioCtx.destination);
                osc.start(t + i * 0.18);
                osc.stop(t + i * 0.18 + 0.17);
            });
        } catch (_) {}
    }

    /* ---------------- Показ сповіщення ---------------- */
    function updateTitle() {
        document.title = unread ? `(${unread}) ${baseTitle}` : baseTitle;
    }

    function openRequest(id) {
        const onRequestsPage = typeof openRequestCard === "function";
        if (onRequestsPage) {
            const show = () => openRequestCard(id);
            if (typeof loadRequests === "function") loadRequests().then(show);
            else show();
        } else {
            window.location.href = `requests.html?open=${encodeURIComponent(id)}`;
        }
    }

    function notify({ kind, icon, title, text, requestId }) {
        const el = document.createElement("div");
        el.className = `fura-toast ${kind || ""}`;
        el.innerHTML = `
            <div class="fura-toast-icon">${icon}</div>
            <div class="fura-toast-body">
                <div class="fura-toast-title">${esc(title)}</div>
                <div class="fura-toast-text">${text}</div>
                <div class="fura-toast-hint">Натисніть, щоб відкрити</div>
            </div>
            <button type="button" class="fura-toast-close" title="Закрити">&times;</button>`;

        const close = () => {
            el.remove();
            unread = Math.max(0, unread - 1);
            updateTitle();
        };
        el.querySelector(".fura-toast-close").addEventListener("click", (e) => {
            e.stopPropagation();
            close();
        });
        el.addEventListener("click", () => {
            close();
            openRequest(requestId);
        });

        toastBox().appendChild(el);
        unread++;
        updateTitle();
        beep();

        // Якщо вкладка не активна — ще й системне сповіщення macOS / Windows
        if (
            document.hidden &&
            "Notification" in window &&
            Notification.permission === "granted"
        ) {
            try {
                const n = new Notification(`FURA · ${title}`, {
                    body: text.replace(/<[^>]+>/g, ""),
                    icon: "logo.svg",
                    tag: `fura-${requestId}-${kind}`,
                });
                n.onclick = () => {
                    window.focus();
                    n.close();
                };
            } catch (_) {}
        }
    }

    /* ---------------- Розбір змін у запитах ---------------- */
    const idsOf = (r) =>
        (Array.isArray(r?.logistician_ids) && r.logistician_ids.length
            ? r.logistician_ids
            : r?.logistician_id
              ? [r.logistician_id]
              : []
        ).map(String);

    const answersOf = (r) => (Array.isArray(r?.answers) ? r.answers : []);

    const snapshot = (r) => ({
        logists: idsOf(r),
        answers: new Map(
            answersOf(r).map((a) => [String(a.logist_id), String(a.at || "")]),
        ),
        status: r.status,
        chosen: r.logistician_id ? String(r.logistician_id) : null,
    });

    const route = (r) =>
        [r.load_country, r.unload_country].filter(Boolean).join(" → ") ||
        "маршрут не вказано";

    function priceText(a) {
        const o = (a.offers || []).find((x) => x && x.price);
        return o ? ` · <b>${esc(o.price)} ${esc(o.currency || "")}</b>` : "";
    }

    function handleChange(type, r) {
        if (!me || !r?.id) return;
        const myId = String(me.id);
        const before = known.get(String(r.id));
        known.set(String(r.id), snapshot(r));

        // Оновлення, а ми цей запит раніше не бачили — просто запам'ятовуємо
        if (type === "UPDATE" && !before) return;

        const head = `<b>${esc(r.client || "—")}</b>${r.request_type ? ` · ${esc(r.request_type)}` : ""}<br>${esc(route(r))}`;

        // 1. Мене додали логістом
        const wasMine = before ? before.logists.includes(myId) : false;
        if (idsOf(r).includes(myId) && !wasMine) {
            notify({
                kind: "new",
                icon: "🟡",
                title:
                    type === "INSERT" ? "Новий запит" : "Вам надіслано запит",
                text: `${head}${r.sales ? `<br>Sales: ${esc(r.sales)}` : ""}`,
                requestId: r.id,
            });
        }

        // 2. Я — Sales цього запиту, і логіст дав / змінив відповідь
        if (type === "UPDATE" && String(r.sales_id || "") === myId) {
            answersOf(r).forEach((a) => {
                const lid = String(a.logist_id || "");
                if (!lid || lid === myId) return; // свою відповідь не показуємо
                const hasContent = (a.offers || []).length || a.notes;
                if (
                    hasContent &&
                    before.answers.get(lid) !== String(a.at || "")
                ) {
                    notify({
                        kind: "answer",
                        icon: "🟢",
                        title: before.answers.has(lid)
                            ? "Логіст змінив відповідь"
                            : "Логіст відповів",
                        text: `${head}<br>${esc(a.logist || "Логіст")}${priceText(a)}`,
                        requestId: r.id,
                    });
                }
            });
        }

        // 3. Sales обрав мій варіант
        if (
            type === "UPDATE" &&
            r.status === STATUS_CHOSEN &&
            String(r.logistician_id || "") === myId &&
            !(before.status === STATUS_CHOSEN && before.chosen === myId) &&
            String(r.sales_id || "") !== myId
        ) {
            notify({
                kind: "chosen",
                icon: "✅",
                title: "Ваш варіант обрали",
                text: head,
                requestId: r.id,
            });
        }

        // На сторінці запитів — одразу оновлюємо таблицю
        if (typeof loadRequests === "function") loadRequests();
    }

    /* ---------------- Старт ---------------- */
    async function start() {
        const {
            data: { session },
        } = await client.auth.getSession();
        if (!session) return;

        const email = (session.user?.email || "").toLowerCase();
        const { data: staff } = await client
            .from("staff")
            .select("id, full_name, email")
            .eq("active", true);
        me =
            (staff || []).find(
                (s) => (s.email || "").toLowerCase() === email,
            ) || null;
        if (!me) {
            console.warn(
                `FURA сповіщення: пошти ${email} немає серед активних співробітників`,
            );
            return;
        }
        console.log(`FURA сповіщення: ви — ${me.full_name}`);

        // Запам'ятовуємо поточний стан свіжих запитів, щоб помічати зміни
        const since = new Date(Date.now() - 30 * 86400000).toISOString();
        const { data: recent } = await client
            .from("requests")
            .select(
                "id, status, sales_id, logistician_id, logistician_ids, answers",
            )
            .gte("created_at", since);
        (recent || []).forEach((r) => known.set(String(r.id), snapshot(r)));

        client
            .channel("fura-requests")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "requests" },
                (p) => {
                    if (p.eventType === "DELETE") {
                        known.delete(String(p.old?.id));
                        return;
                    }
                    handleChange(p.eventType, p.new);
                },
            )
            .subscribe((status, err) => {
                console.log(
                    "FURA сповіщення (зв'язок з базою):",
                    status,
                    err || "",
                );
            });

        // Перехід з іншої сторінки по кліку на сповіщення: requests.html?open=ID
        const openId = new URLSearchParams(location.search).get("open");
        if (openId && typeof openRequestCard === "function") {
            let tries = 0;
            const timer = setInterval(() => {
                const ready =
                    typeof requestsCache !== "undefined" &&
                    requestsCache.some((x) => String(x.id) === String(openId));
                if (ready || ++tries > 40) {
                    clearInterval(timer);
                    if (ready) openRequestCard(openId);
                    history.replaceState(null, "", location.pathname);
                }
            }, 250);
        }
    }

    // Перевірка вручну: у консолі браузера набрати furaNotifyTest()
    window.furaNotifyTest = () =>
        notify({
            kind: "new",
            icon: "🟡",
            title: "Тестове сповіщення",
            text: "Якщо ви це бачите і чуєте звук — сповіщення працюють.",
            requestId: "",
        });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && !document.querySelector(".fura-toast")) {
            unread = 0;
            updateTitle();
        }
    });

    if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", start);
    else start();
})();
