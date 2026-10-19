/* ================================================================= *
 * FURA — ФУРИК: помічник-персонаж з нагадуваннями                     *
 * Маленька фура в кутку. З'являється тільки по ділу:                  *
 *   • запит чекає відповіді логіста   • сьогодні подзвонити лідам      *
 *   • сьогодні / прострочене завантаження   • перевізник не відповів   *
 *   • вранці — коротке зведення дня                                    *
 * Працює за правилами на даних FURA — без платного ШІ.                 *
 * Підключається з shell.js на всіх сторінках.                          *
 * ================================================================= */

(function () {
    if (window.top !== window.self || window.__furaFurik) return;
    window.__furaFurik = true;

    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) return;

    const POLL_MS = 5 * 60 * 1000;
    const WAIT_LOGIST_MIN = 60; // запит без відповіді довше — нагадати логісту
    const WAIT_SALES_MIN = 120; // Sales: свій запит без відповіді довше — нагадати
    const BID_WAIT_MIN = 180; // перевізник не дав ставку довше — нагадати

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const todayIso = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const ago = (iso) => {
        const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
        if (min < 60) return `${min} хв`;
        const h = Math.floor(min / 60);
        return h < 24 ? `${h} год` : `${Math.floor(h / 24)} дн`;
    };
    const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

    /* ---------------- Пам'ять (лише в цьому браузері) ---------------- */

    const store = {
        get(k, def) {
            try {
                const v = localStorage.getItem(k);
                return v === null ? def : JSON.parse(v);
            } catch (_) {
                return def;
            }
        },
        set(k, v) {
            try {
                localStorage.setItem(k, JSON.stringify(v));
            } catch (_) {}
        },
    };
    const K_OFF = "fura_furik_off_until";
    const K_HIDDEN = "fura_furik_hidden"; // { tipId: "YYYY-MM-DD" }
    const K_MORNING = "fura_furik_morning";
    const seenThisSession = new Set();

    function hiddenToday(id) {
        const h = store.get(K_HIDDEN, {});
        return h[id] === todayIso();
    }
    function hideTip(id) {
        const h = store.get(K_HIDDEN, {});
        const t = todayIso();
        for (const k of Object.keys(h)) if (h[k] !== t) delete h[k]; // чистимо вчорашнє
        h[id] = t;
        store.set(K_HIDDEN, h);
    }
    const isOffToday = () => store.get(K_OFF, "") === todayIso();

    /* ---------------- Хто я ---------------- */

    let me = null;
    async function whoAmI() {
        if (me) return me;
        const { data } = await client.auth.getSession();
        const email = (data?.session?.user?.email || "").toLowerCase();
        if (!email) return null;
        const { data: staff } = await client.from("staff").select("id, full_name, email, roles, role").eq("active", true);
        const s = (staff || []).find((x) => (x.email || "").toLowerCase() === email);
        if (!s) return null;
        const roles = Array.isArray(s.roles) && s.roles.length ? s.roles : s.role ? [s.role] : [];
        me = { ...s, roles, firstName: String(s.full_name || "").trim().split(/\s+/).slice(-1)[0] || "" };
        return me;
    }
    const has = (...r) => me && me.roles.some((x) => r.includes(x));

    /* ---------------- Правила: що підказати ---------------- */

    async function collectTips() {
        const tips = [];
        const today = todayIso();
        const meId = String(me.id);
        const isLogist = has("logist", "head", "admin");
        const isSales = has("sales", "head", "admin");

        // 1. Запити без відповіді
        try {
            const { data } = await client
                .from("requests")
                .select("id, client, load_country, unload_country, status, created_at, sales_id, logistician_ids, logistician_id")
                .eq("status", "Запит")
                .order("created_at", { ascending: true })
                .limit(100);
            for (const r of data || []) {
                const ids = Array.isArray(r.logistician_ids) && r.logistician_ids.length ? r.logistician_ids.map(String) : r.logistician_id ? [String(r.logistician_id)] : [];
                const waitMin = (Date.now() - new Date(r.created_at).getTime()) / 60000;
                const route = `${r.load_country || "—"} → ${r.unload_country || "—"}`;
                if (isLogist && (ids.includes(meId) || (!ids.length && has("logist"))) && waitMin > WAIT_LOGIST_MIN) {
                    tips.push({
                        id: `req-${r.id}`,
                        kind: "warn",
                        text: `Запит <b>${esc(r.client)}</b> (${esc(route)}) чекає вашої відповіді вже <b>${ago(r.created_at)}</b>.`,
                        action: { label: "Відповісти", href: `requests.html?open=${r.id}` },
                        weight: 3,
                    });
                } else if (isSales && String(r.sales_id) === meId && waitMin > WAIT_SALES_MIN) {
                    tips.push({
                        id: `myreq-${r.id}`,
                        kind: "info",
                        text: `Ваш запит <b>${esc(r.client)}</b> ще без відповіді логіста (${ago(r.created_at)}). Може, написати логісту в переписці запиту?`,
                        action: { label: "Відкрити", href: `requests.html?open=${r.id}` },
                        weight: 2,
                    });
                }
            }
        } catch (_) {}

        // 2. Кому подзвонити сьогодні (ліди)
        if (isSales) {
            try {
                const { data } = await client
                    .from("leads")
                    .select("id, name, next_contact, status, sales_id")
                    .lte("next_contact", today)
                    .limit(200);
                const mine = (data || []).filter(
                    (l) => (String(l.sales_id) === meId || has("head", "admin")) && !["Працюємо", "Відмова"].includes(l.status),
                );
                if (mine.length) {
                    const names = mine.slice(0, 2).map((l) => `<b>${esc(l.name)}</b>`).join(", ");
                    tips.push({
                        id: `calls-${today}-${mine.length}`,
                        kind: "info",
                        text: `Сьогодні подзвонити: ${mine.length} ${plural(mine.length, "ліду", "лідам", "лідам")} — ${names}${mine.length > 2 ? " та ін." : ""}.`,
                        action: { label: "Показати", href: "leads.html?today=1" },
                        weight: 2,
                    });
                }
            } catch (_) {}
        }

        // 3. Завантаження сьогодні й прострочені (мої угоди)
        if (isLogist) {
            try {
                const { data } = await client
                    .from("deals")
                    .select("id, number, client, load_date_plan, load_date, logist_id")
                    .lte("load_date_plan", today)
                    .is("load_date", null)
                    .order("load_date_plan", { ascending: false })
                    .limit(50);
                const mine = (data || []).filter((d) => String(d.logist_id) === meId || has("head", "admin"));
                const todayList = mine.filter((d) => String(d.load_date_plan).slice(0, 10) === today);
                const late = mine.filter((d) => String(d.load_date_plan).slice(0, 10) < today);
                for (const d of todayList.slice(0, 3)) {
                    tips.push({
                        id: `load-${d.id}-${today}`,
                        kind: "info",
                        text: `Сьогодні завантаження: угода <b>№ ${esc(d.number)}</b>${d.client ? ` · ${esc(d.client)}` : ""}. Перевірте, чи авто на місці.`,
                        action: { label: "Угода", href: `deals.html?open=${d.id}` },
                        weight: 2,
                    });
                }
                if (late.length) {
                    tips.push({
                        id: `late-${today}-${late.length}`,
                        kind: "warn",
                        text: `${late.length} ${plural(late.length, "угода", "угоди", "угод")} з простроченим завантаженням (дата минула, а завантаження не відмічене). Перша — <b>№ ${esc(late[0].number)}</b>.`,
                        action: { label: "Відкрити", href: `deals.html?open=${late[0].id}` },
                        weight: 3,
                    });
                }
            } catch (_) {}
        }

        // 4. Перевізник не відповів на запит ставки
        try {
            const { data, error } = await client
                .from("carrier_bids")
                .select("id, request_id, carrier_name, status, created_at, created_by")
                .eq("status", "asked")
                .eq("created_by", me.id)
                .limit(50);
            if (!error) {
                for (const b of (data || []).filter((x) => (Date.now() - new Date(x.created_at).getTime()) / 60000 > BID_WAIT_MIN).slice(0, 3)) {
                    tips.push({
                        id: `bid-${b.id}`,
                        kind: "info",
                        text: `<b>${esc(b.carrier_name)}</b> ще не дав ставку (${ago(b.created_at)}). Нагадати йому у Viber?`,
                        action: { label: "До запиту", href: `requests.html?open=${b.request_id}` },
                        weight: 1,
                    });
                }
            }
        } catch (_) {}

        return tips.sort((a, b) => b.weight - a.weight);
    }

    /* ---------------- Персонаж ---------------- */

    const FURIK_SVG = `
    <svg viewBox="0 0 96 72" width="72" height="54" aria-hidden="true" class="fk-svg">
        <g class="fk-body">
            <rect x="4" y="14" width="52" height="36" rx="6" fill="#13203f"/>
            <text x="30" y="37" text-anchor="middle" font-size="11" font-weight="800" fill="#ffffff" font-family="Inter, sans-serif" letter-spacing="0.5">FURA</text>
            <path d="M58 22h18a5 5 0 0 1 4.2 2.3l8 12.4a5 5 0 0 1 .8 2.7V50H58z" fill="#f57c00"/>
            <path d="M62 26h13l6.5 10H62z" fill="#ffe2bf"/>
            <g class="fk-eyes">
                <ellipse cx="68" cy="31" rx="3.2" ry="3.6" fill="#ffffff"/>
                <ellipse cx="77" cy="31" rx="3.2" ry="3.6" fill="#ffffff"/>
                <circle class="fk-pupil" cx="69" cy="31.5" r="1.7" fill="#13203f"/>
                <circle class="fk-pupil" cx="78" cy="31.5" r="1.7" fill="#13203f"/>
            </g>
            <path class="fk-smile" d="M68 40q5 4 10 0" stroke="#13203f" stroke-width="2" fill="none" stroke-linecap="round"/>
            <path class="fk-zz" d="M84 10h6l-6 6h6" stroke="#6b7280" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <g class="fk-wheel"><circle cx="20" cy="54" r="7" fill="#13203f"/><circle cx="20" cy="54" r="2.5" fill="#f57c00"/></g>
        <g class="fk-wheel"><circle cx="42" cy="54" r="7" fill="#13203f"/><circle cx="42" cy="54" r="2.5" fill="#f57c00"/></g>
        <g class="fk-wheel"><circle cx="76" cy="54" r="7" fill="#13203f"/><circle cx="76" cy="54" r="2.5" fill="#f57c00"/></g>
    </svg>`;

    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "furik.css?v=202610200030";
    document.head.appendChild(css);

    const root = document.createElement("div");
    root.className = "fk";
    root.innerHTML = `
        <div class="fk-bubble" role="dialog" aria-label="Фурик: нагадування" hidden>
            <div class="fk-bubble-head">
                <b>Фурик</b>
                <button type="button" class="fk-x" data-fk="close" aria-label="Закрити">×</button>
            </div>
            <div class="fk-tips" aria-live="polite"></div>
            <div class="fk-foot">
                <button type="button" class="fk-link" data-fk="helper">Знайти перевізника</button>
                <button type="button" class="fk-link" data-fk="off">Вимкнути до завтра</button>
            </div>
        </div>
        <button type="button" class="fk-me sleepy" aria-label="Фурик — нагадування" title="Фурик">
            ${FURIK_SVG}
            <span class="fk-badge" hidden>0</span>
        </button>`;
    document.body.appendChild(root);

    const bubble = root.querySelector(".fk-bubble");
    const list = root.querySelector(".fk-tips");
    const meBtn = root.querySelector(".fk-me");
    const badge = root.querySelector(".fk-badge");
    let tips = [];
    let autoHide = null;

    function visibleTips() {
        return tips.filter((t) => !hiddenToday(t.id));
    }

    function draw() {
        const v = visibleTips();
        const todo = v.filter((t) => t.kind !== "calm").length; // привітання не рахуємо
        badge.hidden = !todo;
        badge.textContent = String(todo);
        meBtn.classList.toggle("sleepy", !v.length);
        meBtn.classList.toggle("alert", v.some((t) => t.kind === "warn"));
        meBtn.setAttribute("aria-label", v.length ? `Фурик: ${v.length} нагадувань` : "Фурик: нагадувань немає");
        list.innerHTML = v.length
            ? v
                  .map(
                      (t) => `
                <div class="fk-tip ${t.kind}" data-id="${esc(t.id)}">
                    <p>${t.text}</p>
                    <div class="fk-tip-actions">
                        ${t.action ? `<a class="fk-act" href="${esc(t.action.href)}">${esc(t.action.label)}</a>` : ""}
                        <button type="button" class="fk-later" data-hide="${esc(t.id)}">Сховати</button>
                    </div>
                </div>`,
                  )
                  .join("")
            : `<div class="fk-tip calm"><p>Все спокійно${me?.firstName ? `, ${esc(me.firstName)}` : ""}! Термінових справ немає. Якщо треба знайти перевізника — натисніть нижче.</p></div>`;
    }

    function openBubble(auto) {
        draw();
        bubble.hidden = false;
        meBtn.setAttribute("aria-expanded", "true");
        clearTimeout(autoHide);
        if (auto) autoHide = setTimeout(closeBubble, 15000);
    }
    function closeBubble() {
        bubble.hidden = true;
        meBtn.setAttribute("aria-expanded", "false");
        clearTimeout(autoHide);
    }

    function hop() {
        meBtn.classList.remove("hop");
        void meBtn.offsetWidth; // перезапуск анімації
        meBtn.classList.add("hop");
    }

    meBtn.addEventListener("click", () => (bubble.hidden ? openBubble(false) : closeBubble()));
    bubble.addEventListener("mouseenter", () => clearTimeout(autoHide));
    root.addEventListener("click", (e) => {
        const act = e.target.closest("[data-fk]")?.dataset.fk;
        if (act === "close") closeBubble();
        if (act === "off") {
            store.set(K_OFF, todayIso());
            closeBubble();
            root.hidden = true;
        }
        if (act === "helper") {
            closeBubble();
            window.furaHelper?.open();
        }
        const hide = e.target.closest("[data-hide]")?.dataset.hide;
        if (hide) {
            hideTip(hide);
            draw();
            if (!visibleTips().length) setTimeout(closeBubble, 1200);
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !bubble.hidden) closeBubble();
    });

    /* ---------------- Цикл ---------------- */

    async function tick(first) {
        if (isOffToday()) {
            root.hidden = true;
            return;
        }
        root.hidden = false;
        if (!(await whoAmI())) {
            root.hidden = true;
            return;
        }
        tips = await collectTips();

        // Вранці (один раз на день) — зведення
        const h = new Date().getHours();
        if (first && h >= 6 && store.get(K_MORNING, "") !== todayIso()) {
            store.set(K_MORNING, todayIso());
            const v = visibleTips();
            const hello = h < 12 ? "Доброго ранку" : h < 18 ? "Добрий день" : "Добрий вечір";
            tips.unshift({
                id: `morning-${todayIso()}`,
                kind: "calm",
                text: `${hello}${me.firstName ? `, <b>${esc(me.firstName)}</b>` : ""}! ${v.length ? `На сьогодні в мене ${v.length} ${plural(v.length, "нагадування", "нагадування", "нагадувань")} — нижче.` : "Термінових справ поки немає. Гарного дня!"}`,
                weight: 9,
            });
        }

        draw();
        const fresh = visibleTips().filter((t) => !seenThisSession.has(t.id));
        fresh.forEach((t) => seenThisSession.add(t.id));
        if (fresh.length) {
            hop();
            // Самі відкриваємо пузир лише при першому завантаженні сторінки або при новій важливій справі
            if (first || fresh.some((t) => t.kind === "warn")) openBubble(true);
        }
    }

    // Даємо сторінці спершу завантажитися
    setTimeout(() => tick(true), 2500);
    setInterval(() => tick(false), POLL_MS);

    window.furaFurik = {
        show: () => openBubble(false),
        refresh: () => tick(false),
        enable: () => {
            store.set(K_OFF, "");
            tick(false);
        },
    };
})();
