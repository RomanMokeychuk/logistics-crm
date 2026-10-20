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
    const item = (ok, label) => `<span class="sa-st"><span class="sa-dot ${ok ? "good" : "bad"}"></span>${escapeHtml(label)}</span>`;
    $("saStatus").innerHTML = [
        item(s.ai, "Claude"),
        item(s.mail, s.mail ? `Пошта: ${s.from}` : "Пошта не налаштована"),
        item(s.sources.opendatabot || s.sources.youcontrol, "Реєстр (Opendatabot / YouControl)"),
        item(s.sources.snov, "Snov.io"),
        item(s.sources.apollo, "Apollo"),
        item(s.sources.rocketreach, "RocketReach"),
        `<span class="sa-st">${s.auto_followup ? "Нагадування: автоматично" : "Нагадування: через схвалення"}</span>`,
    ].join("");
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
        <div class="ag-item-actions">
            <button type="button" class="btn btn-primary" data-act="send"><i class="bx bx-send"></i> Надіслати</button>
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
    withBusy(btn, async () => {
        if (btn.dataset.act === "send") {
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

    let tab = "approve";
    try {
        tab = localStorage.getItem("fura-sales-tab") || "approve";
    } catch (_) {}
    showTab(tab);

    loadStatus();
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
