/* ================================================================= *
 * FURA — ПІДБІР ПЕРЕВІЗНИКІВ «ПІД ЗАПИТ»                              *
 * За митними даними (таблиця carrier_routes): хто реально возить      *
 * потрібним напрямком, скільки машин, які причепи, який кордон,       *
 * плюс скільки разів возив для нас (угоди).                           *
 * Підключається на index.html після script.js.                        *
 * Відкрити з посилання: index.html?match=1&dir=Імпорт&country=ПОЛЬША  *
 * ================================================================= */

(function () {
    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) return;

    const COUNTRIES = ["ПОЛЬША", "НІМЕЧЧИНА", "РУМУНІЯ", "ЛИТВА", "МОЛДОВА", "ЧЕХІЯ", "ІТАЛІЯ", "НІДЕРЛАНДИ", "ТУРЕЧЧИНА", "КИТАЙ", "БОЛГАРІЯ", "СЛОВАЧЧИНА", "УГОРЩИНА", "ЛАТВІЯ", "США", "ФРАНЦІЯ", "АВСТРІЯ", "БЕЛЬГІЯ", "ВЕЛИКОБРИТАНІЯ", "ГРУЗІЯ", "ІСПАНІЯ", "АЗЕРБАЙДЖАН", "ЕСТОНІЯ", "ГРЕЦІЯ", "ІЗРАЇЛЬ", "ДАНІЯ", "КАЗАХСТАН", "ОБ ЄДНАНІ АРАБСЬКІ ЕМІРАТИ", "ШВЕЙЦАРІЯ", "ВІРМЕНІЯ", "СЛОВЕНІЯ", "ШВЕЦІЯ", "КАНАДА", "ХОРВАТІЯ", "ПІВНІЧНА МАКЕДОНІЯ", "ІНДІЯ", "СЕРБІЯ", "УЗБЕКИСТАН", "ФІНЛЯНДІЯ", "ГОНКОНГ", "САУДІВСЬКА АРАВІЯ", "НОРВЕГІЯ", "В ЄТНАМ", "ІНДОНЕЗІЯ", "ЛІВАН", "СІНГАПУР", "КОРЕЯ РЕСПУБЛІКА", "ЄГИПЕТ", "ТАЇЛАНД", "СІРІЙСЬКА АРАБСЬКА РЕСПУБЛІКА", "ЛІВІЙСЬКА АРАБСЬКА ДЖАМАХІРІЯ", "МАЛАЙЗІЯ", "БОСНІЯ І ГЕРЦЕГОВИНА", "НЕПАЛ", "КИРГИЗСТАН", "ТАЙВАНЬ ПРОВІНЦІЯ КИТАЮ", "ПОРТУГАЛІЯ", "ЄМЕН", "ІРАК", "ПІВДЕННА АФРИКА"];
    const OBLASTS = typeof UKRAINE_OBLASTS !== "undefined" ? UKRAINE_OBLASTS.filter((o) => o !== "М. КИЇВ") : [];
    const TRAILERS = ["ТЕНТ", "РЕФ", "ЦИСТЕРНА", "ПЛАТФОРМА", "ЗЕРНОВОЗ", "АВТОВОЗ", "САМОСКИД", "ТРАЛ", "ГАЗОВОЗ", "БІТУМОВОЗ"];

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const keyCode = (v) => String(v || "").replace(/\D/g, "").replace(/^0+/, "");
    const cap = (s) => String(s || "").toLowerCase().replace(/(^|[\s-])\S/g, (m) => m.toUpperCase());
    const monthName = (m) => {
        const [y, mm] = String(m || "").split("-");
        const names = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
        return mm ? `${names[Number(mm) - 1]} ${y.slice(2)}` : m;
    };
    const fmtDate = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join(".") : "");

    /* ---------- Угоди з нами (для рейтингу) ---------- */
    let dealsByCarrier = null;
    async function loadDealsStats() {
        if (dealsByCarrier) return dealsByCarrier;
        dealsByCarrier = new Map();
        const { data } = await client
            .from("deals")
            .select("carrier_id, carrier_edrpou, load_date, load_date_plan, created_at")
            .limit(10000);
        (data || []).forEach((d) => {
            const keys = [d.carrier_id ? "id:" + d.carrier_id : null, d.carrier_edrpou ? "code:" + keyCode(d.carrier_edrpou) : null].filter(Boolean);
            const date = d.load_date || d.load_date_plan || d.created_at;
            keys.forEach((k) => {
                const s = dealsByCarrier.get(k) || { count: 0, last: null };
                s.count++;
                if (date && (!s.last || String(date) > String(s.last))) s.last = date;
                dealsByCarrier.set(k, s);
            });
        });
        return dealsByCarrier;
    }
    function dealsOf(carrier) {
        if (!dealsByCarrier || !carrier) return { count: 0, last: null };
        return dealsByCarrier.get("id:" + carrier.id) || dealsByCarrier.get("code:" + keyCode(carrier.edrpou)) || { count: 0, last: null };
    }

    /* ---------- Панель підбору ---------- */
    function opts(list, sel, ph) {
        return `<option value="">${ph}</option>` + list.map((x) => `<option value="${esc(x)}"${x === sel ? " selected" : ""}>${esc(cap(x))}</option>`).join("");
    }

    function buildPanel() {
        const bar = document.querySelector(".filters-bar");
        if (!bar || document.getElementById("cmPanel")) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-secondary cm-open";
        btn.id = "cmOpenBtn";
        btn.innerHTML = "🎯 Підібрати під запит";
        bar.appendChild(btn);

        const panel = document.createElement("section");
        panel.id = "cmPanel";
        panel.className = "cm-panel";
        panel.hidden = true;
        panel.innerHTML = `
            <div class="cm-head">
                <b>🎯 Хто реально возить цим напрямком</b>
                <span class="cm-sub">за митними даними + робота з нами</span>
                <button type="button" class="cm-close" title="Закрити">×</button>
            </div>
            <form class="cm-form" id="cmForm">
                <label>Напрямок
                    <select id="cmDir"><option value="Імпорт">Імпорт → в Україну</option><option value="Експорт">Експорт → з України</option><option value="">Будь-який</option></select>
                </label>
                <label><span>Країна <i>*</i></span>
                    <select id="cmCountry" required>${opts(COUNTRIES, "", "Оберіть країну…")}</select>
                </label>
                <label>Область України
                    <select id="cmRegion">${opts(OBLASTS, "", "Будь-яка")}</select>
                </label>
                <label>Тип причепу
                    <select id="cmTrailer">${opts(TRAILERS, "", "Будь-який")}</select>
                </label>
                <label>Кордон
                    <input type="text" id="cmBorder" placeholder="напр. Ягодин" />
                </label>
                <button type="submit" class="btn btn-primary">Знайти</button>
            </form>
            <div class="cm-results" id="cmResults"></div>`;
        bar.insertAdjacentElement("afterend", panel);

        btn.addEventListener("click", () => {
            panel.hidden = !panel.hidden;
            if (!panel.hidden) document.getElementById("cmCountry").focus();
        });
        panel.querySelector(".cm-close").addEventListener("click", () => (panel.hidden = true));
        document.getElementById("cmForm").addEventListener("submit", (e) => {
            e.preventDefault();
            search();
        });
        document.getElementById("cmResults").addEventListener("click", (e) => {
            const open = e.target.closest("[data-cm-open]");
            if (open && typeof openCarrierCard === "function") {
                e.preventDefault();
                openCarrierCard(open.dataset.cmOpen);
            }
        });
    }

    async function search() {
        const dir = document.getElementById("cmDir").value;
        const country = document.getElementById("cmCountry").value;
        const region = document.getElementById("cmRegion").value;
        const trailer = document.getElementById("cmTrailer").value;
        const border = document.getElementById("cmBorder").value.trim();
        const out = document.getElementById("cmResults");
        if (!country) return;
        out.innerHTML = `<div class="cm-empty">Шукаю…</div>`;

        let q = client
            .from("carrier_routes")
            .select("edrpou, direction, country, ua_region, month, trucks, records, trailer_types, border, goods")
            .eq("country", country)
            .limit(6000);
        if (dir) q = q.eq("direction", dir);
        if (region) q = q.eq("ua_region", region);
        if (trailer) q = q.ilike("trailer_types", `%${trailer}%`);
        if (border) q = q.ilike("border", `%${border}%`);
        const [{ data, error }] = await Promise.all([q, loadDealsStats()]);
        if (error) {
            out.innerHTML = `<div class="cm-empty">${/carrier_routes/.test(error.message || "") ? "Ще не завантажені митні напрямки: запустіть carrier_routes.sql і завантажте carrier_routes.csv у Supabase." : "Помилка: " + esc(error.message)}</div>`;
            return;
        }

        // Збираємо по перевізнику
        const latest = (data || []).reduce((m, r) => (r.month > m ? r.month : m), "");
        const by = new Map();
        for (const r of data || []) {
            const k = keyCode(r.edrpou);
            const a = by.get(k) || { code: r.edrpou, trucks: 0, records: 0, months: new Set(), regions: new Map(), borders: new Map(), trailers: new Set(), goods: new Set(), dirs: new Set() };
            a.trucks += r.trucks || 0;
            a.records += r.records || 0;
            a.months.add(r.month);
            a.dirs.add(r.direction);
            if (r.ua_region) a.regions.set(r.ua_region, (a.regions.get(r.ua_region) || 0) + (r.records || 0));
            if (r.border) a.borders.set(r.border, (a.borders.get(r.border) || 0) + (r.records || 0));
            String(r.trailer_types || "").split(";").map((x) => x.trim()).filter(Boolean).forEach((x) => a.trailers.add(x));
            String(r.goods || "").split(";").map((x) => x.trim()).filter(Boolean).slice(0, 2).forEach((x) => a.goods.add(x));
            by.set(k, a);
        }

        const carriers = new Map((typeof allCarriersCache !== "undefined" ? allCarriersCache : []).map((c) => [keyCode(c.edrpou), c]));
        const list = [...by.values()]
            .map((a) => {
                const c = carriers.get(keyCode(a.code)) || null;
                const ds = dealsOf(c);
                const active = a.months.has(latest);
                let score = a.records + a.trucks * 3 + ds.count * 25 + (c?.rating || 0) * 6 + (active ? 15 : 0) + (c?.phone_1 ? 5 : 0);
                if (!c) score *= 0.4; // немає в реєстрі — нижче
                if (c && /^\s*$/.test(c.phone_1 || "") && /^\s*$/.test(c.phone_2 || "")) score *= 0.8; // немає телефону
                return { ...a, c, ds, active, score };
            })
            .sort((x, y) => y.score - x.score);

        if (!list.length) {
            out.innerHTML = `<div class="cm-empty">За цими умовами в митних даних нікого немає. Приберіть область, причіп або кордон.</div>`;
            return;
        }

        const top = list.slice(0, 60);
        out.innerHTML =
            `<div class="cm-count">Знайдено ${list.length} перевізників${list.length > 60 ? " · показано 60 найкращих" : ""}. Спершу — хто частіше їздив, працював з нами і має телефон.</div>` +
            top
                .map((a, i) => {
                    const c = a.c;
                    const regions = [...a.regions.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([r]) => cap(r.replace(" ОБЛ.", "")) + " обл.");
                    const borderTop = [...a.borders.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
                    const phone = c?.phone_1 ? String(c.phone_1).split(/[,;]/)[0].trim() : "";
                    const digits = phone.replace(/\D/g, "");
                    return `<div class="cm-row">
                        <div class="cm-rank">${i + 1}</div>
                        <div class="cm-main">
                            <div class="cm-name">${c ? `<a href="#" data-cm-open="${esc(c.id)}">${esc(c.name || c.company || "—")}</a>` : `<span class="cm-unknown">Немає в реєстрі</span>`}
                                <code>${esc(a.code)}</code>
                                ${a.active ? `<span class="cm-tag cm-active">активний</span>` : ""}
                                ${a.ds.count ? `<span class="cm-tag cm-ours">з нами: ${a.ds.count} рейс.${a.ds.last ? ` · ${fmtDate(a.ds.last)}` : ""}</span>` : ""}
                                ${c?.rating ? `<span class="cm-stars">${"★".repeat(c.rating)}</span>` : ""}
                            </div>
                            <div class="cm-facts">
                                <span>🚛 <b>${a.trucks}</b> маш.</span>
                                <span>📄 ${a.records} відпр.</span>
                                <span>📅 ${[...a.months].sort().map(monthName).join(", ")}</span>
                                ${[...a.dirs].length > 1 || !document.getElementById("cmDir").value ? `<span>${[...a.dirs].join(" + ")}</span>` : ""}
                                ${regions.length ? `<span>📍 ${esc(regions.join(", "))}</span>` : ""}
                                ${borderTop ? `<span>🛂 ${esc(borderTop)}</span>` : ""}
                            </div>
                            <div class="cm-facts cm-light">
                                ${[...a.trailers].slice(0, 4).map((t) => `<span class="cm-trailer">${esc(t)}</span>`).join("")}
                                ${a.goods.size ? `<span>везли: ${esc([...a.goods].slice(0, 3).join("; "))}</span>` : ""}
                            </div>
                        </div>
                        <div class="cm-contact">
                            ${c?.contact_person_1 ? `<div class="cm-person">${esc(c.contact_person_1)}</div>` : ""}
                            ${phone ? `<a href="tel:+${digits}">${esc(phone)}</a> <a class="viber-link" href="viber://chat?number=%2B${digits}" title="Viber"><i class="bx bxs-message-rounded-dots"></i></a>` : `<span class="cm-sub">телефону немає</span>`}
                        </div>
                    </div>`;
                })
                .join("");
    }

    /* ---------- Блок у картці перевізника ---------- */
    let seq = 0;
    async function renderCard(item) {
        const body = document.getElementById("carrierCardBody");
        if (!body || !item?.edrpou) return;
        const my = ++seq;
        body.querySelector("#carrierRoutesBox")?.remove();
        const box = document.createElement("div");
        box.id = "carrierRoutesBox";
        box.className = "ch cm-card";
        box.innerHTML = `<div class="ch-title">🧭 Напрямки за митними даними</div><div class="ch-body"><div class="ch-empty">Завантаження…</div></div>`;
        const hist = body.querySelector("#carrierHistory");
        if (hist) hist.insertAdjacentElement("beforebegin", box);
        else body.appendChild(box);

        const code = String(item.edrpou).replace(/\D/g, "");
        const { data, error } = await client
            .from("carrier_routes")
            .select("direction, country, ua_region, month, trucks, records, trailer_types, border")
            .in("edrpou", [...new Set([code, code.replace(/^0+/, ""), code.padStart(8, "0")])])
            .limit(500);
        if (my !== seq) return;
        const out = box.querySelector(".ch-body");
        if (error) {
            out.innerHTML = `<div class="ch-empty">Митні напрямки ще не завантажені (carrier_routes.sql + CSV).</div>`;
            return;
        }
        if (!(data || []).length) {
            out.innerHTML = `<div class="ch-empty">У митних даних цього перевізника немає.</div>`;
            return;
        }
        const by = new Map();
        for (const r of data) {
            const k = r.direction + "|" + r.country;
            const a = by.get(k) || { dir: r.direction, country: r.country, trucks: 0, records: 0, months: new Set(), regions: new Set(), borders: new Set(), trailers: new Set() };
            a.trucks += r.trucks || 0;
            a.records += r.records || 0;
            a.months.add(r.month);
            if (r.ua_region) a.regions.add(cap(r.ua_region.replace(" ОБЛ.", "")));
            if (r.border) a.borders.add(r.border);
            String(r.trailer_types || "").split(";").map((x) => x.trim()).filter(Boolean).forEach((x) => a.trailers.add(x));
            by.set(k, a);
        }
        const rows = [...by.values()].sort((x, y) => y.records - x.records);
        out.innerHTML = `<div class="cm-routes">${rows
            .slice(0, 12)
            .map(
                (a) => `<div class="cm-route">
                    <span class="cm-dir ${a.dir === "Імпорт" ? "imp" : "exp"}">${a.dir === "Імпорт" ? "→ UA" : "UA →"}</span>
                    <b>${esc(cap(a.country))}</b>
                    <span class="cm-sub">${a.trucks} маш. · ${a.records} відпр. · ${[...a.months].sort().map(monthName).join(", ")}</span>
                    <span class="cm-sub">${esc([...a.regions].slice(0, 3).join(", "))}${a.borders.size ? ` · 🛂 ${esc([...a.borders][0])}` : ""}${a.trailers.size ? ` · ${esc([...a.trailers].slice(0, 3).join(", "))}` : ""}</span>
                </div>`,
            )
            .join("")}</div>${rows.length > 12 ? `<div class="ch-more">ще ${rows.length - 12} напрямків</div>` : ""}`;
    }

    window.furaCarrierRoutes = { renderCard, search };

    function init() {
        buildPanel();
        const p = new URLSearchParams(location.search);
        if (p.get("match") === "1") {
            document.getElementById("cmPanel").hidden = false;
            const set = (id, v) => {
                const el = document.getElementById(id);
                if (!el || !v) return;
                if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === v)) el.insertAdjacentHTML("beforeend", `<option value="${esc(v)}">${esc(cap(v))}</option>`);
                el.value = v;
            };
            set("cmDir", p.get("dir") ?? "Імпорт");
            set("cmCountry", (p.get("country") || "").toUpperCase());
            set("cmRegion", (p.get("region") || "").toUpperCase());
            set("cmTrailer", (p.get("trailer") || "").toUpperCase());
            // Чекаємо, поки завантажиться реєстр (щоб знати телефони й назви)
            let tries = 0;
            const t = setInterval(() => {
                if ((typeof allCarriersCache !== "undefined" && allCarriersCache.length) || ++tries > 40) {
                    clearInterval(t);
                    if (document.getElementById("cmCountry").value) search();
                }
            }, 250);
        }
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
