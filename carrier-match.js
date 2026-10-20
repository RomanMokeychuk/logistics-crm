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
    // «Бухарест (3), Констанца» -> Map{Бухарест:3, Констанца:1}
    function addCounts(map, txt) {
        String(txt || "")
            .split(/,\s*(?![^()]*\))/)
            .map((x) => x.trim())
            .filter(Boolean)
            .forEach((x) => {
                const m = x.match(/^(.*?)\s*\((\d+)\)$/);
                const name = (m ? m[1] : x).trim();
                if (name) map.set(name, (map.get(name) || 0) + (m ? Number(m[2]) : 1));
            });
    }
    const topCounts = (map, n) =>
        [...map.entries()]
            .sort((x, y) => y[1] - x[1])
            .slice(0, n)
            .map(([k, v]) => (v > 1 ? `${k} (${v})` : k))
            .join(", ");

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
            const more = e.target.closest("[data-cm-details]");
            if (more) {
                e.preventDefault();
                toggleDetails(more);
                return;
            }
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

        const query = (cols) => {
            let q = client.from("carrier_routes").select(cols).eq("country", country).limit(6000);
            if (dir) q = q.eq("direction", dir);
            if (region) q = q.eq("ua_region", region);
            if (trailer) q = q.ilike("trailer_types", `%${trailer}%`);
            if (border) q = q.ilike("border", `%${border}%`);
            return q;
        };
        const BASE = "edrpou, direction, country, ua_region, month, trucks, records, trailer_types, border, goods";
        let [{ data, error }] = await Promise.all([query(BASE + ", cities, ua_cities"), loadDealsStats()]);
        if (error && /cities|column/i.test(error.message || "")) ({ data, error } = await query(BASE)); // колонок міст ще немає
        if (error) {
            out.innerHTML = `<div class="cm-empty">${/carrier_routes/.test(error.message || "") ? "Ще не завантажені митні напрямки: запустіть carrier_routes.sql і завантажте carrier_routes.csv у Supabase." : "Помилка: " + esc(error.message)}</div>`;
            return;
        }

        // Збираємо по перевізнику
        const latest = (data || []).reduce((m, r) => (r.month > m ? r.month : m), "");
        const by = new Map();
        for (const r of data || []) {
            const k = keyCode(r.edrpou);
            const a = by.get(k) || { code: r.edrpou, trucks: 0, records: 0, months: new Set(), regions: new Map(), borders: new Map(), trailers: new Set(), goods: new Set(), dirs: new Set(), cities: new Map(), uaCities: new Map() };
            addCounts(a.cities, r.cities);
            addCounts(a.uaCities, r.ua_cities);
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
                            ${a.cities.size ? `<div class="cm-facts cm-cities"><span>🏁 ${[...a.dirs].length === 1 ? ([...a.dirs][0] === "Імпорт" ? "Звідки (місто)" : "Куди (місто)") : "Міста"}: <b>${esc(topCounts(a.cities, 6))}</b></span></div>` : `<div class="cm-facts cm-light"><span>🏁 Місто ${[...a.dirs][0] === "Імпорт" ? "відправлення" : "призначення"} в деклараціях не вказане</span></div>`}
                            ${a.uaCities.size ? `<div class="cm-facts cm-light"><span>🇺🇦 ${[...a.dirs].length === 1 ? ([...a.dirs][0] === "Імпорт" ? "Куди в Україні" : "Звідки в Україні") : "В Україні"}: ${esc(topCounts(a.uaCities, 5))}</span></div>` : ""}
                            <div class="cm-facts cm-light">
                                ${[...a.trailers].slice(0, 4).map((t) => `<span class="cm-trailer">${esc(t)}</span>`).join("")}
                                ${a.goods.size ? `<span>везли: ${esc([...a.goods].slice(0, 3).join("; "))}</span>` : ""}
                            </div>
                            <button type="button" class="cm-more" data-cm-details="${esc(a.code)}" data-cm-name="${esc(c ? c.name || c.company || "" : "")}" data-cm-id="${esc(c?.id || "")}" data-cm-phone="${esc(phone)}" data-cm-person="${esc(c?.contact_person_1 || "")}">🔎 Деталі: усі напрямки, міста, номери</button>
                        </div>
                        <div class="cm-contact">
                            ${c?.contact_person_1 ? `<div class="cm-person">${esc(c.contact_person_1)}</div>` : ""}
                            ${phone ? `<a href="tel:+${digits}">${esc(phone)}</a> <a class="viber-link" href="viber://chat?number=%2B${digits}" title="Viber"><i class="bx bxs-message-rounded-dots"></i></a>` : `<span class="cm-sub">телефону немає</span>`}
                        </div>
                    </div>`;
                })
                .join("");
    }

    /* ---------- Деталі перевізника (усі напрямки з містами) ---------- */
    async function loadRoutes(code) {
        const c = String(code || "").replace(/\D/g, "");
        const codes = [...new Set([c, c.replace(/^0+/, ""), c.padStart(8, "0")])];
        const BASE = "direction, country, ua_region, month, trucks, records, trailer_types, border, goods, plates";
        const q = (cols) => client.from("carrier_routes").select(cols).in("edrpou", codes).limit(1000);
        const res = await q(BASE + ", borders, cities, ua_cities");
        if (res.error && /cities|borders|column/i.test(res.error.message || "")) return q(BASE); // колонок міст ще немає
        return res;
    }

    function routesHtml(data, focusCountry) {
        const by = new Map();
        for (const r of data) {
            const k = r.direction + "|" + r.country;
            const a = by.get(k) || { dir: r.direction, country: r.country, trucks: 0, records: 0, months: new Set(), regions: new Map(), borders: new Map(), trailers: new Set(), cities: new Map(), uaCities: new Map(), plates: new Set(), goods: new Set() };
            a.trucks += r.trucks || 0;
            a.records += r.records || 0;
            a.months.add(r.month);
            if (r.ua_region) a.regions.set(cap(r.ua_region.replace(" ОБЛ.", "")) + " обл.", (a.regions.get(cap(r.ua_region.replace(" ОБЛ.", "")) + " обл.") || 0) + (r.records || 0));
            if (r.borders) addCounts(a.borders, r.borders);
            else if (r.border) a.borders.set(r.border, (a.borders.get(r.border) || 0) + (r.records || 0));
            String(r.trailer_types || "").split(";").map((x) => x.trim()).filter(Boolean).forEach((x) => a.trailers.add(x));
            addCounts(a.cities, r.cities);
            addCounts(a.uaCities, r.ua_cities);
            String(r.plates || "").split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean).forEach((x) => a.plates.add(x));
            String(r.goods || "").split(";").map((x) => x.trim()).filter(Boolean).forEach((x) => a.goods.add(x));
            by.set(k, a);
        }
        const rows = [...by.values()].sort((x, y) => (y.country === focusCountry) - (x.country === focusCountry) || y.records - x.records);
        return `<div class="cm-dtools"><span class="cm-sub">Напрямків: ${rows.length} · натисніть на напрямок, щоб розгорнути</span>
                <button type="button" class="cm-more" data-cm-all="1">Розгорнути всі</button><button type="button" class="cm-more" data-cm-all="0">Згорнути всі</button></div>
            <div class="cm-dcards">${rows
            .map(
                (a) => `<details class="cm-dcard${a.country === focusCountry ? " cm-focus" : ""}">
                    <summary class="cm-dhead"><span class="cm-dir ${a.dir === "Імпорт" ? "imp" : "exp"}">${a.dir === "Імпорт" ? "→ UA" : "UA →"}</span>
                        <b>${esc(cap(a.country))}</b>
                        <span class="cm-sub">${a.plates.size || a.trucks} маш. · ${a.records} відпр. · ${[...a.months].sort().map(monthName).join(", ")}</span></summary>
                    <dl>
                        <dt>🏁 ${a.dir === "Імпорт" ? "Звідки" : "Куди"}</dt><dd>${a.cities.size ? esc(topCounts(a.cities, 12)) : `<span class="cm-sub">у деклараціях не вказане</span>`}</dd>
                        <dt>🇺🇦 ${a.dir === "Імпорт" ? "Куди в UA" : "Звідки в UA"}</dt><dd>${esc(topCounts(a.regions, 4))}${a.uaCities.size ? `<div class="cm-sub">${esc(topCounts(a.uaCities, 10))}</div>` : ""}</dd>
                        ${a.trailers.size ? `<dt>🚚 Причіп</dt><dd>${[...a.trailers].map((t) => `<span class="cm-trailer">${esc(t)}</span>`).join(" ")}</dd>` : ""}
                    </dl>
                    ${a.borders.size ? `<details class="cm-pl"><summary>🛂 Кордон: <b>${a.borders.size}</b> — показати</summary><div class="cm-list">${[...a.borders.entries()].sort((x, y) => y[1] - x[1]).map(([b, n]) => `<div>${esc(b)}${n > 1 ? ` <span class="cm-sub">(${n})</span>` : ""}</div>`).join("")}</div></details>` : ""}
                    ${a.goods.size ? `<details class="cm-pl"><summary>📦 Везли — показати</summary><div class="cm-list">${[...a.goods].map((g) => `<div>${esc(g)}</div>`).join("")}</div></details>` : ""}
                    ${a.plates.size ? `<details class="cm-pl"><summary>🔢 Тягачі: <b>${a.plates.size}</b> — показати номери</summary><div class="cm-plates">${[...a.plates].sort().map((p) => `<span>${esc(p)}</span>`).join("")}</div></details>` : ""}
                </details>`,
            )
            .join("")}</div>`;
    }

    document.addEventListener("click", (e) => {
        const b = e.target.closest("[data-cm-all]");
        if (!b) return;
        const wrap = b.closest(".cm-dtools")?.nextElementSibling;
        wrap?.querySelectorAll(":scope > .cm-dcard").forEach((d) => (d.open = b.dataset.cmAll === "1"));
    });

    /* ---------- Вікно «Деталі» поверх сторінки ---------- */
    function modal() {
        let m = document.getElementById("cmModal");
        if (m) return m;
        m = document.createElement("div");
        m.id = "cmModal";
        m.className = "cm-modal";
        m.hidden = true;
        m.innerHTML = `<div class="cm-modal-box" role="dialog" aria-modal="true">
                <div class="cm-modal-head"><div class="cm-modal-title"></div><button type="button" class="cm-modal-x" title="Закрити (Esc)">×</button></div>
                <div class="cm-modal-body"></div>
            </div>`;
        document.body.appendChild(m);
        const close = () => {
            m.hidden = true;
            document.body.classList.remove("cm-modal-open");
        };
        m.addEventListener("click", (e) => {
            if (e.target === m || e.target.closest(".cm-modal-x")) close();
            const open = e.target.closest("[data-cm-card]");
            if (open && typeof openCarrierCard === "function") {
                close();
                openCarrierCard(open.dataset.cmCard);
            }
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !m.hidden) close();
        });
        return m;
    }

    async function toggleDetails(btn) {
        const m = modal();
        const d = btn.dataset;
        const digits = (d.cmPhone || "").replace(/\D/g, "");
        m.querySelector(".cm-modal-title").innerHTML = `
            <div class="cm-modal-name">${esc(d.cmName || "Немає в реєстрі")} <code>${esc(d.cmDetails)}</code></div>
            <div class="cm-modal-sub">
                ${d.cmPerson ? `<span>${esc(d.cmPerson)}</span>` : ""}
                ${digits ? `<a href="tel:+${digits}">${esc(d.cmPhone)}</a> <a class="viber-link" href="viber://chat?number=%2B${digits}" title="Viber"><i class="bx bxs-message-rounded-dots"></i></a>` : `<span class="cm-sub">телефону немає</span>`}
                ${d.cmId && typeof openCarrierCard === "function" ? `<button type="button" class="cm-more" data-cm-card="${esc(d.cmId)}">Картка перевізника →</button>` : ""}
            </div>`;
        const body = m.querySelector(".cm-modal-body");
        body.innerHTML = `<div class="cm-empty">Завантаження…</div>`;
        m.hidden = false;
        document.body.classList.add("cm-modal-open");
        const { data, error } = await loadRoutes(d.cmDetails);
        if (m.hidden) return;
        if (error) {
            body.innerHTML = `<div class="cm-empty">Помилка: ${esc(error.message)}</div>`;
            return;
        }
        body.innerHTML = (data || []).length ? routesHtml(data, document.getElementById("cmCountry").value) : `<div class="cm-empty">Немає даних.</div>`;
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

        const { data, error } = await loadRoutes(item.edrpou);
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
        out.innerHTML = routesHtml(data, "");
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
