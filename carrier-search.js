/* ================================================================= *
 * FURA — РОЗУМНИЙ ПОШУК ПЕРЕВІЗНИКІВ (без платного ШІ)               *
 * Розуміє фрази на кшталт «тент з Одеси в Польщу», «реф Німеччина»,  *
 * «хто возив Київ – Гданськ», назву, ЄДРПОУ чи телефон.               *
 * Використовують «Помічник» (helper.js) і ставки в запиті (bids.js). *
 * ================================================================= */

(function () {
    if (window.furaCarrierSearch) return;

    // Тип причепа: що пишуть люди → як записано в реєстрі
    const TRAILERS = [
        ["ТЕНТ", /тент|tent/],
        ["РЕФ", /реф|рефрижератор|холодильн|frigo/],
        ["ІЗОТЕРМ", /ізотерм|изотерм/],
        ["ЦІЛЬНОМЕТ", /цільномет|цельномет|фургон/],
        ["КОНТЕЙНЕРОВОЗ", /контейнер/],
        ["МЕГА", /мега|mega/],
        ["СЦЕПКА", /сцепк|зчіпк|зцепк|тандем/],
        ["БУС", /(^|[^а-яіїєґa-z])(бус|bus)([^а-яіїєґa-z]|$)|мікроавтобус|микроавтобус/],
        ["ЦИСТЕРНА", /цистерн/],
        ["ЗЕРНОВОЗ", /зерновоз/],
        ["САМОСКИД", /самоскид|самосвал/],
        ["ПЛАТФОРМА", /платформ|борт/],
        ["ТРАЛ", /трал/],
        ["АВТОВОЗ", /автовоз/],
    ];

    // Країни: як пишуть → як записано (у реєстрі «ПОЛЬША», у запитах трапляється й «ПОЛЬЩА»)
    const COUNTRIES = [
        ["УКРАЇНА", /україн|украин|ukrain/, ["УКРАЇНА", "УКРАИНА"]],
        ["ПОЛЬША", /польщ|польш|польск|poland|polsk/, ["ПОЛЬША", "ПОЛЬЩА"]],
        ["НІМЕЧЧИНА", /німеч|немеч|герман|germany|deutsch/, ["НІМЕЧЧИНА"]],
        ["ЛИТВА", /литв|lithuan/, ["ЛИТВА"]],
        ["ЛАТВІЯ", /латві|латви|latvi/, ["ЛАТВІЯ"]],
        ["ЕСТОНІЯ", /естон|эстон|estoni/, ["ЕСТОНІЯ"]],
        ["ІСПАНІЯ", /іспан|испан|spain/, ["ІСПАНІЯ"]],
        ["ІТАЛІЯ", /італ|итал|ital/, ["ІТАЛІЯ"]],
        ["РУМУНІЯ", /румун|romani/, ["РУМУНІЯ"]],
        ["ЧЕХІЯ", /чехі|чехи|чеськ|czech/, ["ЧЕХІЯ"]],
        ["АВСТРІЯ", /австрі|австри|austri/, ["АВСТРІЯ"]],
        ["АЗЕРБАЙДЖАН", /азербайдж/, ["АЗЕРБАЙДЖАН"]],
        ["ВІРМЕНІЯ", /вірмен|армен/, ["ВІРМЕНІЯ"]],
        ["БЕЛЬГІЯ", /бельгі|бельги|belgi/, ["БЕЛЬГІЯ"]],
        ["БОЛГАРІЯ", /болгар|bulgar/, ["БОЛГАРІЯ"]],
        ["ВЕЛИКОБРИТАНІЯ", /британ|англі|англи|england/, ["ВЕЛИКОБРИТАНІЯ"]],
        ["УГОРЩИНА", /угорщ|угорськ|венгр|hungar/, ["УГОРЩИНА"]],
        ["ФРАНЦІЯ", /франці|франци|franc/, ["ФРАНЦІЯ"]],
        ["ДАНІЯ", /даніі|данія|дания|denmark/, ["ДАНІЯ"]],
        ["МОЛДОВА", /молдов|молдав|moldov/, ["МОЛДОВА"]],
        ["НІДЕРЛАНДИ", /нідерланд|нидерланд|голланд|netherland/, ["НІДЕРЛАНДИ"]],
        ["СЛОВАЧЧИНА", /словач|slovak/, ["СЛОВАЧЧИНА"]],
        ["СЛОВЕНІЯ", /словені|словени|sloven/, ["СЛОВЕНІЯ"]],
        ["ТУРЕЧЧИНА", /туреч|турці|турци|turk/, ["ТУРЕЧЧИНА"]],
        ["ГРУЗІЯ", /грузі|грузи|georgia/, ["ГРУЗІЯ"]],
        ["ФІНЛЯНДІЯ", /фінлянд|финлянд|finland/, ["ФІНЛЯНДІЯ"]],
    ];

    // Міста й області України → як записано в реєстрі (ukraine_directions / region_ukr / city)
    const PLACES = [
        ["ОДЕСЬКА ОБЛ.", "Одес", /одес|ізмаїл|измаил|рені|рени|чорноморськ|черноморск|білгород|южне|южный|ізмаіл/],
        ["КИЇВСЬКА ОБЛ.", "Київ", /київ|киев|kyiv|kiev|бровар|бориспіл|борисп|вишгород|біла церква|бела церковь|ірпін|ирпен/],
        ["ЛЬВІВСЬКА ОБЛ.", "Львів", /льв[іо]в|lviv|дрогоб|стрий|червоноград/],
        ["ХАРКІВСЬКА ОБЛ.", "Харків", /харк[іо]в|kharkiv/],
        ["ДНІПРОПЕТРОВСЬКА ОБЛ.", "Дніпр", /дніпр|днепр|кривий ріг|кривой рог|кам'янськ|павлоград|нікополь|никополь/],
        ["ЗАПОРІЗЬКА ОБЛ.", "Запор", /запоріж|запорож/],
        ["ВІННИЦЬКА ОБЛ.", "Вінниц", /вінниц|винниц/],
        ["ЖИТОМИРСЬКА ОБЛ.", "Житомир", /житомир/],
        ["ВОЛИНСЬКА ОБЛ.", "Луцьк", /луцьк|луцк|волин|волын|ковель/],
        ["РІВНЕНСЬКА ОБЛ.", "Рівне", /рівн|ровн/],
        ["ТЕРНОПІЛЬСЬКА ОБЛ.", "Терноп", /терноп/],
        ["ХМЕЛЬНИЦЬКА ОБЛ.", "Хмельниц", /хмельниц|кам'янець|каменец/],
        ["ЧЕРНІВЕЦЬКА ОБЛ.", "Чернівц", /чернівц|черновц/],
        ["ЗАКАРПАТСЬКА ОБЛ.", "Ужгород", /ужгород|мукачев|закарпат|чоп/],
        ["ІВАНО-ФРАНКІВСЬКА ОБЛ.", "Франків", /франків|франковск|калуш|коломи/],
        ["ПОЛТАВСЬКА ОБЛ.", "Полтав", /полтав|кременчу/],
        ["СУМСЬКА ОБЛ.", "Сум", /(^|\s)сум(и|ы|ах|ам|і)?(\s|$|,)|сумськ|сумск/],
        ["ЧЕРНІГІВСЬКА ОБЛ.", "Черніг", /черніг|чернигов/],
        ["ЧЕРКАСЬКА ОБЛ.", "Черкас", /черкас|умань/],
        ["КІРОВОГРАДСЬКА ОБЛ.", "Кропивниц", /кропивниц|кіровоград|кировоград/],
        ["МИКОЛАЇВСЬКА ОБЛ.", "Миколаїв", /миколаїв|николаев/],
        ["ХЕРСОНСЬКА ОБЛ.", "Херсон", /херсон/],
        ["ДОНЕЦЬКА ОБЛ.", "Донецьк", /донецьк|донецк|краматорськ|слов'янськ/],
        ["ЛУГАНСЬКА ОБЛ.", "Луганськ", /луганськ|луганск/],
    ];

    const lower = (s) => String(s || "").toLowerCase().replace(/[’ʼ`]/g, "'");

    // Розбираємо фразу логіста на фільтри
    function parse(text) {
        const raw = String(text || "").trim();
        const t = " " + lower(raw) + " ";
        const q = { raw, trailers: [], countries: [], places: [], tonnage: null, from: null, to: null, text: "" };

        for (const [name, rx] of TRAILERS) if (rx.test(t)) q.trailers.push(name);

        // Країни й міста — у порядку, як написано (щоб зрозуміти «звідки» і «куди»)
        const found = [];
        for (const [name, rx, spellings] of COUNTRIES) {
            const m = t.match(rx);
            if (m) found.push({ kind: "country", name, spellings, at: m.index });
        }
        for (const [oblast, cityStem, rx] of PLACES) {
            const m = t.match(rx);
            if (m) found.push({ kind: "place", name: oblast, city: cityStem, at: m.index });
        }
        found.sort((a, b) => a.at - b.at);
        q.countries = found.filter((f) => f.kind === "country" && f.name !== "УКРАЇНА");
        q.places = found.filter((f) => f.kind === "place");
        if (found.length >= 2) {
            q.from = found[0];
            q.to = found[found.length - 1];
        } else if (found.length === 1) {
            // «у Польщу», «до Німеччини» — це куди; «з Одеси» — звідки; без прийменника — просто напрямок
            const before = t.slice(Math.max(0, found[0].at - 6), found[0].at);
            if (/(^|\s)(в|у|до|на|to)\s*$/.test(before)) q.to = found[0];
            else if (/(^|\s)(з|із|зі|с|из|від|от|from)\s*$/.test(before)) q.from = found[0];
        }

        const ton = t.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:тон|tn|т(?![а-яіїєґ])|t(?![a-z]))/);
        if (ton) q.tonnage = Number(ton[1].replace(",", "."));

        // Нічого не впізнали — шукаємо як назву / ЄДРПОУ / телефон
        if (!q.trailers.length && !found.length) {
            q.text = raw.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
        }
        return q;
    }

    // Людською мовою: що ми зрозуміли
    const NICE = { ПОЛЬША: "Польща", НІМЕЧЧИНА: "Німеччина", ВЕЛИКОБРИТАНІЯ: "Велика Британія", НІДЕРЛАНДИ: "Нідерланди" };
    function label(f) {
        if (f.kind === "place") return f.name.charAt(0) + f.name.slice(1).toLowerCase().replace("обл.", "обл.");
        return NICE[f.name] || f.name.charAt(0) + f.name.slice(1).toLowerCase();
    }

    function describe(q) {
        const parts = [];
        if (q.trailers.length) parts.push(q.trailers.join(" / ").toLowerCase());
        if (q.from) parts.push(`з: ${label(q.from)}`);
        if (q.to && q.to !== q.from) parts.push(`у: ${label(q.to)}`);
        for (const f of [...q.places, ...q.countries]) {
            if (f !== q.from && f !== q.to) parts.push(label(f));
        }
        if (q.tonnage) parts.push(`${q.tonnage} т`);
        if (q.text) parts.push(`«${q.text}»`);
        return parts.join(" · ");
    }

    const clean = (s) => String(s || "").replace(/[,()%*\\]/g, " ").trim();

    // Пошук у реєстрі перевізників
    async function searchRegistry(client, q, opts = {}) {
        const limit = opts.limit || 30;
        let rq = client
            .from("carriers")
            .select("id, name, edrpou, city, region_ukr, destinations, ukraine_directions, trailer_type, tonnage, contact_person_1, phone_1, phone_2, rating")
            .limit(limit);

        if (q.text) {
            const v = clean(q.text);
            const digits = v.replace(/\D/g, "");
            const conds = [`name.ilike.%${v}%`, `edrpou.ilike.%${v}%`, `contact_person_1.ilike.%${v}%`, `city.ilike.%${v}%`];
            if (digits.length >= 5) conds.push(`phone_1.ilike.%${digits.slice(-7)}%`, `phone_2.ilike.%${digits.slice(-7)}%`);
            rq = rq.or(conds.join(","));
        }
        for (const tr of q.trailers.slice(0, 1)) rq = rq.ilike("trailer_type", `%${tr}%`);

        // Закордонна країна → напрямки перевізника
        const foreign = q.countries.length ? q.countries[q.countries.length - 1] : null;
        if (foreign) rq = rq.or(foreign.spellings.map((s) => `destinations.ilike.%${s}%`).join(","));

        // Українське місто/область → де базується або куди їздить по Україні
        if (q.places.length && !opts.skipPlace) {
            const p = q.places[0];
            const stem = p.name.split(" ")[0];
            rq = rq.or([`city.ilike.%${p.city}%`, `region_ukr.ilike.%${stem.slice(0, 5)}%`, `ukraine_directions.ilike.%${stem}%`].join(","));
        }

        const { data, error } = await rq.order("rating", { ascending: false, nullsFirst: false });
        if (error) throw error;
        return data || [];
    }

    // Хто вже возив для нас за схожим маршрутом (з угод)
    async function searchHistory(client, q) {
        if (!q.countries.length && !q.places.length) return [];
        let rq = client
            .from("deals")
            .select("carrier_id, carrier_name, carrier_phone, load_country, load_address, unload_country, unload_address, load_date")
            .not("carrier_name", "is", null)
            .order("load_date", { ascending: false, nullsFirst: false })
            .limit(500);
        const fromC = q.from?.kind === "country" ? q.from : null;
        const toC = q.to?.kind === "country" ? q.to : null;
        if (fromC && fromC !== toC) rq = rq.or(fromC.spellings.map((s) => `load_country.ilike.%${s}%`).join(","));
        if (toC) rq = rq.or(toC.spellings.map((s) => `unload_country.ilike.%${s}%`).join(","));
        if (!fromC && !toC && q.countries.length) {
            const c = q.countries[0];
            rq = rq.or(c.spellings.flatMap((s) => [`load_country.ilike.%${s}%`, `unload_country.ilike.%${s}%`]).join(","));
        }
        if (q.places.length) {
            const p = q.places[0];
            rq = rq.or([`load_address.ilike.%${p.city}%`, `unload_address.ilike.%${p.city}%`].join(","));
        }
        const { data, error } = await rq;
        if (error) return [];
        const by = new Map();
        for (const d of data || []) {
            const key = String(d.carrier_id || d.carrier_name).toLowerCase();
            const cur = by.get(key) || { carrier_id: d.carrier_id, name: d.carrier_name, phone: d.carrier_phone, trips: 0, last: null };
            cur.trips += 1;
            if (d.load_date && (!cur.last || d.load_date > cur.last)) cur.last = d.load_date;
            if (!cur.phone && d.carrier_phone) cur.phone = d.carrier_phone;
            by.set(key, cur);
        }
        return [...by.values()].sort((a, b) => b.trips - a.trips || String(b.last).localeCompare(String(a.last))).slice(0, 10);
    }

    /* ---------------- Телефон і месенджери ---------------- */

    const UA_MOBILE = /^380(39|50|63|66|67|68|73|89|9[1-9])\d{7}$/;

    // Мобільний номер (Viber працює тільки з мобільними) у вигляді 380…
    function phoneDigits(...raws) {
        const all = [];
        for (const raw of raws) {
            for (const m of String(raw || "").match(/\+?\d[\d\s\-().]{7,}\d/g) || []) {
                let d = m.replace(/\D/g, "");
                if (d.length === 10 && d.startsWith("0")) d = "38" + d;
                else if (d.length === 9) d = "380" + d;
                if (d.length >= 10 && d.length <= 15) all.push(d);
            }
        }
        return all.find((d) => UA_MOBILE.test(d)) || all.find((d) => !d.startsWith("380")) || all[0] || "";
    }

    function chatLink(kind, digits, text) {
        const t = encodeURIComponent(text || "");
        if (kind === "viber") return `viber://chat?number=%2B${digits}${text ? `&draft=${t}` : ""}`;
        return `https://wa.me/${digits}${text ? `?text=${t}` : ""}`;
    }

    // Копіюємо одразу в момент натискання (інакше браузер може заборонити)
    function copyNow(text) {
        let ok = false;
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            ok = document.execCommand("copy");
            ta.remove();
        } catch (_) {}
        try {
            navigator.clipboard?.writeText(text).catch(() => {});
            ok = true;
        } catch (_) {}
        return ok;
    }

    function openChat(kind, digits, text) {
        if (text) copyNow(text);
        const url = chatLink(kind, digits, text);
        if (kind === "viber") window.location.href = url;
        else window.open(url, "_blank", "noopener");
    }

    function fmtDate(v) {
        if (!v) return "";
        const [y, m, d] = String(v).slice(0, 10).split("-");
        return y && m && d ? `${d}.${m}.${y}` : "";
    }

    // Текст запиту на ставку для перевізника — без клієнта й без ціни
    function requestText(r) {
        const lines = [];
        const a = [r.load_country, r.load_address].filter(Boolean).join(", ");
        const b = [r.unload_country, r.unload_address].filter(Boolean).join(", ");
        if (a) lines.push(`Завантаження: ${a}`);
        if (b) lines.push(`Вивантаження: ${b}`);
        const from = fmtDate(r.desired_date);
        const to = fmtDate(r.desired_date_to);
        if (from) lines.push(`Дата завантаження: ${to && to !== from ? `${from} – ${to}` : from}`);
        const cargo = [r.cargo, r.transport_type, r.weight && `${r.weight}`].filter(Boolean).join(" · ");
        if (cargo) lines.push(`Вантаж: ${cargo}`);
        const customs = [
            r.customs_export && `замитнення ${r.customs_export}`,
            r.border_crossing && `кордон ${r.border_crossing}`,
            r.customs_import && `розмитнення ${r.customs_import}`,
        ].filter(Boolean);
        if (customs.length) lines.push(`Митниця: ${customs.join(" · ")}`);
        return `Доброго дня! Є перевезення:\n${lines.join("\n")}\n\nПідкажіть, будь ласка, вашу ставку і коли зможете подати авто?\n\nГрандар, відділ логістики`;
    }

    window.furaCarrierSearch = { parse, describe, searchRegistry, searchHistory, phoneDigits, chatLink, copyNow, openChat, requestText, fmtDate };
})();
