/* ================================================================= *
 * FURA — ПІДБІР МАШИН З «ЧЕРГИ» ПІД ЗАПИТ                            *
 * Кнопка «🚚 Машини з черги» в картці запиту (requests.html).        *
 *                                                                    *
 * Кого шукаємо для запиту із завантаженням за кордоном:              *
 *   • машини, що ЩОЙНО ПРОЇХАЛИ кордон (echerha_passed) — з вантажем  *
 *     розвантажаться за 1–3 дні й шукатимуть зворотний вантаж;        *
 *   • машини, що СТОЯТЬ У ЧЕРЗІ зараз (echerha_queue) — виїдуть скоро; *
 *   • порожні черги — їдуть під завантаження.                         *
 * Оцінка: чи встигає до дати завантаження + потрібний кузов +         *
 * чи возить цей напрямок (carrier_routes) + угоди з нами + Telegram.  *
 * Обраних — одним кліком у «AI-агенти» → запит ставки.                *
 * ================================================================= */

(function () {
    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) return;

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const keyCode = (v) => String(v || "").replace(/\D/g, "").replace(/^0+/, "");
    const DAY = 86400000;
    const isUA = (c) => /^УКРА/i.test(String(c || "").trim());
    const nice = (c) => { const x = String(c || "").toLowerCase().replace(/^польша$/, "польща"); return x.charAt(0).toUpperCase() + x.slice(1); };
    const cpShort = (n) => String(n || "").replace(/\.\s*Товари.*$/i, "").replace(/\s*\((для|Туреччина|≥)[^)]*\)/gi, "").trim();

    /* ---------- Довідники ---------- */

    // Країна завантаження → які виїзди з України ведуть туди (за назвою країни пункту в Черзі)
    // Перший у списку — основний (більше балів).
    const EXITS = {
        "ПОЛЬША": ["польщ"], "ПОЛЬЩА": ["польщ"], "ЛИТВА": ["польщ"], "ЛАТВІЯ": ["польщ"], "ЕСТОНІЯ": ["польщ"],
        "НІМЕЧЧИНА": ["польщ", "словач"], "НІДЕРЛАНДИ": ["польщ", "словач"], "БЕЛЬГІЯ": ["польщ", "словач"],
        "ДАНІЯ": ["польщ"], "ШВЕЦІЯ": ["польщ"], "ФІНЛЯНДІЯ": ["польщ"], "ФРАНЦІЯ": ["польщ", "словач", "угорщ"],
        "ВЕЛИКОБРИТАНІЯ": ["польщ", "словач"], "ЧЕХІЯ": ["польщ", "словач"], "АВСТРІЯ": ["словач", "угорщ", "польщ"],
        "СЛОВАЧЧИНА": ["словач", "польщ", "угорщ"], "УГОРЩИНА": ["угорщ", "словач"], "СЛОВЕНІЯ": ["угорщ", "словач"],
        "ХОРВАТІЯ": ["угорщ"], "ІТАЛІЯ": ["угорщ", "словач", "польщ"], "ІСПАНІЯ": ["угорщ", "польщ", "словач"],
        "ПОРТУГАЛІЯ": ["угорщ", "польщ"], "РУМУНІЯ": ["румун", "молдов", "угорщ"], "БОЛГАРІЯ": ["румун", "молдов"],
        "ГРЕЦІЯ": ["румун", "молдов"], "ТУРЕЧЧИНА": ["румун", "молдов", "турец"], "МОЛДОВА": ["молдов", "румун"],
        "СЕРБІЯ": ["угорщ", "румун"], "ГРУЗІЯ": ["груз", "турец", "румун"], "ВІРМЕНІЯ": ["груз", "турец", "румун"],
        "АЗЕРБАЙДЖАН": ["груз", "турец", "румун"],
    };
    // Орієнтовно днів від кордону до країни завантаження
    const TRANSIT = {
        "ПОЛЬША": 1, "ПОЛЬЩА": 1, "СЛОВАЧЧИНА": 1, "УГОРЩИНА": 1, "РУМУНІЯ": 1, "МОЛДОВА": 1,
        "ЛИТВА": 2, "ЛАТВІЯ": 2, "ЧЕХІЯ": 2, "НІМЕЧЧИНА": 2, "АВСТРІЯ": 2, "БОЛГАРІЯ": 2, "СЛОВЕНІЯ": 2, "ХОРВАТІЯ": 2,
        "ЕСТОНІЯ": 3, "НІДЕРЛАНДИ": 3, "БЕЛЬГІЯ": 3, "ДАНІЯ": 3, "ФРАНЦІЯ": 3, "ІТАЛІЯ": 3, "ГРЕЦІЯ": 3, "ТУРЕЧЧИНА": 3, "СЕРБІЯ": 2,
        "ІСПАНІЯ": 4, "ВЕЛИКОБРИТАНІЯ": 4, "ШВЕЦІЯ": 3, "ФІНЛЯНДІЯ": 4, "ПОРТУГАЛІЯ": 5,
        "ГРУЗІЯ": 5, "ВІРМЕНІЯ": 6, "АЗЕРБАЙДЖАН": 6,
    };
    // Тип транспорту в запиті → кузов у Черзі
    const BODY = {
        "ТЕНТ": ["тент"], "МЕГА": ["тент"], "СЦЕПКА": ["тент"], "РЕФ": ["реф"], "ІЗОТЕРМ": ["реф", "фургон"],
        "ЦІЛЬНОМЕТ": ["фургон"], "КОНТЕЙНЕРОВОЗ": ["контейнеровоз"], "ПЛАТФОРМА": ["платформа"], "АВТОВОЗ": ["автовоз"],
        "ЦИСТЕРНА": ["цистерна"], "САМОСКИД": ["самоскид"], "БОРТОВИЙ": ["бортовий"],
    };
    // Орієнтовні «центри» країн (логістичні хаби) — для перегону від місця розвантаження до завантаження
    const COORD = {
        "ПОЛЬША": [52.0, 19.5], "ПОЛЬЩА": [52.0, 19.5], "НІМЕЧЧИНА": [51.0, 10.0], "НІДЕРЛАНДИ": [52.1, 5.3], "БЕЛЬГІЯ": [50.8, 4.4],
        "ФРАНЦІЯ": [47.0, 2.5], "ІТАЛІЯ": [45.4, 10.0], "ІСПАНІЯ": [40.4, -3.7], "ПОРТУГАЛІЯ": [39.5, -8.0], "АВСТРІЯ": [48.2, 15.0],
        "ЧЕХІЯ": [49.8, 15.5], "СЛОВАЧЧИНА": [48.7, 19.5], "УГОРЩИНА": [47.3, 19.2], "РУМУНІЯ": [45.5, 25.0], "БОЛГАРІЯ": [42.7, 25.0],
        "МОЛДОВА": [47.0, 28.8], "ЛИТВА": [55.0, 24.0], "ЛАТВІЯ": [56.9, 24.6], "ЕСТОНІЯ": [59.0, 25.0], "ДАНІЯ": [55.7, 10.0],
        "ШВЕЦІЯ": [59.0, 15.0], "ФІНЛЯНДІЯ": [61.0, 25.0], "ВЕЛИКОБРИТАНІЯ": [52.5, -1.5], "ШВЕЙЦАРІЯ": [47.0, 8.0], "СЛОВЕНІЯ": [46.0, 14.8],
        "ХОРВАТІЯ": [45.5, 16.0], "СЕРБІЯ": [44.5, 20.5], "ГРЕЦІЯ": [39.0, 22.0], "ТУРЕЧЧИНА": [40.5, 30.5], "ГРУЗІЯ": [41.7, 44.8],
        "ВІРМЕНІЯ": [40.2, 44.5], "АЗЕРБАЙДЖАН": [40.4, 49.9],
    };
    const KM_PER_DAY = 650;
    function distKm(a, b) {
        if (!a || !b) return null;
        const R = 6371, rad = Math.PI / 180;
        const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h)) * 1.25; // ×1.25 — дорогами, а не по прямій
    }
    // Кирилиця, схожа на латиницю → латиниця; без пробілів і дефісів (номери в Черзі й у митниці пишуть по-різному)
    const LOOK = { А: "A", В: "B", Е: "E", І: "I", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y" };
    const normPlate = (v) => String(v || "").toUpperCase().replace(/[АВЕІКМНОРСТХУ]/g, (c) => LOOK[c]).replace(/[^A-Z0-9]/g, "");
    // «Ягодин – Дорогуськ (для …)» → «ягодин»; «Рава-Руська – Хребенне» → «рава»
    const cpKey = (n) => String(n || "").toLowerCase().replace(/^пункт пропуску\s+/, "").split(/[\s–—-]+/)[0] || "";
    const countryOfExit = (queueCountry) => String(queueCountry || "").toLowerCase();
    // «Бухарест (3), Констанца» → [[Бухарест,3],[Констанца,1]]
    function counts(txt) {
        return String(txt || "")
            .split(/,\s*(?![^()]*\))/)
            .map((x) => x.trim())
            .filter(Boolean)
            .map((x) => {
                const m = x.match(/^(.*?)\s*\((\d+)\)$/);
                return [(m ? m[1] : x).trim(), m ? Number(m[2]) : 1];
            });
    }
    const simple = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zа-яіїєґ0-9]/g, "");

    const BAD_OUTCOMES = /немає такого причепу|не відповів|не працює|відмов|не наш|шахра|не возить/i;

    /* ---------- Дати ---------- */

    function parseWhen(v) {
        const s = String(v || "").trim();
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0));
        m = s.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?:\s+(\d{1,2}):(\d{2}))?/);
        if (m) {
            const now = new Date();
            let y = m[3] ? +(m[3].length === 2 ? "20" + m[3] : m[3]) : now.getFullYear();
            const d = new Date(y, +m[2] - 1, +m[1], +(m[4] || 12), +(m[5] || 0));
            if (!m[3] && d - now > 200 * DAY) d.setFullYear(y - 1);
            return d;
        }
        const t = Date.parse(s);
        return isNaN(t) ? null : new Date(t);
    }
    const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const fmtDay = (d) => (d ? d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" }) : "—");
    const fmtDT = (d) => (d ? d.toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

    /* ---------- Що шукати для запиту ---------- */

    function splitTypes(v) {
        return String(v || "").split(/[;,]/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    }

    function paramsOf(r) {
        const load = String(r.load_country || "").trim().toUpperCase();
        const unload = String(r.unload_country || "").trim().toUpperCase();
        const abroadLoad = load && !isUA(load);
        const bodies = [...new Set(splitTypes(r.transport_type).flatMap((t) => BODY[t] || []))];
        const from = r.desired_date ? dayStart(new Date(r.desired_date + "T00:00:00")) : dayStart(new Date());
        const to = r.desired_date_to ? dayStart(new Date(r.desired_date_to + "T00:00:00")) : new Date(from.getTime() + 2 * DAY);
        return {
            load, unload, abroadLoad, bodies,
            exits: EXITS[load] || [],
            transit: TRANSIT[load] ?? 2,
            from, to,
            importLike: abroadLoad && isUA(unload),
        };
    }

    function buttonHtml(r) {
        const p = paramsOf(r);
        if (!p.abroadLoad) return ""; // для експорту з України черга на виїзд не допоможе — є «Підібрати перевізників»
        return `<button type="button" class="btn-match btn-qmatch" data-qmatch="${esc(r.id)}" title="Машини, які зараз виїжджають або щойно виїхали з України в бік завантаження">🚚 Машини з черги</button>`;
    }

    /* ---------- Дані ---------- */

    async function pageAll(build, max = 15000) {
        const rows = [];
        for (let from = 0; from < max; from += 1000) {
            const { data, error } = await build().range(from, from + 999);
            if (error) return { data: rows, error };
            rows.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
        return { data: rows, error: null };
    }

    const COLS = "tractor, trailer, checkpoint, country, qtype, carrier, edrpou, boss, trailer_body, trailer_model, ua, entry_at";

    function applyFilters(q, p, opt) {
        q = q.not("edrpou", "is", null);
        if (opt.onlyUa) q = q.eq("ua", true);
        if (p.exits.length) q = q.or(p.exits.map((x) => `country.ilike.*${x}*`).join(","));
        if (opt.bodies.length) q = q.or(opt.bodies.map((b) => `trailer_body.ilike.*${b}*`).join(","));
        return q;
    }

    async function loadTrucks(p, opt) {
        const since = new Date(Date.now() - opt.passedHours * 3600000).toISOString();
        const [queue, passed] = await Promise.all([
            pageAll(() => applyFilters(client.from("echerha_queue").select(COLS), p, opt).order("id")),
            pageAll(() => applyFilters(client.from("echerha_passed").select(COLS + ", passed_at"), p, opt).gte("passed_at", since).order("passed_at", { ascending: false })),
        ]);
        const passedMissing = passed.error && /echerha_passed/.test(passed.error.message || "");
        return {
            queue: queue.data,
            passed: passedMissing ? [] : passed.data,
            error: queue.error ? queue.error.message : passed.error && !passedMissing ? passed.error.message : null,
            passedMissing,
        };
    }

    async function inChunks(codes, fn) {
        const out = [];
        for (let i = 0; i < codes.length; i += 150) out.push(...((await fn(codes.slice(i, i + 150))) || []));
        return out;
    }
    const codeForms = (codes) => [...new Set(codes.flatMap((c) => [c, c.padStart(8, "0")]))];

    async function loadContext(codes, p) {
        const forms = codeForms(codes);
        const [carriers, routes, deals] = await Promise.all([
            inChunks(forms, async (part) => (await client.from("carriers")
                .select("id, name, edrpou, phone_1, phone_2, tg_chat_id, rating, trailer_type, match_hidden_reason, match_hidden_until")
                .in("edrpou", part)).data),
            p.importLike
                ? inChunks(forms, async (part) => (await client.from("carrier_routes")
                      .select("edrpou, records, trucks, month").eq("direction", "Імпорт").eq("country", p.load).in("edrpou", part)).data)
                : Promise.resolve([]),
            client.from("deals").select("carrier_id, carrier_edrpou").limit(10000).then((r) => r.data || []),
        ]);
        // Куди перевізник возить ЕКСПОРТ (митні дані) — щоб передбачити, де розвантажиться машина з вантажем
        let exportRoutes = await inChunks(forms, async (part) => (await client.from("carrier_routes")
            .select("edrpou, country, records, border, borders, cities, plates").eq("direction", "Експорт").in("edrpou", part)).data);
        if (!exportRoutes.length) {
            // старі дані без колонок міст/кордонів
            exportRoutes = await inChunks(forms, async (part) => (await client.from("carrier_routes")
                .select("edrpou, country, records, border, plates").eq("direction", "Експорт").in("edrpou", part)).data);
        }
        const ids = (carriers || []).map((c) => String(c.id));
        const since = new Date(Date.now() - 60 * DAY).toISOString();
        const feedback = ids.length
            ? await inChunks(ids, async (part) => (await client.from("carrier_feedback")
                  .select("carrier_id, outcome, created_at").in("carrier_id", part).gte("created_at", since)).data)
            : [];
        return { carriers: carriers || [], routes: routes || [], deals, feedback, exportRoutes: exportRoutes || [] };
    }

    /* ---------- Оцінка ---------- */

    function rank(trucks, ctx, p) {
        const carriers = new Map(ctx.carriers.map((c) => [keyCode(c.edrpou), c]));
        const lane = new Map();
        ctx.routes.forEach((r) => {
            const k = keyCode(r.edrpou);
            lane.set(k, (lane.get(k) || 0) + (r.records || 0));
        });
        const deals = new Map();
        ctx.deals.forEach((d) => {
            const k = d.carrier_id ? "id:" + d.carrier_id : d.carrier_edrpou ? "code:" + keyCode(d.carrier_edrpou) : null;
            if (k) deals.set(k, (deals.get(k) || 0) + 1);
        });
        const bad = new Map();
        ctx.feedback.forEach((f) => {
            if (BAD_OUTCOMES.test(f.outcome || "")) bad.set(String(f.carrier_id), (bad.get(String(f.carrier_id)) || 0) + 1);
        });
        const today = dayStart(new Date());

        // Експортна історія перевізника: країна → вага, міста, кордони, номери тягачів
        const exp = new Map();
        (ctx.exportRoutes || []).forEach((r) => {
            const k = keyCode(r.edrpou);
            const list = exp.get(k) || [];
            list.push({
                country: String(r.country || "").toUpperCase(),
                records: r.records || 1,
                borders: (counts(r.borders).map(([b]) => cpKey(b)).concat(r.border ? [cpKey(r.border)] : [])),
                cities: counts(r.cities),
                plates: new Set(String(r.plates || "").split(/[,;]\s*/).map(normPlate).filter(Boolean)),
            });
            exp.set(k, list);
        });
        const loadCity = simple(String(current?.r?.load_address || "").split(/[,(]/)[0]);

        // Куди, ймовірно, їде машина з вантажем: її власні рейси > рейси перевізника через цей кордон > усі рейси перевізника
        function predict(t) {
            const rows = exp.get(keyCode(t.edrpou)) || [];
            if (!rows.length) return null;
            const plate = normPlate(t.tractor), cp = cpKey(t.checkpoint), exitC = countryOfExit(t.country);
            const w = new Map();
            let own = false;
            for (const r of rows) {
                let x = r.records;
                if (plate && r.plates.has(plate)) { x *= 4; own = true; }
                if (cp && r.borders.includes(cp)) x *= 2;
                const ex = EXITS[r.country];
                if (ex && exitC && !ex.some((e) => exitC.includes(e))) x *= 0.15; // з Ягодина в Румунію не їдуть
                const a = w.get(r.country) || { w: 0, cities: new Map() };
                a.w += x;
                r.cities.forEach(([c, n]) => a.cities.set(c, (a.cities.get(c) || 0) + n));
                w.set(r.country, a);
            }
            const total = [...w.values()].reduce((s, a) => s + a.w, 0);
            const [country, a] = [...w.entries()].sort((x, y) => y[1].w - x[1].w)[0];
            const cities = [...a.cities.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([c]) => c);
            return { country, conf: total ? a.w / total : 0, cities, own };
        }

        // Кожна машина: коли орієнтовно зможе бути на завантаженні
        const scored = trucks.map((t) => {
            const crossed = t.passed_at ? new Date(t.passed_at) : parseWhen(t.entry_at) || new Date();
            const loaded = !/порожн/i.test(t.qtype || "");
            const dest = loaded ? predict(t) : null;
            let days = p.transit + (loaded ? 1 : 0), repoKm = null, sameCountry = false, cityHit = null;
            if (dest) {
                repoKm = dest.country === p.load || (dest.country === "ПОЛЬЩА" && p.load === "ПОЛЬША") ? 0 : distKm(COORD[dest.country], COORD[p.load]);
                sameCountry = repoKm === 0;
                const toDest = TRANSIT[dest.country] ?? p.transit;
                if (repoKm !== null) days = toDest + 1 + Math.ceil(repoKm / KM_PER_DAY);
                if (loadCity.length >= 4) cityHit = dest.cities.find((c) => { const sc = simple(c); return sc.length >= 4 && (sc.includes(loadCity) || loadCity.includes(sc)); }) || null;
            }
            const avail = dayStart(new Date(crossed.getTime() + days * DAY));
            const ready = avail < today ? today : avail;
            const off = ready < p.from ? Math.round((p.from - ready) / DAY) : ready > p.to ? Math.round((ready - p.to) / DAY) : 0;
            const late = ready > p.to;
            const country = String(t.country || "").toLowerCase();
            const exitIdx = p.exits.findIndex((x) => country.includes(x));
            let s = late ? Math.max(0, 40 - off * 18) : Math.max(0, 40 - off * 8); // запізнення гірше, ніж «зарано»
            if (exitIdx === 0) s += 10;
            else if (exitIdx > 0) s += 4;
            if (loaded) s += 8; // зворотний вантаж — перевізник візьме дешевше
            if (dest && repoKm !== null) {
                const near = sameCountry ? 15 : repoKm < 450 ? 9 : repoKm < 900 ? 4 : repoKm > 1600 ? -6 : 0;
                s += near * Math.min(1, 0.4 + dest.conf); // впевненість прогнозу
                if (cityHit) s += 6;
            }
            return { t, crossed, loaded, ready, off, late, passed: !!t.passed_at, s, dest, repoKm, sameCountry, cityHit };
        });

        // Групуємо за перевізником: найкраща машина + скільки ще
        const by = new Map();
        for (const x of scored) {
            const k = keyCode(x.t.edrpou);
            if (!k) continue;
            const g = by.get(k) || { code: k, trucks: [], best: null };
            g.trucks.push(x);
            if (!g.best || x.s > g.best.s) g.best = x;
            by.set(k, g);
        }

        const list = [];
        for (const g of by.values()) {
            const c = carriers.get(g.code) || null;
            const hidden = !!(c && c.match_hidden_reason && (!c.match_hidden_until || String(c.match_hidden_until).slice(0, 10) >= new Date().toISOString().slice(0, 10)));
            const dealsN = c ? deals.get("id:" + c.id) || deals.get("code:" + g.code) || 0 : deals.get("code:" + g.code) || 0;
            const laneN = lane.get(g.code) || 0;
            const badN = c ? bad.get(String(c.id)) || 0 : 0;
            const tg = !!c?.tg_chat_id;
            const phone = !!(c && (String(c.phone_1 || "").replace(/\D/g, "").length >= 9 || String(c.phone_2 || "").replace(/\D/g, "").length >= 9));
            const fit = g.trucks.filter((x) => x.off <= 1).length;
            let score = g.best.s;
            score += Math.min(dealsN * 5, 20);
            score += Math.min(laneN, 30) / 2;
            score += tg ? 8 : 0;
            score += phone ? 3 : 0;
            score += (c?.rating || 0) * 2;
            score += Math.min(Math.max(fit - 1, 0) * 3, 9);
            score -= badN * 10;
            if (!c) score *= 0.6;

            const why = [];
            const b = g.best;
            why.push(b.passed ? `проїхав ${cpShort(b.t.checkpoint)} ${fmtDT(b.crossed)}` : `у черзі ${cpShort(b.t.checkpoint)}, в'їзд ~${fmtDT(b.crossed)}`);
            if (b.loaded && b.dest) {
                const pct = Math.round(b.dest.conf * 100);
                why.push(`везе, ймовірно: ${nice(b.dest.country)}${b.dest.cities.length ? " (" + b.dest.cities.join(", ") + ")" : ""} — ${pct}% ${b.dest.own ? "рейсів цього тягача" : "рейсів перевізника"}`);
                why.push(b.sameCountry ? `розвантажиться в країні завантаження → вільний ~${fmtDay(b.ready)}` : `звідти ~${Math.round(b.repoKm)} км до країни завантаження → вільний ~${fmtDay(b.ready)}`);
                if (b.cityHit) why.push(`часто буває в ${b.cityHit} — поруч із завантаженням`);
            } else {
                why.push(b.loaded ? `з вантажем, куди — невідомо → вільний ~${fmtDay(b.ready)}` : `порожній → може бути на завантаженні ~${fmtDay(b.ready)}`);
            }
            if (b.off === 0) why.push("встигає до дати");
            else why.push(b.late ? `запізнення ~${b.off} дн.` : `раніше на ~${b.off} дн.`);
            if (fit > 1) why.push(`ще ${fit - 1} машин(и) у вікні`);
            if (dealsN) why.push(`${dealsN} угод(и) з нами`);
            if (laneN) why.push(`возить ${nice(p.load)} → Україна (${laneN} декл.)`);
            if (badN) why.push(`⚠ ${badN} негативн. відгук(и) за 60 дн.`);

            list.push({ g, c, hidden, dealsN, laneN, badN, tg, phone, fit, score, why });
        }
        return list.sort((a, b) => b.score - a.score);
    }

    /* ---------- Вікно ---------- */

    let overlay = null;
    let current = null;
    const picked = new Set();

    function ensureModal() {
        if (overlay) return overlay;
        overlay = document.createElement("div");
        overlay.className = "modal-overlay qm-overlay";
        overlay.innerHTML = `
            <div class="modal qm-modal" role="dialog" aria-modal="true" aria-labelledby="qmTitle">
                <div class="qm-head">
                    <div>
                        <h2 id="qmTitle">🚚 Машини з черги під запит</h2>
                        <div class="qm-sub" id="qmSub"></div>
                    </div>
                    <button type="button" class="qm-close" data-qm="close" title="Закрити"><i class="bx bx-x"></i></button>
                </div>
                <div class="qm-filters">
                    <div class="qm-bodies" id="qmBody"></div>
                    <label>Проїхали кордон за <select id="qmHours"><option value="24">24 год</option><option value="48">48 год</option><option value="72" selected>72 год</option><option value="120">5 днів</option></select></label>
                    <label class="qm-check"><input type="checkbox" id="qmLoaded" checked /> з вантажем</label>
                    <label class="qm-check"><input type="checkbox" id="qmEmpty" checked /> порожні</label>
                    <label class="qm-check"><input type="checkbox" id="qmUa" checked /> лише українські тягачі</label>
                    <label class="qm-check"><input type="checkbox" id="qmFit" /> лише ті, що встигають</label>
                    <button type="button" class="btn btn-secondary" data-qm="refresh"><i class="bx bx-refresh"></i> Оновити</button>
                </div>
                <div class="qm-note" id="qmNote"></div>
                <div id="qmList" class="qm-list"></div>
                <div class="qm-foot">
                    <span id="qmPicked">Оберіть перевізників</span>
                    <button type="button" class="btn btn-primary" data-qm="bids" disabled><i class="bx bx-bot"></i> Запросити ставки</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener("click", onClick);
        overlay.addEventListener("change", onChange);
        overlay.addEventListener("submit", (e) => {
            if (!e.target.classList.contains("qm-phone-form")) return;
            e.preventDefault();
            savePhone(e.target);
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && overlay.classList.contains("active")) close();
        });
        return overlay;
    }

    function close() {
        overlay?.classList.remove("active");
    }

    function options() {
        const sel = [...overlay.querySelectorAll("#qmBody input:checked")].map((o) => o.value);
        return {
            bodies: sel,
            passedHours: Number(overlay.querySelector("#qmHours").value) || 72,
            loaded: overlay.querySelector("#qmLoaded").checked,
            empty: overlay.querySelector("#qmEmpty").checked,
            onlyUa: overlay.querySelector("#qmUa").checked,
            onlyFit: overlay.querySelector("#qmFit").checked,
        };
    }

    async function open(id) {
        const r = (typeof requestsCache !== "undefined" ? requestsCache : []).find((x) => String(x.id) === String(id));
        if (!r) return;
        ensureModal();
        current = { r, p: paramsOf(r) };
        picked.clear();
        const p = current.p;
        overlay.querySelector("#qmSub").textContent =
            `${r.client || "Запит"} · ${nice(p.load)}${r.load_address ? " (" + r.load_address + ")" : ""} → ${nice(p.unload) || "—"} · ` +
            `завантаження ${fmtDay(p.from)}${+p.to !== +p.from ? "–" + fmtDay(p.to) : ""}${r.desired_date ? "" : " (дата не вказана — беру 3 дні від сьогодні)"}`;
        const allBodies = ["тент", "реф", "фургон", "платформа", "контейнеровоз", "автовоз", "бортовий", "цистерна", "самоскид"];
        overlay.querySelector("#qmBody").innerHTML = allBodies
            .map((b) => `<label class="qm-body"><input type="checkbox" value="${b}" ${p.bodies.includes(b) ? "checked" : ""} /> ${b}</label>`)
            .join("");
        overlay.classList.add("active");
        await search();
    }

    async function search() {
        const { p } = current;
        const my = (current.seq = (current.seq || 0) + 1); // нові фільтри скасовують попередній пошук
        const opt = options();
        const listBox = overlay.querySelector("#qmList");
        const note = overlay.querySelector("#qmNote");
        listBox.innerHTML = `<p class="qm-empty">Шукаю в черзі…</p>`;
        note.textContent = "";
        if (!p.exits.length) note.textContent = `Для країни «${p.load}» не знаю пунктів виїзду — показую всі пункти.`;

        const t = await loadTrucks(p, opt);
        if (my !== current.seq) return;
        if (t.error) {
            listBox.innerHTML = `<p class="qm-empty">Помилка: ${esc(t.error)}</p>`;
            return;
        }
        let trucks = [...t.passed, ...t.queue].filter((x) => (opt.loaded || /порожн/i.test(x.qtype || "")) && (opt.empty || !/порожн/i.test(x.qtype || "")));
        // Та сама машина могла бути і в «проїхали», і знову в черзі — беремо свіжіший запис
        const seen = new Set();
        trucks = trucks.filter((x) => (seen.has(x.tractor) ? false : seen.add(x.tractor)));

        const codes = [...new Set(trucks.map((x) => keyCode(x.edrpou)).filter(Boolean))];
        if (!codes.length) {
            listBox.innerHTML = `<p class="qm-empty">У черзі зараз немає машин під ці умови. Спробуйте інший кузов або довший період.</p>`;
            note.textContent += t.passedMissing ? " Історію «проїхали кордон» ще не ввімкнено — виконайте echerha_passed.sql." : "";
            return;
        }
        listBox.innerHTML = `<p class="qm-empty">Знайдено ${trucks.length} машин від ${codes.length} перевізників — оцінюю…</p>`;
        const ctx = await loadContext(codes, p);
        if (my !== current.seq) return;
        let list = rank(trucks, ctx, p).filter((x) => !x.hidden);
        if (opt.onlyFit) list = list.filter((x) => x.g.best.off <= 1);
        const total = list.length;
        list = list.slice(0, 60);

        note.textContent =
            `Машин: у черзі ${t.queue.length}, проїхали за ${opt.passedHours} год — ${t.passed.length}. Перевізників: ${total}${total > 60 ? " (показую 60 найкращих)" : ""}. ` +
            `Для машин з вантажем місце розвантаження прогнозується за експортною історією перевізника (номер тягача, пункт пропуску); дата готовності = кордон + дорога до країни розвантаження + 1 дн. + перегін до країни завантаження (~${KM_PER_DAY} км/день).` +
            (t.passedMissing ? " ⚠ Історію «проїхали кордон» ще не ввімкнено — виконайте echerha_passed.sql." : "");
        current.list = list;
        render();
    }

    function render() {
        const listBox = overlay.querySelector("#qmList");
        const list = current.list || [];
        if (!list.length) {
            listBox.innerHTML = `<p class="qm-empty">Нікого не знайшлося під ці умови.</p>`;
            return updatePicked();
        }
        listBox.innerHTML = list
            .map((x, i) => {
                const c = x.c;
                const b = x.g.best.t;
                const can = c && (x.tg || x.phone);
                const name = c?.name || b.carrier || "—";
                const chips = [
                    x.g.best.passed ? `<span class="qm-chip hot">щойно виїхав</span>` : `<span class="qm-chip">у черзі</span>`,
                    x.g.best.loaded ? `<span class="qm-chip">з вантажем${x.g.best.dest ? " → " + esc(nice(x.g.best.dest.country)) : ""}</span>` : `<span class="qm-chip good">порожній</span>`,
                    x.g.best.sameCountry ? `<span class="qm-chip hot">зворотний з тієї ж країни</span>` : "",
                    b.trailer_body ? `<span class="qm-chip">${esc(b.trailer_body)}</span>` : "",
                    x.tg ? `<span class="qm-chip good">Telegram</span>` : x.phone ? `<span class="qm-chip">Viber/WhatsApp</span>` : `<span class="qm-chip bad">немає телефону</span>`,
                    !c ? `<span class="qm-chip bad">немає в «Перевізниках»</span>` : "",
                ].join("");
                return `<div class="qm-row ${x.g.best.off > 1 ? "qm-dim" : ""}">
                    <label class="qm-pick">${can ? `<input type="checkbox" data-pick="${esc(c.id)}" ${picked.has(String(c.id)) ? "checked" : ""} />` : `<input type="checkbox" disabled title="Немає ні Telegram, ні телефону" />`}</label>
                    <div class="qm-main">
                        <div class="qm-name"><span class="qm-rank">${i + 1}</span>${c ? `<a href="#" class="qm-cname fura-clink" data-carrier-card="${esc(c.id)}" title="Відкрити картку: ${esc(name)}">${esc(name)}</a>` : `<span class="qm-cname" title="${esc(name)}">${esc(name)}</span>`} ${chips}</div>
                        <div class="qm-truck">${esc(b.tractor)}${b.trailer ? " / " + esc(b.trailer) : ""}${b.trailer_model ? ` · ${esc(b.trailer_model)}` : ""}${b.boss ? ` · керівник: ${esc(b.boss)}` : ""}</div>
                        <div class="qm-why">${x.why.map(esc).join(" · ")}</div>
                        ${can ? "" : phoneFormHtml(x, i)}
                    </div>
                    <div class="qm-score" title="Бал підбору">${Math.round(x.score)}</div>
                </div>`;
            })
            .join("");
        updatePicked();
    }

    // «📞 Додати телефон» — для перевізника без контактів (або якого ще немає в «Перевізниках»)
    function phoneFormHtml(x, i) {
        return `<div class="qm-phone" data-qm-phone="${i}">
            <button type="button" class="qm-phone-btn" data-qm="phone-open">📞 Додати телефон</button>
            <form class="qm-phone-form" hidden>
                <input type="tel" name="phone" placeholder="+380 67 123 45 67" autocomplete="off" required />
                <input type="text" name="person" placeholder="Ім'я контакту (необов'язково)" autocomplete="off" />
                <button type="submit" class="btn btn-primary">Зберегти</button>
                <button type="button" class="btn btn-secondary" data-qm="phone-cancel">Скасувати</button>
                <span class="qm-phone-msg"></span>
            </form>
        </div>`;
    }

    function normPhone(v) {
        const parts = String(v || "").split(/[,;]/).map((p) => {
            let d = p.replace(/\D/g, "");
            if (d.length === 10 && d.startsWith("0")) d = "38" + d;
            if (d.length === 9) d = "380" + d;
            return d.length >= 9 ? "+" + d : "";
        }).filter(Boolean);
        return parts.join(", ");
    }

    async function savePhone(form) {
        const box = form.closest("[data-qm-phone]");
        const x = (current.list || [])[Number(box.dataset.qmPhone)];
        const msg = form.querySelector(".qm-phone-msg");
        const phone = normPhone(form.phone.value);
        const person = form.person.value.trim();
        if (!x) return;
        if (!phone) {
            msg.textContent = "Перевірте номер";
            return;
        }
        const btn = form.querySelector("button[type=submit]");
        btn.disabled = true;
        msg.textContent = "Зберігаю…";
        try {
            let c = x.c;
            if (c) {
                // Перший вільний слот: phone_1, інакше phone_2
                const field = String(c.phone_1 || "").replace(/\D/g, "").length >= 9 ? "phone_2" : "phone_1";
                const patch = { [field]: phone };
                if (person) patch[field === "phone_1" ? "contact_person_1" : "contact_person_2"] = person;
                const { data, error } = await client.from("carriers").update(patch).eq("id", c.id).select("id, phone_1, phone_2");
                if (error) throw error;
                if (!data || !data.length) throw new Error("немає прав змінювати перевізника");
                Object.assign(c, data[0]);
            } else {
                // Перевізника ще немає в реєстрі — додаємо з даними з Черги
                const b = x.g.best.t;
                const code = x.g.code.length < 8 ? x.g.code.padStart(8, "0") : x.g.code;
                const { data, error } = await client.from("carriers").insert([{
                    name: b.carrier || "—",
                    edrpou: code,
                    contact_person_1: person || b.boss || null,
                    phone_1: phone,
                    trailer_type: b.trailer_body ? String(b.trailer_body).toUpperCase() : null,
                }]).select("id, name, edrpou, phone_1, phone_2, tg_chat_id, rating").single();
                if (error) throw error;
                c = data;
                x.c = c;
            }
            x.phone = true;
            picked.add(String(c.id));
            render();
        } catch (err) {
            msg.textContent = "Не вдалося: " + (err.message || err);
            btn.disabled = false;
        }
    }

    function updatePicked() {
        const btn = overlay.querySelector('[data-qm="bids"]');
        btn.disabled = !picked.size;
        overlay.querySelector("#qmPicked").textContent = picked.size
            ? `Обрано перевізників: ${picked.size}. Агент підготує запити ставки — ви переглянете й надішлете.`
            : "Оберіть перевізників (✓), щоб запросити ставки";
    }

    function onChange(e) {
        if (e.target.dataset?.pick) {
            e.target.checked ? picked.add(String(e.target.dataset.pick)) : picked.delete(String(e.target.dataset.pick));
            return updatePicked();
        }
        if (e.target.closest("#qmBody") || ["qmHours", "qmLoaded", "qmEmpty", "qmUa", "qmFit"].includes(e.target.id)) search();
    }

    function onClick(e) {
        if (e.target === overlay) return close();
        const act = e.target.closest("[data-qm]")?.dataset.qm;
        if (act === "close") close();
        if (act === "phone-open" || act === "phone-cancel") {
            const box = e.target.closest("[data-qm-phone]");
            box.querySelector(".qm-phone-btn").hidden = act === "phone-open";
            box.querySelector(".qm-phone-form").hidden = act !== "phone-open";
            if (act === "phone-open") box.querySelector("input[name=phone]").focus();
        }
        if (act === "refresh") search();
        if (act === "bids" && picked.size) {
            const q = new URLSearchParams({ request: current.r.id, carriers: [...picked].join(",") });
            window.location.href = `agents.html?${q.toString()}`;
        }
    }

    // Кнопка в картці запиту (картка перемальовується — слухаємо на документі)
    document.addEventListener("click", (e) => {
        const b = e.target.closest("[data-qmatch]");
        if (!b) return;
        e.preventDefault();
        open(b.dataset.qmatch);
    });

    // Закрили картку перевізника (могли дописати телефон / Telegram) — оновлюємо рядок
    document.addEventListener("fura-carrier-popup-closed", async (e) => {
        const id = String(e.detail?.id || "");
        if (!id || !overlay?.classList.contains("active") || !current?.list) return;
        const x = current.list.find((y) => y.c && String(y.c.id) === id);
        if (!x) return;
        const { data } = await client.from("carriers").select("id, name, edrpou, phone_1, phone_2, tg_chat_id, rating").eq("id", id).limit(1);
        if (!data || !data[0]) return;
        Object.assign(x.c, data[0]);
        x.tg = !!x.c.tg_chat_id;
        x.phone = [x.c.phone_1, x.c.phone_2].some((p) => String(p || "").replace(/\D/g, "").length >= 9);
        render();
    });

    window.furaQueueMatch = { buttonHtml, open, _test: { paramsOf, rank, parseWhen, normPlate, cpKey } };
})();
