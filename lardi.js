/* ================================================================= *
 * FURA — «ЛАРДІ»: заявки на вантажі з Lardi-Trans (лише з ціною)      *
 * Дані: таблиця lardi_cargo (заповнює Edge Function fura-lardi через  *
 * Lardi API щоранку та кнопкою «Оновити зараз»). Тут — лише перегляд.  *
 * ================================================================= */

const SUPABASE_URL = "https://prbfscwmemshwigiftha.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function logout() {
    await sbClient.auth.signOut();
    window.location.href = "login.html";
}

function toggleSidebar() {
    document.body.classList.toggle("sidebar-collapsed");
    const icon = document.querySelector("#sidebarToggleBtn i");
    if (icon) {
        icon.classList.toggle("bx-chevron-left");
        icon.classList.toggle("bx-chevron-right");
    }
}

const LD = (() => {
    const $ = (s) => document.querySelector(s);
    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const fmt = (n, d = 0) => (n == null || isNaN(n) ? "" : Number(n).toLocaleString("uk-UA", { maximumFractionDigits: d, minimumFractionDigits: d }));
    const CUR = { EUR: "€", USD: "$", UAH: "грн", PLN: "zł" };
    const money = (v, c) => (v == null ? "" : `${fmt(v)} ${CUR[c] || c || ""}`.trim());
    const dd = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : "");
    const median = (a) => {
        const s = a.filter((x) => x != null && !isNaN(x)).sort((x, y) => x - y);
        if (!s.length) return null;
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const regionOf = (r, side) => r[side + "_region"] || r[side + "_town"] || "—";
    // «50» знайде квадрат 50 і індекси 50-001, 50123…; шукаємо також у тексті точок («85 кв.»)
    const zipMatch = (r, side, z) => {
        const q = String(z).replace(/\D/g, "");
        if (!q) return true;
        const zone = String(r[side + "_zone"] || ""), pc = String(r[side + "_postcode"] || "").replace(/\D/g, "");
        return zone.startsWith(q) || pc.startsWith(q) || (q.length <= 2 && zone && q.startsWith(zone));
    };
    const kindOf = (r) => (r.groupage ? "groupage" : r.mass_t != null && r.mass_t < 10 ? "light" : "full");
    const KIND = { full: "Повна", light: "До 10 т", groupage: "Догруз" };
    // Посилання на заявку на Lardi: пошук її напрямку + картка заявки (коди країн — з функції)
    const LARDI_C = { PL: 491, DE: 100, TR: 625, UA: 640 };
    const lardiUrl = (r) => {
        if (r.lardi_url) return r.lardi_url;
        const f = LARDI_C[r.from_country], t = LARDI_C[r.to_country];
        return `https://lardi-trans.com/log/search/gruz${f && t ? `/wf1i${f}iwt1i${t}iq1pc4pt1` : ""}?currentId=${encodeURIComponent(r.id)}`;
    };
    const OWNER_CLS = { "Вантажовласник": "own-ship", "Перевізник": "own-car", "Експедиція / інші": "own-exp" };
    const CN = { UA: "Україна", PL: "Польща", DE: "Німеччина", CZ: "Чехія", SK: "Словаччина", HU: "Угорщина", RO: "Румунія", BG: "Болгарія",
        MD: "Молдова", LT: "Литва", LV: "Латвія", EE: "Естонія", AT: "Австрія", CH: "Швейцарія", LI: "Ліхтенштейн", IT: "Італія", FR: "Франція",
        ES: "Іспанія", PT: "Португалія", NL: "Нідерланди", BE: "Бельгія", LU: "Люксембург", DK: "Данія", SE: "Швеція", NO: "Норвегія",
        FI: "Фінляндія", IS: "Ісландія", GB: "Велика Британія", IE: "Ірландія", SI: "Словенія", HR: "Хорватія", BA: "Боснія і Герцеговина",
        RS: "Сербія", ME: "Чорногорія", MK: "Північна Македонія", AL: "Албанія", XK: "Косово", GR: "Греція", CY: "Кіпр", MT: "Мальта",
        TR: "Туреччина", GE: "Грузія", AM: "Вірменія", AZ: "Азербайджан", KZ: "Казахстан", UZ: "Узбекистан", KG: "Киргизстан",
        TJ: "Таджикистан", TM: "Туркменістан" };
    const OWNER_LBL = { "Вантажовласник": "Вантажовласник", "Перевізник": "Власник транспорту", "Експедиція / інші": "Експедиція" };
    const PAGE = 100;
    const FKEY = "fura_lardi_filters";

    let ROWS = [];
    let DIRS = [];
    let BOSS = false;
    const DEF = { period: "3", fromC: "", fromQ: "", toC: "", toQ: "", massMin: "", massMax: "", volMin: "", volMax: "", dateFrom: "", dateTo: "",
        body: "", priceMin: "", cur: "", unit: "total", owners: [], kind: "", adr: "" };
    const st = { view: "loads", q: "", ...DEF, page: 0, sort: "seen", asc: false, route: "" };

    /* ---------------- фільтри ---------------- */
    function save() {
        try { localStorage.setItem(FKEY, JSON.stringify({ ...st, q: "", page: 0, route: "" })); } catch (e) { /* без збереження */ }
    }
    function restore() {
        try { Object.assign(st, JSON.parse(localStorage.getItem(FKEY) || "{}")); } catch (e) { /* типові */ }
        if (!Array.isArray(st.owners)) st.owners = [];
        syncForm();
    }
    // Поля форми ↔ стан: кожне поле має data-f="ключ"
    function syncForm() {
        document.querySelectorAll("#ldForm [data-f]").forEach((el) => { el.value = st[el.dataset.f] ?? ""; });
        document.querySelectorAll("#ldOwners [data-owner]").forEach((b) => b.classList.toggle("on", st.owners.includes(b.dataset.owner)));
        document.querySelectorAll(".ld-seg [data-unit]").forEach((b) => b.classList.toggle("on", b.dataset.unit === st.unit));
    }

    // «Місто, область, квадрат, індекс»: цифри — квадрат / індекс, текст — місто, область, точки
    function placeMatch(r, side, query) {
        const q = String(query || "").trim().toLowerCase();
        if (!q) return true;
        if (/^\d+$/.test(q.replace(/[\s-]/g, ""))) return zipMatch(r, side, q);
        const hay = [r[side + "_town"], r[side + "_region"], r[side + "_points"]].join(" ").toLowerCase();
        return q.split(/[,;]+/).map((x) => x.trim()).filter(Boolean).some((part) => hay.includes(part));
    }
    const num = (v) => (v === "" || v == null ? null : Number(v));

    function filtered() {
        const q = st.q.trim().toLowerCase();
        const [mMin, mMax, vMin, vMax, pMin] = [num(st.massMin), num(st.massMax), num(st.volMin), num(st.volMax), num(st.priceMin)];
        return ROWS.filter((r) => {
            if (st.fromC && r.from_country !== st.fromC) return false;
            if (st.toC && r.to_country !== st.toC) return false;
            if (!placeMatch(r, "from", st.fromQ)) return false;
            if (!placeMatch(r, "to", st.toQ)) return false;
            if (mMin != null && !(r.mass_t >= mMin)) return false;
            if (mMax != null && !(r.mass_t <= mMax)) return false;
            if (vMin != null && !(r.volume_m3 >= vMin)) return false;
            if (vMax != null && !(r.volume_m3 <= vMax)) return false;
            if (st.dateFrom && (r.date_to || r.date_from || "") < st.dateFrom) return false;
            if (st.dateTo && (r.date_from || "") > st.dateTo) return false;
            if (st.body && !String(r.body_types || "").toLowerCase().includes(st.body)) return false;
            if (st.cur && r.currency !== st.cur) return false;
            if (pMin != null && !((st.unit === "km" ? r.price_per_km : r.price) >= pMin)) return false;
            if (st.owners.length && !st.owners.includes(r.owner_type)) return false;
            if (st.kind && kindOf(r) !== st.kind) return false;
            if (st.adr === "adr" && !r.adr) return false;
            if (st.adr === "noadr" && r.adr) return false;
            if (st.route && `${r.from_region || "—"} → ${r.to_region || "—"}` !== st.route) return false;
            if (q) {
                const hay = [r.from_points, r.to_points, r.cargo, r.owner_name, r.owner_face, r.owner_phone, r.body_types].join(" ").toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }

    /* ---------------- KPI ---------------- */
    function kpis(rows) {
        const eur = rows.filter((r) => r.currency === "EUR" && r.price_per_km != null && kindOf(r) === "full");
        const med = median(eur.map((r) => r.price_per_km));
        const medPrice = median(eur.map((r) => r.price));
        const owners = new Set(rows.map((r) => r.owner_ref || r.owner_name)).size;
        $("#ldKpis").innerHTML = [
            [fmt(rows.length), "заявок з ціною"],
            [med != null ? fmt(med, 2) : "—", "медіана €/км (повні, EUR)"],
            [medPrice != null ? fmt(medPrice) + " €" : "—", "медіана за рейс (повні, EUR)"],
            [fmt(owners), "компаній виставляють"],
        ].map(([b, s], i) => `<div class="ld-kpi ${i === 1 ? "ld-kpi-hl" : ""}"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join("");
    }

    /* ---------------- таблиці ---------------- */
    const th = (key, label, cls = "") =>
        key ? `<th class="${cls} ld-sortable" data-sort="${key}">${esc(label)}${st.sort === key ? (st.asc ? " ▲" : " ▼") : ""}</th>` : `<th class="${cls}">${esc(label)}</th>`;

    function sortRows(rows, getters) {
        const g = getters[st.sort] || getters.seen;
        return rows.slice().sort((a, b) => {
            const va = g(a), vb = g(b);
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            const c = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "uk");
            return st.asc ? c : -c;
        });
    }

    function renderLoads(rows) {
        rows = sortRows(rows, {
            seen: (r) => r.seen_last, date: (r) => r.date_from, price: (r) => r.price, km: (r) => r.price_per_km,
            mass: (r) => r.mass_t, dist: (r) => r.distance_km, owner: (r) => r.owner_name,
        });
        const total = rows.length;
        const pageRows = rows.slice(st.page * PAGE, st.page * PAGE + PAGE);
        $("#ldTable").innerHTML =
            `<thead><tr>${th("date", "Завантаження")}${th("", "Звідки")}${th("", "Куди")}${th("", "Товар")}${th("mass", "Вага", "num")}${th("", "Кузов")}` +
            `${th("dist", "Км", "num")}${th("price", "Ціна", "num")}${th("km", "За км", "num")}${th("owner", "Хто виставляє")}</tr></thead><tbody>` +
            (pageRows.length
                ? pageRows.map((r) => {
                    const k = kindOf(r);
                    return `<tr>
                        <td class="nw">${esc(dd(r.date_from))}${r.date_to && r.date_to !== r.date_from ? "–" + esc(dd(r.date_to)) : ""}<div class="ld-sm ld-muted">${esc(r.direction || "")}</div>
                            <a class="ld-open" href="${esc(lardiUrl(r))}" target="_blank" rel="noopener" title="Відкрити заявку на Lardi">Lardi ↗</a></td>
                        <td><b>${esc(r.from_town || "")}</b>${r.from_zone ? ` <span class="ld-muted ld-sm">${esc(r.from_zone)} кв.</span>` : ""}<div class="ld-sm ld-muted">${esc(r.from_region && r.from_region !== r.from_town ? r.from_region : "")}${r.from_country && r.from_country !== "UA" ? " · " + esc(r.from_country) : ""}</div></td>
                        <td><b>${esc(r.to_town || "")}</b>${r.to_zone ? ` <span class="ld-muted ld-sm">${esc(r.to_zone)} кв.</span>` : ""}<div class="ld-sm ld-muted">${esc(r.to_region && r.to_region !== r.to_town ? r.to_region : "")}${r.to_country !== "UA" ? " · " + esc(r.to_country || "") : ""}</div></td>
                        <td class="ld-clip" title="${esc(r.cargo || "")}">${esc(r.cargo || "")}
                            <div class="ld-tags">${k !== "full" ? `<span class="ld-tag">${KIND[k]}</span>` : ""}${r.adr ? `<span class="ld-tag ld-tag-adr">ADR ${esc(r.adr)}</span>` : ""}</div></td>
                        <td class="num nw">${r.mass_t != null ? fmt(r.mass_t, 1) + " т" : ""}</td>
                        <td class="ld-clip" title="${esc(r.body_types || "")}">${esc(r.body_types || "")}</td>
                        <td class="num">${fmt(r.distance_km)}</td>
                        <td class="num nw"><b>${esc(money(r.price ?? r.payment_raw, r.currency))}</b>${r.payment_forms ? `<div class="ld-sm ld-muted">${esc(r.payment_forms)}</div>` : ""}${r.delay_days ? `<div class="ld-sm ld-muted">відстрочка ${fmt(r.delay_days)} дн.</div>` : ""}</td>
                        <td class="num nw">${r.price_per_km != null ? fmt(r.price_per_km, 2) + " " + (CUR[r.currency] || "") : ""}</td>
                        <td><span class="ld-own ${OWNER_CLS[r.owner_type] || ""}">${esc(OWNER_LBL[r.owner_type] || r.owner_type || "")}</span>
                            <div><b>${esc(r.owner_name || "")}</b>${r.owner_rating ? ` <span class="ld-muted ld-sm">★ ${fmt(r.owner_rating, 1)}</span>` : ""}</div>
                            <div class="ld-sm">${esc(r.owner_face || "")} ${r.owner_phone ? `<a href="tel:${esc(r.owner_phone)}">${esc(r.owner_phone)}</a>` : ""}</div></td>
                    </tr>`;
                }).join("")
                : `<tr><td colspan="10" class="ld-empty">Немає заявок за цими фільтрами</td></tr>`) +
            "</tbody>";
        pager(total);
        $("#ldCount").textContent = `${fmt(total)} заявок`;
    }

    function groupBy(rows, keyFn) {
        const m = new Map();
        for (const r of rows) {
            const k = keyFn(r);
            if (!m.has(k)) m.set(k, []);
            m.get(k).push(r);
        }
        return m;
    }
    const rangeTxt = (a, f) => {
        const v = a.filter((x) => x != null && !isNaN(x));
        if (!v.length) return "";
        const lo = Math.min(...v), hi = Math.max(...v);
        return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
    };

    function renderRoutes(rows) {
        const g = groupBy(rows, (r) => `${r.from_region || "—"} → ${r.to_region || "—"}`);
        let list = [...g].map(([route, a]) => {
            const full = a.filter((r) => kindOf(r) === "full" && r.currency === "EUR");
            const owners = groupBy(a, (r) => r.owner_type || "");
            return {
                route, n: a.length, full: a.filter((r) => kindOf(r) === "full").length,
                mass: rangeTxt(a.map((r) => r.mass_t), (v) => fmt(v, 1)),
                price: rangeTxt(full.map((r) => r.price), (v) => fmt(v)),
                med: median(full.map((r) => r.price_per_km)),
                km: rangeTxt(full.map((r) => r.price_per_km), (v) => fmt(v, 1)),
                ship: (owners.get("Вантажовласник") || []).length,
                car: (owners.get("Перевізник") || []).length,
                exp: (owners.get("Експедиція / інші") || []).length,
                bodies: [...groupBy(a.flatMap((r) => String(r.body_types || "").split(",").map((s) => s.trim()).filter(Boolean).map((b) => ({ b }))), (x) => x.b)]
                    .sort((x, y) => y[1].length - x[1].length).slice(0, 3).map((x) => x[0]).join(", "),
            };
        });
        list = sortRows(list, { seen: (r) => r.n, n: (r) => r.n, med: (r) => r.med, route: (r) => r.route });
        const total = list.length;
        const pageRows = list.slice(st.page * PAGE, st.page * PAGE + PAGE);
        $("#ldTable").innerHTML =
            `<thead><tr>${th("route", "Звідки → куди")}${th("n", "Заявок", "num")}${th("", "Повних", "num")}${th("", "Вага, т", "num")}` +
            `${th("", "Ціна повних, €", "num")}${th("med", "Медіана €/км", "num")}${th("", "€/км від–до", "num")}${th("", "Вантажовл. / Власн. трансп. / Експед.", "num")}${th("", "Кузов")}</tr></thead><tbody>` +
            (pageRows.length
                ? pageRows.map((r) => `<tr class="ld-click" data-route="${esc(r.route)}">
                    <td><b>${esc(r.route)}</b></td><td class="num">${r.n}</td><td class="num">${r.full || ""}</td><td class="num">${esc(r.mass)}</td>
                    <td class="num">${esc(r.price)}</td><td class="num"><b>${r.med != null ? fmt(r.med, 2) : ""}</b></td><td class="num ld-muted">${esc(r.km)}</td>
                    <td class="num">${r.ship} / ${r.car} / ${r.exp}</td><td class="ld-muted">${esc(r.bodies)}</td></tr>`).join("")
                : `<tr><td colspan="9" class="ld-empty">Немає даних</td></tr>`) +
            "</tbody>";
        pager(total);
        $("#ldCount").textContent = `${fmt(total)} напрямків · клік по рядку — його заявки`;
    }

    function renderOwners(rows) {
        // ринок по напрямку: медіана медіан компаній (щоб одна компанія з 40 заявками не «тягнула» ринок)
        const route = (r) => `${r.from_region || "—"} → ${r.to_region || "—"}`;
        const priced = rows.filter((r) => kindOf(r) === "full" && r.currency === "EUR" && r.price_per_km != null);
        const bench = new Map();
        for (const [k, a] of groupBy(priced, route)) {
            const byOwner = groupBy(a, (r) => r.owner_ref || r.owner_name);
            if (byOwner.size >= 2) bench.set(k, median([...byOwner.values()].map((x) => median(x.map((r) => r.price_per_km)))));
        }
        let list = [...groupBy(rows, (r) => r.owner_ref || r.owner_name)].map(([, a]) => {
            const p = a.filter((r) => kindOf(r) === "full" && r.currency === "EUR" && r.price_per_km != null);
            const ratios = p.filter((r) => bench.has(route(r))).map((r) => r.price_per_km / bench.get(route(r)) - 1);
            return {
                name: a[0].owner_name, type: a[0].owner_type, face: a[0].owner_face, phone: a[0].owner_phone, rating: a[0].owner_rating,
                n: a.length, priced: p.length, med: median(p.map((r) => r.price_per_km)), vs: median(ratios),
                routes: new Set(a.map(route)).size,
            };
        });
        list = sortRows(list, { seen: (r) => r.n, n: (r) => r.n, med: (r) => r.med, vs: (r) => r.vs, name: (r) => r.name });
        const total = list.length;
        const pageRows = list.slice(st.page * PAGE, st.page * PAGE + PAGE);
        const pct = (v) => (v == null ? "" : (v > 0 ? "+" : "") + Math.round(v * 100) + "%");
        $("#ldTable").innerHTML =
            `<thead><tr>${th("name", "Компанія")}${th("", "Хто")}${th("n", "Заявок", "num")}${th("med", "Медіана €/км", "num")}` +
            `${th("vs", "До ринку", "num")}${th("", "Напрямків", "num")}${th("", "Контакт")}</tr></thead><tbody>` +
            (pageRows.length
                ? pageRows.map((r) => `<tr>
                    <td><b>${esc(r.name || "")}</b>${r.rating ? ` <span class="ld-muted ld-sm">★ ${fmt(r.rating, 1)}</span>` : ""}</td>
                    <td><span class="ld-own ${OWNER_CLS[r.type] || ""}">${esc(OWNER_LBL[r.type] || r.type || "")}</span></td>
                    <td class="num">${r.n}</td><td class="num">${r.med != null ? fmt(r.med, 2) : ""}</td>
                    <td class="num ${r.vs > 0.05 ? "ld-up" : r.vs < -0.05 ? "ld-down" : ""}" title="Наскільки ставка компанії вища/нижча за звичайну на тих самих напрямках">${pct(r.vs)}</td>
                    <td class="num">${r.routes}</td>
                    <td class="ld-sm">${esc(r.face || "")} ${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : ""}</td></tr>`).join("")
                : `<tr><td colspan="7" class="ld-empty">Немає даних</td></tr>`) +
            "</tbody>";
        pager(total);
        $("#ldCount").textContent = `${fmt(total)} компаній`;
    }

    function pager(total) {
        const pages = Math.max(1, Math.ceil(total / PAGE));
        if (st.page >= pages) st.page = pages - 1;
        const html = pages > 1
            ? `<button class="pager-btn" data-p="${st.page - 1}" ${st.page ? "" : "disabled"}><i class="bx bx-chevron-left"></i></button>` +
              `<span class="ld-muted">${st.page + 1} / ${pages}</span>` +
              `<button class="pager-btn" data-p="${st.page + 1}" ${st.page < pages - 1 ? "" : "disabled"}><i class="bx bx-chevron-right"></i></button>`
            : "";
        $("#ldPager").innerHTML = html;
        $("#ldPagerTop").innerHTML = html;
    }

    function render() {
        const rows = filtered();
        $("#ldFound").textContent = `Знайдено ${fmt(rows.length)}`;
        kpis(rows);
        document.querySelectorAll("#ldViews button").forEach((b) => b.classList.toggle("active", b.dataset.v === st.view));
        if (st.view === "routes") renderRoutes(rows);
        else if (st.view === "owners") renderOwners(rows);
        else renderLoads(rows);
        if (st.route && st.view === "loads") $("#ldCount").textContent += ` · напрямок: ${st.route} (✕ скинути — «Скинути»)`;
    }

    /* ---------------- дані ---------------- */
    async function load() {
        const since = new Date(Date.now() - Number(st.period || 3) * 86400000);
        if (st.period === "1") since.setHours(0, 0, 0, 0);
        const cols = "id,lardi_url:raw->>_lardi_url,seen_last,direction,from_country,to_country,from_zone,from_postcode,to_zone,to_postcode,from_town,from_region,from_points,to_town,to_region,to_points,date_from,date_to,distance_km,cargo,mass_t,volume_m3,body_types,load_types,adr,groupage,price,price_per_km,currency,payment_raw,payment_forms,delay_days,owner_ref,owner_name,owner_face,owner_phone,owner_type,owner_rating";
        const out = [];
        for (let from = 0; from < 20000; from += 1000) {
            const { data, error } = await sbClient.from("lardi_cargo").select(cols).gte("seen_last", since.toISOString()).order("seen_last", { ascending: false }).range(from, from + 999);
            if (error) throw error;
            out.push(...data);
            if (data.length < 1000) break;
        }
        ROWS = out;
        fillPlaces();
        const bodies = new Set();
        ROWS.forEach((r) => String(r.body_types || "").split(",").forEach((b) => b.trim() && bodies.add(b.trim().toLowerCase())));
        $("#ldBody").innerHTML = `<option value="">Тип транспорту</option>` + [...bodies].sort().map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
        $("#ldBody").value = st.body;
        render();
    }

    // Країни — з даних; підказки «Місто, область» — міста й регіони обраної країни
    function fillPlaces() {
        const sorted = (set) => [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, "uk"));
        const set = (side) => {
            const c = st[side + "C"];
            const countries = sorted(new Set(ROWS.map((r) => r[side + "_country"])));
            const sel = document.querySelector(`#ldForm [data-f="${side}C"]`);
            countries.sort((a, b) => (a === "UA" ? -1 : b === "UA" ? 1 : (CN[a] || a).localeCompare(CN[b] || b, "uk")));
            sel.innerHTML = `<option value="">Країна</option>` + countries.map((v) => `<option value="${esc(v)}">${esc(v)} · ${esc(CN[v] || v)}</option>`).join("");
            sel.value = c;
            const rows = ROWS.filter((r) => !c || r[side + "_country"] === c);
            const names = sorted(new Set(rows.flatMap((r) => [r[side + "_region"], r[side + "_town"]])));
            $(side === "from" ? "#ldFromList" : "#ldToList").innerHTML = names.slice(0, 400).map((v) => `<option value="${esc(v)}"></option>`).join("");
        };
        set("from");
        set("to");
    }

    async function loadMeta() {
        const [{ data: dirs }, { data: runs }] = await Promise.all([
            sbClient.from("lardi_directions").select("*").order("id"),
            sbClient.from("lardi_runs").select("*").order("started_at", { ascending: false }).limit(1),
        ]);
        DIRS = dirs || [];
        const r = runs?.[0];
        if (!r) {
            $("#ldSync").textContent = "Ще не оновлювалось";
        } else {
            const t = new Date(r.finished_at || r.started_at);
            $("#ldSync").innerHTML = `Оновлено ${esc(t.toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))} · знайдено ${fmt(r.found)}`;
        }
        const alert = $("#ldAlert");
        if (r?.error) {
            alert.textContent = "Останнє оновлення з помилкою: " + r.error;
            alert.classList.remove("hidden", "ld-info");
        } else alert.classList.add("hidden");
        renderDirs();
    }

    function renderDirs() {
        const row = (d) => `<div class="ld-dir-row">
                <label><input type="checkbox" data-dir-toggle="${d.id}" ${d.active ? "checked" : ""}/> <b>${esc(d.from_country)} → ${esc(d.to_country)}</b>
                <small>${d.last_run_at ? new Date(d.last_run_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " · " + fmt(d.last_found) : "ще не оновлювався"}</small></label>
                <button type="button" class="ld-link" data-dir-del="${d.id}">видалити</button></div>`;
        const imp = DIRS.filter((d) => d.to_country === "UA"), exp = DIRS.filter((d) => d.from_country === "UA"), other = DIRS.filter((d) => d.to_country !== "UA" && d.from_country !== "UA");
        $("#ldDirsList").innerHTML = DIRS.length
            ? [["Імпорт в Україну", imp], ["Експорт з України", exp], ["Інші", other]].filter(([, a]) => a.length)
                .map(([t, a]) => `<div class="ld-dirs-sec">${t}</div>` + a.map(row).join("")).join("")
            : `<div class="ld-muted">Напрямків ще немає</div>`;
    }

    async function call(body) {
        const { data, error } = await sbClient.functions.invoke("fura-lardi", { body });
        if (error) {
            let message = "Сервер не відповів. Перевірте, чи розгорнута функція fura-lardi.";
            try { const j = await error.context?.json?.(); if (j?.error) message = j.error; } catch (e) { /* типове */ }
            throw new Error(message);
        }
        return data;
    }

    async function runNow() {
        const btn = $("#ldRunBtn");
        btn.disabled = true;
        btn.innerHTML = `<i class="bx bx-loader-alt bx-spin"></i> Оновлюю… (до 2 хв)`;
        try {
            const res = await call({ action: "run" });
            await loadMeta();
            await load();
            const a = $("#ldAlert");
            const done = (res?.directions || []).length;
            if (res?.error) {
                a.textContent = res.error;
                a.classList.remove("ld-info", "hidden");
            } else if (res?.left) {
                a.textContent = `Оновлено ${done} напрямків, знайдено ${fmt(res.found)} заявок з ціною. Ще ${res.left} напрямків — натисніть «Оновити зараз» ще раз або дочекайтесь ранкового розкладу.`;
                a.classList.add("ld-info");
                a.classList.remove("hidden");
            }
        } catch (e) {
            const alert = $("#ldAlert");
            alert.textContent = e.message;
            alert.classList.remove("hidden", "ld-info");
            await loadMeta().catch(() => {});
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<i class="bx bx-refresh"></i> Оновити зараз`;
        }
    }

    async function dirOp(body) {
        try {
            await call({ action: "directions", ...body });
            await loadMeta();
        } catch (e) {
            alert(e.message);
        }
    }

    /* ---------------- події ---------------- */
    function bind() {
        const rerender = () => { st.page = 0; save(); render(); };
        let t;
        $("#ldQ").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; rerender(); }, 200); });
        const form = $("#ldForm");
        const onField = (el) => {
            const k = el.dataset.f;
            st[k] = el.value;
            if (k === "period") { save(); load(); return; }
            if (k === "fromC" || k === "toC") fillPlaces();
            rerender();
        };
        form.addEventListener("change", (e) => { if (e.target.dataset.f) onField(e.target); });
        form.addEventListener("input", (e) => {
            const el = e.target;
            if (!el.dataset.f || el.tagName === "SELECT") return;
            clearTimeout(t);
            t = setTimeout(() => onField(el), 300);
        });
        $("#ldOwners").addEventListener("click", (e) => {
            const b = e.target.closest("[data-owner]");
            if (!b) return;
            const o = b.dataset.owner;
            st.owners = st.owners.includes(o) ? st.owners.filter((x) => x !== o) : [...st.owners, o];
            syncForm();
            rerender();
        });
        form.querySelectorAll(".ld-seg [data-unit]").forEach((b) => b.addEventListener("click", () => { st.unit = b.dataset.unit; syncForm(); rerender(); }));
        $("#ldSwap").addEventListener("click", () => {
            [st.fromC, st.toC, st.fromQ, st.toQ] = [st.toC, st.fromC, st.toQ, st.fromQ];
            fillPlaces();
            syncForm();
            rerender();
        });
        $("#ldReset").addEventListener("click", () => {
            const keepPeriod = st.period;
            Object.assign(st, { ...DEF, period: keepPeriod, owners: [], q: "", route: "", page: 0 });
            $("#ldQ").value = "";
            fillPlaces();
            syncForm();
            save();
            render();
        });
        $("#ldViews").addEventListener("click", (e) => {
            const b = e.target.closest("button[data-v]");
            if (!b) return;
            st.view = b.dataset.v;
            st.sort = "seen"; st.asc = false; st.page = 0;
            if (st.view !== "loads") st.route = "";
            save();
            render();
        });
        $("#ldTable").addEventListener("click", (e) => {
            const h = e.target.closest("th[data-sort]");
            if (h) {
                const k = h.dataset.sort;
                if (st.sort === k) st.asc = !st.asc; else { st.sort = k; st.asc = false; }
                render();
                return;
            }
            const tr = e.target.closest("tr[data-route]");
            if (tr) {
                st.route = tr.dataset.route;
                st.view = "loads"; st.sort = "seen"; st.asc = false; st.page = 0;
                render();
            }
        });
        document.querySelectorAll("#ldPager, #ldPagerTop").forEach((p) =>
            p.addEventListener("click", (e) => {
                const b = e.target.closest("button[data-p]");
                if (!b || b.disabled) return;
                st.page = Number(b.dataset.p);
                render();
                $(".ld-scroll").scrollTop = 0;
            }));
        $("#ldRunBtn").addEventListener("click", runNow);
        $("#ldDirsBtn").addEventListener("click", () => $("#ldDirsModal").classList.remove("hidden"));
        $("#ldDirsModal").addEventListener("click", (e) => {
            if (e.target.matches("[data-close]") || e.target.id === "ldDirsModal") $("#ldDirsModal").classList.add("hidden");
            const del = e.target.closest("[data-dir-del]");
            if (del && confirm("Видалити напрямок?")) dirOp({ op: "delete", id: Number(del.dataset.dirDel) });
        });
        $("#ldDirsModal").addEventListener("change", (e) => {
            const tg = e.target.closest("[data-dir-toggle]");
            if (tg) dirOp({ op: "toggle", id: Number(tg.dataset.dirToggle), active: tg.checked });
        });
        $("#ldDirAdd").addEventListener("click", () => {
            dirOp({ op: "add", from: $("#ldDirFrom").value, to: $("#ldDirTo").value });
            $("#ldDirFrom").value = "";
            $("#ldDirTo").value = "";
        });
    }

    async function init() {
        restore();
        bind();
        await loadMeta();
        await load();
        try {
            const s = await call({ action: "status" });
            BOSS = !!s?.boss;
            $("#ldDirsBtn").hidden = !BOSS;
            if (s && !s.key) {
                const a = $("#ldAlert");
                a.textContent = "Не задано ключ Lardi API (секрет LARDI_API_KEY у функції fura-lardi).";
                a.classList.remove("hidden");
            }
        } catch (e) { /* функція ще не розгорнута — сторінка все одно показує дані */ }
    }

    return { init };
})();

document.addEventListener("DOMContentLoaded", async () => {
    const {
        data: { session },
    } = await sbClient.auth.getSession();
    if (!session) {
        window.location.href = "login.html";
        return;
    }
    document.body.style.visibility = "visible";
    sbClient.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") window.location.href = "login.html";
    });
    try {
        await LD.init();
    } catch (e) {
        console.error(e);
        const a = document.querySelector("#ldAlert");
        a.textContent = "Не вдалося завантажити дані: " + (e.message || e) + ". Чи виконано lardi.sql у Supabase?";
        a.classList.remove("hidden");
        document.querySelector("#ldSync").textContent = "";
    }
});
