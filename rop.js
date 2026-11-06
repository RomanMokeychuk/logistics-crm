/* ================================================================= *
 * FURA — РОП (AI-керівник відділу продажів)                          *
 * • ранковий / тижневий звіт: головне, ризики, тренди, команда      *
 * • задачі від агента: «Зроблено» / «Не актуально» / призначити лід *
 * • пороги перевірок                                                 *
 * Сторінку бачать лише «Керівник» і «Адмін» (і так само база).      *
 * Усі зміни робить сервер (функція fura-rop).                        *
 * ================================================================= */

const SUPABASE_URL = "https://prbfscwmemshwigiftha.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const KIND_LABEL = {
    logist_reply: "Запит без відповіді логіста",
    stale_requests: "Старі запити без руху",
    sales_react: "Ставка без реакції Sales",
    lead_overdue: "Прострочений контакт",
    lead_stale: "Лід без руху",
    negotiation_long: "Затяжні переговори",
    client_silent: "Клієнт затих",
    payment_late: "Немає оплати",
    low_profit: "Низький профіт",
    deal_late: "Запізнення завантаження",
    draft_wait: "Листи AI-продажів",
    reply_waiting: "Клієнт відповів",
    assign_lead: "Лід без відповідального",
    client_unanswered: "Клієнт чекає відповіді",
    quote_not_given: "Ставку не назвали",
    client_complaint: "Скарга клієнта",
    rude_tone: "Тон відповіді",
};
const ROLE_LABEL = { sales: "Sales", logist: "Логіст", head: "Керівник", admin: "Адмін" };

const SETTINGS_FIELDS = [
    ["logist_reply_hours", "Логіст відповідає на запит", "год"],
    ["stale_request_days", "Запит без руху — «старий» (одна задача Sales закрити)", "дн."],
    ["sales_react_hours", "Sales реагує на ставку логіста", "год"],
    ["negotiation_days", "«Переговори» не довше", "дн."],
    ["new_lead_days", "«Новий» / «Контакт» без дій не довше", "дн."],
    ["client_silent_days", "Клієнт «затих» — без запитів", "дн."],
    ["payment_days", "Оплата клієнта після розвантаження", "дн."],
    ["min_profit_usd", "Мінімальний профіт угоди", "$"],
    ["draft_wait_hours", "Лист AI-продажів чекає схвалення", "год"],
    ["daily_hour", "Ранковий звіт — година (Київ)", "год"],
    ["daily_minute", "Ранковий звіт — хвилини", "хв"],
    ["weekly_day", "Тижневий звіт — день (1 = понеділок)", ""],
    ["client_reply_minutes", "Відповідь клієнту в месенджері / пошті", "хв"],
    ["quote_reply_hours", "Назвати ставку після запиту клієнта", "год"],
    ["work_start", "Робочий день — початок (для часу відповіді)", "год"],
    ["work_end", "Робочий день — кінець", "год"],
    ["work_saturday", "Субота робоча (1 — так, 0 — ні)", ""],
];

let me = null;
let staffList = [];
let reports = [];
let current = null;
let tasks = [];

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
const rolesOf = (s) => (Array.isArray(s?.roles) && s.roles.length ? s.roles : s?.role ? [s.role] : []);
const fmtNum = (v, d = 0) =>
    v === null || v === undefined ? "—" : Number(v).toLocaleString("uk-UA", { maximumFractionDigits: d });
const fmtUsd = (v) => (v === null || v === undefined ? "—" : `${fmtNum(v)} $`);

function fmtDateTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Лише внутрішні сторінки CRM (посилання приходять від агента)
function safeLink(link) {
    const s = String(link || "").trim();
    return /^[a-z-]+\.html(\?[\w=&%.-]*)?$/i.test(s) ? s : "";
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
    const { data, error } = await sbClient.functions.invoke("fura-rop", { body });
    if (error) {
        let message = "Сервер не відповів. Перевірте, чи розгорнута функція fura-rop.";
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

// Порівняння з попереднім періодом: ▲ 12% / ▼ 5%
function delta(cur, prev, betterUp = true) {
    if (cur === null || cur === undefined || !prev) return "";
    const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
    if (!p) return `<span class="rop-delta">= як минулого тижня</span>`;
    const good = betterUp ? p > 0 : p < 0;
    return `<span class="rop-delta ${good ? "up" : "down"}">${p > 0 ? "▲" : "▼"} ${Math.abs(p)}%</span>`;
}

/* ---------------- Звіт ---------------- */

async function loadReports() {
    const { data, error } = await sbClient
        .from("rop_reports")
        .select("id, kind, report_date, created_at, ai_ok, created_by")
        .order("created_at", { ascending: false })
        .limit(60);
    if (error) {
        $("ropMeta").innerHTML = `<span class="rop-warn">Не вдалося прочитати звіти: ${escapeHtml(error.message)}. Чи виконано rop.sql?</span>`;
        return;
    }
    reports = data || [];
    const kindLabel = { daily: "ранковий", weekly: "тижневий", manual: "вручну" };
    $("ropArchive").innerHTML = reports.length
        ? reports
              .map((r) => `<option value="${r.id}">${escapeHtml(r.report_date)} · ${kindLabel[r.kind] || r.kind} · ${fmtDateTime(r.created_at)}</option>`)
              .join("")
        : `<option value="">Звітів ще немає</option>`;
    if (reports.length) await openReport(current && reports.some((r) => r.id === current.id) ? current.id : reports[0].id);
    else renderEmpty();
}

async function openReport(id) {
    const { data, error } = await sbClient.from("rop_reports").select("*").eq("id", id).maybeSingle();
    if (error || !data) return toast("Звіт не знайдено", true);
    current = data;
    $("ropArchive").value = id;
    renderReport();
}

function renderEmpty() {
    $("ropMeta").innerHTML = `Звітів ще немає. Натисніть <b>«Оновити зараз»</b> — агент перевірить CRM за хвилину.`;
    $("ropHeadline").textContent = "";
    ["ropTop", "ropKpis", "ropRisks", "ropTrends", "ropFunnel", "ropPeople"].forEach((k) => ($(k).innerHTML = ""));
}

function renderReport() {
    const r = current;
    const m = r.metrics || {};
    const s = r.summary || {};
    const kindLabel = { daily: "Ранковий звіт", weekly: "Тижневий звіт", manual: "Звіт на вимогу" };
    const warn = (m.data_warnings || []).length
        ? ` · <span class="rop-warn" title="${escapeHtml(m.data_warnings.join("\n"))}">частину даних не прочитано (${m.data_warnings.length})</span>`
        : "";
    $("ropMeta").innerHTML =
        `<b>${kindLabel[r.kind] || "Звіт"}</b> · ${fmtDateTime(r.created_at)} · ${escapeHtml(r.created_by || "")}` +
        (r.ai_ok ? "" : ` · <span class="rop-warn" title="${escapeHtml(r.metrics?.ai_error || "")}">без висновків Claude — лише цифри${r.metrics?.ai_error ? ": " + escapeHtml(r.metrics.ai_error) : " (перевірте ANTHROPIC_API_KEY)"}</span>`) +
        warn;

    // Головне
    $("ropHeadline").textContent = s.headline || "";
    $("ropTop").innerHTML = (s.top_actions || []).length
        ? s.top_actions
              .map((a) => {
                  const link = safeLink(a.link);
                  return `<li>
                    <div class="rop-top-title">${escapeHtml(a.title)}</div>
                    <div class="rop-top-why">${escapeHtml(a.why)}</div>
                    <div class="rop-top-foot">
                        ${a.who ? `<span class="ag-chip">${escapeHtml(a.who)}</span>` : ""}
                        ${link ? `<a class="ag-link" href="${link}">Відкрити →</a>` : ""}
                    </div>
                </li>`;
              })
              .join("")
        : `<p class="ag-empty">Термінових дій немає — відділ працює за нормами.</p>`;
    const ws = $("ropWeekSummary");
    ws.hidden = !s.week_summary;
    ws.innerHTML = s.week_summary ? `<h3>Підсумок тижня</h3><p>${escapeHtml(s.week_summary)}</p>` : "";

    // Цифри
    const w = m.week || {}, pw = m.prev_week || {}, mo = m.month || {};
    const pr = m.problems || {};
    const kpi = (label, value, extra = "", tone = "") =>
        `<div class="rop-kpi ${tone}"><div class="rop-kpi-l">${label}</div><div class="rop-kpi-v">${value}</div><div class="rop-kpi-x">${extra}</div></div>`;
    $("ropKpis").innerHTML = [
        kpi("Запити за тиждень", fmtNum(w.requests), delta(w.requests, pw.requests)),
        kpi("Конверсія тижня", w.conversion_pct === null || w.conversion_pct === undefined ? "—" : `${w.conversion_pct}%`, delta(w.conversion_pct, pw.conversion_pct)),
        kpi("Профіт угод за тиждень", fmtUsd(w.profit_usd), delta(w.profit_usd, pw.profit_usd)),
        kpi("Профіт за 30 днів", fmtUsd(mo.profit_usd), `${fmtNum(mo.deals)} угод`),
        kpi("Відповідь логіста", w.avg_logist_reply_h === null || w.avg_logist_reply_h === undefined ? "—" : `${fmtNum(w.avg_logist_reply_h, 1)} год`, delta(w.avg_logist_reply_h, pw.avg_logist_reply_h, false)),
        kpi("Проблем зараз", fmtNum(pr.total), pr.urgent ? `з них термінових: <b>${pr.urgent}</b>` : "термінових немає", pr.urgent ? "bad" : ""),
    ].join("");

    // Ризики
    $("ropRisks").innerHTML = (s.risks || []).length
        ? s.risks
              .map((x) => `<div class="rop-risk ${x.level === "high" ? "high" : ""}"><b>${escapeHtml(x.title)}</b><p>${escapeHtml(x.details)}</p></div>`)
              .join("")
        : `<p class="ag-empty">${r.ai_ok ? "Суттєвих ризиків не знайдено." : "Висновки з'являться, коли підключено Claude."}</p>`;

    // Тренди + воронка + причини відмов
    $("ropTrends").innerHTML = (s.trends || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    const pipe = m.pipeline || {};
    const order = ["Новий", "Контакт", "Переговори", "Працюємо", "Відмова"];
    const maxP = Math.max(1, ...order.map((k) => pipe[k] || 0));
    const reasons = Object.entries(mo.refusal_reasons || {}).sort((a, b) => b[1] - a[1]);
    const op = m.open_requests || {};
    $("ropFunnel").innerHTML = `
        <h3>Ліди за етапами</h3>
        ${order
            .map((k) => `<div class="rop-bar"><span>${k}</span><i style="width:${Math.round(((pipe[k] || 0) / maxP) * 100)}%"></i><b>${pipe[k] || 0}</b></div>`)
            .join("")}
        <h3>Запити зараз</h3>
        <p class="ag-hint">Чекають логіста: <b>${op.waiting_logist ?? 0}</b> · чекають Sales: <b>${op.waiting_sales ?? 0}</b> · в роботі: <b>${op.in_work ?? 0}</b></p>
        ${reasons.length ? `<h3>Причини відмов за 30 днів</h3><p class="ag-hint">${reasons.map(([k, v]) => `${escapeHtml(k)}: <b>${v}</b>`).join(" · ")}</p>` : ""}
        ${(m.top_directions_30d || []).length ? `<h3>Топ напрямків за 30 днів</h3><p class="ag-hint">${m.top_directions_30d.map((d) => `${escapeHtml(d.route)}: <b>${d.requests}</b>`).join(" · ")}</p>` : ""}`;

    // Команда
    const verdicts = new Map((s.managers || []).map((x) => [String(x.staff_id), x]));
    $("ropPeople").innerHTML = (m.people || []).length
        ? m.people
              .map((p) => {
                  const v = verdicts.get(String(p.staff_id));
                  const rows = [];
                  if (p.sales) {
                      rows.push(
                          ["Запити 7 / 30 дн.", `${p.sales.requests_7d} / ${p.sales.requests_30d}`],
                          ["Конверсія 30 дн.", p.sales.conversion_30d_pct === null ? "—" : `${p.sales.conversion_30d_pct}%`],
                          ["Угоди / профіт 30 дн.", `${p.sales.deals_30d} / ${fmtUsd(p.sales.profit_30d_usd)}`],
                          ["Ліди в роботі / клієнти", `${p.sales.leads_active} / ${p.sales.clients_working}`],
                      );
                  }
                  if (p.logist) {
                      rows.push(
                          ["Запити / відповіді 30 дн.", `${p.logist.requests_30d} / ${p.logist.answered_30d}`],
                          ["Сер. час відповіді", p.logist.avg_reply_h === null ? "—" : `${fmtNum(p.logist.avg_reply_h, 1)} год`],
                          ["Відповіді з запізненням", fmtNum(p.logist.late_replies_30d)],
                          ["Угоди / профіт 30 дн.", `${p.logist.deals_30d} / ${fmtUsd(p.logist.profit_30d_usd)}`],
                      );
                  }
                  if (p.comms) {
                      const c = p.comms;
                      rows.push(
                          ["Переписка 7 дн.: вх. / вих.", `${c.messages_in_7d} / ${c.messages_out_7d}`],
                          ["Перша відповідь клієнту (медіана)", c.median_first_reply_min_30d === null ? "—" : `${fmtNum(c.median_first_reply_min_30d)} роб. хв`],
                          ["Клієнтів чекають відповіді", fmtNum(c.unanswered_now)],
                      );
                  }
                  return `<div class="rop-person">
                    <div class="rop-person-head">
                        <b>${escapeHtml(p.name)}</b>
                        <span class="ag-hint">${(p.roles || []).map((r) => ROLE_LABEL[r] || r).join(" · ")}</span>
                        <button type="button" class="rop-person-tasks ${p.problems_urgent ? "bad" : ""}" data-who="${escapeHtml(p.staff_id)}" title="Показати задачі">
                            ${p.problems_now} задач${p.problems_urgent ? ` · ${p.problems_urgent} терм.` : ""}
                        </button>
                    </div>
                    <dl>${rows.map(([k, val]) => `<dt>${k}</dt><dd>${escapeHtml(val)}</dd>`).join("")}</dl>
                    ${
                        v
                            ? `<div class="rop-verdict">
                                <p>${escapeHtml(v.verdict)}</p>
                                ${v.good ? `<p class="good">👍 ${escapeHtml(v.good)}</p>` : ""}
                                ${v.improve ? `<p class="improve">🎯 ${escapeHtml(v.improve)}</p>` : ""}
                              </div>`
                            : ""
                    }
                </div>`;
              })
              .join("")
        : `<p class="ag-empty">У «Співробітниках» немає активних людей з ролями Sales або Логіст.</p>`;
}

/* ---------------- Задачі ---------------- */

async function loadTasks() {
    const status = $("ropTaskStatus").value || "open";
    let q = sbClient.from("rop_tasks").select("*").eq("status", status);
    q = status === "open" ? q.order("priority").order("created_at", { ascending: false }) : q.order("closed_at", { ascending: false });
    const { data, error } = await q.limit(500);
    if (error) {
        $("ropTasks").innerHTML = `<p class="ag-empty">Не вдалося прочитати задачі: ${escapeHtml(error.message)}</p>`;
        return;
    }
    tasks = data || [];
    renderTasks();
}

function salesOptions(selected) {
    const sales = staffList.filter((s) => s.active && rolesOf(s).includes("sales"));
    return sales
        .map((s) => `<option value="${escapeHtml(s.id)}" ${String(s.id) === String(selected) ? "selected" : ""}>${escapeHtml(s.full_name)}</option>`)
        .join("");
}

function renderTasks() {
    const who = $("ropTaskWho").value;
    const kind = $("ropTaskKind").value;
    const status = $("ropTaskStatus").value || "open";
    const list = tasks.filter(
        (t) => (!kind || t.kind === kind) && (!who || (who === "__boss" ? !t.assignee_id : String(t.assignee_id) === who)),
    );
    $("ropTaskCount").textContent = list.length;
    if (!list.length) {
        $("ropTasks").innerHTML = `<p class="ag-empty">${status === "open" ? "Відкритих задач немає 🎉" : "Порожньо."}</p>`;
        return;
    }
    $("ropTasks").innerHTML = list
        .map((t) => {
            const link = safeLink(t.link);
            const assign =
                status === "open" && t.kind === "assign_lead"
                    ? `<select class="rop-assign-select" data-id="${t.id}">${salesOptions(t.suggestion?.staff_id)}</select>
                       <button type="button" class="btn btn-primary btn-sm" data-act="assign" data-id="${t.id}"><i class="bx bx-user-check"></i> Призначити</button>`
                    : "";
            const actions =
                status === "open"
                    ? `${assign}
                       ${t.kind === "assign_lead" ? "" : `<button type="button" class="btn btn-secondary btn-sm" data-act="done" data-id="${t.id}"><i class="bx bx-check"></i> Зроблено</button>`}
                       <button type="button" class="btn btn-secondary btn-sm" data-act="dismissed" data-id="${t.id}" title="Сховати на 7 днів">Не актуально</button>`
                    : `<span class="ag-hint">${escapeHtml(t.closed_by || "")} · ${fmtDateTime(t.closed_at)}</span>`;
            return `<div class="rop-task p${t.priority}">
                <div class="rop-task-main">
                    <div class="rop-task-top">
                        <span class="rop-prio" title="${t.priority === 1 ? "Терміново" : t.priority === 2 ? "Сьогодні" : "Коли буде час"}"></span>
                        <span class="ag-chip">${escapeHtml(KIND_LABEL[t.kind] || t.kind)}</span>
                        <span class="rop-task-who">${escapeHtml(t.assignee_name || "Керівник")}</span>
                        <span class="ag-hint">з ${fmtDateTime(t.created_at)}</span>
                    </div>
                    <div class="rop-task-title">${escapeHtml(t.title)}</div>
                    ${t.details ? `<div class="rop-task-details">${escapeHtml(t.details)}</div>` : ""}
                </div>
                <div class="rop-task-actions">
                    ${link ? `<a class="btn btn-secondary btn-sm" href="${link}"><i class="bx bx-link-external"></i> Відкрити</a>` : ""}
                    ${actions}
                </div>
            </div>`;
        })
        .join("");
}

$("ropTasks").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.dataset.id;
    withBusy(b, async () => {
        if (b.dataset.act === "assign") {
            const sel = document.querySelector(`.rop-assign-select[data-id="${id}"]`);
            const r = await api({ action: "assign", task_id: id, staff_id: sel?.value });
            toast(`Лід передано: ${r.staff_name}`);
        } else {
            await api({ action: "task", id, status: b.dataset.act });
            toast(b.dataset.act === "done" ? "Позначено як зроблене" : "Сховано на 7 днів");
        }
        await loadTasks();
    });
});

$("ropPeople").addEventListener("click", (e) => {
    const b = e.target.closest("[data-who]");
    if (!b) return;
    $("ropTaskWho").value = b.dataset.who;
    $("ropTaskStatus").value = "open";
    loadTasks();
    $("ropTasksCard").scrollIntoView({ behavior: "smooth", block: "start" });
});

["ropTaskWho", "ropTaskKind"].forEach((id) => $(id).addEventListener("change", renderTasks));
$("ropTaskStatus").addEventListener("change", loadTasks);
$("ropArchive").addEventListener("change", (e) => e.target.value && openReport(e.target.value));

/* ---------------- Запуск і пороги ---------------- */

function runReport(btn, kind) {
    withBusy(btn, async () => {
        toast("Агент перевіряє CRM… це до хвилини");
        const r = await api({ action: "run", kind });
        toast(`Готово: проблем ${r.problems}, нових задач ${r.tasks?.created ?? 0}, закрито ${r.tasks?.auto_closed ?? 0}`);
        current = { id: r.report_id };
        await Promise.all([loadReports(), loadTasks()]);
    });
}
$("ropRunBtn").addEventListener("click", (e) => runReport(e.currentTarget, "manual"));
$("ropWeeklyBtn").addEventListener("click", (e) => runReport(e.currentTarget, "weekly"));

async function openSettings() {
    const { data } = await sbClient.from("rop_settings").select("settings, updated_by, updated_at").eq("id", 1).maybeSingle();
    const s = data?.settings || {};
    $("ropSettingsForm").innerHTML =
        SETTINGS_FIELDS.map(
            ([k, label, unit]) => `<label><span>${label}</span><span class="rop-input"><input type="number" name="${k}" value="${escapeHtml(s[k] ?? "")}" min="0" step="1" /><em>${unit}</em></span></label>`,
        ).join("") + (data?.updated_by ? `<p class="ag-hint">Змінено: ${escapeHtml(data.updated_by)}, ${fmtDateTime(data.updated_at)}</p>` : "");
    $("ropSettingsOverlay").classList.add("active");
}
function closeSettings() {
    $("ropSettingsOverlay").classList.remove("active");
}
$("ropSettingsBtn").addEventListener("click", openSettings);
$("ropSettingsClose").addEventListener("click", closeSettings);
$("ropSettingsOverlay").addEventListener("click", (e) => e.target.id === "ropSettingsOverlay" && closeSettings());
$("ropSettingsSave").addEventListener("click", (e) =>
    withBusy(e.currentTarget, async () => {
        const settings = {};
        new FormData($("ropSettingsForm")).forEach((v, k) => {
            if (String(v).trim() !== "") settings[k] = Number(v);
        });
        await api({ action: "settings", settings });
        toast("Пороги збережено");
        closeSettings();
    }),
);

/* ---------------- Старт ---------------- */

document.addEventListener("DOMContentLoaded", async () => {
    const {
        data: { session },
    } = await sbClient.auth.getSession();
    if (!session) {
        window.location.href = "login.html";
        return;
    }
    sbClient.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") window.location.href = "login.html";
    });

    const { data: staff } = await sbClient.from("staff").select("*");
    staffList = staff || [];
    const email = (session.user?.email || "").toLowerCase();
    me = staffList.find((s) => (s.email || "").toLowerCase() === email) || null;
    const boss = rolesOf(me).some((r) => r === "head" || r === "admin");

    document.body.style.visibility = "visible";
    if (!boss) {
        $("ropDenied").hidden = false;
        document.querySelector(".rop-actions").hidden = true;
        return;
    }
    $("ropBody").hidden = false;

    $("ropTaskWho").innerHTML =
        `<option value="">Усі співробітники</option><option value="__boss">Керівник (без відповідального)</option>` +
        staffList
            .filter((s) => s.active && rolesOf(s).some((r) => r === "sales" || r === "logist"))
            .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.full_name)}</option>`)
            .join("");
    $("ropTaskKind").innerHTML =
        `<option value="">Усі типи</option>` +
        Object.entries(KIND_LABEL)
            .map(([k, v]) => `<option value="${k}">${v}</option>`)
            .join("");

    await Promise.all([loadReports(), loadTasks()]);

    // Нові звіти й задачі з'являються самі
    let t = null;
    const later = (fn) => () => {
        clearTimeout(t);
        t = setTimeout(fn, 800);
    };
    sbClient
        .channel("rop")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "rop_reports" }, later(loadReports))
        .on("postgres_changes", { event: "*", schema: "public", table: "rop_tasks" }, later(loadTasks))
        .subscribe();
});
