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
    async function lookup(cc, city) {
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
            mem[key] = out; saveMem();
            try { await client()?.from("geo_places").upsert([{ key, country: cc, city: String(city).trim(), ...out, updated_at: new Date().toISOString() }], { onConflict: "key" }); } catch (_) { /* */ }
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
            lookup(cc, city).then((g) => paint(el, g, cc));
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
    // картка перевізника перемальовується — дозаповнюємо
    const mo = new MutationObserver(() => { if (document.querySelector(".dest-place:not([data-geo])")) fill(document); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
})();
