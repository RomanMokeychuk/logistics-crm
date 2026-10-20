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
        return;
    }

    const MENU = [
        {
            group: "Робота",
            items: [
                { href: "home.html", icon: "bx-home-alt", label: "Головна" },
                { href: "reports.html", icon: "bx-bar-chart-alt-2", label: "Підсумки" },
                { href: "requests.html", icon: "bx-list-ul", label: "Запити" },
                { href: "deals.html", icon: "bx-file", label: "Угоди" },
                { href: "sales-agent.html", icon: "bx-envelope", label: "AI-продажі" },
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
            items: [{ href: "staff.html", icon: "bx-id-card", label: "Співробітники" }],
        },
    ];

    // Логотип FURA (той самий, що logo.svg), але в помаранчевому квадраті
    const LOGO_SVG = `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#f57c00"/>
        <path d="M5 22h6M3 29h8M6 36h5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.6"/>
        <rect x="14" y="16" width="27" height="22" rx="3" fill="#fff"/>
        <path d="M43 22h7.6a2 2 0 0 1 1.6 .8l5.3 7a2 2 0 0 1 .5 1.3V36a2 2 0 0 1-2 2H43z" fill="#fff"/>
        <path d="M46 25.5h4.3l3.6 4.8H46z" fill="#f57c00"/>
        <circle cx="21" cy="41" r="4.6" fill="#f57c00" stroke="#fff" stroke-width="3"/>
        <circle cx="34" cy="41" r="4.6" fill="#f57c00" stroke="#fff" stroke-width="3"/>
        <circle cx="50" cy="41" r="4.6" fill="#f57c00" stroke="#fff" stroke-width="3"/>
        <path d="M12 52h40" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.6"/>
    </svg>`;

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
                    const active = it.href === page;
                    if (active) activeLabel = it.label;
                    if (it.href === "#shlyah") {
                        return `<a href="#" class="fura-nav-item" data-shlyah="1"><i class="bx ${it.icon}"></i><span>${it.label}</span></a>`;
                    }
                    return `<a href="${it.href}" class="fura-nav-item${active ? " active" : ""}"><i class="bx ${it.icon}"></i><span>${it.label}</span></a>`;
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

    async function fillUser() {
        const box = document.getElementById("furaUser");
        if (!box || typeof sbClient === "undefined") return;
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
            const initials = String(name)
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase();
            box.querySelector(".fura-avatar").textContent = initials || "?";
            box.querySelector(".fura-user-name").textContent = name;
            box.querySelector(".fura-user-name").title = name;
            box.querySelector(".fura-user-roles").textContent = roles.map((r) => ROLE_LABELS[r] || r).join(" · ") || "—";
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
        await addScript("helper.js?v=202610192350");
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

    function init() {
        const label = buildSidebar();
        buildTopbar(label);
        setupMobileMenu();
        watchTables();
        fillUser();
        loadAssistant();
        // Один пошук на всю CRM у верхній смузі (global-search.js)
        if (window.top === window.self) {
            addScript("global-search.js?v=202610200010");
            // Фурик — персонаж із нагадуваннями (furik.js)
            addScript("furik.js?v=202610200830");
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
