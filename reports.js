/* ================================================================= *
 * FURA — ПІДСУМКИ: Огляд · Люди · Угоди · Архів                      *
 * Період: місяць / квартал / рік. Гроші (analytics-core.js):         *
 * керівник і адмін — усі угоди, Sales — лише свої.                   *
 * ================================================================= */

const SUPABASE_URL = "https://prbfscwmemshwigiftha.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function logout() {
    await sbClient.auth.signOut();
    window.location.href = "login.html";
}

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
const esc = escapeHtml;
const $ = (id) => document.getElementById(id);
const A = window.FuraAnalytics; // розрахунки грошей (analytics-core.js)

const MONTHS = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
const MON = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
const QUARTERS = ["I", "II", "III", "IV"];
const REQUEST_STATUSES = ["Запит", "Відповідь", "В роботі", "Виконано", "Відмова"];
const REQUEST_TYPES = ["Прорахунок", "Пошук авто", "Завантаження"];
const LEAD_STAGES = ["Новий", "Контакт", "Переговори", "Працюємо", "Відмова"];
const WORK_STATUSES = ["В роботі", "Виконано"];
const PAGE = 150;

let allRequests = [];
let allLeads = [];
let allDeals = []; // керівник — усі; Sales — лише свої
let staff = [];
let me = null;
let isBoss = false;
let isSales = false;
let seesMoney = false;
let P = null; // період: { unit: month|quarter|year, y, m } (m — перший місяць періоду)
let tab = "overview";
let chartMode = "profit";
let shown = PAGE;
let dealsResult = null;
let peopleResult = null;
const sortState = { salesTable: ["profit", -1], logistTable: ["profit", -1], anDeals: ["date", -1] };

/* ---------------- Дати й період ---------------- */

const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// День події за київським (локальним) часом; дати без часу — як є
const dayOf = (iso) => (!iso ? "" : String(iso).length <= 10 ? String(iso) : ymd(new Date(iso)));
const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const keyOf = (iso) => (iso ? dayOf(iso).slice(0, 7) : "");

function normP(p) {
    const m = p.unit === "year" ? 0 : p.unit === "quarter" ? Math.floor(p.m / 3) * 3 : p.m;
    return { unit: p.unit, y: p.y, m };
}
const spanOf = (unit) => (unit === "year" ? 12 : unit === "quarter" ? 3 : 1);
function rangeOf(p) {
    const len = spanOf(p.unit);
    return { from: ymd(new Date(p.y, p.m, 1)), to: ymd(new Date(p.y, p.m + len, 0)), months: len };
}
function shiftP(p, dir) {
    const d = new Date(p.y, p.m + dir * spanOf(p.unit), 1);
    return normP({ unit: p.unit, y: d.getFullYear(), m: d.getMonth() });
}
function labelOf(p) {
    if (p.unit === "year") return `${p.y} рік`;
    if (p.unit === "quarter") return `${QUARTERS[p.m / 3]} квартал ${p.y}`;
    return `${MONTHS[p.m]} ${p.y}`;
}
const prevWord = () => (P.unit === "year" ? "мин. року" : P.unit === "quarter" ? "мин. кварталу" : "мин. місяця");
const inR = (iso, R) => {
    const d = dayOf(iso);
    return !!d && d >= R.from && d <= R.to;
};

function fmtDuration(min) {
    if (!isFinite(min)) return "—";
    min = Math.round(min);
    if (min < 60) return `${min} хв`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} год ${min % 60 ? (min % 60) + " хв" : ""}`.trim();
    return `${Math.floor(h / 24)} дн ${h % 24} год`;
}
const median = (arr) => {
    if (!arr.length) return NaN;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const usd = (v) => (v == null || !isFinite(v) ? "—" : `${Math.round(v).toLocaleString("uk-UA")} $`);
const pctf = (v) => (v == null || !isFinite(v) ? "—" : `${v.toFixed(1).replace(".", ",")}%`);
const dmy = (iso) => (iso ? dayOf(iso).split("-").reverse().join(".") : "");
const marginCls = (m) => (m == null ? "" : m < 0 ? "conv-bad" : m < 5 ? "conv-mid" : "conv-good");

const nameOf = (id) => staff.find((s) => String(s.id) === String(id))?.full_name || null;
const rolesOf = (s) => (Array.isArray(s?.roles) && s.roles.length ? s.roles : s?.role ? [s.role] : []);

// Зміна до попереднього періоду: абсолютна (кількості) або у % (гроші)
function trend(cur, prev, { invert = false, suffix = "", percent = false } = {}) {
    if (prev === null || prev === undefined || !isFinite(prev) || cur === null || cur === undefined || !isFinite(cur)) return "";
    let diff, text;
    if (percent) {
        if (!prev) return cur ? `<span class="kpi-trend">новий результат</span>` : "";
        diff = Math.round(((cur - prev) / Math.abs(prev)) * 100);
        text = `${Math.abs(diff)}%`;
    } else {
        diff = suffix === " п.п." ? Math.round((cur - prev) * 10) / 10 : Math.round(cur - prev);
        text = `${String(Math.abs(diff)).replace(".", ",")}${suffix}`;
    }
    if (!diff) return `<span class="kpi-trend">як ${prevWord()}</span>`;
    const good = invert ? diff < 0 : diff > 0;
    return `<span class="kpi-trend ${good ? "up" : "down"}">${diff > 0 ? "▲" : "▼"} ${text} до ${prevWord()}</span>`;
}
const kpiHtml = (label, value, extra = "", cls = "") => `<div class="kpi ${cls}"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span>${extra}</div>`;

/* ---------------- Підказка при наведенні ---------------- */

const tip = $("repTip");
document.addEventListener("mousemove", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) {
        tip.hidden = true;
        return;
    }
    tip.innerHTML = t.dataset.tip;
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    const y = Math.max(8, e.clientY - tip.offsetHeight - 12);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
});

/* ---------------- Графіки (без сторонніх бібліотек) ---------------- */

function hbars(el, rows, { color = "var(--series-1)", unit = "", empty = "Даних немає" } = {}) {
    const max = Math.max(...rows.map((r) => r.value), 0);
    if (!max) {
        el.innerHTML = `<div class="rep-empty">${empty}</div>`;
        return;
    }
    el.innerHTML = rows
        .map(
            (r) => `
        <div class="hbar" data-tip="<b>${escapeHtml(r.label)}</b><br>${r.value}${unit}${r.sub ? " · " + escapeHtml(r.sub) : ""}">
            <span class="hbar-label">${escapeHtml(r.label)}</span>
            <span class="hbar-track"><span class="hbar-fill" style="width:${r.value ? Math.max(2, (r.value / max) * 100) : 0}%; background:${r.color || color}"></span></span>
            <span class="hbar-value">${r.value}${unit}</span>
        </div>`,
        )
        .join("");
}

// Стовпчики: [{ v, axis, tip, weekend, today }]
function columns(el, items) {
    const max = Math.max(...items.map((i) => i.v), 0);
    const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
    el.innerHTML = `
        <div class="dc-plot">
            <div class="dc-grid">${ticks.map((t) => `<div class="dc-gridline" style="bottom:${max ? (t / max) * 100 : 0}%"><span>${t}</span></div>`).join("")}</div>
            <div class="dc-cols">${items
                .map((i) => `<div class="dc-col ${i.weekend ? "dc-weekend" : ""} ${i.today ? "dc-today" : ""}" data-tip="${i.tip}"><div class="dc-bar" style="height:${max ? (i.v / max) * 100 : 0}%"></div></div>`)
                .join("")}</div>
        </div>
        <div class="dc-axis">${items.map((i) => `<span>${i.axis}</span>`).join("")}</div>`;
}

// Кількість подій по днях (місяць) або по місяцях (квартал, рік)
function periodItems(dates, what) {
    const R = rangeOf(P);
    const today = ymd(new Date());
    if (P.unit === "month") {
        const days = new Date(P.y, P.m + 1, 0).getDate();
        const c = Array(days).fill(0);
        dates.forEach((d) => inR(d, R) && c[Number(dayOf(d).slice(8, 10)) - 1]++);
        return c.map((v, i) => {
            const date = new Date(P.y, P.m, i + 1);
            return { v, axis: (i + 1) % 5 === 0 || i === 0 ? i + 1 : "", tip: `<b>${pad2(i + 1)}.${pad2(P.m + 1)}</b><br>${what}: ${v}`, weekend: [0, 6].includes(date.getDay()), today: ymd(date) === today };
        });
    }
    const c = Array(R.months).fill(0);
    dates.forEach((d) => {
        if (!inR(d, R)) return;
        const [y, m] = dayOf(d).split("-").map(Number);
        c[(y - P.y) * 12 + (m - 1) - P.m]++;
    });
    return c.map((v, i) => ({ v, axis: MON[(P.m + i) % 12], tip: `<b>${MONTHS[(P.m + i) % 12]}</b><br>${what}: ${v}`, today: monthKey(new Date(P.y, P.m + i, 1)) === today.slice(0, 7) }));
}

// Профіт по місяцях: 12 місяців до кінця періоду
function profitChart(el, deals, basis, filters = {}) {
    const months = A.monthly(deals, basis, filters, rangeOf(P).to, 12);
    const maxP = Math.max(1, ...months.map((m) => Math.abs(m.profit)));
    const hasNeg = months.some((m) => m.profit < 0);
    const W = 760, H = 200, top = 18, bottom = 44;
    const plotH = H - top - bottom;
    const posH = hasNeg ? plotH * 0.75 : plotH;
    const zeroY = top + posH;
    const sc = (v) => (Math.abs(v) / maxP) * posH;
    const slot = W / months.length;
    const bw = Math.min(34, slot * 0.55);
    const R = rangeOf(P);
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="an-svg" role="img" aria-label="Профіт по місяцях"><line x1="0" x2="${W}" y1="${zeroY}" y2="${zeroY}" class="an-axis"/>`;
    months.forEach((m, i) => {
        const cx = slot * i + slot / 2;
        const h = sc(m.profit);
        const inPeriod = `${m.key}-01` >= R.from && `${m.key}-01` <= R.to;
        svg += `<g data-tip="<b>${MONTHS[m.m]} ${m.y}</b><br>профіт ${esc(usd(m.profit))}<br>виручка ${esc(usd(m.income))}<br>маржа ${esc(pctf(m.margin))} · угод ${m.deals}"><rect x="${cx - slot / 2}" y="0" width="${slot}" height="${H}" fill="transparent"/>`;
        svg += `<rect x="${cx - bw / 2}" y="${m.profit >= 0 ? zeroY - h : zeroY}" width="${bw}" height="${Math.max(h, 0.5)}" rx="4" class="${m.profit < 0 ? "an-bar-neg" : inPeriod ? "an-bar-p" : "an-bar-dim"}"/>`;
        if (m.deals) svg += `<text x="${cx}" y="${m.profit >= 0 ? zeroY - h - 5 : zeroY + h + 12}" class="an-val">${(m.profit / 1000).toFixed(1).replace(".", ",")}k</text>`;
        svg += `<text x="${cx}" y="${H - 26}" class="an-lbl">${MON[m.m]}${m.m === 0 || i === 0 ? ` ${String(m.y).slice(2)}` : ""}</text>`;
        svg += `<text x="${cx}" y="${H - 12}" class="an-lbl an-yr">${m.deals ? pctf(m.margin) : ""}</text></g>`;
    });
    el.innerHTML = svg + `</svg><div class="an-legend"><span><i class="an-sw an-sw-p"></i> Профіт, тис. $ (обраний період)</span><span><i class="an-sw an-sw-dim"></i> інші місяці</span><span><i class="an-sw an-sw-neg"></i> мінус</span><span>під місяцем — маржа</span></div>`;
}

/* ---------------- Гроші ---------------- */

const basis = () => $("fBasis").value || "load";
const dealsIn = (R, list = allDeals) => list.filter((d) => inR(A.dealDate(d, basis()), R));
const isMyDeal = (d) => String(d.sales_id) === String(me?.id) || (!d.sales_id && d.sales && d.sales === me?.full_name);

/* ---------------- ОГЛЯД ---------------- */

function summaryOf(R) {
    const reqs = allRequests.filter((r) => inR(r.created_at, R));
    const answered = reqs.filter((r) => r.answered_at);
    const working = reqs.filter((r) => WORK_STATUSES.includes(r.status));
    return {
        reqs,
        total: reqs.length,
        answeredPct: pct(answered.length, reqs.length),
        responseMedian: median(answered.map((r) => (new Date(r.answered_at) - new Date(r.created_at)) / 60000).filter((x) => x >= 0)),
        working: working.length,
        conversion: pct(working.length, reqs.length),
        leadsNew: allLeads.filter((l) => inR(l.created_at, R)).length,
    };
}

function renderOverview() {
    const R = rangeOf(P), PR = rangeOf(shiftP(P, -1));
    const s = summaryOf(R), p = summaryOf(PR);

    if (isBoss) {
        const m = A.summarize(dealsIn(R)), pm = A.summarize(dealsIn(PR));
        $("kpiGrid").innerHTML = [
            kpiHtml("Запитів", s.total, trend(s.total, p.total)),
            kpiHtml("Запит → робота", `${s.conversion}%`, trend(s.conversion, p.total ? p.conversion : null, { suffix: " п.п." })),
            kpiHtml("Угод", m.deals, trend(m.deals, pm.deals)),
            kpiHtml("Профіт", usd(m.profit), trend(m.profit, pm.profit, { percent: true }), m.profit < 0 ? "an-bad" : ""),
            kpiHtml("Маржа", pctf(m.margin), trend(m.margin, pm.margin, { suffix: " п.п." })),
            kpiHtml("Дебіторка", usd(m.receivable), m.overdue ? `<span class="kpi-trend down">прострочено: ${usd(m.overdue)}</span>` : `<span class="kpi-trend">прострочки немає</span>`, m.overdue ? "an-bad" : ""),
        ].join("");
    }

    // Головний графік
    const showProfit = isBoss && chartMode === "profit";
    $("chartTitle").textContent = showProfit ? "Профіт по місяцях" : P.unit === "month" ? "Запити по днях" : "Запити по місяцях";
    if (showProfit) {
        profitChart($("dayChart"), allDeals, basis());
        $("daysSub").textContent = "12 місяців до кінця періоду";
    } else {
        const items = periodItems(s.reqs.map((r) => r.created_at), "Запитів");
        columns($("dayChart"), items);
        const best = items.reduce((a, b) => (b.v > a.v ? b : a), { v: 0 });
        $("daysSub").textContent = s.total ? `найбільше: ${best.v}` : "";
    }

    hbars($("statusChart"), REQUEST_STATUSES.map((st) => ({ label: st, value: s.reqs.filter((r) => r.status === st).length })));
    hbars($("typeChart"), REQUEST_TYPES.map((t) => ({ label: t, value: s.reqs.filter((r) => r.request_type === t).length })), { color: "var(--series-2)" });
    hbars(
        $("leadStageChart"),
        LEAD_STAGES.map((st) => ({ label: st, value: allLeads.filter((l) => l.status === st && (isBoss || String(l.sales_id) === String(me?.id))).length })),
        { color: "var(--series-3)" },
    );
    renderMine(R, PR);
}

/* ---------------- МОЯ РОБОТА ---------------- */

function myStats(R) {
    const myId = String(me?.id || "");
    const myName = me?.full_name || "";
    const reqs = allRequests.filter((r) => inR(r.created_at, R));
    const mineSales = reqs.filter((r) => String(r.sales_id) === myId || (!r.sales_id && r.sales === myName));
    const work = mineSales.filter((r) => WORK_STATUSES.includes(r.status)).length;
    const myLeads = allLeads.filter((l) => String(l.sales_id) === myId);
    let notes = 0;
    allLeads.forEach((l) => (l.history || []).forEach((h) => !h.auto && h.author === myName && inR(h.at, R) && notes++));

    let answers = 0, assigned = 0, chosen = 0;
    const times = [], actions = mineSales.map((r) => r.created_at);
    allRequests.forEach((r) => {
        (r.answers || []).forEach((a) => {
            if (String(a.logist_id) !== myId || !inR(a.at, R)) return;
            answers++;
            actions.push(a.at);
            const t = (new Date(a.at) - new Date(r.created_at)) / 60000;
            if (t >= 0) times.push(t);
        });
        if (inR(r.created_at, R)) {
            if ((r.logistician_ids || []).map(String).includes(myId)) assigned++;
            if (WORK_STATUSES.includes(r.status) && String(r.logistician_id) === myId) chosen++;
        }
    });
    const waiting = allRequests.filter(
        (r) => ["Запит", "Відповідь"].includes(r.status) && (r.logistician_ids || []).map(String).includes(myId) && !(r.answers || []).some((a) => String(a.logist_id) === myId),
    ).length;
    return {
        sales: {
            total: mineSales.length, work, conv: pct(work, mineSales.length), refused: mineSales.filter((r) => r.status === "Відмова").length,
            newLeads: myLeads.filter((l) => inR(l.created_at, R)).length, notes,
            clients: myLeads.filter((l) => l.status === "Працюємо").length, leads: myLeads.length,
        },
        money: A.summarize(dealsIn(R, allDeals.filter(isMyDeal))),
        logist: { answers, time: median(times), assigned, chosen, waiting, answerRate: pct(answers, assigned) },
        actions,
    };
}

function renderMine(R, PR) {
    const roles = rolesOf(me);
    const asSales = roles.some((r) => ["sales", "head"].includes(r));
    const asLogist = roles.includes("logist");
    const card = $("myCard");
    if (!me || (!asSales && !asLogist)) {
        card.hidden = true;
        return;
    }
    card.hidden = false;
    $("myTitle").textContent = `Моя робота — ${me.full_name}`;
    $("mySub").textContent = labelOf(P);
    const cur = myStats(R), prev = myStats(PR);
    // Керівнику без власних запитів / відповідей / угод картка не потрібна — одразу команда
    if (isBoss && !cur.sales.total && !cur.logist.answers && !cur.logist.waiting && !cur.money.deals && !cur.sales.notes) {
        card.hidden = true;
        return;
    }
    let html = "";
    if (asSales) {
        html += `<div class="my-role"><i class='bx bx-briefcase'></i> Як Sales</div>
        <div class="kpi-grid">
            ${kpiHtml("Моїх запитів", cur.sales.total, trend(cur.sales.total, prev.sales.total))}
            ${kpiHtml("В роботі / виконано", cur.sales.work, `<span class="kpi-trend">конверсія ${cur.sales.conv}%</span>`)}
            ${kpiHtml("Нових клієнтів", cur.sales.newLeads, trend(cur.sales.newLeads, prev.sales.newLeads))}
            ${kpiHtml("Записів про спілкування", cur.sales.notes, trend(cur.sales.notes, prev.sales.notes))}
            ${kpiHtml("Працюємо з клієнтами", cur.sales.clients, `<span class="kpi-trend">моїх лідів: ${cur.sales.leads}</span>`)}
        </div>`;
        const m = cur.money, pm = prev.money;
        if (seesMoney && (m.deals || pm.deals)) {
            html += `<div class="my-role"><i class='bx bx-dollar-circle'></i> Мої гроші <span class="rep-sub">угоди, де я Sales · бачу лише я і керівник</span></div>
            <div class="kpi-grid">
                ${kpiHtml("Моїх угод", m.deals, trend(m.deals, pm.deals))}
                ${kpiHtml("Профіт", usd(m.profit), trend(m.profit, pm.profit, { percent: true }), m.profit < 0 ? "an-bad" : "")}
                ${kpiHtml("Маржа", pctf(m.margin), trend(m.margin, pm.margin, { suffix: " п.п." }))}
                ${kpiHtml("На угоду", usd(m.avgProfit))}
                ${kpiHtml("Клієнти винні", usd(m.receivable), m.overdue ? `<span class="kpi-trend down">прострочено: ${usd(m.overdue)}</span>` : `<span class="kpi-trend up">прострочки немає</span>`, m.overdue ? "an-bad" : "")}
            </div>
            ${m.incomplete ? `<p class="rep-sub an-warn">У ${m.incomplete} моїх угодах не вказано ставку або курс — вони не враховані. Заповніть у картці угоди.</p>` : ""}`;
        }
    }
    if (asLogist) {
        const t = cur.logist.time;
        const tone = !isFinite(t) ? "" : t <= 60 ? "up" : t <= 120 ? "" : "down";
        html += `<div class="my-role"><i class='bx bx-car'></i> Як логіст</div>
        <div class="kpi-grid">
            ${kpiHtml("Моїх відповідей", cur.logist.answers, trend(cur.logist.answers, prev.logist.answers))}
            ${kpiHtml("Надіслано мені", cur.logist.assigned, `<span class="kpi-trend">відповів на ${cur.logist.answerRate}%</span>`)}
            ${kpiHtml("Мій час відповіді", fmtDuration(t), `<span class="kpi-trend ${tone}">${!isFinite(t) ? "" : t <= 60 ? "швидко 👍" : t <= 120 ? "в межах 2 год" : "довше 2 год"}</span>`)}
            ${kpiHtml("Обрали мою ціну", cur.logist.chosen, trend(cur.logist.chosen, prev.logist.chosen))}
            ${kpiHtml("Чекають моєї відповіді", cur.logist.waiting, cur.logist.waiting ? `<span class="kpi-trend down">зараз</span>` : `<span class="kpi-trend up">усе відповів</span>`)}
        </div>`;
    }
    html += `<div class="my-role"><i class='bx bx-calendar'></i> Моя активність <span class="rep-sub">запити як Sales + відповіді як логіст</span></div><div class="daychart" id="myDayChart"></div>`;
    $("myBody").innerHTML = html;
    columns($("myDayChart"), periodItems(cur.actions, "Дій"));
}

/* ---------------- ЛЮДИ (керівник) ---------------- */

function peopleRows(R, PR) {
    const money = A.compute({ deals: allDeals, requests: [], staff, from: R.from, to: R.to, basis: basis(), filters: {} });
    const reqs = allRequests.filter((r) => inR(r.created_at, R));
    const prevReqs = allRequests.filter((r) => inR(r.created_at, PR));

    // Sales: кожен, хто має роль Sales / Керівник, або фігурує в запитах / угодах
    const keys = new Map();
    staff.filter((s) => s.active && rolesOf(s).some((r) => ["sales", "head"].includes(r))).forEach((s) => keys.set(String(s.id), s.full_name));
    reqs.forEach((r) => (r.sales_id || r.sales) && keys.set(String(r.sales_id || r.sales), nameOf(r.sales_id) || r.sales));
    money.sales.forEach((g) => keys.set(g.key, g.label));
    const notesBy = new Map();
    allLeads.forEach((l) => (l.history || []).forEach((h) => !h.auto && h.author && inR(h.at, R) && notesBy.set(h.author, (notesBy.get(h.author) || 0) + 1)));
    const sales = [...keys.entries()].map(([key, label]) => {
        const mine = reqs.filter((r) => String(r.sales_id || r.sales) === key);
        const work = mine.filter((r) => WORK_STATUSES.includes(r.status)).length;
        const g = money.sales.find((x) => x.key === key) || { ...A.summarize([]), items: [], clients: 0, newClients: 0, prevProfit: 0 };
        return {
            ...g, // гроші; поля активності нижче мають пріоритет (у g є свої «requests» з порожнього списку)
            key, label, kind: "sales",
            requests: mine.length, prevRequests: prevReqs.filter((r) => String(r.sales_id || r.sales) === key).length,
            work, conversion: mine.length ? (work / mine.length) * 100 : null,
            newLeads: allLeads.filter((l) => String(l.sales_id || l.sales) === key && inR(l.created_at, R)).length,
            notes: notesBy.get(label) || 0,
        };
    }).filter((r) => r.requests || r.deals || r.newLeads || r.notes);

    // Логісти
    const lg = new Map();
    const get = (id, name) => {
        const k = String(id || name || "");
        if (!lg.has(k)) lg.set(k, { key: k, label: nameOf(id) || name || "—", answers: 0, times: [], assigned: 0, chosen: 0 });
        return lg.get(k);
    };
    allRequests.forEach((r) => {
        (Array.isArray(r.answers) ? r.answers : []).forEach((a) => {
            if (!inR(a.at, R)) return;
            const st = get(a.logist_id, a.logist);
            st.answers++;
            const t = (new Date(a.at) - new Date(r.created_at)) / 60000;
            if (t >= 0) st.times.push(t);
        });
        if (inR(r.created_at, R)) {
            (r.logistician_ids || []).forEach((id) => get(id).assigned++);
            if (WORK_STATUSES.includes(r.status) && r.logistician_id) get(r.logistician_id, r.logistician).chosen++;
        }
    });
    money.logists.forEach((g) => get(g.key, g.label));
    const logists = [...lg.values()].map((x) => {
        const g = money.logists.find((m) => m.key === x.key) || { ...A.summarize([]), items: [] };
        return { ...g, ...x, kind: "logist", time: median(x.times) };
    }).filter((r) => r.answers || r.assigned || r.deals);
    return { sales, logists };
}

function sortRows(id, rows, get) {
    const [k, dir] = sortState[id];
    return [...rows].sort((a, b) => {
        const x = get(a, k), y = get(b, k);
        const bad = (v) => v == null || (typeof v === "number" && !isFinite(v));
        if (bad(x) && bad(y)) return 0;
        if (bad(x)) return 1;
        if (bad(y)) return -1;
        return (typeof x === "string" ? x.localeCompare(y, "uk") : x - y) * dir;
    });
}
function th(id, key, label, cls = "") {
    const [k, dir] = sortState[id];
    return `<th class="an-sort ${cls}" data-t="${id}" data-k="${key}">${label}${k === key ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`;
}
const cellBar = (v, max, color) => `<span class="cell-bar"><span style="width:${max ? Math.max(3, (Math.abs(v) / max) * 100) : 0}%; background:${v < 0 ? "#dc2626" : color}"></span></span>`;

function renderPeople() {
    const R = rangeOf(P);
    peopleResult = peopleRows(R, rangeOf(shiftP(P, -1)));
    const S = sortRows("salesTable", peopleResult.sales, (r, k) => (k === "label" ? r.label : r[k]));
    const maxP = Math.max(1, ...S.map((r) => Math.abs(r.profit)));
    $("salesTable").innerHTML = S.length
        ? `<thead><tr>${th("salesTable", "label", "Sales")}${th("salesTable", "requests", "Запитів", "num")}${th("salesTable", "conversion", "→ робота", "num")}${th("salesTable", "newLeads", "Нових лідів", "num")}${th("salesTable", "notes", "Записів", "num")}${th("salesTable", "deals", "Угод", "num")}${th("salesTable", "profit", "Профіт")}${th("salesTable", "margin", "Маржа", "num")}${th("salesTable", "receivable", "Дебіторка", "num")}</tr></thead>
           <tbody>${S.map((r) => `<tr class="an-row" data-person="sales" data-key="${esc(r.key)}">
                <td><b>${esc(r.label)}</b>${r.incomplete ? `<div class="an-mini an-warn">${r.incomplete} угод без курсу</div>` : ""}</td>
                <td class="num">${r.requests}</td>
                <td class="num"><span class="conv ${r.conversion >= 30 ? "conv-good" : r.conversion ? "conv-mid" : ""}">${r.conversion == null ? "—" : Math.round(r.conversion) + "%"}</span></td>
                <td class="num">${r.newLeads || "—"}</td>
                <td class="num" title="Записи в історії спілкування з клієнтами">${r.notes || "—"}</td>
                <td class="num">${r.deals || "—"}</td>
                <td><div class="cell-with-bar">${cellBar(r.profit, maxP, "var(--series-3)")}<span>${r.deals ? usd(r.profit) : "—"}</span></div>${r.deals ? `<div class="an-mini">${trend(r.profit, r.prevProfit, { percent: true })}</div>` : ""}</td>
                <td class="num"><span class="conv ${marginCls(r.margin)}">${pctf(r.margin)}</span></td>
                <td class="num ${r.overdue ? "an-warn" : ""}">${r.receivable ? usd(r.receivable) : "—"}</td>
            </tr>`).join("")}</tbody>`
        : `<tbody><tr><td class="rep-empty">За цей період даних немає</td></tr></tbody>`;

    const L = sortRows("logistTable", peopleResult.logists, (r, k) => (k === "label" ? r.label : r[k]));
    $("logistTable").innerHTML = L.length
        ? `<thead><tr>${th("logistTable", "label", "Логіст")}${th("logistTable", "assigned", "Надіслано", "num")}${th("logistTable", "answers", "Відповідей", "num")}${th("logistTable", "time", "Час відповіді", "num")}${th("logistTable", "chosen", "Обрали ціну", "num")}${th("logistTable", "deals", "Угод", "num")}${th("logistTable", "profit", "Профіт", "num")}${th("logistTable", "margin", "Маржа", "num")}${th("logistTable", "negative", "Мінусових", "num")}</tr></thead>
           <tbody>${L.map((r) => {
               const t = r.time;
               const tone = !isFinite(t) ? "" : t <= 60 ? "conv-good" : t <= 120 ? "conv-mid" : "conv-bad";
               return `<tr class="an-row" data-person="logist" data-key="${esc(r.key)}">
                <td><b>${esc(r.label)}</b></td><td class="num">${r.assigned || "—"}</td><td class="num">${r.answers || "—"}</td>
                <td class="num"><span class="conv ${tone}">${fmtDuration(t)}</span></td><td class="num">${r.chosen || "—"}</td>
                <td class="num">${r.deals || "—"}</td><td class="num">${r.deals ? usd(r.profit) : "—"}</td>
                <td class="num"><span class="conv ${marginCls(r.margin)}">${pctf(r.margin)}</span></td>
                <td class="num ${r.negative ? "an-warn" : ""}">${r.negative || "—"}</td></tr>`;
           }).join("")}</tbody>`
        : `<tbody><tr><td class="rep-empty">За цей період даних немає</td></tr></tbody>`;
}

function openPerson(kind, key) {
    const list = kind === "sales" ? peopleResult.sales : peopleResult.logists;
    const g = list.find((x) => x.key === key);
    if (!g) return;
    const own = allDeals.filter((d) => String(kind === "sales" ? d.sales_id || d.sales : d.logist_id || d.logist_name) === key);
    const months = A.monthly(own, basis(), {}, rangeOf(P).to, 12);
    const max = Math.max(1, ...months.map((m) => Math.abs(m.profit)));
    const parts = A.compute({ deals: g.items || [], requests: [], staff, from: "0000-01-01", to: "9999-12-31", basis: basis(), filters: {} });
    const li = (c) => `<div class="an-li"><span>${esc(c.label)}</span><b>${c.complete ? usd(c.profit) : "без курсу"}</b><span class="an-mini">${c.deals} уг.</span></div>`;
    $("anMgrTitle").textContent = `${g.label} — ${kind === "sales" ? "Sales" : "логіст"} · ${labelOf(P)}`;
    $("anMgrBody").innerHTML = `
        <div class="kpi-grid an-mgr-kpis">
            ${kind === "sales"
                ? kpiHtml("Запитів", g.requests, `<span class="kpi-trend">в роботу: ${g.conversion == null ? "—" : Math.round(g.conversion) + "%"}</span>`) + kpiHtml("Нових лідів", g.newLeads, `<span class="kpi-trend">записів у CRM: ${g.notes}</span>`)
                : kpiHtml("Відповідей", g.answers, `<span class="kpi-trend">надіслано: ${g.assigned}</span>`) + kpiHtml("Час відповіді", fmtDuration(g.time), `<span class="kpi-trend">обрали ціну: ${g.chosen}</span>`)}
            ${kpiHtml("Угод", g.deals || 0, g.incomplete ? `<span class="kpi-trend down">без курсу: ${g.incomplete}</span>` : "")}
            ${kpiHtml("Профіт", usd(g.profit), `<span class="kpi-trend">маржа ${pctf(g.margin)}</span>`)}
            ${kpiHtml("На угоду", usd(g.avgProfit))}
            ${kind === "sales" ? kpiHtml("Дебіторка", usd(g.receivable), `<span class="kpi-trend ${g.overdue ? "down" : ""}">прострочено: ${usd(g.overdue)}</span>`) : kpiHtml("Мінусових угод", g.negative || 0)}
        </div>
        <h3 class="an-h3">Профіт по місяцях (12 міс.)</h3>
        <div class="an-spark">${months.map((m) => `<div class="an-spark-col" data-tip="<b>${MONTHS[m.m]} ${m.y}</b><br>${esc(usd(m.profit))} · угод ${m.deals}"><span class="an-spark-bar ${m.profit < 0 ? "neg" : ""}" style="height:${Math.round((Math.abs(m.profit) / max) * 100)}%"></span><span class="an-spark-l">${MON[m.m]}</span></div>`).join("")}</div>
        <div class="rep-two">
            <div><h3 class="an-h3">Клієнти</h3>${parts.clients.slice(0, 8).map(li).join("") || `<p class="rep-empty">—</p>`}</div>
            <div><h3 class="an-h3">Напрямки</h3>${parts.routes.slice(0, 8).map(li).join("") || `<p class="rep-empty">—</p>`}</div>
        </div>
        <h3 class="an-h3">Угоди за період</h3>
        <div class="an-mgr-deals">${(g.items || [])
            .slice()
            .sort((a, b) => String(A.dealDate(b, basis())).localeCompare(String(A.dealDate(a, basis()))))
            .map((d) => `<a class="an-li" href="deals.html?open=${encodeURIComponent(d.id)}"><span>№ ${esc(d.number)} · ${dmy(A.dealDate(d, basis()))} · ${esc(d.client || "")}</span><b class="${d._m.profit < 0 ? "an-neg" : ""}">${d._m.complete ? usd(d._m.profit) : "без курсу"}</b><span class="an-mini">${esc(A.routeKey(d))}</span></a>`)
            .join("") || `<p class="rep-empty">Угод за період немає</p>`}</div>`;
    $("anMgrOverlay").classList.add("active");
}

/* ---------------- УГОДИ (керівник — усі, Sales — свої) ---------------- */

function dealFilters() {
    return { sales: isBoss ? $("fSales").value : "", logist: isBoss ? $("fLogist").value : "", kind: $("fKind").value, q: $("fQ").value.trim() };
}

function renderDeals() {
    const R = rangeOf(P);
    dealsResult = A.compute({ deals: allDeals, requests: [], staff, from: R.from, to: R.to, basis: basis(), filters: dealFilters() });
    const t = dealsResult.total, p = dealsResult.before;
    $("anScope").innerHTML =
        `${labelOf(P)} · за датою ${$("fBasis").selectedOptions[0].text}${isBoss ? "" : " · лише мої угоди"}` +
        (t.incomplete ? ` · <span class="an-warn" data-tip="У цих угодах не вказано ставку або курс — у суми не входять">без курсу / ставки: ${t.incomplete} угод</span>` : "");
    $("anKpis").innerHTML = [
        kpiHtml("Угод", t.deals, trend(t.deals, p.deals)),
        kpiHtml("Виручка", usd(t.income), trend(t.income, p.income, { percent: true })),
        kpiHtml("Валовий профіт", usd(t.profit), trend(t.profit, p.profit, { percent: true }), t.profit < 0 ? "an-bad" : ""),
        kpiHtml("Маржа", pctf(t.margin), trend(t.margin, p.margin, { suffix: " п.п." })),
        kpiHtml("Профіт на угоду", usd(t.avgProfit), trend(t.avgProfit, p.avgProfit, { percent: true })),
        kpiHtml("Факт профіту", usd(t.fact), `<span class="kpi-trend">клієнт оплатив і перевізнику оплачено</span>`),
        kpiHtml("Дебіторка", usd(t.receivable), `<span class="kpi-trend ${t.overdue ? "down" : ""}">прострочено &gt; 14 дн.: ${usd(t.overdue)}</span>`, t.overdue ? "an-bad" : ""),
        kpiHtml("Мінусових угод", t.negative, `<span class="kpi-trend">винні перевізникам: ${usd(t.payable)}</span>`, t.negative ? "an-bad" : ""),
    ].join("");
    renderTop($("anClients"), dealsResult.clients, "var(--series-1)");
    renderTop($("anRoutes"), dealsResult.routes, "var(--series-2)");
    shown = PAGE;
    renderDealTable();
}

function renderTop(el, list, color) {
    const rows = list.filter((x) => x.complete).slice(0, 10);
    const maxP = Math.max(1, ...rows.map((r) => Math.abs(r.profit)));
    el.innerHTML = rows.length
        ? rows.map((r) => `<div class="hbar an-hbar">
                <span class="hbar-label" title="${esc(r.label)}">${esc(r.label)}</span>
                <span class="hbar-track"><span class="hbar-fill" style="width:${Math.round((Math.abs(r.profit) / maxP) * 100)}%;background:${r.profit < 0 ? "#dc2626" : color}"></span></span>
                <span class="hbar-value">${usd(r.profit)}<span class="an-mini">${r.deals} уг. · ${pctf(r.margin)}</span></span>
            </div>`).join("")
        : `<p class="rep-empty">Немає даних</p>`;
}

function problemOf(d) {
    const m = d._m;
    const out = [];
    if (!m.complete) out.push("без курсу / ставки");
    else if (m.profit < 0) out.push("мінус");
    else if (m.income && (m.profit / m.income) * 100 < 5) out.push("маржа < 5%");
    if (d.unload_date && !d.paid_by_client && Date.now() - Date.parse(d.unload_date) > 14 * 864e5) out.push("клієнт не оплатив > 14 дн.");
    return out;
}

function renderDealTable() {
    const onlyProblem = $("fProblem").checked;
    const base = dealsResult.cur.map((d) => ({ d, date: A.dealDate(d, basis()), problems: problemOf(d) })).filter((x) => !onlyProblem || x.problems.length);
    const rows = sortRows("anDeals", base, (x, k) => {
        const m = x.d._m;
        if (k === "date") return x.date || "";
        if (k === "number") return Number(x.d.number) || 0;
        if (k === "client") return x.d.client || "";
        if (k === "sales") return nameOf(x.d.sales_id) || x.d.sales || "";
        if (k === "income") return m.complete ? m.income : null;
        if (k === "profit") return m.complete ? m.profit : null;
        if (k === "margin") return m.complete && m.income ? (m.profit / m.income) * 100 : null;
        return null;
    });
    $("anDealCount").textContent = rows.length;
    $("anDeals").innerHTML = rows.length
        ? `<thead><tr>${th("anDeals", "number", "№")}${th("anDeals", "date", "Дата")}${th("anDeals", "client", "Клієнт")}<th>Маршрут</th>${isBoss ? th("anDeals", "sales", "Sales") : ""}<th>Логіст / перевізник</th>${th("anDeals", "income", "Виручка", "num")}<th class="num">Витрати</th>${th("anDeals", "profit", "Профіт", "num")}${th("anDeals", "margin", "Маржа", "num")}<th>Оплати</th></tr></thead>
           <tbody>${rows.slice(0, shown).map(({ d, date, problems }) => {
               const m = d._m;
               const mg = m.complete && m.income ? (m.profit / m.income) * 100 : null;
               return `<tr class="${problems.length ? "an-problem" : ""}">
                    <td><a href="deals.html?open=${encodeURIComponent(d.id)}"><b>${esc(d.number ?? "—")}</b></a></td>
                    <td>${dmy(date)}</td>
                    <td>${esc(d.client || "—")}${problems.length ? `<div class="an-mini an-warn">${esc(problems.join(", "))}</div>` : ""}</td>
                    <td>${esc(A.routeKey(d) || "—")}</td>
                    ${isBoss ? `<td>${esc(nameOf(d.sales_id) || d.sales || "—")}</td>` : ""}
                    <td>${esc(nameOf(d.logist_id) || d.logist_name || "—")}<div class="an-mini">${esc(d.carrier_name || "")}</div></td>
                    <td class="num">${m.complete ? usd(m.income) : "—"}</td>
                    <td class="num">${m.complete ? usd(m.expense) : "—"}</td>
                    <td class="num ${m.complete && m.profit < 0 ? "an-neg" : ""}"><b>${m.complete ? usd(m.profit) : "—"}</b></td>
                    <td class="num"><span class="conv ${marginCls(mg)}">${pctf(mg)}</span></td>
                    <td class="an-pay"><span class="${d.paid_by_client ? "ok" : ""}" title="Оплата від клієнта">К ${d.paid_by_client ? "✓" : "·"}</span> <span class="${d.paid_to_carrier ? "ok" : ""}" title="Оплата перевізнику">П ${d.paid_to_carrier ? "✓" : "·"}</span></td>
                </tr>`;
           }).join("")}</tbody>`
        : `<tbody><tr><td class="rep-empty">${onlyProblem ? "Проблемних угод немає 🎉" : "Угод за період немає"}</td></tr></tbody>`;
    $("anMore").hidden = rows.length <= shown;
}

function exportCsv() {
    if (!dealsResult) return;
    const head = ["№", "Дата", "Клієнт", "Маршрут", "Sales", "Логіст", "Перевізник", "Виручка $", "Витрати $", "Профіт $", "Маржа %", "Оплата клієнта", "Оплата перевізнику", "Проблеми"];
    const lines = [head];
    for (const d of dealsResult.cur) {
        const m = d._m;
        lines.push([
            d.number, dmy(A.dealDate(d, basis())), d.client || "", A.routeKey(d), nameOf(d.sales_id) || d.sales || "", nameOf(d.logist_id) || d.logist_name || "", d.carrier_name || "",
            m.complete ? m.income.toFixed(2) : "", m.complete ? m.expense.toFixed(2) : "", m.complete ? m.profit.toFixed(2) : "",
            m.complete && m.income ? ((m.profit / m.income) * 100).toFixed(1) : "", d.paid_by_client ? "так" : "ні", d.paid_to_carrier ? "так" : "ні", problemOf(d).join("; "),
        ]);
    }
    const csv = "﻿" + lines.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const R = rangeOf(P);
    a.download = `fura-ugody-${R.from}_${R.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------------- АРХІВ ---------------- */

function renderArchive() {
    const keys = new Set([monthKey(new Date())]);
    allRequests.forEach((r) => keys.add(keyOf(r.created_at)));
    allLeads.forEach((l) => keys.add(keyOf(l.created_at)));
    if (seesMoney) allDeals.forEach((d) => keys.add(keyOf(A.dealDate(d, basis()))));
    const list = [...keys].filter(Boolean).sort().reverse().slice(0, 24);
    const rows = list.map((k) => {
        const [y, m] = k.split("-").map(Number);
        const R = rangeOf({ unit: "month", y, m: m - 1 });
        return { k, y, m: m - 1, ...summaryOf(R), money: seesMoney ? A.summarize(dealsIn(R)) : null };
    });
    const max = Math.max(...rows.map((x) => x.total), 0);
    const cur = P.unit === "month" ? `${P.y}-${pad2(P.m + 1)}` : "";
    $("archiveTable").innerHTML = `
        <thead><tr><th>Місяць</th><th>Запитів</th><th class="num">Відповіли</th><th class="num">В роботі / виконано</th><th class="num">Конверсія</th><th class="num">Нових лідів</th>${seesMoney ? `<th class="num">${isBoss ? "Угод" : "Моїх угод"}</th><th class="num">${isBoss ? "Профіт" : "Мій профіт"}</th><th class="num">Маржа</th>` : ""}<th></th></tr></thead>
        <tbody>${rows.map((x) => `<tr class="${x.k === cur ? "arch-current" : ""}">
            <td><b>${MONTHS[x.m]} ${x.y}</b></td>
            <td><div class="cell-with-bar"><span class="cell-bar"><span style="width:${max ? Math.max(3, (x.total / max) * 100) : 0}%; background:var(--series-1)"></span></span><span>${x.total}</span></div></td>
            <td class="num">${x.answeredPct}%</td><td class="num">${x.working}</td><td class="num">${x.conversion}%</td><td class="num">${x.leadsNew}</td>
            ${seesMoney ? `<td class="num">${x.money.deals || "—"}</td><td class="num ${x.money.profit < 0 ? "an-neg" : ""}">${x.money.deals ? usd(x.money.profit) : "—"}</td><td class="num"><span class="conv ${marginCls(x.money.margin)}">${pctf(x.money.margin)}</span></td>` : ""}
            <td class="num">${x.k === cur ? `<span class="arch-open">відкрито</span>` : `<button type="button" class="btn-more" data-month="${x.k}">Відкрити</button>`}</td>
        </tr>`).join("")}</tbody>`;
}

/* ---------------- Вкладки й відмальовка ---------------- */

function render() {
    $("monthTitle").textContent = labelOf(P);
    $("nextMonthBtn").disabled = rangeOf(shiftP(P, 1)).from > ymd(new Date());
    document.querySelectorAll("#periodUnit button").forEach((b) => b.classList.toggle("active", b.dataset.unit === P.unit));
    if (tab === "overview") renderOverview();
    else if (tab === "people") renderPeople();
    else if (tab === "deals") renderDeals();
    else renderArchive();
    try {
        localStorage.setItem("fura_rep", JSON.stringify({ tab, unit: P.unit, basis: basis(), chartMode }));
    } catch (_) {}
}

function setTab(t) {
    const btn = document.querySelector(`#repTabs [data-tab="${t}"]`);
    if (!btn || btn.hidden) t = "overview";
    tab = t;
    document.querySelectorAll("#repTabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
    render();
}

$("repTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) setTab(b.dataset.tab);
});
$("periodUnit").addEventListener("click", (e) => {
    const b = e.target.closest("[data-unit]");
    if (!b) return;
    const now = new Date();
    const keep = new Date(P.y, P.m, 1) <= now ? { y: P.y, m: P.m } : { y: now.getFullYear(), m: now.getMonth() };
    P = normP({ unit: b.dataset.unit, ...keep });
    render();
});
$("prevMonthBtn").addEventListener("click", () => {
    P = shiftP(P, -1);
    render();
});
$("nextMonthBtn").addEventListener("click", () => {
    P = shiftP(P, 1);
    render();
});
$("chartMode").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    chartMode = b.dataset.mode;
    document.querySelectorAll("#chartMode button").forEach((x) => x.classList.toggle("active", x === b));
    render();
});
$("archiveTable").addEventListener("click", (e) => {
    const b = e.target.closest("[data-month]");
    if (!b) return;
    const [y, m] = b.dataset.month.split("-").map(Number);
    P = { unit: "month", y, m: m - 1 };
    setTab("overview");
    $("reportsRoot").scrollTo({ top: 0, behavior: "smooth" });
});
["fBasis", "fSales", "fLogist", "fKind"].forEach((id) => $(id).addEventListener("change", render));
$("fQ").addEventListener("input", () => {
    clearTimeout(render.t);
    render.t = setTimeout(render, 300);
});
$("fProblem").addEventListener("change", () => {
    shown = PAGE;
    renderDealTable();
});
$("anMore").addEventListener("click", () => {
    shown += PAGE;
    renderDealTable();
});
$("anCsv").addEventListener("click", exportCsv);
document.addEventListener("click", (e) => {
    const h = e.target.closest(".an-sort");
    if (h) {
        const cur = sortState[h.dataset.t];
        sortState[h.dataset.t] = [h.dataset.k, cur[0] === h.dataset.k ? -cur[1] : -1];
        if (h.dataset.t === "anDeals") renderDealTable();
        else renderPeople();
        return;
    }
    const row = e.target.closest("[data-person]");
    if (row && !e.target.closest("a")) openPerson(row.dataset.person, row.dataset.key);
});
$("anMgrClose").addEventListener("click", () => $("anMgrOverlay").classList.remove("active"));
$("anMgrOverlay").addEventListener("click", (e) => e.target.id === "anMgrOverlay" && $("anMgrOverlay").classList.remove("active"));
document.addEventListener("keydown", (e) => e.key === "Escape" && $("anMgrOverlay").classList.remove("active"));

/* ---------------- Бічна панель і "Шлях" ---------------- */

function toggleSidebar() {
    document.body.classList.toggle("sidebar-collapsed");
    const icon = document.querySelector("#sidebarToggleBtn i");
    if (icon) {
        icon.classList.toggle("bx-chevron-left");
        icon.classList.toggle("bx-chevron-right");
    }
}

const SHLYAH_URL = "https://shlyah.dsbt.gov.ua/lc.html";
const shlyahModalOverlay = $("shlyahModalOverlay");
const shlyahIframe = $("shlyahIframe");
function openShlyahModal() {
    shlyahModalOverlay.classList.add("active");
    shlyahIframe.src = SHLYAH_URL;
}
function closeShlyahModal() {
    shlyahModalOverlay.classList.remove("active");
}
$("shlyahBackBtn").addEventListener("click", () => (shlyahIframe.src = SHLYAH_URL));
$("closeShlyahModalBtn").addEventListener("click", closeShlyahModal);
shlyahModalOverlay.addEventListener("click", (e) => {
    if (e.target === shlyahModalOverlay) closeShlyahModal();
});

/* ---------------- Дані ---------------- */

// Supabase віддає до 1000 рядків за раз — читаємо сторінками
async function fetchAll(table, columns) {
    const out = [];
    for (let from = 0; from < 100000; from += 1000) {
        const { data, error } = await sbClient.from(table).select(columns).range(from, from + 999);
        if (error) throw new Error(`${table}: ${error.message}`);
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
    }
    return out;
}

/* ---------------- Старт ---------------- */

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

    const { data: st } = await sbClient.from("staff").select("*");
    staff = st || [];
    const email = (session.user?.email || "").toLowerCase();
    me = staff.find((s) => (s.email || "").toLowerCase() === email) || null;
    const roles = rolesOf(me);
    isBoss = roles.some((r) => ["admin", "head"].includes(r));
    isSales = roles.includes("sales");
    seesMoney = isBoss || isSales;

    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem("fura_rep") || "{}") || {};
    } catch (_) {}
    const now = new Date();
    P = normP({ unit: ["month", "quarter", "year"].includes(saved.unit) ? saved.unit : "month", y: now.getFullYear(), m: now.getMonth() });
    if (saved.basis) $("fBasis").value = saved.basis;
    if (saved.chartMode) chartMode = saved.chartMode;
    document.querySelectorAll("#chartMode button").forEach((x) => x.classList.toggle("active", x.dataset.mode === chartMode));

    document.querySelectorAll(".boss-only").forEach((el) => (el.hidden = !isBoss));
    document.querySelectorAll(".money-only").forEach((el) => (el.hidden = !seesMoney));
    if (!isBoss) $("dealsTabLabel").textContent = "Мої угоди";
    $("repScope").innerHTML = isBoss
        ? `<i class='bx bx-show'></i> Ви бачите свою роботу і підсумки всієї команди, зокрема гроші`
        : seesMoney
          ? `<i class='bx bx-lock-alt'></i> Ви бачите свою роботу, своїх клієнтів і гроші лише своїх угод`
          : `<i class='bx bx-lock-alt'></i> Ви бачите тільки свою роботу і своїх клієнтів`;
    $("kpiGrid").innerHTML = `<div class="kpi"><span class="kpi-label">Завантаження…</span></div>`;

    try {
        const [reqs, leads, deals] = await Promise.all([
            fetchAll("requests", "id, created_at, answered_at, status, request_type, sales, sales_id, logistician, logistician_id, logistician_ids, answers"),
            fetchAll("leads", "id, created_at, status, sales, sales_id, history"),
            seesMoney ? fetchAll("deals", "*") : Promise.resolve([]),
        ]);
        allRequests = reqs;
        allLeads = leads;
        allDeals = deals.map((d) => ({ ...d, _m: A.dealMoney(d) }));
        // Sales бачить гроші лише своїх угод
        if (!isBoss) allDeals = allDeals.filter(isMyDeal);
    } catch (e) {
        $("repScope").innerHTML = `<span class="an-warn">Не вдалося завантажити дані: ${esc(e.message)}</span>`;
        return;
    }

    // Списки фільтрів «Угоди»
    const opts = (map) => [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "uk")).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
    const sales = new Map(), logists = new Map(), kinds = new Set();
    allDeals.forEach((d) => {
        if (d.sales_id || d.sales) sales.set(String(d.sales_id || d.sales), nameOf(d.sales_id) || d.sales || "—");
        if (d.logist_id || d.logist_name) logists.set(String(d.logist_id || d.logist_name), nameOf(d.logist_id) || d.logist_name || "—");
        kinds.add(d.deal_kind || "FTL");
    });
    $("fSales").innerHTML = `<option value="">Усі</option>${opts(sales)}`;
    $("fLogist").innerHTML = `<option value="">Усі</option>${opts(logists)}`;
    $("fKind").innerHTML = `<option value="">Усі</option>${[...kinds].sort().map((k) => `<option>${esc(k)}</option>`).join("")}`;

    setTab(location.hash === "#archive" ? "archive" : saved.tab || "overview");
});
