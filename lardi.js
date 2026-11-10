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
    // Одна сторінка для двох вкладок: «Вантажі» (lardi.html) і «Авто» (lardi-trucks.html, window.LD_KIND = "truck")
    const TRUCK = window.LD_KIND === "truck";
    const KIND_RUN = TRUCK ? "truck" : "cargo";
    const TABLE = TRUCK ? "lardi_trucks" : "lardi_cargo";
    const ITEMS = TRUCK ? "машин" : "заявок";
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
        return `https://lardi-trans.com/log/search/${TRUCK ? "trans" : "gruz"}${f && t ? `/wf1i${f}iwt1i${t}iq1pc4pt1` : ""}?currentId=${encodeURIComponent(r.id)}`;
    };
    const OWNER_CLS = { "Вантажовласник": "own-ship", "Перевізник": "own-car", "Експедиція / інші": "own-exp" };
    const CN = { UA: "Україна", PL: "Польща", DE: "Німеччина", CZ: "Чехія", SK: "Словаччина", HU: "Угорщина", RO: "Румунія", BG: "Болгарія",
        MD: "Молдова", LT: "Литва", LV: "Латвія", EE: "Естонія", AT: "Австрія", CH: "Швейцарія", LI: "Ліхтенштейн", IT: "Італія", FR: "Франція",
        ES: "Іспанія", PT: "Португалія", NL: "Нідерланди", BE: "Бельгія", LU: "Люксембург", DK: "Данія", SE: "Швеція", NO: "Норвегія",
        FI: "Фінляндія", IS: "Ісландія", GB: "Велика Британія", IE: "Ірландія", SI: "Словенія", HR: "Хорватія", BA: "Боснія і Герцеговина",
        RS: "Сербія", ME: "Чорногорія", MK: "Північна Македонія", AL: "Албанія", XK: "Косово", GR: "Греція", CY: "Кіпр", MT: "Мальта",
        TR: "Туреччина", GE: "Грузія", AM: "Вірменія", AZ: "Азербайджан", KZ: "Казахстан", UZ: "Узбекистан", KG: "Киргизстан",
        TJ: "Таджикистан", TM: "Туркменістан" };
    // Усі країни світу (ISO), назви українською — як у списку Lardi «AD / Андорра»
    const ISO = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW".split(" ");
    let regionName = (c) => CN[c] || c;
    try { const dn = new Intl.DisplayNames(["uk"], { type: "region" }); regionName = (c) => CN[c] || (c === "XK" ? "Косово" : dn.of(c)) || c; } catch (e) { /* лише CN */ }
    const POPULAR = ["UA", "PL", "DE", "RO", "NL", "TR"];
    const OWNER_LBL = { "Вантажовласник": "Вантажовласник", "Перевізник": "Власник транспорту", "Експедиція / інші": "Експедиція" };
    const PAGE = 100;
    const FKEY = TRUCK ? "fura_lardi_trucks_filters" : "fura_lardi_filters";

    let ROWS = [];
    let DIRS = [];
    let BOSS = false;
    const DEF = { period: "3", fromC: "", fromQ: "", toC: "", toQ: "", massMin: "", massMax: "", volMin: "", volMax: "", dateFrom: "", dateTo: "",
        body: "", priceMin: "", cur: "", unit: "total", owners: [], kind: "", adr: "", fura: "", priced: "" };
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
        document.querySelectorAll("#ldForm [data-combo]").forEach((c) => { c.querySelector("input").value = st[c.dataset.combo] || ""; });
        document.querySelectorAll("#ldOwners [data-owner]").forEach((b) => b.classList.toggle("on", st.owners.includes(b.dataset.owner)));
        document.querySelectorAll("#ldFura [data-fura]").forEach((b) => b.classList.toggle("on", st.fura === b.dataset.fura));
        document.querySelectorAll("#ldFura [data-priced]").forEach((b) => b.classList.toggle("on", st.priced === "1"));
        document.querySelectorAll(".ld-seg [data-unit]").forEach((b) => b.classList.toggle("on", b.dataset.unit === st.unit));
        const flow = st.toC === "UA" && st.fromC !== "UA" ? "import" : st.fromC === "UA" && st.toC !== "UA" ? "export" : "";
        document.querySelectorAll(".ld-flow [data-flow]").forEach((b) => b.classList.toggle("on", b.dataset.flow === flow));
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
            if (!TRUCK && st.owners.length && !st.owners.includes(r.owner_type)) return false;
            if (!TRUCK && st.kind && kindOf(r) !== st.kind) return false;
            if (TRUCK && st.fura === "yes" && !r.carrier_id) return false;
            if (TRUCK && st.fura === "no" && r.carrier_id) return false;
            if (TRUCK && r.price == null && r.payment_raw == null) return false; // «Авто» — лише машини з ціною
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
        if (TRUCK) {
            const inFura = new Set(rows.filter((r) => r.carrier_id).map((r) => r.carrier_id)).size;
            const pricedTr = rows.filter((r) => r.currency === "EUR" && r.price_per_km != null);
            const trMed = median(pricedTr.map((r) => r.price_per_km));
            // вантажі — з тими самими фільтрами напрямку (країни, міста/області/квадрат, вибраний рядок «Напрямків»)
            const cargoRows = CARGO.filter((c) =>
                (!st.fromC || c.from_country === st.fromC) && (!st.toC || c.to_country === st.toC) &&
                placeMatch(c, "from", st.fromQ) && placeMatch(c, "to", st.toQ) &&
                (!st.route || rkey(c) === st.route));
            const cargoMed = median(cargoRows.map((c) => c.price_per_km));
            const d = trMed != null && cargoMed ? trMed / cargoMed - 1 : null;
            const side = (c, q) => [c || "усі", q ? `(${q})` : ""].filter(Boolean).join(" ");
            const where = st.route || (st.fromC || st.toC || st.fromQ || st.toQ ? `${side(st.fromC, st.fromQ)} → ${side(st.toC, st.toQ)}` : "усі напрямки");
            const verdict = d == null ? "немає з чим порівняти" : d > 0.005 ? "машина дорожча за вантаж" : d < -0.005 ? "машина дешевша за вантаж" : "машина й вантаж — однаково";
            $("#ldKpis").innerHTML = [
                [fmt(rows.length), `машин з ціною · перевізників у FURA ${fmt(inFura)}`],
                [trMed != null ? fmt(trMed, 2) + " €/км" : "—", `машини просять (медіана, EUR, ${fmt(pricedTr.length)} шт.)`],
                [cargoMed != null ? fmt(cargoMed, 2) + " €/км" : "—", `вантажі платять (медіана, повні, EUR, ${fmt(cargoRows.length)} шт.)`],
                [d != null ? pctTxt(d) : "—", `${verdict} · ${where}`],
            ].map(([b, s], i) => `<div class="ld-kpi ${i === 3 ? "ld-kpi-hl" : ""}"><b class="${i === 3 ? pctCls(d) : ""}">${esc(b)}</b><span>${esc(s)}</span></div>`).join("");
            return;
        }
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


    // Компанія з Lardi: назва з посиланням на профіль, відгуки, місто; контакт з кнопками месенджерів
    const profileUrl = (ref) => (ref ? `https://lardi-trans.com/user/${encodeURIComponent(ref)}/` : "");
    function ownerHtml(o) {
        const url = profileUrl(o.ref);
        const name = url
            ? `<a class="ld-prof" href="${esc(url)}" target="_blank" rel="noopener" title="Профіль компанії на Lardi">${esc(o.name || "")} ↗</a>`
            : esc(o.name || "");
        const rev = o.pos != null || o.neg != null
            ? ` <span class="ld-rev" title="Відгуки на Lardi"><span class="ld-up-ok">👍 ${fmt(o.pos || 0)}</span>${o.neg ? ` <span class="ld-down">👎 ${fmt(o.neg)}</span>` : ""}</span>` : "";
        const city = [o.city, o.area].filter(Boolean).join(", ");
        return `<div><b>${name}</b>${rev}</div>${city ? `<div class="ld-sm ld-muted">${esc(city)}</div>` : ""}`;
    }
    function contactHtml(o) {
        const ph = String(o.phone || "");
        const d = ph.replace(/\D/g, "");
        const msg = Array.isArray(o.msg) ? o.msg : [];
        const icons = d
            ? [
                msg.includes("VIBER") ? `<a class="ld-msg ld-viber" href="viber://chat?number=%2B${d}" title="Viber">V</a>` : "",
                msg.includes("TELEGRAM") ? `<a class="ld-msg ld-tg" href="https://t.me/+${d}" target="_blank" rel="noopener" title="Telegram">T</a>` : "",
                msg.includes("WHATSAPP") ? `<a class="ld-msg ld-wa" href="https://wa.me/${d}" target="_blank" rel="noopener" title="WhatsApp">W</a>` : "",
            ].join("")
            : "";
        return `<div class="ld-sm">${esc(o.face || "")} ${ph ? `<a href="tel:${esc(ph)}">${esc(ph)}</a>` : ""} ${icons}</div>`;
    }
    const ownerOf = (r) => ({ ref: r.owner_ref, name: r.owner_name, pos: r.rev_pos != null ? Number(r.rev_pos) : null, neg: r.rev_neg != null ? Number(r.rev_neg) : null, city: r.owner_city, area: r.owner_area, face: r.owner_face, phone: r.owner_phone, msg: r.owner_msg });

    // Позначка «є у FURA» з посиланням на картку перевізника
    const furaBadge = (r) => (r.carrier_id
        ? `<a class="ld-fura ld-fura-yes" href="index.html?open=${encodeURIComponent(r.carrier_id)}" target="_blank" rel="noopener" title="Відкрити картку перевізника у FURA">✓ у FURA ↗</a>`
        : `<span class="ld-fura ld-fura-no" title="Цього перевізника немає в «Перевізниках» FURA">немає у FURA</span>`);

    // Порівняння з вантажами: медіана €/км вантажів (повні, EUR) на тому ж напрямку
    // спершу область → область, якщо там мало вантажів — країна → країна
    let CARGO = [];
    let BENCH = { route: new Map(), country: new Map() };
    const rkey = (r) => `${r.from_region || "—"} → ${r.to_region || "—"}`;
    const ckey = (r) => `${r.from_country} → ${r.to_country}`;
    function buildBench() {
        const route = new Map(), country = new Map();
        const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
        for (const c of CARGO) {
            push(route, rkey(c), c.price_per_km);
            push(country, ckey(c), c.price_per_km);
        }
        const med = (m) => new Map([...m].map(([k, a]) => [k, { med: median(a), n: a.length }]));
        BENCH = { route: med(route), country: med(country) };
    }
    const benchFor = (r) => {
        const a = BENCH.route.get(rkey(r));
        if (a && a.n >= 3) return { ...a, where: "область → область" };
        const b = BENCH.country.get(ckey(r));
        return b && b.n ? { ...b, where: "країна → країна" } : null;
    };
    const pctTxt = (v) => (v == null || !isFinite(v) ? "" : (v > 0 ? "+" : "") + Math.round(v * 100) + "%");
    const pctCls = (v) => (v > 0.05 ? "ld-up" : v < -0.05 ? "ld-down" : "");
    function vsCargo(r) {
        if (r.price_per_km == null || r.currency !== "EUR") return "";
        const b = benchFor(r);
        if (!b || b.med == null) return `<div class="ld-sm ld-muted">вантажів з ціною тут немає</div>`;
        const d = r.price_per_km / b.med - 1;
        return `<div class="ld-sm" title="Медіана вантажів (${b.where}, ${b.n} шт.)">вантажі ${fmt(b.med, 2)} €/км · <b class="${pctCls(d)}">${pctTxt(d)}</b></div>`;
    }

    function renderTrucks(rows) {
        rows = sortRows(rows, {
            seen: (r) => r.seen_last, date: (r) => r.date_from, price: (r) => r.price, km: (r) => r.price_per_km,
            mass: (r) => r.mass_t, owner: (r) => r.owner_name,
        });
        const total = rows.length;
        const pageRows = rows.slice(st.page * PAGE, st.page * PAGE + PAGE);
        $("#ldTable").innerHTML =
            `<thead><tr>${th("date", "Вільна")}${th("", "Звідки")}${th("", "Куди")}${th("", "Кузов")}${th("mass", "Вантажність", "num")}${th("", "Об'єм", "num")}` +
            `${th("price", "Ціна", "num")}${th("owner", "Перевізник")}${th("", "FURA")}</tr></thead><tbody>` +
            (pageRows.length
                ? pageRows.map((r) => `<tr>
                        <td class="nw">${esc(dd(r.date_from))}${r.date_to && r.date_to !== r.date_from ? "–" + esc(dd(r.date_to)) : ""}<div class="ld-sm ld-muted">${esc(r.direction || "")}</div>
                            <a class="ld-open" href="${esc(lardiUrl(r))}" target="_blank" rel="noopener" title="Відкрити машину на Lardi">Lardi ↗</a></td>
                        <td><b>${esc(r.from_town || "")}</b>${r.from_zone ? ` <span class="ld-muted ld-sm">${esc(r.from_zone)} кв.</span>` : ""}<div class="ld-sm ld-muted">${esc(r.from_region && r.from_region !== r.from_town ? r.from_region : "")}${r.from_country && r.from_country !== "UA" ? " · " + esc(r.from_country) : ""}</div></td>
                        <td><b>${esc(r.to_town || "")}</b>${r.to_zone ? ` <span class="ld-muted ld-sm">${esc(r.to_zone)} кв.</span>` : ""}<div class="ld-sm ld-muted">${esc(r.to_region && r.to_region !== r.to_town ? r.to_region : "")}${r.to_country !== "UA" ? " · " + esc(r.to_country || "") : ""}</div></td>
                        <td class="ld-clip" title="${esc([r.body_types, r.cargo].filter(Boolean).join(" · "))}"><b>${esc(r.body_types || "")}</b>${r.cargo ? `<div class="ld-sm ld-muted">${esc(r.cargo)}</div>` : ""}<div class="ld-tags">${r.groupage ? `<span class="ld-tag">Догруз</span>` : ""}${r.adr ? `<span class="ld-tag ld-tag-adr">ADR ${esc(r.adr)}</span>` : ""}</div></td>
                        <td class="num nw">${r.mass_t != null ? fmt(r.mass_t, 1) + " т" : ""}</td>
                        <td class="num nw">${r.volume_m3 != null ? fmt(r.volume_m3) + " м³" : ""}</td>
                        <td class="num nw">${r.price != null || r.payment_raw != null ? `<b>${esc(money(r.price ?? r.payment_raw, r.currency))}</b>` : `<span class="ld-muted">—</span>`}${r.price_per_km != null ? `<div class="ld-sm ld-muted">${fmt(r.price_per_km, 2)} ${CUR[r.currency] || ""}/км</div>` : ""}${vsCargo(r)}</td>
                        <td>${ownerHtml(ownerOf(r))}
                            ${contactHtml(ownerOf(r))}</td>
                        <td>${furaBadge(r)}</td>
                    </tr>`).join("")
                : `<tr><td colspan="9" class="ld-empty">Немає машин за цими фільтрами</td></tr>`) +
            "</tbody>";
        pager(total);
        $("#ldCount").textContent = `${fmt(total)} машин`;
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
                        <td class="num nw"><b>${esc(money(r.price ?? r.payment_raw, r.currency))}</b>${r.per_t != null ? `<div class="ld-sm ld-muted">${esc(money(r.per_t, r.currency))}/т × ${fmt(r.mass_t, 1)} т</div>` : ""}${r.payment_forms ? `<div class="ld-sm ld-muted">${esc(r.payment_forms)}</div>` : ""}${r.delay_days ? `<div class="ld-sm ld-muted">відстрочка ${fmt(r.delay_days)} дн.</div>` : ""}</td>
                        <td class="num nw">${r.price_per_km != null ? fmt(r.price_per_km, 2) + " " + (CUR[r.currency] || "") : ""}</td>
                        <td><span class="ld-own ${OWNER_CLS[r.owner_type] || ""}">${esc(OWNER_LBL[r.owner_type] || r.owner_type || "")}</span>
                            ${ownerHtml(ownerOf(r))}
                            ${contactHtml(ownerOf(r))}</td>
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
            const full = a.filter((r) => (TRUCK || kindOf(r) === "full") && r.currency === "EUR");
            const owners = groupBy(a, (r) => r.owner_type || "");
            return {
                route, n: a.length, full: a.filter((r) => kindOf(r) === "full").length,
                mass: rangeTxt(a.map((r) => r.mass_t), (v) => fmt(v, 1)),
                price: rangeTxt(full.map((r) => r.price), (v) => fmt(v)),
                med: median(full.map((r) => r.price_per_km)),
                km: rangeTxt(full.map((r) => r.price_per_km), (v) => fmt(v, 1)),
                fura: a.filter((r) => r.carrier_id).length,
                pricedN: a.filter((r) => r.price_per_km != null && r.currency === "EUR").length,
                cargo: TRUCK ? benchFor(a[0]) : null,
                ship: (owners.get("Вантажовласник") || []).length,
                car: (owners.get("Перевізник") || []).length,
                exp: (owners.get("Експедиція / інші") || []).length,
                bodies: [...groupBy(a.flatMap((r) => String(r.body_types || "").split(",").map((s) => s.trim()).filter(Boolean).map((b) => ({ b }))), (x) => x.b)]
                    .sort((x, y) => y[1].length - x[1].length).slice(0, 3).map((x) => x[0]).join(", "),
            };
        });
        if (TRUCK) list.forEach((r) => { r.diff = r.med != null && r.cargo?.med ? r.med / r.cargo.med - 1 : null; });
        list = sortRows(list, { seen: (r) => r.n, n: (r) => r.n, med: (r) => r.med, route: (r) => r.route, diff: (r) => r.diff });
        const total = list.length;
        const pageRows = list.slice(st.page * PAGE, st.page * PAGE + PAGE);
        if (TRUCK) {
            $("#ldTable").innerHTML =
                `<thead><tr>${th("route", "Звідки → куди")}${th("n", "Машин", "num")}${th("", "З ціною", "num")}${th("med", "Машини €/км", "num")}` +
                `${th("", "Вантажі €/км", "num")}${th("diff", "Різниця", "num")}${th("", "Є у FURA", "num")}${th("", "Вантажність, т", "num")}${th("", "Кузов")}</tr></thead><tbody>` +
                (pageRows.length
                    ? pageRows.map((r) => {
                        const cm = r.cargo?.med;
                        return `<tr class="ld-click" data-route="${esc(r.route)}">
                        <td><b>${esc(r.route)}</b></td><td class="num">${r.n}</td><td class="num">${r.pricedN || ""}</td>
                        <td class="num"><b>${r.med != null ? fmt(r.med, 2) : ""}</b></td>
                        <td class="num" title="${r.cargo ? `Медіана вантажів (${r.cargo.where}, ${r.cargo.n} шт.)` : ""}">${cm != null ? fmt(cm, 2) : ""}</td>
                        <td class="num ${pctCls(r.diff)}"><b>${pctTxt(r.diff)}</b></td>
                        <td class="num">${r.fura || ""}</td><td class="num">${esc(r.mass)}</td><td class="ld-muted">${esc(r.bodies)}</td></tr>`;
                    }).join("")
                    : `<tr><td colspan="9" class="ld-empty">Немає даних</td></tr>`) +
                "</tbody>";
            pager(total);
            $("#ldCount").textContent = `${fmt(total)} напрямків · клік по рядку — його машини`;
            return;
        }
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
                o: ownerOf(a[0]),
                carrier_id: (a.find((r) => r.carrier_id) || {}).carrier_id || null,
                n: a.length, priced: p.length, med: median(p.map((r) => r.price_per_km)), vs: median(ratios),
                routes: new Set(a.map(route)).size,
            };
        });
        list = sortRows(list, { seen: (r) => r.n, n: (r) => r.n, med: (r) => r.med, vs: (r) => r.vs, name: (r) => r.name });
        const total = list.length;
        const pageRows = list.slice(st.page * PAGE, st.page * PAGE + PAGE);
        const pct = (v) => (v == null ? "" : (v > 0 ? "+" : "") + Math.round(v * 100) + "%");
        $("#ldTable").innerHTML =
            `<thead><tr>${th("name", "Компанія")}${th("", TRUCK ? "FURA" : "Хто")}${th("n", TRUCK ? "Машин" : "Заявок", "num")}${th("med", "Медіана €/км", "num")}` +
            `${th("vs", "До ринку", "num")}${th("", "Напрямків", "num")}${th("", "Контакт")}</tr></thead><tbody>` +
            (pageRows.length
                ? pageRows.map((r) => `<tr>
                    <td>${ownerHtml(r.o)}</td>
                    <td>${TRUCK ? furaBadge(r) : `<span class="ld-own ${OWNER_CLS[r.type] || ""}">${esc(OWNER_LBL[r.type] || r.type || "")}</span>`}</td>
                    <td class="num">${r.n}</td><td class="num">${r.med != null ? fmt(r.med, 2) : ""}</td>
                    <td class="num ${r.vs > 0.05 ? "ld-up" : r.vs < -0.05 ? "ld-down" : ""}" title="Наскільки ставка компанії вища/нижча за звичайну на тих самих напрямках">${pct(r.vs)}</td>
                    <td class="num">${r.routes}</td>
                    <td>${contactHtml(r.o)}</td></tr>`).join("")
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

    // Кнопка оновлення: якщо вибрано країну у «Звідки»/«Куди» — оновлюємо лише цей напрямок
    function runLabel() {
        const btn = $("#ldRunBtn");
        if (!btn || btn.disabled) return;
        const f = st.fromC || "", t = st.toC || "";
        btn.innerHTML = `<i class="bx bx-refresh"></i> ${f || t ? `Оновити ${esc(f || "усі")} → ${esc(t || "усі")}` : "Оновити все"}`;
        btn.title = f || t ? "Оновлюється лише цей напрямок. Щоб оновити все — очистіть країни або натисніть «Скинути»." : "Оновлюються всі напрямки";
    }

    function render() {
        runLabel();
        const rows = filtered();
        $("#ldFound").textContent = `Знайдено ${fmt(rows.length)}`;
        kpis(rows);
        document.querySelectorAll("#ldViews button").forEach((b) => b.classList.toggle("active", b.dataset.v === st.view));
        if (st.view === "routes") renderRoutes(rows);
        else if (st.view === "owners") renderOwners(rows);
        else if (TRUCK) renderTrucks(rows);
        else renderLoads(rows);
        if (st.route && st.view === "loads") $("#ldCount").textContent += ` · напрямок: ${st.route} (✕ скинути — «Скинути»)`;
    }

    /* ---------------- дані ---------------- */
    async function load() {
        const since = new Date(Date.now() - Number(st.period || 3) * 86400000);
        if (st.period === "1") since.setHours(0, 0, 0, 0);
        const cols = "id,lardi_url:raw->>_lardi_url,seen_first,seen_last,direction,from_country,to_country,from_zone,from_postcode,to_zone,to_postcode,from_town,from_region,from_points,to_town,to_region,to_points,date_from,date_to,distance_km,cargo,mass_t,volume_m3,body_types,load_types,adr,groupage,price,price_per_km,currency,payment_raw,payment_unit,payment_forms,delay_days,owner_ref,owner_name,owner_face,owner_phone,owner_type,owner_rating," +
            "owner_city:raw->owner->address->town->>name,owner_area:raw->owner->address->area->>name,owner_msg:raw->owner->phones->0->messengers," +
            "rev_pos:raw->owner->rating->>positiveCommentCount,rev_neg:raw->owner->rating->>negativeCommentCount";
        const out = [];
        const cnt = $("#ldCount");
        const page = async (from, table = TABLE, sel = TRUCK ? cols + ",carrier_id" : cols) => {
            // запит не може «висіти» вічно: 40 с і ще одна спроба
            for (let attempt = 1; ; attempt++) {
                const q = sbClient.from(table).select(sel).gte("seen_last", since.toISOString())
                    .order("seen_last", { ascending: false }).order("id").range(from, from + 999);
                const { data, error } = await (AbortSignal.timeout ? q.abortSignal(AbortSignal.timeout(40000)) : q);
                if (!error) return data || [];
                if (attempt >= 2) throw new Error(`База не відповіла (${error.message || error.code || "timeout"})`);
            }
        };
        for (let from = 0; from < 30000; from += 1000) {
            if (cnt) cnt.textContent = `Завантажую ${ITEMS}… ${fmt(out.length)}`;
            const data = await page(from);
            out.push(...data);
            if (data.length < 1000) break;
        }
        // «Авто»: вантажі з ціною за той самий період — щоб порівняти ціну машин з ціною вантажів
        let cargo = [];
        if (TRUCK) {
            const sel = "id,from_country,to_country,from_region,to_region,from_town,to_town,from_points,to_points,from_zone,to_zone,from_postcode,to_postcode,price,price_per_km,currency,mass_t,groupage,payment_raw,payment_unit,distance_km";
            for (let from = 0; from < 30000; from += 1000) {
                if (cnt) cnt.textContent = `Завантажую вантажі для порівняння… ${fmt(cargo.length)}`;
                const data = await page(from, "lardi_cargo", sel);
                cargo.push(...data);
                if (data.length < 1000) break;
            }
        }
        // ціна «за тонну»: рахуємо суму за рейс (ціна × вага) і €/км, щоб заявка не випадала з медіан
        for (const r of [...out, ...cargo]) {
            if (r.price == null && r.payment_raw != null && /^т|тон|ton|\bt\b/i.test(String(r.payment_unit || "").trim())) {
                r.per_t = r.payment_raw;
                if (r.mass_t) {
                    r.price = Math.round(r.payment_raw * r.mass_t);
                    if (r.distance_km) r.price_per_km = Math.round((r.price / r.distance_km) * 100) / 100;
                }
            }
        }
        ROWS = out;
        if (TRUCK) {
            CARGO = cargo.filter((c) => c.currency === "EUR" && c.price_per_km != null && kindOf(c) === "full");
            buildBench();
        }
        renderSync();
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
            const rows = ROWS.filter((r) => !c || r[side + "_country"] === c);
            const names = sorted(new Set(rows.flatMap((r) => [r[side + "_region"], r[side + "_town"]])));
            $(side === "from" ? "#ldFromList" : "#ldToList").innerHTML = names.slice(0, 400).map((v) => `<option value="${esc(v)}"></option>`).join("");
        };
        set("from");
        set("to");
    }

    // Рядок стану: коли оновлено, скільки напрямків пройдено сьогодні, скільки заявок і скільки нових
    let LAST_RUN = null;
    function renderSync() {
        const el = $("#ldSync");
        if (!el) return;
        const active = DIRS.filter((d) => d.active);
        const times = active.map((d) => d.last_run_at).filter(Boolean).sort();
        if (!times.length && !LAST_RUN) { el.textContent = "Ще не оновлювалось"; return; }
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const done = active.filter((d) => d.last_run_at && new Date(d.last_run_at) >= today);
        const loads = done.reduce((s, d) => s + (d.last_found || 0), 0);
        const fresh = ROWS.filter((r) => r.seen_first && new Date(r.seen_first) >= today).length;
        const last = new Date(times[times.length - 1] || LAST_RUN.finished_at || LAST_RUN.started_at);
        const t = last.toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        el.innerHTML = `Оновлено <b>${esc(t)}</b> · напрямків сьогодні <b>${fmt(done.length)} з ${fmt(active.length)}</b> · ${TRUCK ? "машин" : "заявок з ціною"} <b>${fmt(loads)}</b> · нових сьогодні <b>${fmt(fresh)}</b>`;
        el.title = done.length < active.length ? `Ще не оновлені сьогодні напрямків: ${active.length - done.length} — натисніть «Оновити зараз»` : "Усі напрямки оновлені сьогодні";
    }

    async function loadMeta() {
        const [{ data: dirs }, { data: runs }] = await Promise.all([
            sbClient.from("lardi_directions").select("*").order("id"),
            sbClient.from("lardi_runs").select("*").eq("kind", KIND_RUN).order("started_at", { ascending: false }).limit(1),
        ]);
        // «Авто» має власний облік оновлень по напрямках
        DIRS = (dirs || []).map((d) => (TRUCK ? { ...d, last_run_at: d.truck_last_run_at, last_found: d.truck_last_found } : d));
        const r = runs?.[0];
        LAST_RUN = r || null;
        renderSync();
        const alert = $("#ldAlert");
        // Не показуємо помилки: по вимкнених напрямках (напр. XK — Косово); по напрямках, які після тієї помилки
        // вже оновились успішно; і ті, що закрили хрестиком
        const off = new Set(DIRS.filter((d) => !d.active).map((d) => `${d.from_country} → ${d.to_country}`));
        const errAt = r ? new Date(r.finished_at || r.started_at) : null;
        const fixed = new Set(DIRS.filter((d) => d.last_run_at && errAt && new Date(d.last_run_at) > errAt).map((d) => `${d.from_country} → ${d.to_country}`));
        const DKEY = "fura_lardi_alert_closed_" + KIND_RUN;
        let closed = "";
        try { closed = localStorage.getItem(DKEY) || ""; } catch (e) { /* без пам'яті */ }
        const errText = String(r?.error || "").split(" | ")
            .filter((x) => { const dir = x.split(":")[0].trim(); return x && !off.has(dir) && !fixed.has(dir); }).join(" | ");
        if (errText && String(r.id) !== closed) {
            alert.innerHTML = `${esc("Останнє оновлення з помилкою: " + errText)} <button type="button" class="ld-x ld-alert-x" title="Закрити">&times;</button>`;
            alert.classList.remove("hidden", "ld-info");
            alert.querySelector(".ld-alert-x").addEventListener("click", () => {
                try { localStorage.setItem(DKEY, String(r.id)); } catch (e) { /* без пам'яті */ }
                alert.classList.add("hidden");
            });
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

    // Одне натискання проходить усі напрямки: функція бере порцію (до ~100 с), повторюємо, поки є залишок
    async function runNow() {
        const btn = $("#ldRunBtn");
        const a = $("#ldAlert");
        const info = (t) => { a.textContent = t; a.classList.add("ld-info"); a.classList.remove("hidden"); };
        btn.disabled = true;
        const scope = { from: st.fromC || "", to: st.toC || "" };
        const what = scope.from || scope.to ? ` ${scope.from || "усі"} → ${scope.to || "усі"}` : "";
        let round = 0, found = 0, done = 0, left = null, fails = 0, linked = 0, cards = 0;
        try {
            do {
                round++;
                btn.innerHTML = `<i class="bx bx-loader-alt bx-spin"></i> Оновлюю… ${left == null ? "" : `(лишилось ${left} напрямків)`}`;
                info(left == null
                    ? (what ? `Оновлюю${what}… Зазвичай це до хвилини.` : "Оновлення почалося. Напрямків багато, тож Lardi віддає їх порціями — це може тривати 10–20 хвилин. Сторінку можна не закривати й працювати далі.")
                    : `Оновлено ${done} напрямків, знайдено ${fmt(found)} ${TRUCK ? "машин" : "заявок з ціною"}. Лишилось ${left} — продовжую…`);
                let res;
                try {
                    res = await call({ action: "run", kind: KIND_RUN, from: scope.from, to: scope.to });
                    fails = 0;
                } catch (e) {
                    // обрив за часом або попередня порція ще дописується — чекаємо й продовжуємо
                    const m = String(e.message || "");
                    if (!(/не відповів|вже йде/.test(m)) || ++fails > 4) throw e;
                    info(`Lardi відповідає повільно — чекаю 20 секунд і продовжую… (оновлено ${done} напрямків)`);
                    await new Promise((r) => setTimeout(r, 20000));
                    left = left ?? 1;
                    continue;
                }
                if (res?.error && !(res.directions || []).length) throw new Error(res.error);
                found += res?.found || 0;
                linked += res?.linked || 0;
                cards += res?.cardsUpdated || 0;
                done += (res?.directions || []).length;
                left = res?.left || 0;
                await load();
            } while (left > 0 && round < 40);
            await loadMeta();
            info(`Готово${what}: оновлено ${done} напрямків, знайдено ${fmt(found)} ${TRUCK ? "машин" : "заявок з ціною"}.` +
                (TRUCK ? ` Перевізників з бази FURA: ${fmt(linked)}, карток доповнено напрямками: ${fmt(cards)}.` : ""));
        } catch (e) {
            await loadMeta().catch(() => {});
            a.textContent = e.message;
            a.classList.remove("hidden", "ld-info");
        } finally {
            btn.disabled = false;
            runLabel();
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
    // Поле країни як на Lardi: друкуєш код або назву, список «Популярні» / «Усі»
    function initCombo(box) {
        const key = box.dataset.combo;
        const input = box.querySelector("input");
        const list = box.querySelector(".ld-combo-list");
        let active = -1, items = [];
        const item = (c) => `<div class="ld-combo-item" data-c="${c}">${c} / ${esc(regionName(c))}</div>`;
        const draw = () => {
            const q = input.value.trim().toLowerCase();
            const match = (c) => !q || c.toLowerCase().startsWith(q) || regionName(c).toLowerCase().includes(q);
            const pop = POPULAR.filter(match), all = ISO.filter(match);
            list.innerHTML = (pop.length ? `<div class="ld-combo-grp">Популярні</div>` + pop.map(item).join("") : "") +
                (all.length ? `<div class="ld-combo-grp">Усі</div>` + all.map(item).join("") : `<div class="ld-combo-grp">Нічого не знайдено</div>`);
            items = [...list.querySelectorAll(".ld-combo-item")];
            active = items.length ? 0 : -1;
            items.forEach((el, i) => el.classList.toggle("on", i === active));
            list.classList.remove("hidden");
        };
        const pick = (c) => {
            st[key] = c;
            input.value = c;
            list.classList.add("hidden");
            fillPlaces();
            syncForm();
            st.page = 0; save(); render();
        };
        input.addEventListener("focus", () => { input.select(); draw(); });
        input.addEventListener("input", draw);
        input.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!items.length) return;
                active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
                items.forEach((el, i) => el.classList.toggle("on", i === active));
                items[active].scrollIntoView({ block: "nearest" });
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (!input.value.trim()) pick("");
                else if (items[active]) pick(items[active].dataset.c);
            } else if (e.key === "Escape") { list.classList.add("hidden"); input.blur(); }
        });
        list.addEventListener("mousedown", (e) => {
            const it = e.target.closest("[data-c]");
            if (it) { e.preventDefault(); pick(it.dataset.c); }
        });
        input.addEventListener("blur", () => {
            setTimeout(() => {
                list.classList.add("hidden");
                const v = input.value.trim().toUpperCase();
                if (!v) { if (st[key]) pick(""); }
                else if (ISO.includes(v) && v !== st[key]) pick(v);
                else input.value = st[key] || "";
            }, 120);
        });
    }

    function bind() {
        const rerender = () => { st.page = 0; save(); render(); };
        let t;
        $("#ldQ").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; rerender(); }, 200); });
        const form = $("#ldForm");
        form.querySelectorAll("[data-combo]").forEach(initCombo);
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
        $("#ldFura")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-fura], [data-priced]");
            if (!b) return;
            if (b.dataset.priced) st.priced = st.priced === "1" ? "" : "1";
            else st.fura = st.fura === b.dataset.fura ? "" : b.dataset.fura;
            syncForm();
            rerender();
        });
        $("#ldOwners")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-owner]");
            if (!b) return;
            const o = b.dataset.owner;
            st.owners = st.owners.includes(o) ? st.owners.filter((x) => x !== o) : [...st.owners, o];
            syncForm();
            rerender();
        });
        form.querySelectorAll(".ld-seg [data-unit]").forEach((b) => b.addEventListener("click", () => { st.unit = b.dataset.unit; syncForm(); rerender(); }));
        document.querySelectorAll(".ld-flow [data-flow]").forEach((b) => b.addEventListener("click", () => {
            const f = b.dataset.flow;
            if (f === "import") { if (st.fromC === "UA") st.fromC = ""; st.toC = "UA"; }
            else if (f === "export") { if (st.toC === "UA") st.toC = ""; st.fromC = "UA"; }
            else { st.fromC = ""; st.toC = ""; }
            fillPlaces();
            syncForm();
            rerender();
        }));
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
