/* ================================================================= *
 * FURA — КАБІНЕТ КЛІЄНТА І ПЕРЕВІЗНИКА (cabinet.html)                 *
 * Вигляд як у CRM: меню зліва, розділи, таблиці, картка угоди з        *
 * вкладками. Дані — лише через функцію fura-portal (тільки дозволене). *
 * ================================================================= */
(function () {
    const FN_URL = "https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-portal";
    const ANON =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";
    const TOKEN_KEY = "fura_cabinet_token";

    const tg = window.Telegram?.WebApp;
    const inTelegram = !!tg?.initData;
    if (inTelegram) {
        tg.ready();
        tg.expand();
    }

    const $ = (id) => document.getElementById(id);
    const app = $("app");
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
                /* приватний режим */
            }
        },
    };

    let token = store.get(TOKEN_KEY);
    let state = null;
    let kind = "client";
    let liveTimer = null;
    let map = null;
    const ui = { dealFilter: "active", dealQ: "", reqFilter: "all", reqQ: "", dealTab: "track" };

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
    const fmtDT = (v) => (v ? new Date(v).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
    const money = (amount, cur) => `${Number(amount).toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ${e(cur || "")}`;
    const sumText = (list) => (list || []).map((s) => money(s.amount, s.currency)).join(" + ");
    const cap = (s) => String(s || "").toLowerCase().replace(/(^|[\s-])(\S)/g, (m, a, b) => a + b.toUpperCase());
    const country = (c) => (c ? cap(c) : "");
    const period = (a, b) => (a && b && a !== b ? `${fmtDate(a)} – ${fmtDate(b)}` : fmtDate(a || b));
    const city = (addr, ctry) => e(String(addr || "").split(",")[0].trim() || country(ctry) || "—");
    const place = (addr, ctry) => [addr, country(ctry)].filter(Boolean).map(e).join(", ") || "—";
    const loading = (t = "Завантаження…") => `<div class="cb-loading"><i class="bx bx-loader-alt bx-spin"></i> ${e(t)}</div>`;
    const phoneLink = (p) => {
        const d = String(p || "").split(/[,;]/)[0].replace(/\D/g, "");
        return d ? `<a href="tel:+${e(d)}">+${e(d)}</a>` : "";
    };
    function customsLines(r) {
        const ex = r.customs_export ? (r.customs_export === "По місцю" ? "по місцю завантаження" : [r.customs_export, country(r.customs_export_country)].filter(Boolean).join(", ")) : "";
        const im = r.customs_import ? (r.customs_import === "По місцю" ? "по місцю розвантаження" : [r.customs_import, country(r.customs_import_country)].filter(Boolean).join(", ")) : "";
        return { ex, im, border: r.border_crossing || "" };
    }
    const STEPS = ["Заплановано", "Завантаження", "В дорозі", "Кордон", "Розвантаження", "Доставлено"];
    const stepsHtml = (step) =>
        `<ol class="cb-steps">${STEPS.map((s, i) => `<li class="${i + 1 < step ? "done" : i + 1 === step ? "now" : ""}"><span></span><em>${s}</em></li>`).join("")}</ol>`;
    const miniSteps = (step) => `<div class="cb-mini-steps">${STEPS.map((s, i) => `<span class="${i + 1 < step ? "done" : i + 1 === step ? "now" : ""}" title="${s}"></span>`).join("")}</div>`;
    const stageChip = (st) => `<span class="cb-chip cb-st-${e(st.key)}">${e(st.label)}</span>`;
    const devChip = (dv) =>
        !dv ? `<span class="cb-muted">—</span>` : dv.status === "late" ? `<span class="cb-chip cb-dev-late"><i class="bx bx-error"></i> ${e(dv.text)}</span>` : `<span class="cb-chip cb-dev-ok"><i class="bx bx-check"></i> ${e(dv.text)}</span>`;
    const arrival = (d) =>
        d.unload_date ? `<b>${fmtDate(d.unload_date)}</b><div class="cb-sub">факт</div>` : d.eta_at ? `<b>${fmtDT(d.eta_at)}</b><div class="cb-sub">прогноз</div>` : d.unload_date_plan ? `${fmtDate(d.unload_date_plan)}<div class="cb-sub">план</div>` : "—";
    const ago = (v) => {
        if (!v) return "";
        const m = Math.round((Date.now() - new Date(v).getTime()) / 60000);
        return m < 1 ? "щойно" : m < 60 ? `${m} хв тому` : m < 1440 ? `${Math.floor(m / 60)} год тому` : fmtDT(v);
    };
    // Показувати лише винятки: банер про рейси з відхиленням від графіка
    function lateBanner(list) {
        const late = list.filter((d) => d.stage.key !== "done" && d.deviation?.status === "late");
        if (!late.length) return "";
        return `<div class="cb-banner"><i class="bx bx-error"></i><div><b>${late.length} ${kind === "client" ? (late.length === 1 ? "перевезення йде" : "перевезення йдуть") : late.length === 1 ? "рейс іде" : "рейси йдуть"} з відхиленням від графіка:</b>
            ${late.map((d) => `<a href="#/deal/${e(d.id)}">№ ${e(d.number)} (${e(d.deviation.text)})</a>`).join(", ")}</div><span class="cb-muted">Причина й новий час — у картці</span></div>`;
    }
    const payChip = (paid) => `<span class="cb-chip ${paid ? "cb-paid" : "cb-unpaid"}">${paid ? "оплачено" : "очікує оплати"}</span>`;

    /* ---------------- Вхід ---------------- */

    async function boot() {
        const hash = new URLSearchParams(location.hash.slice(1));
        const invite = hash.get("invite");
        // Посилання з екрана «Хто ви?» (login.html): #role=client|carrier; одразу реєстрація: #join=client|carrier
        const role = hash.get("role") || hash.get("join");
        if (role === "client" || role === "carrier") {
            loginRole = role;
            store.set(ROLE_KEY, role);
            history.replaceState(null, "", location.pathname);
            if (!token && hash.get("join")) return renderRegister(role);
        }
        try {
            if (invite) {
                history.replaceState(null, "", location.pathname);
                $("cbLogin").innerHTML = loading("Вхід за посиланням…");
                setToken((await api("login_invite", { token: invite })).token);
            } else if (!token && inTelegram) {
                $("cbLogin").innerHTML = loading("Вхід через Telegram…");
                setToken((await api("login_tg", { initData: tg.initData })).token);
            }
        } catch (err) {
            return renderLogin(err.message);
        }
        if (!token) return renderLogin();
        await loadHome();
        route();
    }

    const ROLE_KEY = "fura_cabinet_role";
    let loginRole = store.get(ROLE_KEY) || "";
    async function renderLogin(message) {
        clearInterval(liveTimer);
        $("cbShell").hidden = true;
        const box = $("cbLogin");
        box.hidden = false;
        box.innerHTML = `
            <section class="cb-login">
                <img src="company-logo.svg" alt="Грандар" class="cb-login-logo" />
                <h1>${loginRole === "client" ? "Кабінет клієнта" : loginRole === "carrier" ? "Кабінет перевізника" : "Кабінет Грандар"}</h1>
                <p class="cb-muted">${loginRole === "client" ? "Запити, ціни, перевезення, карта з вашим вантажем і документи." : loginRole === "carrier" ? "Пропозиції рейсів, ставки, ваші рейси й оплати." : "Для клієнтів і перевізників: запити, ставки, перевезення, карта і документи."}</p>
                ${message ? `<div class="cb-alert">${e(message)}</div>` : ""}
                <div id="cbLoginWays">${loading()}</div>
            </section>`;
        let cfg = {};
        try {
            cfg = await api("config");
        } catch {
            /* базові способи */
        }
        const ways = [];
        ways.push(`
            <form class="cb-card cb-login-form" id="cbPassForm">
                <label class="cb-label" for="cbLoginIn">Логін</label>
                <input type="text" class="cb-in" id="cbLoginIn" placeholder="e-mail, телефон або логін" autocomplete="username" autocapitalize="off" required />
                <label class="cb-label" for="cbPassIn">Пароль</label>
                <div class="cb-pass"><input type="password" class="cb-in" id="cbPassIn" autocomplete="current-password" required />
                    <button type="button" class="cb-icon-btn" data-eye="cbPassIn" title="Показати пароль"><i class="bx bx-show"></i></button></div>
                <button type="submit" class="cb-btn cb-btn-primary" id="cbPassBtn">Увійти</button>
                <p class="cb-hint cb-hint-left">Забули пароль? Попросіть менеджера Грандар надіслати посилання для входу — після входу задайте новий пароль у «Профіль і пароль».</p>
            </form>
            <div class="cb-reg-cta"><span>Ще немає доступу?</span> <button type="button" class="cb-btn" id="cbRegOpen"><i class="bx bx-user-plus"></i> Зареєструватися</button></div>
            <div class="cb-or"><span>або</span></div>`);
        if (inTelegram) ways.push(`<button type="button" class="cb-btn cb-btn-tg" id="cbTgLogin"><i class="bx bxl-telegram"></i> Увійти через Telegram</button>`);
        if (cfg.email_login) {
            ways.push(`
                <form class="cb-card cb-login-form" id="cbEmailForm">
                    <label class="cb-label">Вхід за e-mail</label>
                    <input type="email" class="cb-in" id="cbEmail" placeholder="you@company.com" autocomplete="email" required />
                    <div id="cbCodeBox" hidden><label class="cb-label">Код з листа</label>
                        <input type="text" class="cb-in" id="cbCode" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code" /></div>
                    <button type="submit" class="cb-btn cb-btn-primary" id="cbEmailBtn">Надіслати код</button>
                </form>`);
        }
        if (cfg.bot && !inTelegram && loginRole !== "client") {
            ways.push(`<a class="cb-btn cb-btn-tg" href="https://t.me/${e(cfg.bot)}?start=cabinet" target="_blank" rel="noopener"><i class="bx bxl-telegram"></i> Увійти через Telegram</a>
                <p class="cb-hint">Для перевізників, підключених до бота Грандар.</p>`);
        }
        $("cbLoginWays").innerHTML = ways.join("");
        bindEyes($("cbLoginWays"));
        $("cbLoginWays").insertAdjacentHTML("beforeend", `<a class="cb-link cb-who-back" href="login.html"><i class="bx bx-left-arrow-alt"></i> ${loginRole ? "Я не " + (loginRole === "client" ? "клієнт" : "перевізник") + " — змінити" : "Я співробітник Грандар — вхід у CRM"}</a>`);
        $("cbRegOpen").addEventListener("click", () => renderRegister(loginRole || "client"));
        $("cbPassForm").addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const btn = $("cbPassBtn");
            btn.disabled = true;
            try {
                setToken((await api("login_password", { login: $("cbLoginIn").value, password: $("cbPassIn").value })).token);
                await loadHome();
                route();
            } catch (err) {
                toast(err.message, true);
            } finally {
                btn.disabled = false;
            }
        });
        $("cbTgLogin")?.addEventListener("click", async () => {
            try {
                setToken((await api("login_tg", { initData: tg.initData })).token);
                await loadHome();
                route();
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
                    setToken((await api("email_verify", { email: $("cbEmail").value, code: $("cbCode").value })).token);
                    await loadHome();
                    route();
                }
            } catch (err) {
                toast(err.message, true);
            } finally {
                btn.disabled = false;
            }
        });
    }

    // Показати / сховати пароль
    function bindEyes(root) {
        root.querySelectorAll("[data-eye]").forEach((b) =>
            b.addEventListener("click", () => {
                const inp = $(b.dataset.eye);
                inp.type = inp.type === "password" ? "text" : "password";
                b.innerHTML = `<i class="bx ${inp.type === "password" ? "bx-show" : "bx-hide"}"></i>`;
            }),
        );
    }

    /* ---------------- Самореєстрація ---------------- */

    function renderRegister(kindPick = "client") {
        $("cbShell").hidden = true;
        const box = $("cbLogin");
        box.hidden = false;
        box.innerHTML = `
            <section class="cb-login cb-reg">
                <img src="company-logo.svg" alt="Грандар" class="cb-login-logo" />
                <h1>Реєстрація в кабінеті Грандар</h1>
                <p class="cb-muted">Заповніть дані — менеджер перевірить компанію (зазвичай протягом робочого дня), і відкриється весь кабінет.</p>
                <form class="cb-card cb-login-form" id="cbRegForm" autocomplete="on">
                    <div class="cb-seg" id="cbRegKind">
                        <button type="button" data-k="client" class="${kindPick === "client" ? "active" : ""}"><i class="bx bx-package"></i> Я клієнт<small>замовляю перевезення</small></button>
                        <button type="button" data-k="carrier" class="${kindPick === "carrier" ? "active" : ""}"><i class="bx bxs-truck"></i> Я перевізник<small>маю машини</small></button>
                    </div>
                    <div class="cb-reg-group">Компанія</div>
                    <label class="cb-label" for="rgCompany">Назва компанії *</label>
                    <input class="cb-in" id="rgCompany" placeholder="ТОВ «Назва» або ФОП Прізвище" autocomplete="organization" required />
                    <label class="cb-label" for="rgEdrpou">ЄДРПОУ (для ФОП — ІПН) *</label>
                    <input class="cb-in" id="rgEdrpou" inputmode="numeric" maxlength="10" placeholder="12345678" required />
                    <label class="cb-label" for="rgCity">Місто</label>
                    <input class="cb-in" id="rgCity" placeholder="Луцьк" />
                    <div class="cb-reg-group">Контактна особа</div>
                    <label class="cb-label" for="rgName">Ваше ім'я *</label>
                    <input class="cb-in" id="rgName" autocomplete="name" required />
                    <label class="cb-label" for="rgPhone">Телефон *</label>
                    <input class="cb-in" id="rgPhone" type="tel" placeholder="+380…" autocomplete="tel" required />
                    <label class="cb-label" for="rgEmail">E-mail</label>
                    <input class="cb-in" id="rgEmail" type="email" placeholder="you@company.com" autocomplete="email" />
                    <div class="cb-reg-group">Вхід у кабінет</div>
                    <label class="cb-label" for="rgLogin">Логін *</label>
                    <input class="cb-in" id="rgLogin" placeholder="e-mail, телефон або слово латиницею" autocomplete="username" autocapitalize="off" required />
                    <label class="cb-label" for="rgPass">Пароль * <span class="cb-muted">(від 8 символів, літери і цифри)</span></label>
                    <div class="cb-pass"><input class="cb-in" id="rgPass" type="password" autocomplete="new-password" minlength="8" required />
                        <button type="button" class="cb-icon-btn" data-eye="rgPass" title="Показати пароль"><i class="bx bx-show"></i></button></div>
                    <label class="cb-label" for="rgPass2">Повторіть пароль *</label>
                    <input class="cb-in" id="rgPass2" type="password" autocomplete="new-password" required />
                    <label class="cb-label" for="rgNote" id="rgNoteLabel">${kindPick === "client" ? "Що зазвичай возите, напрямки" : "Скільки машин, кузов, напрямки"}</label>
                    <textarea class="cb-in" id="rgNote" rows="2"></textarea>
                    <button type="submit" class="cb-btn cb-btn-primary" id="rgBtn">Надіслати заявку</button>
                </form>
                <button type="button" class="cb-link" id="rgBack"><i class="bx bx-left-arrow-alt"></i> У мене вже є доступ — увійти</button>
            </section>`;
        let pick = kindPick;
        bindEyes(box);
        // Логін за замовчуванням — e-mail або телефон
        const autoLogin = () => {
            const l = $("rgLogin");
            if (l.dataset.touched) return;
            l.value = $("rgEmail").value.trim() || $("rgPhone").value.replace(/[^\d+]/g, "");
        };
        $("rgEmail").addEventListener("input", autoLogin);
        $("rgPhone").addEventListener("input", autoLogin);
        $("rgLogin").addEventListener("input", (ev) => (ev.target.dataset.touched = "1"));
        $("rgEdrpou").addEventListener("input", (ev) => (ev.target.value = ev.target.value.replace(/\D/g, "")));
        $("cbRegKind").addEventListener("click", (ev) => {
            const b = ev.target.closest("[data-k]");
            if (!b) return;
            pick = b.dataset.k;
            box.querySelectorAll("#cbRegKind button").forEach((x) => x.classList.toggle("active", x === b));
            $("rgNoteLabel").textContent = pick === "client" ? "Що зазвичай возите, напрямки" : "Скільки машин, кузов, напрямки";
        });
        $("rgBack").addEventListener("click", () => renderLogin());
        $("cbRegForm").addEventListener("submit", async (ev) => {
            ev.preventDefault();
            if ($("rgPass").value !== $("rgPass2").value) return toast("Паролі не збігаються.", true);
            const btn = $("rgBtn");
            btn.disabled = true;
            try {
                const r = await api("register", {
                    kind: pick,
                    company: $("rgCompany").value,
                    edrpou: $("rgEdrpou").value,
                    city: $("rgCity").value,
                    name: $("rgName").value,
                    phone: $("rgPhone").value,
                    email: $("rgEmail").value,
                    login: $("rgLogin").value,
                    password: $("rgPass").value,
                    note: $("rgNote").value,
                });
                setToken(r.token);
                await loadHome();
            } catch (err) {
                toast(err.message, true);
            } finally {
                btn.disabled = false;
            }
        });
    }

    // Заявка ще на перевірці — показуємо статус, без даних
    function renderPending() {
        clearInterval(liveTimer);
        $("cbShell").hidden = true;
        const box = $("cbLogin");
        box.hidden = false;
        const r = state.reg || {};
        const a = state.account;
        box.innerHTML = `
            <section class="cb-login cb-reg">
                <img src="company-logo.svg" alt="Грандар" class="cb-login-logo" />
                <h1>Заявку отримано ✅</h1>
                <div class="cb-card cb-pending">
                    <div class="cb-pending-st"><i class="bx bx-time-five"></i><div><b>На перевірці</b><span>Менеджер Грандар перевіряє компанію — зазвичай протягом робочого дня. Ми можемо зателефонувати вам для уточнення.</span></div></div>
                    <dl class="cb-dl">
                        <dt>Кабінет</dt><dd>${a.kind === "client" ? "Клієнта" : "Перевізника"}</dd>
                        <dt>Компанія</dt><dd>${e(r.company || a.company)}</dd>
                        <dt>ЄДРПОУ</dt><dd>${e(r.edrpou || "—")}</dd>
                        <dt>Контакт</dt><dd>${e([r.name, r.phone, r.email].filter(Boolean).join(" · "))}</dd>
                        <dt>Ваш логін</dt><dd><b>${e(a.login || "—")}</b></dd>
                    </dl>
                    <p class="cb-hint cb-hint-left">Що далі: після підтвердження просто увійдіть зі своїм логіном і паролем — ${a.kind === "client" ? "ви побачите запити, перевезення, карту й чат з менеджером" : "ви почнете отримувати пропозиції рейсів і зможете давати ставки"}.</p>
                    <button type="button" class="cb-btn cb-btn-primary" id="pdCheck"><i class="bx bx-refresh"></i> Перевірити статус</button>
                </div>
                <button type="button" class="cb-link" id="pdOut"><i class="bx bx-log-out"></i> Вийти</button>
            </section>`;
        $("pdCheck").addEventListener("click", async () => {
            try {
                await loadHome();
                if (!state.pending) route();
                else toast("Заявка ще на перевірці.");
            } catch {
                /* повідомлення вже показано */
            }
        });
        $("pdOut").addEventListener("click", async () => {
            try {
                await api("logout");
            } catch {
                /* все одно виходимо */
            }
            setToken(null);
            renderLogin();
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
    $("cbBurger").addEventListener("click", () => $("cbShell").classList.toggle("menu"));
    $("cbDim").addEventListener("click", () => $("cbShell").classList.remove("menu"));

    /* ---------------- Дані й меню ---------------- */

    async function loadHome() {
        try {
            state = await api("home");
        } catch (err) {
            if (token) {
                $("cbLogin").hidden = false;
                $("cbLogin").innerHTML = `<div class="cb-login"><div class="cb-alert">${e(err.message)}</div><button class="cb-btn" onclick="location.reload()">Спробувати ще</button></div>`;
            }
            throw err;
        }
        kind = state.account.kind;
        const a = state.account;
        if (state.pending) return renderPending();
        $("cbLogin").hidden = true;
        $("cbShell").hidden = false;
        $("cbKind").textContent = kind === "client" ? "Кабінет клієнта" : "Кабінет перевізника";
        $("cbCompany").textContent = a.company;
        $("cbName").textContent = a.name || (kind === "client" ? "Клієнт" : "Перевізник");
        $("cbAvatar").textContent = (a.company || "?").replace(/^(ТОВ|ФОП|ПП)\s*[«"]?/i, "").trim().slice(0, 2).toUpperCase() || "?";
        $("cbDate").innerHTML = `<i class="bx bx-calendar"></i> ${new Date().toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" })}`;
        renderNav();
    }

    const activeDeals = () => (state?.deals || []).filter((d) => d.stage.key !== "done");
    function navItems() {
        if (kind === "client") {
            return [
                { title: "Робота" },
                { key: "home", icon: "bx-home-alt", label: "Головна" },
                { key: "requests", icon: "bx-list-ul", label: "Запити", count: state.requests.filter((r) => r.status.key === "offer").length },
                { key: "deals", icon: "bx-file", label: "Перевезення", count: activeDeals().length },
                { key: "map", icon: "bx-map-alt", label: "Карта" },
                { key: "chat", icon: "bx-chat", label: "Чат з менеджером", count: state.unread || 0 },
                { title: "Аналітика" },
                { key: "reports", icon: "bx-bar-chart-alt-2", label: "Підсумки" },
                { title: "Допомога" },
                { key: "help", icon: "bx-help-circle", label: "Як це працює" },
                { key: "profile", icon: "bx-user-circle", label: "Профіль і пароль", count: state.account.has_password ? 0 : "!" },
            ];
        }
        return [
            { title: "Робота" },
            { key: "home", icon: "bx-home-alt", label: "Головна" },
            { key: "offers", icon: "bx-bell", label: "Пропозиції рейсів", count: state.offers.filter((o) => o.status === "asked" && !o.closed).length },
            { key: "deals", icon: "bx-file", label: "Мої рейси", count: activeDeals().length },
            { key: "trucks", icon: "bx-bus", label: "Мої машини", count: (state.trucks || []).filter((t) => t.queue).length },
            { key: "map", icon: "bx-map-alt", label: "Карта" },
            { key: "chat", icon: "bx-chat", label: "Чат з логістом", count: state.unread || 0 },
            { title: "Аналітика" },
            { key: "reports", icon: "bx-trending-up", label: "Моя ефективність" },
            { title: "Допомога" },
            { key: "help", icon: "bx-help-circle", label: "Як це працює" },
            { key: "profile", icon: "bx-user-circle", label: "Профіль і пароль", count: state.account.has_password ? 0 : "!" },
        ];
    }
    function renderNav() {
        const cur = currentRoute().view;
        const sect = { deal: "deals", request: "requests", offer: "offers" }[cur] || cur;
        $("cbNav").innerHTML = navItems()
            .map((n) =>
                n.title
                    ? `<div class="cb-nav-title">${n.title}</div>`
                    : `<a href="#/${n.key}" class="${n.key === sect ? "active" : ""}"><i class="bx ${n.icon}"></i> ${n.label}${n.count ? ` <span class="cb-count">${n.count}</span>` : ""}</a>`,
            )
            .join("");
    }
    function crumbs(parts) {
        $("cbCrumbs").innerHTML = ["Кабінет", ...parts].map((p, i, all) => (i === all.length - 1 ? `<b>${p}</b>` : p)).join(" / ");
    }
    function barAction(label, fn) {
        const b = $("cbBarAction");
        if (!label) return (b.hidden = true);
        b.hidden = false;
        b.innerHTML = label;
        b.onclick = fn;
    }

    /* ---------------- Маршрутизація ---------------- */

    function currentRoute() {
        const [view, id] = location.hash.replace(/^#\/?/, "").split("/");
        return { view: view || "home", id: id ? decodeURIComponent(id) : null };
    }
    function go(path) {
        location.hash = `#/${path}`;
    }
    window.addEventListener("hashchange", () => token && state && route());

    function route() {
        if (!state || state.pending) return;
        clearInterval(liveTimer);
        liveTimer = null;
        if (map) {
            map.remove();
            map = null;
        }
        $("cbShell").classList.remove("menu");
        renderNav();
        barAction(kind === "client" ? `<i class="bx bx-plus"></i> Новий запит` : "", () => openRequestForm());
        const { view, id } = currentRoute();
        window.scrollTo(0, 0);
        const views =
            kind === "client"
                ? { home: clientHomeView, requests: requestsView, request: requestView, deals: dealsView, deal: dealView, map: mapView, chat: chatView, reports: reportsView, help: helpView, profile: profileView }
                : { home: carrierHomeView, offers: offersView, offer: offerView, deals: dealsView, deal: dealView, trucks: trucksView, map: mapView, chat: chatView, reports: reportsView, help: helpView, profile: profileView };
        (views[view] || views.home)(id);
    }

    async function refresh() {
        try {
            await loadHome();
        } catch {
            return;
        }
        route();
    }

    /* ================================================================ */
    /* ПРОФІЛЬ І ПАРОЛЬ                                                 */
    /* ================================================================ */

    function profileView() {
        crumbs(["Профіль і пароль"]);
        const a = state.account;
        app.innerHTML = `
            <h1 class="cb-h1">Профіль і пароль</h1>
            <div class="cb-help-grid">
                <section class="cb-card">
                    <h2 class="cb-h2"><i class="bx bx-buildings"></i> Ваш доступ</h2>
                    <dl class="cb-dl">
                        <dt>Компанія</dt><dd>${e(a.company)}</dd>
                        <dt>Кабінет</dt><dd>${kind === "client" ? "Клієнта" : "Перевізника"}</dd>
                        ${a.name ? `<dt>Ім'я</dt><dd>${e(a.name)}</dd>` : ""}
                        <dt>Логін</dt><dd>${a.login ? `<b>${e(a.login)}</b>` : `<span class="cb-muted">ще не задано</span>`}</dd>
                    </dl>
                    ${a.has_password ? "" : `<div class="cb-banner cb-banner-soft"><i class="bx bx-info-circle"></i><div>Задайте логін і пароль — тоді зможете заходити з будь-якого пристрою без посилання від менеджера.</div></div>`}
                </section>
                <section class="cb-card">
                    <h2 class="cb-h2"><i class="bx bx-lock-alt"></i> ${a.has_password ? "Змінити логін або пароль" : "Задати логін і пароль"}</h2>
                    <form class="cb-login-form" id="pfForm">
                        <label class="cb-label" for="pfLogin">Логін</label>
                        <input class="cb-in" id="pfLogin" value="${e(a.login || "")}" placeholder="e-mail, телефон або слово латиницею" autocomplete="username" autocapitalize="off" required />
                        ${a.has_password ? `<label class="cb-label" for="pfOld">Поточний пароль</label><input class="cb-in" id="pfOld" type="password" autocomplete="current-password" required />` : ""}
                        <label class="cb-label" for="pfNew">Новий пароль <span class="cb-muted">(від 8 символів, літери і цифри)</span></label>
                        <div class="cb-pass"><input class="cb-in" id="pfNew" type="password" autocomplete="new-password" minlength="8" required />
                            <button type="button" class="cb-icon-btn" data-eye="pfNew" title="Показати пароль"><i class="bx bx-show"></i></button></div>
                        <label class="cb-label" for="pfNew2">Повторіть новий пароль</label>
                        <input class="cb-in" id="pfNew2" type="password" autocomplete="new-password" required />
                        <button type="submit" class="cb-btn cb-btn-primary" id="pfBtn">Зберегти</button>
                        <p class="cb-hint cb-hint-left">Після зміни пароля на інших пристроях доведеться увійти заново.</p>
                    </form>
                </section>
            </div>`;
        bindEyes(app);
        $("pfForm").addEventListener("submit", async (ev) => {
            ev.preventDefault();
            if ($("pfNew").value !== $("pfNew2").value) return toast("Паролі не збігаються.", true);
            const btn = $("pfBtn");
            btn.disabled = true;
            try {
                const r = await api("set_password", { login: $("pfLogin").value, old_password: $("pfOld")?.value || "", password: $("pfNew").value });
                state.account.login = r.login;
                state.account.has_password = true;
                toast("Збережено. Тепер можна входити з логіном і паролем.");
                route();
            } catch (err) {
                toast(err.message, true);
            } finally {
                btn.disabled = false;
            }
        });
    }

    /* ================================================================ */
    /* ГОЛОВНА                                                          */
    /* ================================================================ */

    function hello() {
        const h = new Date().getHours();
        return h < 11 ? "Доброго ранку" : h < 18 ? "Добрий день" : "Добрий вечір";
    }
    function heroHtml() {
        const a = state.account;
        return `<div class="cb-hero"><img src="company-logo.svg" alt="" />
            <div><h1 class="cb-h1">${hello()}${a.name ? `, ${e(a.name)}` : ""}!</h1>
            <div class="cb-muted">${e(a.company)} · ${new Date().toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div></div></div>`;
    }
    const qc = (icon, color, title, sub, n, href) =>
        `<button type="button" class="cb-qc" data-go="${href}"><i class="bx ${icon} ${color}"></i><div><b>${title}</b><span>${sub}</span></div>${n ? `<span class="cb-qc-n">${n}</span>` : ""}</button>`;
    // Перший вхід: 3 кроки, як користуватись (можна закрити)
    const WELCOME_KEY = "fura_cabinet_welcome_closed";
    function welcomeHtml() {
        if (store.get(WELCOME_KEY)) return "";
        const s =
            kind === "client"
                ? [
                      ["bx-plus-circle", "Створіть запит", "Кнопка «Новий запит» угорі: звідки, куди, що веземо, коли. Одразу побачите орієнтовну ціну."],
                      ["bx-badge-check", "Погодьте ціну", "Менеджер Грандар прорахує і покаже ціну в «Запитах». Натисніть «Погодити» — і ми беремось до роботи."],
                      ["bx-map-alt", "Стежте за вантажем", "У «Перевезеннях» — етап, карта з машиною, прогноз прибуття, документи. Питання — у «Чат з менеджером»."],
                  ]
                : [
                      ["bx-bell", "Отримайте пропозицію", "Логіст Грандар пропонує рейс — він з'являється в «Пропозиціях рейсів» і приходить у Telegram."],
                      ["bx-send", "Дайте ставку", "Відкрийте пропозицію: сума, дата подачі, номер тягача → «Надіслати ставку». Або «Не можу»."],
                      ["bx-trip", "Виконайте рейс", "Підтверджений рейс — у «Моїх рейсах» з адресами, датами і сумою. Питання — у «Чат з логістом»."],
                  ];
        return `<div class="cb-welcome" id="cbWelcome">
            <div class="cb-welcome-head"><b>👋 Як користуватись кабінетом — 3 кроки</b><button type="button" class="cb-link" id="cbWelcomeClose">Зрозуміло, сховати <i class="bx bx-x"></i></button></div>
            <div class="cb-welcome-steps">${s.map(([i, t, d], n) => `<div><span>${n + 1}</span><i class="bx ${i}"></i><b>${t}</b><p>${d}</p></div>`).join("")}</div>
            <a href="#/help" class="cb-link">Детальніше — «Як це працює» <i class="bx bx-right-arrow-alt"></i></a></div>`;
    }

    function bindGo(root = app) {
        $("cbWelcomeClose")?.addEventListener("click", () => {
            store.set(WELCOME_KEY, "1");
            $("cbWelcome")?.remove();
        });
        root.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => (b.dataset.go === "new" ? openRequestForm() : go(b.dataset.go))));
    }

    function clientHomeView() {
        crumbs(["Головна"]);
        const offers = state.requests.filter((r) => r.status.key === "offer").length;
        const open = state.requests.filter((r) => ["new", "quote", "search", "discuss"].includes(r.status.key)).length;
        const act = activeDeals();
        app.innerHTML = `
            ${heroHtml()}
            ${welcomeHtml()}
            ${lateBanner(act)}
            <h2 class="cb-h2"><i class="bx bxs-zap"></i> Швидкі дії</h2>
            <div class="cb-quick">
                ${qc("bx-plus-circle", "ic-blue", "Новий запит", "Маршрут, вантаж, дата — за хвилину", 0, "new")}
                ${qc("bx-badge-check", "ic-orange", "Пропозиції на погодження", "Ціна Грандар чекає вашої відповіді", offers, "requests")}
                ${qc("bx-time-five", "ic-violet", "Запити в роботі", "Прораховуємо / шукаємо машину", open, "requests")}
                ${qc("bx-trip", "ic-green", "Перевезення в дорозі", "Етап, авто, водій, документи", act.length, "deals")}
                ${qc("bx-map-alt", "ic-teal", "Карта", "Де зараз ваші машини", 0, "map")}
                ${qc("bx-chat", "ic-red", "Чат з менеджером", "Питання по запитах і рейсах", state.unread || 0, "chat")}
            </div>
            <div class="cb-two" style="margin-top:20px">
                <div><h2 class="cb-h2" style="margin-top:0"><i class="bx bx-map-alt"></i> Ваші машини зараз</h2><div class="cb-card" style="padding:8px"><div class="cb-map" id="cbMap"></div></div></div>
                <div><h2 class="cb-h2" style="margin-top:0"><i class="bx bx-trip"></i> Активні перевезення</h2>${dealsList(act.slice(0, 6), true)}</div>
            </div>`;
        bindGo();
        bindDealRows();
        drawFleet(act);
    }

    function carrierHomeView() {
        crumbs(["Головна"]);
        const s = state.stats || {};
        const open = state.offers.filter((o) => o.status === "asked" && !o.closed);
        const act = activeDeals();
        app.innerHTML = `
            ${heroHtml()}
            ${welcomeHtml()}
            ${lateBanner(act)}
            <div class="cb-kpis" style="margin-top:18px">
                <div class="cb-kpi"><label>Нові пропозиції</label><b>${open.length}</b></div>
                <div class="cb-kpi"><label>Активні рейси</label><b>${act.length}</b></div>
                <div class="cb-kpi"><label>Рейсів з Грандар</label><b>${s.trips || 0}</b></div>
                <div class="cb-kpi"><label>Відповідей на запити</label><b>${s.answered || 0} / ${s.asked || 0}</b></div>
            </div>
            <div class="cb-quick">
                ${qc("bx-bell", "ic-orange", "Пропозиції рейсів", "Дайте ставку в два кліки", open.length, "offers")}
                ${qc("bx-trip", "ic-green", "Мої рейси", "Адреси, дати, оплата", act.length, "deals")}
                ${qc("bx-bus", "ic-blue", "Мої машини", "Хто зараз у черзі на кордоні", (state.trucks || []).filter((t) => t.queue).length, "trucks")}
                ${qc("bx-map-alt", "ic-teal", "Карта", "Ваші машини в рейсах", 0, "map")}
                ${qc("bx-chat", "ic-red", "Чат з логістом", "Питання по рейсах і ставках", state.unread || 0, "chat")}
                ${qc("bx-bar-chart-alt-2", "ic-violet", "Підсумки", "Рейси й суми по місяцях", 0, "reports")}
            </div>
            <h2 class="cb-h2"><i class="bx bx-bell"></i> Нові пропозиції рейсів</h2>${offersTable(open.slice(0, 6))}
            <h2 class="cb-h2"><i class="bx bx-trip"></i> Активні рейси</h2>${dealsList(act.slice(0, 6))}`;
        bindGo();
        bindOfferRows();
        bindDealRows();
    }

    /* ================================================================ */
    /* ПЕРЕВЕЗЕННЯ / РЕЙСИ — список                                     */
    /* ================================================================ */

    function dealsList(list, compact = false) {
        if (!list.length) return `<div class="cb-empty"><i class="bx bx-package"></i><p>Перевезень немає.</p></div>`;
        const sumLabel = kind === "client" ? "Вартість" : "Ставка";
        return `<div class="cb-table-wrap"><table class="cb-table">
            <thead><tr><th>№</th><th>Маршрут</th>${compact ? "" : "<th>Вантаж</th><th>Завантаження</th>"}<th>Авто</th><th>Етап</th><th>Прибуття</th><th>Відхилення</th>${compact ? "" : `<th>${sumLabel}</th>`}</tr></thead>
            <tbody>${list
                .map(
                    (d) => `<tr data-deal="${e(d.id)}">
                    <td data-label="№" class="num">№ ${e(d.number)}${d.unread ? ` <span class="cb-count" title="Нові повідомлення">${d.unread}</span>` : ""}</td>
                    <td data-label="Маршрут" class="cb-route-cell"><div><b>${city(d.route.load_address, d.route.load_country)} → ${city(d.route.unload_address, d.route.unload_country)}</b>
                        <span class="cb-sub">${e(country(d.route.load_country))} → ${e(country(d.route.unload_country))}</span></div></td>
                    ${
                        compact
                            ? ""
                            : `<td data-label="Вантаж"><div>${e(d.cargo || "—")}<div class="cb-sub">${e(d.trailer_type || "")}</div></div></td>
                    <td data-label="Завантаження"><div>${d.load_date ? `<b>${fmtDate(d.load_date)}</b>` : d.load_date_plan ? `план ${fmtDate(d.load_date_plan)}` : "—"}</div></td>`
                    }
                    <td data-label="Авто"><div>${e(d.truck_plate || "—")}<div class="cb-sub">${e(d.trailer_plate || "")}</div></div></td>
                    <td data-label="Етап"><div>${stageChip(d.stage)}${miniSteps(d.stage.step)}${d.queue ? `<div class="cb-sub">черга: ${e(d.queue.checkpoint)}</div>` : ""}</div></td>
                    <td data-label="Прибуття"><div>${arrival(d)}</div></td>
                    <td data-label="Відхилення"><div>${devChip(d.deviation)}</div></td>
                    ${compact ? "" : `<td data-label="${sumLabel}"><div><b>${sumText(d.sum) || "—"}</b><div>${d.sum?.length ? payChip(d.paid) : ""}</div></div></td>`}
                </tr>`,
                )
                .join("")}</tbody></table></div>`;
    }
    function bindDealRows(root = app) {
        root.querySelectorAll("[data-deal]").forEach((tr) => tr.addEventListener("click", () => go(`deal/${tr.dataset.deal}`)));
    }

    function dealsView() {
        crumbs([kind === "client" ? "Перевезення" : "Мої рейси"]);
        const all = state.deals || [];
        const draw = () => {
            const q = ui.dealQ.toLowerCase();
            const list = all
                .filter((d) => (ui.dealFilter === "active" ? d.stage.key !== "done" : ui.dealFilter === "done" ? d.stage.key === "done" : true))
                .filter((d) => !q || JSON.stringify([d.number, d.route, d.cargo, d.truck_plate, d.trailer_plate, d.driver_name]).toLowerCase().includes(q));
            $("cbDealsBox").innerHTML = dealsList(list);
            bindDealRows();
        };
        app.innerHTML = `
            <div class="cb-toolbar">
                <div class="cb-search"><i class="bx bx-search"></i><input class="cb-in" id="cbDealQ" placeholder="Пошук: № угоди, місто, номер авто, вантаж…" value="${e(ui.dealQ)}" /></div>
                <div class="cb-seg">
                    ${[["active", `Активні (${activeDeals().length})`], ["done", `Завершені (${all.length - activeDeals().length})`], ["all", `Усі (${all.length})`]]
                        .map(([k, l]) => `<button type="button" class="${ui.dealFilter === k ? "active" : ""}" data-df="${k}">${l}</button>`)
                        .join("")}
                </div>
            </div>
            ${lateBanner(all)}
            <div id="cbDealsBox"></div>`;
        $("cbDealQ").addEventListener("input", (ev) => {
            ui.dealQ = ev.target.value;
            draw();
        });
        app.querySelectorAll("[data-df]").forEach((b) =>
            b.addEventListener("click", () => {
                ui.dealFilter = b.dataset.df;
                app.querySelectorAll("[data-df]").forEach((x) => x.classList.toggle("active", x === b));
                draw();
            }),
        );
        draw();
    }

    /* ================================================================ */
    /* КАРТКА ПЕРЕВЕЗЕННЯ (як у CRM: ліва колонка + вкладки)           */
    /* ================================================================ */

    async function dealView(id) {
        const listName = kind === "client" ? "Перевезення" : "Мої рейси";
        crumbs([`<a href="#/deals">${listName}</a>`, "Картка"]);
        app.innerHTML = loading();
        let r;
        try {
            r = await api("deal_full", { id });
        } catch (err) {
            app.innerHTML = `<div class="cb-alert">${e(err.message)}</div>`;
            return;
        }
        const d = r.deal;
        crumbs([`<a href="#/deals">${listName}</a>`, `№ ${e(d.number)}`]);
        const t = r.trip;
        const c = customsLines(d.route);
        const field = (label, val) => (val ? `<div class="cb-field"><label>${label}</label><div>${val}</div></div>` : "");
        const tabs = [
            ["track", `<i class="bx bx-map-alt"></i> Трекінг`],
            ["docs", `<i class="bx bx-file"></i> Документи${r.docs.length ? ` (${r.docs.length})` : ""}`],
            ["chat", `<i class="bx bx-chat"></i> Переписка${r.messages.length ? ` (${r.messages.length})` : ""}`],
            ["money", `<i class="bx bx-wallet"></i> Розрахунок`],
        ];
        if (!tabs.some(([k]) => k === ui.dealTab)) ui.dealTab = "track";
        app.innerHTML = `
            <div class="cb-dv-head">
                <a class="cb-btn cb-btn-sm" href="#/deals" title="Назад"><i class="bx bx-arrow-back"></i></a>
                <h1>№ ${e(d.number)}</h1>
                ${stageChip(d.stage)}
                ${devChip(d.deviation)}
                <span class="cb-dv-route">${city(d.route.load_address, d.route.load_country)} → ${city(d.route.unload_address, d.route.unload_country)}${d.cargo ? ` · ${e(d.cargo)}` : ""}</span>
                <div class="cb-dv-actions">
                    ${d.manager?.phone ? `<a class="cb-btn cb-btn-sm" href="tel:+${e(String(d.manager.phone).split(/[,;]/)[0].replace(/\D/g, ""))}"><i class="bx bx-phone"></i> Логіст Грандар</a>` : ""}
                    <button type="button" class="cb-btn cb-btn-sm cb-btn-primary" id="cbAsk"><i class="bx bx-chat"></i> Написати</button>
                </div>
            </div>
            ${prognosisHtml(d, t)}
            <div class="cb-dv">
                <aside class="cb-card cb-aside">
                    <div class="cb-sec-title">Маршрут</div>
                    ${field("Завантаження", place(d.route.load_address, d.route.load_country))}
                    ${field("Замитнення", e(c.ex))}
                    ${field("Кордон", e(c.border))}
                    ${field("Розмитнення", e(c.im))}
                    ${field("Розвантаження", place(d.route.unload_address, d.route.unload_country))}
                    <div class="cb-sec-title">Вантаж і дати</div>
                    ${field("Вантаж", e(d.cargo))}
                    ${field("Кузов", e(d.trailer_type))}
                    ${field("Завантаження", d.load_date ? `${fmtDate(d.load_date)} (факт)` : d.load_date_plan ? `план ${fmtDate(d.load_date_plan)}` : "—")}
                    ${field("Розвантаження", d.unload_date ? `${fmtDate(d.unload_date)} (факт)` : d.unload_date_plan ? `план ${fmtDate(d.unload_date_plan)}` : "—")}
                    <div class="cb-sec-title">Авто і водій</div>
                    ${field("Тягач / причіп", d.truck_plate ? `${e(d.truck_plate)}${d.trailer_plate ? ` / ${e(d.trailer_plate)}` : ""}` : "ще не призначено")}
                    ${field("Водій", d.driver_name || d.driver_phone ? `${e(d.driver_name || "")} ${phoneLink(d.driver_phone)}` : "")}
                    <div class="cb-sec-title">Грандар</div>
                    ${field("Логіст", d.manager?.name ? `${e(d.manager.name)} ${phoneLink(d.manager.phone)}` : "—")}
                </aside>
                <div>
                    ${stepsHtml(d.stage.step)}
                    ${d.queue ? `<div class="cb-queue"><i class="bx bx-time-five"></i> У черзі на кордоні: <b>${e(d.queue.checkpoint)}</b>${d.queue.queue_no ? ` · № ${e(d.queue.queue_no)}` : ""}${d.queue.since ? ` · з ${e(d.queue.since)}` : ""}</div>` : ""}
                    <div class="cb-card cb-tabbed">
                        <nav class="cb-tabs">${tabs.map(([k, l]) => `<button type="button" class="cb-tab ${k === ui.dealTab ? "active" : ""}" data-dt="${k}">${l}</button>`).join("")}</nav>
                        <div class="cb-tab-body" id="cbDealTab"></div>
                    </div>
                </div>
            </div>`;
        const show = () => {
            const box = $("cbDealTab");
            if (map) {
                map.remove();
                map = null;
            }
            if (ui.dealTab === "track") {
                box.innerHTML = `<div id="cbEta">${etaHtml(t)}</div><div class="cb-map" id="cbMap"></div>
                    <h3 class="cb-h2" style="font-size:16px"><i class="bx bx-list-check"></i> Етапи рейсу</h3><div id="cbEvents">${t?.stages ? stagesHtml(t.stages) : eventsHtml(r.events)}</div>`;
                if (t && (t.last || t.track.length || t.route.length || t.load || t.unload)) drawTrip(t);
                else $("cbMap").innerHTML = `<div class="cb-map-note">Карта з'явиться, коли водій почне рейс у додатку «FURA Водій».<br/>Поки що етап оновлює логіст.</div>`;
            } else if (ui.dealTab === "docs") {
                box.innerHTML = docsHtml(r.docs);
            } else if (ui.dealTab === "chat") {
                box.innerHTML = `<div id="cbChat"></div>`;
                mountChat($("cbChat"), { deal_id: d.id }, r.messages);
            } else {
                box.innerHTML = `<div class="cb-kpis">
                        <div class="cb-kpi"><label>${kind === "client" ? "До сплати" : "Ставка"}</label><b>${sumText(d.sum) || "—"}</b></div>
                        <div class="cb-kpi"><label>Статус оплати</label><b>${d.sum?.length ? (d.paid ? "Оплачено" : "Очікує оплати") : "—"}</b></div>
                    </div><p class="cb-muted">${kind === "client" ? "Рахунки й акти з'являться тут, коли їх буде завантажено в CRM. З питань оплати — напишіть у «Переписку»." : "Дані про оплату оновлює бухгалтерія Грандар."}</p>`;
            }
        };
        $("cbAsk").addEventListener("click", () => {
            ui.dealTab = "chat";
            app.querySelectorAll("[data-dt]").forEach((x) => x.classList.toggle("active", x.dataset.dt === "chat"));
            show();
            $("cbDealTab").scrollIntoView({ behavior: "smooth" });
            setTimeout(() => $("cbChat")?.querySelector("textarea")?.focus(), 300);
        });
        app.querySelectorAll("[data-dt]").forEach((b) =>
            b.addEventListener("click", () => {
                ui.dealTab = b.dataset.dt;
                app.querySelectorAll("[data-dt]").forEach((x) => x.classList.toggle("active", x === b));
                show();
            }),
        );
        show();
        // Позиція й повідомлення — кожні 30 с
        liveTimer = setInterval(async () => {
            if (document.hidden || currentRoute().view !== "deal") return;
            try {
                const fresh = await api("deal_full", { id });
                r = fresh;
                if ($("cbEta")) $("cbEta").innerHTML = etaHtml(fresh.trip);
                if ($("cbEvents")) $("cbEvents").innerHTML = fresh.trip?.stages ? stagesHtml(fresh.trip.stages) : eventsHtml(fresh.events);
                if ($("cbProg")) $("cbProg").outerHTML = prognosisHtml(fresh.deal, fresh.trip);
                if (fresh.trip && map && ui.dealTab === "track") drawTrip(fresh.trip, true);
                const chat = $("cbChat");
                if (chat?.renderMessages && !chat.querySelector("textarea")?.value) chat.renderMessages(fresh.messages);
            } catch {
                /* наступного разу */
            }
        }, 30000);
    }

    // Шапка картки: прогноз прибуття проти плану, поточний етап, свіжість GPS
    function prognosisHtml(d, t) {
        const dv = d.deviation;
        const late = dv?.status === "late";
        const now = t?.stages?.find((s) => s.state === "now");
        const doneN = t?.stages ? t.stages.filter((s) => s.state === "done").length : d.stage.step - 1;
        const total = t?.stages ? t.stages.length : 6;
        const progress = Array.from({ length: total }, (_, i) => `<span class="${i < doneN ? "done" : i === doneN ? "now" : ""}"></span>`).join("");
        return `<div class="cb-card cb-prog" id="cbProg">
            <div class="cb-prog-main">
                <label>${d.unload_date ? "Доставлено" : "Прогноз прибуття на розвантаження"}</label>
                <div class="cb-prog-big">${d.unload_date ? fmtDate(d.unload_date) : t?.eta_at ? fmtDT(t.eta_at) : d.unload_date_plan ? fmtDate(d.unload_date_plan) : "—"}</div>
                <div class="cb-muted">${t?.unload_planned_at ? `За планом — ${fmtDT(t.unload_planned_at)}` : d.unload_date_plan ? `За планом — ${fmtDate(d.unload_date_plan)}` : "План ще не вказано"}${t?.eta_remaining_km != null && !d.unload_date ? ` · залишилось ≈ ${Math.round(t.eta_remaining_km)} км` : ""}</div>
            </div>
            <div class="cb-prog-mid">
                <div class="cb-prog-row"><span>Пройдено ${Math.min(doneN, total)} з ${total} етапів</span>${dv ? `<span class="${late ? "cb-bad" : "cb-good"}">${late ? `відхилення ${e(dv.text)}` : "без запізнень"}</span>` : ""}</div>
                <div class="cb-prog-bar">${progress}</div>
                <div class="cb-prog-note ${late ? "late" : ""}"><i class="bx ${late ? "bx-error" : "bx-check-circle"}"></i> ${
                    late
                        ? `Рейс іде з відхиленням від графіка (${e(dv.text)}). Логіст Грандар уже в курсі — деталі можна уточнити в переписці.`
                        : dv
                          ? "Усі пройдені етапи вчасно, прогноз прибуття не змінювався."
                          : "Статуси оновлюються автоматично з додатка водія та «Черги»."
                }</div>
            </div>
            <div class="cb-prog-side">
                <label>Поточний етап</label>
                <b>${e(now?.label || d.stage.label)}</b>
                <div class="cb-muted">${e(now?.where || (d.queue ? d.queue.checkpoint : "") || "")}</div>
                ${t?.last ? `<div class="cb-gps"><i class="bx bx-current-location"></i> GPS оновлено ${ago(t.last.at)}</div>` : ""}
                <div class="cb-prog-sum">${kind === "client" ? "Вартість" : "Ставка"}: <b>${sumText(d.sum) || "—"}</b> ${d.sum?.length ? payChip(d.paid) : ""}</div>
            </div>
        </div>`;
    }

    // Етапи з планом і фактом
    function stagesHtml(list) {
        return `<ul class="cb-stages">${list
            .map((s) => {
                const badge = s.late == null ? "" : s.late > 0 ? `<span class="cb-chip cb-dev-late">+${s.late >= 60 ? `${Math.floor(s.late / 60)} год ${s.late % 60} хв` : `${s.late} хв`}</span>` : `<span class="cb-chip cb-dev-ok">вчасно</span>`;
                return `<li class="${s.state}"><span class="dot">${s.state === "done" ? "<i class='bx bx-check'></i>" : ""}</span>
                    <div><b>${e(s.label)}</b> ${s.state === "now" ? `<span class="cb-chip">зараз</span>` : ""} ${badge}
                    ${s.where ? `<div class="cb-sub">${e(s.where)}</div>` : ""}
                    <div class="cb-sub">${s.plan ? `План: ${fmtDT(s.plan)} · ` : ""}${s.fact ? `Факт: <b>${fmtDT(s.fact)}</b>` : s.state === "now" && s.eta ? `Прогноз: ${fmtDT(s.eta)}` : "очікується"}</div></div></li>`;
            })
            .join("")}</ul>`;
    }

    function etaHtml(t) {
        if (!t) return "";
        const parts = [];
        if (t.eta_at) parts.push(`Орієнтовне прибуття: <b>${fmtDT(t.eta_at)}</b>`);
        if (t.eta_remaining_km != null) parts.push(`≈ ${Math.round(t.eta_remaining_km)} км`);
        if (t.eta_delay_min > 10) parts.push(`затримка ${Math.round(t.eta_delay_min)} хв`);
        const last = t.last ? `Остання позиція: ${fmtDT(t.last.at)}${t.last.speed != null ? ` · ${Math.round(t.last.speed)} км/год` : ""}` : "";
        return parts.length || last ? `<div class="cb-eta">${parts.length ? `<div>${parts.join(" · ")}</div>` : ""}${last ? `<div class="cb-muted">${last}</div>` : ""}</div>` : "";
    }
    const eventsHtml = (list) =>
        list && list.length
            ? `<ul class="cb-timeline">${list.map((x) => `<li><b>${e(x.label)}</b><span>${fmtDT(x.at)}</span></li>`).join("")}</ul>`
            : `<p class="cb-muted">Подій ще немає — статуси з'являтимуться тут автоматично.</p>`;
    const docsHtml = (list) =>
        list && list.length
            ? `<div class="cb-docs">${list.map((x) => `<a href="${e(x.url)}" target="_blank" rel="noopener"><img src="${e(x.url)}" alt="${e(x.kind)}" loading="lazy" /><span>${e(x.kind)} · ${fmtDT(x.at)}</span></a>`).join("")}</div>`
            : `<div class="cb-empty"><i class="bx bx-file"></i><p>Документів ще немає. Фото CMR з'явиться після завантаження водієм.</p></div>`;

    /* ================================================================ */
    /* КАРТИ (MapLibre + OpenStreetMap)                                  */
    /* ================================================================ */

    const MAPLIBRE = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl";
    let mapLib = null;
    function loadMapLibre() {
        if (window.maplibregl) return Promise.resolve();
        if (mapLib) return mapLib;
        mapLib = new Promise((resolve, reject) => {
            const css = document.createElement("link");
            css.rel = "stylesheet";
            css.href = MAPLIBRE + ".css";
            document.head.appendChild(css);
            const js = document.createElement("script");
            js.src = MAPLIBRE + ".js";
            js.onload = resolve;
            js.onerror = reject;
            document.head.appendChild(js);
        });
        return mapLib;
    }
    const OSM = {
        version: 8,
        sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap" } },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
    };
    const ll = ([lat, lon]) => [lon, lat];
    let truck = null;

    async function newMap(el, pts) {
        try {
            await loadMapLibre();
        } catch {
            el.innerHTML = `<div class="cb-map-note">Не вдалося завантажити карту.</div>`;
            return null;
        }
        const gl = window.maplibregl;
        if (map) map.remove();
        const opts = { container: el, style: OSM, cooperativeGestures: true, attributionControl: { compact: true } };
        if (pts.length) {
            opts.bounds = pts.reduce((b, c) => b.extend(c), new gl.LngLatBounds(pts[0], pts[0]));
            opts.fitBoundsOptions = { padding: 50, maxZoom: 11 };
        } else {
            opts.center = [24, 50];
            opts.zoom = 4;
        }
        map = new gl.Map(opts);
        map.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new gl.FullscreenControl(), "top-right");
        return gl;
    }
    function pin(gl, p, cls, html, title, onClick) {
        if (!p) return null;
        const d = document.createElement("div");
        d.className = cls;
        d.innerHTML = html;
        d.title = title || "";
        if (onClick) d.addEventListener("click", onClick);
        return new gl.Marker({ element: d }).setLngLat(p).addTo(map);
    }

    async function drawTrip(t, update = false) {
        const el = $("cbMap");
        if (!el) return;
        const route = (t.route || []).map(ll);
        const track = (t.track || []).map(ll);
        if (update && map?.getSource?.("track")) {
            map.getSource("track").setData({ type: "Feature", geometry: { type: "LineString", coordinates: track } });
            if (t.last && truck) truck.setLngLat([t.last.lon, t.last.lat]);
            return;
        }
        const pts = [...route, ...track];
        if (t.load) pts.push(ll(t.load));
        if (t.unload) pts.push(ll(t.unload));
        if (t.last) pts.push([t.last.lon, t.last.lat]);
        const gl = await newMap(el, pts);
        if (!gl) return;
        map.on("load", () => {
            if (route.length > 1) {
                map.addSource("route", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: route } } });
                map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#93c5fd", "line-width": 6, "line-opacity": 0.9 } });
            }
            map.addSource("track", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: track } } });
            map.addLayer({ id: "track", type: "line", source: "track", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#1d5bd8", "line-width": 4 } });
        });
        pin(gl, t.load && ll(t.load), "cb-pin cb-pin-a", "A", "Завантаження");
        pin(gl, t.unload && ll(t.unload), "cb-pin cb-pin-b", "B", "Розвантаження");
        (t.borders || []).forEach((b) => pin(gl, [b.lon, b.lat], "cb-pin cb-pin-border", "<i class='bx bx-shield-quarter'></i>", b.name));
        truck = t.last ? pin(gl, [t.last.lon, t.last.lat], "cb-truck", "<i class='bx bxs-truck'></i>", `Остання позиція: ${fmtDT(t.last.at)}`) : null;
    }

    // Усі активні машини на одній карті
    async function drawFleet(deals) {
        const el = $("cbMap");
        if (!el) return;
        const withPos = deals.filter((d) => d.pos && (d.pos.last || d.pos.load));
        if (!withPos.length) {
            el.innerHTML = `<div class="cb-map-note"><div><i class="bx bx-map-alt" style="font-size:40px;opacity:.4"></i><br/>${
                deals.length ? "Машини з'являться на карті, щойно водії почнуть рейс у додатку «FURA Водій»." : "Зараз немає перевезень у дорозі."
            }</div></div>`;
            return;
        }
        const pts = [];
        withPos.forEach((d) => {
            if (d.pos.last) pts.push([d.pos.last[1], d.pos.last[0]]);
            if (d.pos.load) pts.push(ll(d.pos.load));
            if (d.pos.unload) pts.push(ll(d.pos.unload));
        });
        const gl = await newMap(el, pts);
        if (!gl) return;
        withPos.forEach((d) => {
            const open = () => go(`deal/${d.id}`);
            if (d.pos.last) pin(gl, [d.pos.last[1], d.pos.last[0]], "cb-truck", `<i class='bx bxs-truck'></i><small>№ ${e(d.number)}</small>`, `№ ${d.number} · ${d.truck_plate || ""} · ${d.stage.label} · ${fmtDT(d.pos.last[2])}`, open);
            else pin(gl, ll(d.pos.load), "cb-pin cb-pin-a", "A", `№ ${d.number}: завантаження`, open);
            if (d.pos.unload) pin(gl, ll(d.pos.unload), "cb-pin cb-pin-b", "B", `№ ${d.number}: розвантаження`, open);
        });
    }

    function mapView() {
        crumbs(["Карта"]);
        const act = activeDeals();
        app.innerHTML = `
            <div class="cb-two">
                <div class="cb-card" style="padding:8px"><div class="cb-map cb-map-big" id="cbMap"></div></div>
                <div>
                    <h2 class="cb-h2" style="margin-top:0"><i class="bx bx-trip"></i> У дорозі (${act.length})</h2>
                    <div class="cb-trucks-list">${
                        act.length
                            ? act
                                  .map(
                                      (d) => `<button type="button" data-deal="${e(d.id)}"><b>№ ${e(d.number)}</b> · ${e(d.truck_plate || "авто ще не призначено")} ${stageChip(d.stage)}
                                        <div class="cb-sub">${city(d.route.load_address, d.route.load_country)} → ${city(d.route.unload_address, d.route.unload_country)}${d.pos?.last ? ` · позиція ${fmtDT(d.pos.last[2])}` : ""}${d.pos?.eta_at ? ` · прибуття ≈ ${fmtDT(d.pos.eta_at)}` : ""}</div></button>`,
                                  )
                                  .join("")
                            : `<div class="cb-empty"><p>Активних перевезень немає.</p></div>`
                    }</div>
                </div>
            </div>`;
        bindDealRows();
        drawFleet(act);
    }

    /* ================================================================ */
    /* ЗАПИТИ (клієнт)                                                  */
    /* ================================================================ */

    function requestsView() {
        crumbs(["Запити"]);
        const all = state.requests || [];
        const groups = [
            ["all", `Усі (${all.length})`, () => true],
            ["offer", "Чекають погодження", (r) => r.status.key === "offer"],
            ["work", "В роботі", (r) => ["new", "quote", "search", "discuss"].includes(r.status.key)],
            ["accepted", "Погоджені", (r) => r.status.key === "accepted"],
            ["cancelled", "Скасовані", (r) => r.status.key === "cancelled"],
        ];
        const draw = () => {
            const q = ui.reqQ.toLowerCase();
            const test = groups.find((g) => g[0] === ui.reqFilter)?.[2] || (() => true);
            const list = all.filter(test).filter((r) => !q || JSON.stringify([r.route, r.cargo, r.transport_type]).toLowerCase().includes(q));
            $("cbReqBox").innerHTML = list.length
                ? `<div class="cb-table-wrap"><table class="cb-table">
                    <thead><tr><th>Дата</th><th>Маршрут</th><th>Вантаж</th><th>Завантаження</th><th>Статус</th><th>Ціна Грандар</th></tr></thead>
                    <tbody>${list
                        .map(
                            (r) => `<tr data-req="${e(r.id)}">
                            <td data-label="Дата" class="num">${fmtDate(r.created_at)}${r.unread ? ` <span class="cb-count">${r.unread}</span>` : ""}</td>
                            <td data-label="Маршрут" class="cb-route-cell"><div><b>${city(r.route.load_address, r.route.load_country)} → ${city(r.route.unload_address, r.route.unload_country)}</b>
                                <span class="cb-sub">${e(country(r.route.load_country))} → ${e(country(r.route.unload_country))}</span></div></td>
                            <td data-label="Вантаж"><div>${e(r.cargo || "—")}<div class="cb-sub">${[r.weight, r.transport_type, r.trucks_count > 1 ? `${r.trucks_count} авто` : ""].filter(Boolean).map(e).join(" · ")}</div></div></td>
                            <td data-label="Завантаження"><div>${period(r.desired_date, r.desired_date_to) || "—"}</div></td>
                            <td data-label="Статус"><div><span class="cb-chip cb-rs-${e(r.status.key)}">${e(r.status.label)}</span></div></td>
                            <td data-label="Ціна"><div>${r.offer ? `<b>${money(r.offer.price, r.offer.currency)}</b>` : `<span class="cb-muted">—</span>`}${
                                r.status.key === "offer" ? `<div style="margin-top:6px"><button type="button" class="cb-btn cb-btn-ok cb-btn-sm" data-accept="${e(r.id)}"><i class="bx bx-check"></i> Погодити</button></div>` : ""
                            }</div></td></tr>`,
                        )
                        .join("")}</tbody></table></div>`
                : `<div class="cb-empty"><i class="bx bx-paper-plane"></i><p>${all.length ? "Нічого не знайдено." : "Запитів ще немає. Створіть перший — менеджер Грандар відповість з ціною."}</p></div>`;
            $("cbReqBox").querySelectorAll("[data-req]").forEach((tr) => tr.addEventListener("click", () => go(`request/${tr.dataset.req}`)));
            $("cbReqBox").querySelectorAll("[data-accept]").forEach((b) =>
                b.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    decide(all.find((x) => String(x.id) === b.dataset.accept), "accepted");
                }),
            );
        };
        app.innerHTML = `
            <div class="cb-toolbar">
                <div class="cb-search"><i class="bx bx-search"></i><input class="cb-in" id="cbReqQ" placeholder="Пошук: місто, країна, вантаж…" value="${e(ui.reqQ)}" /></div>
                <div class="cb-seg">${groups.map(([k, l]) => `<button type="button" class="${ui.reqFilter === k ? "active" : ""}" data-rf="${k}">${l}</button>`).join("")}</div>
            </div>
            <div id="cbReqBox"></div>`;
        $("cbReqQ").addEventListener("input", (ev) => {
            ui.reqQ = ev.target.value;
            draw();
        });
        app.querySelectorAll("[data-rf]").forEach((b) =>
            b.addEventListener("click", () => {
                ui.reqFilter = b.dataset.rf;
                app.querySelectorAll("[data-rf]").forEach((x) => x.classList.toggle("active", x === b));
                draw();
            }),
        );
        draw();
    }

    async function decide(r, decision) {
        let note = null;
        if (decision === "discuss") {
            note = prompt("Що хочете обговорити? (ціна, дата, умови) — менеджер зв'яжеться з вами.");
            if (note === null) return;
        } else if (!confirm(`Погодити перевезення за ${r.offer.price} ${r.offer.currency}?`)) return;
        try {
            const res = await api("request_decide", { id: r.id, decision, note });
            Object.assign(r, res.request);
            toast(decision === "accepted" ? "Дякуємо! Менеджер оформлює перевезення." : "Передали менеджеру — він зв'яжеться з вами.");
            route();
        } catch (err) {
            toast(err.message, true);
        }
    }

    async function requestView(id) {
        const r = (state.requests || []).find((x) => String(x.id) === String(id));
        if (!r) return go("requests");
        crumbs([`<a href="#/requests">Запити</a>`, `${e(country(r.route.load_country))} → ${e(country(r.route.unload_country))}`]);
        const c = customsLines(r.route);
        const field = (label, val) => (val ? `<div class="cb-field"><label>${label}</label><div>${val}</div></div>` : "");
        const canCancel = ["new", "quote"].includes(r.status.key);
        app.innerHTML = `
            <div class="cb-dv-head">
                <a class="cb-btn cb-btn-sm" href="#/requests" title="Назад"><i class="bx bx-arrow-back"></i></a>
                <h1>Запит від ${fmtDate(r.created_at)}</h1>
                <span class="cb-chip cb-rs-${e(r.status.key)}">${e(r.status.label)}</span>
                <span class="cb-dv-route">${city(r.route.load_address, r.route.load_country)} → ${city(r.route.unload_address, r.route.unload_country)}</span>
            </div>
            <div class="cb-dv">
                <aside class="cb-card cb-aside">
                    <div class="cb-sec-title">Маршрут</div>
                    ${field("Завантаження", place(r.route.load_address, r.route.load_country))}
                    ${field("Замитнення", e(c.ex))}
                    ${field("Розмитнення", e(c.im))}
                    ${field("Розвантаження", place(r.route.unload_address, r.route.unload_country))}
                    <div class="cb-sec-title">Вантаж</div>
                    ${field("Вантаж", e(r.cargo))}
                    ${field("Вага", e(r.weight))}
                    ${field("Кузов", e(r.transport_type))}
                    ${field("Машин", r.trucks_count > 1 ? e(r.trucks_count) : "")}
                    ${field("Дата завантаження", period(r.desired_date, r.desired_date_to))}
                    <div class="cb-field" style="padding-bottom:16px;display:flex;gap:8px;flex-wrap:wrap">
                        <button type="button" class="cb-btn cb-btn-sm" id="cbRepeat"><i class="bx bx-copy"></i> Повторити запит</button>
                        ${canCancel ? `<button type="button" class="cb-btn cb-btn-sm cb-danger" id="cbCancel"><i class="bx bx-x"></i> Скасувати</button>` : ""}
                    </div>
                </aside>
                <div>
                    <div class="cb-card" style="margin-bottom:14px">
                        <h3 class="cb-h2" style="margin-top:0;font-size:16px"><i class="bx bx-badge-check"></i> Пропозиція Грандар</h3>
                        ${
                            r.offer
                                ? `<div class="cb-offer ${r.status.key === "offer" ? "pending" : ""}">
                                    <div><label>Ціна перевезення</label><div class="cb-price">${money(r.offer.price, r.offer.currency)}</div>${r.offer.note ? `<div class="cb-muted">${e(r.offer.note)}</div>` : ""}</div>
                                    ${
                                        r.status.key === "offer" || r.status.key === "discuss"
                                            ? `<div class="cb-offer-btns"><button type="button" class="cb-btn cb-btn-ok" data-dec="accepted"><i class="bx bx-check"></i> Погодити</button>
                                               ${r.status.key === "offer" ? `<button type="button" class="cb-btn" data-dec="discuss"><i class="bx bx-message-dots"></i> Обговорити</button>` : ""}</div>`
                                            : r.decision?.value === "accepted"
                                              ? `<div class="cb-muted"><i class="bx bx-check-circle"></i> Погоджено ${fmtDT(r.decision.at)}</div>`
                                              : ""
                                    }</div>`
                                : `<p class="cb-muted">Менеджер прораховує маршрут — ціна з'явиться тут, і ви зможете погодити її одним кліком.</p>`
                        }
                    </div>
                    <div class="cb-card"><h3 class="cb-h2" style="margin-top:0;font-size:16px"><i class="bx bx-chat"></i> Переписка по запиту</h3><div id="cbChat">${loading()}</div></div>
                </div>
            </div>`;
        app.querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", () => decide(r, b.dataset.dec)));
        $("cbRepeat").addEventListener("click", () => openRequestForm(r));
        $("cbCancel")?.addEventListener("click", async () => {
            const note = prompt("Скасувати запит? Можете вказати причину (необов'язково):", "");
            if (note === null) return;
            try {
                const res = await api("request_cancel", { id: r.id, note });
                if (res.request) Object.assign(r, res.request);
                toast("Запит скасовано");
                route();
            } catch (err) {
                toast(err.message, true);
            }
        });
        try {
            const m = await api("messages", { request_id: r.id });
            r.unread = 0;
            mountChat($("cbChat"), { request_id: r.id }, m.messages);
        } catch (err) {
            $("cbChat").innerHTML = `<div class="cb-alert">${e(err.message)}</div>`;
        }
    }

    /* ================================================================ */
    /* ЯК ЦЕ ПРАЦЮЄ                                                     */
    /* ================================================================ */

    function helpView() {
        crumbs(["Як це працює"]);
        const sec = (icon, title, body) => `<section class="cb-card cb-help"><h3 class="cb-h2" style="margin-top:0;font-size:17px"><i class="bx ${icon}"></i> ${title}</h3>${body}</section>`;
        const ol = (list) => `<ol class="cb-help-steps">${list.map((x) => `<li><div>${x}</div></li>`).join("")}</ol>`;
        const faq = (list) => list.map(([q, a]) => `<details class="cb-faq"><summary>${q}</summary><p>${a}</p></details>`).join("");
        const client = kind === "client";
        app.innerHTML = client
            ? `
            <div class="cb-hero" style="margin-bottom:16px"><img src="company-logo.svg" alt="" /><div><h1 class="cb-h1">Як працює кабінет клієнта</h1><div class="cb-muted">Усе про ваші перевезення з Грандар — в одному місці, без дзвінків.</div></div></div>
            <div class="cb-help-grid">
            ${sec("bx-plus-circle", "1. Замовити перевезення", ol([
                "Натисніть <b>«Новий запит»</b> (угорі праворуч).",
                "Вкажіть країну й місто завантаження та розвантаження, митниці (якщо знаєте), що веземо, вагу, кузов і дату.",
                "Під формою з'явиться <b>орієнтовна ціна</b> — за нашими перевезеннями цим напрямком. Точну ціну підтвердить менеджер.",
                "Натисніть <b>«Надіслати запит»</b> — менеджер отримає його одразу.",
            ]) + `<p class="cb-muted">Той самий маршрут ще раз? Відкрийте старий запит → <b>«Повторити запит»</b> — змініть лише дату.</p>`)}
            ${sec("bx-badge-check", "2. Погодити ціну", ol([
                "Коли менеджер прорахує, у розділі <b>«Запити»</b> з'явиться позначка <span class='cb-chip cb-rs-offer'>Є пропозиція — погодьте</span>.",
                "Натисніть <b>«Погодити»</b> — і ми оформлюємо перевезення. Або <b>«Обговорити»</b> — менеджер зв'яжеться з вами.",
            ]))}
            ${sec("bx-trip", "3. Стежити за перевезенням", ol([
                "Розділ <b>«Перевезення»</b> — усі ваші рейси: №, маршрут, авто, етап, прибуття.",
                "<span class='cb-chip cb-dev-ok'>за графіком</span> — усе добре. <span class='cb-chip cb-dev-late'>+1 год 25 хв</span> — є запізнення, угорі з'явиться попередження.",
                "Клік по рейсу — картка: <b>прогноз прибуття</b>, <b>карта з машиною</b>, етапи з планом і фактом, водій і номер авто, документи (CMR), сума й оплата.",
                "<b>«Карта»</b> — усі ваші машини в дорозі одразу.",
            ]))}
            ${sec("bx-chat", "4. Запитати менеджера", `<p>Розділ <b>«Чат з менеджером»</b>, кнопка «Написати» в картці рейсу або в запиті. Менеджер і логіст отримують ваше повідомлення миттєво. Відповідь з'явиться тут — у меню буде помаранчева цифра.</p>`)}
            </div>
            ${sec("bx-lock-alt", "Що ви бачите", `<p>Лише запити й перевезення вашої компанії. Дані захищені: кожен клієнт бачить тільки своє. Перевізника ми не показуємо — за перевезення повністю відповідає Грандар.</p>`)}
            ${sec("bx-help-circle", "Часті питання", faq([
                ["Як увійти з іншого пристрою?", "Попросіть менеджера надіслати нове посилання для входу або увійдіть за кодом з e-mail (якщо ця можливість увімкнена)."],
                ["Чому немає машини на карті?", "Карта з'являється, коли водій почав рейс у нашому додатку. До того етап оновлює логіст — він видно в картці."],
                ["Де рахунки й акти?", "У картці перевезення → вкладка «Розрахунок» / «Документи». Якщо чогось бракує — напишіть менеджеру."],
                ["Як скасувати запит?", "Відкрийте запит → «Скасувати». Якщо запит уже в роботі — напишіть менеджеру в чат."],
            ]))}`
            : `
            <div class="cb-hero" style="margin-bottom:16px"><img src="company-logo.svg" alt="" /><div><h1 class="cb-h1">Як працює кабінет перевізника</h1><div class="cb-muted">Рейси від Грандар, ваші ставки й оплати — без дзвінків і переписок.</div></div></div>
            <div class="cb-help-grid">
            ${sec("bx-bell", "1. Отримати пропозицію рейсу", ol([
                "Логіст Грандар пропонує вам рейс — він з'являється в <b>«Пропозиціях рейсів»</b> і приходить у Telegram.",
                "Ви бачите маршрут по країнах, митниці, кордон, вантаж, вагу, кузов і дату. Точні адреси — після підтвердження рейсу.",
            ]))}
            ${sec("bx-send", "2. Дати ставку", ol([
                "Відкрийте пропозицію → впишіть <b>ставку</b>, валюту, <b>дату подачі</b> й <b>номер тягача</b> → «Надіслати ставку».",
                "Не можете — натисніть <b>«Не можу»</b> (можна вказати причину). Ставку можна змінити, поки рейс не закрито.",
                "Питання по рейсу — блок «Питання логісту» прямо в пропозиції.",
            ]))}
            ${sec("bx-trip", "3. Виконати рейс", ol([
                "Підтверджений рейс з'являється в <b>«Моїх рейсах»</b>: адреси завантаження й розвантаження, митниці, дати, ваша ставка й статус оплати.",
                "Водій веде рейс у додатку <b>«FURA Водій»</b> — етапи й позиція оновлюються самі.",
                "<span class='cb-chip cb-dev-late'>+N хв</span> біля рейсу — запізнення від графіка: попередьте логіста в чаті.",
            ]))}
            ${sec("bx-trending-up", "4. Ваша ефективність", `<p>Розділ <b>«Моя ефективність»</b>: вчасні доставки, вчасна подача, як швидко ви відповідаєте — у порівнянні з іншими перевізниками Грандар. <b>Чим кращі показники, тим раніше ви отримуєте вигідні пропозиції.</b></p><p><b>«Мої машини»</b> — ваші тягачі і хто з них зараз стоїть у черзі на кордоні.</p>`)}
            </div>
            ${sec("bx-lock-alt", "Що ви бачите", `<p>Лише пропозиції, надіслані вам, і ваші рейси. Ставки інших перевізників і дані клієнта не показуються.</p>`)}
            ${sec("bx-help-circle", "Часті питання", faq([
                ["Як відкрити кабінет з телефона?", "У Telegram-боті Грандар надішліть /cabinet — бот дасть кнопку «Відкрити кабінет»."],
                ["Пропозиція зникла", "Рейс уже закрито (знайшли машину або клієнт скасував). Пропозиції без відповіді старші за 3 тижні ховаються."],
                ["Коли оплата?", "Статус оплати — у «Моїх рейсах» і в картці рейсу (вкладка «Розрахунок»). Питання — у «Чат з логістом»."],
            ]))}`;
    }

    /* ================================================================ */
    /* ЧАТ                                                              */
    /* ================================================================ */

    async function chatView() {
        crumbs([kind === "client" ? "Чат з менеджером" : "Чат з логістом"]);
        app.innerHTML = `<div class="cb-card cb-chat-page"><h3 class="cb-h2" style="margin-top:0"><i class="bx bx-chat"></i> Переписка з Грандар</h3>
            <p class="cb-muted">${kind === "client" ? "Усі повідомлення — по запитах, перевезеннях і загальні. Sales і логіст отримують ваші повідомлення одразу в Telegram." : "Усі повідомлення — по рейсах, пропозиціях і загальні. Логіст Грандар отримує їх одразу в Telegram."}</p><div id="cbChat">${loading()}</div></div>`;
        try {
            const r = await api("messages", {});
            state.unread = 0;
            renderNav();
            mountChat($("cbChat"), { all: true }, r.messages);
        } catch (err) {
            $("cbChat").innerHTML = `<div class="cb-alert">${e(err.message)}</div>`;
        }
        liveTimer = setInterval(async () => {
            const chat = $("cbChat");
            if (document.hidden || !chat?.renderMessages || chat.querySelector("textarea")?.value) return;
            try {
                chat.renderMessages((await api("messages", {})).messages);
            } catch {
                /* наступного разу */
            }
        }, 30000);
    }

    // Посилання з чату: клієнт — на запит, перевізник — на пропозицію цього рейсу
    function requestLink(requestId) {
        if (kind === "client") return `#/request/${e(requestId)}`;
        const o = (state.offers || []).find((x) => String(x.request_id) === String(requestId));
        return o ? `#/offer/${e(o.id)}` : "#/offers";
    }

    function mountChat(box, filter, initial) {
        box.innerHTML = `
            <div class="cb-msgs" data-msgs></div>
            <form class="cb-msg-form">
                <textarea class="cb-in" rows="2" maxlength="4000" placeholder="${kind === "client" ? "Напишіть менеджеру Грандар…" : "Напишіть логісту Грандар…"} (Ctrl+Enter — надіслати)" required></textarea>
                <button type="submit" class="cb-btn cb-btn-primary" title="Надіслати"><i class="bx bx-send"></i></button>
            </form>`;
        const list = box.querySelector("[data-msgs]");
        box.renderMessages = (msgs) => {
            list.innerHTML = (msgs || []).length
                ? msgs
                      .map(
                          (m) => `<div class="cb-msg ${m.mine ? "mine" : ""}">
                            ${filter.all && m.about ? `<div class="cb-msg-about">${m.deal_id ? `<a href="#/deal/${e(m.deal_id)}">${e(m.about)}</a>` : m.request_id ? `<a href="${requestLink(m.request_id)}">${e(m.about)}</a>` : e(m.about)}</div>` : ""}
                            <div class="cb-msg-text">${e(m.text)}</div>
                            <div class="cb-msg-meta">${e(m.author)} · ${fmtDT(m.at)}</div></div>`,
                      )
                      .join("")
                : `<p class="cb-muted">Повідомлень ще немає. Напишіть — ${kind === "client" ? "Sales і логіст" : "логіст"} Грандар отримає сповіщення одразу.</p>`;
            list.scrollTop = list.scrollHeight;
        };
        box.renderMessages(initial);
        const form = box.querySelector("form");
        const ta = form.querySelector("textarea");
        ta.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) form.requestSubmit();
        });
        form.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const btn = form.querySelector("button");
            btn.disabled = true;
            try {
                const res = await api("message_send", { text: ta.value, deal_id: filter.deal_id, request_id: filter.request_id });
                ta.value = "";
                box.renderMessages(filter.all ? (await api("messages", {})).messages : res.messages);
            } catch (err) {
                toast(err.message, true);
            } finally {
                btn.disabled = false;
            }
        });
    }

    /* ================================================================ */
    /* ПІДСУМКИ                                                          */
    /* ================================================================ */

    function perfHtml() {
        const p = state.perf;
        if (!p) return "";
        const net = p.network || {};
        const card = (icon, label, val, unit, netVal, better, hint) => {
            const hasNet = val != null && netVal != null;
            const good = hasNet && (better === "up" ? val >= netVal : val <= netVal);
            return `<div class="cb-kpi cb-perf"><label><i class="bx ${icon}"></i> ${label}</label>
                <b>${val == null ? "—" : val}${val == null ? "" : `<small> ${unit}</small>`}</b>
                ${hasNet ? `<div><span class="cb-chip ${good ? "cb-dev-ok" : "cb-dev-late"}">${good ? "краще за мережу" : "нижче мережі"}</span> <span class="cb-sub">мережа ${netVal}${unit === "%" ? "%" : ` ${unit}`}</span></div>` : `<div class="cb-sub">${hint || "даних поки замало"}</div>`}</div>`;
        };
        const f = p.funnel || {};
        const steps = [
            [f.offered, "Отримано пропозицій", "запити ставок від Грандар"],
            [f.answered, "Відповіли", "дали ставку або відмову"],
            [f.bid, "Дали ставку", ""],
            [f.trips, "Виконано рейсів", ""],
            [f.delivered_on_time, "Доставлено вчасно", "у погоджений день"],
        ];
        const max = Math.max(1, ...steps.map((x) => x[0] || 0));
        return `
            <div class="cb-card cb-perf-head">
                <div><label>Рейтинг у Грандар</label><div class="cb-prog-big">${p.rating != null ? `${e(p.rating)}<small> / 5</small>` : "—"}</div>${p.rating != null ? `<div class="cb-stars">${"★".repeat(Math.round(p.rating))}${"☆".repeat(5 - Math.round(p.rating))}</div>` : `<div class="cb-sub">ставить логіст після рейсів</div>`}</div>
                <div><label>Рейсів з Грандар</label><div class="cb-prog-big">${(state.stats || {}).trips || 0}</div></div>
                <div><label>Перевізників у мережі</label><div class="cb-prog-big">${net.carriers || "—"}</div><div class="cb-sub">з рейсами за пів року</div></div>
                <div class="cb-perf-note">Перевізники з вищою вчасністю та швидкою відповіддю отримують пропозиції першими.</div>
            </div>
            <div class="cb-kpis cb-perf-grid">
                ${card("bx-check-circle", "Вчасні доставки", p.on_time_delivery?.pct ?? null, "%", net.on_time_delivery, "up", "за датою розвантаження")}
                ${card("bx-time", "Вчасна подача авто", p.on_time_loading?.pct ?? null, "%", net.on_time_loading, "up", "за датою завантаження")}
                ${card("bx-message-check", "Відповідь на пропозиції", p.answer_rate, "%", net.answer_rate, "up", "ставка або «не можу»")}
                ${card("bx-stopwatch", "Час відповіді (медіана)", p.response_min, "хв", net.response_min, "down", "від запиту до відповіді")}
            </div>
            <div class="cb-card" style="margin-bottom:14px">
                <h3 class="cb-h2" style="margin-top:0;font-size:16px"><i class="bx bx-filter-alt"></i> Що відбувається з пропозиціями</h3>
                <div class="cb-funnel">${steps
                    .map(([n, l, sub]) => `<div class="cb-funnel-row"><b>${n || 0}</b><div class="track"><div class="fill" style="width:${Math.round(((n || 0) / max) * 100)}%"></div></div><div>${l}${sub ? `<div class="cb-sub">${sub}</div>` : ""}</div></div>`)
                    .join("")}</div>
            </div>`;
    }

    function reportsView() {
        crumbs([kind === "client" ? "Підсумки" : "Моя ефективність"]);
        const deals = state.deals || [];
        const byMonth = new Map();
        const total = {};
        const unpaid = {};
        deals.forEach((d) => {
            (d.sum || []).forEach((s) => {
                total[s.currency] = (total[s.currency] || 0) + s.amount;
                if (!d.paid) unpaid[s.currency] = (unpaid[s.currency] || 0) + s.amount;
            });
            const m = String(d.load_date || d.load_date_plan || "").slice(0, 7);
            if (!m) return;
            const x = byMonth.get(m) || { n: 0, sum: {} };
            x.n += 1;
            (d.sum || []).forEach((s) => (x.sum[s.currency] = (x.sum[s.currency] || 0) + s.amount));
            byMonth.set(m, x);
        });
        const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12);
        const maxN = Math.max(1, ...months.map(([, x]) => x.n));
        const sumObj = (o) => Object.entries(o).map(([c, a]) => money(a, c)).join(" + ") || "—";
        const monthName = (m) => new Date(m + "-01").toLocaleDateString("uk-UA", { month: "short", year: "numeric" });
        const done = deals.filter((d) => d.stage.key === "done").length;
        app.innerHTML = `
            ${kind === "carrier" ? perfHtml() : ""}
            <div class="cb-kpis">
                <div class="cb-kpi"><label>${kind === "client" ? "Перевезень" : "Рейсів"} усього</label><b>${deals.length}</b></div>
                <div class="cb-kpi"><label>Виконано</label><b>${done}</b></div>
                <div class="cb-kpi"><label>${kind === "client" ? "Сума перевезень" : "Зароблено"}</label><b>${sumObj(total)}</b></div>
                <div class="cb-kpi"><label>${kind === "client" ? "Очікує оплати" : "Ще не оплачено"}</label><b>${sumObj(unpaid)}</b></div>
            </div>
            <div class="cb-card">
                <h3 class="cb-h2" style="margin-top:0;font-size:16px"><i class="bx bx-bar-chart-alt-2"></i> По місяцях</h3>
                ${
                    months.length
                        ? `<div class="cb-bars">${months
                              .map(
                                  ([m, x]) => `<div class="cb-bar-row"><span>${monthName(m)}</span>
                                    <div class="track"><div class="fill" style="width:${Math.round((x.n / maxN) * 100)}%"></div></div>
                                    <b>${x.n} · ${sumObj(x.sum)}</b></div>`,
                              )
                              .join("")}</div>`
                        : `<p class="cb-muted">Даних ще немає.</p>`
                }
            </div>`;
    }

    /* ================================================================ */
    /* НОВИЙ ЗАПИТ (клієнт)                                              */
    /* ================================================================ */

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
                <div class="cb-sheet-head"><h2>${src ? "Повторити запит" : "Новий запит"}</h2><button type="button" class="cb-icon-btn" data-close><i class="bx bx-x"></i></button></div>
                <datalist id="cbCountries">${COUNTRIES.map((c) => `<option value="${c}">`).join("")}</datalist>
                <fieldset><legend><i class="bx bx-radio-circle-marked cb-from"></i> Завантаження</legend>
                    <input class="cb-in" name="load_country" list="cbCountries" placeholder="Країна *" required value="${e(country(rt.load_country))}" />
                    <input class="cb-in" name="load_address" placeholder="Місто, адреса" value="${e(rt.load_address || "")}" />
                    <input class="cb-in" name="customs_export" placeholder="Замитнення (місто / митниця)" value="${e(rt.customs_export || "")}" /></fieldset>
                <fieldset><legend><i class="bx bx-map cb-to"></i> Розвантаження</legend>
                    <input class="cb-in" name="unload_country" list="cbCountries" placeholder="Країна *" required value="${e(country(rt.unload_country))}" />
                    <input class="cb-in" name="unload_address" placeholder="Місто, адреса" value="${e(rt.unload_address || "")}" />
                    <input class="cb-in" name="customs_import" placeholder="Розмитнення (місто / митниця)" value="${e(rt.customs_import || "")}" /></fieldset>
                <fieldset><legend><i class="bx bx-package"></i> Вантаж</legend>
                    <input class="cb-in" name="cargo" placeholder="Що веземо *" required value="${e(r.cargo || "")}" />
                    <div class="cb-row">
                        <label class="cb-mini">Вага, т<input class="cb-in" name="weight" placeholder="20" value="${e(r.weight || "")}" /></label>
                        <label class="cb-mini">Кузов<select class="cb-in" name="transport_type"><option value="">—</option>${BODIES.map((b) => `<option ${r.transport_type === b ? "selected" : ""}>${b}</option>`).join("")}</select></label>
                        <label class="cb-mini cb-narrow">Машин<input class="cb-in" type="number" name="trucks_count" min="1" max="50" value="${e(r.trucks_count || 1)}" /></label>
                    </div>
                    <div class="cb-row">
                        <label class="cb-mini">Завантаження з *<input class="cb-in" type="date" name="desired_date" required min="${today}" /></label>
                        <label class="cb-mini">по (необов'язково)<input class="cb-in" type="date" name="desired_date_to" min="${today}" /></label>
                    </div>
                    <textarea class="cb-in" name="notes" rows="3" placeholder="Додатково: упаковка, тип завантаження, температура, вимоги…"></textarea></fieldset>
                <div class="cb-hintbox" id="cbPriceHint" hidden></div>
                <button type="submit" class="cb-btn cb-btn-primary cb-btn-big">Надіслати запит</button>
                <p class="cb-hint">Менеджер Грандар прорахує і покаже ціну в розділі «Запити».</p>
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
        // Орієнтовна ціна за історією перевезень Грандар цим напрямком
        const form = sheet.querySelector("form");
        let hintTimer = null;
        const askHint = () => {
            clearTimeout(hintTimer);
            hintTimer = setTimeout(async () => {
                const box = $("cbPriceHint");
                const v = (n) => form.elements[n].value.trim();
                if (!v("load_country") || !v("unload_country")) return (box.hidden = true);
                try {
                    const r = await api("price_hint", { load_country: v("load_country"), unload_country: v("unload_country"), transport_type: v("transport_type") });
                    if (!r.hint) return (box.hidden = true);
                    box.hidden = false;
                    box.innerHTML = `<i class="bx bx-bulb"></i><div><b>Орієнтовно ${money(r.hint.from, r.hint.currency)}${r.hint.to > r.hint.from ? ` – ${money(r.hint.to, r.hint.currency)}` : ""}</b>
                        <div class="cb-sub">за ${r.hint.n} перевезеннями Грандар цим напрямком за пів року${r.hint.by_body ? ` (кузов ${e(v("transport_type"))})` : ""}. Точну ціну підтвердить менеджер — вона залежить від дати, ваги й завантаження.</div></div>`;
                } catch {
                    box.hidden = true;
                }
            }, 500);
        };
        ["load_country", "unload_country", "transport_type"].forEach((n) => form.elements[n].addEventListener("change", askHint));
        askHint();
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
                toast("Запит надіслано! Менеджер уже отримав сповіщення.");
                go(`request/${res.request.id}`);
            } catch (err) {
                toast(err.message, true);
                btn.disabled = false;
            }
        });
    }

    /* ================================================================ */
    /* ПЕРЕВІЗНИК: пропозиції рейсів                                    */
    /* ================================================================ */

    function offersTable(list) {
        if (!list.length) return `<div class="cb-empty"><i class="bx bx-bell"></i><p>Пропозицій немає. Щойно логіст Грандар запропонує рейс — він з'явиться тут і прийде в Telegram.</p></div>`;
        return `<div class="cb-table-wrap"><table class="cb-table">
            <thead><tr><th>Запит від</th><th>Маршрут</th><th>Вантаж</th><th>Завантаження</th><th>Статус</th><th>Ваша ставка</th></tr></thead>
            <tbody>${list
                .map((o) => {
                    const q = o.request;
                    const [key, label] = offerStatus(o);
                    return `<tr data-offer-row="${e(o.id)}">
                        <td data-label="Запит від" class="num">${fmtDate(o.asked_at)}${o.unread ? ` <span class="cb-count">${o.unread}</span>` : ""}</td>
                        <td data-label="Маршрут" class="cb-route-cell"><div><b>${e(country(q.route.load_country) || "?")} → ${e(country(q.route.unload_country) || "?")}</b>
                            <span class="cb-sub">${[q.route.border_crossing, q.route.customs_import].filter(Boolean).map(e).join(" · ")}</span></div></td>
                        <td data-label="Вантаж"><div>${e(q.cargo || "—")}<div class="cb-sub">${[q.weight, q.transport_type, q.trucks_count > 1 ? `${q.trucks_count} авто` : ""].filter(Boolean).map(e).join(" · ")}</div></div></td>
                        <td data-label="Завантаження"><div>${period(q.desired_date, q.desired_date_to) || "—"}</div></td>
                        <td data-label="Статус"><div><span class="cb-chip cb-os-${key}">${label}</span></div></td>
                        <td data-label="Ставка"><div>${o.status === "bid" ? `<b>${money(o.my.price, o.my.currency)}</b>` : o.status === "asked" && !o.closed ? `<button type="button" class="cb-btn cb-btn-primary cb-btn-sm">Дати ставку</button>` : "—"}</div></td>
                    </tr>`;
                })
                .join("")}</tbody></table></div>`;
    }
    function bindOfferRows(root = app) {
        root.querySelectorAll("[data-offer-row]").forEach((tr) => tr.addEventListener("click", () => go(`offer/${tr.dataset.offerRow}`)));
    }

    function offersView() {
        crumbs(["Пропозиції рейсів"]);
        const all = state.offers || [];
        const groups = [
            ["new", `Нові (${all.filter((o) => o.status === "asked" && !o.closed).length})`, (o) => o.status === "asked" && !o.closed],
            ["bid", "Ставку надіслано", (o) => o.status === "bid" && !o.closed],
            ["refused", "Відмовився", (o) => o.status === "refused"],
            ["closed", "Закриті", (o) => o.closed],
            ["all", `Усі (${all.length})`, () => true],
        ];
        if (!ui.offerFilter) ui.offerFilter = all.some(groups[0][2]) ? "new" : "all";
        const draw = () => {
            const test = groups.find((g) => g[0] === ui.offerFilter)?.[2] || (() => true);
            $("cbOfferBox").innerHTML = offersTable(all.filter(test));
            bindOfferRows();
        };
        app.innerHTML = `
            <div class="cb-toolbar"><div class="cb-seg">${groups.map(([k, l]) => `<button type="button" class="${ui.offerFilter === k ? "active" : ""}" data-of="${k}">${l}</button>`).join("")}</div></div>
            <div id="cbOfferBox"></div>`;
        app.querySelectorAll("[data-of]").forEach((b) =>
            b.addEventListener("click", () => {
                ui.offerFilter = b.dataset.of;
                app.querySelectorAll("[data-of]").forEach((x) => x.classList.toggle("active", x === b));
                draw();
            }),
        );
        draw();
    }

    // Картка пропозиції: деталі рейсу зліва, ставка і переписка справа
    async function offerView(id) {
        const o = (state.offers || []).find((x) => String(x.id) === String(id));
        if (!o) return go("offers");
        const q = o.request;
        crumbs([`<a href="#/offers">Пропозиції рейсів</a>`, `${e(country(q.route.load_country))} → ${e(country(q.route.unload_country))}`]);
        const c = customsLines(q.route);
        const [key, label] = offerStatus(o);
        const field = (l, v) => (v ? `<div class="cb-field"><label>${l}</label><div>${v}</div></div>` : "");
        app.innerHTML = `
            <div class="cb-dv-head">
                <a class="cb-btn cb-btn-sm" href="#/offers" title="Назад"><i class="bx bx-arrow-back"></i></a>
                <h1>${e(country(q.route.load_country) || "?")} → ${e(country(q.route.unload_country) || "?")}</h1>
                <span class="cb-chip cb-os-${key}">${label}</span>
                <span class="cb-dv-route">запит від ${fmtDate(o.asked_at)}</span>
            </div>
            <div class="cb-dv">
                <aside class="cb-card cb-aside">
                    <div class="cb-sec-title">Маршрут</div>
                    ${field("Завантаження", e(country(q.route.load_country)))}
                    ${field("Замитнення", e(c.ex))}
                    ${field("Кордон", e(c.border))}
                    ${field("Розмитнення", e(c.im))}
                    ${field("Розвантаження", e(country(q.route.unload_country)))}
                    <div class="cb-sec-title">Вантаж</div>
                    ${field("Вантаж", e(q.cargo))}
                    ${field("Вага", e(q.weight))}
                    ${field("Кузов", e(q.transport_type))}
                    ${field("Температура", q.temp ? `${e(q.temp.filter((x) => x != null).join(" … "))} °C` : "")}
                    ${field("Тип завантаження", Array.isArray(q.loading_types) && q.loading_types.length ? e(q.loading_types.join(", ")) : "")}
                    ${field("Машин", q.trucks_count > 1 ? e(q.trucks_count) : "")}
                    ${field("Дата завантаження", period(q.desired_date, q.desired_date_to))}
                    <div class="cb-field cb-muted" style="padding-bottom:14px">Точні адреси й контакти завантаження з'являться в «Моїх рейсах» після підтвердження рейсу.</div>
                </aside>
                <div>
                    <div class="cb-cards" style="grid-template-columns:1fr;margin-bottom:14px">${offerCard(o)}</div>
                    <div class="cb-card"><h3 class="cb-h2" style="margin-top:0;font-size:16px"><i class="bx bx-chat"></i> Питання логісту по цьому рейсу</h3><div id="cbChat">${loading()}</div></div>
                </div>
            </div>`;
        bindOffers();
        try {
            const m = await api("messages", { request_id: o.request_id });
            o.unread = 0;
            mountChat($("cbChat"), { request_id: o.request_id }, m.messages);
        } catch (err) {
            $("cbChat").innerHTML = `<div class="cb-alert">${e(err.message)}</div>`;
        }
    }

    /* ---------------- Перевізник: мої машини ---------------- */

    function trucksView() {
        crumbs(["Мої машини"]);
        const list = state.trucks || [];
        const inQ = list.filter((t) => t.queue).length;
        app.innerHTML = `
            <div class="cb-kpis">
                <div class="cb-kpi"><label>Машин відомо</label><b>${list.length}</b></div>
                <div class="cb-kpi"><label>Зараз у черзі на кордоні</label><b>${inQ}</b></div>
                <div class="cb-kpi"><label>Рейсів з Грандар</label><b>${(state.stats || {}).trips || 0}</b></div>
            </div>
            ${
                list.length
                    ? `<div class="cb-table-wrap"><table class="cb-table">
                <thead><tr><th>Тягач</th><th>Причіп / кузов</th><th>Рейсів з Грандар</th><th>Останній рейс</th><th>Зараз</th></tr></thead>
                <tbody>${list
                    .map(
                        (t) => `<tr ${t.last_trip ? `data-deal="${e(t.last_trip.id)}"` : ""}>
                        <td data-label="Тягач" class="num">${e(t.plate)}</td>
                        <td data-label="Причіп"><div>${e(t.trailer || "—")}<div class="cb-sub">${e(t.body || "")}</div></div></td>
                        <td data-label="Рейсів"><div>${t.trips || 0}</div></td>
                        <td data-label="Останній рейс"><div>${t.last_trip ? `№ ${e(t.last_trip.number)}` : "—"}</div></td>
                        <td data-label="Зараз"><div>${t.queue ? `<span class="cb-chip cb-rs-offer">у черзі: ${e(t.queue.checkpoint)}</span><div class="cb-sub">${t.queue.queue_no ? `№ ${e(t.queue.queue_no)} · ` : ""}${t.queue.since ? `з ${e(t.queue.since)}` : ""}</div>` : `<span class="cb-muted">—</span>`}</div></td>
                    </tr>`,
                    )
                    .join("")}</tbody></table></div>`
                    : `<div class="cb-empty"><i class="bx bx-bus"></i><p>Машини з'являться тут після перших рейсів або ставок з номером тягача.</p></div>`
            }
            <p class="cb-hint">Черга на кордоні — з єЧерги, оновлюється кілька разів на день. Скоро тут з'являться пропозиції зворотних вантажів під машини, що проїхали кордон.</p>`;
        bindDealRows();
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
        const c = customsLines(q.route);
        return `
            <article class="cb-card" data-offer="${e(o.id)}">
                <div class="cb-card-head"><span class="cb-no">запит від ${fmtDate(o.asked_at)}</span><span class="cb-chip cb-os-${key}">${label}</span></div>
                <div class="cb-route-big">${e(country(q.route.load_country) || "?")} <i class="bx bx-right-arrow-alt"></i> ${e(country(q.route.unload_country) || "?")}</div>
                <div class="cb-grid">
                    ${q.desired_date ? `<div><label>Завантаження</label><b>${period(q.desired_date, q.desired_date_to)}</b></div>` : ""}
                    ${q.transport_type ? `<div><label>Кузов</label>${e(q.transport_type)}${q.trucks_count > 1 ? ` × ${e(q.trucks_count)}` : ""}</div>` : ""}
                    ${q.cargo ? `<div><label>Вантаж</label>${e(q.cargo)}</div>` : ""}
                    ${q.weight ? `<div><label>Вага</label>${e(q.weight)}</div>` : ""}
                    ${q.temp ? `<div><label>Температура</label>${e(q.temp.filter((x) => x != null).join(" … "))} °C</div>` : ""}
                    ${c.ex || c.border || c.im ? `<div class="cb-wide cb-meta">${c.ex ? `<span>Замитнення: ${e(c.ex)}</span>` : ""}${c.border ? `<span>Кордон: ${e(c.border)}</span>` : ""}${c.im ? `<span>Розмитнення: ${e(c.im)}</span>` : ""}</div>` : ""}
                </div>
                ${
                    o.status === "bid"
                        ? `<div class="cb-offer" style="margin-top:12px"><div><label>Ваша ставка</label><div class="cb-price">${money(my.price, my.currency)}</div>
                    <div class="cb-muted">${[my.load_date ? `подача ${fmtDate(my.load_date)}` : "", my.truck_plate || "", my.note || ""].filter(Boolean).map(e).join(" · ")}</div></div></div>`
                        : ""
                }
                ${
                    editable
                        ? `<form class="cb-bid" ${showForm ? "" : "hidden"}>
                            <div class="cb-row"><input class="cb-in" name="price" inputmode="decimal" placeholder="Ставка *" value="${e(my.price || "")}" required />
                                <select class="cb-in cb-narrow" name="currency">${["EUR", "USD", "UAH"].map((x) => `<option ${my.currency === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
                            <div class="cb-row"><label class="cb-mini">Подача авто<input class="cb-in" type="date" name="load_date" value="${e(my.load_date || q.desired_date || "")}" /></label>
                                <label class="cb-mini">Номер тягача<input class="cb-in" name="truck_plate" placeholder="BC1234AB" value="${e(my.truck_plate || "")}" /></label></div>
                            <input class="cb-in" name="note" placeholder="Коментар (необов'язково)" value="${e(my.note || "")}" />
                            <div class="cb-offer-btns"><button type="submit" class="cb-btn cb-btn-primary"><i class="bx bx-send"></i> ${o.status === "bid" ? "Оновити ставку" : "Надіслати ставку"}</button>
                                ${o.status !== "refused" ? `<button type="button" class="cb-btn" data-refuse>Не можу</button>` : ""}</div>
                           </form>
                           ${showForm ? "" : `<div class="cb-card-foot"><span></span><button type="button" class="cb-link" data-edit><i class="bx bx-edit"></i> ${o.status === "refused" ? "Все ж дати ставку" : "Змінити ставку"}</button></div>`}`
                        : ""
                }
            </article>`;
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
                    route();
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

    // Повернулися у вкладку — оновити дані (картка й чат оновлюються самі)
    document.addEventListener("visibilitychange", () => {
        if (document.hidden || !token || !state || document.querySelector(".cb-sheet")) return;
        if (["deal", "chat", "request"].includes(currentRoute().view) || document.activeElement?.closest?.("form")) return;
        refresh();
    });

    boot().catch(() => {});
})();
