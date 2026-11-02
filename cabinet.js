/* ================================================================= *
 * FURA — КАБІНЕТ КЛІЄНТА І ПЕРЕВІЗНИКА (cabinet.html)                 *
 * Сторінка не читає базу напряму: усе через функцію fura-portal,      *
 * яка віддає лише дозволені поля.                                      *
 * ================================================================= */
(function () {
    const FN_URL = "https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-portal";
    const ANON =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";
    const TOKEN_KEY = "fura_cabinet_token";
    const TAB_KEY = "fura_cabinet_tab";

    const tg = window.Telegram?.WebApp;
    const inTelegram = !!tg?.initData;
    if (inTelegram) {
        tg.ready();
        tg.expand();
        document.documentElement.classList.add("cb-in-tg");
    }

    const app = document.getElementById("app");
    const $ = (id) => document.getElementById(id);
    const e = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);

    const store = {
        get(k) {
            try {
                return localStorage.getItem(k);
            } catch {
                return null;
            }
        },
        set(k, v) {
            try {
                v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
            } catch {
                /* приватний режим — працюємо без запам'ятовування */
            }
        },
    };
    let token = store.get(TOKEN_KEY);
    let state = null; // відповідь home
    let tab = store.get(TAB_KEY) || "";
    let dealFilter = "active";

    /* ---------------- API ---------------- */

    async function api(action, data = {}) {
        const res = await fetch(FN_URL, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                apikey: ANON,
                authorization: `Bearer ${ANON}`,
                ...(token ? { "x-portal-token": token } : {}),
            },
            body: JSON.stringify({ action, ...data }),
        });
        let json = {};
        try {
            json = await res.json();
        } catch {
            /* порожня відповідь */
        }
        if (res.status === 401 && token) {
            setToken(null);
            renderLogin(json.error);
            throw new Error(json.error || "Увійдіть ще раз.");
        }
        if (!res.ok) throw new Error(json.error || "Сервер недоступний. Спробуйте пізніше.");
        return json;
    }
    function setToken(t) {
        token = t;
        store.set(TOKEN_KEY, t);
    }

    function toast(text, bad = false) {
        const t = $("cbToast");
        t.textContent = text;
        t.classList.toggle("bad", bad);
        t.hidden = false;
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => (t.hidden = true), 3500);
    }

    /* ---------------- Формат ---------------- */

    const fmtDate = (v) => {
        if (!v) return "";
        const [y, m, d] = String(v).slice(0, 10).split("-");
        return `${d}.${m}.${y}`;
    };
    const fmtDT = (v) => {
        if (!v) return "";
        const d = new Date(v);
        return d.toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    };
    const money = (amount, cur) =>
        `${Number(amount).toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ${e(cur || "")}`;
    const cap = (s) => String(s || "").toLowerCase().replace(/(^|[\s-])(\S)/g, (m, a, b) => a + b.toUpperCase());
    const period = (a, b) => (a && b && a !== b ? `${fmtDate(a)} – ${fmtDate(b)}` : fmtDate(a || b));
    const country = (c) => (c ? cap(c) : "");
    function place(addr, ctry) {
        return [addr, country(ctry)].filter(Boolean).map(e).join(", ") || "—";
    }
    function customsLine(r) {
        const ex = r.customs_export ? (r.customs_export === "По місцю" ? "по місцю завантаження" : [r.customs_export, country(r.customs_export_country)].filter(Boolean).join(", ")) : "";
        const im = r.customs_import ? (r.customs_import === "По місцю" ? "по місцю розвантаження" : [r.customs_import, country(r.customs_import_country)].filter(Boolean).join(", ")) : "";
        const parts = [];
        if (ex) parts.push(`<span><i class="bx bx-export"></i> Замитнення: ${e(ex)}</span>`);
        if (r.border_crossing) parts.push(`<span><i class="bx bx-transfer-alt"></i> Кордон: ${e(r.border_crossing)}</span>`);
        if (im) parts.push(`<span><i class="bx bx-import"></i> Розмитнення: ${e(im)}</span>`);
        return parts.length ? `<div class="cb-meta">${parts.join("")}</div>` : "";
    }
    const phoneLink = (p) => {
        const first = String(p || "").split(/[,;]/)[0].trim();
        const d = first.replace(/\D/g, "");
        return d ? `<a href="tel:+${e(d)}">+${e(d)}</a>` : "";
    };

    /* ---------------- Вхід ---------------- */

    async function boot() {
        const hash = new URLSearchParams(location.hash.slice(1));
        const invite = hash.get("invite");
        try {
            if (invite) {
                history.replaceState(null, "", location.pathname);
                app.innerHTML = loading("Вхід за посиланням…");
                const r = await api("login_invite", { token: invite });
                setToken(r.token);
            } else if (!token && inTelegram) {
                app.innerHTML = loading("Вхід через Telegram…");
                const r = await api("login_tg", { initData: tg.initData });
                setToken(r.token);
            }
        } catch (err) {
            return renderLogin(err.message);
        }
        if (!token) return renderLogin();
        await load();
    }

    const loading = (t = "Завантаження…") => `<div class="cb-loading"><i class="bx bx-loader-alt bx-spin"></i> ${e(t)}</div>`;

    async function renderLogin(message) {
        $("cbTop").hidden = true;
        app.innerHTML = `
            <section class="cb-login">
                <img src="company-logo.svg" alt="Грандар" class="cb-login-logo" />
                <h1>Кабінет Грандар</h1>
                <p class="cb-muted">Для клієнтів і перевізників: запити, ставки, перевезення та їх статус.</p>
                ${message ? `<div class="cb-alert">${e(message)}</div>` : ""}
                <div id="cbLoginWays">${loading()}</div>
            </section>`;
        let cfg = {};
        try {
            cfg = await api("config");
        } catch {
            /* без налаштувань — показуємо базові способи */
        }
        const ways = [];
        if (cfg.email_login) {
            ways.push(`
                <form class="cb-card cb-login-form" id="cbEmailForm">
                    <label class="cb-label">Вхід за e-mail</label>
                    <input type="email" class="cb-in" id="cbEmail" placeholder="you@company.com" autocomplete="email" required />
                    <div id="cbCodeBox" hidden>
                        <label class="cb-label">Код з листа</label>
                        <input type="text" class="cb-in" id="cbCode" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code" />
                    </div>
                    <button type="submit" class="cb-btn cb-btn-primary" id="cbEmailBtn">Надіслати код</button>
                </form>`);
        }
        if (cfg.bot && !inTelegram) {
            ways.push(`
                <a class="cb-btn cb-btn-tg" href="https://t.me/${e(cfg.bot)}?start=cabinet" target="_blank" rel="noopener">
                    <i class="bx bxl-telegram"></i> Увійти через Telegram</a>
                <p class="cb-hint">Для перевізників, підключених до бота Грандар: бот надішле кнопку «Відкрити кабінет».</p>`);
        }
        if (inTelegram) {
            ways.unshift(`<button type="button" class="cb-btn cb-btn-tg" id="cbTgLogin"><i class="bx bxl-telegram"></i> Увійти через Telegram</button>`);
        }
        ways.push(`<p class="cb-hint">Немає доступу? Попросіть вашого менеджера Грандар надіслати посилання для входу.</p>`);
        $("cbLoginWays").innerHTML = ways.join("");

        $("cbTgLogin")?.addEventListener("click", async () => {
            try {
                const r = await api("login_tg", { initData: tg.initData });
                setToken(r.token);
                await load();
            } catch (err) {
                toast(err.message, true);
            }
        });
        const form = $("cbEmailForm");
        if (!form) return;
        let codeSent = false;
        form.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const btn = $("cbEmailBtn");
            btn.disabled = true;
            try {
                if (!codeSent) {
                    const r = await api("email_code", { email: $("cbEmail").value });
                    codeSent = true;
                    $("cbCodeBox").hidden = false;
                    $("cbCode").focus();
                    btn.textContent = "Увійти";
                    toast(r.message || "Код надіслано");
                } else {
                    const r = await api("email_verify", { email: $("cbEmail").value, code: $("cbCode").value });
                    setToken(r.token);
                    await load();
                }
            } catch (err) {
                toast(err.message, true);
            } finally {
                btn.disabled = false;
            }
        });
    }

    $("cbLogout").addEventListener("click", async () => {
        if (!confirm("Вийти з кабінету?")) return;
        try {
            await api("logout");
        } catch {
            /* все одно виходимо */
        }
        setToken(null);
        if (inTelegram) tg.close();
        renderLogin();
    });

    /* ---------------- Головна ---------------- */

    async function load(silent = false) {
        if (!silent) app.innerHTML = loading();
        try {
            state = await api("home");
        } catch (err) {
            if (token) app.innerHTML = `<div class="cb-alert">${e(err.message)}</div><button class="cb-btn" onclick="location.reload()">Спробувати ще</button>`;
            return;
        }
        const a = state.account;
        $("cbTop").hidden = false;
        $("cbCompany").textContent = a.company;
        $("cbRole").textContent = a.kind === "client" ? `Кабінет клієнта${a.name ? " · " + a.name : ""}` : "Кабінет перевізника";
        if (a.kind === "client") {
            if (!["deals", "requests"].includes(tab)) tab = state.requests.some((r) => r.status.key === "offer") ? "requests" : "deals";
            renderClient();
        } else {
            if (!["offers", "deals"].includes(tab)) tab = state.offers.some((o) => o.status === "asked" && !o.closed) ? "offers" : "deals";
            renderCarrier();
        }
    }

    function tabsHtml(list) {
        return `<nav class="cb-tabs">${list
            .map((t) => `<button type="button" class="cb-tab ${t.key === tab ? "active" : ""}" data-tab="${t.key}">${t.label}${t.count ? ` <span class="cb-count">${t.count}</span>` : ""}</button>`)
            .join("")}</nav>`;
    }
    function bindTabs(rerender) {
        app.querySelectorAll("[data-tab]").forEach((b) =>
            b.addEventListener("click", () => {
                tab = b.dataset.tab;
                store.set(TAB_KEY, tab);
                rerender();
                window.scrollTo(0, 0);
            }),
        );
    }

    /* ---------------- Перевезення (спільне) ---------------- */

    const STEPS = ["Заплановано", "Завантаження", "В дорозі", "Кордон", "Розвантаження", "Доставлено"];

    function dealCard(d, kind) {
        const step = d.stage.step || 1;
        const sum = (d.sum || []).map((s) => money(s.amount, s.currency)).join(" + ");
        const steps = STEPS.map((s, i) => `<li class="${i + 1 < step ? "done" : i + 1 === step ? "now" : ""}"><span></span><em>${s}</em></li>`).join("");
        return `
            <article class="cb-card cb-deal" data-deal="${e(d.id)}">
                <div class="cb-card-head">
                    <span class="cb-no">№ ${e(d.number)}</span>
                    <span class="cb-chip cb-st-${e(d.stage.key)}">${e(d.stage.label)}</span>
                </div>
                <div class="cb-route">
                    <div><i class="bx bx-radio-circle-marked cb-from"></i> ${place(d.route.load_address, d.route.load_country)}</div>
                    <div><i class="bx bx-map cb-to"></i> ${place(d.route.unload_address, d.route.unload_country)}</div>
                </div>
                <ol class="cb-steps">${steps}</ol>
                ${d.queue ? `<div class="cb-queue"><i class="bx bx-time-five"></i> У черзі на кордоні: <b>${e(d.queue.checkpoint)}</b>${d.queue.queue_no ? ` · № ${e(d.queue.queue_no)}` : ""}${d.queue.since ? ` · з ${e(d.queue.since)}` : ""}</div>` : ""}
                <div class="cb-grid">
                    <div><label>Завантаження</label>${d.load_date ? `<b>${fmtDate(d.load_date)}</b>` : d.load_date_plan ? `план ${fmtDate(d.load_date_plan)}` : "—"}</div>
                    <div><label>Розвантаження</label>${d.unload_date ? `<b>${fmtDate(d.unload_date)}</b>` : d.unload_date_plan ? `план ${fmtDate(d.unload_date_plan)}` : "—"}</div>
                    ${d.cargo ? `<div><label>Вантаж</label>${e(d.cargo)}</div>` : ""}
                    ${d.trailer_type ? `<div><label>Кузов</label>${e(d.trailer_type)}</div>` : ""}
                    ${d.truck_plate ? `<div><label>Авто</label>${e(d.truck_plate)}${d.trailer_plate ? ` / ${e(d.trailer_plate)}` : ""}</div>` : ""}
                    ${d.driver_name || d.driver_phone ? `<div><label>Водій</label>${e(d.driver_name || "")} ${phoneLink(d.driver_phone)}</div>` : ""}
                    ${sum ? `<div><label>${kind === "client" ? "Вартість" : "Ставка"}</label><b>${sum}</b> <span class="cb-chip ${d.paid ? "cb-paid" : "cb-unpaid"}">${d.paid ? "оплачено" : "очікує оплати"}</span></div>` : ""}
                    ${customsLine(d.route) ? `<div class="cb-wide">${customsLine(d.route)}</div>` : ""}
                </div>
                <div class="cb-card-foot">
                    ${d.manager?.name ? `<span class="cb-muted"><i class="bx bx-user"></i> Логіст Грандар: ${e(d.manager.name)} ${phoneLink(d.manager.phone)}</span>` : "<span></span>"}
                    ${d.has_trip ? `<button type="button" class="cb-link" data-events="${e(d.id)}">Хронологія <i class="bx bx-chevron-down"></i></button>` : ""}
                </div>
                <div class="cb-events" id="ev-${e(d.id)}" hidden></div>
            </article>`;
    }

    function dealsSection(kind) {
        const deals = state.deals || [];
        const active = deals.filter((d) => d.stage.key !== "done");
        const list = dealFilter === "active" ? active : deals.filter((d) => d.stage.key === "done");
        return `
            <div class="cb-seg">
                <button type="button" class="${dealFilter === "active" ? "active" : ""}" data-df="active">Активні (${active.length})</button>
                <button type="button" class="${dealFilter === "done" ? "active" : ""}" data-df="done">Завершені (${deals.length - active.length})</button>
            </div>
            ${list.length ? list.map((d) => dealCard(d, kind)).join("") : `<div class="cb-empty"><i class="bx bx-package"></i><p>${dealFilter === "active" ? "Зараз немає активних перевезень." : "Завершених перевезень ще немає."}</p></div>`}`;
    }
    function bindDeals(rerender) {
        app.querySelectorAll("[data-df]").forEach((b) =>
            b.addEventListener("click", () => {
                dealFilter = b.dataset.df;
                rerender();
            }),
        );
        app.querySelectorAll("[data-events]").forEach((b) =>
            b.addEventListener("click", async () => {
                const box = $(`ev-${b.dataset.events}`);
                if (!box.hidden) return (box.hidden = true);
                box.hidden = false;
                box.innerHTML = loading();
                try {
                    const r = await api("deal", { id: b.dataset.events });
                    box.innerHTML = r.events.length
                        ? `<ul class="cb-timeline">${r.events.map((x) => `<li><b>${e(x.label)}</b><span>${fmtDT(x.at)}</span></li>`).join("")}</ul>`
                        : `<p class="cb-muted">Подій ще немає.</p>`;
                } catch (err) {
                    box.innerHTML = `<div class="cb-alert">${e(err.message)}</div>`;
                }
            }),
        );
    }

    /* ---------------- Клієнт ---------------- */

    function renderClient() {
        const offers = state.requests.filter((r) => r.status.key === "offer").length;
        const activeDeals = state.deals.filter((d) => d.stage.key !== "done").length;
        app.innerHTML = `
            <div class="cb-hero">
                <button type="button" class="cb-btn cb-btn-primary cb-btn-big" id="cbNewReq"><i class="bx bx-plus"></i> Новий запит на перевезення</button>
            </div>
            ${tabsHtml([
                { key: "deals", label: "Перевезення", count: activeDeals },
                { key: "requests", label: "Запити", count: offers },
            ])}
            <section class="cb-list">${tab === "requests" ? requestsSection() : dealsSection("client")}</section>`;
        bindTabs(renderClient);
        $("cbNewReq").addEventListener("click", () => openRequestForm());
        if (tab === "requests") bindRequests();
        else bindDeals(renderClient);
    }

    function requestCard(r) {
        const o = r.offer;
        const canCancel = ["new", "quote"].includes(r.status.key);
        return `
            <article class="cb-card cb-req" data-req="${e(r.id)}">
                <div class="cb-card-head">
                    <span class="cb-no">${fmtDate(r.created_at)}</span>
                    <span class="cb-chip cb-rs-${e(r.status.key)}">${e(r.status.label)}</span>
                </div>
                <div class="cb-route">
                    <div><i class="bx bx-radio-circle-marked cb-from"></i> ${place(r.route.load_address, r.route.load_country)}</div>
                    <div><i class="bx bx-map cb-to"></i> ${place(r.route.unload_address, r.route.unload_country)}</div>
                </div>
                <div class="cb-grid">
                    ${r.cargo ? `<div><label>Вантаж</label>${e(r.cargo)}${r.weight ? `, ${e(r.weight)}` : ""}</div>` : ""}
                    ${r.transport_type ? `<div><label>Кузов</label>${e(r.transport_type)}${r.trucks_count > 1 ? ` × ${e(r.trucks_count)}` : ""}</div>` : ""}
                    ${r.desired_date ? `<div><label>Дата завантаження</label>${period(r.desired_date, r.desired_date_to)}</div>` : ""}
                </div>
                ${
                    o
                        ? `<div class="cb-offer ${r.status.key === "offer" ? "pending" : ""}">
                            <div><label>Пропозиція Грандар</label><div class="cb-price">${money(o.price, o.currency)}</div>
                            ${o.note ? `<div class="cb-muted">${e(o.note)}</div>` : ""}</div>
                            ${
                                r.status.key === "offer" || r.status.key === "discuss"
                                    ? `<div class="cb-offer-btns">
                                        <button type="button" class="cb-btn cb-btn-ok" data-decide="accepted"><i class="bx bx-check"></i> Погодити</button>
                                        ${r.status.key === "offer" ? `<button type="button" class="cb-btn" data-decide="discuss"><i class="bx bx-message-dots"></i> Обговорити</button>` : ""}
                                       </div>`
                                    : r.decision?.value === "accepted"
                                      ? `<div class="cb-muted"><i class="bx bx-check-circle"></i> Погоджено ${fmtDT(r.decision.at)}</div>`
                                      : ""
                            }
                           </div>`
                        : ""
                }
                <div class="cb-card-foot">
                    <button type="button" class="cb-link" data-repeat><i class="bx bx-copy"></i> Повторити запит</button>
                    ${canCancel ? `<button type="button" class="cb-link cb-danger" data-cancel><i class="bx bx-x"></i> Скасувати</button>` : ""}
                </div>
            </article>`;
    }

    function requestsSection() {
        const list = state.requests || [];
        return list.length
            ? list.map(requestCard).join("")
            : `<div class="cb-empty"><i class="bx bx-paper-plane"></i><p>Запитів ще немає. Створіть перший — менеджер Грандар відповість з ціною.</p></div>`;
    }

    function bindRequests() {
        app.querySelectorAll("[data-req]").forEach((card) => {
            const r = state.requests.find((x) => String(x.id) === card.dataset.req);
            card.querySelectorAll("[data-decide]").forEach((b) =>
                b.addEventListener("click", async () => {
                    const decision = b.dataset.decide;
                    let note = null;
                    if (decision === "discuss") {
                        note = prompt("Що хочете обговорити? (ціна, дата, умови) — менеджер зв'яжеться з вами.");
                        if (note === null) return;
                    } else if (!confirm(`Погодити перевезення за ${r.offer.price} ${r.offer.currency}?`)) return;
                    b.disabled = true;
                    try {
                        const res = await api("request_decide", { id: r.id, decision, note });
                        Object.assign(r, res.request);
                        toast(decision === "accepted" ? "Дякуємо! Менеджер оформлює перевезення." : "Передали менеджеру — він зв'яжеться з вами.");
                        renderClient();
                    } catch (err) {
                        toast(err.message, true);
                        b.disabled = false;
                    }
                }),
            );
            card.querySelector("[data-repeat]")?.addEventListener("click", () => openRequestForm(r));
            card.querySelector("[data-cancel]")?.addEventListener("click", async () => {
                const note = prompt("Скасувати запит? Можете вказати причину (необов'язково):", "");
                if (note === null) return;
                try {
                    const res = await api("request_cancel", { id: r.id, note });
                    if (res.request) Object.assign(r, res.request);
                    toast("Запит скасовано");
                    renderClient();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });
    }

    const COUNTRIES = ["Україна", "Польща", "Німеччина", "Литва", "Латвія", "Естонія", "Чехія", "Словаччина", "Угорщина", "Румунія", "Молдова",
        "Болгарія", "Австрія", "Італія", "Іспанія", "Франція", "Бельгія", "Нідерланди", "Данія", "Фінляндія", "Великобританія", "Туреччина",
        "Грузія", "Вірменія", "Азербайджан", "Словенія"];
    const BODIES = ["ТЕНТ", "РЕФ", "ІЗОТЕРМ", "ЦІЛЬНОМЕТ", "МЕГА", "КОНТЕЙНЕРОВОЗ", "СЦЕПКА", "БУС", "ЦИСТЕРНА", "ЗЕРНОВОЗ", "САМОСКИД", "ПЛАТФОРМА", "ТРАЛ", "АВТОВОЗ"];

    function openRequestForm(src) {
        const r = src || {};
        const rt = r.route || {};
        const today = new Date().toISOString().slice(0, 10);
        const sheet = document.createElement("div");
        sheet.className = "cb-sheet";
        sheet.innerHTML = `
            <form class="cb-sheet-body" id="cbReqForm">
                <div class="cb-sheet-head">
                    <h2>${src ? "Повторити запит" : "Новий запит"}</h2>
                    <button type="button" class="cb-icon-btn" data-close><i class="bx bx-x"></i></button>
                </div>
                <datalist id="cbCountries">${COUNTRIES.map((c) => `<option value="${c}">`).join("")}</datalist>
                <fieldset>
                    <legend><i class="bx bx-radio-circle-marked cb-from"></i> Завантаження</legend>
                    <input class="cb-in" name="load_country" list="cbCountries" placeholder="Країна *" required value="${e(country(rt.load_country))}" />
                    <input class="cb-in" name="load_address" placeholder="Місто, адреса" value="${e(rt.load_address || "")}" />
                    <input class="cb-in" name="customs_export" placeholder="Замитнення (місто / митниця)" value="${e(rt.customs_export || "")}" />
                </fieldset>
                <fieldset>
                    <legend><i class="bx bx-map cb-to"></i> Розвантаження</legend>
                    <input class="cb-in" name="unload_country" list="cbCountries" placeholder="Країна *" required value="${e(country(rt.unload_country))}" />
                    <input class="cb-in" name="unload_address" placeholder="Місто, адреса" value="${e(rt.unload_address || "")}" />
                    <input class="cb-in" name="customs_import" placeholder="Розмитнення (місто / митниця)" value="${e(rt.customs_import || "")}" />
                </fieldset>
                <fieldset>
                    <legend><i class="bx bx-package"></i> Вантаж</legend>
                    <input class="cb-in" name="cargo" placeholder="Що веземо *" required value="${e(r.cargo || "")}" />
                    <div class="cb-row">
                        <label class="cb-mini">Вага, т<input class="cb-in" name="weight" placeholder="20" value="${e(r.weight || "")}" /></label>
                        <label class="cb-mini">Кузов<select class="cb-in" name="transport_type">
                            <option value="">—</option>
                            ${BODIES.map((b) => `<option ${r.transport_type === b ? "selected" : ""}>${b}</option>`).join("")}
                        </select></label>
                        <label class="cb-mini cb-narrow">Машин<input class="cb-in" type="number" name="trucks_count" min="1" max="50" value="${e(r.trucks_count || 1)}" /></label>
                    </div>
                    <div class="cb-row">
                        <label class="cb-mini">Завантаження з *<input class="cb-in" type="date" name="desired_date" required min="${today}" /></label>
                        <label class="cb-mini">по (необов'язково)<input class="cb-in" type="date" name="desired_date_to" min="${today}" /></label>
                    </div>
                    <textarea class="cb-in" name="notes" rows="3" placeholder="Додатково: упаковка, тип завантаження, температура, вимоги…"></textarea>
                </fieldset>
                <button type="submit" class="cb-btn cb-btn-primary cb-btn-big">Надіслати запит</button>
                <p class="cb-hint">Менеджер Грандар прорахує і покаже ціну тут, у вкладці «Запити».</p>
            </form>`;
        document.body.appendChild(sheet);
        document.documentElement.classList.add("cb-lock");
        const close = () => {
            sheet.remove();
            document.documentElement.classList.remove("cb-lock");
        };
        sheet.addEventListener("click", (ev) => {
            if (ev.target === sheet || ev.target.closest("[data-close]")) close();
        });
        sheet.querySelector("form").addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const f = Object.fromEntries(new FormData(ev.target).entries());
            f.load_country = f.load_country.toUpperCase();
            f.unload_country = f.unload_country.toUpperCase();
            const btn = ev.target.querySelector("[type=submit]");
            btn.disabled = true;
            try {
                const res = await api("request_new", { request: f });
                state.requests.unshift(res.request);
                close();
                tab = "requests";
                store.set(TAB_KEY, tab);
                renderClient();
                toast("Запит надіслано! Менеджер уже отримав сповіщення.");
            } catch (err) {
                toast(err.message, true);
                btn.disabled = false;
            }
        });
    }

    /* ---------------- Перевізник ---------------- */

    function renderCarrier() {
        const open = state.offers.filter((o) => o.status === "asked" && !o.closed).length;
        const s = state.stats || {};
        app.innerHTML = `
            <div class="cb-stats">
                <div><b>${s.active || 0}</b><span>активних рейсів</span></div>
                <div><b>${s.trips || 0}</b><span>рейсів з Грандар</span></div>
                <div><b>${s.answered || 0}/${s.asked || 0}</b><span>відповідей на запити</span></div>
            </div>
            ${tabsHtml([
                { key: "offers", label: "Пропозиції", count: open },
                { key: "deals", label: "Мої рейси", count: s.active || 0 },
            ])}
            <section class="cb-list">${tab === "offers" ? offersSection() : dealsSection("carrier")}</section>`;
        bindTabs(renderCarrier);
        if (tab === "offers") bindOffers();
        else bindDeals(renderCarrier);
    }

    function offerStatus(o) {
        if (o.closed && o.status !== "asked") return ["closed", "Рейс закрито"];
        if (o.status === "bid") return ["sent", "Ставку надіслано"];
        if (o.status === "refused") return ["refused", "Ви відмовились"];
        return ["wait", "Чекаємо вашу ставку"];
    }

    function offerCard(o) {
        const q = o.request;
        const [key, label] = offerStatus(o);
        const editable = !o.closed;
        const showForm = editable && o.status === "asked";
        const my = o.my || {};
        return `
            <article class="cb-card cb-offer-card" data-offer="${e(o.id)}">
                <div class="cb-card-head">
                    <span class="cb-no">запит від ${fmtDate(o.asked_at)}</span>
                    <span class="cb-chip cb-os-${key}">${label}</span>
                </div>
                <div class="cb-route cb-route-big">${e(country(q.route.load_country) || "?")} <i class="bx bx-right-arrow-alt"></i> ${e(country(q.route.unload_country) || "?")}</div>
                <div class="cb-grid">
                    ${q.desired_date ? `<div><label>Завантаження</label><b>${period(q.desired_date, q.desired_date_to)}</b></div>` : ""}
                    ${q.transport_type ? `<div><label>Кузов</label>${e(q.transport_type)}${q.trucks_count > 1 ? ` × ${e(q.trucks_count)}` : ""}</div>` : ""}
                    ${q.cargo ? `<div><label>Вантаж</label>${e(q.cargo)}</div>` : ""}
                    ${q.weight ? `<div><label>Вага</label>${e(q.weight)}</div>` : ""}
                    ${q.temp ? `<div><label>Температура</label>${e(q.temp.filter((x) => x != null).join(" … "))} °C</div>` : ""}
                    ${Array.isArray(q.loading_types) && q.loading_types.length ? `<div><label>Завантаження</label>${e(q.loading_types.join(", "))}</div>` : ""}
                    ${customsLine(q.route) ? `<div class="cb-wide">${customsLine(q.route)}</div>` : ""}
                </div>
                ${
                    o.status === "bid"
                        ? `<div class="cb-offer"><div><label>Ваша ставка</label><div class="cb-price">${money(my.price, my.currency)}</div>
                            <div class="cb-muted">${[my.load_date ? `подача ${fmtDate(my.load_date)}` : "", my.truck_plate || "", my.note || ""].filter(Boolean).map(e).join(" · ")}</div></div></div>`
                        : ""
                }
                ${
                    editable
                        ? `<form class="cb-bid" ${showForm ? "" : "hidden"}>
                            <div class="cb-row">
                                <input class="cb-in" name="price" inputmode="decimal" placeholder="Ставка *" value="${e(my.price || "")}" required />
                                <select class="cb-in cb-narrow" name="currency">${["EUR", "USD", "UAH"].map((c) => `<option ${my.currency === c ? "selected" : ""}>${c}</option>`).join("")}</select>
                            </div>
                            <div class="cb-row">
                                <label class="cb-mini">Подача авто<input class="cb-in" type="date" name="load_date" value="${e(my.load_date || q.desired_date || "")}" /></label>
                                <label class="cb-mini">Номер тягача<input class="cb-in" name="truck_plate" placeholder="BC1234AB" value="${e(my.truck_plate || "")}" /></label>
                            </div>
                            <input class="cb-in" name="note" placeholder="Коментар (необов'язково)" value="${e(my.note || "")}" />
                            <div class="cb-offer-btns">
                                <button type="submit" class="cb-btn cb-btn-primary"><i class="bx bx-send"></i> ${o.status === "bid" ? "Оновити ставку" : "Надіслати ставку"}</button>
                                ${o.status !== "refused" ? `<button type="button" class="cb-btn" data-refuse>Не можу</button>` : ""}
                            </div>
                           </form>
                           ${showForm ? "" : `<div class="cb-card-foot"><span></span><button type="button" class="cb-link" data-edit><i class="bx bx-edit"></i> ${o.status === "refused" ? "Все ж дати ставку" : "Змінити ставку"}</button></div>`}`
                        : ""
                }
            </article>`;
    }

    function offersSection() {
        const list = state.offers || [];
        return list.length
            ? list.map(offerCard).join("")
            : `<div class="cb-empty"><i class="bx bx-bell"></i><p>Нових пропозицій поки немає. Щойно логіст Грандар запропонує рейс — він з'явиться тут і прийде в Telegram.</p></div>`;
    }

    function bindOffers() {
        app.querySelectorAll("[data-offer]").forEach((card) => {
            const id = card.dataset.offer;
            const form = card.querySelector("form.cb-bid");
            card.querySelector("[data-edit]")?.addEventListener("click", (ev) => {
                form.hidden = false;
                ev.target.closest(".cb-card-foot").remove();
                form.querySelector("[name=price]").focus();
            });
            if (!form) return;
            const send = async (payload, btn) => {
                btn.disabled = true;
                try {
                    state = { ...state, ...(await api("bid", { id, ...payload })) };
                    toast(payload.refuse ? "Передали логісту, що не можете" : "Ставку надіслано логісту Грандар");
                    renderCarrier();
                } catch (err) {
                    toast(err.message, true);
                    btn.disabled = false;
                }
            };
            form.addEventListener("submit", (ev) => {
                ev.preventDefault();
                send(Object.fromEntries(new FormData(form).entries()), form.querySelector("[type=submit]"));
            });
            form.querySelector("[data-refuse]")?.addEventListener("click", (ev) => {
                const note = prompt("Причина (необов'язково): зайнятий, не той кузов, дата…", "");
                if (note === null) return;
                send({ refuse: true, note }, ev.target);
            });
        });
    }

    // Оновлювати, коли повертаються у вкладку
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && token && state && !document.querySelector(".cb-sheet") && !document.activeElement?.closest?.("form")) load(true);
    });

    boot();
})();
