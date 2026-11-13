/* ================================================================= *
 * FURA — СПІЛЬНА "ОБОЛОНКА" ВСІХ СТОРІНОК                             *
 * • бічне меню з групами (Робота / Довідники / Система)               *
 * • блок користувача внизу меню (ініціали, ім'я, ролі, вихід)          *
 * • верхня смуга: «FURA / Назва сторінки» + сьогоднішня дата           *
 * Меню тепер змінюється ТІЛЬКИ тут — в одному файлі.                   *
 * ================================================================= */

(function () {
    // Не малюємо оболонку, коли сторінка відкрита всередині іншої (вкладка «Трекінг» в угоді)
    if (window.top !== window.self) {
        document.documentElement.classList.add("fura-embed");
        // Картка перевізника у вікні поверх іншої сторінки (carrier-popup.js)
        if (new URLSearchParams(location.search).get("cpop") === "1") {
            document.documentElement.classList.add("fura-cpop");
            const css = document.createElement("link");
            css.rel = "stylesheet";
            css.href = "mobile.css?v=202610200610";
            document.head.appendChild(css);
            // Посилання з картки на інші сторінки CRM відкриваємо в головному вікні, а не всередині картки
            document.addEventListener(
                "click",
                (e) => {
                    const a = e.target.closest && e.target.closest("a[href]");
                    if (!a || (a.target && a.target !== "_self")) return;
                    const href = a.getAttribute("href") || "";
                    if (!href || href.startsWith("#") || /^(tel|mailto|javascript):/i.test(href)) return;
                    const url = new URL(a.href, location.href);
                    if (url.origin !== location.origin) return;
                    e.preventDefault();
                    window.top.location.href = url.href;
                },
                true,
            );
        }
        return;
    }

    /* ---------- Згорнуте бічне меню пам'ятаємо між оновленнями й сторінками ---------- */
    (function rememberSidebar() {
        const KEY = "furaSidebarCollapsed";
        const syncIcon = () => {
            const collapsed = document.body.classList.contains("sidebar-collapsed");
            document.querySelectorAll("#sidebarToggleBtn i, .sidebar-toggle-btn i").forEach((i) => {
                i.classList.toggle("bx-chevron-left", !collapsed);
                i.classList.toggle("bx-chevron-right", collapsed);
            });
        };
        let saved = false;
        try { saved = localStorage.getItem(KEY) === "1"; } catch (e) { /* без збереження */ }
        if (saved) document.body.classList.add("sidebar-collapsed");
        syncIcon();
        // кнопка на кожній сторінці лише перемикає клас — ловимо зміну й запам'ятовуємо
        new MutationObserver(() => {
            const collapsed = document.body.classList.contains("sidebar-collapsed");
            try { localStorage.setItem(KEY, collapsed ? "1" : "0"); } catch (e) { /* без збереження */ }
        }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    })();

    const MENU = [
        {
            group: "Робота",
            items: [
                { href: "home.html", icon: "bx-home-alt", label: "Головна" },
                { href: "reports.html", icon: "bx-bar-chart-alt-2", label: "Підсумки" },
                { href: "rop.html", icon: "bx-crown", label: "РОП", only: ["head", "admin"] },
                { href: "requests.html", icon: "bx-list-ul", label: "Запити" },
                { href: "deals.html", icon: "bx-file", label: "Угоди" },
                { href: "echerha.html", svg: "cherga", label: "Черга" },
                {
                    icon: "bx-line-chart", label: "Ларді", key: "lardi",
                    children: [
                        { href: "lardi.html", icon: "bx-package", label: "Вантажі" },
                        { href: "lardi-trucks.html", icon: "bxs-truck", label: "Авто" },
                    ],
                },
                { href: "sales-agent.html", icon: "bx-envelope", label: "AI-продажі" },
                { href: "comms.html", icon: "bx-chat", label: "Переписка", only: ["head", "admin"] }, // поки канали не підключено — лише керівнику; потім прибрати only
            ],
        },
        {
            group: "Довідники",
            items: [
                { href: "clients.html", icon: "bx-buildings", label: "Клієнти" },
                { href: "leads.html", icon: "bx-briefcase-alt-2", label: "Ліди" },
                { href: "index.html", icon: "bx-group", label: "Перевізники" },
            ],
        },
        {
            group: "Система",
            items: [
                { href: "staff.html", icon: "bx-id-card", label: "Співробітники" },
                { href: "guide.html", icon: "bx-help-circle", label: "Як працювати" },
            ],
        },
    ];

    // Логотип FURA (той самий, що logo.svg), але в помаранчевому квадраті
    const LOGO_SVG = `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true" class="fl-svg">
        <defs>
            <linearGradient id="furaLg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".35" stop-color="#e9c46a"/><stop offset=".7" stop-color="#c9973a"/><stop offset="1" stop-color="#8f6a1f"/></linearGradient>
            <linearGradient id="furaGloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
            <linearGradient id="furaBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5355"/><stop offset="1" stop-color="#2b3133"/></linearGradient>
        </defs>
        <rect width="64" height="64" rx="14" fill="url(#furaLg)"/>
        <rect width="64" height="64" rx="14" fill="url(#furaGloss)"/>
        <g class="fl-speed" fill="none" stroke="#3a4244" stroke-width="3" stroke-linecap="round" opacity="0.7"><path d="M5 22h6"/><path d="M3 29h8"/><path d="M6 36h5"/></g>
        <g class="fl-truck">
            <rect x="14" y="16" width="27" height="22" rx="3" fill="url(#furaBody)"/>
            <rect x="15" y="17" width="25" height="5" rx="2" fill="#fff" opacity=".14"/>
            <path d="M43 22h7.6a2 2 0 0 1 1.6 .8l5.3 7a2 2 0 0 1 .5 1.3V36a2 2 0 0 1-2 2H43z" fill="url(#furaBody)"/>
            <path d="M46 25.5h4.3l3.6 4.8H46z" fill="#f0cd78"/>
        </g>
        <g class="fl-wheel" style="transform-origin:21px 41px"><circle cx="21" cy="41" r="4.6" fill="#e9c46a" stroke="#2b3133" stroke-width="3"/><path d="M21 37.6v6.8M17.6 41h6.8" stroke="#2b3133" stroke-width="1.3"/></g>
        <g class="fl-wheel" style="transform-origin:34px 41px"><circle cx="34" cy="41" r="4.6" fill="#e9c46a" stroke="#2b3133" stroke-width="3"/><path d="M34 37.6v6.8M30.6 41h6.8" stroke="#2b3133" stroke-width="1.3"/></g>
        <g class="fl-wheel" style="transform-origin:50px 41px"><circle cx="50" cy="41" r="4.6" fill="#e9c46a" stroke="#2b3133" stroke-width="3"/><path d="M50 37.6v6.8M46.6 41h6.8" stroke="#2b3133" stroke-width="1.3"/></g>
        <path class="fl-road" d="M10 52h44" stroke="#3a4244" stroke-width="3" stroke-linecap="round" stroke-dasharray="7 5" opacity="0.7"/>
    </svg>`;

    // Своя іконка «Черга»: квадратик з літерою «Ч» (колір — як у тексту пункту меню)
    const ICONS = {
        cherga: `<svg class="fura-nav-svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M8.5 7v4.2a2.6 2.6 0 0 0 2.6 2.6H15.5M15.5 7v10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    };

    const ROLE_LABELS = { admin: "Адмін", head: "Керівник", sales: "Sales", logist: "Логіст" };

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);

    function currentPage() {
        const f = (location.pathname.split("/").pop() || "index.html").toLowerCase();
        return f || "index.html";
    }

    function buildSidebar() {
        const aside = document.querySelector("aside.sidebar");
        if (!aside) return null;
        const page = currentPage();
        let activeLabel = "";
        const groups = MENU.map((g) => {
            const links = g.items
                .map((it) => {
                    // Пункт з підпунктами (напр. «Ларді» → «Вантажі», «Авто»): клік розгортає список
                    if (it.children) {
                        const child = it.children.find((c) => c.href === page);
                        if (child) activeLabel = `${it.label} · ${child.label}`;
                        let open = !!child;
                        try { open = open || localStorage.getItem("fura_nav_open_" + it.key) === "1"; } catch (e) { /* без пам'яті */ }
                        const subs = it.children.map((c) =>
                            `<a href="${c.href}" class="fura-nav-item fura-nav-subitem${c.href === page ? " active" : ""}"><i class="bx ${c.icon}"></i><span>${c.label}</span></a>`).join("");
                        return `<div class="fura-nav-branch${open ? " open" : ""}${child ? " has-active" : ""}" data-branch="${it.key}">
                            <a href="#" class="fura-nav-item fura-nav-parent" data-branch-toggle="${it.key}"><i class="bx ${it.icon}"></i><span>${it.label}</span><i class="bx bx-chevron-down fura-nav-caret"></i></a>
                            <div class="fura-nav-sub">${subs}</div></div>`;
                    }
                    const active = it.href === page;
                    if (active) activeLabel = it.label;
                    if (it.href === "#shlyah") {
                        return `<a href="#" class="fura-nav-item" data-shlyah="1"><i class="bx ${it.icon}"></i><span>${it.label}</span></a>`;
                    }
                    const ico = it.svg ? ICONS[it.svg] : `<i class="bx ${it.icon}"></i>`;
                    // Пункти лише для певних ролей — сховані, доки fillUser() не дізнається ролі
                    const only = it.only ? ` data-only="${it.only.join(",")}" hidden` : "";
                    return `<a href="${it.href}" class="fura-nav-item${active ? " active" : ""}"${only}>${ico}<span>${it.label}</span></a>`;
                })
                .join("");
            return `<div class="fura-nav-group"><div class="fura-nav-title">${g.group}</div>${links}</div>`;
        }).join("");

        aside.classList.add("fura-sidebar");
        aside.innerHTML = `
            <a href="home.html" class="fura-brand" title="Головна сторінка">
                <span class="fura-brand-icon">${LOGO_SVG}</span>
                <span class="fura-brand-name">FURA</span>
            </a>
            <nav class="fura-nav">${groups}</nav>
            <div class="fura-user" id="furaUser">
                <span class="fura-avatar">…</span>
                <span class="fura-user-text">
                    <span class="fura-user-name">&nbsp;</span>
                    <span class="fura-user-roles">&nbsp;</span>
                </span>
                <button type="button" class="fura-logout" title="Вийти"><i class="bx bx-log-out"></i></button>
            </div>`;

        aside.querySelectorAll("[data-branch-toggle]").forEach((a) => a.addEventListener("click", (e) => {
            e.preventDefault();
            const br = a.closest(".fura-nav-branch");
            const open = br.classList.toggle("open");
            try { localStorage.setItem("fura_nav_open_" + br.dataset.branch, open ? "1" : "0"); } catch (err) { /* без пам'яті */ }
        }));
        aside.querySelector("[data-shlyah]")?.addEventListener("click", (e) => {
            e.preventDefault();
            if (typeof openShlyahModal === "function") openShlyahModal();
            else window.open("https://shlyah.dsbt.gov.ua/lc.html", "_blank", "noopener");
        });
        aside.querySelector(".fura-logout").addEventListener("click", () => {
            if (typeof logout === "function") logout();
        });
        return activeLabel;
    }

    function buildTopbar(activeLabel) {
        const main = document.querySelector("main.main-content");
        if (!main || main.querySelector(".fura-topbar")) return;
        const bar = document.createElement("div");
        bar.className = "fura-topbar";
        const dateText = new Date().toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" });
        bar.innerHTML = `
            <div class="fura-left">
                <button type="button" class="fura-burger" id="furaBurger" aria-label="Меню"><i class="bx bx-menu"></i></button>
                <div class="fura-nav-arrows">
                    <button type="button" id="furaBack" title="Назад">←</button>
                    <button type="button" id="furaFwd" title="Вперед">→</button>
                </div>
                <div class="fura-crumbs" id="furaCrumbs"></div>
            </div>
            <div class="fura-date"><i class="bx bx-calendar"></i> ${esc(dateText)}</div>`;
        main.prepend(bar);
        // Стрілки «назад / вперед» — як у браузері, тільки всередині CRM
        bar.querySelector("#furaBack").addEventListener("click", () => history.back());
        bar.querySelector("#furaFwd").addEventListener("click", () => history.forward());
        const nav = window.navigation;
        const sync = () => {
            if (!nav || typeof nav.canGoBack !== "boolean") return;
            bar.querySelector("#furaBack").disabled = !nav.canGoBack;
            bar.querySelector("#furaFwd").disabled = !nav.canGoForward;
        };
        sync();
        nav?.addEventListener?.("currententrychange", sync);
        // Сторінка могла вже попросити свої «крихти» (напр. № угоди) раніше, ніж з'явилася смуга
        setCrumbs(pendingCrumbs || [activeLabel || document.title.replace(/^FURA\s*—\s*/, "")]);
    }

    // Сторінки можуть змінити «хлібні крихти»: furaSetCrumbs([{label, href}, "№ 15"])
    let pendingCrumbs = null;
    function setCrumbs(parts) {
        const box = document.getElementById("furaCrumbs");
        if (!box) {
            pendingCrumbs = parts;
            return;
        }
        // Сторінка розділу: «FURA / Угоди»; всередині запису: «Угоди / № 3908»
        const own = parts.map((p) => (typeof p === "string" ? { label: p } : p));
        const list = own.length > 1 ? own : [{ label: "FURA", href: "home.html" }, ...own];
        box.innerHTML = list
            .map((p, i) =>
                i === list.length - 1
                    ? `<b>${esc(p.label)}</b>`
                    : p.href
                      ? `<a href="${esc(p.href)}">${esc(p.label)}</a>`
                      : `<span>${esc(p.label)}</span>`,
            )
            .join(`<span class="fura-sep">/</span>`);
    }
    window.furaSetCrumbs = setCrumbs;

    // Показати користувача й пункти меню одразу з пам'яті вкладки (без «блимання» при переході між сторінками)
    function applyUser(box, name, roles) {
        const initials = String(name || "")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0])
            .join("")
            .toUpperCase();
        box.querySelector(".fura-avatar").textContent = initials || "?";
        box.querySelector(".fura-user-name").textContent = name || "";
        box.querySelector(".fura-user-name").title = name || "";
        box.querySelector(".fura-user-roles").textContent = roles.map((r) => ROLE_LABELS[r] || r).join(" · ") || "—";
        document.querySelectorAll(".fura-nav-item[data-only]").forEach((a) => {
            a.hidden = !a.dataset.only.split(",").some((r) => roles.includes(r));
        });
    }

    async function fillUser() {
        const box = document.getElementById("furaUser");
        if (!box || typeof sbClient === "undefined") return;
        try {
            const c = JSON.parse(sessionStorage.getItem("fura_me") || "null");
            if (c && c.name) applyUser(box, c.name, c.roles || []);
        } catch (e) { /* немає кешу */ }
        try {
            const {
                data: { session },
            } = await sbClient.auth.getSession();
            if (!session) return;
            const email = (session.user?.email || "").toLowerCase();
            const { data } = await sbClient.from("staff").select("full_name, role, roles, email").ilike("email", email).limit(1);
            const me = data?.[0];
            const name = me?.full_name || email;
            const roles = Array.isArray(me?.roles) && me.roles.length ? me.roles : me?.role ? [me.role] : [];
            applyUser(box, name, roles);
            try { sessionStorage.setItem("fura_me", JSON.stringify({ name, roles })); } catch (e) { /* без кешу */ }
        } catch (e) {
            console.warn("FURA shell:", e);
        }
    }

    // AI-помічник — кнопка «Помічник» на кожній сторінці CRM (assistant.js).
    // Потрібен платний ключ ШІ (ANTHROPIC_API_KEY у Supabase). Коли буде — поставте true.
    const ASSISTANT_ENABLED = false;

    function addScript(src) {
        return new Promise((resolve) => {
            const s = document.createElement("script");
            s.src = src;
            s.onload = s.onerror = resolve;
            document.body.appendChild(s);
        });
    }

    // Без ключа — безкоштовний «Помічник»: пошук перевізників звичайними словами (helper.js)
    async function loadAssistant() {
        if (document.querySelector("[data-fura-assistant]")) return;
        const mark = document.createElement("meta");
        mark.dataset.furaAssistant = "1";
        document.head.appendChild(mark);
        if (ASSISTANT_ENABLED) return addScript("assistant.js?v=202610192330");
        if (!window.furaCarrierSearch) await addScript("carrier-search.js?v=202610192350");
        await addScript("helper.js?v=202611131008");
    }

    // Телефон: меню виїжджає зліва по кнопці ☰
    function setupMobileMenu() {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = "mobile.css?v=202610200610";
        document.head.appendChild(css);

        const backdrop = document.createElement("div");
        backdrop.className = "fura-menu-backdrop";
        document.body.appendChild(backdrop);
        const open = (on) => document.body.classList.toggle("fura-menu-open", on);
        document.getElementById("furaBurger")?.addEventListener("click", () => open(true));
        backdrop.addEventListener("click", () => open(false));
        document.querySelector("aside.sidebar")?.addEventListener("click", (e) => {
            if (e.target.closest("a")) open(false);
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") open(false);
        });
    }

    // Телефон: таблиці показуємо картками — кожній клітинці підпис з шапки колонки
    function labelTables() {
        document.querySelectorAll(".table-card table").forEach((table) => {
            const ths = table.querySelectorAll("thead tr:first-child > th");
            if (!ths.length) return;
            const labels = [];
            ths.forEach((th) => {
                const c = th.cloneNode(true);
                c.querySelectorAll(".fura-col-hide, .fura-col-resize, button").forEach((x) => x.remove());
                const t = c.textContent.replace(/[×✕]/g, "").replace(/\s+/g, " ").trim();
                for (let i = 0; i < (th.colSpan || 1); i++) labels.push(t);
            });
            table.querySelectorAll("tbody tr").forEach((tr) => {
                [...tr.children].forEach((td, i) => {
                    if (td.colSpan > 1) {
                        td.classList.add("m-full");
                        return;
                    }
                    const l = labels[i] || "";
                    if (td.dataset.label !== l) td.dataset.label = l;
                    const txt = td.textContent.replace(/\s+/g, " ").trim();
                    const empty = (txt === "" || txt === "—" || txt === "-") && !td.querySelector("img, button, a, input, select, i.bx");
                    td.classList.toggle("m-empty", empty);
                });
            });
        });
    }

    function watchTables() {
        let t = null;
        const run = () => {
            clearTimeout(t);
            t = setTimeout(labelTables, 60);
        };
        new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
        run();
    }

    // Вікна (форми) закриваються кліком по темному фону ТІЛЬКИ якщо і натиснули, і відпустили
    // мишку на фоні. Раніше: виділяєш текст у полі, відпускаєш мишку за межами вікна —
    // і форма закривалась разом з усім введеним.
    let downOnOverlay = null;
    window.addEventListener(
        "pointerdown",
        (e) => {
            downOnOverlay = e.target.classList?.contains("modal-overlay") ? e.target : null;
        },
        true,
    );
    window.addEventListener(
        "click",
        (e) => {
            const t = e.target;
            if (t.classList?.contains("modal-overlay") && downOnOverlay !== t) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
            downOnOverlay = null;
        },
        true,
    );

    // Вхід у CRM не протерміновується «тихо»: коли комп'ютер прокинувся або повернулись на вкладку,
    // одразу оновлюємо пропуск (інакше запити падають з «JWT expired»)
    function keepSessionFresh() {
        const client = () => (typeof sbClient !== "undefined" ? sbClient : null);
        let busy = false;
        const refresh = async () => {
            const c = client();
            if (!c || busy || document.visibilityState === "hidden") return;
            busy = true;
            try {
                const { data } = await c.auth.getSession(); // протермінований — оновить сам
                const exp = data?.session?.expires_at;
                if (exp && exp * 1000 - Date.now() < 5 * 60 * 1000) await c.auth.refreshSession();
            } catch (e) {
                console.warn("FURA session:", e);
            } finally {
                busy = false;
            }
        };
        document.addEventListener("visibilitychange", refresh);
        window.addEventListener("focus", refresh);
        window.addEventListener("online", refresh);
        setInterval(refresh, 4 * 60 * 1000);
    }

    // Годинник комп'ютера відстає/поспішає (неправильний часовий пояс) — тоді вхід «протерміновується»
    // щогодини з «JWT expired». Порівнюємо з часом сервера й попереджаємо.
    async function checkClock() {
        try {
            const t0 = Date.now();
            const res = await fetch(location.href.split("#")[0], { method: "HEAD", cache: "no-store" });
            const server = Date.parse(res.headers.get("date") || "");
            if (!server) return;
            const skew = Math.round((t0 + (Date.now() - t0) / 2 - server) / 60000);
            if (Math.abs(skew) < 3) return;
            const bar = document.createElement("div");
            bar.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483002;background:#b91c1c;color:#fff;padding:10px 16px;border-radius:10px;font:600 14px/1.35 system-ui,sans-serif;max-width:calc(100% - 24px);box-shadow:0 10px 30px rgba(0,0,0,.25)";
            bar.textContent = `⚠ Годинник цього комп'ютера ${skew > 0 ? "поспішає" : "відстає"} на ~${Math.abs(skew)} хв. Через це CRM може «викидати» з помилкою JWT expired. Увімкніть «Встановлювати час автоматично» й часовий пояс (UTC+02:00) Київ.`;
            bar.addEventListener("click", () => bar.remove());
            document.body.appendChild(bar);
        } catch (e) { /* без перевірки */ }
    }

    // Меню зліва пам'ятає, де було прокручене, — при переході на іншу сторінку не стрибає вгору
    function keepSidebarScroll() {
        const nav = document.querySelector(".fura-nav");
        if (!nav) return;
        try { nav.scrollTop = Number(sessionStorage.getItem("fura_nav_scroll") || 0); } catch (e) { /* ні */ }
        addEventListener("pagehide", () => {
            try { sessionStorage.setItem("fura_nav_scroll", String(nav.scrollTop)); } catch (e) { /* ні */ }
            // Готове меню — у пам'ять вкладки: наступна сторінка покаже його миттєво, ще до завантаження решти
            try { sessionStorage.setItem("fura_sb", document.querySelector("aside.sidebar")?.innerHTML || ""); } catch (e) { /* ні */ }
        });
    }

    // Сторінки FURA підвантажуються заздалегідь, коли наводите мишку на пункт меню, — перехід майже миттєвий
    function prefetchPages() {
        if (window.top !== window.self) return;
        if (!(HTMLScriptElement.supports && HTMLScriptElement.supports("speculationrules"))) return;
        const s = document.createElement("script");
        s.type = "speculationrules";
        s.textContent = JSON.stringify({
            prefetch: [{ where: { and: [{ href_matches: "*.html" }, { selector_matches: ".fura-nav-item" }] }, eagerness: "moderate" }],
        });
        document.head.appendChild(s);
    }

    function init() {
        keepSessionFresh();
        checkClock();
        // Клік по назві перевізника будь-де — повна картка у вікні (carrier-popup.js)
        if (!window.furaCarrierPopup) addScript("carrier-popup.js?v=202611131008");
        const label = buildSidebar();
        keepSidebarScroll();
        buildTopbar(label);
        prefetchPages();
        setupMobileMenu();
        watchTables();
        fillUser();
        loadAssistant();
        // Один пошук на всю CRM у верхній смузі (global-search.js)
        if (window.top === window.self) {
            addScript("global-search.js?v=202611131008");
            // Фурик — персонаж із нагадуваннями (furik.js)
            addScript("furik.js?v=202610200830");
            // «Зараз у FURA» — хто з колег онлайн (presence.js)
            addScript("presence.js?v=202610241500");
            // Сповіщення: обрана (★) машина з «Черги» пройшла кордон (watch-notify.js)
            addScript("watch-notify.js?v=202610251500");
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
