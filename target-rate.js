/* ================================================================= *
 * FURA — ЦІЛЬОВА СТАВКА (картка запиту + вікно «Відповідь логіста»)  *
 * Скільки орієнтовно платити перевізнику на цьому напрямку:          *
 *   • що давали інші логісти на схожі запити (+- той самий напрямок)  *
 *     за 60 днів — поле answers у requests;                           *
 *   • Lardi за 14 днів: вантажі (lardi_cargo, хто виставив і за скільки) *
 *     і машини з ціною (lardi_trucks — за скільки готовий їхати).     *
 * Спершу шукаємо те саме місто / квадрат, далі регіон, далі країни.  *
 * Логіст може вписати свою цільову — requests.target_price           *
 * (target_rate.sql).                                                  *
 * ================================================================= */

(function () {
    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) return;

    const ISO = {
        "УКРАЇНА": "UA", "ПОЛЬША": "PL", "ПОЛЬЩА": "PL", "НІМЕЧЧИНА": "DE", "ЛИТВА": "LT", "ЛАТВІЯ": "LV", "ЕСТОНІЯ": "EE",
        "ЧЕХІЯ": "CZ", "СЛОВАЧЧИНА": "SK", "УГОРЩИНА": "HU", "РУМУНІЯ": "RO", "МОЛДОВА": "MD", "БОЛГАРІЯ": "BG",
        "АВСТРІЯ": "AT", "НІДЕРЛАНДИ": "NL", "БЕЛЬГІЯ": "BE", "ФРАНЦІЯ": "FR", "ІТАЛІЯ": "IT", "ІСПАНІЯ": "ES",
        "ПОРТУГАЛІЯ": "PT", "ДАНІЯ": "DK", "ШВЕЦІЯ": "SE", "ФІНЛЯНДІЯ": "FI", "ВЕЛИКОБРИТАНІЯ": "GB", "ТУРЕЧЧИНА": "TR",
        "ГРУЗІЯ": "GE", "ВІРМЕНІЯ": "AM", "АЗЕРБАЙДЖАН": "AZ", "КАЗАХСТАН": "KZ", "УЗБЕКИСТАН": "UZ", "СЛОВЕНІЯ": "SI",
        "ХОРВАТІЯ": "HR", "СЕРБІЯ": "RS", "ГРЕЦІЯ": "GR", "ШВЕЙЦАРІЯ": "CH",
    };
    const LOGIST_DAYS = 60;
    const LARDI_DAYS = 14;
    const MIN_LOGIST = 2; // скільки відповідей треба на рівні, щоб ним користуватися
    const MIN_LARDI = 3;
    const LEVEL = { 3: "та сама область / воєводство / квадрат", 2: "сусідні області / той самий округ", 1: "та сама частина країни", 0: "ті самі країни" };
    const FRESH_DAYS = 7; // ціна міняється щотижня — беремо останні 7 днів; старіші лише якщо свіжих немає (з ⚠)

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const num = (v) => {
        const m = String(v ?? "").replace(/\s/g, "").replace(",", ".").match(/\d+(\.\d+)?/);
        return m ? Number(m[0]) : 0;
    };
    const median = (arr) => {
        const a = [...arr].sort((x, y) => x - y);
        if (!a.length) return 0;
        const m = Math.floor(a.length / 2);
        return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    };
    const r50 = (v) => Math.round(v / 50) * 50;
    const money = (v, cur) => `${Math.round(v).toLocaleString("uk-UA").replace(/ /g, " ")} ${cur || ""}`.trim();
    const dmy = (v) => (v ? String(v).slice(0, 10).split("-").reverse().slice(0, 2).join(".") : "");
    const isOld = (v) => new Date(v || 0).getTime() < Date.now() - FRESH_DAYS * 864e5;
    const canEdit = () => typeof currentStaff !== "undefined" && currentStaff && typeof hasRole === "function" && hasRole(currentStaff, ["logist", "head", "admin"]);

    /* ---------- Місце: місто, квадрат (2 цифри індексу), регіон ---------- */
    const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/^(м\.|с\.|смт\.?|г\.)\s*/, "").replace(/[«»"'`’]/g, "").trim();
    const regionKey = (s) => norm(s).replace(/\s*(область|обл\.?|воєводство|воєв\.?|край|земля|регіон|county)\s*$/i, "").split(/[\s-]+/)[0] || "";

    // Частина країни: Польща — перша цифра індексу (поштові округи), Україна — захід / південь / центр-схід
    const PL_REG = { "поморське": "8", "куявсько": "8", "мазовецьке": "0", "підляське": "1", "вармінсько": "1", "люблінське": "2", "свєнтокшиське": "2", "малопольське": "3", "підкарпатське": "3", "сілезьке": "4", "опольське": "4", "нижньосілезьке": "5", "великопольське": "6", "любуське": "6", "західнопоморське": "7", "лодзинське": "9", "лодзьке": "9" };
    function macroOf(cc, p) {
        if (cc === "PL") {
            if (p.zone) return "pl" + p.zone[0];
            const k = Object.keys(PL_REG).find((x) => p.region && p.region.startsWith(x.slice(0, 6)));
            return k ? "pl" + PL_REG[k] : "";
        }
        if (cc === "UA") {
            const r = p.region || "";
            if (/^(львів|волин|рівн|терноп|івано|закарпат|чернів|хмельн)/.test(r)) return "ua-w";
            if (/^(одес|микола|херсон)/.test(r)) return "ua-s";
            if (r || /^київ/.test(p.town)) return "ua-c";
            return "";
        }
        return p.zone ? cc + p.zone[0] : "";
    }
    function placeOfAddress(addr, cc) {
        const parts = String(addr || "").split(",").map((x) => x.trim()).filter(Boolean);
        const pc = String(addr || "").match(/\b(\d{2})[-\s]?\d{2,4}\b/);
        const reg = parts.find((p) => /(обл|воєв|край|область|земля)/i.test(p)) || (parts.length > 1 ? parts[parts.length - 1] : "");
        const p = { town: norm(parts[0]), zone: pc ? pc[1] : "", region: /\d/.test(reg) ? "" : regionKey(reg) };
        p.macro = macroOf(cc, p);
        return p;
    }
    const placeOfLardi = (cc, town, region, zone) => {
        const p = { town: norm(town), zone: String(zone || "").slice(0, 2), region: regionKey(region) };
        p.macro = macroOf(cc, p);
        return p;
    };

    // Області України та їхні сусіди (за початком назви)
    const UA_OBL = ["вінниц", "волин", "дніпро", "донец", "житомир", "закарпат", "запоріз", "івано", "київ", "кіровоград", "луган", "львів", "микола", "одес", "полтав", "рівн", "сум", "терноп", "харків", "херсон", "хмельн", "черкас", "чернівец", "черніг"];
    const UA_NEAR = {
        вінниц: ["житомир", "київ", "черкас", "кіровоград", "одес", "хмельн", "чернівец"], волин: ["львів", "рівн"],
        дніпро: ["харків", "полтав", "кіровоград", "микола", "херсон", "запоріз", "донец"], донец: ["дніпро", "харків", "луган", "запоріз"],
        житомир: ["рівн", "хмельн", "вінниц", "київ"], закарпат: ["львів", "івано"], запоріз: ["дніпро", "донец", "херсон"],
        івано: ["львів", "закарпат", "чернівец", "терноп"], київ: ["житомир", "вінниц", "черкас", "полтав", "черніг"],
        кіровоград: ["вінниц", "черкас", "полтав", "дніпро", "микола", "одес"], луган: ["донец", "харків"],
        львів: ["волин", "рівн", "терноп", "івано", "закарпат"], микола: ["одес", "кіровоград", "дніпро", "херсон"],
        одес: ["микола", "кіровоград", "вінниц"], полтав: ["київ", "черкас", "кіровоград", "дніпро", "харків", "сум", "черніг"],
        рівн: ["волин", "львів", "терноп", "хмельн", "житомир"], сум: ["черніг", "полтав", "харків"],
        терноп: ["рівн", "львів", "івано", "чернівец", "хмельн"], харків: ["сум", "полтав", "дніпро", "донец", "луган"],
        херсон: ["микола", "дніпро", "запоріз"], хмельн: ["рівн", "терноп", "чернівец", "вінниц", "житомир"],
        черкас: ["київ", "вінниц", "кіровоград", "полтав"], чернівец: ["івано", "терноп", "хмельн", "вінниц"], черніг: ["київ", "полтав", "сум"],
    };
    const UA_CITY = { "київ": "київ", "львів": "львів", "одеса": "одес", "дніпро": "дніпро", "харків": "харків", "запоріжжя": "запоріз", "вінниця": "вінниц", "луцьк": "волин", "рівне": "рівн", "тернопіль": "терноп", "ужгород": "закарпат", "мукачево": "закарпат", "чернівці": "чернівец", "хмельницький": "хмельн", "житомир": "житомир", "черкаси": "черкас", "полтава": "полтав", "суми": "сум", "чернігів": "черніг", "миколаїв": "микола", "херсон": "херсон", "кропивницький": "кіровоград", "бровари": "київ", "бориспіль": "київ", "біла церква": "київ" };
    const uaObl = (p) => UA_OBL.find((k) => (p.region || "").startsWith(k)) || UA_CITY[p.town] || "";

    // Україна: та сама область → сусідні області → та сама частина країни.
    // Інші країни: не місто, а воєводство / регіон або квадрат (2 цифри індексу) → той самий поштовий округ (1 цифра).
    // «Ґданськ (Поморське, 80)» — щоб було видно область / квадрат
    const cap1 = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : "");
    const placeLabelL = (town, region, zone) => {
        const reg = String(region || "").split(/\s+/)[0];
        const extra = [reg && norm(reg) !== norm(town) ? reg : "", zone ? String(zone).slice(0, 2) : ""].filter(Boolean).join(", ");
        return town ? `${town}${extra ? ` (${extra})` : ""}` : reg;
    };
    function placeLabel(addr, cc) {
        const parts = String(addr || "").split(",").map((x) => x.trim()).filter(Boolean);
        const p = placeOfAddress(addr, cc);
        const raw = parts.slice(1).find((x) => /(обл|воєв|край|область|земля)/i.test(x)) || (p.region ? cap1(p.region) : "");
        return parts[0] ? placeLabelL(parts[0], raw, p.zone) : "";
    }

    function closeness(a, b, cc) {
        if (!a || !b) return 0;
        if (cc === "UA") {
            const x = uaObl(a), y = uaObl(b);
            if (x && x === y) return 3;
            if (x && y && (UA_NEAR[x] || []).includes(y)) return 2;
            if (a.macro && a.macro === b.macro) return 1;
            return 0;
        }
        if ((a.zone && a.zone === b.zone) || (a.region && a.region === b.region) || (a.town && a.town === b.town)) return 3;
        if (a.macro && a.macro === b.macro) return 2;
        return 0;
    }
    const routeLevel = (la, ua, lb, ub, ca, cb) => Math.min(closeness(la, lb, ca), closeness(ua, ub, cb));

    const bodyWords = (s) =>
        String(s || "")
            .toLowerCase()
            .split(/[;,/]+/)
            .map((x) => x.trim().split(/\s+/)[0])
            .filter(Boolean);

    const bkey = (ref, name) => (ref ? "r:" + ref : "n:" + String(name || "").trim().toLowerCase());
    const blkBtn = (x) => (canEdit() && x.who ? `<button type="button" class="tr-blk" data-blk="${esc(x.bkey)}" data-blk-name="${esc(x.who)}" title="Заблокувати: нереальні ціни — не враховувати">🚫</button>` : "");

    /* ---------- Курс НБУ (грн за 1 одиницю валюти) — раз на день ---------- */
    let FX = null;
    async function loadFx() {
        if (FX) return FX;
        const d = new Date();
        const key = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
        try {
            const c = JSON.parse(sessionStorage.getItem("fura_nbu_" + key) || "null");
            if (c?.EUR) return (FX = c);
        } catch (_) { /* */ }
        try {
            const ctl = new AbortController();
            setTimeout(() => ctl.abort(), 4000);
            const list = await (await fetch(`https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=${key}&json`, { signal: ctl.signal })).json();
            const f = { UAH: 1, date: list[0]?.exchangedate || "" };
            for (const cc of ["EUR", "USD", "PLN"]) f[cc] = list.find((x) => x.cc === cc)?.rate || 0;
            if (f.EUR) {
                FX = f;
                try { sessionStorage.setItem("fura_nbu_" + key, JSON.stringify(f)); } catch (_) { /* */ }
            }
        } catch (_) { /* немає доступу до НБУ — просто без перерахунку */ }
        return FX;
    }
    // Валюта → у дужках гривні; гривні → у дужках євро
    function fx(v, cur) {
        if (!FX || !v) return "";
        cur = String(cur || "").toUpperCase();
        if (cur === "UAH") return FX.EUR ? `<span class="tr-fx">(≈ ${money(Math.round(v / FX.EUR / 10) * 10, "€")})</span>` : "";
        const r = FX[cur];
        return r ? `<span class="tr-fx">(≈ ${money(Math.round((v * r) / 100) * 100, "грн")})</span>` : "";
    }

    function fxRange(lo, hi, cur) {
        if (!FX) return "";
        cur = String(cur || "").toUpperCase();
        const c = (v) => (cur === "UAH" ? Math.round(v / FX.EUR / 10) * 10 : Math.round((v * (FX[cur] || 0)) / 100) * 100);
        if (cur !== "UAH" && !FX[cur]) return "";
        return `<span class="tr-fx">(≈ ${money(c(lo))} – ${money(c(hi), cur === "UAH" ? "€" : "грн")})</span>`;
    }

    /* ---------- Збір даних ---------- */
    const cache = new Map(); // "UA|PL" → { at, reqs, lardi }

    async function fetchDir(r) {
        const key = `${r.load_country}|${r.unload_country}`;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit;
        const sinceL = new Date(Date.now() - LOGIST_DAYS * 864e5).toISOString();
        const sinceD = new Date(Date.now() - LARDI_DAYS * 864e5).toISOString();
        const a = ISO[String(r.load_country || "").toUpperCase()];
        const b = ISO[String(r.unload_country || "").toUpperCase()];
        const [q1, q2, q3, q4, q5] = await Promise.all([
            client
                .from("requests")
                .select("id, created_at, client, load_country, unload_country, load_address, unload_address, transport_type, weight, answers, offers, logistician, logistician_id, logist_notes, answered_at, chosen_offer")
                .eq("load_country", r.load_country)
                .eq("unload_country", r.unload_country)
                .gte("created_at", sinceL)
                .order("created_at", { ascending: false })
                .limit(300),
            a && b
                ? client
                      .from("lardi_cargo")
                      .select("id, seen_first, seen_last, date_from, from_country, to_country, from_town, from_region, from_zone, to_town, to_region, to_zone, price, currency, body_types, mass_t, payment_unit, owner_name, owner_type, owner_ref")
                      .eq("from_country", a)
                      .eq("to_country", b)
                      .gte("seen_last", sinceD)
                      .gt("price", 0)
                      .order("seen_last", { ascending: false })
                      .limit(600)
                : Promise.resolve({ data: [] }),
            a && b
                ? client
                      .from("lardi_trucks")
                      .select("id, seen_first, seen_last, from_country, to_country, from_town, from_region, from_zone, to_town, to_region, to_zone, price, currency, body_types, mass_t, payment_unit, owner_name, owner_ref, carrier_id")
                      .eq("from_country", a)
                      .eq("to_country", b)
                      .gte("seen_last", sinceD)
                      .gt("price", 0)
                      .order("seen_last", { ascending: false })
                      .limit(300)
                      .then((x) => x, () => ({ data: [] }))
                : Promise.resolve({ data: [] }),
            client.from("lardi_runs").select("finished_at, kind").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1).then((x) => x, () => ({ data: [] })),
            client.from("lardi_blocked").select("key, name, blocked_by").then((x) => x, () => ({ data: [] })),
        ]);
        const res = { at: Date.now(), reqs: q1.data || [], lardi: q2.data || [], trucks: q3?.data || [], lardiAt: q4?.data?.[0]?.finished_at || null, blocked: q5?.data || [] };
        cache.set(key, res);
        return res;
    }

    // Головна валюта: та, в якій найбільше цін
    function mainCurrency(items) {
        const c = {};
        for (const x of items) c[x.cur] = (c[x.cur] || 0) + 1;
        return Object.keys(c).sort((p, q) => c[q] - c[p])[0] || "EUR";
    }

    // Беремо найвужчий рівень, де достатньо цін; якщо ніде — усі
    // Спершу свіжі (21 день) на найближчому маршруті, далі — старіші, і лише потім «ті самі країни»
    function pickLevel(items, min) {
        const edge = Date.now() - FRESH_DAYS * 864e5;
        const isFresh = (x) => new Date(x.at || 0).getTime() >= edge;
        const tries = [[3, 1], [2, 1], [1, 1], [3, 0], [2, 0], [1, 0], [0, 1], [0, 0]];
        for (const [lv, fresh] of tries) {
            const use = items.filter((x) => x.level >= lv && (!fresh || isFresh(x)));
            if (use.length >= min) return { level: lv, use, fresh: !!fresh || use.every(isFresh), oldest: use.reduce((m, x) => (!m || String(x.at) < m ? String(x.at) : m), "") };
        }
        return { level: 0, use: items, fresh: items.every(isFresh), oldest: "" };
    }

    // Вага: «22т», «22 000 кг», «до 20 т» → тонни; клас: бус / до 10 т / до 17 т / фура
    const tons = (v) => {
        const n = num(v);
        if (!n) return 0;
        return /кг|kg/i.test(String(v)) || n > 100 ? n / 1000 : n;
    };
    const wClass = (t) => (!t ? 0 : t <= 3.5 ? 1 : t <= 10 ? 2 : t <= 17 ? 3 : 4);
    const W_LABEL = { 1: "до 3,5 т", 2: "3,5–10 т", 3: "10–17 т", 4: "від 17 т" };
    function preferWeight(items, wantT, min) {
        const c = wClass(wantT);
        if (!c) return { use: items, wsame: 0 };
        const same = items.filter((x) => !x.t || wClass(x.t) === c);
        return same.length >= min ? { use: same, wsame: c } : { use: items, wsame: 0 };
    }
    const pct = (arr, q) => {
        const a = [...arr].sort((x, y) => x - y);
        if (!a.length) return 0;
        const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
        return a[lo] + (a[hi] - a[lo]) * (i - lo);
    };

    function preferBody(items, want, min) {
        if (!want.length) return { use: items, same: false };
        const same = items.filter((x) => x.body.some((w) => want.some((v) => w.startsWith(v.slice(0, 4)))));
        return same.length >= min ? { use: same, same: true } : { use: items, same: false };
    }

    async function compute(r) {
        if (!r?.load_country || !r?.unload_country) return null;
        const [{ reqs, lardi, trucks, lardiAt, blocked }] = await Promise.all([fetchDir(r), loadFx()]);
        const ca = ISO[String(r.load_country || "").toUpperCase()], cb = ISO[String(r.unload_country || "").toUpperCase()];
        const lp = placeOfAddress(r.load_address, ca);
        const up = placeOfAddress(r.unload_address, cb);
        const want = bodyWords(r.transport_type);
        const wantT = tons(r.weight);
        const answersOf = (x) => (typeof getAnswers === "function" ? getAnswers(x) : Array.isArray(x.answers) ? x.answers : []);

        // 1. Відповіді логістів на схожі запити
        let lg = [];
        for (const q of reqs) {
            if (String(q.id) === String(r.id) || q.load_country !== r.load_country || q.unload_country !== r.unload_country) continue;
            const level = routeLevel(lp, up, placeOfAddress(q.load_address, ca), placeOfAddress(q.unload_address, cb), ca, cb);
            const chosen = q.chosen_offer || null;
            for (const a of answersOf(q)) {
                for (const [i, o] of (a.offers || []).entries()) {
                    const p = num(o.price);
                    if (!(p > 50)) continue;
                    lg.push({
                        price: p,
                        cur: String(o.currency || "EUR").toUpperCase(),
                        level,
                        body: bodyWords(q.transport_type),
                        at: a.at || q.answered_at || q.created_at,
                        who: a.logist || "",
                        t: tons(q.weight),
                        route: [[q.load_address, ca], [q.unload_address, cb]].map(([a, c]) => placeLabel(a, c)).filter(Boolean).join(" → "),
                        client: q.client,
                        id: q.id,
                        chosen: !!chosen && String(chosen.logist_id ?? "") === String(a.logist_id ?? "") && Number(chosen.index ?? chosen.offer_index ?? -1) === i,
                    });
                }
            }
        }
        // 2. Lardi: вантажі (хто виставив вантаж і за скільки) і машини (за скільки перевізник готовий їхати)
        // Заблоковані компанії (ті самі, що на сторінці «Ларді»: r:<профіль> або n:<назва>) — не рахуємо
        const BL = new Set((blocked || []).map((b) => b.key));
        let hidden = 0;
        const isBl = (x) => BL.has(bkey(x.owner_ref, null)) || BL.has(bkey(null, x.owner_name));
        const lardiRows = (rows) =>
            rows
                .filter((x) => x.from_country === ca && x.to_country === cb)
                .filter((x) => (isBl(x) ? (hidden++, false) : true))
                .filter((x) => !x.payment_unit || /рейс/i.test(String(x.payment_unit)))
                .map((x) => ({
                    price: num(x.price),
                    cur: String(x.currency || "EUR").toUpperCase(),
                    level: routeLevel(lp, up, placeOfLardi(ca, x.from_town, x.from_region, x.from_zone), placeOfLardi(cb, x.to_town, x.to_region, x.to_zone), ca, cb),
                    body: bodyWords(x.body_types),
                    at: x.seen_last,
                    born: x.seen_first || x.seen_last,
                    route: `${placeLabelL(x.from_town, x.from_region, x.from_zone) || "?"} → ${placeLabelL(x.to_town, x.to_region, x.to_zone) || "будь-куди"}`,
                    mass: x.mass_t,
                    t: num(x.mass_t),
                    who: x.owner_name || "",
                    bkey: x.owner_ref ? bkey(x.owner_ref, null) : bkey(null, x.owner_name),
                    type: x.owner_type || "",
                    carrier_id: x.carrier_id || null,
                    id: x.id,
                }))
                .filter((x) => x.price > 50);

        const summarize = (items, min) => {
            if (!items.length) return null;
            const cur = mainCurrency(items);
            items = items.filter((x) => x.cur === cur);
            const w = preferWeight(items, wantT, min);
            const b = preferBody(w.use, want, min);
            const p = pickLevel(b.use, min);
            const prices = p.use.map((x) => x.price);
            const byType = {};
            for (const x of p.use) if (x.type) (byType[x.type] = byType[x.type] || []).push(x.price);
            // Зміна ціни: цей тиждень проти минулого (той самий рівень близькості маршруту)
            const day = 864e5, nowT = Date.now();
            const pool = b.use.filter((x) => x.level >= p.level);
            const when = (x) => new Date(x.born || x.at || 0).getTime();
            const thisW = pool.filter((x) => nowT - when(x) <= 7 * day).map((x) => x.price);
            const prevW = pool.filter((x) => nowT - when(x) > 7 * day && nowT - when(x) <= 14 * day).map((x) => x.price);
            const trend = thisW.length >= 2 && prevW.length >= 2 ? { now: median(thisW), prev: median(prevW), pct: Math.round(((median(thisW) - median(prevW)) / median(prevW)) * 100), thisW, prevW } : null;
            return {
                trend,
                cur, med: median(prices), min: Math.min(...prices), max: Math.max(...prices), n: p.use.length, level: p.level, fresh: p.fresh, oldest: p.oldest, same: b.same, wsame: w.wsame, prices,
                types: Object.entries(byType).map(([k, v]) => ({ type: k, med: median(v), n: v.length })),
                list: [...b.use].sort((x, y) => y.level - x.level || String(y.at).localeCompare(String(x.at))),
            };
        };

        const out = { cur: null, lp, up, lardiAt, blocked: blocked || [] };
        out.logist = summarize(lg, MIN_LOGIST);
        out.lardi = summarize(lardiRows(lardi), MIN_LARDI);
        out.trucks = summarize(lardiRows(trucks || []), 2);
        out.hidden = hidden;

        // Підсумок: середнє медіан усіх джерел в одній валюті (валюта — логістів, інакше першого джерела)
        const srcs = [out.logist, out.lardi, out.trucks].filter(Boolean);
        out.cur = srcs[0]?.cur || null;
        let same = srcs.filter((x) => x.cur === out.cur);
        // є свіжі джерела (7 днів) — старі в підсумок не беремо, лише показуємо
        if (same.some((x) => x.fresh)) same.filter((x) => !x.fresh).forEach((x) => (x.skipped = true));
        if (same.some((x) => x.fresh)) same = same.filter((x) => x.fresh);
        out.target = same.length ? r50(same.reduce((s2, x) => s2 + x.med, 0) / same.length) : 0;
        out.used = same.length;
        // Загальна зміна за тиждень — по всіх джерелах разом
        const tw = same.flatMap((x) => x.trend?.thisW || []), pw = same.flatMap((x) => x.trend?.prevW || []);
        if (tw.length >= 2 && pw.length >= 2) out.trend = { pct: Math.round(((median(tw) - median(pw)) / median(pw)) * 100), prev: r50(median(pw)) };
        // «від – до»: середина ринку (20–80 %) по всіх цінах, що пішли в розрахунок
        const all = same.flatMap((x) => x.prices);
        if (all.length) { out.lo = r50(pct(all, 0.2)); out.hi = r50(pct(all, 0.8)); }
        out.weak = same.reduce((s2, x) => s2 + x.n, 0) < 3 || same.some((x) => !x.fresh);
        return out;
    }

    /* ---------- Розмітка ---------- */
    const UNIT = { "Логісти": "відповідей", "Lardi вантажі": "вантажів", "Lardi машини": "машин" };
    const TYPE_SHORT = { "Вантажовласник": "вантажовласники", "Експедиція / інші": "експедиції", "Перевізник": "перевізники" };
    const trendHtml = (tr, cur, long) => {
        if (!tr) return "";
        const cls = tr.pct > 1 ? "up" : tr.pct < -1 ? "down" : "flat";
        const arrow = cls === "up" ? "▲" : cls === "down" ? "▼" : "▬";
        const txt = `${arrow} ${tr.pct > 0 ? "+" : ""}${tr.pct}%`;
        return `<span class="tr-trend tr-${cls}" title="Медіана цього тижня проти минулого">${txt}${long ? ` за тиждень <span class="tr-hint">(минулого тижня ≈ ${money(tr.prev, cur)})</span>` : ""}</span>`;
    };
    const srcLine = (s, label) =>
        s
            ? `<div class="tr-src"><span class="tr-src-name">${label}</span><b>${money(s.med, s.cur)}</b>${fx(s.med, s.cur)}${trendHtml(s.trend, s.cur)}
               <span class="tr-hint">${UNIT[label]}: ${s.n} · ${money(s.min)}–${money(s.max)} · ${LEVEL[s.level]}${s.wsame ? ` · вага ${W_LABEL[s.wsame]}` : ""}${s.same ? " · той самий кузов" : ""}${s.fresh ? ` · за ${FRESH_DAYS} дн.` : ` · <span class="tr-old">⚠ за 7 днів мало цін — тут старіші (з ${dmy(s.oldest)})${s.skipped ? ", у підсумок не пішли" : ""}</span>`}</span>
               ${s.types.length > 1 ? `<span class="tr-hint tr-types">${s.types.map((x) => `${esc(TYPE_SHORT[x.type] || x.type)}: <b>${money(x.med)}</b> (${x.n})`).join(" · ")}</span>` : ""}</div>`
            : `<div class="tr-src tr-none"><span class="tr-src-name">${label}</span><span class="tr-hint">немає цін за ${label === "Логісти" ? LOGIST_DAYS : LARDI_DAYS} днів</span></div>`;

    function listHtml(t) {
        const lg = (t.logist?.list || []).slice(0, 15);
        const ld = (t.lardi?.list || []).slice(0, 15);
        const tk = (t.trucks?.list || []).slice(0, 15);
        const lv = (x) => `<span class="tr-lv tr-lv${x.level}" title="${LEVEL[x.level]}"></span>`;
        return `
            ${lg.length ? `<div class="tr-sub">Відповіді логістів</div>
            ${lg.map((x) => `<a class="tr-it${isOld(x.at) ? " tr-stale" : ""}" href="requests.html?open=${encodeURIComponent(x.id)}">${lv(x)}<span class="tr-d">${dmy(x.at)}</span><span class="tr-r">${esc(x.route || "—")}${x.t ? `<span class="tr-hint"> · ${esc(String(Math.round(x.t * 10) / 10).replace(".", ","))} т</span>` : ""}<span class="tr-hint"> · ${esc(x.who)}</span></span><b>${fx(x.price, x.cur)} ${money(x.price, x.cur)}${x.chosen ? " ✓" : ""}</b></a>`).join("")}` : ""}
            ${ld.length ? `<div class="tr-sub">Lardi — хто виставив вантаж і за скільки</div>
            ${ld.map((x) => `<div class="tr-it${isOld(x.at) ? " tr-stale" : ""}">${lv(x)}<span class="tr-d">${dmy(x.at)}</span><span class="tr-r">${esc(x.route || "—")}${x.mass ? `<span class="tr-hint"> · ${esc(x.mass)} т</span>` : ""}${x.who ? `<span class="tr-hint"> · ${esc(x.who)}</span>` : ""}${x.type ? ` <span class="tr-tag">${esc(TYPE_SHORT[x.type] || x.type)}</span>` : ""}${blkBtn(x)}</span><b>${fx(x.price, x.cur)} ${money(x.price, x.cur)}</b></div>`).join("")}` : ""}
            ${tk.length ? `<div class="tr-sub">Lardi — машини: за скільки перевізник готовий їхати</div>
            ${tk.map((x) => `<${x.carrier_id ? `a href="carriers.html?open=${encodeURIComponent(x.carrier_id)}"` : "div"} class="tr-it${isOld(x.at) ? " tr-stale" : ""}">${lv(x)}<span class="tr-d">${dmy(x.at)}</span><span class="tr-r">${esc(x.route || "—")}${x.mass ? `<span class="tr-hint"> · ${esc(x.mass)} т</span>` : ""}${x.who ? `<span class="tr-hint"> · ${esc(x.who)}</span>` : ""}${x.carrier_id ? ` <span class="tr-tag tr-tag-f">є у FURA</span>` : ""}${blkBtn(x)}</span><b>${fx(x.price, x.cur)} ${money(x.price, x.cur)}</b></${x.carrier_id ? "a" : "div"}>`).join("")}` : ""}
            ${t.blocked.length ? `<details class="tr-bl"><summary>🚫 Заблоковані (${t.blocked.length})${t.hidden ? ` · у цьому напрямку не враховано цін: ${t.hidden}` : ""}</summary>
                ${t.blocked.map((b) => `<div class="tr-bl-row"><span>${esc(b.name || b.key)}<span class="tr-hint">${b.blocked_by ? " · " + esc(b.blocked_by) : ""}</span></span>${canEdit() ? `<button type="button" class="tr-btn" data-unblk="${esc(b.key)}">розблокувати</button>` : ""}</div>`).join("")}</details>` : ""}
            <div class="tr-hint tr-legend"><span class="tr-lv tr-lv3"></span> та сама область / воєводство / квадрат <span class="tr-lv tr-lv2"></span> сусідні області / той самий округ <span class="tr-lv tr-lv1"></span> та сама частина України <span class="tr-lv tr-lv0"></span> лише країни · ✓ — варіант, який обрав Sales</div>`;
    }

    function bodyHtml(r, t) {
        const manual = num(r.target_price) > 0;
        const cur = r.target_currency || t?.cur || "EUR";
        const auto = t?.target ? money(t.target, t.cur) : "";
        const main = manual
            ? `<b class="tr-big">${money(num(r.target_price), cur)}</b>${fx(num(r.target_price), cur)}<span class="tr-hint">вказав ${esc(r.target_by || "логіст")}${auto ? ` · розрахунок ≈ ${auto}${t.lo && t.hi ? ` (від ${money(t.lo)} до ${money(t.hi)})` : ""}` : ""}</span>`
            : auto
              ? `<b class="tr-big">≈ ${auto}</b>${fx(t.target, t.cur)}${t.lo && t.hi && t.lo !== t.hi ? `<span class="tr-range">від <b>${money(t.lo)}</b> до <b>${money(t.hi, t.cur)}</b>${fxRange(t.lo, t.hi, t.cur)}</span>` : ""}${trendHtml(t.trend, t.cur, true)}<span class="tr-hint">${t.used > 1 ? "середнє джерел нижче" : t.logist ? "за відповідями логістів" : "за Lardi"}${t.weak ? " · мало даних, орієнтуйтесь обережно" : ""}</span>`
              : `<b class="tr-big tr-muted">не визначено</b><span class="tr-hint">на цьому напрямку поки немає цін</span>`;
        return `
            <div class="tr-main">${main}
                ${canEdit() ? `<span class="tr-acts">
                    <button type="button" class="tr-btn" data-tr="edit"><i class='bx bx-edit-alt'></i> ${manual ? "Змінити" : "Своя цільова"}</button>
                    ${manual ? `<button type="button" class="tr-btn" data-tr="clear" title="Повернути розрахунок">✕</button>` : ""}
                </span>` : ""}
            </div>
            <div class="tr-edit" hidden>
                <input type="number" min="0" step="50" class="tr-in" value="${manual ? esc(num(r.target_price)) : t?.target || ""}" placeholder="сума" />
                <select class="tr-cur">${["EUR", "USD", "UAH", "PLN"].map((c) => `<option ${c === cur ? "selected" : ""}>${c}</option>`).join("")}</select>
                <button type="button" class="tr-btn tr-save" data-tr="save">Зберегти</button>
            </div>
            ${t ? `<div class="tr-srcs">${srcLine(t.logist, "Логісти")}${srcLine(t.lardi, "Lardi вантажі")}${srcLine(t.trucks, "Lardi машини")}</div>` : ""}
            ${FX ? `<div class="tr-hint tr-upd">Курс НБУ${FX.date ? ` на ${esc(FX.date)}` : ""}: 1 € = ${String(FX.EUR.toFixed(2)).replace(".", ",")} грн · 1 $ = ${String((FX.USD || 0).toFixed(2)).replace(".", ",")} грн</div>` : ""}
            ${t?.lardiAt ? `<div class="tr-hint tr-upd"><i class='bx bx-refresh'></i> Lardi оновлюється автоматично ~3 рази на день · останнє оновлення ${new Date(t.lardiAt).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>` : ""}
            ${t && (t.logist || t.lardi || t.trucks) ? `<details class="tr-more"><summary>Звідки ціни</summary>${listHtml(t)}</details>` : ""}
            <div class="tr-msg" role="status"></div>`;
    }

    function sectionHtml(r) {
        if (!r?.load_country || !r?.unload_country) return "";
        return `
        <div class="card-section tr-section" id="targetRateBox">
            <div class="card-section-title"><span><i class='bx bx-target-lock'></i> Цільова ставка перевізнику</span></div>
            <div class="tr-body"><div class="tr-hint">Рахую…</div></div>
        </div>`;
    }

    // Ціни у відповідях логістів (картка запиту): у дужках — гривні / євро за НБУ
    async function fillFx(root) {
        await loadFx();
        (root || document).querySelectorAll(".fx-slot:not([data-done])").forEach((el) => {
            el.dataset.done = "1";
            el.innerHTML = fx(num(el.dataset.v), el.dataset.c || "EUR");
        });
    }

    let cur = null;
    async function mount(r) {
        cur = r;
        fillFx(document.getElementById("requestCardBody"));
        const box = document.getElementById("targetRateBox");
        if (!box) return;
        let t = null;
        try {
            t = await compute(r);
        } catch (e) {
            console.warn("target-rate", e);
        }
        if (cur !== r) return;
        const body = box.querySelector(".tr-body");
        body.innerHTML = bodyHtml(r, t);
        body.onclick = async (e) => {
            const bl = e.target.closest("[data-blk],[data-unblk]");
            if (bl) {
                e.preventDefault();
                e.stopPropagation();
                const on = !!bl.dataset.blk;
                const key = bl.dataset.blk || bl.dataset.unblk;
                if (on && !confirm(`Заблокувати «${bl.dataset.blkName}»?\nЙого ціни не враховуватимуться в цільовій ставці, і його заявки та машини не показуватимуться на сторінці «Ларді» (для всіх).`)) return;
                const { error } = on
                    ? await client.from("lardi_blocked").upsert({ key, name: bl.dataset.blkName, blocked_by: currentStaff?.full_name || "" }, { onConflict: "key" })
                    : await client.from("lardi_blocked").delete().eq("key", key);
                if (error) return alert(/lardi_blocked/.test(error.message) ? "Спершу один раз виконайте lardi_blocked.sql у Supabase → SQL Editor." : "Не вдалося: " + error.message);
                cache.clear();
                const wasOpen = !!body.querySelector(".tr-more[open]");
                await mount(r);
                if (wasOpen) body.querySelector(".tr-more")?.setAttribute("open", "");
                return;
            }
            const b = e.target.closest("[data-tr]");
            if (!b) return;
            const act = b.dataset.tr;
            if (act === "edit") {
                body.querySelector(".tr-edit").hidden = false;
                body.querySelector(".tr-in").focus();
                return;
            }
            const price = act === "clear" ? null : num(body.querySelector(".tr-in").value) || null;
            const patch = {
                target_price: price,
                target_currency: price ? body.querySelector(".tr-cur").value : null,
                target_by: price ? currentStaff?.full_name || null : null,
                target_at: price ? new Date().toISOString() : null,
            };
            b.disabled = true;
            const { error } = await client.from("requests").update(patch).eq("id", r.id);
            b.disabled = false;
            if (error) {
                const m = body.querySelector(".tr-msg");
                m.textContent = /target_/.test(error.message || "") ? "Спершу виконайте target_rate.sql у Supabase." : "Не вдалося зберегти: " + error.message;
                m.classList.add("bad");
                return;
            }
            Object.assign(r, patch);
            body.innerHTML = bodyHtml(r, t);
        };
    }

    // Коротка підказка у вікні «Відповідь логіста»
    async function hintFor(r, el) {
        if (!el) return;
        el.innerHTML = "";
        if (!r?.load_country || !r?.unload_country) return;
        let t = null;
        try {
            t = await compute(r);
        } catch (_) {
            return;
        }
        const manual = num(r.target_price) > 0;
        if (!manual && !t?.target) return;
        const bits = [];
        if (t?.logist) bits.push(`логісти ${money(t.logist.med, t.logist.cur)} (${t.logist.n})`);
        if (t?.lardi) bits.push(`Lardi вантажі ${money(t.lardi.med, t.lardi.cur)} (${t.lardi.n})`);
        if (t?.trucks) bits.push(`Lardi машини ${money(t.trucks.med, t.trucks.cur)} (${t.trucks.n})`);
        el.innerHTML = `<i class='bx bx-target-lock'></i> Цільова: <b>${manual ? money(num(r.target_price), r.target_currency) : "≈ " + money(t.target, t.cur)}</b> ${manual ? fx(num(r.target_price), r.target_currency) : fx(t.target, t.cur)}${!manual && t.lo && t.hi && t.lo !== t.hi ? ` (від ${money(t.lo)} до ${money(t.hi, t.cur)})` : ""}${!manual && t?.trend ? " " + trendHtml(t.trend, t.cur, true) : ""}${bits.length ? ` <span class="tr-hint">· ${esc(bits.join(" · "))}</span>` : ""}`;
    }

    if (!document.getElementById("tr-style")) {
        const st = document.createElement("style");
        st.id = "tr-style";
        st.textContent = `
            .tr-section .card-section-title i{color:#c8a14a}
            .tr-body{padding:4px 16px 12px}
            .tr-main{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
            .tr-big{font-size:20px}.tr-fx{font-size:12.5px;color:#6b7280;font-weight:500;margin-left:4px}.offer-price .tr-fx{display:block;margin:0}.tr-it b .tr-fx{margin:0 6px 0 0}.tr-range{font-size:14px;color:#334155}.tr-trend{font-size:13px;font-weight:700;border-radius:8px;padding:1px 8px}.tr-up{background:#fee2e2;color:#b91c1c}.tr-down{background:#dcfce7;color:#166534}.tr-flat{background:#f1f5f9;color:#475569}.tr-muted{color:#94a3b8;font-size:16px}
            .tr-hint{font-size:12px;color:#6b7280}
            .tr-acts{margin-left:auto;display:flex;gap:6px}
            .tr-btn{border:1px solid #d6dbe3;background:#fff;border-radius:8px;padding:3px 10px;font-size:12.5px;cursor:pointer;color:#334155}
            .tr-btn:hover{border-color:#c8a14a}
            .tr-save{background:#c8a14a;border-color:#c8a14a;color:#fff}
            .tr-edit{display:flex;gap:6px;margin:8px 0}.tr-edit[hidden]{display:none}
            .tr-in{width:120px;padding:4px 8px;border:1px solid #d6dbe3;border-radius:8px}
            .tr-cur{padding:4px 6px;border:1px solid #d6dbe3;border-radius:8px}
            .tr-srcs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px 16px;margin-top:8px}
            @media(max-width:1100px){.tr-srcs{grid-template-columns:1fr}}
            .tr-src{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:14px}
            .tr-src-name{font-size:12px;font-weight:700;color:#475569;min-width:52px}
            .tr-more{margin-top:8px;font-size:13px}.tr-more summary{cursor:pointer;color:#1d5bd8;font-weight:600}
            .tr-sub{font-size:12px;font-weight:700;color:#475569;margin:8px 0 2px}
            .tr-it{display:grid;grid-template-columns:10px 44px 1fr auto;gap:8px;align-items:center;padding:3px 0;border-bottom:1px dashed #eef1f5;color:inherit;text-decoration:none}
            a.tr-it:hover{background:#f8fafc}
            .tr-d{color:#6b7280;font-size:12px}.tr-r{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
            .tr-lv{display:inline-block;width:8px;height:8px;border-radius:50%;background:#cbd5e1}
            .tr-lv3{background:#16a34a}.tr-lv2{background:#f59e0b}.tr-lv1{background:#60a5fa}.tr-old{color:#b45309}
            .tr-stale{opacity:.55}.tr-blk{border:0;background:none;cursor:pointer;font-size:12px;margin-left:6px;opacity:0;padding:0 2px}.tr-it:hover .tr-blk{opacity:.8}.tr-blk:hover{opacity:1!important}.tr-bl{margin-top:8px;font-size:13px}.tr-bl summary{cursor:pointer;color:#b91c1c;font-weight:600}.tr-bl-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:3px 0;border-bottom:1px dashed #eef1f5}.tr-upd{margin-top:6px}.tr-tag{font-size:11px;background:#f1f5f9;color:#475569;border-radius:6px;padding:0 6px;margin-left:4px}.tr-tag-f{background:#dcfce7;color:#166534}.tr-types{flex-basis:100%}.tr-legend{margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
            .tr-msg{font-size:12.5px;min-height:0}.tr-msg.bad{color:#b91c1c;margin-top:6px}
            .tr-answer-hint{margin:0 0 10px;padding:8px 12px;border-radius:10px;background:#fbf7ec;border:1px solid #efe3c2;font-size:13.5px}
            .tr-answer-hint:empty{display:none}
            [data-theme="dark"] .tr-btn,[data-theme="dark"] .tr-in,[data-theme="dark"] .tr-cur{background:#1f2937;color:#e5e7eb;border-color:#374151}
            [data-theme="dark"] .tr-answer-hint{background:#2a2414;border-color:#4a3f20}
            [data-theme="dark"] a.tr-it:hover{background:#111827}`;
        document.head.appendChild(st);
    }

    window.furaTargetRate = { sectionHtml, mount, hintFor, compute, fillFx, _place: placeOfAddress };
})();
