/* ================================================================= *
 * FURA — «Оновити з Lardi» у картці перевізника                      *
 * Офіційний Lardi API (ключ компанії, функція fura-lardi):           *
 * посилання, фото, реєстраційні дані, контакти, транспорт.           *
 * Спершу показуємо, що зміниться, — записуємо після «Зберегти».       *
 * ================================================================= */
(function () {
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const curId = () => { try { return currentCardCarrierId; } catch (e) { return null; } }; // eslint-disable-line no-undef

    async function call(body) {
        const { data, error } = await sbClient.functions.invoke("fura-lardi", { body }); // eslint-disable-line no-undef
        if (error) {
            let m = "";
            try { m = (await error.context?.json())?.error || ""; } catch (e) { /* */ }
            throw new Error(m || "Lardi не відповів. Спробуйте ще раз.");
        }
        return data;
    }

    let box = null;
    function modal(html, title = "Оновити з Lardi") {
        if (!box) {
            box = document.createElement("div");
            box.className = "le-ov";
            document.body.appendChild(box);
            box.addEventListener("click", (e) => { if (e.target === box || e.target.closest("[data-le=close]")) box.hidden = true; });
        }
        box.innerHTML = `<div class="le-card" role="dialog"><div class="le-head"><b>${esc(title)}</b><button type="button" class="le-x" data-le="close">&times;</button></div>${html}</div>`;
        box.hidden = false;
    }

    async function run(id) {
        modal(`<div class="le-load">Шукаю перевізника в Lardi…</div>`);
        let r;
        try { r = await call({ action: "carrier_enrich", carrier_id: id }); } catch (e) { return modal(`<div class="le-err">${esc(e.message)}</div>`); }
        if (!r.found) return modal(`<div class="le-err">${esc(r.message || "Не знайдено")}</div>`);
        const list = r.changes || [];
        const rows = list.map((c, i) => `<label class="le-row"><input type="checkbox" data-f="${esc(c.field)}" checked>
            <span class="le-lbl">${esc(c.label)}</span>
            <span class="le-val">${c.old && !c.added ? `<s>${esc(c.old)}</s> → ` : ""}${c.added ? `+ ${esc(c.added.join(", "))}` : esc(c.new)}</span></label>`).join("");
        modal(`<div class="le-sub">Профіль: <a href="${esc(r.profile)}" target="_blank" rel="noopener">lardi-trans.com/log/user/${esc(r.ref)} ↗</a> · заявок «авто» за 60 днів: ${r.trucks}</div>
            ${list.length ? `<div class="le-list">${rows}</div>
                <div class="le-note">Заповнене вручну не перезаписується — лише порожні поля й нові пункти у списках.</div>
                <div class="le-acts"><button type="button" class="le-go" data-le="save">Зберегти обране</button><button type="button" class="le-link" data-le="close">Скасувати</button></div>`
            : `<div class="le-ok">Нового в Lardi немає — картка вже актуальна.</div>`}
            <details class="le-dbg"${list.some((c) => /region_ukr|city|logo_url/.test(c.field)) ? "" : " open"}><summary>Технічні дані (для налаштування)</summary><pre>${esc(JSON.stringify(r.debug, null, 1))}</pre></details>`);
        box.querySelector("[data-le=save]")?.addEventListener("click", async (e) => {
            const fields = [...box.querySelectorAll("[data-f]:checked")].map((x) => x.dataset.f);
            if (!fields.length) return (box.hidden = true);
            e.target.disabled = true; e.target.textContent = "Зберігаю…";
            try {
                const res = await call({ action: "carrier_enrich", carrier_id: id, apply: true, fields });
                box.hidden = true;
                await refresh(id);
            } catch (err) { e.target.disabled = false; e.target.textContent = "Зберегти обране"; alert(err.message); }
        });
    }

    async function refresh(id) {
        const { data } = await sbClient.from("carriers").select("*").eq("id", id).maybeSingle(); // eslint-disable-line no-undef
        if (data && typeof allCarriersCache !== "undefined") { // eslint-disable-line no-undef
            const i = allCarriersCache.findIndex((c) => String(c.id) === String(id)); // eslint-disable-line no-undef
            if (i >= 0) allCarriersCache[i] = { ...allCarriersCache[i], ...data }; // eslint-disable-line no-undef
        }
        window.furaMarkEdited?.(id);
        // одразу оновлюємо і рядок у списку перевізників (і кеш браузера), не лише картку
        try {
            if (typeof prepCarrierSearch === "function") { const i = allCarriersCache.findIndex((c) => String(c.id) === String(id)); if (i >= 0) prepCarrierSearch(allCarriersCache[i]); } // eslint-disable-line no-undef
            if (typeof renderCarriers === "function" && !(typeof CARRIER_POPUP !== "undefined" && CARRIER_POPUP)) { // eslint-disable-line no-undef
                const bx = document.querySelector(".table-card");
                const keep = bx ? bx.scrollTop : 0;
                renderCarriers(); // eslint-disable-line no-undef
                if (bx) bx.scrollTop = keep;
            }
        } catch (e) { /* список оновиться при наступному відкритті */ }
        if (typeof openCarrierCard === "function") openCarrierCard(id); // eslint-disable-line no-undef
    }

    function mount() {
        const acts = document.querySelector("#carrierCardOverlay .carrier-card-actions");
        if (!acts || document.getElementById("leBtn")) return;
        const b = document.createElement("button");
        b.type = "button";
        b.id = "leBtn";
        b.className = "btn-card-edit le-btn";
        b.title = "Підтягнути з Lardi: посилання, фото, реєстраційні дані, контакти, транспорт";
        b.innerHTML = "<i class='bx bx-refresh'></i> З Lardi";
        b.addEventListener("click", () => { const id = curId(); if (id) run(id); });
        acts.prepend(b);
        const pb = document.createElement("button");
        pb.type = "button";
        pb.id = "lePasteBtn";
        pb.className = "btn-card-edit le-btn";
        pb.title = "Скопіюйте сторінку профілю в Lardi (Cmd+A, Cmd+C) і вставте сюди — FURA сама розбере контакти, реєстраційні дані, автопарк";
        pb.innerHTML = "<i class='bx bx-paste'></i> Вставити з Lardi";
        pb.addEventListener("click", () => { const id = curId(); if (id) pasteOpen(id); });
        b.after(pb);
    }

    /* ---------- «Вставити з Lardi»: розбір скопійованого тексту профілю ---------- */
    const PHONE = /(\+?\d[\d\s()-]{8,}\d)/;
    const digits = (v) => String(v || "").replace(/\D/g, "");
    const normPhone = (v) => { const d = digits(v); return d.length === 12 ? "+" + d : d.length === 10 ? "+38" + d : String(v).trim(); };
    const VEH = /^(Вантажівка|Тягач|Напівпричіп|Причіп|Автопоїзд|Зчіпка|Бус|Мікроавтобус|Легковий|Truck|Tractor)/i;
    const UA_MONTHS = { січня: 1, лютого: 2, березня: 3, квітня: 4, травня: 5, червня: 6, липня: 7, серпня: 8, вересня: 9, жовтня: 10, листопада: 11, грудня: 12 };

    function parseLardi(text) {
        const RAW = String(text || "").replace(/\r/g, "");
        // посилання не розбираємо як текст (у них номер профілю, а не телефон)
        const T = RAW.replace(/https?:\/\/\S+/g, (u) => (/profilelogo|avatar|logo|image/i.test(u) ? u : " "));
        const lines = T.split("\n").map((l) => l.replace(/\t+/g, " \t ").trim()).filter(Boolean);
        // «Мітка: значення» в одному рядку (через табуляцію) або в наступному рядку
        const val = (rx) => {
            for (let i = 0; i < lines.length; i++) {
                const l = lines[i];
                const m = l.match(rx);
                if (!m) continue;
                const rest = l.slice(m.index + m[0].length).replace(/^[\s:\t]+/, "").trim();
                if (rest) return rest;
                if (lines[i + 1] && !/:$/.test(lines[i + 1])) return lines[i + 1].trim();
            }
            return "";
        };
        const out = {};
        out.edrpou = digits(val(/^ЄДРПОУ:?/i)).slice(0, 10);
        out.director = val(/^(ПІБ керівника|Керівник|Директор):?/i);
        out.region = val(/^Область:?/i);
        out.city = val(/^Місто:?/i);
        out.address = val(/^Адреса:?/i);
        out.regType = val(/^Тип реєстрації:?/i);
        out.regDate = val(/^Дата реєстрації на Ларді-Транс:?/i);
        out.activity = val(/^Профіль діяльності:?/i);
        // фото: якщо вставили адресу картинки
        const img = T.match(/https?:\/\/[^\s"']*lardi[^\s"']*(profilelogo|avatar|logo)[^\s"']*/i);
        out.photo = img ? img[0] : "";
        const ref = RAW.match(/lardi-trans\.com\/(?:log\/)?user\/(\d{6,})/i);
        out.ref = ref ? ref[1] : "";
        // «Місто, область, Україна» на вкладці «Контакти» + вулиця під ним
        const addrLine = lines.findIndex((l) => /обл\.?,\s*(Україна|Украина)$/i.test(l));
        if (addrLine >= 0) {
            const parts = lines[addrLine].split(",").map((x) => x.trim());
            if (!out.city) out.city = parts[0];
            if (!out.region) out.region = parts.find((x) => /обл/i.test(x)) || "";
            const next = lines[addrLine + 1] || "";
            if (!out.address && next && !PHONE.test(next) && /\d/.test(next) && next.length < 60) out.address = next;
        }
        // контакти: ім'я, а під ним (або в тому ж рядку) телефони
        const contacts = [];
        const seen = new Set();
        let name = "";
        const isName = (l) => !PHONE.test(l) && !/[:@]|http|обл|Україна|Украина|вул\.|просп|Усього|Leaflet|OpenStreet|Контакти|Загальна|автопарк|Документи|Відгуки|Претензії|Новини|Паспорт|нотатка|замовлення|Повідомлення|Інформація|Copyright|^(ФОП|ТОВ|ПП|ЧП|ПрАТ|ТзОВ)(?=[\s"«]|$)/i.test(l) && /^[A-Za-zА-Яа-яІіЇїЄєҐґ'’ .,-]{2,40}$/.test(l);
        for (const l of lines) {
            const ph = l.match(new RegExp(PHONE.source, "g"));
            if (ph) {
                const before = l.slice(0, l.indexOf(ph[0])).trim();
                if (before && isName(before)) name = before;
                for (const p of ph) {
                    const d = digits(p);
                    // лише схожі на телефон: +…, 380…, 0XX… (а не номер профілю чи ЄДРПОУ)
                    if (d.length < 10 || d.length > 13 || !(/^\s*\+/.test(p) || /^380/.test(d) || (/^0\d{9}$/.test(d)))) continue;
                    const k = d.slice(-9);
                    if (seen.has(k)) continue;
                    seen.add(k);
                    contacts.push({ name, phone: normPhone(p) });
                }
            } else if (isName(l)) name = l.replace(/,$/, "");
        }
        out.contacts = contacts;
        // «Мій автопарк»: «Вантажівка VOLVO», «Тент», «Власний»…
        const fleet = [];
        const ap = lines.findIndex((l) => /^Усього авто/i.test(l));
        if (ap >= 0) {
            let cur = null;
            for (const l of lines.slice(ap + 1)) {
                if (/^(Copyright|Інфо)/i.test(l)) break;
                if (VEH.test(l)) { if (cur) fleet.push(cur.join(" · ")); cur = [l]; }
                else if (cur && l.length < 80 && !PHONE.test(l)) cur.push(l);
            }
            if (cur) fleet.push(cur.join(" · "));
        }
        // «напівпричіпAC2803BX» — номер авто злипся з назвою
        out.fleet = fleet.map((f) => f.replace(/^(Вантажівка|Тягач|Напівпричіп|Причіп|Бус)(?=[а-яіїєґ])/i, "$1 ").replace(/([а-яіїєґa-z])([A-ZА-ЯІЇЄ]{2}\d{4}[A-ZА-ЯІЇЄ]{2})/g, "$1 · $2"));
        // «Відгуки»: «09.09.2026  UA - RO  Хмельницький - Сучава» — маршрути, якими реально возив
        const routes = new Map();
        // Lardi копіює це злитно: «10.07.2024UA - GEКиїв - Тбілісі» — тому прив'язуємось до дати
        const RX = /\d{2}\.\d{2}\.\d{4}\s*([A-Z]{2}(?:\s*,\s*[A-Z]{2})*)\s*-\s*([A-Z]{2}(?:\s*,\s*[A-Z]{2})*)\s*([^\n\t]+?)\s+-\s+([^\n\t]+)/g;
        let m;
        while ((m = RX.exec(T))) {
            const fromCc = m[1].split(",")[0].trim(), toCc = m[2].split(",").pop().trim();
            const from = m[3].trim(), to = m[4].trim().replace(/\s{2,}.*$/, "");
            if (from.length > 40 || to.length > 40 || /\d{2}\.\d{2}/.test(from + to)) continue;
            const k = `${from}|${to}|${fromCc}|${toCc}`;
            routes.set(k, (routes.get(k) || 0) + 1);
        }
        out.routes = [...routes].map(([k, n]) => { const [from, to, fc, tc] = k.split("|"); return { from, to, fc, tc, n }; }).sort((a, b) => b.n - a.n);
        return out;
    }

    const COUNTRY_UA = { PL: "ПОЛЬША", DE: "НІМЕЧЧИНА", LT: "ЛИТВА", LV: "ЛАТВІЯ", EE: "ЕСТОНІЯ", CZ: "ЧЕХІЯ", SK: "СЛОВАЧЧИНА", HU: "УГОРЩИНА", RO: "РУМУНІЯ", MD: "МОЛДОВА", BG: "БОЛГАРІЯ", TR: "ТУРЕЧЧИНА", AT: "АВСТРІЯ", IT: "ІТАЛІЯ", FR: "ФРАНЦІЯ", NL: "НІДЕРЛАНДИ", BE: "БЕЛЬГІЯ", ES: "ІСПАНІЯ", PT: "ПОРТУГАЛІЯ", DK: "ДАНІЯ", SE: "ШВЕЦІЯ", FI: "ФІНЛЯНДІЯ", NO: "НОРВЕГІЯ", CH: "ШВЕЙЦАРІЯ", GB: "ВЕЛИКОБРИТАНІЯ", GR: "ГРЕЦІЯ", SI: "СЛОВЕНІЯ", HR: "ХОРВАТІЯ", RS: "СЕРБІЯ", GE: "ГРУЗІЯ", AM: "ВІРМЕНІЯ", AZ: "АЗЕРБАЙДЖАН", KZ: "КАЗАХСТАН", UZ: "УЗБЕКИСТАН", LU: "ЛЮКСЕМБУРГ", IE: "ІРЛАНДІЯ", MK: "МАКЕДОНІЯ", AL: "АЛБАНІЯ", BA: "БОСНІЯ", BY: "БІЛОРУСЬ" };
    const OBL = {
        "ВІННИЦЬКА": "вінниця", "ВОЛИНСЬКА": "луцьк ковель володимир нововолинськ", "ДНІПРОПЕТРОВСЬКА": "дніпро кривий ріг кам'янське нікополь павлоград", "ДОНЕЦЬКА": "донецьк краматорськ слов'янськ маріуполь",
        "ЖИТОМИРСЬКА": "житомир бердичів коростень", "ЗАКАРПАТСЬКА": "ужгород мукачево чоп берегове", "ЗАПОРІЗЬКА": "запоріжжя мелітополь", "ІВАНО-ФРАНКІВСЬКА": "івано-франківськ калуш коломия",
        "КИЇВСЬКА": "київ біла церква бровари бориспіль ірпінь фастів", "КІРОВОГРАДСЬКА": "кропивницький олександрія", "ЛУГАНСЬКА": "луганськ сєвєродонецьк", "ЛЬВІВСЬКА": "львів дрогобич стрий червоноград шептицький самбір",
        "МИКОЛАЇВСЬКА": "миколаїв первомайськ", "ОДЕСЬКА": "одеса ізмаїл чорноморськ південне", "ПОЛТАВСЬКА": "полтава кременчук горішні плавні", "РІВНЕНСЬКА": "рівне дубно", "СУМСЬКА": "суми конотоп шостка",
        "ТЕРНОПІЛЬСЬКА": "тернопіль", "ХАРКІВСЬКА": "харків", "ХЕРСОНСЬКА": "херсон", "ХМЕЛЬНИЦЬКА": "хмельницький кам'янець-подільський", "ЧЕРКАСЬКА": "черкаси умань", "ЧЕРНІВЕЦЬКА": "чернівці", "ЧЕРНІГІВСЬКА": "чернігів ніжин",
    };
    const UA_OBL = {};
    // багатослівні назви («біла церква», «горішні плавні») — окремо
    Object.entries(OBL).forEach(([ob, cities]) => cities.replace(/(біла церква|кривий ріг|горішні плавні|кам'янець-подільський)/g, (x) => x.replace(/ /g, "_")).split(" ").forEach((cName) => (UA_OBL[cName.replace(/_/g, " ")] = ob + " ОБЛ.")));

    function carrierById(id) {
        try { return allCarriersCache.find((c) => String(c.id) === String(id)) || null; } catch (e) { return null; } // eslint-disable-line no-undef
    }

    function pasteChanges(c, d) {
        const ch = [];
        const empty = (k) => !String(c[k] ?? "").trim();
        if (d.ref && !/\/log\/user\//.test(c.profile_url || "")) ch.push({ field: "profile_url", label: "Lardi / профіль", old: c.profile_url || "", new: `https://lardi-trans.com/log/user/${d.ref}/` });
        if (d.photo && empty("logo_url")) ch.push({ field: "logo_url", label: "Фото", old: "", new: d.photo });
        if (d.edrpou && d.edrpou.length >= 8 && empty("edrpou")) ch.push({ field: "edrpou", label: "ЄДРПОУ", old: "", new: d.edrpou });
        if (d.director && "director" in c && empty("director")) ch.push({ field: "director", label: "Директор", old: "", new: d.director });
        if (d.region && empty("region_ukr")) ch.push({ field: "region_ukr", label: "Область", old: "", new: d.region.toUpperCase().replace(/\s*ОБЛАСТЬ$/, " ОБЛ.") });
        const cityFull = [d.city, d.address].filter(Boolean).join(", ");
        if (cityFull) {
            const cur = String(c.city || "").trim();
            if (!cur) ch.push({ field: "city", label: "Місто / Адреса", old: "", new: cityFull });
            else if (d.address && (!d.city || cur.toLowerCase().startsWith(d.city.toLowerCase())) && !cur.toLowerCase().includes(d.address.toLowerCase().slice(0, 8))) ch.push({ field: "city", label: "Місто / Адреса", old: cur, new: `${cur}, ${d.address}` });
        }
        // телефони
        const have = new Set([c.phone_1, c.phone_2, ...(Array.isArray(c.extra_contacts) ? c.extra_contacts.map((x) => x?.phone) : [])]
            .flatMap((v) => String(v || "").split(/[,;]/)).map((v) => digits(v).slice(-9)).filter((v) => v.length === 9));
        const fresh = d.contacts.filter((x) => !have.has(digits(x.phone).slice(-9)));
        if (fresh.length) ch.push({ field: "contacts", label: "Нові телефони", old: "", new: fresh.map((x) => `${x.name ? x.name + ": " : ""}${x.phone}`).join("\n"), phones: fresh });
        // «Телефон 2» = той самий номер, що й «Телефон 1» — пропонуємо прибрати повтор
        const dup2 = digits(c.phone_1).slice(-9) && digits(c.phone_1).slice(-9) === digits(c.phone_2).slice(-9);
        if (dup2) ch.push({ field: "dup_phone_2", label: "Повтор телефону", old: `${c.contact_person_2 || ""} ${c.phone_2 || ""}`.trim(), new: "прибрати (той самий номер, що й Телефон 1)" });
        for (const n of dup2 ? [1] : [1, 2]) {
            const ph = digits(c[`phone_${n}`]).slice(-9);
            const nm = String(c[`contact_person_${n}`] || "").trim();
            if (!ph || (nm && !/^(власник|офіс)/i.test(nm))) continue;
            const x = d.contacts.find((p) => p.name && digits(p.phone).slice(-9) === ph);
            if (x && x.name !== nm) ch.push({ field: `contact_person_${n}`, label: `Підпис телефону ${n}`, old: nm, new: x.name });
        }
        // кузови з автопарку → «Тип причепу» (лише нові)
        if (d.fleet.length) {
            const BODY = [[/тент/i, "ТЕНТ"], [/реф|рефрижератор/i, "РЕФ"], [/ізотерм/i, "ІЗОТЕРМ"], [/цільномет/i, "ЦІЛЬНОМЕТ"], [/платформ/i, "ПЛАТФОРМА"],
                [/контейнеровоз/i, "КОНТЕЙНЕРОВОЗ"], [/автовоз/i, "АВТОВОЗ"], [/зерновоз/i, "ЗЕРНОВОЗ"], [/самоскид/i, "САМОСКИД"], [/бортов/i, "БОРТОВИЙ"], [/цистерн/i, "ЦИСТЕРНА"], [/мега|mega/i, "МЕГА"]];
            const cur = String(c.trailer_type || "").split(/[;,]/).map((x) => x.trim().toUpperCase()).filter(Boolean);
            const add = [];
            d.fleet.forEach((f) => BODY.forEach(([rx, name]) => { if (rx.test(f) && !cur.includes(name) && !add.includes(name)) add.push(name); }));
            if (add.length) ch.push({ field: "trailer_type", label: "Тип причепу (з автопарку)", old: cur.join("; "), new: [...cur, ...add].join("; "), added: add });
            const tons = d.fleet.map((f) => (f.match(/(\d+(?:[.,]\d+)?)\s*т\.?(?!\w)/i) || [])[1]).filter(Boolean).map((x) => Number(x.replace(",", ".")));
            if (tons.length && !String(c.tonnage || "").trim()) ch.push({ field: "tonnage", label: "Тоннаж, т", old: "", new: String(Math.max(...tons)) });
        }
        if (d.fleet.length) {
            const cur = String(c.fleet_params || "").replace(/\n?Автопарк Lardi[\s\S]*$/, "").trim();
            const next = [cur, `Автопарк Lardi (${d.fleet.length}):`, ...d.fleet].filter(Boolean).join("\n");
            if (next !== String(c.fleet_params || "").trim()) ch.push({ field: "fleet_params", label: "Автопарк", old: "", new: d.fleet.join("\n"), value: next });
        }
        // маршрути з відгуків → напрямки (закордон: країна + місто; Україна: область)
        if (d.routes.length) {
            const cur = String(c.destinations || "").split(";").map((x) => x.trim()).filter(Boolean);
            const map = new Map();
            cur.forEach((e) => { const i = e.indexOf("-"); const cn = (typeof normCountryName === "function" ? normCountryName : (x) => x.trim().toUpperCase())(i >= 0 ? e.slice(0, i) : e); const rg = i >= 0 ? e.slice(i + 1).split(",").map((x) => x.trim()).filter(Boolean) : []; map.set(cn, [...(map.get(cn) || []), ...rg]); });
            const before = JSON.stringify([...map]);
            const ua = new Set(String(c.ukraine_directions || "").split(";").map((x) => x.trim().toUpperCase()).filter(Boolean));
            const uaAdd = [];
            for (const r of d.routes) {
                for (const [cc, city] of [[r.fc, r.from], [r.tc, r.to]]) {
                    if (cc === "UA") {
                        const ob = UA_OBL[city.toLowerCase()];
                        if (ob && !ua.has(ob)) { ua.add(ob); uaAdd.push(ob); }
                        continue;
                    }
                    const cn = COUNTRY_UA[cc];
                    if (!cn) continue;
                    const list = map.get(cn) || [];
                    if (!list.some((x) => x.toLowerCase() === city.toLowerCase())) list.push(city);
                    map.set(cn, list);
                }
            }
            if (JSON.stringify([...map]) !== before) ch.push({ field: "destinations", label: "Напрямки закордон (з відгуків)", old: cur.join("; "), new: [...map].map(([cn, rg]) => (rg.length ? `${cn} - ${rg.join(", ")}` : cn)).join(";") });
            if (uaAdd.length) ch.push({ field: "ukraine_directions", label: "Напрямки в Україні (з відгуків)", old: [...ua].filter((x) => !uaAdd.includes(x)).join("; "), new: [...ua].join(";") });
            const top = d.routes.slice(0, 12).map((r) => `${r.from} → ${r.to} (${r.fc}→${r.tc})${r.n > 1 ? " ×" + r.n : ""}`).join("; ");
            if (!/Маршрути з відгуків Lardi/.test(c.notes || "")) ch.push({ field: "notes_routes", label: "Маршрути з відгуків", old: "", new: top, value: `Маршрути з відгуків Lardi: ${top}` });
        }
        const info = [d.regType, d.activity, d.regDate ? `у Lardi з ${d.regDate}` : ""].filter(Boolean).join(" · ");
        if (info && !/Lardi:/.test(c.notes || "")) ch.push({ field: "notes", label: "Нотатки", old: "", new: `Lardi: ${info}`, value: [c.notes, `Lardi: ${info}`].filter(Boolean).join("\n") });
        return ch;
    }

    function pasteOpen(id, files) {
        const c = carrierById(id);
        if (!c) return;
        modal(`<div class="le-sub">1. Відкрийте профіль у Lardi (вкладки «Загальна інформація», «Контакти», «Мій автопарк», «Відгуки»).<br>2. На кожній вкладці: <b>Cmd+A</b>, <b>Cmd+C</b> — і вставте сюди <b>Cmd+V</b> (можна кілька вкладок одна під одною).<br>3. Фото: правою кнопкою на логотипі → «Копіювати адресу зображення» — і теж вставте сюди.</div>
            <textarea class="le-paste" rows="9" placeholder="Вставте сюди текст сторінки профілю Lardi або скріншот (Cmd+V)…"></textarea>
            <div class="le-shots"><label class="le-link le-shotbtn">📷 Додати скріншот<input type="file" accept="image/*" multiple hidden></label><span class="le-shotnote">Зробіть знімок <b>Cmd+Shift+4</b> і <b>перетягніть мініатюру</b> з кутика екрана сюди (не чекаючи, поки збережеться). Або <b>Cmd+Ctrl+Shift+4</b> → тут <b>Cmd+V</b>.</span></div>
            <div class="le-acts"><button type="button" class="le-go" data-le="parse">Розібрати</button><button type="button" class="le-link" data-le="close">Скасувати</button></div>
            <div class="le-res"></div>`, "Вставити з Lardi");
        const ta = box.querySelector(".le-paste");
        setTimeout(() => ta.focus(), 30);
        let changes = [];
        const show = () => {
            const d = parseLardi(ta.value);
            changes = pasteChanges(c, d);
            const res = box.querySelector(".le-res");
            // які телефони знайшли і які з них уже є в картці — щоб було видно, чому номер не пропонується
            const have = new Set([c.phone_1, c.phone_2, ...(Array.isArray(c.extra_contacts) ? c.extra_contacts.map((x) => x?.phone) : [])]
                .flatMap((v) => String(v || "").split(/[,;]/)).map((v) => digits(v).slice(-9)).filter((v) => v.length === 9));
            const phonesInfo = d.contacts.length
                ? `<div class="le-phones">📞 Знайдено телефонів: <b>${d.contacts.length}</b> — ${d.contacts.map((x) => `${esc(x.name || "без імені")}: ${esc(x.phone)}${have.has(digits(x.phone).slice(-9)) ? ' <span class="le-have">✓ уже є в картці</span>' : ""}`).join("; ")}</div>`
                : "";
            res.innerHTML = phonesInfo + (changes.length
                ? `<div class="le-list">${changes.map((x) => `<label class="le-row"><input type="checkbox" data-f="${esc(x.field)}" checked><span class="le-lbl">${esc(x.label)}</span><span class="le-val">${x.old ? `<s>${esc(x.old)}</s> → ` : ""}${esc(x.new)}</span></label>`).join("")}</div>
                   <div class="le-note">Заповнене вручну не перезаписується — лише порожні поля і нові телефони.</div>
                   <div class="le-acts"><button type="button" class="le-go" data-le="psave">Зберегти обране</button></div>`
                : `<div class="le-ok">${!ta.value.trim() ? "" : /^\s*(https?:\/\/\S+\s*)+$/.test(ta.value) ? "Ви вставили лише посилання. Потрібен сам <b>текст сторінки</b>: відкрийте вкладку в Lardi, натисніть <b>Cmd+A</b>, потім <b>Cmd+C</b> — і вставте сюди." : (d.contacts.length ? "Усе з цього тексту вже є в картці." : "Нового в цьому тексті не знайшов. Перевірте, що скопіювали всю сторінку (Cmd+A).")}</div>`);
        };
        // скріншоти: вставка з буфера або вибір файлу → FURA читає текст (Claude) і дописує в поле
        const shrink = (file) => new Promise((ok, bad) => {
            const img = new Image();
            img.onload = () => {
                const k = Math.min(1, 2000 / Math.max(img.width, img.height));
                const cv = document.createElement("canvas");
                cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
                cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
                URL.revokeObjectURL(img.src);
                ok({ media_type: "image/jpeg", data: cv.toDataURL("image/jpeg", 0.9).split(",")[1] });
            };
            img.onerror = bad;
            img.src = URL.createObjectURL(file);
        });
        async function readShots(files) {
            files = [...files].filter((f) => /^image\//.test(f.type)).slice(0, 4);
            if (!files.length) return false;
            const res = box.querySelector(".le-res");
            res.innerHTML = `<div class="le-load">📷 Читаю скріншот… (5–20 с)</div>`;
            try {
                const images = await Promise.all(files.map(shrink));
                const r = await call({ action: "ocr", images });
                ta.value = [ta.value.trim(), r.text || ""].filter(Boolean).join("\n");
                show();
            } catch (err) { res.innerHTML = `<div class="le-err">${esc(err.message)}</div>`; }
            return true;
        }
        ta.addEventListener("paste", (e) => {
            const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
            if (files.length) { e.preventDefault(); readShots(files); return; }
            setTimeout(show, 30);
        });
        // мініатюру знімка (кутик екрана після Cmd+Shift+4) можна кинути будь-куди у вікно
        const card = box.querySelector(".le-card");
        card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("le-drop"); });
        card.addEventListener("dragleave", (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove("le-drop"); });
        card.addEventListener("drop", (e) => { card.classList.remove("le-drop"); if (e.dataTransfer?.files?.length) { e.preventDefault(); e.stopPropagation(); readShots(e.dataTransfer.files); } });
        if (files?.length) readShots(files);
        box.querySelector(".le-shotbtn input").addEventListener("change", (e) => { readShots(e.target.files); e.target.value = ""; });
        box.querySelector("[data-le=parse]").addEventListener("click", show);
        box.querySelector(".le-res").addEventListener("click", async (e) => {
            if (!e.target.closest("[data-le=psave]")) return;
            const want = new Set([...box.querySelectorAll(".le-res [data-f]:checked")].map((x) => x.dataset.f));
            const upd = {};
            for (const x of changes) {
                if (!want.has(x.field)) continue;
                if (x.field === "contacts") {
                    const list = [...x.phones];
                    if (!c.phone_1 && list.length) { const p = list.shift(); upd.phone_1 = p.phone; if (!c.contact_person_1 && p.name) upd.contact_person_1 = p.name; }
                    if (!c.phone_2 && list.length) { const p = list.shift(); upd.phone_2 = p.phone; if (!c.contact_person_2 && p.name) upd.contact_person_2 = p.name; }
                    if (list.length) upd.extra_contacts = [...(Array.isArray(c.extra_contacts) ? c.extra_contacts : []), ...list];
                } else if (x.field === "dup_phone_2") {
                    upd.phone_2 = null; upd.contact_person_2 = null;
                } else if (x.field === "notes" || x.field === "notes_routes") {
                    upd.notes = [upd.notes ?? c.notes, x.field === "notes" ? x.new : x.value].filter(Boolean).join("\n");
                } else upd[x.field] = x.value ?? x.new;
            }
            if (!Object.keys(upd).length) return (box.hidden = true);
            e.target.disabled = true; e.target.textContent = "Зберігаю…";
            const { error } = await sbClient.from("carriers").update(upd).eq("id", id); // eslint-disable-line no-undef
            if (error) { e.target.disabled = false; e.target.textContent = "Зберегти обране"; return alert("Не вдалося зберегти: " + error.message); }
            box.hidden = true;
            await refresh(id);
        });
    }
    window.furaParseLardi = parseLardi; // для перевірки

    // Знімок можна кинути прямо на відкриту картку перевізника — вікно «Вставити з Lardi» відкриється саме
    document.addEventListener("dragover", (e) => {
        if (!e.target.closest?.("#carrierCardOverlay .carrier-card-modal") || ![...(e.dataTransfer?.types || [])].includes("Files")) return;
        e.preventDefault();
        document.querySelector("#carrierCardOverlay .carrier-card-modal")?.classList.add("le-drop");
    });
    document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.querySelector("#carrierCardOverlay .carrier-card-modal")?.classList.remove("le-drop"); });
    document.addEventListener("drop", (e) => {
        const m = e.target.closest?.("#carrierCardOverlay .carrier-card-modal");
        document.querySelector("#carrierCardOverlay .carrier-card-modal")?.classList.remove("le-drop");
        if (!m || !e.dataTransfer?.files?.length) return;
        const imgs = [...e.dataTransfer.files].filter((f) => /^image\//.test(f.type));
        if (!imgs.length) return;
        e.preventDefault();
        const id = curId();
        if (id) pasteOpen(id, imgs);
    });

    const css = document.createElement("style");
    css.textContent = `
    .le-ov{position:fixed;inset:0;z-index:2147483100;background:rgba(17,24,39,.45);display:flex;align-items:center;justify-content:center;padding:16px}
    .le-ov[hidden]{display:none}
    .le-card{width:min(640px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:16px 18px;display:flex;flex-direction:column;gap:10px;color:#111827;font-size:14px}
    .le-head{display:flex;justify-content:space-between;align-items:center}.le-head b{font-size:17px}
    .le-x{border:0;background:none;font-size:26px;color:#9ca3af;cursor:pointer;line-height:1}
    .le-sub,.le-note{font-size:12.5px;color:#6b7280}.le-sub a{color:#a8781f;font-weight:600}
    .le-list{display:flex;flex-direction:column;border:1px solid #f1ead9;border-radius:12px;overflow:hidden}
    .le-row{display:grid;grid-template-columns:auto 150px 1fr;gap:10px;align-items:start;padding:9px 12px;cursor:pointer}
    .le-row+.le-row{border-top:1px solid #f5efe1}.le-row input{accent-color:#c9973a;margin-top:2px}
    .le-lbl{color:#6b7280;font-size:13px}.le-val{word-break:break-word;white-space:pre-line}.le-val s{color:#9ca3af}
    .le-acts{display:flex;align-items:center;gap:12px}
    .le-go{border:0;border-radius:10px;height:40px;padding:0 18px;font:600 14px inherit;font-family:inherit;color:#2b1d06;background:linear-gradient(180deg,#f2d27f,#d9a944);cursor:pointer}
    .le-link{border:0;background:none;color:#a8781f;text-decoration:underline;cursor:pointer;font:inherit;font-size:13px}
    .le-load,.le-ok{padding:18px 4px;color:#374151}.le-err{padding:14px;border-radius:10px;background:#fff5f5;color:#b42318}
    .le-dbg{font-size:11.5px;color:#9ca3af}.le-dbg pre{white-space:pre-wrap;max-height:200px;overflow:auto;background:#f8fafc;padding:8px;border-radius:8px}
    .le-paste{width:100%;box-sizing:border-box;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;font:13px/1.45 inherit;font-family:inherit;resize:vertical}
    .le-paste:focus{outline:none;border-color:#d9a944;box-shadow:0 0 0 3px rgba(217,169,68,.18)}
    .le-res{display:flex;flex-direction:column;gap:10px}
    .le-phones{font-size:13px;color:#374151;background:#f8fafc;border-radius:10px;padding:8px 10px}.le-have{color:#16a34a;font-weight:600;white-space:nowrap}
    .le-drop{outline:3px dashed #d9a944;outline-offset:-6px}
    .le-shots{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;font-size:12.5px;color:#6b7280}.le-shotbtn{margin:0;cursor:pointer}
    @media (max-width:600px){.le-row{grid-template-columns:auto 1fr}.le-val{grid-column:2}}`;
    document.head.appendChild(css);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
    setTimeout(mount, 1500);
})();
