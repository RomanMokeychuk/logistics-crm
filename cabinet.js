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
        const deep = location.hash.match(/^#deal=(.+)$/);
        await load();
        if (deep) openDeal(decodeURIComponent(deep[1]));
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
            if (!["deals", "requests", "chat"].includes(tab)) tab = state.requests.some((r) => r.status.key === "offer") ? "requests" : "deals";
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
                    <button type="button" class="cb-btn cb-btn-sm" data-open-deal="${e(d.id)}">${d.has_trip ? `<i class="bx bx-map-alt"></i> Карта і деталі` : "Деталі"}${d.unread ? ` <span class="cb-count">${d.unread}</span>` : ""}</button>
                </div>
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
        app.querySelectorAll("[data-open-deal]").forEach((b) => b.addEventListener("click", () => openDeal(b.dataset.openDeal)));
    }

    /* ---------------- Повна картка перевезення ---------------- */

    let detailTimer = null;
    let map = null;
    function closeDetail() {
        clearInterval(detailTimer);
        detailTimer = null;
        if (map) {
            map.remove();
            map = null;
        }
        if (location.hash.startsWith("#deal=")) history.replaceState(null, "", location.pathname);
    }

    async function openDeal(id) {
        closeDetail();
        history.replaceState(null, "", `#deal=${id}`);
        window.scrollTo(0, 0);
        app.innerHTML = loading();
        let r;
        try {
            r = await api("deal_full", { id });
        } catch (err) {
            app.innerHTML = `<div class="cb-alert">${e(err.message)}</div>`;
            return;
        }
        renderDeal(r);
        // Позиція машини і нові повідомлення — кожні 30 с
        detailTimer = setInterval(async () => {
            if (document.hidden || !document.querySelector("[data-detail]")) return;
            try {
                const fresh = await api("deal_full", { id });
                updateLive(fresh);
            } catch {
                /* спробуємо наступного разу */
            }
        }, 30000);
    }

    function backToList() {
        closeDetail();
        load(true);
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

    function renderDeal(r) {
        const d = r.deal;
        const kind = state?.account?.kind || "client";
        const t = r.trip;
        const hasMap = t && (t.last || t.track.length || t.route.length || t.load || t.unload);
        app.innerHTML = `
            <div data-detail="${e(d.id)}">
                <button type="button" class="cb-link cb-back" id="cbBack"><i class="bx bx-arrow-back"></i> Усі перевезення</button>
                ${dealCard(d, kind).replace(/<div class="cb-card-foot">[\s\S]*?<\/div>\s*<\/article>/, '<div class="cb-card-foot" id="cbMgr"></div></article>')}
                ${
                    hasMap
                        ? `<section class="cb-card cb-sec"><h3><i class="bx bx-map-alt"></i> Де машина</h3><div id="cbEta">${etaHtml(t)}</div><div class="cb-map" id="cbMap"></div></section>`
                        : `<section class="cb-card cb-sec"><h3><i class="bx bx-map-alt"></i> Де машина</h3><p class="cb-muted">Карта з'явиться, коли водій почне рейс у додатку «FURA Водій».${d.queue ? "" : ""}</p></section>`
                }
                <section class="cb-card cb-sec"><h3><i class="bx bx-list-check"></i> Хронологія</h3><div id="cbEvents">${eventsHtml(r.events)}</div></section>
                <section class="cb-card cb-sec"><h3><i class="bx bx-file"></i> Документи</h3><div id="cbDocs">${docsHtml(r.docs)}</div></section>
                ${kind === "client" ? `<section class="cb-card cb-sec"><h3><i class="bx bx-chat"></i> Переписка по перевезенню № ${e(d.number)}</h3><div id="cbChat"></div></section>` : ""}
            </div>`;
        $("cbMgr").innerHTML = d.manager?.name
            ? `<span class="cb-muted"><i class="bx bx-user"></i> Логіст Грандар: ${e(d.manager.name)} ${phoneLink(d.manager.phone)}</span>`
            : "";
        $("cbBack").addEventListener("click", backToList);
        if (hasMap) drawMap(t);
        if (kind === "client") mountChat($("cbChat"), { deal_id: d.id }, r.messages);
    }

    function updateLive(r) {
        if (!document.querySelector(`[data-detail="${CSS.escape(String(r.deal.id))}"]`)) return;
        if ($("cbEta")) $("cbEta").innerHTML = etaHtml(r.trip);
        if ($("cbEvents")) $("cbEvents").innerHTML = eventsHtml(r.events);
        if (r.trip && map) drawMap(r.trip, true);
        const chat = $("cbChat");
        if (chat && chat.renderMessages && !chat.querySelector("textarea")?.value) chat.renderMessages(r.messages);
    }

    const eventsHtml = (list) =>
        list && list.length
            ? `<ul class="cb-timeline">${list.map((x) => `<li><b>${e(x.label)}</b><span>${fmtDT(x.at)}</span></li>`).join("")}</ul>`
            : `<p class="cb-muted">Подій ще немає — статуси з'являтимуться тут автоматично.</p>`;
    const docsHtml = (list) =>
        list && list.length
            ? `<div class="cb-docs">${list.map((x) => `<a href="${e(x.url)}" target="_blank" rel="noopener"><img src="${e(x.url)}" alt="${e(x.kind)}" loading="lazy" /><span>${e(x.kind)} · ${fmtDT(x.at)}</span></a>`).join("")}</div>`
            : `<p class="cb-muted">Документів ще немає. Фото CMR з'явиться після завантаження.</p>`;

    /* ---------------- Карта (MapLibre + OpenStreetMap) ---------------- */

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
    let truck = null;

    async function drawMap(t, update = false) {
        const el = $("cbMap");
        if (!el) return;
        const ll = ([lat, lon]) => [lon, lat];
        const route = (t.route || []).map(ll);
        const track = (t.track || []).map(ll);
        if (update && map && map.getSource("track")) {
            map.getSource("track").setData({ type: "Feature", geometry: { type: "LineString", coordinates: track } });
            if (t.last && truck) truck.setLngLat([t.last.lon, t.last.lat]);
            return;
        }
        try {
            await loadMapLibre();
        } catch {
            el.innerHTML = `<p class="cb-muted">Не вдалося завантажити карту.</p>`;
            return;
        }
        const gl = window.maplibregl;
        const pts = [...route, ...track];
        if (t.load) pts.push(ll(t.load));
        if (t.unload) pts.push(ll(t.unload));
        if (t.last) pts.push([t.last.lon, t.last.lat]);
        if (!pts.length) return;
        const bounds = pts.reduce((b, c) => b.extend(c), new gl.LngLatBounds(pts[0], pts[0]));
        if (map) map.remove();
        map = new gl.Map({ container: el, style: OSM, bounds, fitBoundsOptions: { padding: 40, maxZoom: 12 }, cooperativeGestures: true, attributionControl: { compact: true } });
        map.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new gl.FullscreenControl(), "top-right");
        const pin = (p, cls, html, title) => {
            if (!p) return;
            const d = document.createElement("div");
            d.className = cls;
            d.innerHTML = html;
            d.title = title;
            new gl.Marker({ element: d }).setLngLat(p).addTo(map);
        };
        map.on("load", () => {
            if (route.length > 1) {
                map.addSource("route", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: route } } });
                map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#93c5fd", "line-width": 6, "line-opacity": 0.9 } });
            }
            map.addSource("track", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: track } } });
            map.addLayer({ id: "track", type: "line", source: "track", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#1d5bd8", "line-width": 4 } });
        });
        pin(t.load && ll(t.load), "cb-pin cb-pin-a", "A", "Завантаження");
        pin(t.unload && ll(t.unload), "cb-pin cb-pin-b", "B", "Розвантаження");
        (t.borders || []).forEach((b) => pin([b.lon, b.lat], "cb-pin cb-pin-border", "<i class='bx bx-shield-quarter'></i>", b.name));
        truck = null;
        if (t.last) {
            const d = document.createElement("div");
            d.className = "cb-truck";
            d.innerHTML = "<i class='bx bxs-truck'></i>";
            d.title = `Остання позиція: ${fmtDT(t.last.at)}`;
            truck = new gl.Marker({ element: d }).setLngLat([t.last.lon, t.last.lat]).addTo(map);
        }
    }

    /* ---------------- Переписка з Грандар ---------------- */

    function mountChat(box, filter, initial) {
        box.innerHTML = `
            <div class="cb-msgs" data-msgs></div>
            <form class="cb-msg-form">
                <textarea class="cb-in" rows="2" maxlength="4000" placeholder="Напишіть менеджеру Грандар…" required></textarea>
                <button type="submit" class="cb-btn cb-btn-primary" title="Надіслати"><i class="bx bx-send"></i></button>
            </form>`;
        const list = box.querySelector("[data-msgs]");
        box.renderMessages = (msgs) => {
            list.innerHTML = (msgs || []).length
                ? msgs
                      .map(
                          (m) => `<div class="cb-msg ${m.mine ? "mine" : ""}">
                            ${filter.all && m.about ? `<div class="cb-msg-about">${e(m.about)}</div>` : ""}
                            <div class="cb-msg-text">${e(m.text)}</div>
                            <div class="cb-msg-meta">${e(m.author)} · ${fmtDT(m.at)}</div></div>`,
                      )
                      .join("")
                : `<p class="cb-muted">Повідомлень ще немає. Напишіть — Sales і логіст Грандар отримають сповіщення одразу.</p>`;
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

    function openChatSheet(title, filter) {
        const sheet = document.createElement("div");
        sheet.className = "cb-sheet";
        sheet.innerHTML = `<div class="cb-sheet-body"><div class="cb-sheet-head"><h2>${e(title)}</h2><button type="button" class="cb-icon-btn" data-close><i class="bx bx-x"></i></button></div><div data-chat>${loading()}</div></div>`;
        document.body.appendChild(sheet);
        document.documentElement.classList.add("cb-lock");
        const close = () => {
            sheet.remove();
            document.documentElement.classList.remove("cb-lock");
            load(true);
        };
        sheet.addEventListener("click", (ev) => {
            if (ev.target === sheet || ev.target.closest("[data-close]")) close();
        });
        api("messages", filter)
            .then((r) => mountChat(sheet.querySelector("[data-chat]"), filter, r.messages))
            .catch((err) => (sheet.querySelector("[data-chat]").innerHTML = `<div class="cb-alert">${e(err.message)}</div>`));
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
                { key: "chat", label: "Чат", count: state.unread || 0 },
            ])}
            <section class="cb-list">${tab === "requests" ? requestsSection() : tab === "chat" ? `<div class="cb-card cb-sec"><h3><i class="bx bx-chat"></i> Переписка з Грандар</h3><p class="cb-muted">Усі повідомлення — по запитах, перевезеннях і загальні. Пишіть сюди будь-яке питання.</p><div id="cbChatAll">${loading()}</div></div>` : dealsSection("client")}</section>`;
        bindTabs(renderClient);
        $("cbNewReq").addEventListener("click", () => openRequestForm());
        if (tab === "requests") bindRequests();
        else if (tab === "chat")
            api("messages", {})
                .then((r) => {
                    mountChat($("cbChatAll"), { all: true }, r.messages);
                    state.unread = 0;
                })
                .catch((err) => ($("cbChatAll").innerHTML = `<div class="cb-alert">${e(err.message)}</div>`));
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
                    <button type="button" class="cb-link" data-repeat><i class="bx bx-copy"></i> Повторити</button>
                    <button type="button" class="cb-link" data-chat-req><i class="bx bx-chat"></i> Написати${r.unread ? ` <span class="cb-count">${r.unread}</span>` : ""}</button>
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
            card.querySelector("[data-chat-req]")?.addEventListener("click", () =>
                openChatSheet(`Запит ${country(r.route.load_country)} → ${country(r.route.unload_country)}`, { request_id: r.id }),
            );
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
        if (!document.hidden && token && state && !document.querySelector(".cb-sheet") && !document.querySelector("[data-detail]") && !document.activeElement?.closest?.("form")) load(true);
    });

    boot();
})();
