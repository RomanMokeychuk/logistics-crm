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
    // міста зі збігом із пошуком — першими й підсвічені
    function cityList(map, n, q) {
        const needle = String(q || "").toLowerCase();
        const items = [...map.entries()].sort((x, y) => {
            const mx = needle && x[0].toLowerCase().includes(needle), my = needle && y[0].toLowerCase().includes(needle);
            return my - mx || y[1] - x[1];
        });
        return items
            .slice(0, n)
            .map(([k, v]) => {
                const t = esc(v > 1 ? `${k} (${v})` : k);
                return needle && k.toLowerCase().includes(needle) ? `<mark class="cm-hit">${t}</mark>` : t;
            })
            .join(", ");
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

    /* ---------- Кілька країн ---------- */
    // у базі «ПОЛЬША» (так пише митниця) — показуємо по-українському, шукаємо за обома
    const C_NAMES = { "ПОЛЬША": "Польща", "ВЕЛИКОБРИТАНІЯ": "Велика Британія", "ОБ ЄДНАНІ АРАБСЬКІ ЕМІРАТИ": "ОАЕ (Об'єднані Арабські Емірати)", "В ЄТНАМ": "В'єтнам" };
    const cName = (x) => C_NAMES[x] || cap(x);
    // Випадний список із галочками й пошуком (країни, кордони)
    function multiSelect(boxId, btnId, nameOf, emptyText) {
        const sel = () => document.getElementById(boxId);
        const itemHtml = (x, alt) => `<label class="cm-ms-item" data-alt="${esc((alt || x).toLowerCase())}"><input type="checkbox" value="${esc(x)}" /> ${esc(nameOf(x))}</label>`;
        const html = (list, alt) => `<div class="cm-ms" id="${boxId}">
                <button type="button" class="cm-ms-btn" id="${btnId}">${emptyText}</button>
                <div class="cm-ms-pop" hidden>
                    <input type="text" class="cm-ms-q" placeholder="Пошук…" />
                    <div class="cm-ms-list">${list.map((x) => itemHtml(x, alt && alt(x))).join("")}</div>
                    <div class="cm-ms-foot"><button type="button" class="cm-more" data-ms="clear">Очистити</button><button type="button" class="btn btn-primary cm-ms-done" data-ms="done">Готово</button></div>
                </div>
            </div>`;
        const get = () => [...sel().querySelectorAll(".cm-ms-list input:checked")].map((i) => i.value);
        function label() {
            const list = get();
            const b = document.getElementById(btnId);
            b.textContent = !list.length ? emptyText : list.length <= 3 ? list.map(nameOf).join(", ") : `${list.slice(0, 2).map(nameOf).join(", ")} +${list.length - 2}`;
            b.classList.toggle("cm-ms-empty", !list.length);
            const box = sel().querySelector(".cm-ms-list");
            [...box.querySelectorAll("input:checked")].reverse().forEach((i) => box.prepend(i.closest("label")));
        }
        function set(list) {
            const want = new Set(list);
            const box = sel().querySelector(".cm-ms-list");
            list.filter((x) => x && ![...box.querySelectorAll("input")].some((i) => i.value === x)).forEach((x) => box.insertAdjacentHTML("afterbegin", itemHtml(x)));
            box.querySelectorAll("input").forEach((i) => (i.checked = want.has(i.value)));
            label();
        }
        function wire(onChange) {
            const wrap = sel();
            const pop = wrap.querySelector(".cm-ms-pop");
            const q = wrap.querySelector(".cm-ms-q");
            const close = () => {
                if (pop.hidden) return;
                pop.hidden = true;
                label();
                onChange && onChange();
            };
            document.getElementById(btnId).addEventListener("click", () => {
                if (!pop.hidden) return close();
                pop.hidden = false;
                q.value = "";
                q.dispatchEvent(new Event("input"));
                q.focus();
            });
            q.addEventListener("input", () => {
                const t = q.value.trim().toLowerCase();
                wrap.querySelectorAll(".cm-ms-item").forEach((l) => (l.hidden = t && !l.textContent.toLowerCase().includes(t) && !(l.dataset.alt || "").includes(t)));
            });
            q.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    const first = [...wrap.querySelectorAll(".cm-ms-item")].find((l) => !l.hidden);
                    if (first) first.querySelector("input").checked = true;
                    q.value = "";
                    q.dispatchEvent(new Event("input"));
                    label();
                }
                if (e.key === "Escape") close();
            });
            wrap.addEventListener("click", (e) => {
                const b = e.target.closest("[data-ms]");
                if (!b) return;
                if (b.dataset.ms === "clear") wrap.querySelectorAll(".cm-ms-list input").forEach((i) => (i.checked = false));
                if (b.dataset.ms === "done") close();
                else label();
            });
            wrap.querySelector(".cm-ms-list").addEventListener("change", () => {
                const n = get().length;
                document.getElementById(btnId).textContent = n ? `Обрано: ${n}` : emptyText;
            });
            document.addEventListener("click", (e) => {
                if (!pop.hidden && !wrap.contains(e.target)) close();
            });
        }
        return { html, get, set, wire };
    }

    const countriesMS = multiSelect("cmCountryBox", "cmCountryBtn", (x) => cName(x), "Оберіть країни…");
    const getCountries = () => countriesMS.get();
    const setCountries = (l) => countriesMS.set(l);

    // Пункти пропуску: у даних бувають «Порубне – Сірет» і старе «ПОРУБНЕ» — шукаємо за ключовим словом
    const BORDERS = ["Ягодин – Дорогуськ", "Краківець – Корчова", "Рава-Руська – Хребенне", "Шегині – Медика", "Устилуг – Зосин",
        "Угринів – Долгобичув", "Грушів – Будомєж", "Смільниця – Кросьценко", "Порубне – Сірет", "Дяківці – Раковець",
        "Красноїльськ – Вікову де Сус", "Мамалига – Крива", "Росошани – Бричень", "Чоп (Тиса) – Захонь", "Лужанка – Берегшурань",
        "Ужгород – Вишнє Нємецьке", "Малий Березний – Убля", "Дякове – Халмеу", "Могилів-Подільський – Отач", "Старокозаче – Тудора",
        "Рені – Джурджулешти", "Орлівка – Ісакча", "Виноградівка – Вулканешти", "Табаки – Мирне", "Серпневе 1 – Басарабяска",
        "Малоярославець 1 – Чадир-Лунга", "Нові Трояни – Чадир-Лунга", "Маяки-Удобне – Паланка", "Сокиряни – Окниця"];
    const BORDER_KEY_FIX = { "Малий": "Березний", "Нові": "Трояни", "Малі": "Селменці", "Серпневе": "Серпнев", "Малоярославець": "Малоярослав" };
    const borderKey = (b) => {
        const w = b.split(" – ")[0].replace(/\(.*?\)/g, "").trim().split(/[\s-]+/)[0];
        return BORDER_KEY_FIX[w] || w;
    };
    const oblName = (x) => (x.startsWith("М. ") ? "м. " + cap(x.slice(3)) : cap(x.replace(/\s*ОБЛ\.?$/, "")) + " обл.");
    const trailersMS = multiSelect("cmTrailerBox", "cmTrailerBtn", (x) => cap(x), "Будь-який");
    const getTrailers = () => trailersMS.get();
    const regionsMS = multiSelect("cmRegionBox", "cmRegionBtn", oblName, "Будь-яка");
    const getRegions = () => regionsMS.get();
    const bordersMS = multiSelect("cmBorderBox", "cmBorderBtn", (x) => x, "Будь-який");
    const getBorders = () => bordersMS.get();
    function setBorders(list) {
        // зі старого посилання могло прийти «Порубне» — підбираємо пункт зі списку
        bordersMS.set(list.map((x) => BORDERS.find((b) => b === x) || BORDERS.find((b) => b.toLowerCase().includes(x.toLowerCase())) || x));
    }

    // тип причепу з картки перевізника (якщо заповнений — він важливіший за митні дані)
    const cardTrailers = (c) =>
        String(c?.trailer_type || "")
            .split(/[;,]/)
            .map((x) => x.trim().toUpperCase())
            .filter(Boolean);
    // «Не підходить»: приховано вручну (з причиною і, можливо, до дати)
    const today = () => new Date().toISOString().slice(0, 10);
    const isHidden = (c) => !!(c && c.match_hidden_reason && (!c.match_hidden_until || String(c.match_hidden_until).slice(0, 10) >= today()));
    // Відгук після дзвінка: результат одним кліком + коментар; негативні — одразу пропонує сховати з підбору
    const OUTCOMES = [
        { v: "Є машина", ico: "✅" },
        { v: "Немає вільних машин", ico: "⏳" },
        { v: "Немає такого причепу", ico: "🚫", hide: true },
        { v: "Зараз не працює", ico: "🛑", hide: true },
        { v: "Передзвонити", ico: "🔁" },
        { v: "Не відповів", ico: "📵" },
        { v: "Дорого", ico: "💰" },
    ];
    const outcomeIco = (v) => (OUTCOMES.find((o) => o.v === v) || { ico: "📞" }).ico;
    function hideFormHtml(id) {
        return `<div class="cm-hide-form" data-id="${esc(id)}">
            <div class="cm-sub">Що відповів перевізник:</div>
            <div class="cm-fb-outcomes">${OUTCOMES.map((o) => `<button type="button" class="cm-fb-o" data-v="${esc(o.v)}" data-hide="${o.hide ? 1 : ""}">${o.ico} ${esc(o.v)}</button>`).join("")}</div>
            <input type="text" class="cm-hide-other cm-fb-comment" placeholder="Коментар (необов'язково): напр. «рефи будуть у грудні», «ставка 1800 €»" />
            <div class="cm-hide-period"><label><input type="checkbox" class="cm-fb-hide" /> Сховати з підбору</label>
                <select class="cm-hide-until"><option value="30">на місяць</option><option value="90">на 3 місяці</option><option value="">назавжди</option></select>
                <button type="button" class="btn btn-primary cm-hide-save" disabled>Зберегти відгук</button><button type="button" class="cm-more cm-hide-cancel">Скасувати</button></div>
        </div>`;
    }
    let meCache = null;
    async function me() {
        if (meCache) return meCache;
        try {
            const { data: { session } } = await client.auth.getSession();
            const email = (session?.user?.email || "").toLowerCase();
            const { data } = await client.from("staff").select("full_name").ilike("email", email).limit(1);
            meCache = { email, name: data?.[0]?.full_name || email.split("@")[0] };
        } catch (e) {
            meCache = { email: "", name: "" };
        }
        return meCache;
    }
    async function addFeedback(id, outcome, comment) {
        const c = (typeof allCarriersCache !== "undefined" ? allCarriersCache : []).find((x) => String(x.id) === String(id));
        const u = await me();
        const { error } = await client.from("carrier_feedback").insert({
            carrier_id: String(id), edrpou: c?.edrpou || null, outcome, comment: comment || null, author_email: u.email || null, author_name: u.name || null,
        });
        if (error) {
            alert(/carrier_feedback/.test(error.message || "")
                ? "У базі ще немає таблиці відгуків. Supabase → SQL Editor → виконайте carriers_feedback.sql і спробуйте ще раз."
                : "Не вдалося зберегти відгук: " + error.message);
            return false;
        }
        return true;
    }
    // останні відгуки для перевізників на сторінці
    async function fillFeedback(root) {
        const boxes = [...root.querySelectorAll("[data-fb-id]")];
        const ids = [...new Set(boxes.map((b) => b.dataset.fbId).filter(Boolean))];
        if (!ids.length) return;
        const { data, error } = await client.from("carrier_feedback").select("carrier_id, outcome, comment, author_name, created_at").in("carrier_id", ids).order("created_at", { ascending: false }).limit(1000);
        if (error || !data) return;
        const by = new Map();
        data.forEach((f) => (by.get(f.carrier_id) || by.set(f.carrier_id, []).get(f.carrier_id)).push(f));
        boxes.forEach((b) => {
            const list = by.get(b.dataset.fbId);
            if (!list) return;
            const f = list[0];
            b.innerHTML = `<span class="cm-fb-last" title="${esc(list.map((x) => `${fmtDate(x.created_at)} ${x.outcome}${x.comment ? " — " + x.comment : ""}${x.author_name ? " (" + x.author_name + ")" : ""}`).join("\n"))}">📞 ${fmtDate(f.created_at)} · ${outcomeIco(f.outcome)} <b>${esc(f.outcome)}</b>${f.comment ? ` — ${esc(f.comment)}` : ""}${f.author_name ? ` <span class="cm-sub">(${esc(f.author_name)})</span>` : ""}${list.length > 1 ? ` <span class="cm-sub">· ще ${list.length - 1}</span>` : ""}</span>`;
        });
    }
    function feedbackListHtml(list) {
        if (!list.length) return `<div class="ch-empty">Ще ніхто не залишав відгуків після дзвінків.</div>`;
        return `<div class="cm-fb-list">${list
            .map((f) => `<div class="cm-fb-item"><span class="cm-sub">${fmtDate(f.created_at)}</span> ${outcomeIco(f.outcome)} <b>${esc(f.outcome)}</b>${f.comment ? ` — ${esc(f.comment)}` : ""}${f.author_name ? ` <span class="cm-sub">· ${esc(f.author_name)}</span>` : ""}</div>`)
            .join("")}</div>`;
    }
    async function setHidden(id, reason, until) {
        const c = (typeof allCarriersCache !== "undefined" ? allCarriersCache : []).find((x) => String(x.id) === String(id));
        const patch = reason
            ? { match_hidden_reason: reason, match_hidden_until: until || null, match_hidden_at: new Date().toISOString() }
            : { match_hidden_reason: null, match_hidden_until: null, match_hidden_at: null };
        const { data, error } = await client.from("carriers").update(patch).eq("id", id).select("id");
        if (error || !data || !data.length) {
            alert(error && /match_hidden/.test(error.message || "")
                ? "У базі ще немає полів для «Не підходить». Supabase → SQL Editor → виконайте carriers_match_hidden.sql і спробуйте ще раз."
                : "Не вдалося зберегти: " + (error?.message || "немає прав змінювати цього перевізника"));
            return false;
        }
        if (c) Object.assign(c, patch);
        return true;
    }

    // перевізник, з яким працювали останнім (картка/редагування) — у адресі ?last=<id>
    const currentPage = () => Number(new URLSearchParams(location.search).get("page")) || 1;
    const lastId = () => new URLSearchParams(location.search).get("last") || "";

    /* ---------- Стан підбору в адресі сторінки (оновлення сторінки його не скидає) ---------- */
    const STATE_KEYS = ["match", "dir", "country", "region", "trailer", "border", "city", "page"];
    function saveState(page) {
        const p = new URLSearchParams(location.search);
        STATE_KEYS.forEach((k) => p.delete(k));
        const panel = document.getElementById("cmPanel");
        if (panel && !panel.hidden) {
            p.set("match", "1");
            p.set("dir", document.getElementById("cmDir").value);
            const val = (k, v) => v && p.set(k, v);
            val("country", getCountries().join("|"));
            val("region", getRegions().join("|"));
            val("trailer", getTrailers().join("|"));
            val("border", getBorders().join("|"));
            val("city", document.getElementById("cmCity").value.trim());
            if (page > 1) p.set("page", String(page));
        }
        const qs = p.toString();
        history.replaceState(history.state, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
        // Запам'ятовуємо підбір і в браузері: перейшли в «Запити» через меню й повернулись — усе на місці.
        // Закрили панель (×) — забуваємо.
        try {
            const keep = new URLSearchParams();
            STATE_KEYS.forEach((k) => p.has(k) && keep.set(k, p.get(k)));
            if (keep.get("match") === "1") localStorage.setItem(MATCH_STORE, keep.toString());
            else localStorage.removeItem(MATCH_STORE);
        } catch (e) { /* без збереження */ }
    }
    const MATCH_STORE = "fura_carrier_match";

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
                <label><span>Країни <i>*</i></span>
                    ${countriesMS.html(COUNTRIES, (x) => x)}
                </label>
                <label>Область України
                    ${regionsMS.html(OBLASTS, (x) => x)}
                </label>
                <label>Тип причепу
                    ${trailersMS.html(TRAILERS.concat(["ЛІСОВОЗ", "КОНТЕЙНЕРОВОЗ"]), (x) => x)}
                </label>
                <label>Кордон
                    ${bordersMS.html(BORDERS, (x) => x + " " + borderKey(x))}
                </label>
                <label>Місто
                    <input type="text" id="cmCity" placeholder="напр. Бухарест, Lublin, Вінниця" title="Місто за кордоном або в Україні (як у деклараціях — кирилицею чи латиницею)" />
                </label>
                <button type="submit" class="btn btn-primary">Знайти</button>
            </form>
            <div class="cm-results" id="cmResults"></div>`;
        bar.insertAdjacentElement("afterend", panel);

        btn.addEventListener("click", () => {
            panel.hidden = !panel.hidden;
            if (!panel.hidden && !getCountries().length) document.getElementById("cmCountryBtn").click();
            saveState();
        });
        panel.querySelector(".cm-close").addEventListener("click", () => {
            panel.hidden = true;
            saveState();
        });
        countriesMS.wire(() => saveState());
        bordersMS.wire(() => saveState());
        regionsMS.wire(() => saveState());
        trailersMS.wire(() => saveState());
        document.getElementById("cmForm").addEventListener("change", () => saveState());
        document.getElementById("cmCity").addEventListener("input", () => saveState());
        document.getElementById("cmForm").addEventListener("submit", (e) => {
            e.preventDefault();
            search.showHidden = false;
            search();
        });
        document.getElementById("cmResults").addEventListener("click", async (e) => {
            const tgl = e.target.closest("[data-cm-hidden-toggle]");
            if (tgl) {
                search.showHidden = !search.showHidden;
                search();
                return;
            }
            const hideBtn = e.target.closest("[data-cm-hide]");
            if (hideBtn) {
                const box = hideBtn.closest(".cm-main").querySelector(".cm-hide-box");
                box.hidden = !box.hidden;
                if (!box.hidden) box.innerHTML = hideFormHtml(hideBtn.dataset.cmHide);
                return;
            }
            const ob = e.target.closest(".cm-fb-o");
            if (ob) {
                const f = ob.closest(".cm-hide-form");
                f.querySelectorAll(".cm-fb-o").forEach((x) => x.classList.toggle("on", x === ob));
                f.querySelector(".cm-fb-hide").checked = !!ob.dataset.hide;
                f.querySelector(".cm-hide-save").disabled = false;
                return;
            }
            if (e.target.closest(".cm-hide-cancel")) {
                e.target.closest(".cm-hide-box").hidden = true;
                return;
            }
            const save = e.target.closest(".cm-hide-save");
            if (save) {
                const f = save.closest(".cm-hide-form");
                const outcome = f.querySelector(".cm-fb-o.on")?.dataset.v;
                if (!outcome) return;
                const comment = f.querySelector(".cm-fb-comment").value.trim();
                const days = f.querySelector(".cm-hide-until").value;
                const until = days ? new Date(Date.now() + Number(days) * 864e5).toISOString().slice(0, 10) : null;
                save.disabled = true;
                let ok = await addFeedback(f.dataset.id, outcome, comment);
                if (ok && f.querySelector(".cm-fb-hide").checked) ok = await setHidden(f.dataset.id, outcome + (comment ? " — " + comment : ""), until);
                if (ok) {
                    search.restorePage = currentPage();
                    search();
                } else save.disabled = false;
                return;
            }
            const unhide = e.target.closest("[data-cm-unhide]");
            if (unhide) {
                unhide.disabled = true;
                if (await setHidden(unhide.dataset.cmUnhide, null, null)) {
                    search.restorePage = currentPage();
                    search();
                } else unhide.disabled = false;
                return;
            }
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
        const countries = getCountries();
        const regions = getRegions();
        const trailers = getTrailers();
        const borders = getBorders();
        const city = document.getElementById("cmCity").value.trim().replace(/[,()%*"\\]/g, " ").replace(/\s+/g, " ");
        const out = document.getElementById("cmResults");
        if (!countries.length) {
            out.innerHTML = `<div class="cm-empty">Оберіть хоча б одну країну.</div>`;
            return;
        }
        const startPage = search.restorePage || 1;
        search.restorePage = 0;
        saveState(startPage);
        out.innerHTML = `<div class="cm-empty">Шукаю…</div>`;

        // Supabase віддає максимум 1000 рядків за запит — тягнемо всі сторінки
        const query = async (cols) => {
            const withCities = cols.includes("cities");
            const PAGE = 1000;
            const rows = [];
            for (let from = 0; from < 50000; from += PAGE) {
                let q = client.from("carrier_routes").select(cols).in("country", countries);
                if (dir) q = q.eq("direction", dir);
                if (regions.length) q = q.in("ua_region", regions);
                // причіп, кордон і місто — кожне «будь-що з …»; кілька разом — одним фільтром and(…)
                const orT = ""; // причіп фільтруємо після запиту: тип із картки перевізника важливіший за митні дані
                const orB = borders.length ? borders.map((b) => `border.ilike."*${borderKey(b)}*"` + (withCities ? `,borders.ilike."*${borderKey(b)}*"` : "")).join(",") : "";
                const orC = city && withCities ? `cities.ilike."*${city}*",ua_cities.ilike."*${city}*"` : "";
                const ors = [orT, orB, orC].filter(Boolean);
                if (ors.length === 1) q = q.or(ors[0]);
                else if (ors.length > 1) q = q.or(`and(${ors.map((o) => `or(${o})`).join(",")})`);
                const { data, error } = await q.order("id", { ascending: true }).range(from, from + PAGE - 1);
                if (error) return { data: null, error };
                rows.push(...(data || []));
                if (!data || data.length < PAGE) break;
            }
            return { data: rows, error: null };
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
            (a.countries || (a.countries = new Map())).set(r.country, (a.countries.get(r.country) || 0) + (r.records || 0));
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
            .sort((x, y) => y.score - x.score)
            .filter((a) => {
                if (!trailers.length) return true;
                const own = cardTrailers(a.c);
                const have = own.length ? own : [...a.trailers];
                return trailers.some((t) => have.some((x) => x.includes(t)));
            });
        // «Не підходить» (приховані вручну) — окремо
        const hiddenList = list.filter((a) => isHidden(a.c));
        const visibleList = list.filter((a) => !isHidden(a.c));
        if (search.showHidden && !hiddenList.length) search.showHidden = false; // прихованих більше немає — назад до підбору
        list.length = 0;
        list.push(...(search.showHidden ? hiddenList : visibleList));

        if (!list.length && !hiddenList.length) {
            out.innerHTML = `<div class="cm-empty">За цими умовами в митних даних нікого немає. Приберіть область, причіп, кордон або місто${city ? " (місто може бути записане інакше — спробуйте латиницею/кирилицею або частину назви, напр. «Bucur»)" : ""}.</div>`;
            return;
        }

        const PAGE = 60;
        const rowHtml = (a, i) => {
                    const c = a.c;
                    const regions = [...a.regions.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([r]) => cap(r.replace(" ОБЛ.", "")) + " обл.");
                    const borderTop = [...a.borders.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
                    const phone = c?.phone_1 ? String(c.phone_1).split(/[,;]/)[0].trim() : "";
                    const digits = phone.replace(/\D/g, "");
                    return `<div class="cm-row${c && String(c.id) === lastId() ? " cm-row-last" : ""}" data-cid="${esc(c?.id || "")}">
                        <div class="cm-rank">${i + 1}</div>
                        <div class="cm-main">
                            <div class="cm-name">${c ? `<a href="#" data-cm-open="${esc(c.id)}">${esc(c.name || c.company || "—")}</a>` : `<span class="cm-unknown">Немає в реєстрі</span>`}
                                <code>${esc(a.code)}</code>
                                ${a.active ? `<span class="cm-tag cm-active">активний</span>` : ""}
                                ${a.ds.count ? `<span class="cm-tag cm-ours">з нами: ${a.ds.count} рейс.${a.ds.last ? ` · ${fmtDate(a.ds.last)}` : ""}</span>` : ""}
                                ${c?.rating ? `<span class="cm-stars">${"★".repeat(c.rating)}</span>` : ""}
                                ${c?.profile_url ? `<a class="cm-lardi" href="${esc(c.profile_url)}" target="_blank" rel="noopener" title="${esc(c.profile_url)}">✓ ${/lardi/i.test(c.profile_url) ? "Lardi" : "Профіль"} ↗</a>` : ""}
                            </div>
                            <div class="cm-facts">
                                <span>🚛 <b>${a.trucks}</b> маш.</span>
                                <span>📄 ${a.records} відпр.</span>
                                <span>📅 ${[...a.months].sort().map(monthName).join(", ")}</span>
                                ${countries.length > 1 ? `<span>🌍 ${esc([...a.countries.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => cName(k)).join(", "))}</span>` : ""}
                                ${[...a.dirs].length > 1 || !document.getElementById("cmDir").value ? `<span>${[...a.dirs].join(" + ")}</span>` : ""}
                                ${regions.length ? `<span>📍 ${esc(regions.join(", "))}</span>` : ""}
                                ${borderTop ? `<span>🛂 ${esc(borderTop)}</span>` : ""}
                            </div>
                            ${a.cities.size ? `<div class="cm-facts cm-cities"><span>🏁 ${[...a.dirs].length === 1 ? ([...a.dirs][0] === "Імпорт" ? "Звідки (місто)" : "Куди (місто)") : "Міста"}: <b>${cityList(a.cities, 6, city)}</b></span></div>` : `<div class="cm-facts cm-light"><span>🏁 Місто ${[...a.dirs][0] === "Імпорт" ? "відправлення" : "призначення"} в деклараціях не вказане</span></div>`}
                            ${a.uaCities.size ? `<div class="cm-facts cm-light"><span>🇺🇦 ${[...a.dirs].length === 1 ? ([...a.dirs][0] === "Імпорт" ? "Куди в Україні" : "Звідки в Україні") : "В Україні"}: ${cityList(a.uaCities, 5, city)}</span></div>` : ""}
                            <div class="cm-facts cm-light">
                                ${(cardTrailers(c).length ? cardTrailers(c) : [...a.trailers]).slice(0, 4).map((t) => `<span class="cm-trailer"${cardTrailers(c).length ? ' title="з картки перевізника"' : ' title="за митними даними (за товаром)"'}>${esc(t)}</span>`).join("")}
                                ${a.goods.size ? `<span>везли: ${esc([...a.goods].slice(0, 3).join("; "))}</span>` : ""}
                            </div>
                            ${c?.notes ? `<div class="cm-facts cm-note" title="${esc(c.notes)}">📝 ${esc(String(c.notes).replace(/\s+/g, " ").slice(0, 160))}${String(c.notes).length > 160 ? "…" : ""}</div>` : ""}
                            ${c ? `<div class="cm-facts cm-fb" data-fb-id="${esc(c.id)}"></div>` : ""}
                            ${isHidden(c) ? `<div class="cm-facts"><span class="cm-hidden-tag">🚫 ${esc(c.match_hidden_reason)}${c.match_hidden_until ? ` · до ${fmtDate(c.match_hidden_until)}` : " · назавжди"}</span></div>` : ""}
                            <div class="cm-row-actions">
                            <button type="button" class="cm-more" data-cm-details="${esc(a.code)}" data-cm-name="${esc(c ? c.name || c.company || "" : "")}" data-cm-id="${esc(c?.id || "")}" data-cm-phone="${esc(phone)}" data-cm-person="${esc(c?.contact_person_1 || "")}" data-cm-url="${esc(c?.profile_url || "")}">🔎 Деталі: усі напрямки, міста, номери</button>
                            ${c ? (isHidden(c) ? `<button type="button" class="cm-more cm-hide" data-cm-hide="${esc(c.id)}">📞 Відгук</button><button type="button" class="cm-more cm-unhide" data-cm-unhide="${esc(c.id)}">↩ Повернути в підбір</button>` : `<button type="button" class="cm-more cm-hide" data-cm-hide="${esc(c.id)}">📞 Відгук після дзвінка</button>`) : ""}
                            </div>
                            <div class="cm-hide-box" hidden></div>
                        </div>
                        <div class="cm-contact">
                            ${c?.contact_person_1 ? `<div class="cm-person">${esc(c.contact_person_1)}</div>` : ""}
                            ${phone ? `<a href="tel:+${digits}">${esc(phone)}</a> <a class="viber-link" href="viber://chat?number=%2B${digits}" title="Viber"><i class="bx bxs-message-rounded-dots"></i></a>` : `<span class="cm-sub">телефону немає</span>`}
                        </div>
                    </div>`;
                };
        const SORTS = {
            best: { label: "Найкращі", fn: (x, y) => y.score - x.score },
            trucks: { label: "Більше машин", fn: (x, y) => y.trucks - x.trucks || y.records - x.records },
            records: { label: "Більше рейсів", fn: (x, y) => y.records - x.records || y.trucks - x.trucks },
        };
        let sortKey = (() => { try { return localStorage.getItem("cmSort") || "best"; } catch (e) { return "best"; } })();
        if (!SORTS[sortKey]) sortKey = "best";
        const pages = Math.max(1, Math.ceil(list.length / PAGE));
        out.innerHTML = `<div class="cm-topbar"><div class="cm-count"></div>
                ${hiddenList.length || search.showHidden ? `<button type="button" class="cm-more cm-hidden-toggle" data-cm-hidden-toggle="1">${search.showHidden ? `← До підбору (${visibleList.length})` : `🚫 Приховані: ${hiddenList.length}`}</button>` : ""}
                <label class="cm-sort">Сортувати: <select>${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${k === sortKey ? " selected" : ""}>${v.label}</option>`).join("")}</select></label></div>
            <div class="cm-list-rows"></div><div class="cm-pager"></div>`;
        const rowsBox = out.querySelector(".cm-list-rows");
        const pager = out.querySelector(".cm-pager");
        // номери сторінок: 1 … 4 5 [6] 7 8 … 28
        const pageNums = (cur) => {
            const set = new Set([1, pages, cur - 2, cur - 1, cur, cur + 1, cur + 2].filter((n) => n >= 1 && n <= pages));
            const arr = [...set].sort((a, b) => a - b);
            const res = [];
            arr.forEach((n, k) => {
                if (k && n - arr[k - 1] > 1) res.push("…");
                res.push(n);
            });
            return res;
        };
        const showPage = (n, scroll) => {
            const cur = Math.min(Math.max(1, n), pages);
            const from = (cur - 1) * PAGE;
            rowsBox.innerHTML = list.slice(from, from + PAGE).map((a, k) => rowHtml(a, from + k)).join("");
            out.querySelector(".cm-count").textContent = (search.showHidden ? "Приховані вручну («Не підходить»): " : "") +
                `Знайдено ${list.length} перевізників${pages > 1 ? ` · ${from + 1}–${Math.min(from + PAGE, list.length)}` : ""}. ` +
                (city ? `Місто: «${city}». ` : "") +
                (sortKey === "best" ? "Спершу — хто частіше їздив, працював з нами і має телефон." : `Сортування: ${SORTS[sortKey].label.toLowerCase()}.`);
            pager.hidden = pages <= 1;
            pager.innerHTML =
                `<button type="button" class="cm-pg" data-cm-pg="${cur - 1}" ${cur === 1 ? "disabled" : ""} title="Попередня">‹</button>` +
                pageNums(cur).map((p) => (p === "…" ? `<span class="cm-pg-gap">…</span>` : `<button type="button" class="cm-pg${p === cur ? " cm-pg-on" : ""}" data-cm-pg="${p}">${p}</button>`)).join("") +
                `<button type="button" class="cm-pg" data-cm-pg="${cur + 1}" ${cur === pages ? "disabled" : ""} title="Наступна">›</button>`;
            if (scroll) out.scrollTop = 0;
            saveState(cur);
            fillFeedback(rowsBox);
        };
        pager.addEventListener("click", (e) => {
            const b = e.target.closest("[data-cm-pg]");
            if (b && !b.disabled) showPage(Number(b.dataset.cmPg), true);
        });
        out.querySelector(".cm-sort select").addEventListener("change", (e) => {
            sortKey = e.target.value;
            try { localStorage.setItem("cmSort", sortKey); } catch (err) { /* без збереження */ }
            list.sort(SORTS[sortKey].fn);
            showPage(1, true);
        });
        list.sort(SORTS[sortKey].fn);
        // після оновлення — сторінка, на якій перевізник, з яким працювали (навіть якщо він «переїхав»)
        let pageToShow = startPage;
        if (search.scrollToLast && lastId()) {
            const idx = list.findIndex((a) => a.c && String(a.c.id) === lastId());
            if (idx >= 0) pageToShow = Math.floor(idx / PAGE) + 1;
        }
        showPage(pageToShow, false);
        // після оновлення сторінки — прокрутити до перевізника, з яким працювали
        const last = out.querySelector(".cm-row-last");
        if (last && search.scrollToLast) requestAnimationFrame(() => last.scrollIntoView({ block: "center" }));
        search.scrollToLast = false;
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
        const focus = new Set([].concat(focusCountry || []));
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
        const rows = [...by.values()].sort((x, y) => focus.has(y.country) - focus.has(x.country) || y.records - x.records);
        return `<div class="cm-dtools"><span class="cm-sub">Напрямків: ${rows.length} · натисніть на напрямок, щоб розгорнути</span>
                <button type="button" class="cm-more" data-cm-all="1">Розгорнути всі</button><button type="button" class="cm-more" data-cm-all="0">Згорнути всі</button></div>
            <div class="cm-dcards">${rows
            .map(
                (a) => `<details class="cm-dcard${focus.has(a.country) ? " cm-focus" : ""}">
                    <summary class="cm-dhead"><span class="cm-dir ${a.dir === "Імпорт" ? "imp" : "exp"}">${a.dir === "Імпорт" ? "→ UA" : "UA →"}</span>
                        <b>${esc(cName(a.country))}</b>
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
                ${d.cmUrl ? `<a class="cm-lardi" href="${esc(d.cmUrl)}" target="_blank" rel="noopener">✓ ${/lardi/i.test(d.cmUrl) ? "Lardi" : "Профіль"} ↗</a>` : ""}
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
        body.innerHTML = (data || []).length ? routesHtml(data, getCountries()) : `<div class="cm-empty">Немає даних.</div>`;
    }

    /* ---------- Блок у картці перевізника ---------- */
    let seq = 0;
    async function renderCard(item) {
        const body = document.getElementById("carrierCardBody");
        if (!body || !item) return;
        const my = ++seq;
        body.querySelector("#carrierRoutesBox")?.remove();
        body.querySelector("#carrierFleetBox")?.remove();
        body.querySelector("#carrierFeedbackBox")?.remove();
        const fbBox = document.createElement("div");
        fbBox.id = "carrierFeedbackBox";
        fbBox.className = "ch cm-card";
        fbBox.innerHTML = `<div class="ch-title">📞 Відгуки після дзвінків</div><div class="ch-body"><div class="ch-empty">Завантаження…</div></div>`;
        const fleet = document.createElement("div");
        fleet.id = "carrierFleetBox";
        fleet.className = "ch cm-card";
        fleet.innerHTML = `<div class="ch-title">🚛 Тягачі (митні дані)</div><div class="ch-body"><div class="ch-empty">Завантаження…</div></div>`;
        const box = document.createElement("div");
        box.id = "carrierRoutesBox";
        box.className = "ch cm-card";
        box.innerHTML = `<div class="ch-title">🧭 Напрямки за митними даними</div><div class="ch-body"><div class="ch-empty">Завантаження…</div></div>`;
        const hist = body.querySelector("#carrierHistory");
        if (hist) {
            hist.insertAdjacentElement("beforebegin", fbBox);
            hist.insertAdjacentElement("beforebegin", fleet);
            hist.insertAdjacentElement("beforebegin", box);
        } else {
            body.appendChild(fbBox);
            body.appendChild(fleet);
            body.appendChild(box);
        }
        applyCollapsed(body);

        if (item.id != null) {
            client.from("carrier_feedback").select("outcome, comment, author_name, created_at").eq("carrier_id", String(item.id)).order("created_at", { ascending: false }).limit(100)
                .then(({ data: fb, error: fe }) => {
                    if (my !== seq) return;
                    fbBox.querySelector(".ch-body").innerHTML = fe ? `<div class="ch-empty">Відгуки ще не підключені (carriers_feedback.sql).</div>` : feedbackListHtml(fb || []);
                });
        }
        if (!item.edrpou) {
            box.querySelector(".ch-body").innerHTML = `<div class="ch-empty">Немає ЄДРПОУ — митних даних не знайти.</div>`;
            fleet.querySelector(".ch-body").innerHTML = `<div class="ch-empty">—</div>`;
            return;
        }
        const { data, error } = await loadRoutes(item.edrpou);
        if (my !== seq) return;
        const out = box.querySelector(".ch-body");
        const fout = fleet.querySelector(".ch-body");
        if (error) {
            out.innerHTML = `<div class="ch-empty">Митні напрямки ще не завантажені (carrier_routes.sql + CSV).</div>`;
            fout.innerHTML = `<div class="ch-empty">—</div>`;
            return;
        }
        if (!(data || []).length) {
            out.innerHTML = `<div class="ch-empty">У митних даних цього перевізника немає.</div>`;
            fout.innerHTML = `<div class="ch-empty">У митних даних тягачів цього перевізника немає.</div>`;
            return;
        }
        out.innerHTML = routesHtml(data, "");
        fout.innerHTML = fleetHtml(data);
    }

    /* ---------- Тягачі перевізника: скільки й які, по місяцях ---------- */
    function fleetHtml(data) {
        const plates = new Map(); // номер -> {months:Set, countries:Map, dirs:Set}
        const byMonth = new Map(); // місяць -> Set(номерів)
        for (const r of data) {
            String(r.plates || "")
                .split(/[,;]\s*/)
                .map((x) => x.trim().toUpperCase())
                .filter(Boolean)
                .forEach((pl) => {
                    const a = plates.get(pl) || { months: new Set(), countries: new Map(), dirs: new Set() };
                    a.months.add(r.month);
                    a.dirs.add(r.direction);
                    a.countries.set(r.country, (a.countries.get(r.country) || 0) + 1);
                    plates.set(pl, a);
                    (byMonth.get(r.month) || byMonth.set(r.month, new Set()).get(r.month)).add(pl);
                });
        }
        if (!plates.size) return `<div class="ch-empty">Номерів тягачів у митних даних немає.</div>`;
        const months = [...byMonth.keys()].sort().reverse();
        const list = [...plates.entries()].sort((x, y) => y[1].months.size - x[1].months.size || x[0].localeCompare(y[0]));
        return `<div class="cm-fleet-sum">
                <div class="cm-fleet-total"><b>${plates.size}</b><span>тягачів усього</span></div>
                ${months.map((m) => `<div class="cm-fleet-m"><b>${byMonth.get(m).size}</b><span>${monthName(m)}</span></div>`).join("")}
            </div>
            <input type="text" class="cm-fleet-q" placeholder="Знайти номер…" />
            <div class="cm-fleet-list">${list
                .map(
                    ([pl, a]) => `<div class="cm-fleet-row" data-plate="${esc(pl)}">
                        <code>${esc(pl)}</code>
                        <span class="cm-sub">${[...a.months].sort().reverse().map(monthName).join(", ")}</span>
                        <span class="cm-sub">${esc([...a.countries.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => cName(k)).join(", "))}</span>
                    </div>`,
                )
                .join("")}</div>`;
    }
    document.addEventListener("input", (e) => {
        if (!e.target.matches(".cm-fleet-q")) return;
        const t = e.target.value.trim().toUpperCase().replace(/[\s\-]/g, "");
        e.target.nextElementSibling.querySelectorAll(".cm-fleet-row").forEach((r) => (r.hidden = t && !r.dataset.plate.includes(t)));
    });

    /* ---------- Розділи картки перевізника згортаються кліком по заголовку (стан пам'ятається) ---------- */
    const COLL_KEY = "furaCardCollapsed";
    const collSaved = () => {
        try { return JSON.parse(localStorage.getItem(COLL_KEY) || "{}"); } catch (e) { return {}; }
    };
    const secKey = (title) => title.textContent.replace(/\s+/g, " ").trim().slice(0, 40);
    function applyCollapsed(root) {
        const saved = collSaved();
        root.querySelectorAll(".card-section-title, .ch-title").forEach((t) => {
            const sec = t.parentElement;
            sec.classList.add("cm-coll");
            sec.classList.toggle("cm-collapsed", !!saved[secKey(t)]);
        });
    }
    document.addEventListener("click", (e) => {
        const t = e.target.closest("#carrierCardBody .card-section-title, #carrierCardBody .ch-title");
        if (!t) return;
        const sec = t.parentElement;
        sec.classList.add("cm-coll");
        const now = sec.classList.toggle("cm-collapsed");
        const saved = collSaved();
        if (now) saved[secKey(t)] = 1;
        else delete saved[secKey(t)];
        try { localStorage.setItem(COLL_KEY, JSON.stringify(saved)); } catch (err) { /* без збереження */ }
    });
    // картка перемальовується повністю при кожному відкритті — застосовуємо збережений стан
    function watchCard() {
        const body = document.getElementById("carrierCardBody");
        if (!body) return;
        new MutationObserver(() => applyCollapsed(body)).observe(body, { childList: true });
    }

    window.furaCarrierRoutes = { renderCard, search };

    function init() {
        buildPanel();
        watchCard();
        const p = new URLSearchParams(location.search);
        // Адреса без підбору (перейшли з меню) — відновлюємо останній підбір із браузера
        if (p.get("match") !== "1" && !p.has("cpop")) {
            try {
                const saved = new URLSearchParams(localStorage.getItem(MATCH_STORE) || "");
                if (saved.get("match") === "1") {
                    saved.forEach((v, k) => p.set(k, v));
                    history.replaceState(history.state, "", location.pathname + "?" + p.toString() + location.hash);
                }
            } catch (e) { /* без збереження */ }
        }
        if (p.get("match") === "1") {
            document.getElementById("cmPanel").hidden = false;
            const set = (id, v) => {
                const el = document.getElementById(id);
                if (!el || !v) return;
                if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === v)) el.insertAdjacentHTML("beforeend", `<option value="${esc(v)}">${esc(cap(v))}</option>`);
                el.value = v;
            };
            set("cmDir", p.get("dir") ?? "Імпорт");
            setCountries((p.get("country") || "").toUpperCase().split("|").filter(Boolean));
            setBorders((p.get("border") || "").split("|").filter(Boolean));
            regionsMS.set((p.get("region") || "").toUpperCase().split("|").filter(Boolean));
            trailersMS.set((p.get("trailer") || "").toUpperCase().split("|").filter(Boolean));
            set("cmCity", p.get("city") || "");
            // Чекаємо, поки завантажиться реєстр (щоб знати телефони й назви)
            let tries = 0;
            const t = setInterval(() => {
                if ((typeof allCarriersCache !== "undefined" && allCarriersCache.length) || ++tries > 40) {
                    clearInterval(t);
                    search.restorePage = Number(p.get("page")) || 1;
                    search.scrollToLast = true;
                    if (getCountries().length) search();
                }
            }, 250);
        }
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
