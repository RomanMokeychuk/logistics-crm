/* ================================================================= *
 * FURA — 📍 МІСТА В «НАПРЯМКАХ»: воєводство / регіон і «квадрат»      *
 * Біля кожного міста в картці перевізника: Польща — воєводство й     *
 * квадрат (перші 2 цифри поштового індексу); інші країни — квадрат    *
 * і регіон. Дані — відкрита карта OpenStreetMap (Nominatim); кожне    *
 * місто шукаємо один раз і зберігаємо в базі (geo_places) для всіх.   *
 * ================================================================= */
(function () {
    if (window.furaGeo) return;
    const client = () => (typeof sbClient !== "undefined" ? sbClient : null); // eslint-disable-line no-undef
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const CC = {
        "ПОЛЬЩА": "pl", "ПОЛЬША": "pl", "НІМЕЧЧИНА": "de", "ТУРЕЧЧИНА": "tr", "РУМУНІЯ": "ro", "МОЛДОВА": "md", "БОЛГАРІЯ": "bg",
        "ГРЕЦІЯ": "gr", "АВСТРІЯ": "at", "ЧЕХІЯ": "cz", "СЛОВАЧЧИНА": "sk", "УГОРЩИНА": "hu", "ЛИТВА": "lt", "ЛАТВІЯ": "lv",
        "ЕСТОНІЯ": "ee", "ІТАЛІЯ": "it", "ФРАНЦІЯ": "fr", "ІСПАНІЯ": "es", "ПОРТУГАЛІЯ": "pt", "НІДЕРЛАНДИ": "nl", "ГОЛЛАНДІЯ": "nl",
        "БЕЛЬГІЯ": "be", "ЛЮКСЕМБУРГ": "lu", "ДАНІЯ": "dk", "ШВЕЦІЯ": "se", "ФІНЛЯНДІЯ": "fi", "НОРВЕГІЯ": "no", "СЛОВЕНІЯ": "si",
        "ХОРВАТІЯ": "hr", "СЕРБІЯ": "rs", "БОСНІЯ": "ba", "ЧОРНОГОРІЯ": "me", "АЛБАНІЯ": "al", "МАКЕДОНІЯ": "mk", "ШВЕЙЦАРІЯ": "ch",
        "ВЕЛИКОБРИТАНІЯ": "gb", "ІРЛАНДІЯ": "ie", "ГРУЗІЯ": "ge", "ВІРМЕНІЯ": "am", "АЗЕРБАЙДЖАН": "az", "КАЗАХСТАН": "kz",
        "УЗБЕКИСТАН": "uz", "КИРГИЗСТАН": "kg", "ТАДЖИКИСТАН": "tj", "ТУРКМЕНІСТАН": "tm", "УКРАЇНА": "ua",
    };
    const ccOf = (country) => CC[String(country || "").trim().toUpperCase().replace(/\s+/g, " ")] || "";
    const LKEY = "fura_geo_cache_v1";
    const mem = (() => { try { return JSON.parse(localStorage.getItem(LKEY) || "{}"); } catch (_) { return {}; } })();
    const saveMem = () => { try { localStorage.setItem(LKEY, JSON.stringify(mem)); } catch (_) { /* */ } };
    const keyOf = (cc, city) => `${cc}|${String(city).trim().toLowerCase()}`;
    // «квадрат»: перші 2 цифри індексу (у Великобританії — літерна частина)
    const kvOf = (cc, pc) => {
        pc = String(pc || "").trim().toUpperCase();
        if (!pc) return "";
        if (cc === "gb" || cc === "ie") return (pc.match(/^[A-Z]{1,2}/) || [""])[0];
        const d = pc.replace(/\D/g, "");
        return d.length >= 2 ? d.slice(0, 2) : "";
    };
    const cleanState = (s) => String(s || "").replace(/\s*(воєводство|województwo|область|провінція|регіон|земля|край|іл|province|region)\s*/gi, " ").replace(/\s+/g, " ").trim();
    // місто вже записане як квадрат / індекс («PL-80», «44», «76-200») — не шукаємо
    const isKv = (s) => /^[A-Z]{0,2}[\s-]?\d{2,5}(-\d{3})?$/i.test(String(s).trim());

    // Nominatim: не частіше ніж раз на 1,1 с (правила сервісу)
    let chain = Promise.resolve();
    const nomi = (url) => (chain = chain.then(() => new Promise((ok) => setTimeout(ok, 1100))).then(() =>
        fetch(url, { headers: { "Accept-Language": "uk" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)));

    const pending = new Map();
    async function lookup(cc, city, cname) {
        const key = keyOf(cc, city);
        if (mem[key]) return mem[key];
        if (pending.has(key)) return pending.get(key);
        const p = (async () => {
            // 1) спільна база
            try {
                const { data } = await client()?.from("geo_places").select("state, postcode, kv, found").eq("key", key).maybeSingle() || {};
                if (data) { mem[key] = data; saveMem(); return data; }
            } catch (_) { /* таблиці ще немає — шукаємо напряму */ }
            // 2) OpenStreetMap
            const q = new URLSearchParams({ q: city, countrycodes: cc, format: "jsonv2", addressdetails: "1", limit: "1", "accept-language": "uk" });
            const res = await nomi(`https://nominatim.openstreetmap.org/search?${q}`);
            const hit = Array.isArray(res) && res[0];
            let out = { found: false, state: "", postcode: "", kv: "" };
            if (hit) {
                const a = hit.address || {};
                let pc = a.postcode || "";
                if (!pc) { // у міст індексу часто немає — беремо з точки в центрі
                    const rv = await nomi(`https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({ lat: hit.lat, lon: hit.lon, zoom: "18", format: "jsonv2", addressdetails: "1", "accept-language": "uk" })}`);
                    pc = rv?.address?.postcode || "";
                }
                out = { found: true, state: cleanState(a.state || a.province || a.region || a.county || ""), postcode: pc, kv: kvOf(cc, pc), lat: Number(hit.lat), lon: Number(hit.lon) };
            }
            mem[key] = out; saveMem(); geoVer++;
            try { await client()?.from("geo_places").upsert([{ key, country: cc, cname: cname ? String(cname).trim().toUpperCase().replace(/\s+/g, " ") : null, city: String(city).trim(), ...out, updated_at: new Date().toISOString() }], { onConflict: "key" }); } catch (_) { /* */ }
            return out;
        })();
        pending.set(key, p);
        return p;
    }

    function paint(el, g, cc) {
        if (!g || !g.found) return;
        const kv = g.kv ? `<b>${esc(cc === "pl" ? g.kv : "кв. " + g.kv)}</b>` : "";
        const same = String(g.state || "").toLowerCase() === String(el.dataset.city || "").toLowerCase(); // «Анкара · Анкара» — не дублюємо
        const st = g.state && !same ? `<i>${esc(g.state)}${cc === "pl" ? " в." : ""}</i>` : "";
        const parts = cc === "pl" ? [st, kv] : [kv, st];
        const html = parts.filter(Boolean).join(" · ");
        if (!html) return;
        el.querySelector(".dest-geo")?.remove();
        el.insertAdjacentHTML("beforeend", ` <small class="dest-geo" title="${esc([g.state, g.postcode && "індекс " + g.postcode].filter(Boolean).join(", "))}">${html}</small>`);
    }
    // Заповнити всі міста в елементі (картка перевізника)
    function fill(root) {
        (root || document).querySelectorAll(".dest-place:not([data-geo])").forEach((el) => {
            el.dataset.geo = "1";
            const cc = ccOf(el.dataset.country), city = el.dataset.city;
            if (!cc || cc === "ua" || !city || isKv(city) || city.length < 2) return;
            const key = keyOf(cc, city);
            if (mem[key]) return paint(el, mem[key], cc);
            lookup(cc, city, el.dataset.country).then((g) => paint(el, g, cc));
        });
    }
    window.furaGeo = { fill, lookup, ccOf };

    const css = document.createElement("style");
    css.textContent = `
    .dest-place { white-space: nowrap; }
    .dest-geo { font-size: 11.5px; color: #64748b; margin-left: 2px; white-space: nowrap; }
    .dest-geo b { color: #1d4ed8; font-weight: 700; }
    .dest-geo i { font-style: normal; }
    `;
    document.head.appendChild(css);

    /* ---------- 📍 Фільтр списку перевізників за воєводством / квадратом ---------- */
    const normC = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, " ");
    const PRETTY = { "ПОЛЬША": "ПОЛЬЩА" };
    const byName = new Map(); // «ПОЛЬЩА|слупськ» → {state, kv}
    const putRow = (cname, city, g) => { if (g && g.found) byName.set(`${PRETTY[cname] || cname}|${String(city).trim().toLowerCase()}`, g); };
    let geoVer = 0, loaded = false;
    const SKEY = "fura_geo_filter";
    let sel = new Set((() => { try { return JSON.parse(sessionStorage.getItem(SKEY) || "[]"); } catch (_) { return []; } })());
    const saveSel = () => { try { sessionStorage.setItem(SKEY, JSON.stringify([...sel])); } catch (_) { /* */ } };

    async function loadAll() {
        // довідник з кешу браузера (знайдене в картках)
        const ccName = {};
        Object.entries(CC).forEach(([n, c]) => { if (!ccName[c]) ccName[c] = PRETTY[n] || n; });
        Object.entries(mem).forEach(([k, g]) => { const [cc, city] = k.split("|"); if (ccName[cc]) putRow(ccName[cc], city, g); });
        const sb = client();
        if (sb) {
            for (let from = 0; from < 50000; from += 1000) {
                let res;
                try { res = await sb.from("geo_places").select("key, country, cname, city, state, kv, found").eq("found", true).range(from, from + 999); } catch (_) { break; }
                const rows = res?.data || [];
                rows.forEach((r) => putRow(normC(r.cname || ccName[r.country] || ""), r.city, r));
                if (rows.length < 1000) break;
            }
        }
        loaded = true; geoVer++;
    }

    // Теги перевізника з його «Напрямків»: «ПОЛЬЩА · Поморське в.», «ПОЛЬЩА · кв. 76»
    function tagsOf(item) {
        if (item._geoVer === geoVer && item._geoSrc === item.destinations) return item._geoTags;
        const tags = new Set();
        String(item.destinations || "").split(";").forEach((part) => {
            const i = part.indexOf("-");
            if (i < 0) return;
            const cnRaw = normC(part.slice(0, i));
            const cn = PRETTY[cnRaw] || cnRaw;
            part.slice(i + 1).split(",").forEach((c) => {
                c = c.trim();
                if (!c) return;
                if (isKv(c)) { const d = c.replace(/\D/g, ""); if (d.length >= 2) tags.add(`${cn}\u0001кв. ${d.slice(0, 2)}`); return; }
                const m0 = mem[keyOf(ccOf(cn), c)];
                const g = byName.get(`${cn}|${c.toLowerCase()}`) || (m0 && m0.found ? m0 : null);
                if (!g) return;
                if (g.state) tags.add(`${cn}\u0001${g.state}${ccOf(cn) === "pl" ? " в." : ""}`);
                if (g.kv) tags.add(`${cn}\u0001кв. ${g.kv}`);
            });
        });
        item._geoVer = geoVer; item._geoSrc = item.destinations; item._geoTags = tags;
        return tags;
    }
    window.furaGeoPass = (item) => {
        if (!sel.size) return true;
        const t = tagsOf(item);
        for (const x of sel) if (t.has(x)) return true;
        return false;
    };
    window.furaGeoReset = () => { sel.clear(); saveSel(); paintBtn(); };
    const rerender = () => { if (typeof renderCarriers === "function") { try { currentPage = 1; } catch (_) { /* */ } renderCarriers(); } }; // eslint-disable-line no-undef

    let btn;
    function paintBtn() {
        if (!btn) return;
        btn.classList.toggle("on", sel.size > 0);
        btn.innerHTML = `📍 Регіон / квадрат${sel.size ? ` <b>${sel.size}</b>` : ""}`;
    }
    function openPop() {
        document.getElementById("geoFltPop")?.remove();
        const pop = document.createElement("div");
        pop.id = "geoFltPop";
        pop.className = "geo-pop";
        pop.innerHTML = `<div class="geo-pop-h"><b>📍 Регіон / квадрат</b><button type="button" class="geo-x" title="Закрити">✕</button></div>
            <input type="search" class="geo-q" placeholder="Пошук: Поморське, 76, Анкара…">
            <div class="geo-list"><div class="geo-empty">Завантаження…</div></div>
            <div class="geo-foot"><button type="button" class="btn btn-secondary geo-clr">Очистити</button><button type="button" class="btn btn-primary geo-ok">Застосувати</button></div>
            <div class="geo-note">Воєводство (Польща) / регіон і «квадрат» — перші 2 цифри поштового індексу. Міста розпізнаються автоматично у фоні; поки не всі — список доповнюється.</div>`;
        document.body.appendChild(pop);
        const r = btn.getBoundingClientRect();
        pop.style.top = `${Math.min(r.bottom + 6, innerHeight - 120)}px`;
        pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
        const local = new Set(sel);
        const list = pop.querySelector(".geo-list"), q = pop.querySelector(".geo-q");
        let counts = null;
        const draw = () => {
            if (!counts) return;
            const f = q.value.trim().toLowerCase();
            const groups = {};
            [...counts.entries()].forEach(([tag, n]) => {
                const [cn, lab] = tag.split("\u0001");
                if (f && !`${cn} ${lab}`.toLowerCase().includes(f)) return;
                (groups[cn] ||= []).push([tag, lab, n]);
            });
            const names = Object.keys(groups).sort((a, b) => (a === "ПОЛЬЩА" ? -1 : b === "ПОЛЬЩА" ? 1 : a.localeCompare(b, "uk")));
            if (!names.length) { list.innerHTML = `<div class="geo-empty">${counts.size ? "Нічого не знайдено" : "Ще немає розпізнаних міст — зачекайте, поки сервер їх обробить"}</div>`; return; }
            list.innerHTML = names.map((cn) => {
                const rows = groups[cn].sort((a, b) => {
                    const ka = a[1].startsWith("кв."), kb = b[1].startsWith("кв.");
                    return ka !== kb ? (ka ? 1 : -1) : a[1].localeCompare(b[1], "uk", { numeric: true });
                });
                return `<div class="geo-g">${esc(cn)}</div>` + rows.map(([tag, lab, n]) =>
                    `<label class="geo-row"><input type="checkbox" data-tag="${esc(tag)}"${local.has(tag) ? " checked" : ""}> <span>${esc(lab)}</span> <small>${n}</small></label>`).join("");
            }).join("");
        };
        list.addEventListener("change", (e) => { const t = e.target.dataset.tag; if (!t) return; e.target.checked ? local.add(t) : local.delete(t); });
        q.addEventListener("input", draw);
        const close = () => { pop.remove(); document.removeEventListener("mousedown", outside, true); };
        const outside = (e) => { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close(); };
        setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
        pop.querySelector(".geo-x").onclick = close;
        pop.querySelector(".geo-clr").onclick = () => { sel.clear(); saveSel(); paintBtn(); close(); rerender(); };
        pop.querySelector(".geo-ok").onclick = () => { sel = new Set(local); saveSel(); paintBtn(); close(); rerender(); };
        q.addEventListener("keydown", (e) => { if (e.key === "Enter") pop.querySelector(".geo-ok").click(); if (e.key === "Escape") close(); });
        (loaded ? Promise.resolve() : loadAll()).then(() => {
            counts = new Map();
            const data = typeof allCarriersCache !== "undefined" ? allCarriersCache || [] : []; // eslint-disable-line no-undef
            data.forEach((it) => tagsOf(it).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
            draw();
            q.focus();
        });
    }
    function mount() {
        const anchor = document.getElementById("openModalBtn");
        if (!anchor || document.getElementById("geoFltBtn") || window.self !== window.top) return !!anchor;
        btn = document.createElement("button");
        btn.type = "button";
        btn.id = "geoFltBtn";
        btn.className = "btn btn-secondary geo-btn";
        btn.title = "Фільтр за воєводством (Польща) / регіоном і квадратом поштового індексу";
        btn.onclick = openPop;
        anchor.parentNode.insertBefore(btn, anchor);
        paintBtn();
        // якщо фільтр збережений — підвантажуємо довідник і перемальовуємо список
        if (sel.size) loadAll().then(rerender);
        else setTimeout(() => { if (!loaded) loadAll(); }, 4000);
        return true;
    }
    if (!mount()) document.addEventListener("DOMContentLoaded", mount);
    css.textContent += `
    .geo-btn.on { background: #dbeafe; border-color: #3b82f6; color: #1d4ed8; }
    .geo-btn b { background: #2563eb; color: #fff; border-radius: 9px; padding: 0 6px; font-size: 11px; margin-left: 4px; }
    .geo-pop { position: fixed; z-index: 9999; width: 340px; max-width: calc(100vw - 16px); background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 12px 32px rgba(15,23,42,.18); padding: 10px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: #0f172a; }
    .geo-pop-h { display: flex; justify-content: space-between; align-items: center; }
    .geo-x { border: 0; background: none; cursor: pointer; font-size: 15px; color: #64748b; }
    .geo-q { width: 100%; padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; box-sizing: border-box; }
    .geo-list { max-height: 50vh; overflow: auto; border: 1px solid #f1f5f9; border-radius: 8px; padding: 4px 6px; }
    .geo-g { font-weight: 700; font-size: 11.5px; color: #475569; margin: 8px 0 2px; letter-spacing: .02em; }
    .geo-row { display: flex; align-items: center; gap: 6px; padding: 3px 2px; cursor: pointer; border-radius: 6px; }
    .geo-row:hover { background: #f8fafc; }
    .geo-row span { flex: 1; }
    .geo-row small { color: #94a3b8; }
    .geo-empty { color: #94a3b8; padding: 12px 4px; text-align: center; }
    .geo-foot { display: flex; justify-content: flex-end; gap: 6px; }
    .geo-note { font-size: 11px; color: #94a3b8; line-height: 1.35; }
    `;
    // картка перевізника перемальовується — дозаповнюємо
    const mo = new MutationObserver(() => { if (document.querySelector(".dest-place:not([data-geo])")) fill(document); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
})();
