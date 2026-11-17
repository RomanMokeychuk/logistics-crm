/* ================================================================= *
 * FURA — «БЛОКНОТ ЗАПИТІВ»: особисті нотатки по запитах               *
 * Як Google-таблиця «ЗАПРОСИ»: напрямок, адреси, вантаж, авто,         *
 * коментар, статус + скільки завгодно перевізників з ціною.           *
 * Таблиця my_requests (notebook.sql) — кожен бачить лише свої.        *
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

const NB = (() => {
    const $ = (s, r = document) => r.querySelector(s);
    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const norm = (s) => String(s || "").toLowerCase().replace(/[’'`"]/g, "").replace(/\s+/g, " ").trim();

    const STATUSES = [
        { k: "Актуальне", cls: "ok" },
        { k: "Прорахунок", cls: "calc" },
        { k: "Чекаю відповідь", cls: "wait" },
        { k: "Закрито", cls: "done" },
        { k: "Відмова", cls: "no" },
    ];
    const stCls = (s) => (STATUSES.find((x) => x.k === s) || {}).cls || "none";
    const PAGE = 60;

    let ROWS = [];
    let me = null;
    const st = { q: "", status: new Set(), dir: new Set(), truck: new Set(), has: new Set(), region: new Set(), city: new Set(), side: "any", period: "", sort: "upd", shown: PAGE };
    const dt = (v) => (v ? new Date(v).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
    const keyC = (c) => [c.id || "", c.name || "", c.edrpou || ""].join("|");
    let editing = null;

    /* ---------- завантаження ---------- */
    /* ---------- запам'ятовуємо, де ви були: фільтри, пошук, прокрутка ---------- */
    const STATE_KEY = "fura_nb_state";
    const SETS = ["status", "dir", "truck", "has", "region", "city"];
    function saveState() {
        try {
            const o = { q: st.q, period: st.period, sort: st.sort, side: st.side, shown: st.shown, scroll: $(".nb-scroll")?.scrollTop || 0 };
            SETS.forEach((k) => (o[k] = [...st[k]]));
            localStorage.setItem(STATE_KEY, JSON.stringify(o));
        } catch (_) { /* без пам'яті */ }
    }
    let savedScroll = 0;
    function restoreState() {
        let o = null;
        try { o = JSON.parse(localStorage.getItem(STATE_KEY) || "null"); } catch (_) { o = null; }
        if (!o) return;
        st.q = o.q || ""; st.period = o.period || ""; st.sort = o.sort || "upd"; st.side = o.side || "any";
        st.shown = Math.max(PAGE, Number(o.shown) || PAGE);
        SETS.forEach((k) => (st[k] = new Set(Array.isArray(o[k]) ? o[k] : [])));
        $("#nbQ").value = st.q; $("#nbPeriod").value = st.period; $("#nbSort").value = st.sort; $("#nbSide").value = st.side;
        savedScroll = Number(o.scroll) || 0;
    }
    // список із попереднього відкриття — щоб показати одразу, поки йде свіже завантаження
    const ROWS_KEY = "fura_nb_rows";
    function cacheRows() { try { sessionStorage.setItem(ROWS_KEY, JSON.stringify(ROWS.map(({ _hay, _places, ...r }) => r))); } catch (_) { /* завеликий */ } }
    function scrollBack() { if (savedScroll) $(".nb-scroll").scrollTop = savedScroll; }

    async function load() {
        try {
            const cached = JSON.parse(sessionStorage.getItem(ROWS_KEY) || "null");
            if (Array.isArray(cached) && cached.length && !ROWS.length) { ROWS = cached; render(); scrollBack(); }
        } catch (_) { /* без кешу */ }
        const { data: s } = await sbClient.auth.getSession();
        me = s?.session?.user || null;
        if (!me) { location.href = "login.html"; return; }
        const all = [];
        for (let from = 0; from < 50000; from += 1000) {
            const { data, error } = await sbClient.from("my_requests").select("*").order("updated_at", { ascending: false }).range(from, from + 999);
            if (error) {
                $("#nbList").innerHTML = `<div class="nb-empty nb-bad">Немає таблиці «Блокнота»: ${esc(error.message)}.<br>Виконайте <b>notebook.sql</b> у Supabase → SQL Editor.</div>`;
                return;
            }
            all.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
        const sc = $(".nb-scroll"), keep = sc.scrollTop;
        ROWS = all;
        cacheRows();
        render();
        sc.scrollTop = savedScroll || keep;
        savedScroll = 0;
        loadLinks().then(() => { const k = sc.scrollTop; render(); sc.scrollTop = k; }).catch(() => {});
        syncRequests().catch((e) => console.warn("Запити → Блокнот:", e));
        geoQueue();
    }

    /* ---------- «Запити» FURA, де я логіст → у Блокнот ---------- */
    let REQS = new Map(); // id запиту → запит (для статусу й посилання)
    const ACTIVE_REQ = ["Запит", "Відповідь", "В роботі"];
    const title = (x) => String(x || "").trim().toLowerCase().replace(/(^|[\s-])([a-zа-яіїєґ])/g, (m, a, b) => a + b.toUpperCase());
    const logistIds = (r) => (Array.isArray(r.logistician_ids) && r.logistician_ids.length ? r.logistician_ids : r.logistician_id ? [r.logistician_id] : []).map(String);
    function fromRequest(q) {
        const d = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join(".") : "");
        const when = q.desired_date ? `${d(q.desired_date)}${q.desired_date_to ? " – " + d(q.desired_date_to) : ""}` : "";
        return {
            request_id: q.id,
            direction: [title(q.load_country), title(q.unload_country)].filter(Boolean).join(" - ") || null,
            addresses: [q.load_address || title(q.load_country), q.unload_address || title(q.unload_country)].filter(Boolean).join(" - ") || null,
            cargo: [q.cargo, q.weight ? `${q.weight}${/т|t|кг/i.test(q.weight) ? "" : " т"}` : ""].filter(Boolean).join(", ") || null,
            truck: q.transport_type || null,
            comment: [when, q.request_type].filter(Boolean).join(" · ") || null,
            status: "Актуальне",
            carriers: [],
        };
    }
    async function syncRequests() {
        const { data: staff } = await sbClient.from("staff").select("id, email").ilike("email", me.email).limit(1);
        const sid = staff?.[0]?.id;
        if (!sid) return;
        const { data: reqs, error } = await sbClient.from("requests").select("*").in("status", ACTIVE_REQ).order("created_at", { ascending: false }).limit(2000);
        if (error) return;
        const mine = (reqs || []).filter((q) => logistIds(q).includes(String(sid)));
        // статуси для вже пов'язаних записів (навіть якщо запит уже закрито)
        const linked = ROWS.map((r) => r.request_id).filter(Boolean);
        const map = new Map(mine.map((q) => [q.id, q]));
        const extra = linked.filter((id) => !map.has(id));
        for (let i = 0; i < extra.length; i += 200) {
            const { data } = await sbClient.from("requests").select("id, status, client, created_at").in("id", extra.slice(i, i + 200));
            (data || []).forEach((q) => map.set(q.id, q));
        }
        REQS = map;
        const have = new Set(linked);
        const add = mine.filter((q) => !have.has(q.id)).map(fromRequest);
        if (add.length) {
            const { data, error: e2 } = await sbClient.from("my_requests").insert(add).select("*");
            if (e2) {
                if (/request_id/.test(e2.message)) console.warn("Виконайте notebook_requests.sql у Supabase");
                else console.warn(e2.message);
            } else if (data?.length) {
                ROWS = [...data, ...ROWS];
                cacheRows();
            }
        }
        const sc = $(".nb-scroll"), k = sc.scrollTop;
        render();
        sc.scrollTop = k;
    }

    /* ---------- перевізники: Ларді (профіль з картки FURA) і чи стоять зараз у Черзі ---------- */
    let LINKS = new Map(); // id картки FURA → { lardi }
    let DEALS = new Map(); // id → { n, last }
    let QUEUE = new Map(); // ЄДРПОУ → [{ checkpoint, entry_at, tractor }]
    const qKey = (c) => String(c || "").replace(/\D/g, "").replace(/^0+/, "");
    async function loadLinks() {
        const cs = ROWS.flatMap((r) => r.carriers || []);
        const ids = [...new Set(cs.map((c) => c.id).filter(Boolean))];
        const map = new Map();
        for (let i = 0; i < ids.length; i += 300) {
            const { data } = await sbClient.from("carriers").select("id, edrpou, profile_url").in("id", ids.slice(i, i + 300));
            (data || []).forEach((c) => map.set(String(c.id), { lardi: c.profile_url || "", edrpou: c.edrpou || "" }));
        }
        // скільки угод уже було з цим перевізником у FURA
        const deals = new Map();
        for (let i = 0; i < ids.length; i += 300) {
            const { data } = await sbClient.from("deals").select("carrier_id, load_date").in("carrier_id", ids.slice(i, i + 300)).limit(5000);
            (data || []).forEach((d) => { const k = String(d.carrier_id); const o = deals.get(k) || { n: 0, last: "" }; o.n++; if ((d.load_date || "") > o.last) o.last = d.load_date || ""; deals.set(k, o); });
        }
        DEALS = deals;
        LINKS = map;
        // хто з цих перевізників зараз у черзі на кордоні (останній знімок «Черги»)
        const codes = [...new Set([...cs.map((c) => c.edrpou), ...[...map.values()].map((x) => x.edrpou)].map(qKey).filter(Boolean))];
        const { data: sync } = await sbClient.from("echerha_sync").select("sync_id").eq("id", 1).maybeSingle();
        const q = new Map();
        if (sync?.sync_id && codes.length) {
            const variants = [...new Set(codes.flatMap((c) => [c, c.padStart(8, "0")]))];
            for (let i = 0; i < variants.length; i += 300) {
                const { data } = await sbClient.from("echerha_queue").select("edrpou, checkpoint, entry_at, tractor").eq("sync_id", sync.sync_id).in("edrpou", variants.slice(i, i + 300));
                (data || []).forEach((x) => { const k = qKey(x.edrpou); (q.get(k) || q.set(k, []).get(k)).push(x); });
            }
        }
        QUEUE = q;
    }
    const lardiOf = (c) => (c.id && LINKS.get(String(c.id))?.lardi) || "";
    const queueOf = (c) => QUEUE.get(qKey(c.edrpou || (c.id && LINKS.get(String(c.id))?.edrpou))) || [];

    /* ---------- місця: країна / регіон (воєводство, область) / місто ---------- */
    const CC = {
        "україна": "ua", "польща": "pl", "польша": "pl", "німеччина": "de", "литва": "lt", "латвія": "lv", "естонія": "ee", "чехія": "cz",
        "словаччина": "sk", "угорщина": "hu", "румунія": "ro", "молдова": "md", "болгарія": "bg", "австрія": "at", "італія": "it",
        "іспанія": "es", "франція": "fr", "бельгія": "be", "нідерланди": "nl", "голландія": "nl", "данія": "dk", "фінляндія": "fi",
        "швеція": "se", "норвегія": "no", "швейцарія": "ch", "словенія": "si", "хорватія": "hr", "сербія": "rs", "греція": "gr",
        "португалія": "pt", "туреччина": "tr", "грузія": "ge", "казахстан": "kz", "велика британія": "gb", "великобританія": "gb",
        "люксембург": "lu", "ірландія": "ie", "європа": "",
    };
    const CNAME = { ua: "Україна", pl: "Польща", de: "Німеччина", lt: "Литва", lv: "Латвія", ee: "Естонія", cz: "Чехія", sk: "Словаччина", hu: "Угорщина",
        ro: "Румунія", md: "Молдова", bg: "Болгарія", at: "Австрія", it: "Італія", es: "Іспанія", fr: "Франція", be: "Бельгія", nl: "Нідерланди",
        dk: "Данія", fi: "Фінляндія", se: "Швеція", no: "Норвегія", ch: "Швейцарія", si: "Словенія", hr: "Хорватія", rs: "Сербія", gr: "Греція",
        pt: "Португалія", tr: "Туреччина", ge: "Грузія", kz: "Казахстан", gb: "Велика Британія", lu: "Люксембург", ie: "Ірландія" };
    const GEO_KEY = "fura_nb_geo";
    let GEO = {};
    try { GEO = JSON.parse(localStorage.getItem(GEO_KEY) || "{}"); } catch (_) { GEO = {}; }
    const saveGeo = () => { try { localStorage.setItem(GEO_KEY, JSON.stringify(GEO)); } catch (_) { /* повна пам'ять */ } };
    const shortReg = (s) => String(s || "").replace(/\s*(воєводство|województwo|область|oblast|region|kraj|județul|megye)\s*/gi, " ").replace(/\s+/g, " ").trim();
    // «Гданськ - Кожичі, Львівська область» → [{side:'from', text:'Гданськ', cc:'pl'}, {side:'to', ...}]
    function placesOf(r) {
        if (r._places) return r._places;
        const ccs = String(r.direction || "").split(/\s*[-–—]\s*/).map((x) => CC[norm(x)] ?? "");
        const txt = String(r.addresses || "").replace(/={3,}/g, "\n");
        const parts = txt.split(/\s+[-–—]\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 1);
        if (!parts.length) return (r._places = []);
        const pick = parts.length === 1 ? [[parts[0], "from"]] : [[parts[0], "from"], [parts[parts.length - 1], "to"]];
        return (r._places = pick.map(([text, side]) => {
            let cc = side === "from" ? ccs[0] || "" : ccs[ccs.length - 1] || "";
            const named = Object.keys(CC).find((n) => CC[n] && norm(text).includes(n));
            if (named) cc = CC[named];
            const clean = text.replace(/\b\d{2}-?\d{3}\b/g, " ").replace(/\b(ТО|ТЛ|МП)\b/g, " ").replace(/,?\s*(вул|ул|str|ul)\.?\s.*$/i, "").replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "");
            return { side, text: clean, cc };
        }));
    }
    const geoKey = (p) => `${p.cc}|${norm(p.text)}`;
    // Без сервера: «…, Львівська область» → регіон і місто з тексту
    function geoLocal(p) {
        const m = p.text.match(/([A-Za-zА-Яа-яІіЇїЄєҐґ'’-]+)\s+(область|обл\.?|воєводство|województwo)/i);
        const city = p.text.split(",")[0].replace(/^(с\.|м\.|смт|село|місто)\s*/i, "").trim();
        return { cc: p.cc, state: m ? m[1] : "", city };
    }
    function geoOf(p) { return GEO[geoKey(p)] || geoLocal(p); }
    let geoBusy = false;
    async function geoQueue() {
        if (geoBusy) return;
        const todo = [...new Map(ROWS.flatMap(placesOf).filter((p) => p.text && !GEO[geoKey(p)]).map((p) => [geoKey(p), p])).values()];
        if (!todo.length) return;
        geoBusy = true;
        let n = 0;
        for (const p of todo) {
            try {
                const { data } = await sbClient.functions.invoke("fura-geo", { body: { action: "suggest", text: p.text.slice(0, 80), country: p.cc || undefined } });
                const r = (data?.results || [])[0];
                const loc = geoLocal(p);
                GEO[geoKey(p)] = r ? { cc: (r.country_code || p.cc || "").toLowerCase(), state: shortReg(r.state) || loc.state, city: r.city || r.name || loc.city } : { ...loc, miss: 1 };
            } catch (_) {
                GEO[geoKey(p)] = { ...geoLocal(p), miss: 1 };
            }
            if (++n % 10 === 0) { saveGeo(); fillSelects(); }
            await new Promise((ok) => setTimeout(ok, 250));
        }
        saveGeo();
        geoBusy = false;
        render();
    }
    const placeKeys = (r) => placesOf(r).filter((p) => st.side === "any" || p.side === st.side).map((p) => {
        const g = geoOf(p);
        const cn = CNAME[g.cc] || "Інше";
        return { country: `c:${cn}`, region: g.state ? `r:${cn} · ${shortReg(g.state)}` : "", city: g.city ? `m:${g.city}, ${cn}` : "" };
    });

    /* ---------- список ---------- */
    function hay(r) {
        if (!r._hay) r._hay = norm([r.direction, r.addresses, r.cargo, r.truck, r.comment, r.status,
            ...(r.carriers || []).map((c) => [c.name, c.edrpou, c.price, c.note, ...(c.contacts || []).map((k) => `${k.name} ${k.phone} ${String(k.phone || "").replace(/\D/g, "")}`)].join(" "))].join(" "));
        return r._hay;
    }
    function filtered() {
        const words = norm(st.q).split(" ").filter(Boolean);
        const since = st.period ? Date.now() - Number(st.period) * 86400000 : 0;
        const list = ROWS.filter((r) => {
            const cs = r.carriers || [];
            if (st.status.size && !st.status.has(r.status || "—")) return false;
            if (st.dir.size && !st.dir.has((r.direction || "").trim())) return false;
            if (st.truck.size && !st.truck.has(norm(r.truck))) return false;
            if (st.region.size && !placeKeys(r).some((k) => st.region.has(k.country) || st.region.has(k.region))) return false;
            if (st.city.size && !placeKeys(r).some((k) => st.city.has(k.city))) return false;
            if (st.has.size && ![...st.has].some((h) => (h === "with" ? cs.length : h === "without" ? !cs.length : h === "req" ? r.request_id : cs.some((c) => c.id)))) return false;
            if (since && new Date(r.updated_at || r.created_at).getTime() < since) return false;
            return words.every((w) => hay(r).includes(w));
        });
        // порядок за датою створення — зміни перевізника чи ціни не переносять запит на інше місце
        const t = (r) => new Date(r.created_at || r.updated_at).getTime() || 0;
        const tie = (a, b) => String(a.id).localeCompare(String(b.id));
        if (st.sort === "old") list.sort((a, b) => t(a) - t(b) || tie(a, b));
        else if (st.sort === "many") list.sort((a, b) => (b.carriers || []).length - (a.carriers || []).length || t(b) - t(a) || tie(a, b));
        else list.sort((a, b) => t(b) - t(a) || tie(a, b));
        return list;
    }
    // випадаючий список з галочками — можна обрати кілька
    function msel(id, label, vals, set) {
        const el = $(id);
        const wasOpen = el.classList.contains("open");
        const scroll = el.querySelector(".nb-ms-panel")?.scrollTop || 0;
        const picked = vals.filter(([v]) => set.has(v));
        const txt = !picked.length ? label : picked.length === 1 ? picked[0][1] : `${label}: ${picked.length}`;
        const find = el.querySelector(".nb-ms-find")?.value || "";
        el.innerHTML = `<button type="button" class="nb-ms-btn ${picked.length ? "on" : ""}">${esc(txt)} <i class="bx bx-chevron-down"></i></button>
            <div class="nb-ms-panel">
                ${vals.length > 10 ? `<input class="nb-ms-find" placeholder="Пошук…" value="${esc(find)}" />` : ""}
                ${vals.map(([v, l, n, cls]) => `<label class="${cls || ""}" data-l="${esc(norm(l))}"${find && !norm(l).includes(norm(find)) ? " hidden" : ""}><input type="checkbox" value="${esc(v)}" ${set.has(v) ? "checked" : ""}/> <span>${esc(l)}</span>${n != null ? `<em>${n}</em>` : ""}</label>`).join("") || '<div class="nb-muted">немає</div>'}
                ${picked.length ? '<button type="button" class="nb-ms-clear">Очистити</button>' : ""}
            </div>`;
        el.classList.toggle("open", wasOpen);
        el.querySelector(".nb-ms-panel").scrollTop = scroll;
        el._set = set;
    }
    function fillSelects() {
        const count = (f) => { const m = new Map(); ROWS.forEach((r) => { const k = f(r); if (k) m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); };
        msel("#nbDir", "Усі напрямки", count((r) => (r.direction || "").trim()).map(([k, n]) => [k, k, n]), st.dir);
        msel("#nbTruck", "Усі авто", count((r) => norm(r.truck)).map(([k, n]) => [k, k.toUpperCase(), n]), st.truck);
        const cn = (f) => ROWS.filter((r) => f(r.carriers || [])).length;
        // місця: країна → її регіони (воєводства / області); окремо міста
        const reg = new Map(), cities = new Map();
        ROWS.forEach((r) => {
            const ks = placeKeys(r);
            new Set(ks.flatMap((k) => [k.country, k.region]).filter(Boolean)).forEach((k) => reg.set(k, (reg.get(k) || 0) + 1));
            new Set(ks.map((k) => k.city).filter(Boolean)).forEach((k) => cities.set(k, (cities.get(k) || 0) + 1));
        });
        const regVals = [...reg].filter(([k]) => k.startsWith("c:")).sort((a, b) => b[1] - a[1]).flatMap(([k, n]) => {
            const cn = k.slice(2);
            return [[k, cn, n, "nb-ms-grp"], ...[...reg].filter(([r]) => r.startsWith(`r:${cn} · `)).sort((a, b) => b[1] - a[1]).map(([r, m]) => [r, r.slice(cn.length + 5), m, "nb-ms-sub"])];
        });
        msel("#nbRegion", "Країна / регіон", regVals, st.region);
        msel("#nbCity", "Місто", [...cities].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, k.slice(2), n]), st.city);
        msel("#nbHas", "Усі запити", [["with", "З перевізниками", cn((c) => c.length)], ["without", "Без перевізників", cn((c) => !c.length)], ["fura", "Перевізник є у FURA", cn((c) => c.some((x) => x.id))], ["req", "📋 З «Запитів» FURA", ROWS.filter((r) => r.request_id).length]], st.has);
    }
    function renderChips() {
        const n = (k) => ROWS.filter((r) => (k === "—" ? !r.status : r.status === k)).length;
        const chips = [{ k: "", label: `Усі ${ROWS.length}` }, ...STATUSES.map((s) => ({ k: s.k, label: `${s.k} ${n(s.k)}`, cls: s.cls })), { k: "—", label: `Без статусу ${n("—")}` }];
        $("#nbStatus").innerHTML = chips.map((c) => `<button type="button" class="nb-chip ${c.cls ? "st-" + c.cls : ""} ${(c.k ? st.status.has(c.k) : !st.status.size) ? "active" : ""}" data-st="${esc(c.k)}">${esc(c.label)}</button>`).join("");
    }
    const cleanPrice = (p) => String(p || "").replace(/^\d{1,3}\s+(?=\d{3,5}\b)/, "");
    function carrierHtml(c, i) {
        const name = esc(c.name || "Перевізник");
        const nameEl = `<span class="nb-cname">${c.id ? '<i class="bx bxs-check-circle nb-infura" title="Є у FURA"></i> ' : ""}${name}</span>`;
        return `<div class="nb-carrier" data-ci="${i}" title="Натисніть, щоб відкрити">
            ${nameEl}
            ${c.edrpou ? `<button type="button" class="nb-code" data-copy="${esc(c.edrpou)}" title="Копіювати">${esc(c.edrpou)} <i class="bx bx-copy"></i></button>` : ""}
            ${c.price ? `<div class="nb-price">${esc(cleanPrice(c.price))}</div>` : ""}
            ${(c.contacts || []).slice(0, 2).map((k) => `<div class="nb-cph">📞 ${esc(k.name || "")}${k.name && k.phone ? " · " : ""}${k.phone ? `<button type="button" class="nb-code" data-copy="${esc(k.phone)}" title="Копіювати номер">${esc(k.phone)} <i class="bx bx-copy"></i></button>` : ""}</div>`).join("")}
            ${(c.contacts || []).length > 2 ? `<div class="nb-cph nb-muted">ще ${(c.contacts.length - 2)} контакт(и)</div>` : ""}
            ${c.note ? `<div class="nb-note">${esc(c.note)}</div>` : ""}
            ${(() => {
                const qu = queueOf(c), l = lardiOf(c);
                const d = c.id && DEALS.get(String(c.id));
                if (!qu.length && !l && !d) return "";
                return `<div class="nb-clinks">${d ? `<span class="nb-deals" title="Угод у FURA, остання ${esc(String(d.last).slice(0, 10))}">🤝 угод: ${d.n}</span>` : ""}${qu.length ? `<span class="nb-inq" title="${esc(qu.map((x) => `${x.tractor} — ${x.checkpoint}`).join("\n"))}">🚦 у черзі: ${qu.length}</span>` : ""}${l ? `<a href="${esc(l)}" target="_blank" rel="noopener" class="nb-lardi" title="Профіль на Ларді">Ларді ↗</a>` : ""}</div>`;
            })()}
            ${c.at ? `<div class="nb-cat">${esc(dt(c.at))}</div>` : ""}
        </div>`;
    }
    function rowHtml(r) {
        const cs = r.carriers || [];
        return `<div class="nb-row" data-id="${esc(r.id)}">
            <div class="nb-main" data-edit title="Двічі клацніть, щоб змінити">
                <div class="nb-top">
                    <span class="nb-status st-${stCls(r.status)}">${esc(r.status || "без статусу")}</span>
                    <span class="nb-dir">${esc(r.direction || "")}</span>
                    ${r.request_id ? `<a class="nb-req" href="requests.html?open=${encodeURIComponent(r.request_id)}" title="Відкрити запит у «Запитах»">📋 Запит${REQS.get(r.request_id)?.status ? " · " + esc(REQS.get(r.request_id).status) : ""}</a>` : ""}
                    <span class="nb-date">${new Date(r.updated_at || r.created_at).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}</span>
                    <button type="button" class="nb-rbtn" data-redit title="Змінити"><i class="bx bx-edit-alt"></i></button>
                    <button type="button" class="nb-rbtn nb-rdel" data-rdel title="Видалити запит"><i class="bx bx-trash"></i></button>
                </div>
                <div class="nb-addr">${esc(r.addresses || "—")}</div>
                ${r.cargo ? `<div class="nb-cargo"><i class="bx bx-package"></i> ${esc(r.cargo)}</div>` : ""}
                <div class="nb-meta">${r.truck ? `<span class="nb-tag">${esc(r.truck)}</span>` : ""}${r.comment ? `<span>${esc(r.comment)}</span>` : ""}</div>
            </div>
            <div class="nb-carriers">
                ${cs.map((c, i) => carrierHtml(c, i)).join("")}
                <button type="button" class="nb-addc" data-addc title="Додати перевізника"><i class="bx bx-plus"></i><span>${cs.length ? "" : "перевізник"}</span></button>
            </div>
        </div>`;
    }
    function render() {
        renderChips();
        fillSelects();
        const list = filtered();
        // не стрибати: запам'ятовуємо прокрутку списку і кожного ряду перевізників
        const sc = $(".nb-scroll"), top = sc ? sc.scrollTop : 0;
        const lefts = new Map([...document.querySelectorAll(".nb-row")].map((r) => [r.dataset.id, r.querySelector(".nb-carriers")?.scrollLeft || 0]));
        $("#nbCount").textContent = list.length === ROWS.length ? `${ROWS.length} запитів` : `знайдено ${list.length} з ${ROWS.length}`;
        $("#nbList").innerHTML = list.slice(0, st.shown).map(rowHtml).join("") ||
            `<div class="nb-empty">${ROWS.length ? "Нічого не знайдено" : "Тут поки порожньо. Натисніть «Новий запит» або імпортуйте свою Google-таблицю (Файл → Завантажити → CSV)."}</div>`;
        $("#nbMore").classList.toggle("hidden", list.length <= st.shown);
        document.querySelectorAll(".nb-row").forEach((r) => { const l = lefts.get(r.dataset.id); if (l) r.querySelector(".nb-carriers").scrollLeft = l; });
        if (sc) sc.scrollTop = top;
        saveState();
    }

    /* ---------- форма ---------- */
    function carrierEditor(c = {}) {
        const d = document.createElement("div");
        d.className = "nb-cedit";
        d.dataset.id = c.id || "";
        d._contacts = c.contacts || [];
        d.innerHTML = `
            <div class="nb-cpick"><input class="nb-cin" placeholder="Перевізник: назва або ЄДРПОУ (з FURA або вручну)" value="${esc(c.name || "")}" /><div class="nb-sugg hidden"></div></div>
            <input class="nb-ccode" placeholder="ЄДРПОУ" value="${esc(c.edrpou || "")}" />
            <input class="nb-cprice" placeholder="Ціна (2200 €)" value="${esc(c.price || "")}" />
            <input class="nb-cnote" placeholder="Нотатка: коли може, контакт…" value="${esc(c.note || "")}" />
            <button type="button" class="nb-x nb-cdel" title="Прибрати">&times;</button>`;
        $("#nbCarriers").appendChild(d);
        return d;
    }
    function open(r, focusCarrier) {
        editing = r || null;
        const f = $("#nbForm");
        f.reset();
        f.status.innerHTML = `<option value="">—</option>` + STATUSES.map((s) => `<option>${esc(s.k)}</option>`).join("");
        ["direction", "addresses", "cargo", "truck", "comment", "status"].forEach((k) => (f[k].value = r?.[k] || ""));
        if (!r) f.status.value = "Актуальне";
        $("#nbFormTitle").textContent = r ? "Запит" : "Новий запит";
        $("#nbDelete").classList.toggle("hidden", !r);
        $("#nbCarriers").innerHTML = "";
        (r?.carriers || []).forEach((c) => carrierEditor(c));
        if (!r?.carriers?.length || focusCarrier) carrierEditor();
        $("#nbModal").classList.remove("hidden");
        setTimeout(() => (focusCarrier ? [...document.querySelectorAll(".nb-cin")].pop() : f.direction).focus(), 30);
    }
    const close = () => { $("#nbModal").classList.add("hidden"); editing = null; };

    async function save(e) {
        e.preventDefault();
        const f = $("#nbForm");
        const row = {};
        ["direction", "addresses", "cargo", "truck", "comment", "status"].forEach((k) => (row[k] = f[k].value.trim() || null));
        row.carriers = [...document.querySelectorAll(".nb-cedit")].map((d) => ({
            id: d.dataset.id || null,
            name: $(".nb-cin", d).value.trim(),
            edrpou: $(".nb-ccode", d).value.replace(/\D/g, ""),
            price: $(".nb-cprice", d).value.trim(),
            note: $(".nb-cnote", d).value.trim(),
            contacts: d._contacts || [],
        })).filter((c) => c.name || c.edrpou || c.price || c.note);
        // час для кожного перевізника: новий або змінений — зараз, без змін — як був
        const prev = new Map((editing?.carriers || []).map((c) => [keyC(c), c]));
        const now = new Date().toISOString();
        row.carriers.forEach((c) => {
            const p = prev.get(keyC(c)) || (editing?.carriers || []).find((x) => (x.edrpou && x.edrpou === c.edrpou) || (x.name && x.name === c.name));
            const same = p && p.price === c.price && p.note === c.note && p.name === c.name && p.edrpou === c.edrpou;
            c.added = p?.added || p?.at || (p ? editing.created_at : now);
            c.at = same ? (p.at || null) : now;
        });
        const btn = f.querySelector("[type=submit]");
        btn.disabled = true;
        const q = editing ? sbClient.from("my_requests").update(row).eq("id", editing.id) : sbClient.from("my_requests").insert(row);
        const { data, error } = await q.select("*");
        btn.disabled = false;
        if (error) { alert("Не вдалося зберегти: " + error.message); return; }
        const saved = data?.[0];
        if (saved) {
            const old = ROWS.find((x) => x.id === saved.id);
            if (old) {
                saved._sortAt = old._sortAt || new Date(old.updated_at || old.created_at).getTime();
                ROWS = ROWS.map((x) => (x.id === saved.id ? saved : x));
            } else ROWS.unshift(saved);
        }
        close();
        render();
        geoQueue();
        loadLinks().then(render).catch(() => {});
    }
    async function remove() {
        if (!editing || !confirm("Видалити цей запит з блокнота?")) return;
        const { error } = await sbClient.from("my_requests").delete().eq("id", editing.id);
        if (error) { alert(error.message); return; }
        ROWS = ROWS.filter((x) => x.id !== editing.id);
        close();
        render();
    }

    /* ---------- перегляд перевізника в запиті ---------- */
    let POP = null; // {r, i} — який перевізник відкритий у віконці
    const ctRow = (k = {}) => `<div class="nb-ct">
        <input class="nb-pin" data-ct="name" value="${esc(k.name || "")}" placeholder="Ім'я (кому дзвонив)" />
        <input class="nb-pin" data-ct="phone" value="${esc(k.phone || "")}" placeholder="+380…" inputmode="tel" />
        <button type="button" class="nb-code" data-ctcopy title="Копіювати номер"><i class="bx bx-copy"></i></button>
        <button type="button" class="nb-x nb-ctdel" data-ctdel title="Прибрати">&times;</button>
    </div>`;
    const readCts = () => [...document.querySelectorAll("#nbCts .nb-ct")].map((el) => ({
        name: el.querySelector('[data-ct="name"]').value.trim(),
        phone: el.querySelector('[data-ct="phone"]').value.trim(),
    })).filter((k) => k.name || k.phone);
    function showCarrier(r, i, anchor) {
        const c = (r.carriers || [])[i];
        if (!c) return;
        POP = { r, i };
        const pop = $("#nbPop");
        pop.innerHTML = `
            <div class="nb-pop-head"><input class="nb-pin nb-pin-name" data-f="name" value="${esc(c.name || "")}" placeholder="Назва перевізника" /><button type="button" class="nb-x" data-pclose>&times;</button></div>
            <div class="nb-pop-req">${esc(r.addresses || "")}${r.cargo ? ` · ${esc(r.cargo)}` : ""}</div>
            <div class="nb-pop-grid">
                <span>ЄДРПОУ</span><span class="nb-pop-code"><input class="nb-pin" data-f="edrpou" value="${esc(c.edrpou || "")}" placeholder="—" />${c.edrpou ? `<button type="button" class="nb-code" data-copy="${esc(c.edrpou)}" title="Копіювати"><i class="bx bx-copy"></i></button>` : ""}</span>
                <span>Ціна</span><input class="nb-pin nb-price" data-f="price" value="${esc(cleanPrice(c.price))}" placeholder="напр. 2200 €" />
                <span>Додано</span><b>${esc(dt(c.added || r.created_at || r.updated_at))}</b>
                ${c.at ? `<span>Змінено</span><b>${esc(dt(c.at))}</b>` : ""}
            </div>
            ${(() => {
                const qu = queueOf(c);
                return qu.length ? `<div class="nb-pop-q"><b>🚦 Зараз у черзі на кордоні (${qu.length}):</b>${qu.slice(0, 6).map((x) => `<div>${esc(x.tractor || "")} · ${esc(x.checkpoint || "")}${x.entry_at ? ` · в'їзд ${esc(String(x.entry_at).slice(0, 16))}` : ""}</div>`).join("")}<a href="echerha.html?q=${encodeURIComponent(c.edrpou || c.name || "")}">Відкрити в Черзі →</a></div>` : "";
            })()}
            <div class="nb-pop-cts">
                <div class="nb-pop-cth"><b>Контакти</b>
                    <span>${c.id ? '<button type="button" class="nb-link" data-ctfura>з картки FURA</button>' : ""}<button type="button" class="nb-link" data-ctadd><i class="bx bx-plus"></i> контакт</button></span>
                </div>
                <div id="nbCts">${(c.contacts || []).map(ctRow).join("")}</div>
            </div>
            <textarea class="nb-pin nb-pop-note" data-f="note" rows="4" placeholder="Нотатка: коли може, контакт, умови…">${esc(c.note || "")}</textarea>
            <div class="nb-pop-foot">
                <button type="button" class="nb-btn nb-btn-danger" data-pdel title="Прибрати перевізника з цього запиту"><i class="bx bx-trash"></i></button>
                ${c.id ? `<a href="#" class="nb-btn nb-btn-ghost" data-carrier-card="${esc(c.id)}">Картка у FURA</a>` : c.edrpou ? `<a href="#" class="nb-btn nb-btn-ghost" data-carrier-code="${esc(c.edrpou)}">Знайти у FURA</a>` : ""}
                ${lardiOf(c) ? `<a href="${esc(lardiOf(c))}" target="_blank" rel="noopener" class="nb-btn nb-btn-ghost">Ларді ↗</a>` : ""}
                ${c.id && DEALS.get(String(c.id)) ? `<a href="deals.html?q=${encodeURIComponent(c.name || "")}" class="nb-btn nb-btn-ghost" title="Угоди з цим перевізником">Угоди: ${DEALS.get(String(c.id)).n}</a>` : ""}
                <span class="nb-pop-sp"></span>
                <button type="button" class="nb-btn" data-psave>Зберегти</button>
            </div>`;
        pop.classList.remove("hidden");
        const b = anchor.getBoundingClientRect();
        const w = Math.min(400, innerWidth - 24);
        pop.style.width = w + "px";
        pop.style.left = Math.max(12, Math.min(b.left, innerWidth - w - 12)) + "px";
        const h = pop.offsetHeight;
        pop.style.top = (b.bottom + h + 8 < innerHeight ? b.bottom + 6 : Math.max(12, Math.min(b.top - h - 6, innerHeight - h - 12))) + "px";
    }
    // зберегти зміни перевізника з віконця (або прибрати його)
    async function savePop(remove) {
        if (!POP) return;
        const { r, i } = POP;
        const old = r.carriers[i];
        const list = [...(r.carriers || [])];
        if (remove) {
            if (!confirm(`Прибрати «${old.name || "перевізника"}» з цього запиту?`)) return;
            list.splice(i, 1);
        } else {
            const v = {};
            document.querySelectorAll("#nbPop [data-f]").forEach((el) => (v[el.dataset.f] = el.value.trim()));
            v.edrpou = v.edrpou.replace(/\D/g, "");
            v.contacts = readCts();
            const sameCts = JSON.stringify(v.contacts) === JSON.stringify(old.contacts || []);
            if (sameCts && ["name", "edrpou", "price", "note"].every((k) => (v[k] || "") === (old[k] || ""))) { POP = null; $("#nbPop").classList.add("hidden"); return; }
            list[i] = { ...old, ...v, id: v.edrpou !== (old.edrpou || "") ? null : old.id, added: old.added || r.created_at, at: new Date().toISOString() };
            if (!list[i].id && v.edrpou) {
                const { data } = await sbClient.from("carriers").select("id").eq("edrpou", v.edrpou).limit(1);
                list[i].id = data?.[0]?.id || null;
            }
        }
        const { data, error } = await sbClient.from("my_requests").update({ carriers: list }).eq("id", r.id).select("*");
        if (error) { alert("Не вдалося зберегти: " + error.message); return; }
        const saved = { ...(data?.[0]?.id === r.id ? data[0] : r), carriers: list };
        saved._sortAt = r._sortAt || new Date(r.updated_at || r.created_at).getTime();
        ROWS = ROWS.map((x) => (x.id === r.id ? saved : x));
        POP = null;
        $("#nbPop").classList.add("hidden");
        render();
    }
    const hidePop = () => $("#nbPop").classList.add("hidden");

    /* ---------- підказки перевізників з FURA ---------- */
    let sugT = 0;
    async function suggest(input) {
        const box = input.parentElement.querySelector(".nb-sugg");
        const q = input.value.trim();
        input.closest(".nb-cedit").dataset.id = "";
        if (q.length < 2) { box.classList.add("hidden"); return; }
        const digits = q.replace(/\D/g, "");
        const safe = q.replace(/[,()*%]/g, " ");
        let req = sbClient.from("carriers").select("id, name, edrpou, region_ukr, city").limit(8);
        req = digits.length >= 5 && digits.length === q.replace(/\s/g, "").length ? req.ilike("edrpou", `${digits}%`) : req.ilike("name", `%${safe}%`);
        const { data } = await req;
        if (input.value.trim() !== q) return;
        if (!data?.length) { box.classList.add("hidden"); return; }
        box.innerHTML = data.map((c) => `<button type="button" data-id="${esc(c.id)}" data-name="${esc(c.name)}" data-code="${esc(c.edrpou || "")}"><b>${esc(c.name)}</b><span>${esc(c.edrpou || "")} · ${esc(c.city || c.region_ukr || "")}</span></button>`).join("");
        box.classList.remove("hidden");
    }

    /* ---------- імпорт CSV з Google-таблиці ---------- */
    function parseCsv(text) {
        const rows = [];
        let row = [], cell = "", q = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (q) {
                if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
            } else if (ch === '"') q = true;
            else if (ch === ",") { row.push(cell); cell = ""; }
            else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
            else if (ch !== "\r") cell += ch;
        }
        if (cell || row.length) { row.push(cell); rows.push(row); }
        return rows;
    }
    function carrierFromText(t) {
        t = String(t || "").trim();
        if (!t) return null;
        const code = (t.match(/\b(\d{10}|\d{8})\b/) || [])[1] || "";
        const price = (t.match(/(\d[\d\s]{2,6}(?:\s*-\s*\d[\d\s]{2,6})?\s*(?:€|євро|евро|eur|\$|грн))/i) || [])[1] || "";
        const name = t.split("\n")[0].replace(/\s+(Підприємець|Юридична особа)\s*$/i, "").trim();
        let note = t.split("\n").slice(1).join(" ")
            .replace(/(Код фірми|ЄДРПОУ|Країна|Область|Місто)\s*:/gi, " ").replace(/Юридична особа|Підприємець/gi, " ")
            .replace(code, " ").replace(price, " ").replace(/\s+/g, " ").trim();
        return { id: null, name: name.length > 120 ? name.slice(0, 120) : name, edrpou: code, price: cleanPrice(price.replace(/\s+/g, " ").trim()), note: note.slice(0, 300) };
    }
    async function importCsv(file) {
        const rows = parseCsv(await file.text());
        const hi = rows.findIndex((r) => r.some((c) => /напрямок/i.test(c)) && r.some((c) => /вантаж/i.test(c)));
        if (hi < 0) { alert("Не знайшов рядок із заголовками «Напрямок», «Вантаж». Завантажте аркуш «Запроси» як CSV."); return; }
        const H = rows[hi].map((c) => c.trim().toLowerCase());
        const col = (re) => H.findIndex((h) => re.test(h));
        const ix = { direction: col(/напрям/), addresses: col(/адрес/), cargo: col(/вантаж/), truck: col(/^авто/), comment: col(/комент/), status: col(/статус/) };
        const carrierCols = H.map((h, i) => (/перевізник/.test(h) ? i : -1)).filter((i) => i >= 0);
        const out = rows.slice(hi + 1).map((r) => {
            const o = {};
            Object.entries(ix).forEach(([k, i]) => (o[k] = i >= 0 ? (r[i] || "").trim() || null : null));
            o.carriers = carrierCols.map((i) => carrierFromText(r[i])).filter(Boolean);
            return o;
        }).filter((o) => o.addresses || o.cargo || o.carriers.length);
        if (!out.length) { alert("У файлі немає запитів."); return; }
        if (!confirm(`Імпортувати ${out.length} запитів у ваш блокнот?`)) return;
        // перевізників з ЄДРПОУ — прив'язуємо до карток FURA
        const codes = [...new Set(out.flatMap((o) => o.carriers.map((c) => c.edrpou)).filter(Boolean))];
        const byCode = new Map();
        for (let i = 0; i < codes.length; i += 300) {
            const { data } = await sbClient.from("carriers").select("id, edrpou").in("edrpou", codes.slice(i, i + 300));
            (data || []).forEach((c) => byCode.set(String(c.edrpou), c.id));
        }
        out.forEach((o) => o.carriers.forEach((c) => (c.id = byCode.get(c.edrpou) || null)));
        $("#nbCount").textContent = "Імпорт…";
        for (let i = 0; i < out.length; i += 300) {
            const { error } = await sbClient.from("my_requests").insert(out.slice(i, i + 300));
            if (error) { alert("Помилка імпорту: " + error.message); break; }
            $("#nbCount").textContent = `Імпорт… ${Math.min(i + 300, out.length)} з ${out.length}`;
        }
        await load();
    }

    /* ---------- події ---------- */
    function init() {
        restoreState();
        let sT = 0;
        $(".nb-scroll").addEventListener("scroll", () => { clearTimeout(sT); sT = setTimeout(saveState, 200); }, { passive: true });
        addEventListener("pagehide", () => { saveState(); cacheRows(); });
        let t = 0;
        $("#nbQ").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.shown = PAGE; render(); }, 150); });
        $("#nbStatus").addEventListener("click", (e) => {
            const b = e.target.closest("[data-st]");
            if (!b) return;
            const k = b.dataset.st;
            if (!k) st.status.clear();
            else if (st.status.has(k)) st.status.delete(k);
            else st.status.add(k);
            st.shown = PAGE;
            render();
        });
        $("#nbMore").addEventListener("click", () => { st.shown += PAGE; render(); });
        document.querySelectorAll(".nb-ms").forEach((el) => {
            el.addEventListener("click", (e) => {
                if (e.target.closest(".nb-ms-btn")) {
                    document.querySelectorAll(".nb-ms.open").forEach((o) => o !== el && o.classList.remove("open"));
                    el.classList.toggle("open");
                } else if (e.target.closest(".nb-ms-clear")) {
                    el._set.clear(); st.shown = PAGE; render();
                }
            });
            el.addEventListener("change", (e) => {
                const v = e.target.value;
                if (e.target.checked) el._set.add(v); else el._set.delete(v);
                st.shown = PAGE;
                render();
            });
        });
        document.addEventListener("mousedown", (e) => { if (!e.target.closest(".nb-ms")) document.querySelectorAll(".nb-ms.open").forEach((o) => o.classList.remove("open")); });
        document.querySelectorAll(".nb-ms").forEach((el) => el.addEventListener("input", (e) => {
            if (!e.target.classList.contains("nb-ms-find")) return;
            const q = norm(e.target.value);
            el.querySelectorAll("label[data-l]").forEach((l) => (l.hidden = q && !l.dataset.l.includes(q)));
        }));
        [["#nbPeriod", "period"], ["#nbSort", "sort"], ["#nbSide", "side"]].forEach(([sel, k]) =>
            $(sel).addEventListener("change", (e) => { st[k] = e.target.value; st.shown = PAGE; render(); }));
        $("#nbReset").addEventListener("click", () => {
            Object.assign(st, { q: "", period: "", sort: "upd", shown: PAGE });
            [st.status, st.dir, st.truck, st.has, st.region, st.city].forEach((x) => x.clear());
            st.side = "any";
            $("#nbSide").value = "any";
            ["#nbQ", "#nbPeriod"].forEach((s) => ($(s).value = ""));
            $("#nbSort").value = "upd";
            render();
        });
        $("#nbPop").addEventListener("click", async (e) => {
            if (e.target.closest("[data-pclose]")) { POP = null; return hidePop(); }
            if (e.target.closest("[data-psave]")) return savePop(false);
            if (e.target.closest("[data-pdel]")) return savePop(true);
            if (e.target.closest("[data-ctadd]")) {
                $("#nbCts").insertAdjacentHTML("beforeend", ctRow());
                [...document.querySelectorAll('#nbCts [data-ct="name"]')].pop().focus();
                return;
            }
            if (e.target.closest("[data-ctdel]")) { e.target.closest(".nb-ct").remove(); return; }
            const cc = e.target.closest("[data-ctcopy]");
            if (cc) {
                const ph = cc.closest(".nb-ct").querySelector('[data-ct="phone"]').value.trim();
                if (ph) { try { await navigator.clipboard.writeText(ph); cc.classList.add("copied"); setTimeout(() => cc.classList.remove("copied"), 900); } catch (_) { /* без буфера */ } }
                return;
            }
            if (e.target.closest("[data-ctfura]") && POP) {
                const c = POP.r.carriers[POP.i];
                const { data } = await sbClient.from("carriers").select("contact_person_1, phone_1, contact_person_2, phone_2, extra_contacts").eq("id", c.id).maybeSingle();
                if (!data) return;
                const have = new Set(readCts().map((k) => String(k.phone).replace(/\D/g, "")));
                const add = [[data.contact_person_1, data.phone_1], [data.contact_person_2, data.phone_2], ...(Array.isArray(data.extra_contacts) ? data.extra_contacts.map((x) => [x.name, x.phone]) : [])]
                    .flatMap(([n, ph]) => String(ph || "").split(/[,;]\s*/).filter(Boolean).map((one) => ({ name: n || "", phone: one.trim() })).concat(!ph && n ? [{ name: n, phone: "" }] : []))
                    .filter((k) => !have.has(String(k.phone).replace(/\D/g, "")) || !k.phone);
                if (!add.length) { e.target.closest("[data-ctfura]").textContent = "уже все є"; return; }
                $("#nbCts").insertAdjacentHTML("beforeend", add.map(ctRow).join(""));
                return;
            }
            const cp = e.target.closest("[data-copy]");
            if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); cp.classList.add("copied"); } catch (_) { /* без буфера */ } }
            if (e.target.closest("[data-carrier-card], [data-carrier-code]")) hidePop();
        });
        // клік поза віконцем — зберігаємо, якщо щось змінили
        document.addEventListener("mousedown", (e) => {
            if ($("#nbPop").classList.contains("hidden") || e.target.closest("#nbPop")) return;
            if (e.target.closest(".nb-carrier")) { savePop(false); return; }
            savePop(false);
        });
        $("#nbPop").addEventListener("keydown", (e) => {
            if (e.key === "Enter" && (e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey)) { e.preventDefault(); savePop(false); }
        });

        $("#nbAdd").addEventListener("click", () => open(null));
        $("#nbList").addEventListener("dblclick", (e) => {
            const m = e.target.closest("[data-edit]");
            if (m) open(ROWS.find((r) => r.id === m.closest(".nb-row").dataset.id));
        });
        $("#nbList").addEventListener("click", async (e) => {
            const cp = e.target.closest("[data-copy]");
            if (cp) {
                try { await navigator.clipboard.writeText(cp.dataset.copy); cp.classList.add("copied"); setTimeout(() => cp.classList.remove("copied"), 900); } catch (_) { /* без буфера */ }
                return;
            }
            const rid = e.target.closest(".nb-row")?.dataset.id;
            if (e.target.closest("[data-redit]")) { open(ROWS.find((r) => r.id === rid)); return; }
            if (e.target.closest("[data-rdel]")) {
                const r = ROWS.find((x) => x.id === rid);
                if (!r || !confirm(`Видалити запит «${r.addresses || r.cargo || ""}»?`)) return;
                const { error } = await sbClient.from("my_requests").delete().eq("id", rid);
                if (error) { alert(error.message); return; }
                ROWS = ROWS.filter((x) => x.id !== rid);
                render();
                return;
            }
            const ch = e.target.closest(".nb-carrier");
            if (ch && e.target.closest("a.nb-lardi")) return;
            if (ch) {
                const r = ROWS.find((x) => x.id === ch.closest(".nb-row").dataset.id);
                if (r) showCarrier(r, Number(ch.dataset.ci), ch);
                return;
            }
            const add = e.target.closest("[data-addc]");
            if (add) open(ROWS.find((r) => r.id === add.closest(".nb-row").dataset.id), true);
        });
        $("#nbForm").addEventListener("submit", save);
        $("#nbDelete").addEventListener("click", remove);
        $("#nbAddCarrier").addEventListener("click", () => $(".nb-cin", carrierEditor()).focus());
        $("#nbModal").addEventListener("click", (e) => {
            if (e.target.id === "nbModal" || e.target.closest("[data-close]")) close();
            const del = e.target.closest(".nb-cdel");
            if (del) del.closest(".nb-cedit").remove();
            const s = e.target.closest(".nb-sugg button");
            if (s) {
                const d = s.closest(".nb-cedit");
                d.dataset.id = s.dataset.id;
                $(".nb-cin", d).value = s.dataset.name;
                $(".nb-ccode", d).value = s.dataset.code;
                s.parentElement.classList.add("hidden");
                $(".nb-cprice", d).focus();
            }
        });
        $("#nbModal").addEventListener("input", (e) => {
            if (!e.target.classList.contains("nb-cin")) return;
            clearTimeout(sugT);
            sugT = setTimeout(() => suggest(e.target), 220);
        });
        $("#nbModal").addEventListener("focusout", (e) => {
            if (e.target.classList.contains("nb-cin")) setTimeout(() => e.target.parentElement.querySelector(".nb-sugg")?.classList.add("hidden"), 200);
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (!$("#nbPop").classList.contains("hidden")) { POP = null; hidePop(); }
            else if (!$("#nbModal").classList.contains("hidden")) close();
        });
        $("#nbImport").addEventListener("change", (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importCsv(f); });
        document.body.style.visibility = "visible";
        load();
    }
    return { init, load };
})();

document.addEventListener("DOMContentLoaded", NB.init);
