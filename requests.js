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
    { value: "Завантаження", cls: "type-load", icon: "bx-package", old: true }, // більше не обирається, лишається для старих запитів
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

// Пакування — групи як на біржах вантажів
const PACKAGING_GROUPS = [
    { group: "Палети", items: ["EURO 1,2×0,8 м", "FIN 1,2×1 м", "1×1 м", "1,1×1,1 м", "1,2×1,2 м", "Нестандартна палета"] },
    { group: "Тверда", items: ["Блок", "Бочка", "Чушка", "Ящик", "Коробка", "Пачка", "Упаковка"] },
    { group: "Контейнери", items: ["Swap body", "Контейнер 45'", "Контейнер 40'", "Контейнер 20'"] },
    { group: "Гнучка", items: ["Біг-бег", "Мішок", "Зв'язка", "Сітка", "Тюк"] },
    { group: "Рідка", items: ["Барабан", "Балон", "Каністра", "Відро"] },
    { group: "Рулони або лист", items: ["Бухта", "Рулон"] },
    { group: "Сипуча форма", items: ["Навалом", "Насипом"] },
    { group: "Інше", items: ["Без упаковки"] },
];

// Як можуть вантажити
const LOADING_TYPES = ["Задня", "Бокова", "Верхня", "Повне розтентування", "Зняття поперечин", "Зняття стійок", "Гідроборт"];

const isRef = (t) => /РЕФ/i.test(String(t || ""));

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
// У таблиці країна — коротким кодом (PL, UA, DE), повна назва — при наведенні
function countryBadge(country) {
    if (!country) return "—";
    const code = (window.furaCountryCode && window.furaCountryCode(country)) || "";
    return `<span class="badge-country" title="${escapeHtml(country)}">${escapeHtml(code ? code.toUpperCase() : country)}</span>`;
}

// Країна + під нею місто/адреса — для картки запиту
// Кілька логістів — кожен з нового рядка
function logistListHtml(r) {
    const names = String(r.logistician || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    if (!names.length) return "—";
    return names.map((n) => `<div class="logist-line">${escapeHtml(n)}</div>`).join("");
}

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

// Чи має людина хоча б одну з ролей (roles — кілька ролей, role — стара одна)
function hasRole(s, list) {
    const roles =
        Array.isArray(s?.roles) && s.roles.length ? s.roles : [s?.role];
    return roles.some((r) => list.includes(r));
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
            hasRole(s, roles) &&
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
 * 4.2.1 ЛІДИ: клієнт запиту обирається зі списку лідів (з пошуком)   *
 * ================================================================= */

const LEAD_STATUS_CLS = {
    "Новий": "status-quote",
    "Контакт": "status-offer",
    "Переговори": "status-progress",
    "Працюємо": "status-confirmed",
    "Відмова": "status-rejected",
};

let leadsCache = [];
let selectedLeadId = null;

const normName = (s) => String(s || "").trim().toLowerCase();

async function loadLeadsList() {
    const { data, error } = await sbClient
        .from("leads")
        .select("id, name, edrpou, contact_person, phone, email, city, country, status, sales, sales_id, next_contact, history")
        .order("name");
    if (error) {
        console.warn("Ліди не завантажились (виконано leads.sql?):", error.message);
        return;
    }
    leadsCache = data || [];
}

const leadById = (id) => leadsCache.find((l) => String(l.id) === String(id)) || null;
const findLeadByName = (name) =>
    normName(name) ? leadsCache.find((l) => normName(l.name) === normName(name)) || null : null;

function leadStatusBadge(status) {
    return status
        ? `<span class="status-badge ${LEAD_STATUS_CLS[status] || "status-request"}">${escapeHtml(status)}</span>`
        : "";
}

// Поле "Клієнт": підказки зі списку лідів
const clientInput = document.getElementById("req_client");
const clientField = clientInput.parentElement;
clientField.classList.add("client-field");
clientInput.setAttribute("autocomplete", "off");
clientInput.placeholder = "Почніть вводити назву клієнта або ЄДРПОУ...";

const clientBox = document.createElement("div");
clientBox.className = "client-suggest";
clientBox.hidden = true;
clientField.appendChild(clientBox);

const clientLeadInfo = document.createElement("div");
clientLeadInfo.className = "client-lead-info";
clientField.appendChild(clientLeadInfo);

let clientActiveIdx = -1;

function setSelectedLead(lead) {
    selectedLeadId = lead ? lead.id : null;
    const typed = clientInput.value.trim();
    if (lead) {
        clientLeadInfo.className = "client-lead-info ok";
        clientLeadInfo.innerHTML = `<i class='bx bx-check-circle'></i> Лід ${leadStatusBadge(lead.status)}
            ${lead.sales ? `· Sales: <b>${escapeHtml(lead.sales)}</b>` : ""}
            ${lead.contact_person || lead.phone ? `· ${escapeHtml([lead.contact_person, lead.phone].filter(Boolean).join(", "))}` : ""}`;
    } else if (typed) {
        clientLeadInfo.className = "client-lead-info warn";
        clientLeadInfo.innerHTML = `<i class='bx bx-info-circle'></i> Такого клієнта немає в Лідах — оберіть зі списку або створіть нового`;
    } else {
        clientLeadInfo.className = "client-lead-info";
        clientLeadInfo.innerHTML = "";
    }
}

function renderClientSuggest() {
    const q = normName(clientInput.value);
    clientActiveIdx = -1;
    if (!q) {
        clientBox.hidden = true;
        return;
    }
    const list = leadsCache
        .filter((l) => normName(l.name).includes(q) || normName(l.edrpou).includes(q))
        .sort((a, b) => (normName(a.name).startsWith(q) ? 0 : 1) - (normName(b.name).startsWith(q) ? 0 : 1))
        .slice(0, 8);
    const exact = leadsCache.some((l) => normName(l.name) === q);

    clientBox.innerHTML =
        list
            .map(
                (l) => `
            <div class="client-option" data-id="${l.id}">
                <div class="client-option-main"><b>${escapeHtml(l.name)}</b> ${leadStatusBadge(l.status)}</div>
                <div class="client-option-sub">${[l.edrpou, l.city, l.sales && `Sales: ${l.sales}`].filter(Boolean).map(escapeHtml).join(" · ")}</div>
            </div>`,
            )
            .join("") +
        (!exact
            ? `<div class="client-option client-create" data-create="1"><i class='bx bx-plus-circle'></i> Створити нового ліда «${escapeHtml(clientInput.value.trim())}»</div>`
            : "");
    clientBox.hidden = false;
}

function highlightClientOption(idx) {
    const opts = [...clientBox.querySelectorAll(".client-option")];
    if (!opts.length) return;
    clientActiveIdx = (idx + opts.length) % opts.length;
    opts.forEach((o, i) => o.classList.toggle("active", i === clientActiveIdx));
    opts[clientActiveIdx].scrollIntoView({ block: "nearest" });
}

async function chooseClientOption(opt) {
    if (!opt) return;
    if (opt.dataset.create) {
        const lead = await createLeadQuick(clientInput.value.trim());
        if (lead) pickLead(lead);
    } else {
        pickLead(leadById(opt.dataset.id));
    }
}

function pickLead(lead) {
    if (!lead) return;
    clientInput.value = lead.name;
    setSelectedLead(lead);
    clientBox.hidden = true;
    // Sales ліда підставляємо, якщо в запиті Sales ще не обраний
    const salesSel = document.getElementById("req_sales");
    if (lead.sales_id && !salesSel.value && [...salesSel.options].some((o) => o.value === String(lead.sales_id))) {
        salesSel.value = String(lead.sales_id);
    }
}

// Швидко створює ліда з назвою (решту можна дописати в «Лідах»)
async function createLeadQuick(name) {
    if (!name) return null;
    const me = currentStaff && hasRole(currentStaff, ["sales", "head"]) ? currentStaff : null;
    const { data, error } = await sbClient
        .from("leads")
        .insert([
            {
                name,
                status: "Новий",
                sales_id: me?.id || null,
                sales: me?.full_name || null,
                created_by: currentStaff?.full_name || null,
                history: [
                    {
                        at: new Date().toISOString(),
                        author: currentStaff?.full_name || "",
                        text: "Лід створено із запиту",
                        auto: true,
                    },
                ],
            },
        ])
        .select()
        .single();
    if (error) {
        alert("Не вдалося створити ліда: " + error.message);
        return null;
    }
    leadsCache.push(data);
    return data;
}

clientInput.addEventListener("input", () => {
    setSelectedLead(findLeadByName(clientInput.value));
    renderClientSuggest();
});
clientInput.addEventListener("focus", renderClientSuggest);
clientInput.addEventListener("blur", () => setTimeout(() => (clientBox.hidden = true), 150));
clientInput.addEventListener("keydown", (e) => {
    if (clientBox.hidden) return;
    if (e.key === "ArrowDown") {
        e.preventDefault();
        highlightClientOption(clientActiveIdx + 1);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlightClientOption(clientActiveIdx - 1);
    } else if (e.key === "Enter") {
        e.preventDefault(); // Enter у полі клієнта не відправляє форму
        const opts = clientBox.querySelectorAll(".client-option");
        chooseClientOption(opts[Math.max(clientActiveIdx, 0)]);
    } else if (e.key === "Escape") {
        e.stopPropagation();
        clientBox.hidden = true;
    }
});
clientBox.addEventListener("mousedown", (e) => {
    e.preventDefault(); // щоб поле не втратило фокус до кліку
    chooseClientOption(e.target.closest(".client-option"));
});

// Блок "Клієнт (лід)" у картці запиту
function leadSectionHtml(r) {
    const lead = leadById(r.lead_id) || findLeadByName(r.client);
    if (!lead) {
        return `
        <div class="card-section lead-in-request">
            <div class="card-section-title lead-in-request-title"><span><i class='bx bx-buildings'></i> Клієнт</span></div>
            <div class="card-block-text offer-muted">Клієнта немає в Лідах. Відкрийте «Редагувати» і оберіть клієнта зі списку.</div>
        </div>`;
    }
    const history = (Array.isArray(lead.history) ? lead.history : []).slice(-3).reverse();
    return `
        <div class="card-section lead-in-request">
            <div class="card-section-title lead-in-request-title">
                <span><i class='bx bx-buildings'></i> Клієнт: ${escapeHtml(lead.name)} ${leadStatusBadge(lead.status)}</span>
                <a class="btn-answer" href="leads.html?open=${lead.id}"><i class='bx bx-link-external'></i> Картка ліда</a>
            </div>
            <div class="lead-in-request-grid">
                ${cardRow("Контакт:", escapeHtml([lead.contact_person, lead.phone].filter(Boolean).join(", ")))}
                ${cardRow("Sales ліда:", escapeHtml(lead.sales))}
                ${cardRow("Місто:", escapeHtml([lead.city, lead.country].filter(Boolean).join(", ")))}
                ${cardRow("Наст. контакт:", formatDateOnly(lead.next_contact))}
            </div>
            ${
                history.length
                    ? `<div class="lead-in-request-history">${history
                          .map(
                              (h) => `<div><span>${formatDateTime(h.at)}</span> ${escapeHtml(h.text)}</div>`,
                          )
                          .join("")}</div>`
                    : ""
            }
        </div>`;
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
            hasRole(s, ["logist", "head"]) &&
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
    document.getElementById("req_type_picker").innerHTML = REQUEST_TYPES.filter((t) => !t.old || t.value === selected).map(
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
            r.customs_export_country,
            r.customs_import_country,
            (r.packaging || []).map((p) => p.type).join(" "),
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
            <td class="cell-person cell-logists">${logistListHtml(r)}</td>
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
    document.getElementById("req_customs_export_country").innerHTML = countryOptions;
    document.getElementById("req_customs_import_country").innerHTML = countryOptions;

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
    if (el) el.value = val === 0 ? "0" : val || "";
}

/* ---------- Пакування (кілька рядків) ---------- */
const packRowsBox = document.getElementById("req_pack_rows");

function packSelectHtml(selected) {
    const known = PACKAGING_GROUPS.some((g) => g.items.includes(selected));
    return `<select class="pack-type">
        <option value="">Виберіть...</option>
        ${PACKAGING_GROUPS.map(
            (g) => `<optgroup label="${escapeHtml(g.group)}">${g.items
                .map((i) => `<option value="${escapeHtml(i)}"${i === selected ? " selected" : ""}>${escapeHtml(i)}</option>`)
                .join("")}</optgroup>`,
        ).join("")}
        ${selected && !known ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>` : ""}
    </select>`;
}

function addPackRow(type = "", qty = "") {
    const row = document.createElement("div");
    row.className = "pack-row";
    row.innerHTML = `
        ${packSelectHtml(type)}
        <input type="number" class="pack-qty" min="1" step="1" placeholder="1" value="${escapeHtml(qty)}" />
        <span class="pack-unit">шт</span>
        <button type="button" class="pack-del" title="Прибрати"><i class='bx bx-x'></i></button>`;
    row.querySelector(".pack-del").addEventListener("click", () => {
        row.remove();
        if (!packRowsBox.children.length) addPackRow();
    });
    packRowsBox.appendChild(row);
}

function renderPackRows(list) {
    packRowsBox.innerHTML = "";
    (Array.isArray(list) && list.length ? list : [{}]).forEach((p) => addPackRow(p.type || "", p.qty ?? ""));
}

function readPackRows() {
    return [...packRowsBox.querySelectorAll(".pack-row")]
        .map((row) => ({
            type: row.querySelector(".pack-type").value,
            qty: Number(row.querySelector(".pack-qty").value) || null,
        }))
        .filter((p) => p.type);
}

document.getElementById("reqPackAddBtn").addEventListener("click", () => addPackRow());

/* ---------- Додаткові точки маршруту (кнопка «+») ---------- */
const EXTRA_KINDS = {
    loads: { col: "extra_loads", title: "Завантаження", ph: "Місто / адреса завантаження" },
    unloads: { col: "extra_unloads", title: "Розвантаження", ph: "Місто / адреса розвантаження" },
    customs_export: { col: "extra_customs_export", title: "Замитнення", ph: "Місто / село / індекс митниці" },
    customs_import: { col: "extra_customs_import", title: "Розмитнення", ph: "Місто / село / індекс митниці" },
};

function addExtraRow(kind, p = {}) {
    const box = document.getElementById(`req_extra_${kind}`);
    const cfg = EXTRA_KINDS[kind];
    const row = document.createElement("div");
    row.className = "extra-point";
    const countries =
        `<option value="">Оберіть країну...</option>` +
        REQUEST_COUNTRIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    row.innerHTML = `
        <div class="extra-point-head"><span></span>
            <button type="button" class="pack-del" title="Прибрати">×</button></div>
        <div class="customs-inputs">
            <select class="xp-country">${countries}</select>
            <input type="text" class="xp-address" placeholder="${escapeHtml(cfg.ph)}" />
        </div>`;
    box.appendChild(row);
    row.querySelector(".xp-country").value = p.country || "";
    row.querySelector(".xp-address").value = p.address || "";
    row.querySelector(".pack-del").addEventListener("click", () => {
        row.remove();
        numberExtraRows(kind);
    });
    if (window.furaAddressSuggest) {
        window.furaAddressSuggest(row.querySelector(".xp-address"), {
            countrySelect: row.querySelector(".xp-country"),
            mode: "full",
        });
    }
    numberExtraRows(kind);
    return row;
}

function numberExtraRows(kind) {
    const cfg = EXTRA_KINDS[kind];
    document.querySelectorAll(`#req_extra_${kind} .extra-point`).forEach((row, i) => {
        row.querySelector(".extra-point-head span").textContent = `${cfg.title} ${i + 2}`;
    });
}

function renderExtraRows(request) {
    Object.keys(EXTRA_KINDS).forEach((kind) => {
        document.getElementById(`req_extra_${kind}`).innerHTML = "";
        const list = request?.[EXTRA_KINDS[kind].col];
        (Array.isArray(list) ? list : []).forEach((p) => addExtraRow(kind, p));
    });
}

function readExtraRows(kind) {
    return [...document.querySelectorAll(`#req_extra_${kind} .extra-point`)]
        .map((row) => ({
            country: row.querySelector(".xp-country").value || null,
            address: row.querySelector(".xp-address").value.trim() || null,
        }))
        .filter((p) => p.country || p.address);
}

// Додаємо колонки в запис лише коли є що зберегти (або було раніше),
// щоб форма працювала і до запуску requests_points.sql
function extraFieldsFor(existing) {
    const out = {};
    Object.keys(EXTRA_KINDS).forEach((kind) => {
        const col = EXTRA_KINDS[kind].col;
        const list = readExtraRows(kind);
        if (list.length || (Array.isArray(existing?.[col]) && existing[col].length)) out[col] = list;
    });
    return out;
}

function extraPointsHtml(list) {
    return (Array.isArray(list) ? list : [])
        .map((p) => `<div class="extra-point-card">${locationCell(p.country, p.address)}</div>`)
        .join("");
}

document.querySelectorAll("[data-xadd]").forEach((btn) =>
    btn.addEventListener("click", () => addExtraRow(btn.dataset.xadd).querySelector(".xp-country").focus()),
);

/* ---------- Як можуть вантажити ---------- */
function renderLoadingChips(selected) {
    const sel = new Set(selected || []);
    document.getElementById("req_loading_types").innerHTML = LOADING_TYPES.map(
        (t) => `<label class="loading-chip"><input type="checkbox" value="${escapeHtml(t)}"${sel.has(t) ? " checked" : ""} /> ${escapeHtml(t)}</label>`,
    ).join("");
}
const readLoadingChips = () =>
    [...document.querySelectorAll("#req_loading_types input:checked")].map((i) => i.value);

/* ---------- Температура для РЕФ ---------- */
function updateTempVisibility() {
    document.getElementById("reqTempGroup").hidden = !isRef(document.getElementById("req_transport_type").value);
}

/* ---------- Тип транспорту: кілька типів причепів ---------- */
// Основні типи — кнопками; решта типів з реєстру перевізників — у списку «+ інший тип»
let registryTrailerTypes = [];
async function loadRegistryTrailerTypes() {
    try {
        const cached = JSON.parse(sessionStorage.getItem("fura_trailer_types") || "null");
        if (Array.isArray(cached) && cached.length) return (registryTrailerTypes = cached);
    } catch {
        /* немає пам'яті браузера */
    }
    const set = new Set();
    for (let from = 0; from < 50000; from += 1000) {
        const { data, error } = await sbClient.from("carriers").select("trailer_type").not("trailer_type", "is", null).range(from, from + 999);
        if (error || !data?.length) break;
        data.forEach((r) =>
            String(r.trailer_type)
                .split(/[;,]/)
                .map((t) => t.replace(/\(.*?\)/g, "").trim().toUpperCase())
                .filter((t) => t && t.length < 40)
                .forEach((t) => set.add(t)),
        );
        if (data.length < 1000) break;
    }
    registryTrailerTypes = [...set].sort((a, b) => a.localeCompare(b, "uk"));
    try {
        sessionStorage.setItem("fura_trailer_types", JSON.stringify(registryTrailerTypes));
    } catch {
        /* не страшно */
    }
    return registryTrailerTypes;
}

const splitTypes = (v) =>
    String(v || "")
        .split(/[;,]/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);

function renderTransportPicker() {
    const box = document.getElementById("req_transport_picker");
    const chosen = splitTypes(document.getElementById("req_transport_type").value);
    const main = [...new Set([...TRANSPORT_TYPES, ...chosen])];
    const others = registryTrailerTypes.filter((t) => !main.includes(t));
    box.innerHTML =
        main
            .map(
                (t) =>
                    `<label class="loading-chip"><input type="checkbox" value="${escapeHtml(t)}"${chosen.includes(t) ? " checked" : ""} /> ${escapeHtml(t)}</label>`,
            )
            .join("") +
        `<select class="transport-more" title="Інші типи з реєстру перевізників">
            <option value="">+ інший тип…</option>
            ${others.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
            <option value="__own">✎ ввести свій…</option>
        </select>`;
}

function syncTransportValue() {
    const vals = [...document.querySelectorAll("#req_transport_picker input:checked")].map((i) => i.value);
    document.getElementById("req_transport_type").value = vals.join("; ");
    updateTempVisibility();
}

document.getElementById("req_transport_picker").addEventListener("change", (e) => {
    if (e.target.matches("select.transport-more")) {
        let v = e.target.value;
        if (v === "__own") v = (prompt("Тип причепу:") || "").trim().toUpperCase();
        if (v) {
            const cur = splitTypes(document.getElementById("req_transport_type").value);
            if (!cur.includes(v)) cur.push(v);
            document.getElementById("req_transport_type").value = cur.join("; ");
            renderTransportPicker();
            updateTempVisibility();
        } else e.target.value = "";
        return;
    }
    syncTransportValue();
});

/* ---------- Замитнення / розмитнення "по місцю" ---------- */
function updateCustomsHere(kind) {
    const here = document.getElementById(`req_customs_${kind}_here`).checked;
    ["_country", ""].forEach((suf) => {
        const el = document.getElementById(`req_customs_${kind}${suf}`);
        el.disabled = here;
        if (here) el.value = "";
    });
}
["export", "import"].forEach((kind) =>
    document.getElementById(`req_customs_${kind}_here`).addEventListener("change", () => updateCustomsHere(kind)),
);

const CUSTOMS_HERE = "По місцю";

function setCustoms(kind, country, place) {
    const here = place === CUSTOMS_HERE;
    document.getElementById(`req_customs_${kind}_here`).checked = here;
    setVal(`req_customs_${kind}_country`, here ? "" : country);
    setVal(`req_customs_${kind}`, here ? "" : place);
    updateCustomsHere(kind);
}

function customsText(country, place, kind) {
    if (place === CUSTOMS_HERE) return kind === "export" ? "По місцю завантаження" : "По місцю розвантаження";
    if (!country && !place) return "";
    return locationCell(country, place);
}

function openRequestModal(request = null) {
    requestForm.reset();

    setVal("requestId", request ? request.id : "");
    setVal("req_client", request?.client);
    setSelectedLead(
        request ? leadById(request.lead_id) || findLeadByName(request.client) : null,
    );
    clientBox.hidden = true;
    loadLeadsList(); // свіжий список лідів (раптом хтось щойно додав)
    renderTypePicker(request?.request_type || "");
    setVal("req_cargo", request?.cargo);
    setVal("req_transport_type", splitTypes(request?.transport_type).join("; "));
    renderTransportPicker();
    setVal("req_weight", request?.weight);
    setVal("req_load_country", request?.load_country);
    setVal("req_load_address", request?.load_address);
    setVal("req_unload_country", request?.unload_country);
    setVal("req_unload_address", request?.unload_address);
    setCustoms("export", request?.customs_export_country, request?.customs_export);
    setVal("req_border_crossing", request?.border_crossing);
    setCustoms("import", request?.customs_import_country, request?.customs_import);
    setVal("req_status", request?.status || REQUEST_STATUSES[0].value);
    // Статус змінюється сам (запит → відповідь → в роботі). У формі — лише при редагуванні
    document.getElementById("reqStatusGroup").hidden = !request;
    renderPackRows(request?.packaging);
    renderExtraRows(request);
    renderLoadingChips(request?.loading_types);
    setVal("req_trucks_count", request?.trucks_count);
    setVal("req_trucks_period", request?.trucks_period);
    setVal("req_temp_from", request?.temp_from ?? "");
    setVal("req_temp_to", request?.temp_to ?? "");
    updateTempVisibility();
    // Sales: для нового запиту — той, хто зараз увійшов (якщо він Sales/Керівник)
    const defaultSalesId =
        !request && currentStaff && hasRole(currentStaff, ["sales", "head"])
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
        alert("Оберіть тип запиту: Прорахунок чи Пошук авто.");
        return;
    }

    // Клієнт має бути в Лідах
    const clientName = getValue("req_client");
    let lead = leadById(selectedLeadId) || findLeadByName(clientName);
    if (!lead) {
        if (
            !confirm(
                `Клієнта «${clientName}» немає в Лідах.\n\nСтворити нового ліда і зберегти запит?\n(Контакти клієнта можна буде дописати в розділі «Ліди».)`,
            )
        )
            return;
        lead = await createLeadQuick(clientName);
        if (!lead) return;
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
        client: lead.name,
        lead_id: lead.id,
        request_type: requestType,
        cargo: getValue("req_cargo"),
        transport_type: getValue("req_transport_type"),
        weight: getValue("req_weight"),
        load_country: getValue("req_load_country"),
        load_address: getValue("req_load_address"),
        unload_country: getValue("req_unload_country"),
        unload_address: getValue("req_unload_address"),
        customs_export: document.getElementById("req_customs_export_here").checked ? CUSTOMS_HERE : getValue("req_customs_export"),
        customs_export_country: getValue("req_customs_export_country"),
        border_crossing: getValue("req_border_crossing"),
        customs_import: document.getElementById("req_customs_import_here").checked ? CUSTOMS_HERE : getValue("req_customs_import"),
        customs_import_country: getValue("req_customs_import_country"),
        status: existing ? getValue("req_status") || existing.status : STATUS_NEW,
        packaging: readPackRows(),
        loading_types: readLoadingChips(),
        trucks_count: Number(getValue("req_trucks_count")) || null,
        trucks_period: getValue("req_trucks_period"),
        temp_from: isRef(getValue("req_transport_type")) && getValue("req_temp_from") !== null ? Number(getValue("req_temp_from")) : null,
        temp_to: isRef(getValue("req_transport_type")) && getValue("req_temp_to") !== null ? Number(getValue("req_temp_to")) : null,
        desired_date: dateFrom,
        desired_date_to: dateTo,
        sales: salesPick.name,
        sales_id: salesPick.id,
        ...logistFields,
        notes: getValue("req_notes"),
        ...extraFieldsFor(existing),
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

function packagingText(list) {
    if (!Array.isArray(list) || !list.length) return "";
    return list.map((p) => escapeHtml(`${p.type}${p.qty ? " — " + p.qty + " шт" : ""}`)).join("<br>");
}

function tempText(r) {
    const f = (v) => (v === null || v === undefined || v === "" ? null : `${Number(v) > 0 ? "+" : ""}${v}`);
    const a = f(r.temp_from), b = f(r.temp_to);
    if (a === null && b === null) return "";
    if (a !== null && b !== null) return `від ${a} до ${b} °C`;
    return a !== null ? `від ${a} °C` : `до ${b} °C`;
}

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

        ${leadSectionHtml(r)}

        ${answerSectionHtml(r)}

        ${window.furikReply ? window.furikReply.sectionHtml(r) : ""}

        ${window.furaBids ? window.furaBids.sectionHtml() : ""}

        ${chatSectionHtml(r)}

        <div class="card-columns">
            <div class="card-col">
                <div class="card-section">
                    <div class="card-section-title">Вантаж і транспорт</div>
                    ${cardRow("Вантаж:", escapeHtml(r.cargo))}
                    ${cardRow("Тип транспорту:", splitTypes(r.transport_type).map((t) => `<span class="badge badge-warning" style="margin-right:4px">${escapeHtml(t)}</span>`).join(""))}
                    ${cardRow("Вага:", escapeHtml(r.weight))}
                    ${cardRow("Пакування:", packagingText(r.packaging))}
                    ${isRef(r.transport_type) || r.temp_from !== null || r.temp_to !== null ? cardRow("Температура:", tempText(r)) : ""}
                    ${cardRow("Кількість авто:", r.trucks_count ? escapeHtml(`${r.trucks_count} авто${r.trucks_period ? " " + r.trucks_period : " (разово)"}`) : "")}
                    ${cardRow("Як вантажити:", (r.loading_types || []).length ? escapeHtml(r.loading_types.join(", ")) : "")}
                </div>

                <div class="card-section">
                    <div class="card-section-title">Маршрут</div>
                    ${cardRow("Відвантаження:", locationCell(r.load_country, r.load_address) + extraPointsHtml(r.extra_loads))}
                    ${cardRow("Розвантаження:", locationCell(r.unload_country, r.unload_address) + extraPointsHtml(r.extra_unloads))}
                </div>

                <div class="card-section">
                    <div class="card-section-title">Нотатки</div>
                    <div class="card-block-text">${notesHtml || "—"}</div>
                </div>
            </div>

            <div class="card-col">
                <div class="card-section">
                    <div class="card-section-title">Митниця та кордон</div>
                    ${cardRow("Замитнення:", customsText(r.customs_export_country, r.customs_export, "export") + extraPointsHtml(r.extra_customs_export))}
                    ${cardRow("Погран перехід:", escapeHtml(r.border_crossing))}
                    ${cardRow("Розмитнення:", customsText(r.customs_import_country, r.customs_import, "import") + extraPointsHtml(r.extra_customs_import))}
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


        <div id="routeMapBox" style="margin-top:16px"></div>
    `;

    document
        .querySelectorAll("#requestCardBody [data-choose]")
        .forEach((btn) =>
            btn.addEventListener("click", () =>
                chooseAnswer(
                    r.id,
                    btn.dataset.choose,
                    btn.dataset.offer !== undefined ? Number(btn.dataset.offer) : null,
                ),
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
    initRequestChat(r.id);
    window.furaBids?.mount(r); // ставки перевізників (bids.js)
    window.furikReply?.mount(r); // Фурик підкаже: ціни логісту, відповідь клієнту Sales (furik-reply.js)

    // Карта маршруту (route-map.js)
    window.furaRouteMap?.render(document.getElementById("routeMapBox"), r);
}

/* ================================================================= *
 * 8.1 ПЕРЕПИСКА ПО ЗАПИТУ (Sales ↔ логіст, дублюється в Telegram)    *
 * ================================================================= */

// Хто в переписці: до вибору — Sales і всі логісти запиту,
// після вибору — тільки Sales і обраний логіст
function chatPeople(r) {
    const ids = isChosen(r) ? [String(r.logistician_id)] : logistIdsOf(r);
    return [...new Set([String(r.sales_id || ""), ...ids].filter(Boolean))];
}

function canChat(r) {
    if (!currentStaff) return false;
    if (hasRole(currentStaff, ["head", "admin"])) return true;
    const me = String(currentStaff.id);
    if (chatPeople(r).includes(me)) return true;
    return !logistIdsOf(r).length && hasRole(currentStaff, ["logist"]);
}

function chatSectionHtml(r) {
    const chosen = isChosen(r);
    const title = chosen
        ? `Переписка: ${escapeHtml(r.sales || "Sales")} ↔ ${escapeHtml(r.logistician || "логіст")}`
        : logistIdsOf(r).length > 1
          ? "Переписка Sales ↔ логісти"
          : "Переписка Sales ↔ логіст";
    const hint = chosen
        ? `<div class="req-chat-hint"><i class='bx bx-lock-alt'></i> Обрано логіста — далі переписка тільки між Sales і ${escapeHtml(r.logistician || "обраним логістом")}.</div>`
        : "";
    const body = canChat(r)
        ? `<div class="req-chat-list" id="reqChatList"><div class="req-chat-empty">Завантаження…</div></div>
            <form class="req-chat-form" id="reqChatForm">
                <textarea id="reqChatText" rows="1" maxlength="2000" placeholder="Питання або уточнення по запиту… (Enter — надіслати, Shift+Enter — новий рядок)"></textarea>
                <button type="submit" class="req-chat-send" title="Надіслати"><i class='bx bx-send'></i> Надіслати</button>
            </form>`
        : `<div class="req-chat-empty">Sales обрав іншого логіста — переписка по цьому запиту тепер тільки з ним.</div>`;
    return `<div class="card-section req-chat" style="margin-top:16px">
            <div class="card-section-title"><i class='bx bx-chat'></i> ${title}</div>
            ${hint}${body}
        </div>`;
}

let chatMessages = [];
let chatRequestId = null;

function chatTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const today = new Date().toDateString() === d.toDateString();
    const t = d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
    return today ? t : `${d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })} ${t}`;
}

function renderChat() {
    const list = document.getElementById("reqChatList");
    if (!list) return;
    if (!chatMessages.length) {
        list.innerHTML = `<div class="req-chat-empty">Повідомлень ще немає. Поставте питання — його побачать Sales і логісти запиту (і в Telegram).</div>`;
        return;
    }
    const myId = String(currentStaff?.id || "");
    list.innerHTML = chatMessages
        .map((m) => {
            const mine = myId && String(m.author_id) === myId;
            return `<div class="req-msg${mine ? " mine" : ""}">
                <div class="req-msg-head"><b>${escapeHtml(m.author_name || "—")}</b>
                    <span>${chatTime(m.created_at)}${m.via === "telegram" ? " · Telegram" : ""}</span></div>
                <div class="req-msg-text">${escapeHtml(m.text)}</div>
            </div>`;
        })
        .join("");
    list.scrollTop = list.scrollHeight;
}

function addChatMessage(m) {
    if (!m || String(m.request_id) !== String(chatRequestId)) return false;
    if (chatMessages.some((x) => String(x.id) === String(m.id))) return true;
    chatMessages.push(m);
    chatMessages.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    renderChat();
    return true;
}
// notify.js викликає, коли приходить нове повідомлення
window.furaOnRequestMessage = (m) =>
    requestCardOverlay.classList.contains("active") && addChatMessage(m);

async function initRequestChat(requestId) {
    chatRequestId = requestId;
    chatMessages = [];
    const form = document.getElementById("reqChatForm");
    if (!form) return; // переписка не для цього користувача
    const ta = document.getElementById("reqChatText");

    const grow = () => {
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
    };
    ta.addEventListener("input", grow);
    ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            form.requestSubmit();
        }
    });
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text) return;
        const btn = form.querySelector("button");
        btn.disabled = true;
        const { data, error } = await sbClient
            .from("request_messages")
            .insert([{ request_id: requestId, text }])
            .select()
            .single();
        btn.disabled = false;
        if (error) {
            alert(
                /request_messages/.test(error.message || "")
                    ? "Переписка ще не увімкнена: потрібно один раз запустити request_messages.sql у Supabase."
                    : "Не вдалося надіслати: " + error.message,
            );
            return;
        }
        ta.value = "";
        grow();
        addChatMessage(data);
        ta.focus();
    });

    const { data, error } = await sbClient
        .from("request_messages")
        .select("*")
        .eq("request_id", requestId)
        .order("created_at", { ascending: true });
    if (chatRequestId !== requestId) return; // поки вантажили — відкрили інший запит
    if (error) {
        document.getElementById("reqChatList").innerHTML =
            `<div class="req-chat-empty">Переписка ще не увімкнена (потрібно запустити request_messages.sql у Supabase).</div>`;
        return;
    }
    chatMessages = data || [];
    renderChat();
}

function closeRequestCard() {
    requestCardOverlay.classList.remove("active");
    currentCardRequestId = null;
    window.furaBids?.unmount();
}

// Повторити запит: нова форма з тими самими даними (клієнт, маршрут, вантаж, авто, митниця).
// Дату, статус і відповіді логістів не копіюємо — це новий запит.
function repeatRequest(r) {
    const copy = { ...r, id: "", desired_date: null, desired_date_to: null, status: null };
    openRequestModal(copy);
    setVal("requestId", "");
    setVal("req_status", REQUEST_STATUSES[0].value);
    document.getElementById("reqStatusGroup").hidden = true;
    document.getElementById("requestModalTitle").textContent = "Повторити запит — вкажіть нову дату";
    dateFromInput.focus();
}

document
    .getElementById("repeatFromRequestCardBtn")
    .addEventListener("click", () => {
        const r = requestsCache.find((x) => String(x.id) === String(currentCardRequestId));
        closeRequestCard();
        if (r) repeatRequest(r);
    });

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

// opts: { chooseFor: logist_id — кнопка "Обрати" біля кожного варіанту,
//         chosenIndex: номер обраного варіанту (решту приглушуємо) }
function offerRowsHtml(offers, opts = {}) {
    const hasChosen = Number.isInteger(opts.chosenIndex);
    return offers
        .map((o, i) => {
            const chosen = hasChosen && opts.chosenIndex === i;
            const cls = chosen ? " offer-chosen" : hasChosen ? " offer-dim" : "";
            const btn = opts.chooseFor
                ? `<button type="button" class="btn-choose btn-choose-offer" data-choose="${escapeHtml(opts.chooseFor)}" data-offer="${i}"><i class='bx bx-check'></i> Обрати</button>`
                : chosen
                  ? `<span class="chosen-badge"><i class='bx bx-check-circle'></i> обрано</span>`
                  : "";
            return `
            <div class="offer-row${cls}">
                <span class="offer-num">${i + 1}</span>
                <div class="offer-price">${o.price ? `${escapeHtml(formatPrice(o.price))} ${escapeHtml(o.currency || "")}` : "—"}</div>
                <div class="offer-date">${offerDateHtml(o)}</div>
                <div class="offer-comment">${escapeHtml(o.comment || "")}${o.carrier ? `<div class="offer-carrier"><i class='bx bxs-truck'></i> ${o.carrier_id ? `<a href="index.html?open=${encodeURIComponent(o.carrier_id)}" target="_blank" rel="noopener" title="Відкрити картку перевізника">${escapeHtml(o.carrier)} <i class='bx bx-link-external'></i></a>` : escapeHtml(o.carrier)}</div>` : ""}</div>
                <div class="offer-action">${btn}</div>
            </div>`;
        })
        .join("");
}

// Який варіант обрав Sales (номер у списку логіста) — або null
function chosenOfferIndex(r, a) {
    const c = r?.chosen_offer;
    if (!c || !isChosen(r) || String(c.logist_id) !== String(a.logist_id)) return null;
    return Number.isInteger(c.index) ? c.index : null;
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
                  const offers = a.offers || [];
                  // Кілька варіантів — "Обрати" біля кожного; один або жодного — біля логіста
                  const perOffer = canChoose && a.logist_id && offers.length > 1;
                  const chooseBtn =
                      canChoose && a.logist_id && !perOffer
                          ? `<button type="button" class="btn-choose" data-choose="${escapeHtml(a.logist_id)}"${offers.length === 1 ? ' data-offer="0"' : ""}><i class='bx bx-check'></i> Обрати</button>`
                          : "";
                  return `
                <div class="answer-block ${chosen ? "answer-chosen" : ""}">
                    <div class="answer-block-head">
                        <span class="answer-logist"><i class='bx bx-user'></i> ${escapeHtml(a.logist || "Логіст")}</span>
                        ${a.at ? `<span class="answer-time">${formatDateTime(a.at)}</span>` : ""}
                        ${chosen ? `<span class="chosen-badge"><i class='bx bx-check-circle'></i> обрано</span>` : ""}
                        ${chooseBtn}
                    </div>
                    ${offers.length ? offerRowsHtml(offers, { chooseFor: perOffer ? a.logist_id : null, chosenIndex: chosen ? chosenOfferIndex(r, a) : null }) : ""}
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
async function chooseAnswer(requestId, logistId, offerIndex = null) {
    const r = requestsCache.find((x) => String(x.id) === String(requestId));
    if (!r) return;
    const a = getAnswers(r).find(
        (x) => String(x.logist_id) === String(logistId),
    );
    if (!a) return;
    const o = Number.isInteger(offerIndex) ? (a.offers || [])[offerIndex] : null;
    const what = o
        ? `варіант ${offerIndex + 1} логіста «${a.logist}»: ${o.price ? `${formatPrice(o.price)} ${o.currency || ""}` : "без ціни"}${o.date ? `, авто ${formatDesiredDate(o.date, o.date_to)}` : o.date_flexible ? ", плаваюча дата" : ""}`
        : `пропозицію логіста «${a.logist}»`;
    if (!confirm(`Обрати ${what}?\nСтатус зміниться на «${STATUS_CHOSEN}».`)) return;

    const update = {
        status: STATUS_CHOSEN,
        logistician_id: a.logist_id,
        logistician: a.logist,
    };
    if (o) {
        update.chosen_offer = {
            logist_id: a.logist_id,
            logist: a.logist,
            index: offerIndex,
            price: o.price ?? null,
            currency: o.currency || null,
            date: o.date || null,
            date_to: o.date_to || null,
            date_flexible: !!o.date_flexible,
            comment: o.comment || null,
            carrier: o.carrier || null,
            carrier_id: o.carrier_id || null,
            at: new Date().toISOString(),
        };
    }
    let { error } = await sbClient.from("requests").update(update).eq("id", r.id);
    if (error && update.chosen_offer && /chosen_offer/.test(error.message || "")) {
        // Колонку ще не додали (requests_chosen_offer.sql) — обираємо хоча б логіста
        delete update.chosen_offer;
        ({ error } = await sbClient.from("requests").update(update).eq("id", r.id));
        if (!error) alert("Логіста обрано. Щоб запам'ятовувався саме варіант ціни, запустіть requests_chosen_offer.sql у Supabase.");
    }
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

// Перевізник у варіанті: підказки з реєстру (можна вписати й того, кого там немає)
let carrierSuggestTimer = null;
document.getElementById("answerOptions").addEventListener("input", (e) => {
    const input = e.target.closest(".ans-carrier");
    if (!input) return;
    input.dataset.carrierId = ""; // змінили текст — зв'язок з реєстром скидаємо
    const list = input.parentElement.querySelector(".ans-carrier-list");
    const q = input.value.trim();
    clearTimeout(carrierSuggestTimer);
    if (q.length < 2) {
        list.hidden = true;
        return;
    }
    carrierSuggestTimer = setTimeout(async () => {
        const safe = q.replace(/[%,()]/g, " ").trim();
        const digits = safe.replace(/\D/g, "");
        const conds = [`name.ilike.%${safe}%`];
        if (digits.length >= 4) conds.push(`edrpou.ilike.%${digits}%`, `phone_1.ilike.%${digits}%`, `phone_2.ilike.%${digits}%`);
        const { data } = await sbClient
            .from("carriers")
            .select("id, name, edrpou, city, phone_1")
            .or(conds.join(","))
            .limit(8);
        if (input.value.trim() !== q) return; // поки шукали — ввели інше
        const rows = data || [];
        list.innerHTML = rows.length
            ? rows
                  .map(
                      (c) => `<button type="button" class="ans-carrier-item" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name || "")}">
                        <b>${escapeHtml(c.name || "—")}</b>
                        <span>${escapeHtml([c.edrpou, c.city, c.phone_1].filter(Boolean).join(" · "))}</span>
                    </button>`,
                  )
                  .join("")
            : `<div class="ans-carrier-none">У реєстрі не знайдено — збережеться як вписано</div>`;
        list.hidden = false;
    }, 250);
});

document.getElementById("answerOptions").addEventListener("click", (e) => {
    const item = e.target.closest(".ans-carrier-item");
    if (!item) return;
    const box = item.closest(".ans-carrier-box");
    const input = box.querySelector(".ans-carrier");
    input.value = item.dataset.name;
    input.dataset.carrierId = item.dataset.id;
    box.querySelector(".ans-carrier-list").hidden = true;
});

document.addEventListener("click", (e) => {
    if (!e.target.closest(".ans-carrier-box")) {
        document.querySelectorAll(".ans-carrier-list").forEach((l) => (l.hidden = true));
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

                <div class="form-group answer-carrier">
                    <label>Перевізник <span class="label-hint">— хто дав ціну / дає машину</span></label>
                    <div class="ans-carrier-box">
                        <input type="text" class="ans-carrier" autocomplete="off" value="${escapeHtml(o.carrier || "")}" data-carrier-id="${escapeHtml(o.carrier_id || "")}" placeholder="Почніть вводити назву, ЄДРПОУ або телефон" />
                        <div class="ans-carrier-list" hidden></div>
                    </div>
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
            const carrierInput = row.querySelector(".ans-carrier");
            const carrier = carrierInput.value.trim();
            const carrierId = carrier ? carrierInput.dataset.carrierId || "" : "";

            if (dateTo && !date) {
                dateError = `Варіант ${idx + 1}: вкажіть початкову дату періоду.`;
            } else if (dateTo && dateTo < date) {
                dateError = `Варіант ${idx + 1}: кінцева дата раніше за початкову.`;
            }
            if (dateTo === date) dateTo = "";

            if (price || date || comment || carrier) {
                offers.push({
                    price,
                    currency,
                    date: date || null,
                    date_to: dateTo || null,
                    comment,
                    carrier: carrier || null,
                    carrier_id: carrierId || null,
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

    await Promise.all([loadStaff(session), loadLeadsList()]);
    fillSelects();
    buildFilterIcons();
    updateDateRangeUI();
    setupScrollTopButton();
    searchInput?.addEventListener("input", renderRequests);
    // requests.html?open=<id> — одразу картка запиту (посилання з бота й AI-помічника)
    const openRequestId = new URLSearchParams(location.search).get("open");
    loadRequests().then(() => {
        if (openRequestId) openRequestCard(openRequestId);
    });
    renderTransportPicker();
    // Типи причепів з реєстру перевізників — для списку «+ інший тип»
    loadRegistryTrailerTypes().then(() => {
        if (document.getElementById("requestModalOverlay")?.classList.contains("active")) renderTransportPicker();
    });

    // Кожну хвилину підтягуємо нові запити від Sales і оновлюємо таймери
    setInterval(loadRequests, 60 * 1000);

    // Перехід з картки ліда: requests.html?new_client=Назва — одразу форма нового запиту
    const params = new URLSearchParams(location.search);
    const newLead = leadById(params.get("new_lead"));
    const newClient = params.get("new_client");
    if (params.get("new") === "1" && !newLead && !newClient) {
        openRequestModal();
        history.replaceState(null, "", location.pathname);
    }
    if (newLead || newClient) {
        openRequestModal();
        if (newLead) pickLead(newLead);
        else {
            setVal("req_client", newClient);
            setSelectedLead(findLeadByName(newClient));
        }
        history.replaceState(null, "", location.pathname);
    }
});
