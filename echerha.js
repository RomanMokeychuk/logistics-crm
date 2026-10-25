/* ================================================================= *
 * FURA — «ЧЕРГА»: машини в черзі на кордоні зараз                     *
 * Дані: таблиці echerha_* (заповнює застосунок «Черга» з Mac через   *
 * Edge Function fura-echerha). Тут лише перегляд + «Додати у FURA».   *
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

const EQ = (() => {
    const $ = (s) => document.querySelector(s);
    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const codeKey = (v) => String(v || "").replace(/\D/g, "").replace(/^0+/, "");
    const norm = (s) => String(s || "").toLowerCase().replace(/[\s\-]/g, "");
    const PAGE = 100;
    const BODIES = ["тент", "реф", "автовоз", "контейнеровоз", "платформа", "бортовий", "фургон", "самоскид", "цистерна", "інше", "невідомо"];
    const FKEY = "fura_echerha_filters";

    let ROWS = [];
    let CPS = [];
    let FURA = new Map(); // ЄДРПОУ (без нулів спереду) -> {id, name}
    const st = { view: "trucks", q: "", cps: null, country: "", qtype: "", bodies: new Set(), ua: true, notInFura: false, isNew: false, starred: false, page: 0, sort: "entry" };
    let WATCH = new Map(); // номер тягача -> мій запис echerha_watch
    const plateKey = (v) =>
        String(v || "").toUpperCase().replace(/\s|-/g, "")
            .replace(/[АВЕІКМНОРСТХ]/g, (c) => ({ А: "A", В: "B", Е: "E", І: "I", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X" })[c]);

    /* ---------- дати ---------- */
    const dShort = (v) => {
        const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/);
        return m ? `${m[3]}.${m[2]}${m[4] ? " " + m[4] : ""}` : esc(v || "—");
    };
    function ago(iso) {
        const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        if (min < 1) return "щойно";
        if (min < 60) return `${min} хв тому`;
        const h = Math.floor(min / 60);
        if (h < 48) return `${h} год тому`;
        return `${Math.floor(h / 24)} дн тому`;
    }
    const cpShort = (name) => String(name || "").replace(/\s*\((для|Туреччина)[^)]*\)\s*$/i, "").replace(/^Hopa:\s*/, "Hopa: ");
    const cpNote = (name) => (String(name || "").match(/\(([^)]*)\)\s*$/) || [])[1] || "";

    /* ---------- збереження фільтрів ---------- */
    function save() {
        try {
            localStorage.setItem(FKEY, JSON.stringify({ ...st, bodies: [...st.bodies], cps: st.cps ? [...st.cps] : null, page: 0 }));
        } catch (e) { /* без збереження */ }
    }
    function restore() {
        try {
            const s = JSON.parse(localStorage.getItem(FKEY) || "null");
            if (!s) return;
            Object.assign(st, s, { bodies: new Set(s.bodies || []), cps: Array.isArray(s.cps) ? new Set(s.cps) : null, page: 0 });
        } catch (e) { /* ігноруємо */ }
    }

    /* ---------- завантаження ---------- */
    async function fetchAll(table, select, filter) {
        const out = [];
        for (let from = 0; ; from += 1000) {
            let q = sbClient.from(table).select(select).range(from, from + 999);
            if (filter) q = filter(q);
            const { data, error } = await q;
            if (error) throw error;
            out.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
        return out;
    }

    async function loadFura() {
        const { count } = await sbClient.from("carriers").select("id", { count: "exact", head: true });
        const pages = Math.ceil((count || 0) / 1000);
        const parts = await Promise.all(
            Array.from({ length: pages }, (_, i) => sbClient.from("carriers").select("id, name, edrpou").range(i * 1000, i * 1000 + 999)),
        );
        FURA = new Map();
        parts.forEach((p) => (p.data || []).forEach((c) => {
            const k = codeKey(c.edrpou);
            if (k && !FURA.has(k)) FURA.set(k, { id: c.id, name: c.name });
        }));
    }

    async function loadWatch() {
        const { data, error } = await sbClient.from("echerha_watch").select("*").order("created_at", { ascending: false });
        if (error) { console.warn("Обрані:", error.message); return; }
        WATCH = new Map((data || []).map((w) => [w.plate, w]));
        const n = $("#eqWatchN");
        if (n) n.textContent = WATCH.size ? WATCH.size : "";
    }

    async function toggleStar(plate) {
        const r = ROWS.find((x) => x.tractor === plate);
        if (WATCH.has(plate)) {
            const w = WATCH.get(plate);
            WATCH.delete(plate);
            renderTable();
            await sbClient.from("echerha_watch").delete().eq("id", w.id);
        } else {
            const row = {
                plate, status: r ? "waiting" : "pending",
                checkpoint: r?.checkpoint || null, entry_at: r?.entry_at || null, queue_no: r?.queue_no || null,
                trailer: r?.trailer || null, carrier: r?.carrier || null, edrpou: r?.edrpou || null, note: r?.note || null,
                last_seen: r ? new Date().toISOString() : null,
            };
            WATCH.set(plate, row);
            renderTable();
            const { data, error } = await sbClient.from("echerha_watch").upsert(row, { onConflict: "user_id,plate" }).select("*");
            if (error) {
                WATCH.delete(plate);
                alert("Не вдалося додати в обрані: " + error.message + (/relation|does not exist|schema cache/.test(error.message) ? "\nВиконайте echerha_watch.sql у Supabase." : ""));
            } else if (data?.[0]) WATCH.set(plate, data[0]);
        }
        await loadWatch();
        renderTable();
    }

    async function load() {
        const { data: sync, error } = await sbClient.from("echerha_sync").select("*").eq("id", 1).maybeSingle();
        if (error) {
            $("#eqSync").innerHTML = `<span class="eq-bad">Немає доступу до таблиць «Черги»: ${esc(error.message)}. Виконайте echerha.sql у Supabase.</span>`;
            renderTable();
            return;
        }
        if (!sync?.sync_id) {
            $("#eqSync").innerHTML = `<span class="eq-warn">Черга ще не надсилала дані. Увімкніть «Відправляти чергу у FURA» в її налаштуваннях.</span>`;
            renderAll();
            return;
        }
        const [rows, cps] = await Promise.all([
            fetchAll("echerha_queue", "*", (q) => q.eq("sync_id", sync.sync_id).order("entry_at", { ascending: true })),
            fetchAll("echerha_checkpoints", "*"),
            loadFura().catch((e) => console.warn("FURA carriers:", e)),
            loadWatch(),
        ]);
        ROWS = rows;
        CPS = cps.sort((a, b) => b.in_queue - a.in_queue || String(a.name).localeCompare(b.name, "uk"));
        const old = Date.now() - new Date(sync.synced_at).getTime() > 3 * 3600 * 1000;
        $("#eqSync").innerHTML =
            `<i class="bx bx-refresh"></i> Оновлено <b>${esc(new Date(sync.synced_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))}</b>` +
            ` <span class="${old ? "eq-warn" : "eq-muted"}">(${ago(sync.synced_at)}${old ? " — Mac з Чергою, мабуть, вимкнений" : ""})</span>`;
        fillSelects();
        renderAll();
    }

    /* ---------- фільтри ---------- */
    function fillSelects() {
        const countries = [...new Set(CPS.map((c) => c.country).filter(Boolean))].sort((a, b) => a.localeCompare(b, "uk"));
        $("#eqCountry").innerHTML = `<option value="">Усі країни</option>` + countries.map((c) => `<option ${c === st.country ? "selected" : ""}>${esc(c)}</option>`).join("");
        const qt = [...new Set(CPS.map((c) => c.qtype).filter(Boolean))];
        $("#eqQtype").innerHTML = `<option value="">Будь-яка черга</option>` + qt.map((c) => `<option ${c === st.qtype ? "selected" : ""}>${esc(c)}</option>`).join("");
        $("#eqBodies").innerHTML = BODIES.map((b) => `<button type="button" data-b="${b}" class="${st.bodies.has(b) ? "on" : ""}">${b}</button>`).join("");
        $("#eqUa").checked = st.ua;
        $("#eqNotInFura").checked = st.notInFura;
        $("#eqNew").checked = st.isNew;
        $("#eqStarred").checked = st.starred;
        $("#eqQ").value = st.q;
        document.querySelectorAll("#eqViews button").forEach((b) => b.classList.toggle("active", b.dataset.v === st.view));
        paintCp();
    }

    function cpLabel() {
        if (!st.cps) return "Усі пункти ▾";
        if (st.cps.size === 1) return cpShort([...st.cps][0]) + " ▾";
        return `${st.cps.size} пунктів ▾`;
    }

    function paintCp(search = "") {
        $("#eqCpBtn").textContent = cpLabel();
        const panel = $("#eqCpPanel");
        const s = norm(search);
        const groups = {};
        CPS.filter((c) => !st.country || c.country === st.country)
            .filter((c) => !s || norm(c.name).includes(s))
            .forEach((c) => (groups[c.country || "Інше"] ||= []).push(c));
        const checked = (n) => !st.cps || st.cps.has(n);
        panel.innerHTML =
            `<div class="eq-mtop"><input type="search" placeholder="Пошук пункту…" value="${esc(search)}">` +
            `<button type="button" data-a="all">Усі</button><button type="button" data-a="sel">Основні</button>` +
            `<button type="button" data-a="none">Зняти всі</button><button type="button" data-a="ok" class="eq-ok">Готово</button></div>` +
            Object.entries(groups)
                .sort((a, b) => a[0].localeCompare(b[0], "uk"))
                .map(([g, list]) => {
                    const all = list.every((c) => checked(c.name));
                    return `<div class="eq-mgrp"><label><input type="checkbox" data-g="${esc(g)}" ${all ? "checked" : ""}> <b>${esc(g)}</b></label></div>` +
                        list.map((c) => `<label class="eq-mitem"><input type="checkbox" data-n="${esc(c.name)}" ${checked(c.name) ? "checked" : ""}>` +
                            `<span>${c.selected ? "★ " : ""}${esc(c.name)}</span><span class="eq-muted">${c.in_queue}</span></label>`).join("");
                })
                .join("") || `<div class="eq-muted" style="padding:8px">Немає пунктів</div>`;
        const inp = panel.querySelector("input[type=search]");
        inp.addEventListener("input", () => {
            paintCp(inp.value);
            const n = $("#eqCpPanel input[type=search]");
            n.focus();
            n.setSelectionRange(n.value.length, n.value.length);
        });
    }

    function setCps(set) {
        const names = CPS.map((c) => c.name);
        st.cps = set && set.size < names.length ? set : null;
        st.page = 0;
        paintCp($("#eqCpPanel input[type=search]")?.value || "");
        renderAll();
    }

    function onCpClick(e) {
        const t = e.target;
        const names = CPS.map((c) => c.name);
        const cur = st.cps ? new Set(st.cps) : new Set(names);
        if (t.dataset.a === "all") return setCps(null);
        if (t.dataset.a === "none") return setCps(new Set());
        if (t.dataset.a === "sel") return setCps(new Set(CPS.filter((c) => c.selected).map((c) => c.name)));
        if (t.dataset.a === "ok") return $("#eqCpPanel").classList.add("hidden");
        if (t.matches("input[data-n]")) {
            t.checked ? cur.add(t.dataset.n) : cur.delete(t.dataset.n);
            return setCps(cur);
        }
        if (t.matches("input[data-g]")) {
            CPS.filter((c) => (c.country || "Інше") === t.dataset.g).forEach((c) => (t.checked ? cur.add(c.name) : cur.delete(c.name)));
            return setCps(cur);
        }
    }

    function bodyOf(r) {
        return r.trailer_body || "невідомо";
    }

    function filtered() {
        const q = norm(st.q);
        return ROWS.filter((r) => {
            if (st.ua && !r.ua) return false;
            if (st.cps && !st.cps.has(r.checkpoint)) return false;
            if (st.country && r.country !== st.country) return false;
            if (st.qtype && r.qtype !== st.qtype) return false;
            if (st.bodies.size && !st.bodies.has(bodyOf(r))) return false;
            if (st.isNew && !r.is_new) return false;
            if (st.starred && !WATCH.has(r.tractor)) return false;
            if (st.notInFura && (!r.edrpou || FURA.has(codeKey(r.edrpou)))) return false;
            if (q && !norm([r.tractor, r.trailer, r.carrier, r.edrpou, r.boss, r.checkpoint].join(" ")).includes(q)) return false;
            return true;
        });
    }

    /* ---------- відображення ---------- */
    function furaCell(code, name, bodies, extra) {
        const k = codeKey(code);
        if (!k) return `<span class="eq-muted">—</span>`;
        const f = FURA.get(k);
        if (f) return `<a class="eq-in" href="index.html?open=${encodeURIComponent(f.id)}" title="Відкрити картку у FURA"><i class="bx bx-check-circle"></i> Картка</a>`;
        return `<button type="button" class="eq-add" data-add="${esc(code)}" data-name="${esc(name)}" data-bodies="${esc(bodies || "")}" data-extra="${esc(extra || "")}"><i class="bx bx-plus"></i> Додати</button>`;
    }

    function kpis(list) {
        const ua = list.filter((r) => r.ua);
        const codes = new Set(list.map((r) => codeKey(r.edrpou)).filter(Boolean));
        const notIn = [...codes].filter((k) => !FURA.has(k)).length;
        const cps = new Set(list.map((r) => r.checkpoint)).size;
        const k = (n, l, cls = "") => `<div class="eq-kpi ${cls}"><b>${n.toLocaleString("uk-UA")}</b><span>${l}</span></div>`;
        $("#eqKpis").innerHTML =
            k(list.length, "машин у черзі") + k(ua.length, "з українськими тягачами") + k(codes.size, "перевізників") +
            k(notIn, "немає у FURA", notIn ? "eq-kpi-hl" : "") + k(cps, "пунктів");
    }

    function pager(total) {
        const pages = Math.max(1, Math.ceil(total / PAGE));
        if (st.page >= pages) st.page = pages - 1;
        const html = pages > 1
            ? `<button class="pager-btn" data-p="${st.page - 1}" ${st.page ? "" : "disabled"}><i class="bx bx-chevron-left"></i></button>` +
              `<span class="eq-muted">${st.page + 1} / ${pages}</span>` +
              `<button class="pager-btn" data-p="${st.page + 1}" ${st.page < pages - 1 ? "" : "disabled"}><i class="bx bx-chevron-right"></i></button>`
            : "";
        $("#eqPager").innerHTML = html;
        $("#eqPagerTop").innerHTML = html;
        $("#eqCountTop").textContent = pages > 1 ? `показано ${st.page * PAGE + 1}–${Math.min(total, st.page * PAGE + PAGE)} з ${total.toLocaleString("uk-UA")}` : "";
    }

    const starBtn = (plate) =>
        `<button type="button" class="eq-star ${WATCH.has(plate) ? "on" : ""}" data-star="${esc(plate)}" title="${WATCH.has(plate) ? "Прибрати з обраних" : "Стежити: сповіщу, коли пройде кордон"}">${WATCH.has(plate) ? "★" : "☆"}</button>`;

    function watchStatus(w) {
        if (w.status === "passed") return `<span class="eq-pass">✅ Пройшла кордон</span><div class="eq-muted eq-sm">${w.passed_at ? new Date(w.passed_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""} · ${esc(cpShort(w.checkpoint))}</div>`;
        if (w.status === "waiting") return `<span class="eq-wait">🚚 У черзі</span><div class="eq-muted eq-sm">${esc(cpShort(w.checkpoint))} · в'їзд ${dShort(w.entry_at)}${w.queue_no ? " · № " + esc(w.queue_no) : ""}</div>${w.note ? `<div class="eq-muted eq-sm">${esc(w.note)}</div>` : ""}`;
        return `<span class="eq-muted">⏳ Ще не в черзі — чекаю, коли з'явиться</span>`;
    }

    function renderWatch() {
        const list = [...WATCH.values()].sort((a, b) => ({ passed: 0, waiting: 1, pending: 2 })[a.status] - ({ passed: 0, waiting: 1, pending: 2 })[b.status] || String(b.passed_at || b.created_at).localeCompare(String(a.passed_at || a.created_at)));
        $("#eqTable").innerHTML =
            `<thead><tr><th class="eq-star-th">★</th><th>Тягач</th><th>Статус</th><th>Причіп</th><th>Перевізник</th><th>Стежу з</th></tr></thead><tbody>` +
            `<tr class="eq-addrow"><td></td><td colspan="5"><form id="eqWatchForm" class="eq-watch-form"><input id="eqWatchPlate" placeholder="Номер тягача, напр. BC1234AB" autocomplete="off"><button type="submit" class="eq-add"><i class="bx bx-plus"></i> Стежити</button><span class="eq-muted eq-sm">Сповіщення прийде в FURA${" "}і в Telegram (якщо підключений до бота FURA), коли машина пройде кордон.</span></form></td></tr>` +
            (list.map((w) => `<tr class="${w.status === "passed" ? "eq-passed" : ""}">
                <td>${starBtn(w.plate)}</td>
                <td class="eq-mono"><b>${esc(w.plate)}</b></td>
                <td>${watchStatus(w)}</td>
                <td class="eq-mono">${esc(w.trailer || "—")}</td>
                <td>${esc(w.carrier || "—")}${w.edrpou ? `<div class="eq-muted eq-sm eq-mono">${esc(w.edrpou)}</div>` : ""}</td>
                <td class="eq-nw eq-muted">${w.created_at ? new Date(w.created_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
            </tr>`).join("") || `<tr><td colspan="6" class="eq-empty">Ще немає обраних. Натисніть ☆ біля машини у вкладці «Машини» або впишіть номер вище.</td></tr>`) + "</tbody>";
        $("#eqCount").textContent = `Обраних: ${list.length} · у черзі: ${list.filter((w) => w.status === "waiting").length} · пройшли: ${list.filter((w) => w.status === "passed").length}`;
        $("#eqPager").innerHTML = "";
        $("#eqPagerTop").innerHTML = "";
        $("#eqCountTop").textContent = "";
        $("#eqWatchForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const plate = plateKey($("#eqWatchPlate").value);
            if (!/^[A-Z]{2}\d{4}[A-Z]{2}$/.test(plate) && !confirm(`«${plate}» не схожий на український номер. Все одно стежити?`)) return;
            if (plate && !WATCH.has(plate)) await toggleStar(plate);
        });
        // хто вже пройшов кордон — сповіщення показано
        const unseen = list.filter((w) => w.status === "passed" && !w.seen).map((w) => w.id);
        if (unseen.length) sbClient.from("echerha_watch").update({ seen: true }).in("id", unseen).then(() => {});
    }

    function renderTrucks(list) {
        const rows = list.slice(st.page * PAGE, st.page * PAGE + PAGE);
        $("#eqTable").innerHTML =
            `<thead><tr><th class="eq-star-th" title="Обрані">★</th><th>Пункт</th><th>В'їзд</th><th>Тягач</th><th>Причіп</th><th>Кузов</th><th>Перевізник</th><th>Керівник</th><th>FURA</th></tr></thead><tbody>` +
            (rows.map((r) => `<tr class="${WATCH.has(r.tractor) ? "eq-starred" : ""}">
                <td>${starBtn(r.tractor)}</td>
                <td><b>${esc(cpShort(r.checkpoint))}</b><div class="eq-muted eq-sm">${esc(cpNote(r.checkpoint))}${r.note ? " · " + esc(r.note) : ""}</div></td>
                <td class="eq-nw">${dShort(r.entry_at)}<div class="eq-muted eq-sm">№ ${esc(r.queue_no || "—")}</div></td>
                <td class="eq-mono">${esc(r.tractor)}</td>
                <td class="eq-mono">${esc(r.trailer || "—")}<div class="eq-muted eq-sm eq-clip" title="${esc(r.trailer_model)}">${esc(r.trailer_model || "")}</div></td>
                <td>${r.trailer_body ? `<span class="eq-body">${esc(r.trailer_body)}</span>` : `<span class="eq-muted">—</span>`}</td>
                <td>${esc(r.carrier || "—")}${r.is_new ? ` <span class="eq-new">новий</span>` : ""}${r.edrpou ? `<div class="eq-muted eq-sm eq-mono">${esc(r.edrpou)}</div>` : ""}</td>
                <td>${esc(r.boss || "—")}</td>
                <td>${furaCell(r.edrpou, r.carrier, r.trailer_body, `${cpShort(r.checkpoint)}, ${r.tractor}${r.trailer ? "/" + r.trailer : ""}`)}</td>
            </tr>`).join("") || `<tr><td colspan="9" class="eq-empty">Нічого не знайдено</td></tr>`) + "</tbody>";
        $("#eqCount").textContent = `Машин: ${list.length.toLocaleString("uk-UA")}`;
        pager(list.length);
    }

    function renderCarriers(list) {
        const by = new Map();
        list.filter((r) => r.edrpou).forEach((r) => {
            const k = codeKey(r.edrpou);
            const c = by.get(k) || { code: r.edrpou, name: r.carrier, boss: r.boss, trucks: [], cps: new Set(), bodies: new Set(), first: r.entry_at, isNew: false };
            c.trucks.push(r.tractor + (r.trailer ? " / " + r.trailer : ""));
            c.cps.add(cpShort(r.checkpoint));
            if (r.trailer_body) c.bodies.add(r.trailer_body);
            if (r.entry_at && (!c.first || r.entry_at < c.first)) c.first = r.entry_at;
            c.isNew ||= r.is_new;
            by.set(k, c);
        });
        const all = [...by.values()].sort((a, b) => b.trucks.length - a.trucks.length || String(a.name).localeCompare(b.name, "uk"));
        const rows = all.slice(st.page * PAGE, st.page * PAGE + PAGE);
        $("#eqTable").innerHTML =
            `<thead><tr><th>Перевізник</th><th>ЄДРПОУ</th><th>Керівник</th><th>Машин</th><th>Пункти</th><th>Найближчий в'їзд</th><th>Кузови</th><th>FURA</th></tr></thead><tbody>` +
            (rows.map((c) => `<tr>
                <td><b>${esc(c.name)}</b>${c.isNew ? ` <span class="eq-new">новий</span>` : ""}</td>
                <td class="eq-mono">${esc(c.code)}</td>
                <td>${esc(c.boss || "—")}</td>
                <td title="${esc(c.trucks.join("\n"))}"><b>${c.trucks.length}</b><div class="eq-muted eq-sm eq-clip eq-mono">${esc(c.trucks.slice(0, 2).join(", "))}${c.trucks.length > 2 ? "…" : ""}</div></td>
                <td>${[...c.cps].map(esc).join("<br>")}</td>
                <td class="eq-nw">${dShort(c.first)}</td>
                <td>${[...c.bodies].map((b) => `<span class="eq-body">${esc(b)}</span>`).join(" ") || "—"}</td>
                <td>${furaCell(c.code, c.name, [...c.bodies].join(";"), `${[...c.cps].join(", ")}; ${c.trucks.join(", ")}`)}</td>
            </tr>`).join("") || `<tr><td colspan="8" class="eq-empty">Нічого не знайдено</td></tr>`) + "</tbody>";
        $("#eqCount").textContent = `Перевізників: ${all.length.toLocaleString("uk-UA")} · машин: ${list.length.toLocaleString("uk-UA")}`;
        pager(all.length);
    }

    function renderCps(list) {
        const n = {};
        list.forEach((r) => (n[r.checkpoint] = (n[r.checkpoint] || 0) + 1));
        const cps = CPS.filter((c) => (!st.cps || st.cps.has(c.name)) && (!st.country || c.country === st.country) && (!st.qtype || c.qtype === st.qtype));
        $("#eqTable").innerHTML =
            `<thead><tr><th>Пункт</th><th>Країна</th><th>Черга</th><th>Машин (за фільтром)</th><th>Усього в черзі</th><th>Пройдено</th></tr></thead><tbody>` +
            (cps.map((c) => `<tr class="eq-cprow" data-cp="${esc(c.name)}">
                <td><b>${c.selected ? "★ " : ""}${esc(cpShort(c.name))}</b><div class="eq-muted eq-sm">${esc(cpNote(c.name))}</div></td>
                <td>${esc(c.country || "—")}</td><td>${esc(c.qtype || "—")}</td>
                <td><b>${n[c.name] || 0}</b></td><td>${c.in_queue}</td>
                <td class="eq-nw eq-muted">${dShort(c.last_scraped)}</td>
            </tr>`).join("") || `<tr><td colspan="6" class="eq-empty">Немає пунктів</td></tr>`) + "</tbody>";
        $("#eqCount").textContent = `Пунктів: ${cps.length} · натисніть на пункт, щоб побачити його машини`;
        $("#eqPager").innerHTML = "";
        $("#eqPagerTop").innerHTML = "";
        $("#eqCountTop").textContent = "";
    }

    function renderTable() {
        const list = filtered();
        kpis(list);
        if (st.view === "watch") renderWatch();
        else if (st.view === "carriers") renderCarriers(list);
        else if (st.view === "cps") renderCps(list);
        else renderTrucks(list);
    }
    function renderAll() {
        save();
        renderTable();
    }

    /* ---------- «Додати у FURA» ---------- */
    async function addCarrier(btn) {
        const code = btn.dataset.add;
        const name = btn.dataset.name;
        const rows = ROWS.filter((r) => codeKey(r.edrpou) === codeKey(code));
        const boss = rows.find((r) => r.boss)?.boss || "";
        if (!confirm(`Додати у FURA перевізника\n«${name}» (ЄДРПОУ ${code})?`)) return;
        const bodies = [...new Set(rows.map((r) => r.trailer_body).filter(Boolean))].map((b) => b.toUpperCase());
        const today = new Date().toLocaleDateString("uk-UA");
        const notes =
            `Додано з «Черги» ${today}.` +
            (boss ? `\nКерівник: ${boss}` : "") +
            `\nБачили на кордоні: ${[...new Set(rows.map((r) => cpShort(r.checkpoint)))].join(", ")}` +
            `\nМашини: ${rows.map((r) => r.tractor + (r.trailer ? "/" + r.trailer : "")).join(", ")}`;
        btn.disabled = true;
        const { data, error } = await sbClient
            .from("carriers")
            .insert([{ name, edrpou: code, trailer_type: bodies.join("; ") || null, notes, notes_updated_at: new Date().toISOString() }])
            .select("id, name, edrpou");
        if (error || !data?.length) {
            btn.disabled = false;
            alert("Не вдалося додати: " + (error?.message || "немає прав на додавання перевізників"));
            return;
        }
        FURA.set(codeKey(code), { id: data[0].id, name });
        renderTable();
    }

    /* ---------- події ---------- */
    function bind() {
        let t = null;
        $("#eqQ").addEventListener("input", (e) => {
            clearTimeout(t);
            t = setTimeout(() => { st.q = e.target.value; st.page = 0; renderAll(); }, 200);
        });
        $("#eqViews").addEventListener("click", (e) => {
            const b = e.target.closest("button");
            if (!b) return;
            st.view = b.dataset.v;
            st.page = 0;
            document.querySelectorAll("#eqViews button").forEach((x) => x.classList.toggle("active", x === b));
            renderAll();
        });
        $("#eqCountry").addEventListener("change", (e) => { st.country = e.target.value; st.page = 0; paintCp(); renderAll(); });
        $("#eqQtype").addEventListener("change", (e) => { st.qtype = e.target.value; st.page = 0; renderAll(); });
        $("#eqBodies").addEventListener("click", (e) => {
            const b = e.target.closest("button");
            if (!b) return;
            st.bodies.has(b.dataset.b) ? st.bodies.delete(b.dataset.b) : st.bodies.add(b.dataset.b);
            b.classList.toggle("on");
            st.page = 0;
            renderAll();
        });
        [["#eqUa", "ua"], ["#eqNotInFura", "notInFura"], ["#eqNew", "isNew"], ["#eqStarred", "starred"]].forEach(([id, k]) =>
            $(id).addEventListener("change", (e) => { st[k] = e.target.checked; st.page = 0; renderAll(); }));
        $("#eqReset").addEventListener("click", () => {
            Object.assign(st, { q: "", cps: null, country: "", qtype: "", bodies: new Set(), ua: true, notInFura: false, isNew: false, starred: false, page: 0 });
            fillSelects();
            renderAll();
        });
        $("#eqCpBtn").addEventListener("click", (e) => {
            e.stopPropagation();
            $("#eqCpPanel").classList.toggle("hidden");
        });
        $("#eqCpPanel").addEventListener("click", (e) => { e.stopPropagation(); onCpClick(e); });
        document.addEventListener("click", () => $("#eqCpPanel").classList.add("hidden"));
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#eqCpPanel").classList.add("hidden"); });
        const onPage = (e) => {
            const b = e.target.closest("[data-p]");
            if (!b || b.disabled) return;
            st.page = +b.dataset.p;
            renderTable();
            document.querySelector(".eq-card").scrollIntoView({ block: "start" });
        };
        $("#eqPager").addEventListener("click", onPage);
        $("#eqPagerTop").addEventListener("click", onPage);
        $("#eqTable").addEventListener("click", (e) => {
            const star = e.target.closest("[data-star]");
            if (star) return toggleStar(star.dataset.star);
            const add = e.target.closest("[data-add]");
            if (add) return addCarrier(add);
            const cp = e.target.closest("[data-cp]");
            if (cp) {
                st.cps = new Set([cp.dataset.cp]);
                st.view = "trucks";
                st.page = 0;
                fillSelects();
                renderAll();
            }
        });
    }

    // Зміни моїх обраних (напр. «пройшла кордон») — одразу оновити список
    function live() {
        sbClient.auth.getSession().then(({ data: { session } }) => {
            if (!session) return;
            sbClient
                .channel("eq-watch-page")
                .on("postgres_changes", { event: "*", schema: "public", table: "echerha_watch", filter: `user_id=eq.${session.user.id}` }, async () => {
                    await loadWatch();
                    renderTable();
                })
                .subscribe();
        });
    }

    return { restore, bind, load, fillSelects, live, setView: (v) => { st.view = v; } };
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
    EQ.restore();
    const v = new URLSearchParams(location.search).get("view");
    if (v) EQ.setView(v);
    EQ.fillSelects();
    EQ.bind();
    try {
        await EQ.load();
    } catch (e) {
        console.error(e);
        document.getElementById("eqSync").textContent = "Помилка завантаження: " + (e.message || e);
    }
    EQ.live();
    // дані з Черги приходять раз на ~30 хв — підтягуємо раз на 5 хв
    setInterval(() => EQ.load().catch(() => {}), 5 * 60 * 1000);
});
