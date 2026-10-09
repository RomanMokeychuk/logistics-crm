/* ================================================================= *
 * 1. ІНІЦІАЛІЗАЦІЯ SUPABASE                                          *
 * ================================================================= */

const SUPABASE_URL = "https://prbfscwmemshwigiftha.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function logout() {
    await sbClient.auth.signOut();
    window.location.href = "login.html";
}

/* ================================================================= *
 * 2. ДОВІДНИКИ                                                       *
 * ================================================================= */

// Порядок у списку = порядок сортування за статусом
const REQUEST_STATUSES = [
    { value: "Запит", cls: "status-request" }, // новий, чекає логіста
    { value: "Відповідь", cls: "status-offer" }, // логіст дав ціни
    { value: "В роботі", cls: "status-progress" }, // Sales обрав логіста
    { value: "Виконано", cls: "status-confirmed" },
    { value: "Відмова", cls: "status-rejected" },
];
const STATUS_NEW = "Запит";
const STATUS_QUOTE = "Відповідь";
const STATUS_CHOSEN = "В роботі";

// Тип запиту — обирає Sales
const REQUEST_TYPES = [
    { value: "Прорахунок", cls: "type-calc", icon: "bx-calculator" },
    { value: "Пошук авто", cls: "type-search", icon: "bx-search-alt" },
    { value: "Завантаження", cls: "type-load", icon: "bx-package" },
];

function typeBadge(type) {
    if (!type) return "—";
    const t = REQUEST_TYPES.find((x) => x.value === type);
    return `<span class="type-badge ${t ? t.cls : ""}">${escapeHtml(type)}</span>`;
}

function typeOrder(type) {
    const i = REQUEST_TYPES.findIndex((x) => x.value === type);
    return i === -1 ? REQUEST_TYPES.length : i;
}

// Ті самі країни, що й у перевізниках, + Україна
const REQUEST_COUNTRIES = [
    "УКРАЇНА",
    "ПОЛЬША",
    "НІМЕЧЧИНА",
    "ЛИТВА",
    "ЛАТВІЯ",
    "ІСПАНІЯ",
    "ІТАЛІЯ",
    "РУМУНІЯ",
    "ЧЕХІЯ",
    "АВСТРІЯ",
    "АЗЕРБАЙДЖАН",
    "ВІРМЕНІЯ",
    "БЕЛЬГІЯ",
    "БОЛГАРІЯ",
    "ВЕЛИКОБРИТАНІЯ",
    "УГОРЩИНА",
    "ФРАНЦІЯ",
    "ДАНІЯ",
    "МОЛДОВА",
    "НІДЕРЛАНДИ",
    "СЛОВАЧЧИНА",
    "СЛОВЕНІЯ",
    "ТУРЕЧЧИНА",
    "ГРУЗІЯ",
    "ФІНЛЯНДІЯ",
    "ЕСТОНІЯ",
];

// Підказки для "Тип транспорту" (можна ввести і своє)
const TRANSPORT_TYPES = [
    "ТЕНТ",
    "РЕФ",
    "ІЗОТЕРМ",
    "ЦІЛЬНОМЕТ",
    "КОНТЕЙНЕРОВОЗ",
    "МЕГА",
    "СЦЕПКА",
    "БУС",
];

// Підказки для "Погран перехід" (можна ввести і свій)
const BORDER_CROSSINGS = [
    "Ягодин – Дорогуськ (PL)",
    "Устилуг – Зосін (PL)",
    "Рава-Руська – Гребенне (PL)",
    "Краковець – Корчова (PL)",
    "Шегині – Медика (PL)",
    "Угринів – Долгобичув (PL)",
    "Ужгород – Вишнє Нємецьке (SK)",
    "Малий Березний – Убля (SK)",
    "Тиса – Захонь (HU)",
    "Лужанка – Берегшурань (HU)",
    "Дякове – Халмеу (RO)",
    "Порубне – Сірет (RO)",
    "Дяківці – Раковець (MD)",
    "Могилів-Подільський – Отач (MD)",
    "Паланка – Маяки-Удобне (MD)",
    "Рені – Джурджулешти (MD)",
];

/* ================================================================= *
 * 3. СТАН СТОРІНКИ ТА ЕЛЕМЕНТИ                                       *
 * ================================================================= */

let requestsCache = [];
let sortColumn = "created_at";
let sortAscending = false; // нові запити зверху

const tableBody = document.getElementById("requestsTableBody");
const searchInput = document.getElementById("requestsSearch");
const modalOverlay = document.getElementById("requestModalOverlay");
const requestForm = document.getElementById("requestForm");

const dateFromInput = document.getElementById("req_desired_date");
const dateToInput = document.getElementById("req_desired_date_to");
const dateRangeCheckbox = document.getElementById("req_date_range");
const dateRangeDash = document.getElementById("dateRangeDash");

/* ================================================================= *
 * 4. ДОПОМІЖНІ ФУНКЦІЇ                                               *
 * ================================================================= */

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// "2026-10-12" → "12.10.2026" (без new Date, щоб не з'їжджав день через часовий пояс)
function formatDateOnly(value) {
    if (!value) return "";
    const [y, m, d] = String(value).slice(0, 10).split("-");
    if (!y || !m || !d) return "";
    return `${d}.${m}.${y}`;
}

// Одна дата або період:
// 14.10.2026 | 14–19.10.2026 | 28.10–02.11.2026 | 28.12.2026 – 03.01.2027
function formatDesiredDate(from, to) {
    const f = formatDateOnly(from);
    if (!f) return "";
    const t = formatDateOnly(to);
    if (!t || t === f) return f;

    const [fd, fm, fy] = f.split(".");
    const [td, tm, ty] = t.split(".");
    if (fy === ty && fm === tm) return `${fd}–${td}.${tm}.${ty}`;
    if (fy === ty) return `${fd}.${fm}–${td}.${tm}.${ty}`;
    return `${f} – ${t}`;
}

// ISO-дата створення → "09.10.2026"
function formatCreatedAt(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("uk-UA", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
}

// Тільки плашка країни — для таблиці
function countryBadge(country) {
    return country
        ? `<span class="badge-country">${escapeHtml(country)}</span>`
        : "—";
}

// Країна + під нею місто/адреса — для картки запиту
function locationCell(country, address) {
    if (!country && !address) return "";
    const badge = country
        ? `<span class="badge-country">${escapeHtml(country)}</span>`
        : "";
    const addr = address
        ? `<div class="location-address">${escapeHtml(address)}</div>`
        : "";
    return badge + addr;
}

function statusBadge(status) {
    if (!status) return "—";
    const found = REQUEST_STATUSES.find((s) => s.value === status);
    const cls = found ? found.cls : "status-request";
    return `<span class="status-badge ${cls}">${escapeHtml(status)}</span>`;
}

function statusOrder(status) {
    const idx = REQUEST_STATUSES.findIndex((s) => s.value === status);
    return idx === -1 ? REQUEST_STATUSES.length : idx;
}

/* ================================================================= *
 * 4.1 "СВІТЛОФОР": НОВИЙ / ВІДПОВІВ / ПРОСТРОЧЕНО                    *
 * ================================================================= */

// Скільки хвилин логіст має на відповідь, після цього рядок червоний
const RESPONSE_LIMIT_MIN = 120;

// ISO-дата → "09.10.2026, 17:15"
function formatDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("uk-UA", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

// Хвилини між двома датами (друга — за замовчуванням "зараз")
function minutesBetween(fromIso, toIso) {
    const from = new Date(fromIso).getTime();
    const to = toIso ? new Date(toIso).getTime() : Date.now();
    if (isNaN(from) || isNaN(to)) return 0;
    return Math.max(0, Math.floor((to - from) / 60000));
}

// 35 → "35 хв", 75 → "1 год 15 хв", 1600 → "1 дн 2 год"
function formatDuration(min) {
    if (min < 60) return `${min} хв`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h < 24) return m ? `${h} год ${m} хв` : `${h} год`;
    const d = Math.floor(h / 24);
    const hh = h % 24;
    return hh ? `${d} дн ${hh} год` : `${d} дн`;
}

// Логіст відповів = статус змінено з "Запит" на будь-який інший
function requestState(r) {
    if (r.status && r.status !== REQUEST_STATUSES[0].value) return "answered";
    return minutesBetween(r.created_at) >= RESPONSE_LIMIT_MIN
        ? "overdue"
        : "new";
}

// Рядок під датою: таймер очікування або за скільки відповіли
function timerHtml(r, state) {
    if (state === "answered") {
        const text = r.answered_at
            ? `відповідь за ${formatDuration(minutesBetween(r.created_at, r.answered_at))}`
            : "відповідь надана";
        return `<div class="req-timer req-timer-answered"><i class='bx bx-check-circle'></i> ${text}</div>`;
    }
    const waited = formatDuration(minutesBetween(r.created_at));
    if (state === "overdue") {
        return `<div class="req-timer req-timer-overdue"><i class='bx bx-error-circle'></i> ${waited} без відповіді</div>`;
    }
    return `<div class="req-timer req-timer-new"><i class='bx bx-time-five'></i> чекає ${waited}</div>`;
}

/* ================================================================= *
 * 4.2 СПІВРОБІТНИКИ: вибір Sales / Logistician зі списку             *
 * ================================================================= */

let staffCache = [];
let currentStaff = null; // співробітник, який зараз увійшов (за поштою)
const LEGACY_OPTION = "__legacy__"; // старі запити, де ім'я вписане вручну

async function loadStaff(session) {
    const { data, error } = await sbClient
        .from("staff")
        .select("*")
        .order("full_name", { ascending: true });

    if (error) {
        console.error("Помилка завантаження співробітників:", error);
        staffCache = [];
        return;
    }
    staffCache = data || [];

    const myEmail = (session?.user?.email || "").toLowerCase();
    currentStaff =
        staffCache.find((s) => (s.email || "").toLowerCase() === myEmail) ||
        null;
}

function staffById(id) {
    return staffCache.find((s) => String(s.id) === String(id)) || null;
}

// Наповнює <select> людьми потрібних ролей. Неактивних показуємо тільки
// якщо вони вже вибрані в цьому запиті. Старе ім'я без id — окремим пунктом.
function fillStaffSelect(selectId, roles, selectedId, legacyName) {
    const select = document.getElementById(selectId);
    const list = staffCache.filter(
        (s) =>
            roles.includes(s.role) &&
            (s.active || String(s.id) === String(selectedId)),
    );

    let html = `<option value="">— не вибрано —</option>`;
    html += list
        .map(
            (s) =>
                `<option value="${s.id}" ${String(s.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(s.full_name)}${s.active ? "" : " (неактивний)"}</option>`,
        )
        .join("");

    if (!selectedId && legacyName) {
        html += `<option value="${LEGACY_OPTION}" data-name="${escapeHtml(legacyName)}" selected>${escapeHtml(legacyName)}</option>`;
    }

    if (!list.length && !legacyName) {
        html += `<option value="" disabled>Додайте людей на сторінці «Співробітники»</option>`;
    }

    select.innerHTML = html;
}

// Повертає { id, name } вибраного співробітника для збереження
function readStaffSelect(selectId) {
    const select = document.getElementById(selectId);
    const value = select.value;
    if (!value) return { id: null, name: null };
    if (value === LEGACY_OPTION) {
        return {
            id: null,
            name: select.selectedOptions[0]?.dataset.name || null,
        };
    }
    return { id: value, name: staffById(value)?.full_name || null };
}

/* ================================================================= *
 * 4.3 КІЛЬКА ЛОГІСТІВ НА ЗАПИТ                                       *
 * ================================================================= */

// Усі логісти, кому надіслано запит
function logistIdsOf(r) {
    if (!r) return [];
    if (Array.isArray(r.logistician_ids) && r.logistician_ids.length) {
        return r.logistician_ids.map(String);
    }
    return r.logistician_id ? [String(r.logistician_id)] : [];
}

// Запит уже "обрано" — Sales підтвердив пропозицію конкретного логіста
function isChosen(r) {
    return (
        Boolean(r?.logistician_id) &&
        ![STATUS_NEW, STATUS_QUOTE].includes(r.status)
    );
}

function fillLogistPicker(selectedIds, legacyName) {
    const box = document.getElementById("req_logisticians");
    const selected = new Set((selectedIds || []).map(String));
    const list = staffCache.filter(
        (s) =>
            ["logist", "head"].includes(s.role) &&
            (s.active || selected.has(String(s.id))),
    );

    let html = list
        .map(
            (s) => `
            <label class="logist-chip">
                <input type="checkbox" value="${s.id}" ${selected.has(String(s.id)) ? "checked" : ""} />
                <span>${escapeHtml(s.full_name)}${s.active ? "" : " (неактивний)"}</span>
            </label>`,
        )
        .join("");

    if (legacyName) {
        html += `
            <label class="logist-chip">
                <input type="checkbox" value="${LEGACY_OPTION}" data-name="${escapeHtml(legacyName)}" checked />
                <span>${escapeHtml(legacyName)}</span>
            </label>`;
    }
    if (!list.length && !legacyName) {
        html = `<div class="logist-empty">Додайте логістів на сторінці «Співробітники»</div>`;
    }

    box.innerHTML = html;
    syncLogistAll();
}

function syncLogistAll() {
    const boxes = document.querySelectorAll(
        "#req_logisticians input[type='checkbox']",
    );
    const all = document.getElementById("req_logist_all");
    all.checked = boxes.length > 0 && [...boxes].every((b) => b.checked);
}

document.getElementById("req_logist_all").addEventListener("change", (e) => {
    document
        .querySelectorAll("#req_logisticians input[type='checkbox']")
        .forEach((b) => (b.checked = e.target.checked));
});
document
    .getElementById("req_logisticians")
    .addEventListener("change", syncLogistAll);

// { ids: [...], names: [...] } відмічених логістів
function readLogistPicker() {
    const ids = [];
    const names = [];
    document
        .querySelectorAll("#req_logisticians input[type='checkbox']:checked")
        .forEach((b) => {
            if (b.value === LEGACY_OPTION) {
                names.push(b.dataset.name);
            } else {
                ids.push(b.value);
                names.push(staffById(b.value)?.full_name || "");
            }
        });
    return { ids, names: names.filter(Boolean) };
}

// Поля для збереження. Якщо Sales уже обрав логіста — він лишається головним
function logistFieldsFor(existing, pick) {
    if (
        existing &&
        isChosen(existing) &&
        pick.ids.includes(String(existing.logistician_id))
    ) {
        return {
            logistician_ids: pick.ids,
            logistician_id: existing.logistician_id,
            logistician: existing.logistician,
        };
    }
    return {
        logistician_ids: pick.ids,
        logistician_id: pick.ids[0] || null,
        logistician: pick.names.join(", ") || null,
    };
}

// Три кнопки "Тип запиту" у формі
function renderTypePicker(selected) {
    document.getElementById("req_type_picker").innerHTML = REQUEST_TYPES.map(
        (t) => `
        <label class="type-option ${t.cls}">
            <input type="radio" name="req_type" value="${escapeHtml(t.value)}" ${t.value === selected ? "checked" : ""} />
            <i class='bx ${t.icon}'></i> ${escapeHtml(t.value)}
        </label>`,
    ).join("");
}

/* ================================================================= *
 * 5. ЗАВАНТАЖЕННЯ ТА ВІДОБРАЖЕННЯ                                    *
 * ================================================================= */

async function loadRequests() {
    const { data, error } = await sbClient
        .from("requests")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Помилка завантаження запитів:", error);
        tableBody.innerHTML = `<tr><td colspan="11" class="empty-row">Помилка завантаження: ${escapeHtml(error.message)}</td></tr>`;
        return;
    }

    requestsCache = data || [];
    renderRequests();
}

function renderRequests() {
    const query = (searchInput?.value || "").trim().toLowerCase();

    let rows = requestsCache.filter((r) => {
        if (!query) return true;
        const haystack = [
            r.client,
            r.request_type,
            r.cargo,
            r.transport_type,
            r.weight,
            r.load_country,
            r.load_address,
            r.unload_country,
            r.unload_address,
            r.customs_export,
            r.border_crossing,
            r.customs_import,
            r.status,
            r.sales,
            r.logistician,
            r.notes,
            r.logist_notes,
            ...getOffers(r).map((o) => `${o.price} ${o.currency} ${o.comment}`),
            formatDesiredDate(r.desired_date, r.desired_date_to),
            formatCreatedAt(r.created_at),
        ]
            .join(" ")
            .toLowerCase();
        return haystack.includes(query);
    });

    // Фільтри по колонках
    rows = rows.filter((r) =>
        Object.entries(activeFilters).every(([col, selected]) =>
            selected.has(filterValue(r, col)),
        ),
    );

    rows.sort((a, b) => {
        let result;
        if (sortColumn === "status") {
            result = statusOrder(a.status) - statusOrder(b.status);
        } else if (sortColumn === "request_type") {
            result = typeOrder(a.request_type) - typeOrder(b.request_type);
        } else if (
            sortColumn === "created_at" ||
            sortColumn === "desired_date"
        ) {
            // Порожні дати завжди в кінці списку
            const va = a[sortColumn] || "";
            const vb = b[sortColumn] || "";
            if (!va && vb) return 1;
            if (va && !vb) return -1;
            result = va < vb ? -1 : va > vb ? 1 : 0;
        } else {
            result = String(a[sortColumn] || "").localeCompare(
                String(b[sortColumn] || ""),
                "uk",
                { numeric: true },
            );
        }
        return sortAscending ? result : -result;
    });

    updateSortIcons();
    updateCountBar(rows.length, requestsCache.length);

    if (rows.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="11" class="empty-row">${
            requestsCache.length
                ? "Записи не знайдені за заданими критеріями"
                : "Запитів ще немає"
        }</td></tr>`;
        return;
    }

    tableBody.innerHTML = "";
    rows.forEach((r, index) => {
        const state = requestState(r);
        const tr = document.createElement("tr");
        tr.className = `clickable-row req-${state}`;
        tr.title = "Натисніть, щоб відкрити картку запиту";

        const newBadge =
            state === "new" ? `<span class="new-badge">new</span>` : "";

        tr.innerHTML = `
            <td class="cell-num">${index + 1}</td>
            <td class="cell-client">${newBadge}<strong>${escapeHtml(r.client) || "—"}</strong></td>
            <td>${typeBadge(r.request_type)}</td>
            <td class="cell-country">${countryBadge(r.load_country)}</td>
            <td class="cell-country">${countryBadge(r.unload_country)}</td>
            <td>${statusBadge(r.status)}</td>
            <td class="cell-date">${formatDesiredDate(r.desired_date, r.desired_date_to) || "—"}</td>
            <td class="cell-person">${escapeHtml(r.sales) || "—"}</td>
            <td class="cell-person">${escapeHtml(r.logistician) || "—"}</td>
            <td class="cell-date">
                <div>${formatDateTime(r.created_at) || "—"}</div>
                ${timerHtml(r, state)}
            </td>
            <td class="cell-actions">
                <button class="btn-icon btn-icon-answer" data-action="answer" title="Відповідь логіста"><i class='bx bx-dollar-circle'></i></button>
                <button class="btn-icon btn-icon-edit" data-action="edit" title="Редагувати"><i class='bx bx-edit'></i></button>
                <button class="btn-icon text-danger" data-action="delete" title="Видалити"><i class='bx bx-trash'></i></button>
            </td>
        `;

        // Клік по рядку — картка запиту; кнопки — редагування / видалення
        tr.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-action]");
            if (btn && btn.dataset.action === "delete") {
                deleteRequest(r.id);
                return;
            }
            if (btn && btn.dataset.action === "edit") {
                openRequestModal(r);
                return;
            }
            if (btn && btn.dataset.action === "answer") {
                openAnswerModal(r.id);
                return;
            }
            openRequestCard(r.id);
        });

        tableBody.appendChild(tr);
    });
}

function updateCountBar(shown, total) {
    const bar = document.getElementById("requestsCountBar");
    if (!bar) return;

    let text;
    if (total === 0) text = "Запитів немає";
    else if (shown === total) text = `Запитів: ${total}`;
    else text = `Показано: ${shown} з ${total}`;

    const hasFilters = Object.keys(activeFilters).length > 0;

    // Скільки зараз нових і прострочених — щоб логіст одразу бачив
    const counts = { new: 0, overdue: 0 };
    requestsCache.forEach((r) => {
        const s = requestState(r);
        if (s in counts) counts[s]++;
    });

    bar.innerHTML =
        `<span>${escapeHtml(text)}</span>` +
        (hasFilters
            ? ` <a class="reset-filters-link" id="resetFiltersLink"><i class='bx bx-x'></i> Скинути фільтри</a>`
            : "") +
        `<span class="req-legend">
            <span class="legend-item"><span class="legend-dot dot-new"></span>Нові: ${counts.new}</span>
            <span class="legend-item"><span class="legend-dot dot-overdue"></span>Понад 2 год без відповіді: ${counts.overdue}</span>
            <span class="legend-item"><span class="legend-dot dot-answered"></span>Відповів логіст</span>
        </span>`;

    const resetLink = document.getElementById("resetFiltersLink");
    if (resetLink) resetLink.addEventListener("click", resetAllFilters);
}

/* ================================================================= *
 * 6. СОРТУВАННЯ ЗА КЛІКОМ ПО ЗАГОЛОВКУ                               *
 * ================================================================= */

document.querySelectorAll(".requests-table .sortable").forEach((el) => {
    el.addEventListener("click", () => {
        const col = el.dataset.sort;
        if (sortColumn === col) {
            sortAscending = !sortAscending;
        } else {
            sortColumn = col;
            sortAscending = true;
        }
        renderRequests();
    });
});

function updateSortIcons() {
    document.querySelectorAll(".requests-table .sortable").forEach((el) => {
        const icon = el.querySelector(".sort-icon");
        if (!icon) return;
        icon.classList.remove("bx-chevron-up", "bx-chevron-down");
        el.classList.toggle("sorted", el.dataset.sort === sortColumn);
        if (el.dataset.sort === sortColumn) {
            icon.classList.add(
                sortAscending ? "bx-chevron-up" : "bx-chevron-down",
            );
        }
    });
}

/* ================================================================= *
 * 6.1 ФІЛЬТРИ ПО КОЛОНКАХ (як у перевізниках)                        *
 * ================================================================= */

const EMPTY_LABEL = "(порожньо)";
let activeFilters = {}; // { колонка: Set(обрані значення) }
let activeFilterColumn = null;

// Значення клітинки так, як його бачить користувач у таблиці
function filterValue(r, col) {
    let v;
    if (col === "desired_date") {
        v = formatDesiredDate(r.desired_date, r.desired_date_to);
    } else if (col === "created_at") {
        v = formatCreatedAt(r.created_at);
    } else {
        v = r[col] ? String(r[col]).trim() : "";
    }
    return v || EMPTY_LABEL;
}

// Ключ для сортування варіантів у списку фільтра
function filterSortKey(r, col) {
    if (col === "desired_date" || col === "created_at") return r[col] || "";
    if (col === "status") return String(statusOrder(r.status)).padStart(3, "0");
    if (col === "request_type")
        return String(typeOrder(r.request_type)).padStart(3, "0");
    return filterValue(r, col);
}

// Додаємо зелену іконку фільтра біля кожного заголовка з сортуванням
function buildFilterIcons() {
    document
        .querySelectorAll(".requests-table th .sortable")
        .forEach((span) => {
            const th = span.parentElement;
            const wrapper = document.createElement("div");
            wrapper.className = "th-content";
            th.insertBefore(wrapper, span);
            wrapper.appendChild(span);

            const icon = document.createElement("i");
            icon.className = "bx bx-filter-alt filter-icon";
            icon.dataset.filter = span.dataset.sort;
            icon.title = "Фільтр";
            icon.addEventListener("click", (e) =>
                openColumnFilter(e, span.dataset.sort),
            );
            wrapper.appendChild(icon);
        });
}

function updateFilterIcons() {
    document
        .querySelectorAll(".requests-table .filter-icon")
        .forEach((icon) => {
            icon.classList.toggle(
                "filter-active",
                Boolean(activeFilters[icon.dataset.filter]),
            );
        });
}

function openColumnFilter(event, col) {
    event.stopPropagation();
    activeFilterColumn = col;

    const dropdown = document.getElementById("columnFilterDropdown");
    const optionsBox = document.getElementById("columnFilterOptions");
    document.getElementById("columnFilterSearch").value = "";

    // Унікальні значення колонки
    const unique = new Map(); // label → sortKey
    requestsCache.forEach((r) => {
        const label = filterValue(r, col);
        if (!unique.has(label)) unique.set(label, filterSortKey(r, col));
    });

    const options = Array.from(unique.entries()).sort((a, b) => {
        if (a[0] === EMPTY_LABEL) return 1;
        if (b[0] === EMPTY_LABEL) return -1;
        return String(a[1]).localeCompare(String(b[1]), "uk", {
            numeric: true,
        });
    });

    const current = activeFilters[col];
    optionsBox.innerHTML = options
        .map(([label]) => {
            const checked = !current || current.has(label) ? "checked" : "";
            return `
            <label class="filter-option-item">
                <input type="checkbox" value="${escapeHtml(label)}" ${checked}>
                <span>${escapeHtml(label)}</span>
            </label>`;
        })
        .join("");

    document.getElementById("selectAllLink").textContent =
        `Вибрати всі (${options.length})`;

    dropdown.style.display = "block";

    // Позиція під іконкою, не виходячи за край екрана
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 280;
    let left = window.scrollX + rect.left - 120;
    if (left + width > window.scrollX + window.innerWidth) {
        left = window.scrollX + window.innerWidth - width - 16;
    }
    if (left < window.scrollX + 8) left = window.scrollX + 8;
    dropdown.style.top = `${window.scrollY + rect.bottom + 6}px`;
    dropdown.style.left = `${left}px`;

    updateFilterCountText();
}

function getCheckedValues() {
    return Array.from(
        document.querySelectorAll(
            "#columnFilterOptions input[type='checkbox']",
        ),
    )
        .filter((cb) => cb.checked)
        .map((cb) => cb.value);
}

function updateFilterCountText() {
    const selected = new Set(getCheckedValues());
    const count = requestsCache.filter((r) =>
        selected.has(filterValue(r, activeFilterColumn)),
    ).length;
    document.getElementById("filterShownCount").textContent =
        `Показується рядків: ${count}`;
}

function setAllVisibleOptions(checked) {
    document
        .querySelectorAll("#columnFilterOptions .filter-option-item")
        .forEach((label) => {
            if (label.style.display !== "none") {
                label.querySelector("input").checked = checked;
            }
        });
    updateFilterCountText();
}

function closeColumnFilter() {
    document.getElementById("columnFilterDropdown").style.display = "none";
    activeFilterColumn = null;
}

function applyColumnFilter() {
    if (!activeFilterColumn) return;

    const all = document.querySelectorAll(
        "#columnFilterOptions input[type='checkbox']",
    ).length;
    const selected = getCheckedValues();

    // Обрано все — значить фільтра немає
    if (selected.length === all) {
        delete activeFilters[activeFilterColumn];
    } else {
        activeFilters[activeFilterColumn] = new Set(selected);
    }

    closeColumnFilter();
    updateFilterIcons();
    renderRequests();
}

function resetAllFilters() {
    activeFilters = {};
    updateFilterIcons();
    renderRequests();
}

// Події випадаючого вікна фільтра
document
    .getElementById("selectAllLink")
    .addEventListener("click", () => setAllVisibleOptions(true));
document
    .getElementById("clearAllLink")
    .addEventListener("click", () => setAllVisibleOptions(false));
document
    .getElementById("cancelColumnFilterBtn")
    .addEventListener("click", closeColumnFilter);
document
    .getElementById("applyColumnFilterBtn")
    .addEventListener("click", applyColumnFilter);
document
    .getElementById("columnFilterOptions")
    .addEventListener("change", updateFilterCountText);
document.getElementById("columnFilterSearch").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    document
        .querySelectorAll("#columnFilterOptions .filter-option-item")
        .forEach((label) => {
            label.style.display = label.textContent.toLowerCase().includes(q)
                ? "flex"
                : "none";
        });
});

// Клік будь-де поза вікном — закриваємо його
document.addEventListener("click", () => {
    if (
        document.getElementById("columnFilterDropdown").style.display ===
        "block"
    ) {
        closeColumnFilter();
    }
});

/* ================================================================= *
 * 7. БАЖАНА ДАТА: ОДНА ДАТА АБО ПЕРІОД                               *
 * ================================================================= */

function updateDateRangeUI() {
    const isRange = dateRangeCheckbox.checked;
    dateToInput.style.display = isRange ? "" : "none";
    dateRangeDash.style.display = isRange ? "" : "none";
    if (!isRange) dateToInput.value = "";
    // "До" не може бути раніше за "від"
    dateToInput.min = dateFromInput.value || "";
}

dateRangeCheckbox.addEventListener("change", updateDateRangeUI);
dateFromInput.addEventListener("change", () => {
    dateToInput.min = dateFromInput.value || "";
    if (dateToInput.value && dateToInput.value < dateFromInput.value) {
        dateToInput.value = dateFromInput.value;
    }
});

/* ================================================================= *
 * 8. МОДАЛКА: ДОДАТИ / РЕДАГУВАТИ                                    *
 * ================================================================= */

function fillSelects() {
    const countryOptions =
        `<option value="">Оберіть країну...</option>` +
        REQUEST_COUNTRIES.map(
            (c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`,
        ).join("");

    document.getElementById("req_load_country").innerHTML = countryOptions;
    document.getElementById("req_unload_country").innerHTML = countryOptions;

    document.getElementById("req_status").innerHTML = REQUEST_STATUSES.map(
        (s) =>
            `<option value="${escapeHtml(s.value)}">${escapeHtml(s.value)}</option>`,
    ).join("");

    document.getElementById("transportTypesList").innerHTML =
        TRANSPORT_TYPES.map(
            (t) => `<option value="${escapeHtml(t)}"></option>`,
        ).join("");

    document.getElementById("borderCrossingsList").innerHTML =
        BORDER_CROSSINGS.map(
            (b) => `<option value="${escapeHtml(b)}"></option>`,
        ).join("");
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
}

function openRequestModal(request = null) {
    requestForm.reset();

    setVal("requestId", request ? request.id : "");
    setVal("req_client", request?.client);
    renderTypePicker(request?.request_type || "");
    setVal("req_cargo", request?.cargo);
    setVal("req_transport_type", request?.transport_type);
    setVal("req_weight", request?.weight);
    setVal("req_load_country", request?.load_country);
    setVal("req_load_address", request?.load_address);
    setVal("req_unload_country", request?.unload_country);
    setVal("req_unload_address", request?.unload_address);
    setVal("req_customs_export", request?.customs_export);
    setVal("req_border_crossing", request?.border_crossing);
    setVal("req_customs_import", request?.customs_import);
    setVal("req_status", request?.status || REQUEST_STATUSES[0].value);
    // Sales: для нового запиту — той, хто зараз увійшов (якщо він Sales/Керівник)
    const defaultSalesId =
        !request &&
        currentStaff &&
        ["sales", "head"].includes(currentStaff.role)
            ? currentStaff.id
            : null;
    fillStaffSelect(
        "req_sales",
        ["sales", "head"],
        request ? request.sales_id : defaultSalesId,
        request && !request.sales_id ? request.sales : null,
    );
    fillLogistPicker(
        logistIdsOf(request),
        request && !logistIdsOf(request).length ? request.logistician : null,
    );
    setVal("req_notes", request?.notes);

    const from = request?.desired_date
        ? String(request.desired_date).slice(0, 10)
        : "";
    const to = request?.desired_date_to
        ? String(request.desired_date_to).slice(0, 10)
        : "";
    dateFromInput.value = from;
    dateRangeCheckbox.checked = Boolean(to && to !== from);
    dateToInput.value = dateRangeCheckbox.checked ? to : "";
    updateDateRangeUI();

    document.getElementById("requestModalTitle").textContent = request
        ? "Редагувати запит"
        : "Додати запит";

    modalOverlay.classList.add("active");
}

function closeRequestModal() {
    modalOverlay.classList.remove("active");
}

document
    .getElementById("openRequestModalBtn")
    .addEventListener("click", () => openRequestModal());
document
    .getElementById("closeRequestModalBtn")
    .addEventListener("click", closeRequestModal);
document
    .getElementById("cancelRequestBtn")
    .addEventListener("click", closeRequestModal);
modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeRequestModal();
});

requestForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const getValue = (id) => {
        const el = document.getElementById(id);
        return el && el.value.trim() !== "" ? el.value.trim() : null;
    };

    const dateFrom = getValue("req_desired_date");
    let dateTo = dateRangeCheckbox.checked
        ? getValue("req_desired_date_to")
        : null;

    if (dateTo && !dateFrom) {
        alert("Вкажіть початкову дату періоду.");
        return;
    }
    if (dateTo && dateTo < dateFrom) {
        alert("Кінцева дата не може бути раніше за початкову.");
        return;
    }
    if (dateTo === dateFrom) dateTo = null;

    const requestType =
        document.querySelector("input[name='req_type']:checked")?.value || null;
    if (!requestType) {
        alert("Оберіть тип запиту: Прорахунок, Пошук авто чи Завантаження.");
        return;
    }

    const salesPick = readStaffSelect("req_sales");
    const logistPick = readLogistPicker();
    const existing = document.getElementById("requestId").value
        ? requestsCache.find(
              (x) =>
                  String(x.id) ===
                  String(document.getElementById("requestId").value),
          )
        : null;
    const logistFields = logistFieldsFor(existing, logistPick);

    const payload = {
        client: getValue("req_client"),
        request_type: requestType,
        cargo: getValue("req_cargo"),
        transport_type: getValue("req_transport_type"),
        weight: getValue("req_weight"),
        load_country: getValue("req_load_country"),
        load_address: getValue("req_load_address"),
        unload_country: getValue("req_unload_country"),
        unload_address: getValue("req_unload_address"),
        customs_export: getValue("req_customs_export"),
        border_crossing: getValue("req_border_crossing"),
        customs_import: getValue("req_customs_import"),
        status: getValue("req_status") || REQUEST_STATUSES[0].value,
        desired_date: dateFrom,
        desired_date_to: dateTo,
        sales: salesPick.name,
        sales_id: salesPick.id,
        ...logistFields,
        notes: getValue("req_notes"),
    };

    const id = document.getElementById("requestId").value;

    const { error } = id
        ? await sbClient.from("requests").update(payload).eq("id", id)
        : await sbClient.from("requests").insert([payload]);

    if (error) {
        alert("Помилка Supabase: " + error.message);
        console.error(error);
        return;
    }

    closeRequestModal();
    loadRequests();
});

async function deleteRequest(id) {
    if (!confirm("Ви впевнені, що хочете видалити цей запит?")) return;

    const { error } = await sbClient.from("requests").delete().eq("id", id);
    if (error) {
        alert("Помилка при видаленні: " + error.message);
    } else {
        loadRequests();
    }
}

/* ================================================================= *
 * 8.1 КАРТКА ЗАПИТУ (повна інформація, відкривається кліком по рядку)*
 * ================================================================= */

const requestCardOverlay = document.getElementById("requestCardOverlay");
let currentCardRequestId = null;

// Один рядок "підпис — значення" (класи картки перевізника зі style.css)
function cardRow(label, valueHtml) {
    return `
        <div class="card-row">
            <div class="card-row-label">${label}</div>
            <div class="card-row-value">${valueHtml || "—"}</div>
        </div>`;
}

function openRequestCard(id) {
    const r = requestsCache.find((x) => String(x.id) === String(id));
    if (!r) return;
    currentCardRequestId = r.id;

    const notesHtml = r.notes
        ? `<div style="white-space:pre-wrap; word-break:break-word;">${escapeHtml(r.notes)}</div>`
        : "";

    const routeText = [r.load_country, r.unload_country]
        .filter(Boolean)
        .map(escapeHtml)
        .join(" → ");

    document.getElementById("requestCardBody").innerHTML = `
        <div class="card-header-block">
            <div class="request-card-icon"><i class='bx bx-package'></i></div>
            <div class="card-header-info">
                <div class="card-title">${escapeHtml(r.client) || "—"}</div>
                <div class="card-subtitle">${routeText || "Маршрут не вказано"}</div>
                <div class="card-type">${typeBadge(r.request_type)}</div>
                <div class="card-header-badges">
                    ${statusBadge(r.status)}
                    <span class="request-card-created">Запит від Sales: ${formatDateTime(r.created_at) || "—"}</span>
                </div>
            </div>
        </div>

        ${answerSectionHtml(r)}

        <div class="card-columns">
            <div class="card-col">
                <div class="card-section">
                    <div class="card-section-title">Вантаж і транспорт</div>
                    ${cardRow("Вантаж:", escapeHtml(r.cargo))}
                    ${cardRow("Тип транспорту:", r.transport_type ? `<span class="badge badge-warning">${escapeHtml(r.transport_type)}</span>` : "")}
                    ${cardRow("Вага:", escapeHtml(r.weight))}
                </div>

                <div class="card-section">
                    <div class="card-section-title">Маршрут</div>
                    ${cardRow("Відвантаження:", locationCell(r.load_country, r.load_address))}
                    ${cardRow("Розвантаження:", locationCell(r.unload_country, r.unload_address))}
                </div>

                <div class="card-section">
                    <div class="card-section-title">Нотатки</div>
                    <div class="card-block-text">${notesHtml || "—"}</div>
                </div>
            </div>

            <div class="card-col">
                <div class="card-section">
                    <div class="card-section-title">Митниця та кордон</div>
                    ${cardRow("Замитнення:", escapeHtml(r.customs_export))}
                    ${cardRow("Погран перехід:", escapeHtml(r.border_crossing))}
                    ${cardRow("Розмитнення:", escapeHtml(r.customs_import))}
                </div>

                <div class="card-section">
                    <div class="card-section-title">Дата та відповідальні</div>
                    ${cardRow("Бажана дата:", formatDesiredDate(r.desired_date, r.desired_date_to))}
                    ${cardRow("Sales:", r.sales ? `<span class="request-card-person">${escapeHtml(r.sales)}</span>` : "")}
                    ${cardRow("Logistician:", r.logistician ? `<span class="request-card-person">${escapeHtml(r.logistician)}</span>` : "")}
                    ${cardRow("Запит від Sales:", formatDateTime(r.created_at))}
                    ${cardRow("Відповідь логіста:", r.answered_at ? formatDateTime(r.answered_at) : "")}
                    ${cardRow("Час реакції:", timerHtml(r, requestState(r)))}
                </div>
            </div>
        </div>
    `;

    document
        .querySelectorAll("#requestCardBody [data-choose]")
        .forEach((btn) =>
            btn.addEventListener("click", () =>
                chooseAnswer(r.id, btn.dataset.choose),
            ),
        );

    document
        .getElementById("openAnswerFromCardBtn")
        ?.addEventListener("click", () => {
            const id = currentCardRequestId;
            closeRequestCard();
            openAnswerModal(id);
        });

    requestCardOverlay.classList.add("active");
}

function closeRequestCard() {
    requestCardOverlay.classList.remove("active");
    currentCardRequestId = null;
}

// Редагувати з картки: закриваємо картку і відкриваємо форму
document
    .getElementById("editFromRequestCardBtn")
    .addEventListener("click", () => {
        const r = requestsCache.find(
            (x) => String(x.id) === String(currentCardRequestId),
        );
        closeRequestCard();
        if (r) openRequestModal(r);
    });

document
    .getElementById("closeRequestCardBtn")
    .addEventListener("click", closeRequestCard);
requestCardOverlay.addEventListener("click", (e) => {
    if (e.target === requestCardOverlay) closeRequestCard();
});

/* ================================================================= *
 * 8.2 ВІДПОВІДЬ ЛОГІСТА: 3 ВАРІАНТИ ЦІНИ + НОТАТКИ                   *
 * ================================================================= */

const OFFERS_COUNT = 3;
const CURRENCIES = ["EUR", "USD", "UAH"];

const answerModalOverlay = document.getElementById("answerModalOverlay");
const answerForm = document.getElementById("answerForm");

// Варіанти з бази (jsonb) — завжди повертаємо масив
function getOffers(r) {
    return Array.isArray(r?.offers) ? r.offers : [];
}

// Відповіді по логістах: [{ logist_id, logist, offers, notes, at }]
// Для старих запитів — збираємо з offers / logist_notes
function getAnswers(r) {
    if (Array.isArray(r?.answers) && r.answers.length) return r.answers;
    const offers = getOffers(r);
    if (!offers.length && !r?.logist_notes) return [];
    return [
        {
            logist_id: r.logistician_id || null,
            logist: r.logistician || "",
            offers,
            notes: r.logist_notes || null,
            at: r.answered_at || null,
        },
    ];
}

// "1200" → "1 200", "1200.5" → "1 200,5"; інший текст лишаємо як є
function formatPrice(price) {
    const s = String(price || "").trim();
    if (/^\d+([.,]\d+)?$/.test(s)) {
        return Number(s.replace(",", ".")).toLocaleString("uk-UA");
    }
    return s;
}

function offerRowsHtml(offers) {
    return offers
        .map(
            (o, i) => `
            <div class="offer-row">
                <span class="offer-num">${i + 1}</span>
                <div class="offer-price">${o.price ? `${escapeHtml(formatPrice(o.price))} ${escapeHtml(o.currency || "")}` : "—"}</div>
                <div class="offer-date">${offerDateHtml(o)}</div>
                <div class="offer-comment">${escapeHtml(o.comment || "")}</div>
            </div>`,
        )
        .join("");
}

// Блок "Відповіді логістів" в картці запиту
function answerSectionHtml(r) {
    const answers = getAnswers(r);
    const mine = currentStaff
        ? answers.find((a) => String(a.logist_id) === String(currentStaff.id))
        : null;
    const canChoose = !isChosen(r) && r.status !== "Відмова";

    const blocksHtml = answers.length
        ? answers
              .map((a) => {
                  const chosen =
                      isChosen(r) &&
                      String(r.logistician_id) === String(a.logist_id);
                  const chooseBtn =
                      canChoose && a.logist_id && answers.length
                          ? `<button type="button" class="btn-choose" data-choose="${escapeHtml(a.logist_id)}"><i class='bx bx-check'></i> Обрати</button>`
                          : "";
                  return `
                <div class="answer-block ${chosen ? "answer-chosen" : ""}">
                    <div class="answer-block-head">
                        <span class="answer-logist"><i class='bx bx-user'></i> ${escapeHtml(a.logist || "Логіст")}</span>
                        ${a.at ? `<span class="answer-time">${formatDateTime(a.at)}</span>` : ""}
                        ${chosen ? `<span class="chosen-badge"><i class='bx bx-check-circle'></i> обрано</span>` : ""}
                        ${chooseBtn}
                    </div>
                    ${(a.offers || []).length ? offerRowsHtml(a.offers) : ""}
                    ${a.notes ? `<div class="answer-notes"><div class="answer-notes-label">Нотатки</div><div style="white-space:pre-wrap; word-break:break-word;">${escapeHtml(a.notes)}</div></div>` : ""}
                </div>`;
              })
              .join("")
        : `<div class="card-block-text offer-muted">Логісти ще не дали варіантів ціни</div>`;

    const title =
        answers.length > 1
            ? `Відповіді логістів (${answers.length})`
            : "Відповідь логіста";

    return `
        <div class="card-section answer-section">
            <div class="card-section-title answer-section-title">
                <span><i class='bx bx-dollar-circle'></i> ${title}</span>
                <button type="button" class="btn-answer" id="openAnswerFromCardBtn">
                    <i class='bx ${mine ? "bx-edit" : "bx-plus"}'></i> ${mine ? "Змінити мою відповідь" : "Дати відповідь"}
                </button>
            </div>
            ${blocksHtml}
        </div>`;
}

// Sales обирає пропозицію логіста → статус "Пошук авто"
async function chooseAnswer(requestId, logistId) {
    const r = requestsCache.find((x) => String(x.id) === String(requestId));
    if (!r) return;
    const a = getAnswers(r).find(
        (x) => String(x.logist_id) === String(logistId),
    );
    if (!a) return;
    if (
        !confirm(
            `Обрати пропозицію логіста «${a.logist}»?\nСтатус зміниться на «${STATUS_CHOSEN}».`,
        )
    )
        return;

    const { error } = await sbClient
        .from("requests")
        .update({
            status: STATUS_CHOSEN,
            logistician_id: a.logist_id,
            logistician: a.logist,
        })
        .eq("id", r.id);
    if (error) {
        alert("Помилка Supabase: " + error.message);
        return;
    }
    await loadRequests();
    openRequestCard(r.id);
}

// Дата авто у картці: одна дата / період / не вказана
function offerDateHtml(o) {
    if (o.date_flexible) {
        return `<span class="flexible-badge"><i class='bx bx-transfer-alt'></i> плаваюча дата</span>`;
    }
    if (o.date) {
        return `<i class='bx bx-calendar'></i> авто ${formatDesiredDate(o.date, o.date_to)}`;
    }
    return `<span class="offer-muted">дата не вказана</span>`;
}

// Показує/ховає поля дати в одному варіанті залежно від галочок
function syncOfferDateUI(row) {
    const period = row.querySelector(".ans-period").checked;
    const from = row.querySelector(".ans-date");
    const to = row.querySelector(".ans-date-to");

    to.hidden = !period;
    row.querySelector(".ans-date-dash").hidden = !period;
    if (!period) to.value = "";
    to.min = from.value || "";
    if (to.value && from.value && to.value < from.value) to.value = from.value;
}

// Галочка "період" і зміна початкової дати
document.getElementById("answerOptions").addEventListener("change", (e) => {
    const row = e.target.closest(".answer-option");
    if (!row) return;
    if (
        e.target.classList.contains("ans-period") ||
        e.target.classList.contains("ans-date")
    ) {
        syncOfferDateUI(row);
    }
});

// Один блок "Варіант N" у формі відповіді
function offerFormRowHtml(i, o = {}) {
    const currencyOptions = CURRENCIES.map(
        (c) =>
            `<option value="${c}" ${(o.currency || "EUR") === c ? "selected" : ""}>${c}</option>`,
    ).join("");

    const hasPeriod = Boolean(o.date_to && o.date_to !== o.date);

    return `
        <div class="answer-option">
            <div class="answer-option-title">Варіант ${i}</div>
            <div class="answer-option-grid">
                <div class="form-group">
                    <label>Ціна</label>
                    <div class="price-input">
                        <input type="text" inputmode="decimal" class="ans-price" value="${escapeHtml(o.price || "")}" placeholder="1200" />
                        <select class="ans-currency">${currencyOptions}</select>
                    </div>
                </div>

                <div class="form-group">
                    <div class="date-label-row">
                        <label>Коли буде авто</label>
                        <label class="date-range-toggle">
                            <input type="checkbox" class="ans-period" ${hasPeriod ? "checked" : ""} />
                            період
                        </label>
                    </div>
                    <div class="date-inputs ans-dates">
                        <input type="date" class="ans-date" value="${escapeHtml(o.date || "")}" />
                        <span class="date-dash ans-date-dash">—</span>
                        <input type="date" class="ans-date-to" value="${escapeHtml(hasPeriod ? o.date_to : "")}" />
                    </div>
                </div>

                <div class="form-group answer-comment">
                    <label>Коментар</label>
                    <input type="text" class="ans-comment" value="${escapeHtml(o.comment || "")}" placeholder="наприклад: ТЕНТ 92 м³, ЕКМТ" />
                </div>
            </div>
        </div>`;
}

function openAnswerModal(id) {
    const r = requestsCache.find((x) => String(x.id) === String(id));
    if (!r) return;

    if (!currentStaff) {
        alert(
            "Додайте себе на сторінці «Співробітники» (з поштою, з якою входите), щоб давати відповіді.",
        );
        return;
    }

    document.getElementById("answerRequestId").value = r.id;

    const route = [r.load_country, r.unload_country]
        .filter(Boolean)
        .join(" → ");
    document.getElementById("answerModalSubtitle").textContent = [
        r.client,
        route,
    ]
        .filter(Boolean)
        .join(" · ");

    // Кожен логіст редагує тільки свою відповідь
    const mine =
        getAnswers(r).find(
            (a) => String(a.logist_id) === String(currentStaff.id),
        ) || {};
    const offers = mine.offers || [];
    let rowsHtml = "";
    for (let i = 1; i <= OFFERS_COUNT; i++) {
        rowsHtml += offerFormRowHtml(i, offers[i - 1]);
    }
    document.getElementById("answerOptions").innerHTML = rowsHtml;
    document
        .querySelectorAll("#answerOptions .answer-option")
        .forEach(syncOfferDateUI);
    document.getElementById("ans_notes").value = mine.notes || "";

    // Підказка: що станеться зі статусом після збереження
    const hint = document.getElementById("answerStatusHint");
    hint.innerHTML =
        r.status === STATUS_NEW
            ? `<i class='bx bx-info-circle'></i> Після збереження статус зміниться на «${STATUS_QUOTE}», і запит стане зеленим.`
            : "";

    answerModalOverlay.classList.add("active");
}

function closeAnswerModal() {
    answerModalOverlay.classList.remove("active");
}

answerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = document.getElementById("answerRequestId").value;
    const r = requestsCache.find((x) => String(x.id) === String(id));
    if (!r) return;

    // Збираємо тільки заповнені варіанти
    const offers = [];
    let dateError = "";
    document
        .querySelectorAll("#answerOptions .answer-option")
        .forEach((row, idx) => {
            const price = row.querySelector(".ans-price").value.trim();
            const currency = row.querySelector(".ans-currency").value;
            const period = row.querySelector(".ans-period").checked;
            const date = row.querySelector(".ans-date").value;
            let dateTo = period ? row.querySelector(".ans-date-to").value : "";
            const comment = row.querySelector(".ans-comment").value.trim();

            if (dateTo && !date) {
                dateError = `Варіант ${idx + 1}: вкажіть початкову дату періоду.`;
            } else if (dateTo && dateTo < date) {
                dateError = `Варіант ${idx + 1}: кінцева дата раніше за початкову.`;
            }
            if (dateTo === date) dateTo = "";

            if (price || date || comment) {
                offers.push({
                    price,
                    currency,
                    date: date || null,
                    date_to: dateTo || null,
                    comment,
                });
            }
        });

    if (dateError) {
        alert(dateError);
        return;
    }

    const logistNotes = document.getElementById("ans_notes").value.trim();

    // Моя відповідь замінює тільки мою, відповіді інших логістів лишаються
    const others = getAnswers(r).filter(
        (a) => String(a.logist_id) !== String(currentStaff.id),
    );
    const answers =
        offers.length || logistNotes
            ? [
                  ...others,
                  {
                      logist_id: currentStaff.id,
                      logist: currentStaff.full_name,
                      offers,
                      notes: logistNotes || null,
                      at: new Date().toISOString(),
                  },
              ]
            : others;

    const payload = {
        answers,
        // Загальний список усіх варіантів — для пошуку і старих екранів
        offers: answers.flatMap((a) =>
            (a.offers || []).map((o) => ({ ...o, logist: a.logist })),
        ),
        logist_notes:
            answers
                .filter((a) => a.notes)
                .map((a) =>
                    answers.length > 1 ? `${a.logist}: ${a.notes}` : a.notes,
                )
                .join("\n") || null,
    };

    // Перша відповідь на новий запит — статус "Прорахунок"
    if (r.status === STATUS_NEW && answers.length) {
        payload.status = STATUS_QUOTE;
    }

    // Логіста ще не було в запиті — додаємо
    if (!logistIdsOf(r).includes(String(currentStaff.id))) {
        payload.logistician_ids = [...logistIdsOf(r), currentStaff.id];
        if (!r.logistician_id) {
            payload.logistician_id = currentStaff.id;
            payload.logistician = currentStaff.full_name;
        }
    }

    const { error } = await sbClient
        .from("requests")
        .update(payload)
        .eq("id", id);

    if (error) {
        alert("Помилка Supabase: " + error.message);
        console.error(error);
        return;
    }

    closeAnswerModal();
    await loadRequests();
    openRequestCard(id); // одразу показуємо картку з відповіддю
});

document
    .getElementById("closeAnswerModalBtn")
    .addEventListener("click", closeAnswerModal);
document
    .getElementById("cancelAnswerBtn")
    .addEventListener("click", closeAnswerModal);
answerModalOverlay.addEventListener("click", (e) => {
    if (e.target === answerModalOverlay) closeAnswerModal();
});

/* ================================================================= *
 * 9. БІЧНА ПАНЕЛЬ, КНОПКА "НАВЕРХ", МОДАЛКА "ШЛЯХ"                   *
 * ================================================================= */

function toggleSidebar() {
    document.body.classList.toggle("sidebar-collapsed");
    const icon = document.querySelector("#sidebarToggleBtn i");
    if (icon) {
        icon.classList.toggle("bx-chevron-left");
        icon.classList.toggle("bx-chevron-right");
    }
}

function setupScrollTopButton() {
    const scrollArea = document.getElementById("tableScrollArea");
    const btn = document.getElementById("scrollTopBtn");
    if (!scrollArea || !btn) return;

    scrollArea.addEventListener("scroll", () => {
        btn.classList.toggle("visible", scrollArea.scrollTop > 200);
    });
    btn.addEventListener("click", () => {
        scrollArea.scrollTo({ top: 0, behavior: "smooth" });
    });
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

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeColumnFilter();
        closeAnswerModal();
        closeRequestCard();
        closeRequestModal();
        closeShlyahModal();
    }
});

/* ================================================================= *
 * 10. СТАРТ СТОРІНКИ + ПЕРЕВІРКА АВТОРИЗАЦІЇ                         *
 * ================================================================= */

document.addEventListener("DOMContentLoaded", async () => {
    const {
        data: { session },
    } = await sbClient.auth.getSession();

    if (!session) {
        window.location.href = "login.html";
        return;
    }

    // Користувач залогінений — показуємо сторінку
    document.body.style.visibility = "visible";

    // Якщо сесія закінчилась або вийшли в іншій вкладці — на вхід
    sbClient.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") window.location.href = "login.html";
    });

    await loadStaff(session);
    fillSelects();
    buildFilterIcons();
    updateDateRangeUI();
    setupScrollTopButton();
    searchInput?.addEventListener("input", renderRequests);
    loadRequests();

    // Кожну хвилину підтягуємо нові запити від Sales і оновлюємо таймери
    setInterval(loadRequests, 60 * 1000);
});
