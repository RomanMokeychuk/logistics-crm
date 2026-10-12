/* ================================================================= *
 * FURA — ПІДСУМКИ (аналітика по місяцях)                             *
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
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

const MONTHS = [
    "Січень",
    "Лютий",
    "Березень",
    "Квітень",
    "Травень",
    "Червень",
    "Липень",
    "Серпень",
    "Вересень",
    "Жовтень",
    "Листопад",
    "Грудень",
];
const MONTHS_GEN = [
    "січня",
    "лютого",
    "березня",
    "квітня",
    "травня",
    "червня",
    "липня",
    "серпня",
    "вересня",
    "жовтня",
    "листопада",
    "грудня",
];
const REQUEST_STATUSES = [
    "Запит",
    "Відповідь",
    "В роботі",
    "Виконано",
    "Відмова",
];
const REQUEST_TYPES = ["Прорахунок", "Пошук авто", "Завантаження"];
const LEAD_STAGES = ["Новий", "Контакт", "Переговори", "Працюємо", "Відмова"];
const WORK_STATUSES = ["В роботі", "Виконано"];

let allRequests = [];
let allLeads = [];
let staff = [];
let me = null;
let isBoss = false;
let month = null; // { y, m } (m = 0..11)

/* ---------------- Дати ---------------- */

const monthKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const keyOf = (iso) => (iso ? monthKey(new Date(iso)) : "");
const curKey = () => `${month.y}-${String(month.m + 1).padStart(2, "0")}`;
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const monthLabel = (key) => {
    const [y, m] = key.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
};
const shiftKey = (key, delta) => {
    const [y, m] = key.split("-").map(Number);
    return monthKey(new Date(y, m - 1 + delta, 1));
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

/* ---------------- Підказка при наведенні ---------------- */

const tip = document.getElementById("repTip");
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

// Горизонтальні смуги: [{ label, value, sub }]
function hbars(
    el,
    rows,
    { color = "var(--series-1)", unit = "", empty = "Даних немає" } = {},
) {
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

// Стовпчики по днях місяця
function dayColumns(el, counts, y, m, what = "Запитів") {
    const max = Math.max(...counts, 0);
    const today = new Date();
    const weekend = (d) => [0, 6].includes(new Date(y, m, d).getDay());
    const ticks = [0, Math.ceil(max / 2), max].filter(
        (v, i, a) => a.indexOf(v) === i,
    );
    el.innerHTML = `
        <div class="dc-plot">
            <div class="dc-grid">${ticks
                .map(
                    (t) =>
                        `<div class="dc-gridline" style="bottom:${max ? (t / max) * 100 : 0}%"><span>${t}</span></div>`,
                )
                .join("")}</div>
            <div class="dc-cols">${counts
                .map((c, i) => {
                    const d = i + 1;
                    const isToday =
                        today.getFullYear() === y &&
                        today.getMonth() === m &&
                        today.getDate() === d;
                    const date = `${String(d).padStart(2, "0")}.${String(m + 1).padStart(2, "0")}`;
                    return `<div class="dc-col ${weekend(d) ? "dc-weekend" : ""} ${isToday ? "dc-today" : ""}" data-tip="<b>${date}</b><br>${what}: ${c}">
                        <div class="dc-bar" style="height:${max ? (c / max) * 100 : 0}%"></div>
                    </div>`;
                })
                .join("")}</div>
        </div>
        <div class="dc-axis">${counts
            .map(
                (_, i) =>
                    `<span>${(i + 1) % 5 === 0 || i === 0 ? i + 1 : ""}</span>`,
            )
            .join("")}</div>`;
}

/* ---------------- Розрахунки ---------------- */

const reqOfMonth = (key) =>
    allRequests.filter((r) => keyOf(r.created_at) === key);
const responseMin = (r) =>
    r.answered_at
        ? (new Date(r.answered_at) - new Date(r.created_at)) / 60000
        : NaN;

function monthSummary(key) {
    const reqs = reqOfMonth(key);
    const answered = reqs.filter((r) => r.answered_at);
    const working = reqs.filter((r) => WORK_STATUSES.includes(r.status));
    const leadsNew = allLeads.filter((l) => keyOf(l.created_at) === key);
    return {
        reqs,
        total: reqs.length,
        answeredPct: pct(answered.length, reqs.length),
        responseMedian: median(answered.map(responseMin).filter((x) => x >= 0)),
        working: working.length,
        conversion: pct(working.length, reqs.length),
        leadsNew: leadsNew.length,
    };
}

function trend(cur, prev, { invert = false, suffix = "" } = {}) {
    if (
        prev === null ||
        prev === undefined ||
        !isFinite(prev) ||
        !isFinite(cur)
    )
        return "";
    const diff = Math.round(cur - prev);
    if (!diff) return `<span class="kpi-trend">як минулого місяця</span>`;
    const good = invert ? diff < 0 : diff > 0;
    return `<span class="kpi-trend ${good ? "up" : "down"}">${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)}${suffix} до мин. місяця</span>`;
}

/* ---------------- Відмальовка ---------------- */

function render() {
    const key = curKey();
    const prevKey = shiftKey(key, -1);
    document.getElementById("monthTitle").textContent = monthLabel(key);
    const nowKey = monthKey(new Date());
    document.getElementById("nextMonthBtn").disabled = key >= nowKey;

    const s = monthSummary(key);
    const p = monthSummary(prevKey);

    // 1. Головні цифри
    document.getElementById("kpiGrid").innerHTML = `
        <div class="kpi"><span class="kpi-label">Запитів створено</span><span class="kpi-value">${s.total}</span>${trend(s.total, p.total)}</div>
        <div class="kpi"><span class="kpi-label">Логісти відповіли</span><span class="kpi-value">${s.answeredPct}%</span>${trend(s.answeredPct, p.total ? p.answeredPct : null, { suffix: "%" })}</div>
        <div class="kpi"><span class="kpi-label">Середній час відповіді</span><span class="kpi-value">${fmtDuration(s.responseMedian)}</span>${trend(s.responseMedian, p.responseMedian, { invert: true, suffix: " хв" })}</div>
        <div class="kpi"><span class="kpi-label">В роботі / виконано</span><span class="kpi-value">${s.working}</span><span class="kpi-trend">конверсія ${s.conversion}%</span></div>
        <div class="kpi"><span class="kpi-label">Нових лідів</span><span class="kpi-value">${s.leadsNew}</span>${trend(s.leadsNew, p.leadsNew)}</div>
        <div class="kpi"><span class="kpi-label">Працюємо з клієнтами</span><span class="kpi-value">${allLeads.filter((l) => l.status === "Працюємо").length}</span><span class="kpi-trend">усього лідів: ${allLeads.length}</span></div>`;

    // 2. По днях
    const days = daysInMonth(month.y, month.m);
    const counts = Array(days).fill(0);
    s.reqs.forEach((r) => counts[new Date(r.created_at).getDate() - 1]++);
    dayColumns(document.getElementById("dayChart"), counts, month.y, month.m);
    const busiest = counts.indexOf(Math.max(...counts));
    document.getElementById("daysSub").textContent = s.total
        ? `найбільше ${busiest + 1} ${MONTHS_GEN[month.m]}: ${counts[busiest]}`
        : "";

    // 3. Статуси і типи
    hbars(
        document.getElementById("statusChart"),
        REQUEST_STATUSES.map((st) => ({
            label: st,
            value: s.reqs.filter((r) => r.status === st).length,
        })),
    );
    hbars(
        document.getElementById("typeChart"),
        REQUEST_TYPES.map((t) => ({
            label: t,
            value: s.reqs.filter((r) => r.request_type === t).length,
        })),
        { color: "var(--series-2)" },
    );

    // 4. Ліди
    hbars(
        document.getElementById("leadStageChart"),
        LEAD_STAGES.map((st) => ({
            label: st,
            value: allLeads.filter(
                (l) =>
                    l.status === st &&
                    (isBoss || String(l.sales_id) === String(me?.id)),
            ).length,
        })),
        { color: "var(--series-3)" },
    );
    const bySales = new Map();
    allLeads
        .filter((l) => keyOf(l.created_at) === key)
        .forEach((l) => {
            const name = l.sales || "Без Sales";
            bySales.set(name, (bySales.get(name) || 0) + 1);
        });
    hbars(
        document.getElementById("newLeadsChart"),
        [...bySales.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([label, value]) => ({ label, value })),
        { color: "var(--series-3)", empty: "Цього місяця нових лідів немає" },
    );

    renderMine(key);
    if (isBoss) {
        renderSales(key);
        renderLogists(key);
    }
    renderArchive();
}

/* ---------------- МОЯ РОБОТА (кожен бачить себе) ---------------- */

function myStats(key) {
    const myId = String(me?.id || "");
    const myName = me?.full_name || "";
    const reqs = reqOfMonth(key);

    // Як Sales
    const mineSales = reqs.filter(
        (r) =>
            String(r.sales_id) === myId || (!r.sales_id && r.sales === myName),
    );
    const work = mineSales.filter((r) =>
        WORK_STATUSES.includes(r.status),
    ).length;
    const myLeads = allLeads.filter((l) => String(l.sales_id) === myId);
    const newLeads = myLeads.filter((l) => keyOf(l.created_at) === key).length;
    let notes = 0;
    allLeads.forEach((l) =>
        (l.history || []).forEach((h) => {
            if (!h.auto && h.author === myName && keyOf(h.at) === key) notes++;
        }),
    );

    // Як логіст
    let answers = 0;
    const times = [];
    let assigned = 0;
    let chosen = 0;
    allRequests.forEach((r) => {
        (r.answers || []).forEach((a) => {
            if (String(a.logist_id) !== myId || keyOf(a.at) !== key) return;
            answers++;
            const t = (new Date(a.at) - new Date(r.created_at)) / 60000;
            if (t >= 0) times.push(t);
        });
        if (keyOf(r.created_at) === key) {
            if ((r.logistician_ids || []).map(String).includes(myId))
                assigned++;
            if (
                WORK_STATUSES.includes(r.status) &&
                String(r.logistician_id) === myId
            )
                chosen++;
        }
    });
    const waiting = allRequests.filter(
        (r) =>
            ["Запит", "Відповідь"].includes(r.status) &&
            (r.logistician_ids || []).map(String).includes(myId) &&
            !(r.answers || []).some((a) => String(a.logist_id) === myId),
    ).length;

    return {
        sales: {
            total: mineSales.length,
            work,
            conv: pct(work, mineSales.length),
            refused: mineSales.filter((r) => r.status === "Відмова").length,
            newLeads,
            notes,
            clients: myLeads.filter((l) => l.status === "Працюємо").length,
            leads: myLeads.length,
        },
        logist: {
            answers,
            time: median(times),
            assigned,
            chosen,
            waiting,
            answerRate: pct(answers, assigned),
        },
        days: (() => {
            const days = daysInMonth(month.y, month.m);
            const c = Array(days).fill(0);
            mineSales.forEach((r) => c[new Date(r.created_at).getDate() - 1]++);
            allRequests.forEach((r) =>
                (r.answers || []).forEach((a) => {
                    if (String(a.logist_id) === myId && keyOf(a.at) === key)
                        c[new Date(a.at).getDate() - 1]++;
                }),
            );
            return c;
        })(),
    };
}

const kpiHtml = (label, value, extra = "") =>
    `<div class="kpi"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span>${extra}</div>`;

function renderMine(key) {
    const roles = rolesOf(me);
    const asSales = roles.some((r) => ["sales", "head"].includes(r));
    const asLogist = roles.includes("logist");
    const card = document.getElementById("myCard");
    if (!me || (!asSales && !asLogist)) {
        card.hidden = true;
        return;
    }
    card.hidden = false;
    document.getElementById("myTitle").textContent =
        `Моя робота — ${me.full_name}`;
    document.getElementById("mySub").textContent = monthLabel(key);

    const cur = myStats(key);
    const prev = myStats(shiftKey(key, -1));
    let html = "";

    if (asSales) {
        html += `<div class="my-role"><i class='bx bx-briefcase'></i> Як Sales</div>
        <div class="kpi-grid">
            ${kpiHtml("Моїх запитів", cur.sales.total, trend(cur.sales.total, prev.sales.total))}
            ${kpiHtml("В роботі / виконано", cur.sales.work, `<span class="kpi-trend">конверсія ${cur.sales.conv}%</span>`)}
            ${kpiHtml("Відмов", cur.sales.refused)}
            ${kpiHtml("Нових клієнтів", cur.sales.newLeads, trend(cur.sales.newLeads, prev.sales.newLeads))}
            ${kpiHtml("Записів про спілкування", cur.sales.notes, trend(cur.sales.notes, prev.sales.notes))}
            ${kpiHtml("Працюємо з клієнтами", cur.sales.clients, `<span class="kpi-trend">моїх лідів: ${cur.sales.leads}</span>`)}
        </div>`;
    }
    if (asLogist) {
        const t = cur.logist.time;
        const tone = !isFinite(t)
            ? ""
            : t <= 60
              ? "up"
              : t <= 120
                ? ""
                : "down";
        html += `<div class="my-role"><i class='bx bx-car'></i> Як логіст</div>
        <div class="kpi-grid">
            ${kpiHtml("Моїх відповідей", cur.logist.answers, trend(cur.logist.answers, prev.logist.answers))}
            ${kpiHtml("Надіслано мені", cur.logist.assigned, `<span class="kpi-trend">відповів на ${cur.logist.answerRate}%</span>`)}
            ${kpiHtml("Мій час відповіді", fmtDuration(t), `<span class="kpi-trend ${tone}">${!isFinite(t) ? "" : t <= 60 ? "швидко 👍" : t <= 120 ? "в межах 2 год" : "довше 2 год"}</span>`)}
            ${kpiHtml("Обрали мою ціну", cur.logist.chosen, trend(cur.logist.chosen, prev.logist.chosen))}
            ${kpiHtml("Чекають моєї відповіді", cur.logist.waiting, cur.logist.waiting ? `<span class="kpi-trend down">зараз</span>` : `<span class="kpi-trend up">усе відповів</span>`)}
        </div>`;
    }
    html += `<div class="my-role"><i class='bx bx-calendar'></i> Моя активність по днях <span class="rep-sub">запити як Sales + відповіді як логіст</span></div>
        <div class="daychart" id="myDayChart"></div>`;
    document.getElementById("myBody").innerHTML = html;
    dayColumns(
        document.getElementById("myDayChart"),
        cur.days,
        month.y,
        month.m,
        "Дій",
    );
}

// Хто в мене "Sales" і "логіст"
const nameOf = (id) =>
    staff.find((s) => String(s.id) === String(id))?.full_name || null;
const rolesOf = (s) =>
    Array.isArray(s?.roles) && s.roles.length
        ? s.roles
        : s?.role
          ? [s.role]
          : [];

// Активність: записи в історії лідів (не автоматичні) за місяць по авторах
function activityByAuthor(key) {
    const m = new Map();
    allLeads.forEach((l) =>
        (Array.isArray(l.history) ? l.history : []).forEach((h) => {
            if (h.auto || keyOf(h.at) !== key || !h.author) return;
            m.set(h.author, (m.get(h.author) || 0) + 1);
        }),
    );
    return m;
}

function bar(value, max, color) {
    return `<span class="cell-bar"><span style="width:${max ? Math.max(3, (value / max) * 100) : 0}%; background:${color}"></span></span>`;
}

function renderSales(key) {
    const reqs = reqOfMonth(key);
    const activity = activityByAuthor(key);
    const names = new Set();
    staff
        .filter(
            (s) =>
                s.active &&
                rolesOf(s).some((r) => ["sales", "head"].includes(r)),
        )
        .forEach((s) => names.add(s.full_name));
    reqs.forEach((r) => r.sales && names.add(r.sales));

    const rows = [...names]
        .map((name) => {
            const mine = reqs.filter((r) => r.sales === name);
            const work = mine.filter((r) =>
                WORK_STATUSES.includes(r.status),
            ).length;
            const refused = mine.filter((r) => r.status === "Відмова").length;
            const newLeads = allLeads.filter(
                (l) => l.sales === name && keyOf(l.created_at) === key,
            ).length;
            return {
                name,
                total: mine.length,
                work,
                refused,
                conv: pct(work, mine.length),
                newLeads,
                activity: activity.get(name) || 0,
            };
        })
        .filter((r) => r.total || r.newLeads || r.activity)
        .sort((a, b) => b.total - a.total);

    const max = Math.max(...rows.map((r) => r.total), 0);
    document.getElementById("salesTable").innerHTML = rows.length
        ? `<thead><tr><th>Sales</th><th>Запитів</th><th class="num">В роботі / виконано</th><th class="num">Відмова</th><th class="num">Конверсія</th><th class="num">Нових лідів</th><th class="num">Записів у CRM</th></tr></thead>
           <tbody>${rows
               .map(
                   (r) => `<tr>
                <td><b>${escapeHtml(r.name)}</b></td>
                <td><div class="cell-with-bar">${bar(r.total, max, "var(--series-1)")}<span>${r.total}</span></div></td>
                <td class="num">${r.work}</td>
                <td class="num">${r.refused}</td>
                <td class="num"><span class="conv ${r.conv >= 30 ? "conv-good" : r.conv ? "conv-mid" : ""}">${r.conv}%</span></td>
                <td class="num">${r.newLeads}</td>
                <td class="num" title="Записи в історії спілкування з клієнтами">${r.activity}</td>
            </tr>`,
               )
               .join("")}</tbody>`
        : `<tbody><tr><td class="rep-empty">За цей місяць даних немає</td></tr></tbody>`;
}

function renderLogists(key) {
    // Відповіді логістів за місяць (за датою відповіді)
    const stats = new Map();
    const get = (id, name) => {
        const k = String(id || name);
        if (!stats.has(k))
            stats.set(k, {
                name: name || nameOf(id) || "—",
                answers: 0,
                times: [],
                chosen: 0,
                assigned: 0,
            });
        return stats.get(k);
    };
    allRequests.forEach((r) => {
        (Array.isArray(r.answers) ? r.answers : []).forEach((a) => {
            if (keyOf(a.at) !== key) return;
            const st = get(a.logist_id, a.logist);
            st.answers++;
            const t = (new Date(a.at) - new Date(r.created_at)) / 60000;
            if (t >= 0) st.times.push(t);
        });
        if (keyOf(r.created_at) === key) {
            (r.logistician_ids || []).forEach((id) => get(id).assigned++);
            if (WORK_STATUSES.includes(r.status) && r.logistician_id)
                get(r.logistician_id, r.logistician).chosen++;
        }
    });

    const rows = [...stats.values()]
        .filter((r) => r.answers || r.assigned || r.chosen)
        .sort((a, b) => b.answers - a.answers);
    const max = Math.max(...rows.map((r) => r.answers), 0);
    document.getElementById("logistTable").innerHTML = rows.length
        ? `<thead><tr><th>Логіст</th><th>Відповідей</th><th class="num">Надіслано запитів</th><th class="num">Середній час відповіді</th><th class="num">Обрали його ціну</th></tr></thead>
           <tbody>${rows
               .map((r) => {
                   const t = median(r.times);
                   const tone = !isFinite(t)
                       ? ""
                       : t <= 60
                         ? "conv-good"
                         : t <= 120
                           ? "conv-mid"
                           : "conv-bad";
                   return `<tr>
                <td><b>${escapeHtml(r.name)}</b></td>
                <td><div class="cell-with-bar">${bar(r.answers, max, "var(--series-2)")}<span>${r.answers}</span></div></td>
                <td class="num">${r.assigned}</td>
                <td class="num"><span class="conv ${tone}">${fmtDuration(t)}</span></td>
                <td class="num">${r.chosen}</td>
            </tr>`;
               })
               .join("")}</tbody>`
        : `<tbody><tr><td class="rep-empty">За цей місяць відповідей немає</td></tr></tbody>`;
}

function renderArchive() {
    const keys = new Set([monthKey(new Date())]);
    allRequests.forEach((r) => keys.add(keyOf(r.created_at)));
    allLeads.forEach((l) => keys.add(keyOf(l.created_at)));
    const list = [...keys].filter(Boolean).sort().reverse().slice(0, 24);
    const sums = list.map((k) => ({ k, ...monthSummary(k) }));
    const max = Math.max(...sums.map((x) => x.total), 0);

    document.getElementById("archiveTable").innerHTML = `
        <thead><tr><th>Місяць</th><th>Запитів</th><th class="num">Відповіли</th><th class="num">В роботі / виконано</th><th class="num">Конверсія</th><th class="num">Нових лідів</th><th></th></tr></thead>
        <tbody>${sums
            .map(
                (x) => `<tr class="${x.k === curKey() ? "arch-current" : ""}">
            <td><b>${monthLabel(x.k)}</b></td>
            <td><div class="cell-with-bar">${bar(x.total, max, "var(--series-1)")}<span>${x.total}</span></div></td>
            <td class="num">${x.answeredPct}%</td>
            <td class="num">${x.working}</td>
            <td class="num">${x.conversion}%</td>
            <td class="num">${x.leadsNew}</td>
            <td class="num">${x.k === curKey() ? `<span class="arch-open">відкрито</span>` : `<button type="button" class="btn-more" data-month="${x.k}">Докладніше</button>`}</td>
        </tr>`,
            )
            .join("")}</tbody>`;
}

document.getElementById("archiveTable").addEventListener("click", (e) => {
    const b = e.target.closest("[data-month]");
    if (!b) return;
    const [y, m] = b.dataset.month.split("-").map(Number);
    month = { y, m: m - 1 };
    render();
    document
        .getElementById("reportsRoot")
        .scrollTo({ top: 0, behavior: "smooth" });
});

document.getElementById("prevMonthBtn").addEventListener("click", () => {
    const d = new Date(month.y, month.m - 1, 1);
    month = { y: d.getFullYear(), m: d.getMonth() };
    render();
});
document.getElementById("nextMonthBtn").addEventListener("click", () => {
    const d = new Date(month.y, month.m + 1, 1);
    month = { y: d.getFullYear(), m: d.getMonth() };
    render();
});

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
const shlyahModalOverlay = document.getElementById("shlyahModalOverlay");
const shlyahIframe = document.getElementById("shlyahIframe");
function openShlyahModal() {
    shlyahModalOverlay.classList.add("active");
    shlyahIframe.src = SHLYAH_URL;
}
function closeShlyahModal() {
    shlyahModalOverlay.classList.remove("active");
}
document
    .getElementById("shlyahBackBtn")
    .addEventListener("click", () => (shlyahIframe.src = SHLYAH_URL));
document
    .getElementById("closeShlyahModalBtn")
    .addEventListener("click", closeShlyahModal);
shlyahModalOverlay.addEventListener("click", (e) => {
    if (e.target === shlyahModalOverlay) closeShlyahModal();
});

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

    const now = new Date();
    month = { y: now.getFullYear(), m: now.getMonth() };

    const [r1, r2, r3] = await Promise.all([
        sbClient
            .from("requests")
            .select(
                "id, created_at, answered_at, status, request_type, sales, sales_id, logistician, logistician_id, logistician_ids, answers",
            ),
        sbClient
            .from("leads")
            .select("id, created_at, status, sales, sales_id, history"),
        sbClient.from("staff").select("*"),
    ]);
    allRequests = r1.data || [];
    allLeads = r2.data || [];
    staff = r3.data || [];

    const email = (session.user?.email || "").toLowerCase();
    me = staff.find((s) => (s.email || "").toLowerCase() === email) || null;
    isBoss = rolesOf(me).some((r) => ["admin", "head"].includes(r));
    document.getElementById("repScope").innerHTML = isBoss
        ? `<i class='bx bx-show'></i> Ви бачите свою роботу і підсумки всієї команди`
        : `<i class='bx bx-lock-alt'></i> Ви бачите тільки свою роботу і своїх клієнтів`;
    document
        .querySelectorAll(".team-only")
        .forEach((el) => (el.hidden = !isBoss));

    render();
    if (location.hash === "#archive") {
        setTimeout(
            () =>
                document
                    .getElementById("archive")
                    .scrollIntoView({ behavior: "smooth" }),
            100,
        );
    }
});
