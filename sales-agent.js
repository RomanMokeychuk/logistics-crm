/* ================================================================= *
 * FURA — AI-ПРОДАЖІ                                                  *
 * • пул клієнтів з митної бази (імпорт Excel)                        *
 * • пошук контактів агентом (реєстр → сайт → платні бази)            *
 * • листи на схвалення: «Надіслати» / «Відхилити»                     *
 * • відповіді клієнтів і нагадування                                  *
 * Усе надсилання й зміни робить сервер (функція fura-sales).         *
 * ================================================================= */

const SUPABASE_URL = "https://prbfscwmemshwigiftha.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const STAGES = {
    new: { label: "Новий", cls: "" },
    enriching: { label: "Шукаю контакти…", cls: "warn" },
    enriched: { label: "Контакти знайдено", cls: "good" },
    no_contacts: { label: "Без e-mail", cls: "bad" },
    drafted: { label: "Лист на схваленні", cls: "warn" },
    contacted: { label: "Написали", cls: "good" },
    replied: { label: "Відповів", cls: "hot" },
    won: { label: "Клієнт", cls: "good" },
    lost: { label: "Відмова", cls: "bad" },
    skip: { label: "Не наш", cls: "" },
};
const CLASS_LABEL = {
    interest: ["🔥 Цікавиться", "hot"],
    quote: ["💰 Просить ставку", "hot"],
    later: ["⏳ Пізніше", "warn"],
    refusal: ["Відмова", "bad"],
    unsubscribe: ["Просить не писати", "bad"],
    auto: ["Автовідповідь", ""],
    other: ["Інше", ""],
};
const SOURCE_LABEL = {
    registry: "реєстр",
    opendatabot: "Opendatabot",
    youcontrol: "YouControl",
    web_search: "веб-пошук",
    website: "сайт",
    snov: "Snov.io",
    apollo: "Apollo",
    rocketreach: "RocketReach",
    manual: "вручну",
    paid: "платні бази",
    result: "Підсумок",
};

let prospects = [];
let selected = new Set();
let shownIds = [];
let status = null;
let currentCard = null;
let parsedRows = null;

/* ---------------- Дрібниці ---------------- */

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

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
const $ = (id) => document.getElementById(id);

function fmtDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

let toastTimer = null;
function toast(text, isError = false) {
    const el = $("agToast");
    el.textContent = text;
    el.classList.toggle("error", isError);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), isError ? 7000 : 3000);
}

async function api(body) {
    const { data, error } = await sbClient.functions.invoke("fura-sales", { body });
    if (error) {
        let message = "Сервер не відповів. Перевірте, чи розгорнута функція fura-sales.";
        try {
            const j = await error.context?.json();
            if (j?.error) message = j.error;
        } catch (_) {}
        throw new Error(message);
    }
    return data;
}

async function withBusy(btn, fn) {
    if (btn) btn.disabled = true;
    try {
        return await fn();
    } catch (e) {
        toast(e.message, true);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function chip(text, cls = "") {
    return `<span class="ag-chip ${cls}">${escapeHtml(text)}</span>`;
}
function stageChip(stage) {
    const s = STAGES[stage] || { label: stage, cls: "" };
    return chip(s.label, s.cls);
}
function firstCountry(p) {
    return String(p.facts?.countries || "").split(",").slice(0, 2).join(", ");
}

/* ---------------- Стан (що підключено) ---------------- */

async function loadStatus() {
    try {
        status = await api({ action: "status" });
    } catch (e) {
        $("saStatus").innerHTML = `<span class="sa-dot bad"></span> ${escapeHtml(e.message)}`;
        return;
    }
    const s = status;
    document.body.classList.toggle("sa-mail-on", !!s.mail);
    const item = (ok, label) => `<span class="sa-st"><span class="sa-dot ${ok ? "good" : "bad"}"></span>${escapeHtml(label)}</span>`;
    $("saStatus").innerHTML = [
        item(s.ai, "Claude"),
        item(s.mail, s.mail ? `Пошта: ${s.from}` : "Пошта не налаштована"),
        item(s.sources.opendatabot || s.sources.youcontrol, "Реєстр (Opendatabot / YouControl)"),
        item(s.sources.snov, "Snov.io"),
        item(s.sources.apollo, "Apollo"),
        item(s.sources.rocketreach, "RocketReach"),
        `<span class="sa-st">${s.auto_followup ? "Нагадування: автоматично" : "Нагадування: через схвалення"}</span>`,
        `<button type="button" class="btn btn-secondary sa-testmail" id="saTestMail"><i class="bx bx-envelope"></i> Перевірити пошту</button>`,
    ].join("");
    $("saTestMail").onclick = async (ev) => {
        const to = prompt("Надіслати тестовий лист на адресу:", localStorage.getItem("fura_sales_test_to") || "");
        if (!to) return;
        try { localStorage.setItem("fura_sales_test_to", to); } catch (_) { /* без пам'яті */ }
        withBusy(ev.currentTarget, async () => {
            await api({ action: "send_test", to, subject: "Перевірка пошти FURA", body: "Добрий день!\n\nЦе тестовий лист з FURA. Якщо ви його бачите — відправка працює.\n\nЗ повагою,\nГрандар" });
            toast(`Тестовий лист надіслано на ${to}. Перевірте пошту (і папку «Спам»).`);
        });
    };
    $("limitHint").textContent = `Сьогодні надіслано перших листів: ${s.sent_today} з ${s.daily_limit}`;
    $("paidMin").textContent = s.paid_min_score;
}

/* ---------------- Пул клієнтів ---------------- */

async function loadProspects() {
    const all = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await sbClient
            .from("sales_prospects")
            .select("id, edrpou, name, trade_type, period, score, segment, facts, hook, stage, website, domain, director, lead_id, enriched_at, updated_at")
            .order("score", { ascending: false, nullsFirst: false })
            .range(from, from + 999);
        if (error) {
            $("poolBody").innerHTML = `<tr><td colspan="8" class="ag-empty">Помилка: ${escapeHtml(error.message)}<br>Можливо, ще не виконано sales_agent.sql у Supabase.</td></tr>`;
            return;
        }
        all.push(...(data || []));
        if (!data || data.length < 1000) break;
    }
    prospects = all;
    $("cntPool").textContent = prospects.length;
    fillSegments();
    renderFunnel();
    renderPool();
}

function fillSegments() {
    const sel = $("poolSegment");
    const keep = sel.value;
    const set = new Set();
    prospects.forEach((p) => String(p.segment || "").split(";").map((x) => x.trim()).filter(Boolean).forEach((x) => set.add(x)));
    sel.innerHTML = `<option value="">Усі сегменти</option>` + [...set].sort().map((s) => `<option>${escapeHtml(s)}</option>`).join("");
    if (set.has(keep)) sel.value = keep;
}

function renderFunnel() {
    const c = (st) => prospects.filter((p) => st.includes(p.stage)).length;
    const steps = [
        ["У пулі", prospects.length, "bx-data"],
        ["Шукаю контакти", c(["enriching"]), "bx-search-alt"],
        ["Є e-mail", c(["enriched", "drafted", "contacted", "replied", "won"]), "bx-at"],
        ["Написали", c(["contacted", "replied", "won"]), "bx-send"],
        ["Відповіли", c(["replied", "won"]), "bx-message-dots"],
        ["Без e-mail → дзвінок", c(["no_contacts"]), "bx-phone"],
    ];
    $("saFunnel").innerHTML = steps
        .map(([label, n, icon]) => `<div class="sa-step"><i class="bx ${icon}"></i><b>${n}</b><span>${label}</span></div>`)
        .join("");
}

function filteredProspects() {
    const q = $("poolSearch").value.trim().toLowerCase();
    const stage = $("poolStage").value;
    const trade = $("poolTrade").value;
    const seg = $("poolSegment").value;
    const min = Number($("poolMinScore").value || 0);
    return prospects.filter((p) => {
        if (stage === "__active" ? ["skip", "lost"].includes(p.stage) : stage && p.stage !== stage) return false;
        if (trade && p.trade_type !== trade) return false;
        if (seg && !String(p.segment || "").includes(seg)) return false;
        if (min && Number(p.score || 0) < min) return false;
        if (q) {
            const hay = [p.name, p.edrpou, p.facts?.cargo, p.facts?.countries, p.facts?.route].join(" ").toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

function renderPool() {
    const list = filteredProspects();
    const LIMIT = 300;
    const shown = list.slice(0, LIMIT);
    shownIds = shown.map((p) => p.id);
    $("poolBody").innerHTML = shown.length
        ? shown
              .map(
                  (p) => `<tr data-id="${p.id}">
            <td><input type="checkbox" class="sa-sel" data-id="${p.id}" ${selected.has(p.id) ? "checked" : ""} /></td>
            <td><a href="#" class="sa-open" data-id="${p.id}">${escapeHtml(p.name)}</a><div class="sa-muted">${escapeHtml(p.edrpou)}${p.segment ? " · " + escapeHtml(p.segment) : ""}</div></td>
            <td><b>${p.score ?? "—"}</b></td>
            <td>${escapeHtml(p.trade_type || "—")}</td>
            <td>${escapeHtml(p.facts?.trips ?? "—")}</td>
            <td>${escapeHtml(firstCountry(p))}</td>
            <td class="sa-cargo" title="${escapeHtml(p.facts?.cargo || "")}">${escapeHtml(String(p.facts?.cargo || "").slice(0, 60))}</td>
            <td>${stageChip(p.stage)}</td>
        </tr>`,
              )
              .join("")
        : `<tr><td colspan="8" class="ag-empty">Нічого не знайдено. Завантажте Excel з митної бази або змініть фільтри.</td></tr>`;
    $("poolMore").textContent = list.length > LIMIT ? `Показано ${LIMIT} з ${list.length}. Уточніть фільтри, щоб побачити інших.` : `Показано ${list.length}.`;
    $("poolAll").checked = shown.length > 0 && shown.every((p) => selected.has(p.id));
    updateSelected();
}

function updateSelected() {
    $("selCount").textContent = selected.size;
    $("enqueueBtn").disabled = !selected.size;
    $("skipBtn").disabled = !selected.size;
}

/* ---------------- Імпорт Excel ---------------- */

// Назви колонок з файлів аналізу (рос./укр.) → поля агента
const COLS = [
    [/^(компания|компанія|назва|company)$/i, "name"],
    [/^(едрпоу|єдрпоу|edrpou|код)$/i, "edrpou"],
    [/^машин в (?!экспорт|ца|tr|.*кавказ)/i, "trips"],
    [/^разных номеров|^різних номерів/i, "plates"],
    [/^ср\. вес|^сер\. вага/i, "avg_t"],
    [/^всего, т|^всього, т/i, "total_t"],
    [/^регионы|^регіони/i, "regions"],
    [/^страны|^країни|^куда \(направления\)|^откуда$/i, "countries"],
    [/^incoterms$/i, "incoterms"],
    [/^доля рейсов, где платит|^частка рейсів/i, "payer_share"],
    [/^тип тс/i, "vehicle"],
    [/^основной груз|^основний вантаж/i, "cargo"],
    [/пункт пропуска|пункт пропуску/i, "post"],
    [/^тип отправки|^тип відправки/i, "shipment_kind"],
    [/^доля машин с др|^частка машин/i, "shared_share"],
    [/^поставщиков|^постачальників/i, "suppliers"],
    [/^сегмент$/i, "segment_size"],
    [/^score$/i, "score"],
    [/^зацепка|^зачіпка/i, "hook"],
    [/^почему сейчас|^чому зараз/i, "why"],
    [/^груз \/ тип тс|^вантаж \/ тип/i, "extra"],
];
const SHEET_SEGMENTS = [
    [/food|реф/i, "food/реф"],
    [/сборн|збірн|ltl/i, "збірні"],
    [/кавказ|азия|азія|турц/i, "Туреччина/Кавказ/ЦА"],
    [/импорт\+экспорт|кругорейс/i, "кругорейси"],
    [/топ-?10/i, "топ-10"],
];
const MONTHS = { янв: 1, січ: 1, фев: 2, лют: 2, мар: 3, бер: 3, апр: 4, кві: 4, мая: 5, май: 5, тра: 5, июн: 6, чер: 6, июл: 7, лип: 7, авг: 8, сер: 8, сен: 9, вер: 9, окт: 10, жов: 10, ноя: 11, лис: 11, дек: 12, гру: 12 };

function mapRow(headers, row) {
    const out = {};
    headers.forEach((h, i) => {
        const key = COLS.find(([re]) => re.test(String(h || "").trim()))?.[1];
        if (key && out[key] === undefined && row[i] !== undefined && row[i] !== null && row[i] !== "") out[key] = row[i];
    });
    return out;
}

async function parseFile(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const byEdrpou = new Map();
    let trade = "";
    for (const sheetName of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true });
        if (rows.length < 2) continue;
        const headers = rows[0].map((h) => String(h || "").trim());
        if (!headers.some((h) => /едрпоу|єдрпоу|edrpou/i.test(h))) continue;
        if (!trade) {
            const joined = headers.join(" ").toLowerCase();
            if (/экспортёр|експортер/.test(joined)) trade = "Експорт";
            else if (/импортёр|імпортер/.test(joined)) trade = "Імпорт";
        }
        const seg = SHEET_SEGMENTS.find(([re]) => re.test(sheetName))?.[1] || "";
        for (const r of rows.slice(1)) {
            const m = mapRow(headers, r);
            if (!m.edrpou || !m.name) continue;
            const key = String(m.edrpou).replace(/\D/g, "");
            const prev = byEdrpou.get(key) || { segments: new Set() };
            // Аркуш «Все лиды» — основні дані; інші аркуші додають сегмент і зачіпку
            for (const [k, v] of Object.entries(m)) if (prev[k] === undefined || k === "hook" || k === "why") prev[k] = v;
            if (seg) prev.segments.add(seg);
            byEdrpou.set(key, prev);
        }
    }
    const list = [...byEdrpou.values()].map((r) => {
        const { segments, segment_size, ...rest } = r;
        if (segment_size) rest.extra = [rest.extra, segment_size].filter(Boolean).join(" · ");
        return { ...rest, segment: [...segments].join("; ") };
    });
    // Місяць з назви файлу: «…_август_2026.xlsx»
    const fname = file.name.toLowerCase();
    const year = (fname.match(/20\d{2}/) || [])[0];
    const mon = Object.entries(MONTHS).find(([k]) => fname.includes(k))?.[1];
    return { rows: list, trade, period: year && mon ? `${year}-${String(mon).padStart(2, "0")}` : "" };
}

$("importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    $("fileLabel").textContent = file.name;
    $("importInfo").textContent = "Читаю файл…";
    try {
        const r = await parseFile(file);
        parsedRows = r.rows;
        if (r.trade) $("importTrade").value = r.trade;
        if (r.period) $("importPeriod").value = r.period;
        $("importInfo").textContent = `Знайдено компаній: ${r.rows.length}${r.trade ? ` · ${r.trade}` : ""}`;
        $("importBtn").disabled = !r.rows.length;
    } catch (err) {
        $("importInfo").textContent = "Не вдалося прочитати файл: " + err.message;
    }
});

$("importBtn").addEventListener("click", () =>
    withBusy($("importBtn"), async () => {
        if (!parsedRows?.length) return;
        const trade = $("importTrade").value;
        if (!trade) throw new Error("Оберіть: експорт чи імпорт");
        let added = 0, updated = 0;
        for (let i = 0; i < parsedRows.length; i += 500) {
            $("importInfo").textContent = `Завантажую ${Math.min(i + 500, parsedRows.length)} з ${parsedRows.length}…`;
            const r = await api({ action: "import", rows: parsedRows.slice(i, i + 500), trade_type: trade, period: $("importPeriod").value });
            added += r.added;
            updated += r.updated;
        }
        $("importInfo").textContent = `Готово: нових ${added}, оновлено ${updated}.`;
        toast(`Пул оновлено: +${added} нових`);
        parsedRows = null;
        $("importBtn").disabled = true;
        await loadProspects();
    }),
);

/* ---------------- Дії з пулом ---------------- */

$("poolBody").addEventListener("change", (e) => {
    const cb = e.target.closest(".sa-sel");
    if (!cb) return;
    cb.checked ? selected.add(cb.dataset.id) : selected.delete(cb.dataset.id);
    updateSelected();
});
$("poolBody").addEventListener("click", (e) => {
    const a = e.target.closest(".sa-open");
    if (!a) return;
    e.preventDefault();
    openCard(a.dataset.id);
});
$("poolAll").addEventListener("change", (e) => {
    shownIds.forEach((id) => (e.target.checked ? selected.add(id) : selected.delete(id)));
    renderPool();
});
["poolSearch", "poolStage", "poolTrade", "poolSegment", "poolMinScore"].forEach((id) =>
    $(id).addEventListener("input", () => renderPool()),
);

$("enqueueBtn").addEventListener("click", () =>
    withBusy($("enqueueBtn"), async () => {
        const r = await api({ action: "enqueue", ids: [...selected] });
        toast(`У черзі пошуку: ${r.queued}. Агент почне протягом 10 хвилин.`);
        selected.clear();
        await loadProspects();
    }),
);
$("skipBtn").addEventListener("click", () =>
    withBusy($("skipBtn"), async () => {
        await api({ action: "set_stage", ids: [...selected], stage: "skip" });
        toast("Позначено «Не наш клієнт»");
        selected.clear();
        await loadProspects();
    }),
);

/* ---------------- Листи на схвалення ---------------- */

async function loadApprove() {
    const { data, error } = await sbClient
        .from("sales_messages")
        .select("*, sales_prospects(id, name, edrpou, score, trade_type, facts, segment), sales_contacts(person_name, position, source, confidence, verified)")
        .eq("status", "draft")
        .eq("direction", "out")
        .order("created_at", { ascending: true })
        .limit(100);
    if (error) {
        $("approveList").innerHTML = `<p class="ag-empty">Помилка: ${escapeHtml(error.message)}</p>`;
        return;
    }
    $("cntApprove").textContent = data.length;
    $("approveList").innerHTML = data.length
        ? data.map(draftHtml).join("")
        : `<p class="ag-empty">Немає листів на схвалення. Оберіть клієнтів у «Пул клієнтів» → «Шукати контакти» — агент знайде e-mail і підготує листи сам.</p>`;
}

function draftHtml(m) {
    const p = m.sales_prospects || {};
    const c = m.sales_contacts || {};
    const who = [c.person_name, c.position].filter(Boolean).join(", ");
    return `<article class="ag-item" data-id="${m.id}">
        <div class="ag-item-meta">
            <strong><a href="#" class="sa-open" data-id="${p.id}">${escapeHtml(p.name)}</a></strong>
            ${chip(m.step === 1 ? "Перший лист" : `Нагадування ${m.step - 1}`, m.step === 1 ? "" : "warn")}
            ${p.score != null ? chip("score " + p.score) : ""}
            ${p.trade_type ? chip(p.trade_type) : ""}
            ${p.facts?.trips ? chip(p.facts.trips + " машин/міс") : ""}
        </div>
        <div class="sa-to">
            <i class="bx bx-envelope"></i> <b>${escapeHtml(m.to_email)}</b>
            ${who ? `· ${escapeHtml(who)}` : ""}
            ${c.source ? chip(SOURCE_LABEL[c.source] || c.source) : ""}
            ${c.verified === false ? chip("домен без пошти", "bad") : ""}
            ${c.confidence != null ? `<span class="sa-muted">впевненість ${c.confidence}%</span>` : ""}
        </div>
        <input type="text" class="sa-subject" value="${escapeHtml(m.subject)}" maxlength="150" />
        <textarea rows="9">${escapeHtml(m.body)}</textarea>
        <div class="sa-sent-ask hidden">
            <span>Лист відкрито в Outlook. <b>Надіслали?</b></span>
            <button type="button" class="btn btn-primary" data-act="mark_sent"><i class="bx bx-check"></i> Так, надіслав</button>
            <button type="button" class="btn btn-secondary" data-act="not_sent">Ще ні</button>
        </div>
        <div class="ag-item-actions">
            <button type="button" class="btn btn-primary sa-mail-only" data-act="send" title="Лист піде клієнту одразу з вашої пошти"><i class="bx bx-send"></i> Надіслати</button>
            <button type="button" class="btn btn-secondary sa-mail-only" data-act="test" title="Цей самий лист — на вашу адресу, клієнту нічого не піде"><i class="bx bx-test-tube"></i> Тест собі</button>
            <button type="button" class="btn btn-secondary sa-outlook" data-act="outlook" title="Відкриє готовий лист у вашій пошті — перечитайте і натисніть «Надіслати» там"><i class="bx bx-envelope-open"></i> Відкрити в Outlook</button>
            <button type="button" class="btn btn-secondary" data-act="save"><i class="bx bx-save"></i> Зберегти</button>
            <button type="button" class="btn btn-secondary" data-act="reject"><i class="bx bx-x"></i> Не надсилати</button>
        </div>
    </article>`;
}

$("approveList").addEventListener("click", (e) => {
    const open = e.target.closest(".sa-open");
    if (open) {
        e.preventDefault();
        return openCard(open.dataset.id);
    }
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const item = btn.closest(".ag-item");
    const id = item.dataset.id;
    const subject = item.querySelector(".sa-subject").value;
    const body = item.querySelector("textarea").value;
    if (btn.dataset.act === "outlook") {
        openInOutlook(item.querySelector(".sa-to b").textContent.trim(), subject, body);
        api({ action: "save", id, subject, body }).catch(() => {});
        item.querySelector(".sa-sent-ask").classList.remove("hidden");
        return;
    }
    if (btn.dataset.act === "test") {
        const to = prompt("На яку адресу надіслати тест?", localStorage.getItem("fura_sales_test_to") || "");
        if (!to) return;
        try { localStorage.setItem("fura_sales_test_to", to); } catch (_) { /* без пам'яті */ }
        withBusy(btn, async () => {
            await api({ action: "send_test", to, subject, body });
            toast(`Тестовий лист надіслано на ${to}. Перевірте пошту (і папку «Спам»).`);
        });
        return;
    }
    if (btn.dataset.act === "not_sent") {
        item.querySelector(".sa-sent-ask").classList.add("hidden");
        return;
    }
    withBusy(btn, async () => {
        if (btn.dataset.act === "mark_sent") {
            await api({ action: "mark_sent", id, subject, body });
            toast("Позначено надісланим. Клієнт — у «Ліди» на етапі «Контакт», нагадування заплановано.");
        } else if (btn.dataset.act === "send") {
            await api({ action: "send", id, subject, body });
            toast("Лист надіслано. Клієнт — у «Ліди» на етапі «Контакт».");
        } else if (btn.dataset.act === "save") {
            await api({ action: "save", id, subject, body });
            toast("Збережено");
            return;
        } else {
            await api({ action: "reject", id });
            toast("Лист не надсилатиметься");
        }
        item.remove();
        $("cntApprove").textContent = document.querySelectorAll("#approveList .ag-item").length;
        loadStatus();
    });
});

/* Відкрити готовий лист у поштовій програмі (Outlook / Пошта) — надсилає сама людина зі своєї адреси.
 * У кінці — рядок про відписку, якщо агент його не додав. */
function openInOutlook(to, subject, body) {
    let text = String(body || "").replace(/\r?\n/g, "\r\n");
    if (!/не хочете|не бажаєте|відпис|не пишіть/i.test(text)) {
        text += "\r\n\r\nЯкщо вам це не цікаво — просто дайте знати, і я більше не писатиму.";
    }
    const url = `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(text)}`;
    // дуже довгий лист деякі програми обрізають — тоді копіюємо текст у буфер
    if (url.length > 7500 && navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => {});
        toast("Лист довгий — текст скопійовано: у новому листі натисніть Cmd+V");
        location.href = `mailto:${to}?subject=${encodeURIComponent(subject || "")}`;
        return;
    }
    location.href = url;
}

/* ---------------- Відповіді й надіслані ---------------- */

async function loadReplies() {
    const { data } = await sbClient
        .from("sales_messages")
        .select("*, sales_prospects(id, name, lead_id)")
        .eq("direction", "in")
        .order("created_at", { ascending: false })
        .limit(100);
    const list = data || [];
    $("cntReplies").textContent = list.filter((m) => !["auto"].includes(m.classification) && Date.now() - new Date(m.created_at) < 7 * 86400_000).length;
    $("repliesList").innerHTML = list.length
        ? list
              .map((m) => {
                  const [label, cls] = CLASS_LABEL[m.classification] || [m.classification || "—", ""];
                  const p = m.sales_prospects || {};
                  return `<article class="ag-item reply">
                    <div class="ag-item-meta">
                        <strong><a href="#" class="sa-open" data-id="${p.id}">${escapeHtml(p.name)}</a></strong>
                        ${chip(label, cls)}
                        <span>${escapeHtml(m.to_email || "")}</span>
                        <span>${fmtDateTime(m.created_at)}</span>
                        ${p.lead_id ? `<a class="ag-link" href="leads.html?open=${encodeURIComponent(p.lead_id)}">Картка в «Ліди»</a>` : ""}
                    </div>
                    ${m.summary ? `<div class="sa-summary"><i class="bx bx-bot"></i> ${escapeHtml(m.summary)}</div>` : ""}
                    <div class="ag-item-text">${escapeHtml(m.body)}</div>
                </article>`;
              })
              .join("")
        : `<p class="ag-empty">Відповідей поки немає. Відповідь можна також вставити вручну в картці клієнта.</p>`;
}

async function loadSent() {
    const { data } = await sbClient
        .from("sales_messages")
        .select("id, step, status, to_email, subject, sent_at, due_at, error, created_at, sales_prospects(id, name)")
        .eq("direction", "out")
        .in("status", ["sent", "scheduled", "failed"])
        .order("created_at", { ascending: false })
        .limit(150);
    const list = data || [];
    $("sentList").innerHTML = list.length
        ? `<table class="sa-table"><thead><tr><th>Клієнт</th><th>Лист</th><th>Кому</th><th>Стан</th><th>Коли</th></tr></thead><tbody>` +
          list
              .map((m) => {
                  const st =
                      m.status === "sent" ? chip("Надіслано", "good") : m.status === "scheduled" ? chip("Заплановано", "warn") : chip("Помилка", "bad");
                  return `<tr>
                    <td><a href="#" class="sa-open" data-id="${m.sales_prospects?.id}">${escapeHtml(m.sales_prospects?.name || "")}</a></td>
                    <td>${m.step === 1 ? "Перший" : "Нагадування " + (m.step - 1)}<div class="sa-muted">${escapeHtml(m.subject || "")}</div></td>
                    <td>${escapeHtml(m.to_email || "")}</td>
                    <td>${st}${m.error ? `<div class="sa-muted">${escapeHtml(m.error)}</div>` : ""}</td>
                    <td>${fmtDateTime(m.sent_at || m.due_at)}</td>
                </tr>`;
              })
              .join("") +
          `</tbody></table>`
        : `<p class="ag-empty">Ще нічого не надіслано.</p>`;
}

["repliesList", "sentList"].forEach((id) =>
    $(id).addEventListener("click", (e) => {
        const a = e.target.closest(".sa-open");
        if (!a) return;
        e.preventDefault();
        openCard(a.dataset.id);
    }),
);

/* ---------------- Картка клієнта ---------------- */

async function openCard(id) {
    if (!id) return;
    currentCard = id;
    $("cardOverlay").classList.add("active");
    $("cardBody").innerHTML = `<p class="ag-empty">Завантаження…</p>`;
    const [{ data: p }, { data: contacts }, { data: msgs }] = await Promise.all([
        sbClient.from("sales_prospects").select("*").eq("id", id).maybeSingle(),
        sbClient.from("sales_contacts").select("*").eq("prospect_id", id).order("is_primary", { ascending: false }).order("confidence", { ascending: false }),
        sbClient.from("sales_messages").select("*").eq("prospect_id", id).order("created_at", { ascending: true }),
    ]);
    if (!p) {
        $("cardBody").innerHTML = `<p class="ag-empty">Клієнта не знайдено.</p>`;
        return;
    }
    $("cardTitle").textContent = p.name;
    const f = p.facts || {};
    const facts = [
        ["ЄДРПОУ", p.edrpou],
        ["Тип", p.trade_type],
        ["Період бази", p.period],
        ["Score", p.score],
        ["Машин за місяць", f.trips],
        ["Країни", f.countries],
        ["Вантаж", f.cargo],
        ["Тип ТЗ", f.vehicle],
        ["Тип відправки", f.shipment_kind],
        ["Сер. вага, т", f.avg_t],
        ["Пункт пропуску", f.post],
        ["Incoterms", f.incoterms],
        ["Платить фрахт (UA)", f.payer_share],
        ["Сегмент", p.segment],
        ["Сайт", p.website ? `<a href="${escapeHtml(/^https?:/.test(p.website) ? p.website : "https://" + p.website)}" target="_blank" rel="noopener">${escapeHtml(p.website)}</a>` : null],
        ["Керівник", p.director],
    ].filter(([, v]) => v !== null && v !== undefined && v !== "");

    const contactRows = (contacts || [])
        .map(
            (c) => `<tr>
            <td>${c.is_primary ? '<i class="bx bxs-star sa-star" title="Пишемо сюди"></i>' : c.kind === "email" ? `<button type="button" class="sa-link-btn" data-primary="${c.id}" title="Писати сюди">☆</button>` : ""}</td>
            <td>${escapeHtml(c.kind)}</td>
            <td><b>${escapeHtml(c.value)}</b>${c.person_name || c.position ? `<div class="sa-muted">${escapeHtml([c.person_name, c.position].filter(Boolean).join(", "))}</div>` : ""}</td>
            <td>${c.source_url ? `<a href="${escapeHtml(c.source_url)}" target="_blank" rel="noopener">${escapeHtml(SOURCE_LABEL[c.source] || c.source)}</a>` : escapeHtml(SOURCE_LABEL[c.source] || c.source)}</td>
            <td>${c.confidence}%${c.verified === false ? " " + chip("без MX", "bad") : ""}</td>
        </tr>`,
        )
        .join("");

    const log = (Array.isArray(p.enrich_log) ? p.enrich_log : [])
        .filter((l) => l.step !== "start")
        .map((l) => `<li class="${l.ok ? "" : "sa-bad"}"><b>${escapeHtml(SOURCE_LABEL[l.step] || l.step)}</b>: ${escapeHtml(l.note || "")}</li>`)
        .join("");

    const msgsHtml = (msgs || [])
        .filter((m) => m.status !== "scheduled" || m.direction === "in")
        .map((m) => {
            const lbl = m.direction === "in" ? (CLASS_LABEL[m.classification] || ["Відповідь", ""]) : [m.status === "sent" ? "Надіслано" : m.status === "draft" ? "Чернетка" : m.status, ""];
            return `<div class="sa-msg ${m.direction}">
                <div class="ag-item-meta">${chip(lbl[0], lbl[1])} <span>${fmtDateTime(m.sent_at || m.created_at)}</span> ${m.subject ? `<span>${escapeHtml(m.subject)}</span>` : ""}</div>
                <div class="ag-item-text">${escapeHtml(m.body)}</div>
            </div>`;
        })
        .join("");

    $("cardBody").innerHTML = `
        <div class="sa-card-grid">
            <div>
                <dl class="sa-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${k === "Сайт" ? v : escapeHtml(v)}</dd>`).join("")}</dl>
                ${p.hook ? `<div class="sa-summary"><i class="bx bx-bulb"></i> ${escapeHtml(p.hook)}</div>` : ""}
                <div class="sa-actions">
                    <button type="button" class="btn btn-primary" data-card="enrich"><i class="bx bx-search-alt"></i> Знайти контакти зараз</button>
                    <button type="button" class="btn btn-secondary" data-card="draft"><i class="bx bx-edit"></i> Підготувати лист</button>
                    <button type="button" class="btn btn-secondary" data-card="skip"><i class="bx bx-block"></i> Не наш клієнт</button>
                    ${p.lead_id ? `<a class="btn btn-secondary" href="leads.html?open=${encodeURIComponent(p.lead_id)}"><i class="bx bx-briefcase-alt-2"></i> Картка в «Ліди»</a>` : ""}
                </div>
                ${log ? `<h3>Що шукав агент${p.enriched_at ? ` · ${fmtDateTime(p.enriched_at)}` : ""}</h3><ul class="sa-log">${log}</ul>` : ""}
            </div>
            <div>
                <h3>Контакти</h3>
                ${contactRows ? `<table class="sa-table sa-contacts"><tbody>${contactRows}</tbody></table>` : `<p class="ag-empty">Контактів ще немає.</p>`}
                <form class="sa-add" id="addContactForm">
                    <select name="kind"><option value="email">e-mail</option><option value="phone">телефон</option><option value="person">людина</option><option value="website">сайт</option><option value="linkedin">LinkedIn</option></select>
                    <input name="value" placeholder="Значення" required />
                    <input name="person_name" placeholder="Ім'я" />
                    <input name="position" placeholder="Посада" />
                    <label class="ag-check-inline"><input type="checkbox" name="primary" checked /> писати сюди</label>
                    <button type="submit" class="btn btn-secondary"><i class="bx bx-plus"></i> Додати</button>
                </form>
                <h3>Листування</h3>
                ${msgsHtml || `<p class="ag-empty">Листів ще не було.</p>`}
                <form class="sa-reply" id="manualReplyForm">
                    <textarea name="text" rows="4" placeholder="Клієнт відповів не на ящик агента (у Viber, телефоном)? Вставте відповідь — агент розбере її й оновить картку в «Ліди»."></textarea>
                    <button type="submit" class="btn btn-secondary"><i class="bx bx-message-add"></i> Додати відповідь клієнта</button>
                </form>
            </div>
        </div>`;
}

$("cardBody").addEventListener("click", (e) => {
    const prim = e.target.closest("[data-primary]");
    if (prim) {
        return withBusy(prim, async () => {
            await api({ action: "set_primary", contact_id: prim.dataset.primary });
            openCard(currentCard);
        });
    }
    const btn = e.target.closest("button[data-card]");
    if (!btn) return;
    const id = currentCard;
    withBusy(btn, async () => {
        if (btn.dataset.card === "enrich") {
            btn.innerHTML = `<i class="bx bx-loader-alt bx-spin"></i> Шукаю (до хвилини)…`;
            const r = await api({ action: "enrich_now", id });
            toast(r.primary ? `Знайдено: ${r.primary}` : "E-mail не знайдено — подивіться телефони або додайте вручну", !r.primary);
        } else if (btn.dataset.card === "draft") {
            await api({ action: "draft", id });
            toast("Лист готовий — у вкладці «На схвалення»");
            loadApprove();
        } else if (btn.dataset.card === "skip") {
            await api({ action: "set_stage", id, stage: "skip" });
            toast("Позначено «Не наш клієнт»");
        }
        await openCard(id);
        loadProspects();
    });
});

$("cardBody").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const btn = form.querySelector("button[type=submit]");
    withBusy(btn, async () => {
        if (form.id === "addContactForm") {
            await api({
                action: "add_contact",
                prospect_id: currentCard,
                kind: fd.get("kind"),
                value: fd.get("value"),
                person_name: fd.get("person_name"),
                position: fd.get("position"),
                primary: fd.get("primary") === "on",
            });
            toast("Контакт додано");
        } else if (form.id === "manualReplyForm") {
            const r = await api({ action: "manual_reply", id: currentCard, text: fd.get("text") });
            toast(`Відповідь: ${(CLASS_LABEL[r.classification] || [r.classification])[0]}`);
            loadReplies();
        }
        await openCard(currentCard);
        loadProspects();
    });
});

function closeCard() {
    $("cardOverlay").classList.remove("active");
    currentCard = null;
}
$("cardClose").addEventListener("click", closeCard);
$("cardOverlay").addEventListener("click", (e) => {
    if (e.target.id === "cardOverlay") closeCard();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && currentCard) closeCard();
});

/* ---------------- Вкладки ---------------- */

function showTab(tab) {
    document.querySelectorAll(".sa-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".sa-panel").forEach((p) => (p.hidden = p.dataset.panel !== tab));
    if (document.body.classList.contains("sa-only-mail")) return;
    try {
        localStorage.setItem("fura-sales-tab", tab);
    } catch (_) {}
}
document.querySelectorAll(".sa-tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

/* ---------------- Старт ---------------- */

function refreshAll() {
    loadProspects();
    loadApprove();
    loadReplies();
    loadSent();
}

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

    $("poolStage").innerHTML =
        `<option value="__active">Усі, крім «Не наш» і відмов</option><option value="">Усі етапи</option>` +
        Object.entries(STAGES)
            .map(([v, s]) => `<option value="${v}">${s.label}</option>`)
            .join("");

    const onlyMail = document.body.classList.contains("sa-only-mail");
    let tab = "approve";
    try {
        tab = localStorage.getItem("fura-sales-tab") || "approve";
    } catch (_) {}
    if (onlyMail) tab = "mail";
    showTab(tab);

    await loadStatus();
    if (onlyMail) { document.querySelector('.sa-tab[data-tab="mail"]').click(); return; }
    refreshAll();

    const params = new URLSearchParams(location.search);
    if (params.get("p")) openCard(params.get("p"));

    // Нові контакти, листи й відповіді з'являються самі
    let t = null;
    const later = () => {
        clearTimeout(t);
        t = setTimeout(refreshAll, 600);
    };
    sbClient
        .channel("sales-agent")
        .on("postgres_changes", { event: "*", schema: "public", table: "sales_messages" }, later)
        .on("postgres_changes", { event: "*", schema: "public", table: "sales_prospects" }, later)
        .subscribe();
});


/* ---------------- Написати лист: кому завгодно, копія, прихована копія, вкладення ---------------- */
(() => {
    const box = $("saCompose"), form = $("saComposeForm");
    document.body.appendChild(box); // поза сторінкою — щоб вікно правильно рухалось по всьому екрану
    if (!box || !form) return;
    let files = [];
    const DRAFT = "fura_compose_draft";
    /* ---- підпис, як в Outlook (зберігається в цьому браузері) ---- */
    const SIG_KEY = "fura_compose_sig";
    const SIG_DEF = { greet: "Best regards,", name: "", title: "", company: "GRANDAR LLC", phone: "", email: "", on: true };
    const sigGet = () => { try { return { ...SIG_DEF, ...JSON.parse(localStorage.getItem(SIG_KEY) || "{}") }; } catch (_) { return { ...SIG_DEF }; } };
    const sigRead = () => {
        const o = { on: $("saSigOn").checked, ts: Date.now() };
        document.querySelectorAll("#saSig [data-sig]").forEach((el) => (o[el.dataset.sig] = el.value.trim()));
        return o;
    };
    function sigShow(save) {
        const g = sigRead();
        if (save === true) try { localStorage.setItem(SIG_KEY, JSON.stringify(g)); } catch (_) { /* без пам'яті */ }
        $("saSigShort").textContent = g.on ? [g.name, g.title].filter(Boolean).join(" | ") || "заповніть ім'я" : "без підпису";
        const line = (t) => (t ? `<p>${escapeHtml(t)}</p>` : "");
        $("saSigPrev").innerHTML = g.on ? `${line(g.greet)}${line([g.name, g.title].filter(Boolean).join(" | "))}${line(g.company)}${line(g.phone)}${g.email ? `<p><u>${escapeHtml(g.email)}</u></p>` : ""}<img src="email-logo.png" alt="GRANDAR" width="96" />` : "";
    }
    function sigFill() {
        const g = sigGet();
        if (!g.email && status?.from) g.email = (String(status.from).match(/<([^>]+)>/) || [])[1] || "";
        $("saSigOn").checked = g.on !== false;
        document.querySelectorAll("#saSig [data-sig]").forEach((el) => (el.value = g[el.dataset.sig] || ""));
        sigShow();
        if (!g.name) $("saSig").open = true;
    }
    // підпис зберігається у вашому профілі FURA — однаковий у Chrome, Safari і на телефоні
    let sigT = 0;
    const sigCloudSave = () => {
        clearTimeout(sigT);
        sigT = setTimeout(() => { sbClient.auth.updateUser({ data: { fura_sig: { ...sigRead(), ts: Date.now() } } }).catch(() => {}); }, 1500);
    };
    (async () => {
        try {
            const { data } = await sbClient.auth.getUser();
            const c = data?.user?.user_metadata?.fura_sig;
            const loc = sigGet();
            if (c && (c.ts || 0) >= (loc.ts || 0) && (c.name || c.phone || c.title)) {
                localStorage.setItem(SIG_KEY, JSON.stringify(c));
                if (!box.classList.contains("hidden")) sigFill();
            } else if (!c && (loc.name || loc.phone)) {
                sbClient.auth.updateUser({ data: { fura_sig: { ...loc, ts: Date.now() } } }).catch(() => {}); // перенести підпис з цього браузера в профіль
            }
        } catch (_) { /* без мережі — лишається підпис цього браузера */ }
    })();
    $("saSig").addEventListener("input", () => { sigShow(true); sigCloudSave(); });
    $("saSigOn").addEventListener("change", () => { sigShow(true); sigCloudSave(); });
    const showFiles = () => {
        $("saCmpFileList").innerHTML = (typeof loadingFiles !== "undefined" && loadingFiles > 0 ? `<span class="sa-cmp-file">⏳ завантажую файли з листа (${loadingFiles})…</span> ` : "") + files.map((f, i) => `<span class="sa-cmp-file">${escapeHtml(f.name)} <small>${Math.ceil(f.size / 1024)} КБ</small> <button type="button" data-rm="${i}" title="Прибрати">&times;</button></span>`).join("");
    };
    // Чернетка: одразу в браузері + за кілька секунд — у папку «Чернетки» на пошті (видно і в Outlook)
    let draft = { uid: 0, folder: "" }, dirty = false, dT = 0, saving = Promise.resolve();
    const hasContent = () => !!(form.to.value.trim() || form.subject.value.trim() || form.body.value.trim());
    const localPut = (extra = {}) => {
        try {
            localStorage.setItem(DRAFT, JSON.stringify({ to: form.to.value, cc: form.cc.value, bcc: form.bcc.value, subject: form.subject.value, body: form.body.value,
                in_reply_to: inReplyTo, quote: qText, draft_uid: draft.uid, draft_folder: draft.folder, dirty, ...extra }));
        } catch (_) { /* без пам'яті */ }
    };
    const savedMark = (t) => { const el = $("saCmpSaved"); if (el) el.textContent = t; };
    function pushDraft() {
        clearTimeout(dT);
        if (!dirty || !hasContent() || (status && !status.mail_reader)) return saving;
        dirty = false;
        const payload = { action: "mail_draft", to: form.to.value, cc: form.cc.value, bcc: form.bcc.value, subject: form.subject.value, body: form.body.value + (qText ? "\n\n\n" + qText : ""), in_reply_to: inReplyTo || undefined };
        savedMark("зберігаю…");
        const cur = draft; // саме цей лист (якщо тим часом відкрили інший — не переплутати)
        saving = saving.then(async () => {
            const r = await api({ ...payload, draft_uid: cur.uid || undefined, draft_folder: cur.folder || undefined });
            Object.assign(cur, { uid: r?.uid || 0, folder: r?.folder || "" });
            if (cur !== draft) return window.dispatchEvent(new Event("fura-draft-saved"));
            localPut();
            savedMark("збережено в «Чернетках» " + new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }));
            window.dispatchEvent(new Event("fura-draft-saved"));
        }).catch(() => { if (cur === draft) { dirty = true; localPut(); savedMark("чернетка поки лише в цьому браузері"); } });
        return saving;
    }
    const saveDraft = () => {
        dirty = true;
        localPut();
        clearTimeout(dT);
        dT = setTimeout(pushDraft, 4000);
    };
    let SALES_MAILS = null;
    async function fillMails() {
        // підказки адрес: «Адреси» з пошти + контакти з AI-продажів
        if (SALES_MAILS) return;
        try {
            const { data } = await sbClient.from("sales_contacts").select("value, person_name").eq("kind", "email").limit(2000);
            SALES_MAILS = (data || []).map((c) => ({ email: c.value, name: c.person_name || "", company: "" }));
        } catch (_) { SALES_MAILS = []; }
    }
    // випадаючі підказки для «Кому / Копія / Прихована» — підказує по останній адресі після коми
    const sugBox = document.createElement("div");
    sugBox.className = "sa-cmp-sug"; sugBox.hidden = true;
    form.appendChild(sugBox);
    let sugFor = null, sugItems = [], sugI = 0;
    const lastTok = (v) => v.split(/[,;]/).pop().trim();
    function sugShow(inp) {
        const t = lastTok(inp.value).toLowerCase();
        if (t.length < 1) { sugBox.hidden = true; return; }
        const have = new Set((inp.value.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi) || []).map((x) => x.toLowerCase()));
        const seen = new Set();
        sugItems = [...(window.furaMailBook?.list || []), ...(SALES_MAILS || [])].filter((c) => {
            const e = String(c.email || "").toLowerCase();
            if (!e || seen.has(e) || (have.has(e) && e !== t)) return false;
            seen.add(e);
            return [e, c.name, c.company].join(" ").toLowerCase().includes(t);
        }).slice(0, 8);
        if (!sugItems.length) { sugBox.hidden = true; return; }
        sugFor = inp; sugI = 0;
        sugBox.innerHTML = sugItems.map((c, i) => `<button type="button" class="${i === 0 ? "on" : ""}" data-sug="${i}"><b>${escapeHtml(c.name || c.email)}</b> <span>${escapeHtml(c.email)}${c.company ? " · " + escapeHtml(c.company) : ""}</span></button>`).join("");
        const r = inp.getBoundingClientRect(), fr = form.getBoundingClientRect();
        Object.assign(sugBox.style, { left: r.left - fr.left + "px", top: r.bottom - fr.top + form.scrollTop + 4 + "px", width: r.width + "px" });
        sugBox.hidden = false;
    }
    function sugPick(i) {
        const c = sugItems[i]; if (!c || !sugFor) return;
        const parts = sugFor.value.split(/[,;]/); parts.pop();
        sugFor.value = [...parts.map((x) => x.trim()).filter(Boolean), c.email].join(", ") + ", ";
        sugBox.hidden = true; sugFor.focus(); saveDraft();
    }
    ["to", "cc", "bcc"].forEach((k) => {
        const inp = form[k];
        inp.removeAttribute("list");
        inp.addEventListener("input", () => sugShow(inp));
        inp.addEventListener("focus", () => fillMails());
        inp.addEventListener("blur", () => setTimeout(() => { if (sugFor === inp) sugBox.hidden = true; }, 150));
        inp.addEventListener("keydown", (e) => {
            if (sugBox.hidden || sugFor !== inp) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault(); sugI = (sugI + (e.key === "ArrowDown" ? 1 : -1) + sugItems.length) % sugItems.length;
                sugBox.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", i === sugI));
            } else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); sugPick(sugI); }
            else if (e.key === "Escape") { e.stopPropagation(); sugBox.hidden = true; }
        });
    });
    sugBox.addEventListener("mousedown", (e) => { const b = e.target.closest("[data-sug]"); if (b) { e.preventDefault(); sugPick(Number(b.dataset.sug)); } });
    // Файли з інших листів: «Скопіювати файл» у листі → «Вставити скопійовані» тут; при пересиланні — самі
    $("saCmpFileList").insertAdjacentHTML("beforebegin", '<button type="button" class="btn btn-secondary sa-cmp-paste" id="saCmpPaste" hidden><i class="bx bx-paste"></i> <span></span></button>');
    const clipList = () => { try { return JSON.parse(localStorage.getItem("fura_mail_fileclip") || "[]"); } catch (_) { return []; } };
    const pasteShow = () => { const n = clipList().length, b = $("saCmpPaste"); b.hidden = !n; b.querySelector("span").textContent = `Вставити скопійовані (${n})`; };
    window.addEventListener("fura-fileclip", pasteShow);
    window.addEventListener("storage", (e) => { if (e.key === "fura_mail_fileclip") pasteShow(); });
    let loadingFiles = 0;
    async function addRemote(items) {
        if (typeof window.furaMailFile !== "function") return toast("Відкрийте сторінку «Пошта», щоб вкладати файли з листів", true);
        loadingFiles += items.length; showFiles();
        for (const it of items) {
            try { const f = await window.furaMailFile(it); if (!files.some((x) => x.name === f.name && x.size === f.size)) files.push(f); }
            catch (er) { toast(`Файл «${it.name}» не вдалося взяти: ${er.message}`, true); }
            loadingFiles--; showFiles();
        }
    }
    $("saCmpPaste").addEventListener("click", async () => {
        const items = clipList();
        try { localStorage.removeItem("fura_mail_fileclip"); } catch (_) { /* */ }
        pasteShow();
        await addRemote(items);
    });
    let inReplyTo = "";
    // Попередній лист (відповідь / пересилання) — не в тексті, а окремо під підписом, як в Outlook
    let qText = "";
    form.body.insertAdjacentHTML("afterend", `<div class="sa-cmp-quote" id="saCmpQuote" hidden>
        <button type="button" class="sa-cmp-qtoggle" data-q="toggle">··· попередній лист піде нижче вашого підпису</button>
        <button type="button" class="sa-cmp-qrm" data-q="rm" title="Не додавати попередній лист">прибрати</button>
        <pre class="sa-cmp-qtext" hidden></pre></div>`);
    const qBox = $("saCmpQuote");
    const qShow = () => { qBox.hidden = !qText; qBox.querySelector("pre").textContent = qText; };
    qBox.addEventListener("click", (e) => {
        const b = e.target.closest("[data-q]"); if (!b) return;
        if (b.dataset.q === "toggle") { const pre = qBox.querySelector("pre"); pre.hidden = !pre.hidden; }
        if (b.dataset.q === "rm") { qText = ""; qShow(); saveDraft(); }
    });
    // вікно листа — збоку внизу, як у Gmail: можна відкривати інші листи, згорнути «_» або розгорнути на весь екран
    const head = box.querySelector(".sa-cmp-head");
    $("saCmpFrom").insertAdjacentHTML("afterend", '<span class="sa-cmp-saved" id="saCmpSaved"></span>');
    form.querySelector(".sa-cmp-foot [data-cmp-close]")?.insertAdjacentHTML("beforebegin", '<button type="button" class="btn btn-secondary sa-cmp-discard" data-cmp-discard title="Видалити лист і чернетку"><i class="bx bx-trash"></i></button>');
    const headTitle = head.querySelector("b");
    head.querySelector("[data-cmp-close]").insertAdjacentHTML("beforebegin",
        '<button type="button" class="sa-cmp-hb" data-cmp-min title="Згорнути / розгорнути"><i class="bx bx-minus"></i></button>' +
        '<button type="button" class="sa-cmp-hb" data-cmp-big title="На весь екран / збоку"><i class="bx bx-expand-alt"></i></button>');
    // вікно можна перетягувати за темну смужку; місце запам'ятовується
    const POS = "fura_compose_pos";
    const placeAt = (x, y) => {
        const w = box.offsetWidth, h = box.querySelector(".sa-cmp-box").offsetHeight;
        x = Math.max(0, Math.min(x, innerWidth - w)); y = Math.max(0, Math.min(y, innerHeight - Math.min(h, 60)));
        Object.assign(box.style, { left: x + "px", top: y + "px", right: "auto", bottom: "auto" });
        box.classList.add("moved");
        return { x, y };
    };
    const unplace = () => { Object.assign(box.style, { left: "", top: "", right: "", bottom: "" }); box.classList.remove("moved"); };
    const restorePos = () => {
        if (typeof restoreSize === "function") restoreSize();
        if (box.classList.contains("min") || box.classList.contains("big") || innerWidth < 700) return unplace();
        let p = null; try { p = JSON.parse(localStorage.getItem(POS) || "null"); } catch (_) { p = null; }
        if (p) placeAt(p.x, p.y); else unplace();
    };
    head.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest("button") || box.classList.contains("min") || box.classList.contains("big") || innerWidth < 700) return;
        e.preventDefault();
        const r = box.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        head.setPointerCapture?.(e.pointerId);
        head.classList.add("dragging");
        let last = null;
        const mv = (ev) => { last = placeAt(ev.clientX - dx, ev.clientY - dy); };
        const up = () => {
            head.classList.remove("dragging");
            head.removeEventListener("pointermove", mv); head.removeEventListener("pointerup", up); head.removeEventListener("pointercancel", up);
            if (last) try { localStorage.setItem(POS, JSON.stringify(last)); } catch (_) { /* без пам'яті */ }
        };
        head.addEventListener("pointermove", mv); head.addEventListener("pointerup", up); head.addEventListener("pointercancel", up);
    });
    // розмір: тягніть за краї або кути вікна; розмір запам'ятовується
    const SIZE = "fura_compose_size";
    const inner = box.querySelector(".sa-cmp-box");
    ["n", "s", "e", "w", "ne", "nw", "se", "sw"].forEach((d) => box.insertAdjacentHTML("beforeend", `<span class="sa-cmp-rs rs-${d}" data-rs="${d}"></span>`));
    const applySize = (w, h) => {
        w = Math.max(380, Math.min(w, innerWidth - 8)); h = Math.max(260, Math.min(h, innerHeight - 8));
        box.style.width = w + "px"; inner.style.height = h + "px"; inner.style.maxHeight = "none";
        box.classList.add("sized");
        return { w, h };
    };
    const unsize = () => { box.style.width = ""; inner.style.height = ""; inner.style.maxHeight = ""; box.classList.remove("sized"); };
    const restoreSize = () => {
        if (box.classList.contains("min") || box.classList.contains("big") || innerWidth < 700) return unsize();
        let z = null; try { z = JSON.parse(localStorage.getItem(SIZE) || "null"); } catch (_) { z = null; }
        if (z) applySize(z.w, z.h); else unsize();
    };
    box.addEventListener("pointerdown", (e) => {
        const hd = e.target.closest("[data-rs]");
        if (!hd || e.button !== 0 || box.classList.contains("min") || box.classList.contains("big")) return;
        e.preventDefault();
        const d = hd.dataset.rs, r = box.getBoundingClientRect(), ih = inner.getBoundingClientRect().height;
        const sx = e.clientX, sy = e.clientY;
        placeAt(r.left, r.top); // далі рахуємо від лівого верхнього кута
        hd.setPointerCapture?.(e.pointerId);
        document.body.classList.add("sa-cmp-resizing");
        let pos = { x: r.left, y: r.top }, size = { w: r.width, h: ih };
        const mv = (ev) => {
            const dx = ev.clientX - sx, dy = ev.clientY - sy;
            let w = r.width, h = ih, x = r.left, y = r.top;
            if (d.includes("e")) w = r.width + dx;
            if (d.includes("w")) { w = r.width - dx; x = r.left + dx; }
            if (d.includes("s")) h = ih + dy;
            if (d.includes("n")) { h = ih - dy; y = r.top + dy; }
            size = applySize(w, h);
            if (d.includes("w")) x = r.left + r.width - size.w;
            if (d.includes("n")) y = r.top + ih - size.h;
            pos = placeAt(x, y);
        };
        const up = () => {
            document.body.classList.remove("sa-cmp-resizing");
            hd.removeEventListener("pointermove", mv); hd.removeEventListener("pointerup", up); hd.removeEventListener("pointercancel", up);
            try { localStorage.setItem(SIZE, JSON.stringify(size)); localStorage.setItem(POS, JSON.stringify(pos)); } catch (_) { /* */ }
        };
        hd.addEventListener("pointermove", mv); hd.addEventListener("pointerup", up); hd.addEventListener("pointercancel", up);
    });
    // подвійний клік по смужці — повернути в правий нижній кут і звичайний розмір
    head.addEventListener("dblclick", (e) => { if (e.target.closest("button") || box.classList.contains("min")) return; try { localStorage.removeItem(POS); localStorage.removeItem(SIZE); } catch (_) { /* */ } unsize(); unplace(); });
    addEventListener("resize", () => { if (!box.classList.contains("hidden")) restorePos(); });
    const setMode = (min, big) => {
        box.classList.toggle("min", !!min); box.classList.toggle("big", !!big && !min);
        restorePos();
        head.querySelector("[data-cmp-min] i").className = "bx " + (min ? "bx-chevron-up" : "bx-minus");
        head.querySelector("[data-cmp-big] i").className = "bx " + (box.classList.contains("big") ? "bx-collapse-alt" : "bx-expand-alt");
        document.body.classList.toggle("sa-cmp-big", box.classList.contains("big"));
        titleUpd();
    };
    const titleUpd = () => { headTitle.textContent = box.classList.contains("min") && form.subject.value.trim() ? form.subject.value.trim() : "Новий лист"; };
    head.addEventListener("click", (e) => {
        if (e.target.closest("[data-cmp-min]")) return setMode(!box.classList.contains("min"), false);
        if (e.target.closest("[data-cmp-big]")) return setMode(false, !box.classList.contains("big"));
        if (box.classList.contains("min") && !e.target.closest("button")) setMode(false, false); // клік по згорнутому — розгорнути
    });
    const hasText = () => !box.classList.contains("hidden") && (form.body.value.trim() || form.to.value.trim() || files.length);
    function open(pre = {}, addFiles = []) {
        if (pre instanceof Event) pre = {};
        // уже пишете лист: «Написати» без нічого — просто показати його; відповідь/пересилання — спитати
        if (hasText()) {
            if (!Object.keys(pre).length && !addFiles.length) { setMode(false, box.classList.contains("big")); return form.body.focus(); }
            if (!confirm("У вас відкритий недописаний лист. Закрити його і почати новий?")) { setMode(false, box.classList.contains("big")); return; }
        }
        if (hasText()) { dirty = true; pushDraft(); } // старий лист — у «Чернетки»
        let d = {};
        try { d = JSON.parse(localStorage.getItem(DRAFT) || "{}"); } catch (_) { d = {}; }
        const v = Object.keys(pre).length ? pre : d; // відповідь / пересилання — без старої чернетки
        inReplyTo = v.in_reply_to || "";
        qText = v.quote || "";
        qShow();
        draft = { uid: Number(v.draft_uid) || 0, folder: v.draft_folder || "" };
        dirty = !!v.dirty;
        savedMark(draft.uid ? "з «Чернеток»" : "");
        ["to", "cc", "bcc", "subject", "body"].forEach((k) => (form[k].value = v[k] || ""));
        files = [...addFiles];
        showFiles();
        if (Array.isArray(pre.remote) && pre.remote.length) addRemote(pre.remote); // пересилання — з файлами
        $("saCmpFrom").textContent = status?.mail_box || status?.from ? `від ${status.mail_box || status.from}` : "";
        sigFill();
        pasteShow();
        box.classList.remove("hidden");
        setMode(false, false);
        document.body.classList.add("sa-cmp-open");
        setTimeout(() => (form.to.value ? form.body : form.to).focus(), 30);
        fillMails();
    }
    const close = () => { box.classList.add("hidden"); box.classList.remove("min", "big"); document.body.classList.remove("sa-cmp-open", "sa-cmp-big"); };
    window.furaCompose = open;
    $("saComposeBtn").addEventListener("click", () => {
        if (status && !status.mail) return toast("Пошта компанії не підключена — див. налаштування вгорі.", true);
        open();
    });
    box.addEventListener("click", (e) => {
        if (e.target.closest("[data-cmp-close]")) {
            // закрили — лист іде в «Чернетки» на пошті; «Написати» далі відкриє чистий лист
            if (hasContent()) {
                dirty = dirty || !draft.uid; localPut();
                pushDraft().then(() => { if (!dirty) try { localStorage.removeItem(DRAFT); } catch (_) { /* */ } });
                toast("Лист збережено в «Чернетках»");
            } else try { localStorage.removeItem(DRAFT); } catch (_) { /* */ }
            close();
        }
        if (e.target.closest("[data-cmp-discard]")) {
            if (hasContent() && !confirm("Видалити цей лист? Він зникне і з «Чернеток».")) return;
            const old = draft; draft = { uid: 0, folder: "" }; dirty = false; clearTimeout(dT);
            if (old.uid) saving = saving.then(() => api({ action: "mail_draft", delete: true, draft_uid: old.uid, draft_folder: old.folder })).then(() => window.dispatchEvent(new Event("fura-draft-saved"))).catch(() => {});
            try { localStorage.removeItem(DRAFT); } catch (_) { /* */ }
            close();
        }
        const rm = e.target.closest("[data-rm]");
        if (rm) { files.splice(Number(rm.dataset.rm), 1); showFiles(); }
    });
    form.addEventListener("input", saveDraft);
    // вставили адреси з Outlook ('Ім'я' <a@b.ua>; 'c@d.ua') — лишаємо тільки e-mail через кому
    ["to", "cc", "bcc"].forEach((k) => form[k].addEventListener("blur", () => {
        const found = form[k].value.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi) || [];
        if (found.length) form[k].value = [...new Set(found.map((x) => x.toLowerCase()))].join(", ");
        saveDraft();
    }));
    $("saCmpFile").addEventListener("change", (e) => {
        files.push(...e.target.files);
        e.target.value = "";
        const total = files.reduce((n, f) => n + f.size, 0);
        if (total > 15 * 1024 * 1024) { toast("Разом файли більші за 15 МБ — лист може не піти", true); }
        showFiles();
    });
    // перетягнути файли у вікно листа
    const box2 = form;
    ["dragenter", "dragover"].forEach((t) => box2.addEventListener(t, (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); box2.classList.add("drop"); } }));
    ["dragleave", "drop"].forEach((t) => box2.addEventListener(t, (e) => { if (t === "dragleave" && box2.contains(e.relatedTarget)) return; box2.classList.remove("drop"); }));
    box2.addEventListener("drop", (e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        files.push(...e.dataTransfer.files);
        if (files.reduce((n, f) => n + f.size, 0) > 15 * 1024 * 1024) toast("Разом файли більші за 15 МБ — лист може не піти", true);
        showFiles();
    });
    const b64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(f); });
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const btn = form.querySelector("[type=submit]");
        if (loadingFiles > 0) return toast("Зачекайте — ще завантажуються файли з листа", true);
        ["to", "cc", "bcc"].forEach((k) => form[k].dispatchEvent(new Event("blur")));
        withBusy(btn, async () => {
            const attachments = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, data: await b64(f) })));
            const g = sigRead();
            clearTimeout(dT);
            await saving.catch(() => {});
            const r = await api({ action: "compose", draft_uid: draft.uid || undefined, draft_folder: draft.folder || undefined, in_reply_to: inReplyTo || undefined, to: form.to.value, cc: form.cc.value, bcc: form.bcc.value, subject: form.subject.value, body: form.body.value, quote: qText || undefined, attachments, signature: g.on ? g : null });
            try { localStorage.removeItem(DRAFT); } catch (_) { /* без пам'яті */ }
            window.furaMailAutoBook?.([{ _sent: true, to: form.to.value, cc: [form.cc.value, form.bcc.value].join(",") }]);
            const hadDraft = draft.uid; draft = { uid: 0, folder: "" }; dirty = false;
            close();
            if (hadDraft) window.dispatchEvent(new Event("fura-draft-saved"));
            toast(`Лист надіслано: ${[...(r?.to || []), ...(r?.cc || [])].join(", ")}`);
        });
    });
    // ?compose=1&to=…&subject=… — відкрити лист одразу (посилання з інших сторінок)
    const q = new URLSearchParams(location.search);
    if (q.get("compose")) setTimeout(() => open({ to: q.get("to") || "", cc: q.get("cc") || "", subject: q.get("subject") || "", body: q.get("body") || "" }), 600);
    else setTimeout(() => {
        // після оновлення сторінки недописаний лист повертається (згорнутим) і зберігається в «Чернетки»
        let d = {}; try { d = JSON.parse(localStorage.getItem(DRAFT) || "{}"); } catch (_) { d = {}; }
        if (!(d.to || d.subject || d.body) || !box.classList.contains("hidden")) return;
        open();
        setMode(true, false);
        if (dirty) pushDraft();
    }, 1800);
    // закривають вкладку — встигнути зберегти
    addEventListener("pagehide", () => { if (dirty && hasContent()) localPut(); });
})();


/* ---------------- Пошта: Вхідні, Спам, Надіслані — прямо у FURA ---------------- */
(() => {
    const ML = { seq: 0, folder: "INBOX", folders: [], list: [], page: 0, q: "", open: null, loaded: false, showHidden: false };
    // приховані папки (у цьому браузері)
    const HID_KEY = "fura_mail_hidden";
    const hidGet = () => { try { return new Set(JSON.parse(localStorage.getItem(HID_KEY) || "[]")); } catch (_) { return new Set(); } };
    const hidSet = (set) => { try { localStorage.setItem(HID_KEY, JSON.stringify([...set])); } catch (_) { /* без пам'яті */ } };
    // справжні папки на сервері для пункту (об'єднаний «Спам» = кілька папок)
    const realPaths = (path) => (ML.folders.find((f) => f.path === path) || {}).paths || [path];
    const KIND = { "\\Inbox": ["Вхідні", "bx-envelope"], "\\Junk": ["Спам", "bx-error-circle"], "\\Sent": ["Надіслані", "bx-send"], "\\Drafts": ["Чернетки", "bx-edit"], "\\Archive": ["Архів", "bx-archive"], "\\Trash": ["Кошик", "bx-trash"] };
    // кружечок з ініціалами — як у звичайній пошті
    const AV = ["#d9a944", "#5b8def", "#16a34a", "#e2725b", "#8b5cf6", "#0891b2", "#db2777", "#64748b"];
    function avatar(name) {
        const n = String(name || "?").replace(/<.*>/, "").replace(/["']/g, "").trim() || "?";
        const parts = n.split(/[\s@._-]+/).filter(Boolean);
        const ini = ((parts[0] || "?")[0] + ((parts[1] || "")[0] || "")).toUpperCase();
        let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        return `<span class="sa-av" style="background:${AV[h % AV.length]}">${escapeHtml(ini)}</span>`;
    }
    /* ---------- Ширина колонок (папки · список · лист): тягніть за межу між ними; подвійний клік — як було ---------- */
    (() => {
        const grid = document.querySelector(".sa-mail-grid"); if (!grid) return;
        const KEY = "fura_mail_cols", DEF = { c1: 210, c2: 380 };
        let cols = { ...DEF }; try { cols = { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch (_) { /* */ }
        const apply = () => {
            grid.classList.toggle("ml-icons", !!cols.icons);
            grid.style.setProperty("--ml-c1", (cols.icons ? 64 : cols.c1) + "px"); grid.style.setProperty("--ml-c2", cols.c2 + "px");
        };
        const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cols)); } catch (_) { /* */ } };
        // «лише значки» для колонки папок
        window.furaMailFold = () => { cols.icons = !cols.icons; apply(); save(); renderFolders(); };
        apply();
        grid.insertAdjacentHTML("beforeend", '<div class="sa-split s1" data-split="c1" title="Тягніть, щоб змінити ширину. Подвійний клік — як було"></div><div class="sa-split s2" data-split="c2" title="Тягніть, щоб змінити ширину. Подвійний клік — як було"></div>');
        grid.addEventListener("pointerdown", (e) => {
            const h = e.target.closest("[data-split]"); if (!h || e.button !== 0) return;
            e.preventDefault();
            const k = h.dataset.split, x0 = e.clientX, W = grid.getBoundingClientRect().width;
            if (k === "c1" && cols.icons) { cols.icons = false; cols.c1 = 140; apply(); renderFolders(); }
            const v0 = cols[k];
            h.setPointerCapture?.(e.pointerId); document.body.classList.add("sa-resizing"); h.classList.add("on");
            const mv = (ev) => {
                const other = k === "c1" ? cols.c2 : cols.c1;
                const want = v0 + ev.clientX - x0;
                // папки стягнули зовсім вузько — лишаємо тільки значки
                if (k === "c1" && want < 110) { if (!cols.icons) { cols.icons = true; apply(); renderFolders(); } return; }
                if (k === "c1" && cols.icons) { cols.icons = false; renderFolders(); }
                cols[k] = Math.round(Math.max(k === "c1" ? 140 : 260, Math.min(want, W - other - 28 - 340)));
                apply();
            };
            const up = () => {
                h.removeEventListener("pointermove", mv); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up);
                document.body.classList.remove("sa-resizing"); h.classList.remove("on");
                try { localStorage.setItem(KEY, JSON.stringify(cols)); } catch (_) { /* */ }
            };
            h.addEventListener("pointermove", mv); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
        });
        grid.addEventListener("dblclick", (e) => { const h = e.target.closest("[data-split]"); if (!h) return; cols[h.dataset.split] = DEF[h.dataset.split]; if (h.dataset.split === "c1") cols.icons = false; apply(); renderFolders(); try { localStorage.setItem(KEY, JSON.stringify(cols)); } catch (_) { /* */ } });
    })();

    /* ---------- Телефон: список і лист — по черзі на весь екран, «← Назад» повертає до списку ---------- */
    const mob = () => matchMedia("(max-width: 760px)").matches;
    $("mlRead").insertAdjacentHTML("beforebegin", '<button type="button" class="sa-mr-back" id="mlBack"><i class="bx bx-chevron-left"></i> <span>Назад</span></button>');
    let readPushed = false; // крок «лист» додано в історію (лише на телефоні)
    function readMode(on) {
        const was = document.body.classList.contains("ml-reading");
        document.body.classList.toggle("ml-reading", !!on);
        const back = $("mlBack");
        if (back) back.querySelector("span").textContent = ML.book ? "Адреси" : ((KIND[kindOf(ML.folder)] || [])[0] || "Назад");
        if (on && !was && mob()) {
            try { history.pushState({ mlRead: 1 }, ""); readPushed = true; } catch (_) { /* */ }
            window.scrollTo(0, 0); document.querySelector(".main-content")?.scrollTo?.(0, 0);
        }
    }
    function closeRead() {
        document.body.classList.remove("ml-reading");
        if (!ML.book) { ML.open = null; renderList(); }
        else { BOOK.sel = null; renderBookList(); }
    }
    $("mlBack").addEventListener("click", () => { if (readPushed && history.state?.mlRead) history.back(); else { readPushed = false; closeRead(); } });
    // «назад» — рівно на крок: з листа до списку (а якщо ще на кроці листа — лишаємось у листі)
    addEventListener("popstate", () => {
        if (!readPushed || history.state?.mlRead) return; // закриття вікна перегляду тощо — лист лишається відкритим
        readPushed = false;
        if (document.body.classList.contains("ml-reading")) closeRead();
    });
    const kindOf = (path) => (ML.folders.find((f) => f.path === path) || {}).kind || "";
    const pathOf = (kind) => { const f = ML.folders.find((x) => x.kind === kind); return f ? (f.paths || [f.path])[0] : undefined; };
    const when = (d) => {
        if (!d) return "";
        const t = new Date(d), now = new Date();
        return t.toDateString() === now.toDateString() ? t.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }) : t.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: t.getFullYear() === now.getFullYear() ? undefined : "2-digit" });
    };
    function needAccess(msg) {
        $("mlList").innerHTML = `<p class="ag-empty">${escapeHtml(msg)}</p>`;
        $("mlFolders").innerHTML = "";
        $("mlRead").innerHTML = "";
    }
    async function loadFolders() {
        const r = await api({ action: "mail_folders" });
        const all = r.folders || [];
        // кілька папок спаму (хостинг «spam» + Outlook «Junk») — один пункт «Спам»
        const junk = all.filter((f) => f.kind === "\\Junk");
        ML.folders = all.filter((f) => f.kind !== "\\Junk");
        if (junk.length) {
            const v = junk.length === 1 ? junk[0] : { path: "__junk__", kind: "\\Junk", name: "Спам", paths: junk.map((f) => f.path),
                unseen: junk.reduce((n, f) => n + (f.unseen || 0), 0), total: junk.reduce((n, f) => n + (f.total || 0), 0) };
            const at = ML.folders.findIndex((f) => f.kind === "\\Inbox");
            ML.folders.splice(at + 1, 0, v);
        }
        if (!ML.folders.some((f) => f.path === ML.folder)) ML.folder = (ML.folders.find((f) => f.kind === "\\Inbox") || ML.folders[0] || {}).path || "INBOX";
        renderFolders();
    }
    function renderFolders() {
        const same = (k) => ML.folders.filter((x) => x.kind === k).length > 1;
        const tone = { "\\Inbox": "in", "\\Junk": "junk", "\\Sent": "sent", "\\Drafts": "draft", "\\Archive": "arch", "\\Trash": "trash" };
        const hid = hidGet();
        const btn = (f, hidden) => {
            const [label, icon] = KIND[f.kind] || [f.name || f.path, "bx-folder"];
            const real = String(f.name || f.path).replace(/^INBOX[./]/i, "");
            const text = f.kind && same(f.kind) ? `${label} · ${real}` : label;
            const canHide = f.kind !== "\\Inbox";
            return `<div class="sa-mf-row ${hidden ? "is-hidden" : ""}"><button type="button" class="sa-mf t-${tone[f.kind] || "other"} ${f.path === ML.folder ? "active" : ""}" data-folder="${escapeHtml(f.path)}" title="${escapeHtml(text)}${f.unseen ? ` — нових: ${f.unseen}` : ""}">
                <i class="bx ${icon}"></i><span>${escapeHtml(text)}</span>${f.unseen ? `<b>${f.unseen}</b>` : f.total ? `<em>${f.total}</em>` : ""}</button>
                ${canHide ? `<button type="button" class="sa-mf-eye" data-hide="${escapeHtml(f.path)}" title="${hidden ? "Показати папку" : "Сховати папку"}"><i class="bx ${hidden ? "bx-show" : "bx-hide"}"></i></button>` : ""}</div>`;
        };
        const shown = ML.folders.filter((f) => !hid.has(f.path) || f.path === ML.folder);
        const hidden = ML.folders.filter((f) => hid.has(f.path) && f.path !== ML.folder);
        $("mlFolders").innerHTML = `<div class="sa-mf-title">Папки<button type="button" class="sa-mf-fold" data-fold title="${document.querySelector(".sa-mail-grid")?.classList.contains("ml-icons") ? "Показати назви папок" : "Лишити тільки значки"}"><i class="bx ${document.querySelector(".sa-mail-grid")?.classList.contains("ml-icons") ? "bx-chevrons-right" : "bx-chevrons-left"}"></i></button></div>` + shown.map((f) => btn(f, hid.has(f.path))).join("") +
            (hidden.length ? `<button type="button" class="sa-mf-more" data-showhidden>${ML.showHidden ? "▾" : "▸"} Приховані (${hidden.length})</button>` +
                (ML.showHidden ? hidden.map((f) => btn(f, true)).join("") : "") : "") +
            `<div class="sa-mf-title">Довідник</div><div class="sa-mf-row"><button type="button" class="sa-mf t-book ${ML.book ? "active" : ""}" data-book title="Адреси"><i class="bx bx-book-bookmark"></i><span>Адреси</span>${BOOK.list.length ? `<em>${BOOK.list.length}</em>` : ""}</button></div>`;
        if (ML.book) $("mlFolders").querySelectorAll("[data-folder].active").forEach((b) => b.classList.remove("active"));
        const inbox = ML.folders.find((f) => f.kind === "\\Inbox"), junk = ML.folders.find((f) => f.kind === "\\Junk");
        const n = (inbox?.unseen || 0) + (junk?.unseen || 0);
        $("cntMail").textContent = n ? String(n) : "";
        if (inbox) window.furaSetMailUnseen?.(inbox.unseen || 0);
    }
    async function loadList() {
        if (ML.book) return;
        const nF = ML.q ? ML.folders.filter((f) => f.kind !== "\\Trash").length : 1;
        $("mlList").innerHTML = skeleton(ML.q ? `Шукаю «${ML.q}» у ${nF} папках…` : "Завантажую листи…");
        // об'єднаний «Спам»: беремо з кожної папки і зливаємо за датою
        // пошук — у всіх папках одразу (Вхідні, Надіслані, Чернетки, Архів, Спам…), без Кошика
        const paths = ML.q ? ML.folders.filter((f) => f.kind !== "\\Trash").flatMap((f) => f.paths || [f.path]) : realPaths(ML.folder);
        const my = ++ML.seq;
        const res = await Promise.all(paths.map((fp) => api({ action: "mail_list", folder: fp, page: ML.page, q: ML.q, limit: 50 }).then((r) => (r.list || []).map((m) => ({ ...m, fp }))).catch(() => [])));
        if (my !== ML.seq) return; // уже шукаємо інше
        ML.list = res.flat().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, ML.q ? 100 : 50 * paths.length);
        renderList();
        prefetch();
        autoBook(ML.list);
    }
    const folderName = (fp) => { const f = ML.folders.find((x) => x.path === fp || (x.paths || []).includes(fp)) || {}; return (KIND[f.kind] || [f.name || fp])[0]; };
    // красиве завантаження: смужка зверху + «примарні» рядки листів, що переливаються
    function skeleton(text) {
        const row = (w1, w2) => `<div class="sa-sk-row"><span class="sa-sk sa-sk-av"></span><div class="sa-sk-lines"><span class="sa-sk" style="width:${w1}%"></span><span class="sa-sk" style="width:${w2}%"></span></div></div>`;
        return `<div class="sa-ml-head sa-sk-head"><b>${escapeHtml(text)}</b></div><div class="sa-sk-bar"><i></i></div>` +
            [[55, 85], [40, 70], [62, 90], [35, 60], [50, 80], [45, 75], [58, 88]].map(([a, b]) => row(a, b)).join("");
    }
    function renderList() {
        const isSent = kindOf(ML.folder) === "\\Sent";
        const fname = (ML.folders.find((f) => f.path === ML.folder) || {});
        const head = `<div class="sa-ml-head"><b>${ML.q ? "Пошук у всіх папках" : escapeHtml((KIND[fname.kind] || [fname.name || ML.folder])[0])}</b><span>${ML.q ? `знайдено: ${ML.list.length}` : fname.total != null ? `${fname.total} листів` : ""}</span></div>`;
        $("mlList").innerHTML = head + (ML.list.map((m) => {
            const sent = ML.q ? folderName(m.fp) === "Надіслані" : isSent;
            const who = sent ? m.to || "" : m.from || m.from_email;
            return `<button type="button" class="sa-mi ${m.seen ? "" : "unseen"} ${ML.open?.uid === m.uid && ML.open?.fp === m.fp ? "active" : ""}" data-uid="${m.uid}" data-fp="${escapeHtml(m.fp)}">
                ${avatar(sent ? m.to : m.from || m.from_email)}
                <div class="sa-mi-body">
                    <div class="sa-mi-top"><span class="sa-mi-from">${sent ? "Кому: " : ""}${escapeHtml(who)}</span><span class="sa-mi-date">${escapeHtml(when(m.date))}</span></div>
                    <div class="sa-mi-subj">${ML.q ? `<span class="sa-mi-fold">${escapeHtml(folderName(m.fp))}</span> ` : ""}${m.att ? '<i class="bx bx-paperclip"></i> ' : ""}${escapeHtml(m.subject)}</div>
                </div>
            </button>`;
        }).join("") || `<div class="sa-ml-empty"><i class="bx bx-envelope-open"></i><span>${ML.q ? "Нічого не знайдено" : "У цій папці листів немає"}</span></div>`) +
            `<div class="sa-mi-pages">${ML.page ? '<button type="button" class="btn btn-secondary" data-pg="-1">← Новіші</button>' : ""}${ML.list.length >= 50 ? '<button type="button" class="btn btn-secondary" data-pg="1">Старіші →</button>' : ""}</div>`;
    }
    // Кеш відкритих листів + попереднє завантаження верхніх листів списку — відкриваються миттєво
    const MCACHE = new Map();
    const ck = (fp, uid) => `${fp}|${uid}`;
    let prefetching = false;
    async function prefetch() {
        if (prefetching) return;
        prefetching = true;
        try {
            const byFp = new Map();
            ML.list.slice(0, 12).forEach((m) => { if (!MCACHE.has(ck(m.fp, m.uid))) (byFp.get(m.fp) || byFp.set(m.fp, []).get(m.fp)).push(m.uid); });
            // маленькими порціями — щоб лист, на який ви клікнули, не чекав у черзі
            for (const [fp, uids] of byFp) {
                for (let i = 0; i < uids.length; i += 3) {
                    const part = uids.slice(i, i + 3).filter((u) => !MCACHE.has(ck(fp, u)));
                    if (!part.length) continue;
                    const r = await api({ action: "mail_read", folder: fp, uids: part, peek: true });
                    (r.list || []).forEach((x) => MCACHE.set(ck(fp, x.uid), x));
                }
            }
        } catch (_) { /* не критично */ } finally { prefetching = false; }
    }
    async function openMail(uid, fp) {
        fp = fp || realPaths(ML.folder)[0];
        ML.open = { uid, fp };
        readMode(true);
        renderList();
        const it = ML.list.find((x) => x.uid === uid && x.fp === fp);
        let m = MCACHE.get(ck(fp, uid));
        if (!m) {
            // одразу показуємо, що вже знаємо зі списку, текст — коли підвантажиться
            $("mlRead").innerHTML = it ? `<h3 class="sa-mr-subj">${escapeHtml(it.subject)}</h3><div class="sa-mr-meta">${avatar(it.from || it.from_email)}<div class="sa-mr-who"><b>${escapeHtml(it.from || it.from_email)}</b><div class="sa-muted">${it.date ? escapeHtml(new Date(it.date).toLocaleString("uk-UA")) : ""}</div></div></div><div class="sa-sk-bar"><i></i></div><div class="sa-sk-read">${[92, 85, 96, 60, 0, 88, 75, 40].map((w) => (w ? `<span class="sa-sk" style="width:${w}%"></span>` : "<br>")).join("")}</div>` : `<div class="sa-sk-bar"><i></i></div><div class="sa-sk-read">${[50, 92, 85, 70].map((w) => `<span class="sa-sk" style="width:${w}%"></span>`).join("")}</div>`;
            m = await api({ action: "mail_read", folder: fp, uid });
            MCACHE.set(ck(fp, uid), m);
            if (ML.open?.uid !== uid || ML.open?.fp !== fp) return; // уже відкрили інший
        } else if (it && !it.seen) {
            api({ action: "mail_move", folder: fp, uid, flag: "seen" }).catch(() => {});
        }
        ML.open = { ...m, fp };
        autoBook([{ ...m, fp }], true);
        // чернетка — відкриваємо у вікні листа, щоб дописати й надіслати
        if (kindOf(ML.folder) === "\\Drafts") {
            window.furaCompose?.({ to: m.to || "", cc: m.cc || "", bcc: m.bcc || "", subject: m.subject === "(без теми)" ? "" : m.subject, body: String(m.text || "").replace(/\s+$/, ""),
                in_reply_to: m.in_reply_to || "", draft_uid: m.uid, draft_folder: fp });
        }
        if (it && !it.seen) { it.seen = true; renderList(); loadFolders().catch(() => {}); }
        const junk = kindOf(ML.folder) === "\\Junk";
        $("mlRead").innerHTML = `
            ${junk ? '<div class="sa-mr-junk"><i class="bx bx-error-circle"></i> Цей лист у «Спамі». Якщо це клієнт чи перевізник — натисніть «Не спам», і такі листи йтимуть у Вхідні.</div>' : ""}
            <div class="sa-mr-actions">
                <button type="button" class="btn btn-primary" data-mr="reply"><i class="bx bx-reply"></i> Відповісти</button>
                <button type="button" class="btn btn-secondary" data-mr="replyall"><i class="bx bx-reply-all"></i> Усім</button>
                <button type="button" class="btn btn-secondary" data-mr="fwd"><i class="bx bx-share"></i> Переслати</button>
                ${junk ? '<button type="button" class="btn btn-primary" data-mr="notspam"><i class="bx bx-check"></i> Не спам</button>' : pathOf("\\Junk") ? '<button type="button" class="btn btn-secondary" data-mr="spam" title="У спам"><i class="bx bx-error-circle"></i></button>' : ""}
                <button type="button" class="btn btn-secondary" data-mr="unread" title="Позначити непрочитаним"><i class="bx bx-envelope"></i></button>
                <button type="button" class="btn btn-secondary" data-mr="book" title="Зберегти відправника в «Адреси»"><i class="bx bx-book-add"></i> ${BOOK.byEmail(m.from_email) ? "В адресах" : "В адреси"}</button>
                ${pathOf("\\Trash") && kindOf(ML.folder) !== "\\Trash" ? '<button type="button" class="btn btn-secondary" data-mr="trash" title="Видалити"><i class="bx bx-trash"></i></button>' : ""}
            </div>
            <h3 class="sa-mr-subj">${escapeHtml(m.subject)}</h3>
            <div class="sa-mr-meta">
                ${avatar(m.from)}
                <div class="sa-mr-who"><div class="sa-mr-from">${people(m.from, true)}</div>
                <div class="sa-mr-line"><span class="sa-mr-lbl">Кому:</span> ${people(m.to)}</div>
                ${m.cc ? `<div class="sa-mr-line"><span class="sa-mr-lbl">Копія:</span> ${people(m.cc)}</div>` : ""}
                <div class="sa-muted">${m.date ? escapeHtml(new Date(m.date).toLocaleString("uk-UA")) : ""}</div></div>
            </div>
            ${m.attachments?.length ? `<div class="sa-mr-atts">${m.attachments.map((a) => `<span class="sa-mr-attw"><button type="button" class="sa-mr-att" data-att="${a.i}" title="${typeOf(a.name, a.type) ? "Переглянути" : "Завантажити"}"><i class="bx ${{ img: "bx-image", pdf: "bxs-file-pdf", txt: "bx-file" }[typeOf(a.name, a.type)] || "bx-paperclip"}"></i> ${escapeHtml(a.name)} <small>${Math.ceil((a.size || 0) / 1024)} КБ</small></button><button type="button" class="sa-mr-attdl" data-attcp="${a.i}" title="Скопіювати файл, щоб вкласти в інший лист"><i class="bx bx-copy"></i></button><button type="button" class="sa-mr-attdl" data-attdl="${a.i}" title="Завантажити"><i class="bx bx-download"></i></button></span>`).join("")}</div>` : ""}
            <iframe class="sa-mr-body" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>`;
        // HTML листа — в ізольованому вікні (без скриптів), посилання відкриваються в новій вкладці
        const fr = $("mlRead").querySelector(".sa-mr-body");
        const paint = () => {
            // картинки листа (cid:…) підставляємо, коли вони завантажились
            let html = m.html || "";
            for (const [cid, url] of Object.entries(m._imgs || {})) {
                const esc = cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                html = html.replace(new RegExp("cid:" + esc, "gi"), url).replace(new RegExp("cid:" + esc.replace(/@/g, "%40"), "gi"), url);
            }
            fr.srcdoc = m.html
                ? `<base target="_blank"><style>body{font-family:Arial,sans-serif;font-size:14px;color:#222;margin:12px;word-wrap:break-word}img{max-width:100%;height:auto}</style>${html}`
                : `<style>body{font-family:Arial,sans-serif;font-size:14px;color:#222;margin:12px;white-space:pre-wrap;word-wrap:break-word}</style>${escapeHtml(m.text || "")}`;
        };
        fr.onload = () => { try { fr.style.height = Math.max(300, fr.contentDocument.body.scrollHeight + 30) + "px"; } catch (_) { fr.style.height = "600px"; } };
        paint();
        if (m.html && m.inline?.length && !m._imgs) {
            const uid0 = m.uid, fp0 = fp;
            api({ action: "mail_read", folder: fp, uid: m.uid, parts: m.inline.map((p) => p.part), peek: true }).then((r) => {
                const imgs = {};
                for (const f of r.files || []) {
                    const p = m.inline.find((x) => x.part === f.part);
                    if (p) imgs[p.cid] = `data:${f.type || p.type};base64,${f.data}`;
                }
                m._imgs = imgs;
                const c = MCACHE.get(ck(fp0, uid0)); if (c) c._imgs = imgs;
                if (ML.open?.uid === uid0 && ML.open?.fp === fp0 && Object.keys(imgs).length) paint();
            }).catch(() => {});
        }
    }
    const plain = (m) => {
        if (String(m.text || "").trim()) return String(m.text);
        try { const d = new DOMParser().parseFromString(String(m.html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n"), "text/html"); return d.body.textContent.replace(/\n{3,}/g, "\n\n"); } catch (_) { return ""; }
    };
    // Адреси в листі: «Ім'я <e-mail>» — наведіть, щоб скопіювати повністю або лише e-mail
    function people(list, bold) {
        const out = [];
        const rx = /\s*(?:"?([^"<>,]*?)"?\s*<([^<>\s]+@[^<>\s]+)>|([^\s,;<>]+@[^\s,;<>]+))\s*(?:,|;|$)/g;
        let mm;
        const src = String(list || "");
        while ((mm = rx.exec(src))) {
            if (!mm[0]) { rx.lastIndex++; continue; }
            const email = mm[2] || mm[3] || "", name = (mm[1] || "").replace(/^'+|'+$/g, "").trim();
            const full = name ? `${name} <${email}>` : email;
            out.push(`<span class="sa-pp" data-full="${escapeHtml(full)}" data-email="${escapeHtml(email)}">${bold ? "<b>" : ""}${escapeHtml(name || email)}${bold ? "</b>" : ""}${name ? ` <span class="sa-pp-mail">&lt;${escapeHtml(email)}&gt;</span>` : ""}<span class="sa-pp-act"><button type="button" data-cp="full" title="Скопіювати повністю: ${escapeHtml(full)}"><i class="bx bx-copy"></i></button><button type="button" data-cp="email" title="Скопіювати лише e-mail">@</button></span></span>`);
        }
        return out.length ? out.join('<span class="sa-pp-sep">, </span>') : escapeHtml(src);
    }
    const quote = (m) => `-------- Вихідне повідомлення --------\nВід: ${m.from}\nДата: ${m.date ? new Date(m.date).toLocaleString("uk-UA") : ""}\nКому: ${m.to || ""}${m.cc ? `\nКопія: ${m.cc}` : ""}\nТема: ${m.subject}\n\n${plain(m).trim().slice(0, 12000)}`;
    async function act(kind, btn) {
        const m = ML.open;
        if (!m?.uid) return;
        const re = (s) => (/^re:/i.test(s) ? s : `Re: ${s}`);
        if (kind === "reply" || kind === "replyall") {
            const mine = (status?.from || "").toLowerCase();
            const others = kind === "replyall" ? [m.to, m.cc].join(",").match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi)?.filter((x) => !mine.includes(x.toLowerCase())) || [] : [];
            return window.furaCompose?.({ to: m.from_email, cc: [...new Set(others)].filter((x) => x !== m.from_email).join(", "), subject: re(m.subject), body: "", quote: quote(m).trim(), in_reply_to: m.message_id });
        }
        if (kind === "fwd") return window.furaCompose?.({ to: "", subject: /^fwd?:/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`, body: "", quote: quote(m).trim().replace("Вихідне повідомлення", "Переслане повідомлення"),
            remote: (m.attachments || []).map((a) => ({ fp: m.fp, uid: m.uid, part: a.part, name: a.name, type: a.type, size: a.size })) });
        if (kind === "book") return openBook(guessContact(m));
        if (kind === "unread") {
            await withBusy(btn, () => api({ action: "mail_move", folder: m.fp, uid: m.uid, flag: "unseen" }));
            const it = ML.list.find((x) => x.uid === m.uid && x.fp === m.fp); if (it) it.seen = false;
            renderList(); loadFolders().catch(() => {});
            return;
        }
        const to = kind === "notspam" ? pathOf("\\Inbox") || "INBOX" : kind === "spam" ? pathOf("\\Junk") : pathOf("\\Trash");
        if (!to) return;
        await withBusy(btn, () => api({ action: "mail_move", folder: m.fp, uid: m.uid, to }));
        toast(kind === "notspam" ? "Перенесено у Вхідні" : kind === "spam" ? "Перенесено у Спам" : "Видалено");
        ML.list = ML.list.filter((x) => !(x.uid === m.uid && x.fp === m.fp));
        ML.open = null;
        $("mlRead").innerHTML = '<p class="ag-empty">Оберіть лист зліва</p>';
        if (document.body.classList.contains("ml-reading")) { if (readPushed && history.state?.mlRead) history.back(); else readMode(false); }
        renderList(); loadFolders().catch(() => {});
    }
    // Підключити свою пошту: e-mail + пароль від неї (сервер для @grandarltd.com підставиться сам)
    async function connectForm() {
        const { data } = await sbClient.auth.getSession();
        const login = data?.session?.user?.email || "";
        const dom = status?.mail_default_domain || "";
        $("mlFolders").innerHTML = "";
        $("mlRead").innerHTML = "";
        document.body.classList.add("sa-mail-connect");
        $("mlList").innerHTML = `<form class="sa-mc" id="mlConnect" autocomplete="on">
            <h3>Підключіть свою пошту</h3>
            <p class="sa-muted">Введіть e-mail і пароль від вашої робочої пошти — тієї, що в Outlook. FURA перевірить вхід і покаже ваші Вхідні, Спам і Надіслані. Пароль зберігається зашифрованим, колеги його не бачать.</p>
            <label>E-mail<input name="email" type="email" required autocomplete="username" value="${escapeHtml(login.endsWith("@" + dom) ? login : "")}" placeholder="ім'я@${escapeHtml(dom || "grandarltd.com")}" /></label>
            <label>Пароль від пошти<input name="password" type="password" required autocomplete="current-password" /></label>
            <label>Ім'я відправника <span class="sa-muted">(як бачитиме клієнт)</span><input name="from_name" placeholder="Mokeychuk Roman" /></label>
            <details><summary>Інший поштовий сервер</summary>
                <label>Сервер (IMAP і SMTP)<input name="host" placeholder="для @${escapeHtml(dom || "grandarltd.com")} — не треба" /></label>
                <div class="sa-mc-row"><label>SMTP порт<input name="smtp_port" value="465" /></label><label>IMAP порт<input name="imap_port" value="993" /></label></div>
            </details>
            <button type="submit" class="btn btn-primary"><i class="bx bx-plug"></i> Підключити</button>
            ${status && !status.mail_can_connect ? '<p class="sa-bad">Адміністратору: додайте секрет MAIL_ENC_KEY у Supabase (функція fura-sales).</p>' : ""}
        </form>`;
        $("mlConnect").addEventListener("submit", (e) => {
            e.preventDefault();
            const f = e.target, btn = f.querySelector("[type=submit]");
            withBusy(btn, async () => {
                btn.innerHTML = "Перевіряю вхід…";
                try {
                    await api({ action: "mail_connect", email: f.email.value, password: f.password.value, from_name: f.from_name.value, host: f.host.value, smtp_port: f.smtp_port.value, imap_port: f.imap_port.value });
                } finally { btn.innerHTML = '<i class="bx bx-plug"></i> Підключити'; }
                toast("Пошту підключено");
                await loadStatus();
                ML.loaded = false;
                start();
            });
        });
    }
    async function start() {
        if (ML.loaded) return;
        if (status && !status.mail_reader) return connectForm();
        ML.loaded = true;
        document.body.classList.remove("sa-mail-connect");
        $("mlWho").innerHTML = status?.mail_box ? `<i class="bx bx-user-circle"></i> ${escapeHtml(status.mail_box)}${status.mail_own ? ' · <button type="button" class="sa-link" id="mlOff">відключити</button>' : ""}` : "";
        try {
            await loadFolders();
            await loadList();
            // посилання зі сповіщення: mail.html?uid=123 — одразу відкрити цей лист
            const u = Number(new URLSearchParams(location.search).get("uid"));
            if (u) {
                history.replaceState(null, "", location.pathname);
                const inbox = pathOf("\\Inbox") || "INBOX";
                if (ML.folder !== inbox) { ML.folder = inbox; renderFolders(); await loadList(); }
                openMail(u, inbox).catch(() => {});
            }
        } catch (e) { ML.loaded = false; needAccess(e.message); }
    }
    document.querySelector('.sa-tab[data-tab="mail"]').addEventListener("click", start);
    $("mlFolders").addEventListener("click", (e) => {
        const eye = e.target.closest("[data-hide]");
        if (eye) {
            const h = hidGet(), k = eye.dataset.hide;
            if (h.has(k)) h.delete(k); else h.add(k);
            hidSet(h);
            if (h.has(k) && ML.folder === k) { ML.folder = pathOf("\\Inbox") || "INBOX"; ML.open = null; loadList().catch(() => {}); }
            return renderFolders();
        }
        if (e.target.closest("[data-showhidden]")) { ML.showHidden = !ML.showHidden; return renderFolders(); }
        if (e.target.closest("[data-book]")) return openBook();
        if (e.target.closest("[data-fold]")) return window.furaMailFold?.();
        const b = e.target.closest("[data-folder]");
        if (!b) return;
        ML.book = false;
        ML.folder = b.dataset.folder; ML.page = 0; ML.open = null;
        readMode(false);
        renderFolders();
        $("mlRead").innerHTML = '<p class="ag-empty">Оберіть лист зліва</p>';
        loadList().catch((er) => toast(er.message, true));
    });
    $("mlList").addEventListener("click", (e) => {
        if (ML.book) return bookListClick(e);
        const pg = e.target.closest("[data-pg]");
        if (pg) { ML.page = Math.max(0, ML.page + Number(pg.dataset.pg)); return loadList().catch((er) => toast(er.message, true)); }
        const it = e.target.closest("[data-uid]");
        if (it) openMail(Number(it.dataset.uid), it.dataset.fp).catch((er) => toast(er.message, true));
    });
    $("mlRead").addEventListener("click", async (e) => {
        if (ML.book) return bookCardClick(e);
        const cp = e.target.closest("[data-cp]");
        if (cp) {
            const pp = cp.closest(".sa-pp");
            const t = cp.dataset.cp === "email" ? pp.dataset.email : pp.dataset.full;
            try { await navigator.clipboard.writeText(t); } catch (_) {
                const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
            }
            cp.classList.add("ok"); setTimeout(() => cp.classList.remove("ok"), 1200);
            return toast("Скопійовано: " + t);
        }
        const b = e.target.closest("[data-mr]");
        if (b) return act(b.dataset.mr, b).catch((er) => toast(er.message, true));
        const a = e.target.closest("[data-att]");
        if (a) await withBusy(a, () => preview(Number(a.dataset.att)));
        const acp = e.target.closest("[data-attcp]");
        if (acp) { clipAdd(ML.open, Number(acp.dataset.attcp)); acp.classList.add("ok"); setTimeout(() => acp.classList.remove("ok"), 1200); return; }
        const dl = e.target.closest("[data-attdl]");
        if (dl) await withBusy(dl, async () => download(await fileOf(ML.open, Number(dl.dataset.attdl))));
    });
    let qT = 0;
    $("mlQ").addEventListener("input", (e) => { clearTimeout(qT); qT = setTimeout(() => {
        // «Alla Alla <agmtorg1@gmail.com>» — шукаємо за e-mail
        const v = e.target.value.trim();
        ML.q = (v.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i) || [])[0] || v.replace(/["'<>«»]/g, " ").replace(/\s+/g, " ").trim(); ML.page = 0; loadList().catch((er) => toast(er.message, true)); }, 500); });
    $("mlRefresh").addEventListener("click", () => { loadFolders().catch(() => {}); loadList().catch((er) => toast(er.message, true)); });
    $("mlCompose").addEventListener("click", () => window.furaCompose?.());
    // файли, кинуті на пошту, — одразу в новий лист
    const mp = document.querySelector('.sa-panel[data-panel="mail"]');
    ["dragenter", "dragover"].forEach((t) => mp.addEventListener(t, (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); mp.classList.add("drop"); } }));
    ["dragleave", "drop"].forEach((t) => mp.addEventListener(t, (e) => { if (t === "dragleave" && mp.contains(e.relatedTarget)) return; mp.classList.remove("drop"); }));
    mp.addEventListener("drop", (e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        const fs = [...e.dataTransfer.files];
        const m = ML.open;
        // якщо відкритий лист — відповідь з цими файлами, інакше новий лист
        if (m?.uid && m.from_email) window.furaCompose?.({ to: m.from_email, subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`, body: "", quote: quote(m), in_reply_to: m.message_id }, fs);
        else window.furaCompose?.({ to: "" }, fs);
    });
    $("mlWho").addEventListener("click", async (e) => {
        if (!e.target.closest("#mlOff") || !confirm("Відключити вашу пошту від FURA? Пароль буде видалено з FURA.")) return;
        await api({ action: "mail_disconnect" });
        toast("Пошту відключено");
        await loadStatus();
        ML.loaded = false; ML.list = []; ML.folders = [];
        $("mlWho").innerHTML = "";
        start();
    });
    /* ---------- Перегляд вкладень: фото, PDF, текст — у вікні; інше — завантажити ---------- */
    const FILES = new Map(); // кеш завантажених вкладень
    const typeOf = (name, type) => {
        const n = String(name || "").toLowerCase(), t = String(type || "").toLowerCase();
        if (/^image\//.test(t) || /\.(jpe?g|png|gif|webp|bmp|heic|svg)$/.test(n)) return "img";
        if (t === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
        if (/^text\//.test(t) || /\.(txt|csv|log|xml|json)$/.test(n)) return "txt";
        return "";
    };
    async function fileOf(m, i) { return partFile(m.fp, m.uid, (m.attachments || [])[i] || {}); }
    async function partFile(fp, uid, att) {
        const m = { fp, uid };
        const key = `${m.fp}|${m.uid}|${att.part}`;
        if (!FILES.has(key)) {
            // файл приходить одразу байтами (навіть 15–20 МБ), без перетворень
            const { data: { session } } = await sbClient.auth.getSession();
            const res = await fetch(`${SUPABASE_URL}/functions/v1/fura-sales`, {
                method: "POST",
                headers: { "content-type": "application/json", apikey: SUPABASE_KEY, authorization: `Bearer ${session?.access_token || SUPABASE_KEY}` },
                body: JSON.stringify({ action: "mail_read", folder: m.fp, uid: m.uid, part: att.part, name: att.name, peek: true, raw: true }),
            });
            let f, bin;
            if (!res.ok) { let msg = ""; try { msg = (await res.json()).error; } catch (_) { /* */ } throw new Error(msg || `Не вдалося відкрити файл (${res.status})`); }
            if ((res.headers.get("content-type") || "").includes("application/json")) {
                f = (await res.json()).file; // стара версія сервера — base64
                bin = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
            } else {
                bin = new Uint8Array(await res.arrayBuffer());
                f = { name: decodeURIComponent(res.headers.get("x-file-name") || "") || att.name, type: res.headers.get("x-file-type") || att.type };
            }
            let type = f.type || att.type || "application/octet-stream";
            const k = typeOf(f.name, type);
            if (k === "pdf") type = "application/pdf";
            if (k === "img" && !/^image\//.test(type)) type = "image/" + (String(f.name).split(".").pop().toLowerCase().replace("jpg", "jpeg"));
            if (k === "txt") type = "text/plain;charset=utf-8";
            FILES.set(key, { name: f.name || att.name, type, kind: k, url: URL.createObjectURL(new Blob([bin], { type })), size: bin.length });
        }
        return FILES.get(key);
    }
    // для вікна нового листа: вкладення з будь-якого листа → File
    window.furaMailFile = async (it) => { const f = await partFile(it.fp, it.uid, it); const b = await (await fetch(f.url)).blob(); return new File([b], f.name, { type: f.type }); };
    /* «Скопіювати файл» — щоб вкласти його в інший лист */
    const CLIP = "fura_mail_fileclip";
    const clipGet = () => { try { return JSON.parse(localStorage.getItem(CLIP) || "[]"); } catch (_) { return []; } };
    function clipAdd(m, i) {
        const a = (m.attachments || [])[i]; if (!a) return;
        const list = clipGet().filter((x) => !(x.fp === m.fp && x.uid === m.uid && x.part === a.part));
        list.push({ fp: m.fp, uid: m.uid, part: a.part, name: a.name, type: a.type, size: a.size });
        try { localStorage.setItem(CLIP, JSON.stringify(list.slice(-10))); } catch (_) { /* */ }
        window.dispatchEvent(new Event("fura-fileclip"));
        toast(`Файл «${a.name}» скопійовано. У новому листі натисніть «Вставити скопійовані»`);
    }
    const download = (f) => { const l = document.createElement("a"); l.href = f.url; l.download = f.name; document.body.appendChild(l); l.click(); l.remove(); };
    const pv = document.createElement("div");
    pv.className = "sa-pv"; pv.hidden = true;
    pv.innerHTML = `<div class="sa-pv-bar"><b class="sa-pv-name"></b><span class="sa-pv-n"></span>
        <button type="button" class="sa-pv-btn" data-pv="prev" title="Попереднє"><i class="bx bx-chevron-left"></i></button>
        <button type="button" class="sa-pv-btn" data-pv="next" title="Наступне"><i class="bx bx-chevron-right"></i></button>
        <button type="button" class="sa-pv-btn" data-pv="open" title="Відкрити в новій вкладці"><i class="bx bx-link-external"></i></button>
        <button type="button" class="sa-pv-btn" data-pv="dl" title="Завантажити"><i class="bx bx-download"></i> <span>Завантажити</span></button>
        <button type="button" class="sa-pv-btn sa-pv-x" data-pv="close" title="Закрити">&times;</button></div>
        <div class="sa-pv-body"></div>`;
    document.body.appendChild(pv);
    let PV = { m: null, i: 0, f: null };
    async function preview(i) {
        const m = ML.open; if (!m?.uid) return;
        const att = (m.attachments || [])[i] || {};
        // незнайомий формат (Word, Excel, архів) — одразу завантажити
        if (!typeOf(att.name, att.type)) return download(await fileOf(m, i));
        PV = { m, i, f: null };
        pv.hidden = false; document.body.classList.add("sa-pv-open");
        pv.querySelector(".sa-pv-name").textContent = att.name || "файл";
        pv.querySelector(".sa-pv-n").textContent = (m.attachments.length > 1 ? `${i + 1} з ${m.attachments.length}` : "");
        const body = pv.querySelector(".sa-pv-body");
        body.innerHTML = '<p class="sa-pv-load">Відкриваю…</p>';
        try {
            const f = await fileOf(m, i);
            if (PV.m !== m || PV.i !== i) return;
            PV.f = f;
            if (f.kind === "img") body.innerHTML = `<img src="${f.url}" alt="">`;
            else if (f.kind === "pdf") body.innerHTML = `<iframe src="${f.url}#view=FitH" title="PDF"></iframe>`;
            else if (f.kind === "txt") body.innerHTML = `<pre>${escapeHtml(await (await fetch(f.url)).text())}</pre>`;
            else body.innerHTML = `<p class="sa-pv-load">Цей файл не можна переглянути тут — натисніть «Завантажити».</p>`;
            const img = body.querySelector("img");
            if (img) img.addEventListener("click", () => img.classList.toggle("zoom"));
        } catch (er) { body.innerHTML = `<p class="sa-pv-load">${escapeHtml(er.message)}</p>`; }
    }
    pv.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-pv]"); if (!b) return;
        const k = b.dataset.pv, n = PV.m?.attachments?.length || 0;
        if (k === "close") { pv.hidden = true; document.body.classList.remove("sa-pv-open"); pv.querySelector(".sa-pv-body").innerHTML = ""; return; }
        if ((k === "prev" || k === "next") && n > 1) {
            // переглядаємо по черзі лише те, що відкривається тут
            let j = PV.i;
            for (let t = 0; t < n; t++) { j = (j + (k === "next" ? 1 : -1) + n) % n; if (typeOf(PV.m.attachments[j].name, PV.m.attachments[j].type)) break; }
            return preview(j);
        }
        if (!PV.f) return;
        if (k === "dl") download(PV.f);
        if (k === "open") window.open(PV.f.url, "_blank");
    });
    document.addEventListener("keydown", (e) => {
        if (pv.hidden) return;
        if (e.key === "ArrowRight") pv.querySelector('[data-pv="next"]').click();
        if (e.key === "ArrowLeft") pv.querySelector('[data-pv="prev"]').click();
    });

    /* ---------- Довідник «Адреси»: e-mail, чия адреса, компанія, телефон, підпис ---------- */
    const FREE = /^(gmail|ukr|i\.ua|meta|outlook|hotmail|yahoo|icloud|wp|onet|o2|interia|mail|yandex|bigmir|gmx|web)\./i;
    const BOOK = {
        list: [], loaded: false, sel: null, q: "", err: "",
        byEmail: (e) => BOOK.list.find((c) => c.email.toLowerCase() === String(e || "").toLowerCase()),
        async load() {
            const { data, error } = await sbClient.from("mail_contacts").select("*").order("name").limit(5000);
            if (error) { BOOK.err = /does not exist|schema cache/i.test(error.message) ? "Довідник ще не створено: у Supabase → SQL Editor виконайте файл mail_contacts.sql." : error.message; BOOK.list = []; }
            else { BOOK.err = ""; BOOK.list = data || []; }
            BOOK.loaded = true;
        },
    };
    window.furaMailBook = BOOK;
    BOOK.load().then(() => { if (ML.folders.length) renderFolders(); if (ML.list.length) autoBook(ML.list); }).catch(() => {});
    // з листа: ім'я, компанія за доменом, телефон і підпис з кінця тексту
    function guessContact(m) {
        const email = m.from_email || "";
        const name = String(m.from || "").replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
        const dom = email.split("@")[1] || "";
        const company = dom && !FREE.test(dom) ? dom.split(".").slice(-2, -1)[0].replace(/^./, (c) => c.toUpperCase()) : "";
        // текст до цитати попереднього листа
        let txt = String(m.text || "").split(/\n\s*(?:-{3,}|_{5,}|From:|От:|Від:|Od:|Von:|De:|-------- )/)[0];
        const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        let at = lines.findIndex((l) => /^(best regards|kind regards|regards|pozdrawiam|pozdrowienia|з повагою|с уважением|mit freundlichen|cordialement|bien à vous|thanks|thank you|дякую|спасибо)/i.test(l));
        const sig = (at >= 0 ? lines.slice(at + 1) : lines.slice(-8)).filter((l) => l.length < 120).slice(0, 12).join("\n");
        const phone = ((sig.match(/(?:\+|00)\d[\d\s().-]{7,}\d/g) || [])[0] || "").trim();
        const sl = sig.split("\n");
        const first = (name.split(/\s+/)[0] || "").toLowerCase();
        const position = first && sl[0]?.toLowerCase().includes(first) && sl[1] && !/[@\d]/.test(sl[1]) && sl[1].length < 60 ? sl[1] : "";
        const known = BOOK.byEmail(email);
        return known || { email, name, company, phone, signature: sig, position, note: "", _new: true };
    }
    // ===== АВТОМАТИЧНО В «АДРЕСИ»: усі, кому пишемо і хто пише нам =====
    // Нових — додаємо (ім'я + компанія). Наявних — лише дописуємо порожні поля, ваші правки не чіпаємо.
    const NOAUTO = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|notifications?|newsletter|news|info-?noreply|robot|daemon)[@+._-]|@(.*\.)?(noreply|bounce|mailchimp|sendgrid|mandrillapp|amazonses)\./i;
    const COMPANY_RX = /(\b(sp\.?\s*z\s*o\.?\s*o|sp\.?\s*k|s\.?\s*a|gmbh|ltd|llc|inc|s\.?r\.?o|ug|kg|bv|oy|ab|uab|sia|ou|srl|sas|sarl|corp|tov|tzov|fop|pp)\b\.?|(^|\s)(тов|тзов|фоп|пп|прат|ат|ооо|зао)(\s|$)|\b(logistics?|transport|trans|freight|cargo|spedition|forwarding)\b|логіст|транс)/i;
    const kindAt = (fp) => (ML.folders.find((f) => f.path === fp || (f.paths || []).includes(fp)) || {}).kind || "";
    const mineSet = () => new Set(String([status?.from, status?.mail_box].join(",")).toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g) || []);
    function parseAddrs(src) {
        const out = [];
        const rx = /"([^"]*)"\s*<([^<>\s]+@[^<>\s]+)>|([^,;<>"]*?)\s*<([^<>\s]+@[^<>\s]+)>|([^\s,;<>"]+@[^\s,;<>"]+)/g;
        let mm; const s = String(src || "");
        while ((mm = rx.exec(s))) out.push({ email: (mm[2] || mm[4] || mm[5] || "").toLowerCase(), name: (mm[1] ?? mm[3] ?? "").replace(/^['\s]+|['\s]+$/g, "").trim() });
        return out;
    }
    // «Іван Петренко | Trans Sp. z o.o.» → ім'я + компанія; «Trans Sp. z o.o.» → лише компанія
    function splitName(display, email) {
        let name = String(display || "").trim(), company = "";
        if (!name || name.toLowerCase() === email) name = "";
        const parts = name.split(/\s+[|/–—-]\s+|\s*,\s+(?=\S)/);
        if (parts.length > 1 && COMPANY_RX.test(parts.slice(1).join(" "))) { company = parts.slice(1).join(" ").trim(); name = parts[0].trim(); }
        else if (COMPANY_RX.test(name)) { company = name; name = ""; }
        const dom = email.split("@")[1] || "";
        if (!company && dom && !FREE.test(dom)) {
            const lv = dom.split(".");
            while (lv.length > 2 && /^(com|co|org|net|gov|in|kiev|kyiv|lviv|biz|edu)$/i.test(lv[lv.length - 2])) lv.pop();
            company = (lv[lv.length - 2] || "").replace(/^./, (c) => c.toUpperCase());
        }
        return { name: name.slice(0, 120), company: company.slice(0, 160) };
    }
    // підпис внизу листа: телефон, посада, компанія
    function sigOf(m) {
        const txt = String(m.text || plain(m) || "").split(/\n\s*(?:-{3,}|_{5,}|>|From:|От:|Від:|Od:|Von:|De:|-------- |On .{5,80} wrote:|W dniu )/)[0];
        const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const at = lines.findIndex((l) => /^(best regards|kind regards|regards|br,?$|pozdrawiam|pozdrowienia|z poważaniem|з повагою|с уважением|mit freundlichen|cordialement|bien à vous|thanks|thank you|дякую|спасибо)/i.test(l));
        if (at < 0) return null; // без «З повагою…» підпис не вгадуємо — щоб не записати сміття
        const sl = lines.slice(at + 1).filter((l) => l.length < 120).slice(0, 12);
        if (!sl.length) return null;
        const sig = sl.join("\n");
        const phone = ((sig.match(/(?:\+|00)\d[\d\s().-]{7,}\d/g) || [])[0] || "").trim();
        const position = sl[1] && !/[@\d]/.test(sl[1]) && sl[1].length < 60 && !COMPANY_RX.test(sl[1]) ? sl[1] : "";
        const company = sl.find((l) => COMPANY_RX.test(l) && !/[@]|www\.|https?:/i.test(l) && l.length < 80) || "";
        return { signature: sig, phone, position, company };
    }
    const AUTO = { queue: new Map(), t: 0, busy: false };
    function autoBook(msgs, withSig) {
        if (!BOOK.loaded || BOOK.err) return;
        const mine = mineSet();
        (msgs || []).forEach((m) => {
            const kind = kindAt(m.fp);
            if (/Junk|Trash|Drafts/.test(kind)) return;
            const sent = m._sent || kind === "\\Sent" || (m.from_email && mine.has(String(m.from_email).toLowerCase()));
            const people = sent ? [...parseAddrs(m.to), ...parseAddrs(m.cc)] : [{ email: String(m.from_email || "").toLowerCase(), name: String(m.from || "").replace(/<[^>]*>/, "").trim() }];
            const sig = withSig && !sent ? sigOf(m) : null;
            people.forEach((p, i) => {
                if (!p.email || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(p.email) || mine.has(p.email) || NOAUTO.test(p.email)) return;
                const v = { email: p.email, ...splitName(p.name, p.email) };
                if (sig && i === 0) { v.phone = sig.phone; v.position = sig.position; v.signature = sig.signature; if (sig.company) v.company = sig.company; }
                const prev = AUTO.queue.get(p.email) || {};
                Object.keys(v).forEach((k) => { if (v[k] && !prev[k]) prev[k] = v[k]; });
                if (sig && i === 0 && sig.company) prev.company = sig.company; // компанія з підпису точніша за домен
                AUTO.queue.set(p.email, prev);
            });
        });
        clearTimeout(AUTO.t);
        AUTO.t = setTimeout(flushAuto, 1200);
    }
    async function flushAuto() {
        if (AUTO.busy || !AUTO.queue.size) return;
        AUTO.busy = true;
        const items = [...AUTO.queue.values()]; AUTO.queue.clear();
        const ins = [], upd = [];
        items.forEach((v) => {
            const k = BOOK.byEmail(v.email);
            if (!k) return ins.push({ email: v.email, name: v.name || "", company: v.company || "", position: v.position || "", phone: v.phone || "", signature: v.signature || "", note: "" });
            const ch = {};
            ["name", "company", "position", "phone", "signature"].forEach((f) => { if (v[f] && !String(k[f] || "").trim()) ch[f] = v[f]; });
            // компанія «з домену» (одне слово) → уточнюємо з підпису
            if (v.signature && v.company && k.company && !k.signature && v.company !== k.company && !/\s/.test(k.company)) ch.company = v.company;
            if (Object.keys(ch).length) upd.push([k, ch]);
        });
        let changed = false;
        try {
            for (let i = 0; i < ins.length; i += 200) {
                const part = ins.slice(i, i + 200);
                let { data, error } = await sbClient.from("mail_contacts").insert(part).select();
                if (error) { // хтось уже додав одну з адрес — по одній
                    data = [];
                    for (const r of part) { const x = await sbClient.from("mail_contacts").insert(r).select().single(); if (x.data) data.push(x.data); }
                }
                (data || []).forEach((d) => { if (!BOOK.byEmail(d.email)) BOOK.list.push(d); });
                changed = changed || !!(data || []).length;
            }
            for (const [k, ch] of upd) {
                const { data } = await sbClient.from("mail_contacts").update(ch).eq("id", k.id).select().single();
                if (data) { const j = BOOK.list.findIndex((c) => c.id === data.id); if (j >= 0) BOOK.list[j] = data; changed = true; }
            }
        } catch (_) { /* не критично: спробуємо з наступними листами */ }
        AUTO.busy = false;
        if (changed) {
            BOOK.list.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, "uk"));
            if (ML.folders.length) renderFolders();
            if (ML.book) { renderBookList(); if (BOOK.sel?.id) { BOOK.sel = BOOK.list.find((c) => c.id === BOOK.sel.id) || BOOK.sel; } }
        }
        if (AUTO.queue.size) flushAuto();
    }
    window.furaMailAutoBook = autoBook;
    function bookFiltered() {
        const q = BOOK.q.toLowerCase();
        return !q ? BOOK.list : BOOK.list.filter((c) => [c.email, c.name, c.company, c.position, c.phone, c.note, c.signature].join(" ").toLowerCase().includes(q));
    }
    function renderBookList() {
        const list = bookFiltered();
        $("mlList").innerHTML = `<div class="sa-ml-head"><b>Адреси</b><span>${BOOK.list.length} контактів</span></div>
            <div class="sa-bk-bar"><input id="bkQ" type="search" placeholder="Пошук: e-mail, ім'я, компанія, телефон…" value="${escapeHtml(BOOK.q)}" /><button type="button" class="btn btn-primary" data-bk-new><i class="bx bx-plus"></i> Додати</button></div>
            ${BOOK.err ? `<p class="ag-empty">${escapeHtml(BOOK.err)}</p>` : !list.length ? `<p class="ag-empty">${BOOK.q ? "Нічого не знайдено" : "Ще порожньо. Адреси з листів (вхідних і надісланих) додаються сюди самі — або натисніть «Додати»."}</p>` : ""}
            ${list.map((c) => `<button type="button" class="sa-mi sa-bk-item ${BOOK.sel?.id === c.id ? "active" : ""}" data-bk="${c.id}">
                ${avatar(c.name || c.email)}<div class="sa-mi-body"><div class="sa-mi-top"><span class="sa-mi-from">${escapeHtml(c.name || c.email)}</span><span class="sa-mi-date">${escapeHtml(c.company || "")}</span></div>
                <div class="sa-mi-subj">${escapeHtml(c.email)}${c.note ? ` · ${escapeHtml(c.note)}` : ""}</div></div></button>`).join("")}`;
        const q = $("bkQ");
        q.addEventListener("input", () => { BOOK.q = q.value; const pos = q.selectionStart; renderBookList(); const n = $("bkQ"); n.focus(); n.setSelectionRange(pos, pos); });
    }
    function renderBookCard() {
        const c = BOOK.sel;
        if (!c) { $("mlRead").innerHTML = '<p class="ag-empty">Оберіть контакт зліва або натисніть «Додати»</p>'; return; }
        const f = (k, label, ph = "", type = "text") => `<label class="sa-bk-f"><span>${label}</span><input name="${k}" type="${type}" value="${escapeHtml(c[k] || "")}" placeholder="${ph}" /></label>`;
        $("mlRead").innerHTML = `<form class="sa-bk-card" id="bkForm" autocomplete="off">
            <div class="sa-bk-head">${avatar(c.name || c.email || "?")}<div><h3>${escapeHtml(c.name || c.email || "Новий контакт")}</h3><div class="sa-muted">${escapeHtml([c.position, c.company].filter(Boolean).join(" · "))}</div></div></div>
            <div class="sa-bk-grid">
                ${f("email", "E-mail *", "name@firma.com", "email")}${f("name", "Чия адреса (ім'я)", "Ім'я Прізвище")}
                ${f("company", "Компанія", "Назва компанії")}${f("position", "Посада", "напр. Logistics manager")}
                ${f("phone", "Телефон", "+48 …")}${f("note", "Нотатка", "клієнт / перевізник / митниця…")}
            </div>
            <label class="sa-bk-f"><span>Підпис (як підписується в листах)</span><textarea name="signature" rows="7" placeholder="Скопіюйте сюди підпис з листа">${escapeHtml(c.signature || "")}</textarea></label>
            <div class="sa-bk-actions">
                <button type="submit" class="btn btn-primary"><i class="bx bx-save"></i> Зберегти</button>
                ${c.email ? `<button type="button" class="btn btn-secondary" data-bk-write><i class="bx bx-edit"></i> Написати</button><button type="button" class="btn btn-secondary" data-bk-copy title="Скопіювати e-mail"><i class="bx bx-copy"></i></button>` : ""}
                ${c.id ? `<button type="button" class="btn btn-secondary sa-bk-del" data-bk-del title="Видалити"><i class="bx bx-trash"></i></button>` : ""}
            </div></form>`;
        $("bkForm").addEventListener("submit", (e) => { e.preventDefault(); saveBook(e.submitter || $("bkForm").querySelector('[type="submit"]')); });
    }
    async function openBook(pre) {
        ML.book = true; ML.open = null;
        if (!BOOK.loaded) await BOOK.load().catch(() => {});
        if (pre) BOOK.sel = pre._new ? { ...pre } : pre;
        readMode(!!pre);
        renderFolders(); renderBookList(); renderBookCard();
        if (pre) setTimeout(() => $("bkForm")?.querySelector(pre._new ? '[name="name"]' : '[name="note"]')?.focus(), 30);
    }
    async function saveBook(btn) {
        const fd = new FormData($("bkForm"));
        const row = Object.fromEntries(["email", "name", "company", "position", "phone", "note", "signature"].map((k) => [k, String(fd.get(k) || "").trim()]));
        row.email = (row.email.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i) || [""])[0].toLowerCase();
        if (!row.email) return toast("Вкажіть правильний e-mail", true);
        const dup = BOOK.byEmail(row.email);
        if (dup && dup.id !== BOOK.sel?.id) return toast("Така адреса вже є в «Адресах»", true);
        await withBusy(btn, async () => {
            const q = BOOK.sel?.id ? sbClient.from("mail_contacts").update(row).eq("id", BOOK.sel.id) : sbClient.from("mail_contacts").insert(row);
            const { data, error } = await q.select().single();
            if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? "Спершу виконайте mail_contacts.sql у Supabase" : error.message);
            const i = BOOK.list.findIndex((c) => c.id === data.id);
            if (i >= 0) BOOK.list[i] = data; else BOOK.list.push(data);
            BOOK.list.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, "uk"));
            BOOK.sel = data;
            toast("Збережено в «Адреси»");
            renderFolders(); renderBookList(); renderBookCard();
        });
    }
    function bookListClick(e) {
        const pg = e.target.closest("[data-bk-new]");
        if (pg) { BOOK.sel = { email: "", _new: true }; readMode(true); renderBookList(); renderBookCard(); return setTimeout(() => $("bkForm")?.email.focus(), 30); }
        const it = e.target.closest("[data-bk]");
        if (it) { BOOK.sel = BOOK.list.find((c) => c.id === it.dataset.bk) || null; readMode(true); renderBookList(); renderBookCard(); }
    }
    async function bookCardClick(e) {
        const c = BOOK.sel;
        if (!c) return;
        if (e.target.closest("[data-bk-write]")) return window.furaCompose?.({ to: c.email });
        if (e.target.closest("[data-bk-copy]")) { navigator.clipboard?.writeText(c.email).then(() => toast("E-mail скопійовано")).catch(() => {}); return; }
        const del = e.target.closest("[data-bk-del]");
        if (del && confirm(`Видалити ${c.email} з «Адрес»?`)) {
            await withBusy(del, async () => {
                const { error } = await sbClient.from("mail_contacts").delete().eq("id", c.id);
                if (error) throw new Error(error.message);
                BOOK.list = BOOK.list.filter((x) => x.id !== c.id); BOOK.sel = null;
                renderFolders(); renderBookList(); renderBookCard();
            }).catch((er) => toast(er.message, true));
        }
    }

    // прийшов новий лист (mail-watch.js) — оновити папки і список Вхідних
    window.addEventListener("fura-mail-new", () => {
        if (!ML.loaded) return;
        loadFolders().catch(() => {});
        if (!ML.book && !ML.page && !ML.q && kindOf(ML.folder) === "\\Inbox") loadList().catch(() => {});
    });
    // чернетку збережено / надіслано — оновити список, якщо дивимось «Чернетки»
    window.addEventListener("fura-draft-saved", () => { if (ML.loaded && !ML.book && kindOf(ML.folder) === "\\Drafts") loadList().catch(() => {}); });
    // нові листи — раз на 2 хвилини, коли пошта відкрита
    setInterval(() => {
        if (!ML.loaded || ML.book || document.hidden || document.querySelector('.sa-panel[data-panel="mail"]').hidden) return;
        loadFolders().catch(() => {});
        if (!ML.page && !ML.q && realPaths(ML.folder).length === 1) {
            const fp = realPaths(ML.folder)[0];
            api({ action: "mail_list", folder: fp, limit: 50 }).then((r) => { if (r.list?.[0]?.uid !== ML.list[0]?.uid) { ML.list = (r.list || []).map((m) => ({ ...m, fp })); renderList(); autoBook(ML.list); } }).catch(() => {});
        }
    }, 120000);
    // якщо вкладка «Пошта» відкрита з минулого разу
    setTimeout(() => { if (!document.querySelector('.sa-panel[data-panel="mail"]').hidden) start(); }, 1500);
})();
