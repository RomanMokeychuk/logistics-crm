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
    const st = { q: "", status: "", dir: "", truck: "", has: "", period: "", sort: "upd", shown: PAGE };
    const dt = (v) => (v ? new Date(v).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
    const keyC = (c) => [c.id || "", c.name || "", c.edrpou || ""].join("|");
    let editing = null;

    /* ---------- завантаження ---------- */
    async function load() {
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
        ROWS = all;
        render();
    }

    /* ---------- список ---------- */
    function hay(r) {
        if (!r._hay) r._hay = norm([r.direction, r.addresses, r.cargo, r.truck, r.comment, r.status,
            ...(r.carriers || []).map((c) => [c.name, c.edrpou, c.price, c.note].join(" "))].join(" "));
        return r._hay;
    }
    function filtered() {
        const words = norm(st.q).split(" ").filter(Boolean);
        const since = st.period ? Date.now() - Number(st.period) * 86400000 : 0;
        const list = ROWS.filter((r) => {
            const cs = r.carriers || [];
            if (st.status && (st.status === "—" ? r.status : r.status !== st.status)) return false;
            if (st.dir && (r.direction || "") !== st.dir) return false;
            if (st.truck && norm(r.truck) !== st.truck) return false;
            if (st.has === "with" && !cs.length) return false;
            if (st.has === "without" && cs.length) return false;
            if (st.has === "fura" && !cs.some((c) => c.id)) return false;
            if (since && new Date(r.updated_at || r.created_at).getTime() < since) return false;
            return words.every((w) => hay(r).includes(w));
        });
        const t = (r) => new Date(r.updated_at || r.created_at).getTime();
        if (st.sort === "old") list.sort((a, b) => t(a) - t(b));
        else if (st.sort === "many") list.sort((a, b) => (b.carriers || []).length - (a.carriers || []).length || t(b) - t(a));
        else list.sort((a, b) => t(b) - t(a));
        return list;
    }
    function fillSelects() {
        const opt = (sel, first, vals) => {
            const cur = $(sel).value;
            $(sel).innerHTML = `<option value="">${first}</option>` + vals.map(([v, l, n]) => `<option value="${esc(v)}">${esc(l)} (${n})</option>`).join("");
            $(sel).value = vals.some(([v]) => v === cur) ? cur : "";
        };
        const count = (f) => { const m = new Map(); ROWS.forEach((r) => { const k = f(r); if (k) m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); };
        opt("#nbDir", "Усі напрямки", count((r) => (r.direction || "").trim()).map(([k, n]) => [k, k, n]));
        opt("#nbTruck", "Усі авто", count((r) => norm(r.truck)).map(([k, n]) => [k, k.toUpperCase(), n]));
    }
    function renderChips() {
        const n = (k) => ROWS.filter((r) => (k === "—" ? !r.status : r.status === k)).length;
        const chips = [{ k: "", label: `Усі ${ROWS.length}` }, ...STATUSES.map((s) => ({ k: s.k, label: `${s.k} ${n(s.k)}`, cls: s.cls })), { k: "—", label: `Без статусу ${n("—")}` }];
        $("#nbStatus").innerHTML = chips.map((c) => `<button type="button" class="nb-chip ${c.cls ? "st-" + c.cls : ""} ${st.status === c.k ? "active" : ""}" data-st="${esc(c.k)}">${esc(c.label)}</button>`).join("");
    }
    function carrierHtml(c, i) {
        const name = esc(c.name || "Перевізник");
        const nameEl = `<span class="nb-cname">${c.id ? '<i class="bx bxs-check-circle nb-infura" title="Є у FURA"></i> ' : ""}${name}</span>`;
        return `<div class="nb-carrier" data-ci="${i}" title="Натисніть, щоб відкрити">
            ${nameEl}
            ${c.edrpou ? `<button type="button" class="nb-code" data-copy="${esc(c.edrpou)}" title="Копіювати">${esc(c.edrpou)} <i class="bx bx-copy"></i></button>` : ""}
            ${c.price ? `<div class="nb-price">${esc(c.price)}</div>` : ""}
            ${c.note ? `<div class="nb-note">${esc(c.note)}</div>` : ""}
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
        $("#nbCount").textContent = list.length === ROWS.length ? `${ROWS.length} запитів` : `знайдено ${list.length} з ${ROWS.length}`;
        $("#nbList").innerHTML = list.slice(0, st.shown).map(rowHtml).join("") ||
            `<div class="nb-empty">${ROWS.length ? "Нічого не знайдено" : "Тут поки порожньо. Натисніть «Новий запит» або імпортуйте свою Google-таблицю (Файл → Завантажити → CSV)."}</div>`;
        $("#nbMore").classList.toggle("hidden", list.length <= st.shown);
    }

    /* ---------- форма ---------- */
    function carrierEditor(c = {}) {
        const d = document.createElement("div");
        d.className = "nb-cedit";
        d.dataset.id = c.id || "";
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
            ROWS = ROWS.filter((x) => x.id !== saved.id);
            ROWS.unshift(saved);
        }
        close();
        render();
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
                <span>Ціна</span><input class="nb-pin nb-price" data-f="price" value="${esc(c.price || "")}" placeholder="напр. 2200 €" />
                <span>Додано</span><b>${esc(dt(c.added || r.created_at || r.updated_at))}</b>
                ${c.at ? `<span>Змінено</span><b>${esc(dt(c.at))}</b>` : ""}
            </div>
            <textarea class="nb-pin nb-pop-note" data-f="note" rows="4" placeholder="Нотатка: коли може, контакт, умови…">${esc(c.note || "")}</textarea>
            <div class="nb-pop-foot">
                <button type="button" class="nb-btn nb-btn-danger" data-pdel title="Прибрати перевізника з цього запиту"><i class="bx bx-trash"></i></button>
                ${c.id ? `<a href="#" class="nb-btn nb-btn-ghost" data-carrier-card="${esc(c.id)}">Картка у FURA</a>` : c.edrpou ? `<a href="#" class="nb-btn nb-btn-ghost" data-carrier-code="${esc(c.edrpou)}">Знайти у FURA</a>` : ""}
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
            if (["name", "edrpou", "price", "note"].every((k) => (v[k] || "") === (old[k] || ""))) { POP = null; $("#nbPop").classList.add("hidden"); return; }
            list[i] = { ...old, ...v, id: v.edrpou !== (old.edrpou || "") ? null : old.id, added: old.added || r.created_at, at: new Date().toISOString() };
            if (!list[i].id && v.edrpou) {
                const { data } = await sbClient.from("carriers").select("id").eq("edrpou", v.edrpou).limit(1);
                list[i].id = data?.[0]?.id || null;
            }
        }
        const { data, error } = await sbClient.from("my_requests").update({ carriers: list }).eq("id", r.id).select("*");
        if (error) { alert("Не вдалося зберегти: " + error.message); return; }
        const saved = { ...(data?.[0]?.id === r.id ? data[0] : r), carriers: list };
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
        return { id: null, name: name.length > 120 ? name.slice(0, 120) : name, edrpou: code, price: price.replace(/\s+/g, " ").trim(), note: note.slice(0, 300) };
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
        let t = 0;
        $("#nbQ").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.shown = PAGE; render(); }, 150); });
        $("#nbStatus").addEventListener("click", (e) => {
            const b = e.target.closest("[data-st]");
            if (!b) return;
            st.status = st.status === b.dataset.st ? "" : b.dataset.st;
            st.shown = PAGE;
            render();
        });
        $("#nbMore").addEventListener("click", () => { st.shown += PAGE; render(); });
        [["#nbDir", "dir"], ["#nbTruck", "truck"], ["#nbHas", "has"], ["#nbPeriod", "period"], ["#nbSort", "sort"]].forEach(([sel, k]) =>
            $(sel).addEventListener("change", (e) => { st[k] = e.target.value; st.shown = PAGE; render(); }));
        $("#nbReset").addEventListener("click", () => {
            Object.assign(st, { q: "", status: "", dir: "", truck: "", has: "", period: "", sort: "upd", shown: PAGE });
            ["#nbQ", "#nbDir", "#nbTruck", "#nbHas", "#nbPeriod"].forEach((s) => ($(s).value = ""));
            $("#nbSort").value = "upd";
            render();
        });
        $("#nbPop").addEventListener("click", async (e) => {
            if (e.target.closest("[data-pclose]")) { POP = null; return hidePop(); }
            if (e.target.closest("[data-psave]")) return savePop(false);
            if (e.target.closest("[data-pdel]")) return savePop(true);
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
