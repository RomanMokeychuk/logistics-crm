/* ================================================================= *
 * 1. ІНІЦІАЛІЗАЦІЯ SUPABASE ТА ЕЛЕМЕНТІВ ІНТЕРФЕЙСА                 *
 * ================================================================= */

const SUPABASE_URL = "https://prbfscwmemshwigiftha.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";

var sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Функція для виходу з акаунта
async function logout() {
    await sbClient.auth.signOut();
    window.location.href = "login.html";
}

// Глобальні змінні для сортування та кешування
let currentSortColumn = null;
let currentSortAscending = true;
let allCarriersCache = []; // Кеш даних для фільтрів стовпців
let activeFilterColumn = null;
let activeFiltersState = {}; // Стан активних фільтрів по колонках

// Список областей України — використовується для випадаючого меню
// "Напрямки в Україні" (і має ті самі назви, що й "Область України").
const UKRAINE_OBLASTS = [
    "ВІННИЦЬКА ОБЛ.",
    "ВОЛИНСЬКА ОБЛ.",
    "ДНІПРОПЕТРОВСЬКА ОБЛ.",
    "ДОНЕЦЬКА ОБЛ.",
    "ЖИТОМИРСЬКА ОБЛ.",
    "ЗАКАРПАТСЬКА ОБЛ.",
    "ЗАПОРІЗЬКА ОБЛ.",
    "ІВАНО-ФРАНКІВСЬКА ОБЛ.",
    "КИЇВСЬКА ОБЛ.",
    "КІРОВОГРАДСЬКА ОБЛ.",
    "ЛУГАНСЬКА ОБЛ.",
    "ЛЬВІВСЬКА ОБЛ.",
    "МИКОЛАЇВСЬКА ОБЛ.",
    "ОДЕСЬКА ОБЛ.",
    "ПОЛТАВСЬКА ОБЛ.",
    "РІВНЕНСЬКА ОБЛ.",
    "СУМСЬКА ОБЛ.",
    "ТЕРНОПІЛЬСЬКА ОБЛ.",
    "ХАРКІВСЬКА ОБЛ.",
    "ХЕРСОНСЬКА ОБЛ.",
    "ХМЕЛЬНИЦЬКА ОБЛ.",
    "ЧЕРКАСЬКА ОБЛ.",
    "ЧЕРНІВЕЦЬКА ОБЛ.",
    "ЧЕРНІГІВСЬКА ОБЛ.",
    "М. КИЇВ",
];

// Список країн (закордонні напрямки) — для випадаючого меню.
const COUNTRIES = [
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

const modalOverlay = document.getElementById("modalOverlay");
const openModalBtn = document.getElementById("openModalBtn");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelBtn = document.getElementById("cancelBtn");
const addCarrierForm = document.getElementById("addCarrierForm");
const carriersTableBody = document.getElementById("carriersTableBody");
const searchInput = document.getElementById("searchInput");
// Опціональні "швидкі" фільтри (можуть бути відсутні в розмітці — тоді просто ігноруються)
const filterTrailer = document.getElementById("filterTrailer");
const filterRegion = document.getElementById("filterRegion");

if (openModalBtn)
    openModalBtn.addEventListener("click", () => {
        resetForm();
        modalOverlay.classList.add("active");
    });

const closeModal = () => modalOverlay.classList.remove("active");
if (closeModalBtn) closeModalBtn.addEventListener("click", closeModal);
if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

// Закриття модалки по кліку на затемнений фон (за межами білого вікна)
if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
        if (e.target === modalOverlay) closeModal();
    });
}

// ПРИВ'ЯЗКА ФІЛЬТРІВ І ПОШУКУ
if (searchInput) {
    searchInput.addEventListener("input", () => loadCarriers());
}
if (filterTrailer) {
    filterTrailer.addEventListener("change", () => loadCarriers());
}
if (filterRegion) {
    filterRegion.addEventListener("change", () => loadCarriers());
}

// Закриваємо випадаюче вікно фільтра по кліку будь-де поза ним
document.addEventListener("click", () => {
    const dropdown = document.getElementById("columnFilterDropdown");
    if (dropdown && dropdown.style.display === "block") {
        closeColumnFilter();
    }
});

// Esc закриває картку перевізника
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCarrierCard();
});

/*/ Завантажуємо дані при відкритті сторінки
document.addEventListener("DOMContentLoaded", () => {
    loadCarriers();
    setupScrollTopButton();
    renderDirectionSelects();
});*/

// Завантажуємо дані при відкритті сторінки + Перевірка авторизації
document.addEventListener("DOMContentLoaded", async () => {
    const {
        data: { session },
    } = await sbClient.auth.getSession();

    // Якщо користувач не залогінений — перенаправляємо на login.html
    if (!session) {
        window.location.href = "login.html";
        return;
    }

    loadCarriers();
    setupScrollTopButton();
    renderDirectionSelects();
});

/* ================================================================= *
 * 1.1 ДОПОМІЖНІ ФУНКЦІЇ ВІДОБРАЖЕННЯ                                *
 * ================================================================= */

// Формує рядок "Ім'я: телефон [іконка Viber]".
// Іконка веде на viber://chat?number=... — це ВІДКРИВАЄ ЧАТ у Viber
// (можна побачити ім'я/фото профілю), а не одразу дзвонить.
function renderContactLine(person, phone) {
    if (!person) return "";
    const digitsOnly = (phone || "").replace(/\D/g, "");
    const viberIcon = digitsOnly
        ? `<a href="viber://chat?number=%2B${digitsOnly}" target="_blank" class="viber-link" title="Відкрити чат у Viber"><i class='bx bxs-message-rounded-dots'></i></a>`
        : "";
    return `<strong>${escapeHtml(person)}:</strong> ${escapeHtml(phone || "")} ${viberIcon}`;
}

// Формує HTML для круглого аватара перевізника. Якщо URL фото не вказаний
// або картинка не завантажилась (бите посилання) — показуємо заглушку-іконку.
function renderAvatar(logoUrl) {
    if (!logoUrl) {
        return `<div class="carrier-avatar-placeholder" title="Фото не додано"><i class='bx bx-car'></i></div>`;
    }
    const safeUrl = escapeHtml(logoUrl);
    return `<img src="${safeUrl}" class="carrier-avatar" alt="Фото перевізника"
                onerror="this.onerror=null; this.outerHTML='<div class=\\'carrier-avatar-placeholder\\' title=\\'Фото не завантажилось\\'><i class=\\'bx bx-image-alt\\'></i></div>';">`;
}

// Форматує ISO-дату у зручний вигляд "28.09.2026, 15:42" для відображення
// часу останньої зміни заміток.
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

// Формує іконку-посилання на зовнішній профіль перевізника (Lardi-Trans тощо).
function renderProfileLink(profileUrl) {
    if (!profileUrl) return "";
    const safeUrl = escapeHtml(profileUrl);
    return `<a href="${safeUrl}" target="_blank" rel="noopener" class="profile-link-icon" title="Відкрити профіль"><i class='bx bx-link-external'></i></a>`;
}

/* ================================================================= *
 * 1.2 КНОПКА "НАВЕРХ" ДЛЯ СПИСКУ ПЕРЕВІЗНИКІВ                       *
 * ================================================================= */

function setupScrollTopButton() {
    const scrollArea = document.getElementById("tableScrollArea");
    const btn = document.getElementById("scrollTopBtn");
    if (!scrollArea || !btn) return;

    scrollArea.addEventListener("scroll", () => {
        if (scrollArea.scrollTop > 200) {
            btn.classList.add("visible");
        } else {
            btn.classList.remove("visible");
        }
    });

    btn.addEventListener("click", () => {
        scrollArea.scrollTo({ top: 0, behavior: "smooth" });
    });
}

/* ================================================================= *
 * 1.3 ЗГОРТАННЯ/РОЗГОРТАННЯ ЛІВОЇ БІЧНОЇ ПАНЕЛІ                     *
 * ================================================================= */

function toggleSidebar() {
    document.body.classList.toggle("sidebar-collapsed");

    const icon = document.querySelector("#sidebarToggleBtn i");
    if (icon) {
        icon.classList.toggle("bx-chevron-left");
        icon.classList.toggle("bx-chevron-right");
    }
}

/* ================================================================= *
 * 1.4 МОДАЛЬНЕ ВІКНО "ШЛЯХ" — ПЕРЕВІРКА ТРАНСПОРТНИХ ЗАСОБІВ         *
 * ================================================================= */

const shlyahModalOverlay = document.getElementById("shlyahModalOverlay");
const closeShlyahModalBtn = document.getElementById("closeShlyahModalBtn");
const shlyahIframe = document.getElementById("shlyahIframe");
const shlyahBackBtn = document.getElementById("shlyahBackBtn");
const SHLYAH_URL = "https://shlyah.dsbt.gov.ua/lc.html";

function resetShlyahIframe() {
    if (shlyahIframe) shlyahIframe.src = SHLYAH_URL;
}

function openShlyahModal() {
    if (shlyahModalOverlay) shlyahModalOverlay.classList.add("active");
    resetShlyahIframe(); // щоразу відкриваємо чисту форму пошуку
}

function closeShlyahModal() {
    if (shlyahModalOverlay) shlyahModalOverlay.classList.remove("active");
}

if (shlyahBackBtn) shlyahBackBtn.addEventListener("click", resetShlyahIframe);

if (closeShlyahModalBtn)
    closeShlyahModalBtn.addEventListener("click", closeShlyahModal);

if (shlyahModalOverlay) {
    shlyahModalOverlay.addEventListener("click", (e) => {
        if (e.target === shlyahModalOverlay) closeShlyahModal();
    });
}

/* ================================================================= *
 * 1.5 КАРТКА ПЕРЕВІЗНИКА (відкривається кліком по рядку в таблиці)   *
 * ================================================================= */

const carrierCardOverlay = document.getElementById("carrierCardOverlay");
let currentCardCarrierId = null;

if (carrierCardOverlay) {
    carrierCardOverlay.addEventListener("click", (e) => {
        if (e.target === carrierCardOverlay) closeCarrierCard();
    });
}

function closeCarrierCard() {
    if (carrierCardOverlay) carrierCardOverlay.classList.remove("active");
    currentCardCarrierId = null;
}

// Редагувати з картки: закриваємо картку і відкриваємо форму редагування
function editFromCard() {
    const id = currentCardCarrierId;
    closeCarrierCard();
    if (id) editCarrier(id);
}

// Один рядок "підпис — значення" в картці
function cardRow(label, valueHtml) {
    return `
        <div class="card-row">
            <div class="card-row-label">${label}</div>
            <div class="card-row-value">${valueHtml || "—"}</div>
        </div>`;
}

// Формує відображення країн та їхніх квадратиків/воєводств у картці перевізника
function renderDestinationsHtml(str) {
    if (!str) return "—";
    return str
        .split(";")
        .map((pair) => {
            const dashIndex = pair.indexOf("-");
            const country = escapeHtml(
                dashIndex !== -1
                    ? pair.substring(0, dashIndex).trim()
                    : pair.trim(),
            );
            const region = escapeHtml(
                dashIndex !== -1 ? pair.substring(dashIndex + 1).trim() : "",
            );

            if (country && region) {
                return `
                <div style="margin-bottom: 8px;">
                    <div><span class="badge-country">${country}</span></div>
                    <div style="font-size: 13px; color: #475569; margin-top: 2px; padding-left: 2px;">
                        <strong>Квадрат / Воєводство:</strong> ${region}
                    </div>
                </div>`;
            } else if (country) {
                return `
                <div style="margin-bottom: 8px;">
                    <span class="badge-country">${country}</span>
                </div>`;
            }
            return "";
        })
        .join("");
}

function renderListBadges(str, badgeClass) {
    if (!str) return "";
    return str
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(
            (s) =>
                `<div class="card-badge-line"><span class="${badgeClass}">${escapeHtml(s)}</span></div>`,
        )
        .join("");
}

function openCarrierCard(id) {
    const item = allCarriersCache.find((c) => String(c.id) === String(id));
    if (!item || !carrierCardOverlay) return;

    currentCardCarrierId = item.id;

    const name = escapeHtml(item.name || item.company || "—");
    const locationText = [item.city, item.region_ukr]
        .filter(Boolean)
        .map(escapeHtml)
        .join(", ");

    // Зірочки рейтингу (тільки для перегляду)
    const rating = item.rating || 0;
    let starsHtml = `<div class="card-stars">`;
    for (let i = 1; i <= 5; i++) {
        starsHtml += `<i class='bx bxs-star ${i <= rating ? "active" : ""}'></i>`;
    }
    starsHtml += `</div>`;

    // Контакти
    let contactsHtml = "";
    if (item.contact_person_1) {
        contactsHtml += `<div style="margin-bottom:6px;">${renderContactLine(item.contact_person_1, item.phone_1)}</div>`;
    }
    if (item.contact_person_2) {
        contactsHtml += `<div>${renderContactLine(item.contact_person_2, item.phone_2)}</div>`;
    }

    // Нотатки
    const notesHtml = item.notes
        ? `<div style="white-space:pre-wrap; word-break:break-word;">${escapeHtml(item.notes)}</div>` +
          (item.notes_updated_at
              ? `<small style="color:#94a3b8; font-size:11px;">Востаннє змінено: ${formatDateTime(item.notes_updated_at)}</small>`
              : "")
        : "";

    const trailersHtml = item.trailer_type
        ? item.trailer_type
              .split(";")
              .map((t) => t.trim())
              .filter(Boolean)
              .map(
                  (t) =>
                      `<span class="badge badge-warning" style="margin-right:4px;">${escapeHtml(t)}</span>`,
              )
              .join("")
        : "";

    const body = document.getElementById("carrierCardBody");
    if (!body) return;

    body.innerHTML = `
        <div class="card-header-block">
            <div class="card-avatar-wrap">${renderAvatar(item.logo_url)}</div>
            <div class="card-header-info">
                <div class="card-title">
                    ${name}
                    ${renderProfileLink(item.profile_url)}
                </div>
                <div class="card-subtitle">${locationText || "Місцезнаходження не вказано"}</div>
                <div class="card-header-badges">
                    <span class="card-rating-badge"><i class='bx bxs-star'></i> ${rating ? rating : "—"}</span>
                    ${starsHtml}
                </div>
            </div>
        </div>

        <div class="card-columns">
            <div class="card-col">
                <div class="card-section">
                    <div class="card-section-title">Реєстраційні дані</div>
                    ${cardRow("Найменування:", name)}
                    ${cardRow("ЄДРПОУ / ІПН:", item.edrpou ? `<code>${escapeHtml(item.edrpou)}</code>` : "")}
                    ${cardRow("Область:", escapeHtml(item.region_ukr || ""))}
                    ${cardRow("Місто / Адреса:", escapeHtml(item.city || ""))}
                    
                </div>

                <div class="card-section">
                    <div class="card-section-title">Контакти</div>
                    <div class="card-block-text">${contactsHtml || "—"}</div>
                </div>

                <div class="card-section">
                    <div class="card-section-title">Замітки</div>
                    <div class="card-block-text">${notesHtml || "—"}</div>
                </div>
            </div>

            <div class="card-col">
                <div class="card-section">
                    <div class="card-section-title">Автопарк</div>
                    ${cardRow("Тип причепу:", trailersHtml)}
                    ${cardRow("Об'єм:", item.volume ? escapeHtml(item.volume) + " м³" : "")}
                    ${cardRow("Тоннаж:", item.tonnage ? escapeHtml(item.tonnage) + " т" : "")}
                    ${cardRow("Додатково:", item.additional ? `<span style="color:#0284c7;">${escapeHtml(item.additional)}</span>` : "")}
                </div>

                <div class="card-section">
                    <div class="card-section-title">Напрямки діяльності</div>
                    ${cardRow("Закордон:", renderDestinationsHtml(item.destinations))}
                    ${cardRow("В Україні:", renderListBadges(item.ukraine_directions, "badge-country"))}
                </div>
            </div>
        </div>
    `;

    carrierCardOverlay.classList.add("active");
}

/* ================================================================= *
 * 2. ЗАВАНТАЖЕННЯ ТА ВІДОБРАЖЕННЯ ПЕРЕВІЗНИКІВ У ТАБЛИЦІ              *
 * ================================================================= */

async function loadCarriers() {
    const searchQuery = searchInput?.value.trim() || "";
    const trailerFilterVal = filterTrailer?.value || "";
    const regionFilterVal = filterRegion?.value || "";

    let request = sbClient.from("carriers").select("*");

    // Деякі колонки в таблиці — "віртуальні" (склеєні з кількох полів на льоту:
    // назва+ЄДРПОУ, місто+область, контакт+телефон). Такого поля немає в базі,
    // тому просити Supabase відсортувати по ньому — помилка. Для них сортуємо
    // вручну в JS нижче, а тут просто лишаємо звичайний порядок.
    const virtualSortColumns = ["carrier_col", "location_col", "contacts_col"];

    // Застосовуємо сортування через Supabase (тільки для реальних колонок)
    if (currentSortColumn && !virtualSortColumns.includes(currentSortColumn)) {
        request = request.order(currentSortColumn, {
            ascending: currentSortAscending,
        });
    } else {
        request = request.order("created_at", { ascending: false });
    }

    const { data, error } = await request;

    if (error) {
        console.error("Помилка завантаження:", error);
        return;
    }

    // Зберігаємо в кеш для роботи випадаючих фільтрів по стовпцях і для картки
    allCarriersCache = data || [];

    if (!carriersTableBody) return;
    carriersTableBody.innerHTML = "";

    if (!data || data.length === 0) {
        carriersTableBody.innerHTML = `<tr><td colspan="13" style="text-align: center; color: #94a3b8; padding: 20px;">Записи не знайдені</td></tr>`;
        updateCarriersCountBar(0, 0);
        return;
    }

    // JS-фільтрація
    let filteredData = data.filter((item) => {
        const name = (item.name || item.company || "").toLowerCase();
        const edrpou = (item.edrpou || "").toLowerCase();
        const destinations = (item.destinations || "").toLowerCase();
        const city = (item.city || "").toLowerCase();
        const fleet = (item.fleet_params || "").toLowerCase();
        const trailerType = (item.trailer_type || "").toLowerCase();
        const regionUkr = (item.region_ukr || "").toLowerCase();
        const quadrant = (item.quadrant || "").toLowerCase();
        const notes = (item.notes || "").toLowerCase();
        const ukraineDirections = (item.ukraine_directions || "").toLowerCase();

        // Пошук за загальним рядком
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const matchesSearch =
                name.includes(query) ||
                edrpou.includes(query) ||
                destinations.includes(query) ||
                city.includes(query) ||
                fleet.includes(query) ||
                trailerType.includes(query) ||
                quadrant.includes(query) ||
                notes.includes(query) ||
                ukraineDirections.includes(query);
            if (!matchesSearch) return false;
        }

        // Фільтр за типом причепа з загального селекта
        if (trailerFilterVal) {
            if (!trailerType.includes(trailerFilterVal.toLowerCase())) {
                return false;
            }
        }

        // Фільтр за областю з загального селекта
        if (regionFilterVal) {
            if (!regionUkr.includes(regionFilterVal.toLowerCase())) {
                return false;
            }
        }

        // Динамічні фільтри за конкретними стовпцями (через іконку фільтра у заголовку)
        for (const [colKey, selectedVals] of Object.entries(
            activeFiltersState,
        )) {
            let itemVal = String(item[colKey] || "").toLowerCase();
            if (colKey === "carrier_col") {
                itemVal = `${name} ${edrpou}`;
            } else if (colKey === "location_col") {
                itemVal = `${city} ${regionUkr}`;
            } else if (colKey === "contacts_col") {
                itemVal =
                    `${item.contact_person_1 || ""} ${item.phone_1 || ""} ${item.contact_person_2 || ""} ${item.phone_2 || ""}`.toLowerCase();
            } else if (colKey === "rating") {
                itemVal = item.rating
                    ? `${item.rating} ★`.toLowerCase()
                    : "без оцінки";
            } else if (!itemVal && colKey === "company" && item.name) {
                itemVal = String(item.name).toLowerCase();
            }

            const matchesCol = selectedVals.some((val) =>
                itemVal.includes(val.toLowerCase()),
            );
            if (!matchesCol) return false;
        }

        return true;
    });

    // Локальне сортування
    if (currentSortColumn) {
        filteredData.sort((a, b) => {
            let valA = "";
            let valB = "";

            // Визначаємо, як формувати текст для сортування залежно від колонки
            if (currentSortColumn === "carrier_col") {
                valA = (a.edrpou ? a.edrpou : a.name || a.company || "")
                    .toString()
                    .trim()
                    .toLowerCase();
                valB = (b.edrpou ? b.edrpou : b.name || b.company || "")
                    .toString()
                    .trim()
                    .toLowerCase();
            } else if (currentSortColumn === "location_col") {
                valA = `${a.city || ""} ${a.region_ukr || ""}`
                    .trim()
                    .toLowerCase();
                valB = `${b.city || ""} ${b.region_ukr || ""}`
                    .trim()
                    .toLowerCase();
            } else if (currentSortColumn === "contacts_col") {
                valA = `${a.contact_person_1 || ""} ${a.phone_1 || ""}`
                    .trim()
                    .toLowerCase();
                valB = `${b.contact_person_1 || ""} ${b.phone_1 || ""}`
                    .trim()
                    .toLowerCase();
            } else if (currentSortColumn === "rating") {
                // Рейтинг сортуємо як число, а не як текст
                return currentSortAscending
                    ? (a.rating || 0) - (b.rating || 0)
                    : (b.rating || 0) - (a.rating || 0);
            } else {
                valA = (a[currentSortColumn] || "").toString().toLowerCase();
                valB = (b[currentSortColumn] || "").toString().toLowerCase();
            }

            return currentSortAscending
                ? valA.localeCompare(valB, "uk", { numeric: true })
                : valB.localeCompare(valA, "uk", { numeric: true });
        });
    }

    updateCarriersCountBar(filteredData.length, allCarriersCache.length);

    if (filteredData.length === 0) {
        carriersTableBody.innerHTML = `<tr><td colspan="13" style="text-align: center; color: #94a3b8; padding: 20px;">Записи не знайдені за заданими критеріями</td></tr>`;
        return;
    }

    filteredData.forEach((item, index) => {
        const row = document.createElement("tr");
        row.classList.add("clickable-row");
        row.title = "Натисніть, щоб відкрити картку перевізника";
        const rowNumber = index + 1; // порядковий номер у поточному (відфільтрованому/відсортованому) списку

        // Клік по рядку відкриває картку (крім кліків по кнопках, посиланнях, зірочках)
        row.addEventListener("click", (e) => {
            if (
                e.target.closest(
                    "a, button, .star-rating, input, select, textarea",
                )
            )
                return;
            openCarrierCard(item.id);
        });

        // 1. Напрямки (закордон)
        let destBadges = "—";
        if (item.destinations) {
            destBadges = item.destinations
                .split(";")
                .map((pair) => {
                    const dashIndex = pair.indexOf("-");
                    const country =
                        dashIndex !== -1
                            ? pair.substring(0, dashIndex).trim()
                            : pair.trim();
                    const region =
                        dashIndex !== -1
                            ? pair.substring(dashIndex + 1).trim()
                            : "";

                    if (country && region) {
                        return `
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                          <span class="badge-country">${country}</span>
                          <span style="font-size: 13px; color: #475569; font-weight: 500;">— ${region}</span>
                        </div>`;
                    } else if (country) {
                        return `
                        <div style="margin-bottom: 4px;">
                          <span class="badge-country">${country}</span>
                        </div>`;
                    }
                    return "";
                })
                .join("");
        }

        // 1.1 Напрямки в Україні (області)
        let ukraineBadges = "—";
        if (item.ukraine_directions) {
            ukraineBadges = item.ukraine_directions
                .split(";")
                .map((oblast) => {
                    const trimmed = oblast.trim();
                    return trimmed
                        ? `<div style="margin-bottom: 4px;"><span class="badge-country">${trimmed}</span></div>`
                        : "";
                })
                .join("");
        }

        // 2. Оцінка (зірочки)
        let starsHtml = `<div class="star-rating">`;
        const currentRating = item.rating || 0;
        for (let i = 1; i <= 5; i++) {
            const activeClass = i <= currentRating ? "active" : "";
            starsHtml += `<i class='bx bxs-star ${activeClass}' onclick="updateCarrierRating('${item.id}', ${i})" title="Оцінка: ${i}"></i>`;
        }
        starsHtml += `</div>`;

        // 3. Заметки — показуємо повний текст одразу, з переносом рядків у межах стовпця,
        // а під ним, якщо є, — дату/час останньої зміни цієї заміти.
        const notesFull = item.notes || "";
        const notesTimestampHtml =
            notesFull && item.notes_updated_at
                ? `<br><small style="color:#94a3b8; font-size:11px;">${formatDateTime(item.notes_updated_at)}</small>`
                : "";

        // 4. Аватар та посилання на профіль
        const avatarHtml = renderAvatar(item.logo_url);
        const profileLinkHtml = renderProfileLink(item.profile_url);

        row.innerHTML = `
        <td style="text-align: center; color: #94a3b8; font-size: 13px;">${rowNumber}</td>
        <td>${avatarHtml}</td>
        <td>${destBadges}</td>
        <td>
          <div class="carrier-name-line"><strong>${escapeHtml(item.name || item.company || "—")}</strong>${profileLinkHtml}</div>
          <div class="carrier-edrpou-line"><code>${escapeHtml(item.edrpou || "—")}</code></div>
        </td>
        <td>${item.region_ukr || "—"}</td>
        <td>${item.city || "—"}</td>
        <td>
          ${item.contact_person_1 ? renderContactLine(item.contact_person_1, item.phone_1) : ""}
          ${item.contact_person_2 ? `<br>` + renderContactLine(item.contact_person_2, item.phone_2) : ""}
          ${!item.contact_person_1 && !item.contact_person_2 ? "—" : ""}
        </td>
        <td>
          ${
              item.trailer_type
                  ? item.trailer_type
                        .split(";")
                        .map((itemStr) => {
                            const trimmed = itemStr.trim();
                            return trimmed
                                ? `<div style="margin-bottom: 4px;"><span class="badge badge-warning">${trimmed}</span></div>`
                                : "";
                        })
                        .join("")
                  : "—"
          }
        </td>
        <td>
          <small><strong>Объем:</strong> ${item.volume || "—"} м³</small><br>
          <small><strong>Тоннаж:</strong> ${item.tonnage || "—"} т</small><br>
          <span style="color: #0284c7;">${item.additional || ""}</span>
        </td>
        <td>${ukraineBadges}</td>
        <td>${starsHtml}</td>
        <td style="max-width: 220px; white-space: normal; word-break: break-word;">${escapeHtml(notesFull) || "—"}${notesTimestampHtml}</td>
        <td>
          <button class="btn-icon" onclick="editCarrier('${item.id}')" title="Редактировать"><i class='bx bx-edit'></i></button>
          <button class="btn-icon text-danger" onclick="deleteCarrier('${item.id}')" title="Удалить"><i class='bx bx-trash'></i></button>
        </td>
    `;

        carriersTableBody.appendChild(row);
    });
}

// Оновлює текст лічильника внизу зліва під таблицею. Якщо застосовані
// фільтри/пошук і показано менше записів, ніж всього в базі — показуємо
// обидва числа ("Показано: X з Y"), інакше просто загальну кількість.
function updateCarriersCountBar(shownCount, totalCount) {
    const bar = document.getElementById("carriersCountBar");
    if (!bar) return;

    if (totalCount === 0) {
        bar.textContent = "Перевізників немає";
    } else if (shownCount === totalCount) {
        bar.textContent = `Перевізників: ${totalCount}`;
    } else {
        bar.textContent = `Показано: ${shownCount} з ${totalCount}`;
    }
}

/* ================================================================= *
 * 2.1 ЗГОРНУТИЙ/РОЗГОРНУТИЙ ВИГЛЯД КОЛОНКИ "ПЕРЕВІЗНИК / ЕДРПОУ"     *
 * ================================================================= */

function toggleCarrierColumn() {
    const table = document.querySelector("#tableScrollArea table");
    if (!table) return;
    table.classList.toggle("carrier-collapsed");

    const icon = document.getElementById("carrierToggleIcon");
    if (icon) icon.classList.toggle("active");
}

/* ================================================================= *
 * 3. ДИНАМІЧНІ ПРИЧЕПИ                                              *
 * ================================================================= */

function addTrailerRow(type = "") {
    const container = document.getElementById("trailersContainer");
    if (!container) return;

    const rowDiv = document.createElement("div");
    rowDiv.className = "trailer-row";
    rowDiv.style.cssText =
        "display: inline-flex; align-items: center; gap: 4px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 3px 4px 3px 10px;";

    rowDiv.innerHTML = `
    <input type="text" class="input-trailer-type" value="${escapeHtml(type)}" placeholder="Тип причепа" style="width: 100px; border: none; background: transparent; outline: none; font-size: 13px; font-weight: 600; padding: 4px 2px;" />
    <button type="button" class="btn-icon text-danger" onclick="this.parentElement.remove()" style="border: none; background: transparent; cursor: pointer; padding: 4px;">
      <i class='bx bx-trash' style="font-size: 15px;"></i>
    </button>
  `;
    container.appendChild(rowDiv);
}

function serializeTrailers() {
    const container = document.getElementById("trailersContainer");
    if (!container) return "";

    const rows = container.querySelectorAll(".trailer-row");
    const result = [];

    rows.forEach((row) => {
        const type = row.querySelector(".input-trailer-type").value.trim();
        if (type) result.push(type);
    });

    return result.join("; ");
}

function parseAndFillTrailers(trailersStr) {
    const container = document.getElementById("trailersContainer");
    if (!container) return;
    container.innerHTML = "";

    if (!trailersStr) return;

    const items = trailersStr.split(";");
    items.forEach((item) => {
        // Підтримка старих записів виду "ТЕНТ (92 м³ / 22 т)" — беремо тільки тип
        const typeMatch = item.match(/^([^(]+)/);
        const type = typeMatch ? typeMatch[1].trim() : item.trim();
        if (type) addTrailerRow(type);
    });
}

/* ================================================================= *
 * 4. КРАЇНИ ТА НАПРЯМКИ (закордон) — випадаюче меню                  *
 * ================================================================= */

// Наповнює обидва випадаючі меню (країни і області) варіантами
function renderDirectionSelects() {
    const countrySelect = document.getElementById("countrySelect");
    if (countrySelect) {
        const sorted = [...COUNTRIES].sort((a, b) => a.localeCompare(b, "uk"));
        countrySelect.innerHTML =
            `<option value="">Оберіть країну...</option>` +
            sorted
                .map(
                    (c) =>
                        `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`,
                )
                .join("");
    }

    const oblastSelect = document.getElementById("ukraineOblastSelect");
    if (oblastSelect) {
        oblastSelect.innerHTML =
            `<option value="">Оберіть область...</option>` +
            UKRAINE_OBLASTS.map(
                (o) =>
                    `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`,
            ).join("");
    }
}

// Обробник вибору країни у випадаючому меню
function onCountrySelectChange(selectEl) {
    if (selectEl.value) addCountryRow(selectEl.value);
    selectEl.value = ""; // повертаємо меню в початковий стан
}

// Обробник вибору області у випадаючому меню
function onUkraineOblastSelectChange(selectEl) {
    if (selectEl.value) addUkraineDirectionRow(selectEl.value);
    selectEl.value = "";
}

// Додає плашку країни та поле для Квадрата / Воєводства
function addCountryRow(countryName = "", regionName = "") {
    const container = document.getElementById("destinationsContainer");
    if (!container) return;

    // Не додаємо дублікати країни
    if (countryName) {
        const alreadyAdded = Array.from(
            container.querySelectorAll(".input-country"),
        ).some((input) => input.value.trim() === countryName);
        if (alreadyAdded) return;
    }

    const rowDiv = document.createElement("div");
    rowDiv.className = "country-row";
    rowDiv.style.cssText =
        "display: flex; align-items: center; gap: 8px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 6px 10px; width: 100%; margin-top: 4px;";

    rowDiv.innerHTML = `
        <span class="badge-country" style="margin: 0; font-size: 13px; white-space: nowrap;">${escapeHtml(countryName)}</span>
        <input type="hidden" class="input-country" value="${escapeHtml(countryName)}" />
        <input type="text" class="input-country-region" value="${escapeHtml(regionName)}" placeholder="Введіть Квадрат / Воєводство (наприклад: Поморське, Мазовецьке)" style="flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 8px; font-size: 13px; background: #ffffff; outline: none;" />
        <button type="button" class="btn-icon text-danger" onclick="this.parentElement.remove()" style="border: none; background: transparent; cursor: pointer; padding: 4px;">
          <i class='bx bx-trash' style="font-size: 18px;"></i>
        </button>
    `;
    container.appendChild(rowDiv);
}

// Серіалізація даних у формат: "ПОЛЬША - Поморське воєв., Мазовецьке воєв.; БЕЛЬГІЯ - Фландрія"
function serializeDestinations() {
    const container = document.getElementById("destinationsContainer");
    if (!container) return "";

    const rows = container.querySelectorAll(".country-row");
    const result = [];

    rows.forEach((row) => {
        const country = row.querySelector(".input-country")?.value.trim();
        const region = row.querySelector(".input-country-region")?.value.trim();
        if (country) {
            result.push(region ? `${country} - ${region}` : country);
        }
    });

    return result.join("; ");
}

// Розпаршує рядок та заповнює форму при редагуванні
function parseAndFillDestinations(destinationsStr) {
    const container = document.getElementById("destinationsContainer");
    if (!container) return;
    container.innerHTML = "";

    if (!destinationsStr) return;

    const items = destinationsStr.split(";");
    items.forEach((item) => {
        const dashIndex = item.indexOf("-");
        const country =
            dashIndex !== -1
                ? item.substring(0, dashIndex).trim()
                : item.trim();
        const region =
            dashIndex !== -1 ? item.substring(dashIndex + 1).trim() : "";
        if (country) addCountryRow(country, region);
    });
}
/* ================================================================= *
 * 4.1 НАПРЯМКИ В УКРАЇНІ (мультивибір областей через випадаюче меню) *
 * ================================================================= */

// Додає область до списку обраних напрямків у формі. Якщо ця область вже
// додана раніше — повторно не додає.
function addUkraineDirectionRow(oblastName = "") {
    const container = document.getElementById("ukraineDirectionsContainer");
    if (!container || !oblastName) return;

    const alreadyAdded = Array.from(
        container.querySelectorAll(".input-ukraine-oblast"),
    ).some((input) => input.value.trim() === oblastName);
    if (alreadyAdded) return;

    const rowDiv = document.createElement("div");
    rowDiv.className = "ukraine-direction-row";
    rowDiv.style.cssText =
        "display: inline-flex; align-items: center; gap: 4px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 3px 4px 3px 10px;";

    rowDiv.innerHTML = `
    <input type="text" class="input-ukraine-oblast" value="${escapeHtml(oblastName)}" readonly style="width: 150px; border: none; background: transparent; outline: none; font-size: 13px; font-weight: 600; padding: 4px 2px; cursor: default;" />
    <button type="button" class="btn-icon text-danger" onclick="this.parentElement.remove()" style="border: none; background: transparent; cursor: pointer; padding: 4px;">
      <i class='bx bx-trash' style="font-size: 15px;"></i>
    </button>
  `;
    container.appendChild(rowDiv);
}

function serializeUkraineDirections() {
    const container = document.getElementById("ukraineDirectionsContainer");
    if (!container) return "";

    const inputs = container.querySelectorAll(".input-ukraine-oblast");
    const result = [];
    inputs.forEach((input) => {
        const val = input.value.trim();
        if (val) result.push(val);
    });

    return result.join("; ");
}

function parseAndFillUkraineDirections(str) {
    const container = document.getElementById("ukraineDirectionsContainer");
    if (!container) return;
    container.innerHTML = "";

    if (!str) return;

    str.split(";").forEach((oblast) => {
        const trimmed = oblast.trim();
        if (trimmed) addUkraineDirectionRow(trimmed);
    });
}

/* ================================================================= *
 * 5. CRUD ОПЕРАЦІЇ                                                  *
 * ================================================================= */

// Шукає в уже завантажених перевізниках (allCarriersCache) запис, який
// співпадає з поточною формою за ЄДРПОУ або за назвою компанії.
// excludeId — id перевізника, якого редагують зараз (щоб не порівнювати сам із собою).
function findDuplicateCarrier(payload, excludeId) {
    const normalizedName = (payload.name || "").trim().toLowerCase();
    const normalizedEdrpou = (payload.edrpou || "").trim().toLowerCase();

    return allCarriersCache.find((item) => {
        if (excludeId && String(item.id) === String(excludeId)) return false;

        const itemName = (item.name || item.company || "").trim().toLowerCase();
        const itemEdrpou = (item.edrpou || "").trim().toLowerCase();

        // Співпадіння по ЄДРПОУ — найнадійніша ознака дубля, якщо код вказаний в обох записах
        if (normalizedEdrpou && itemEdrpou && normalizedEdrpou === itemEdrpou) {
            return true;
        }

        // Або співпадіння по назві компанії (якщо ЄДРПОУ не вказаний)
        if (normalizedName && itemName && normalizedName === itemName) {
            return true;
        }

        return false;
    });
}

if (addCarrierForm) {
    addCarrierForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const destInput = document.getElementById("destinations");
        if (destInput) destInput.value = serializeDestinations();

        const trailerInput = document.getElementById("trailer_type");
        if (trailerInput) trailerInput.value = serializeTrailers();

        const ukraineDirInput = document.getElementById("ukraine_directions");
        if (ukraineDirInput)
            ukraineDirInput.value = serializeUkraineDirections();

        const getValue = (id) => {
            const el = document.getElementById(id);
            return el && el.value.trim() !== "" ? el.value.trim() : null;
        };

        const payload = {
            name: getValue("company_name") || getValue("name"),
            edrpou: getValue("edrpou"),
            region_ukr: getValue("region_ukr"),
            destinations: getValue("destinations"),
            ukraine_directions: getValue("ukraine_directions"),
            quadrant: getValue("quadrant"),
            city: getValue("city"),
            contact_person_1: getValue("contact_person_1"),
            phone_1: getValue("phone_1"),
            contact_person_2: getValue("contact_person_2"),
            phone_2: getValue("phone_2"),
            trailer_type: getValue("trailer_type"),
            volume: getValue("volume"),
            tonnage: getValue("tonnage"),
            additional: getValue("additional"),
            notes: getValue("notes"),
            logo_url: getValue("logo_url"),
            profile_url: getValue("profile_url"),
            rating: parseInt(
                document.getElementById("carrierRating")?.value || "0",
            ),
        };

        const carrierId = document.getElementById("carrierId")?.value;

        // Дата/час заміти оновлюється ТІЛЬКИ якщо текст заміти реально змінився.
        const existingCarrier = carrierId
            ? allCarriersCache.find((c) => String(c.id) === String(carrierId))
            : null;
        const previousNotes = existingCarrier
            ? existingCarrier.notes || null
            : null;
        if (payload.notes !== previousNotes) {
            payload.notes_updated_at = new Date().toISOString();
        }

        // Перевірка на дубль: шукаємо збіг за ЄДРПОУ або назвою серед уже доданих
        const duplicate = findDuplicateCarrier(payload, carrierId);
        if (duplicate) {
            const proceed = confirm(
                `Перевізник "${duplicate.name || duplicate.company}" (ЄДРПОУ: ${duplicate.edrpou || "—"}) вже є в базі.\n\nВсе одно зберегти цей запис?`,
            );
            if (!proceed) return;
        }

        let error;
        if (carrierId) {
            const res = await sbClient
                .from("carriers")
                .update(payload)
                .eq("id", carrierId);
            error = res.error;
        } else {
            const res = await sbClient.from("carriers").insert([payload]);
            error = res.error;
        }

        if (error) {
            alert("Помилка Supabase: " + error.message);
            console.error(error);
        } else {
            resetForm();
            closeModal();
            loadCarriers();
        }
    });
}

function resetForm() {
    if (addCarrierForm) addCarrierForm.reset();
    const carrierIdEl = document.getElementById("carrierId");
    if (carrierIdEl) carrierIdEl.value = "";
    const modalTitle = document.getElementById("modalTitle");
    if (modalTitle) modalTitle.textContent = "Додати перевізника";

    const trailersContainer = document.getElementById("trailersContainer");
    if (trailersContainer) trailersContainer.innerHTML = "";

    const destinationsContainer = document.getElementById(
        "destinationsContainer",
    );
    if (destinationsContainer) destinationsContainer.innerHTML = "";

    const ukraineDirContainer = document.getElementById(
        "ukraineDirectionsContainer",
    );
    if (ukraineDirContainer) ukraineDirContainer.innerHTML = "";

    const ratingEl = document.getElementById("carrierRating");
    if (ratingEl) ratingEl.value = "0";

    const notesUpdatedEl = document.getElementById("notesUpdatedAtDisplay");
    if (notesUpdatedEl) notesUpdatedEl.textContent = "";
}

async function editCarrier(id) {
    const { data, error } = await sbClient
        .from("carriers")
        .select("*")
        .eq("id", id)
        .single();
    if (error) {
        console.error("Помилка завантаження для редагування:", error);
        return;
    }
    if (!data) return;

    document.getElementById("carrierId").value = data.id;
    document.getElementById("company_name").value =
        data.name || data.company || "";
    document.getElementById("edrpou").value = data.edrpou || "";

    document.getElementById("region_ukr").value = data.region_ukr || "";
    document.getElementById("quadrant").value = data.quadrant || "";
    document.getElementById("city").value = data.city || "";
    document.getElementById("contact_person_1").value =
        data.contact_person_1 || "";
    document.getElementById("phone_1").value = data.phone_1 || "";
    document.getElementById("contact_person_2").value =
        data.contact_person_2 || "";
    document.getElementById("phone_2").value = data.phone_2 || "";
    document.getElementById("volume").value = data.volume || "";
    document.getElementById("tonnage").value = data.tonnage || "";
    document.getElementById("additional").value = data.additional || "";

    const logoUrlEl = document.getElementById("logo_url");
    if (logoUrlEl) logoUrlEl.value = data.logo_url || "";

    const profileUrlEl = document.getElementById("profile_url");
    if (profileUrlEl) profileUrlEl.value = data.profile_url || "";

    const notesEl = document.getElementById("notes");
    if (notesEl) notesEl.value = data.notes || "";

    const notesUpdatedEl = document.getElementById("notesUpdatedAtDisplay");
    if (notesUpdatedEl) {
        notesUpdatedEl.textContent = data.notes_updated_at
            ? `Востаннє змінено: ${formatDateTime(data.notes_updated_at)}`
            : "";
    }

    const ratingEl = document.getElementById("carrierRating");
    if (ratingEl) ratingEl.value = String(data.rating || 0);

    parseAndFillTrailers(data.trailer_type);
    parseAndFillDestinations(data.destinations);
    parseAndFillUkraineDirections(data.ukraine_directions);

    document.getElementById("modalTitle").textContent =
        "Редагувати перевізника";
    modalOverlay.classList.add("active");
}

async function deleteCarrier(id) {
    if (!confirm("Ви впевнені, що хочете видалити цього перевізника?")) return;

    const { error } = await sbClient.from("carriers").delete().eq("id", id);
    if (error) {
        alert("Помилка при видаленні: " + error.message);
    } else {
        loadCarriers();
    }
}

function sortTable(column, ascending = true) {
    currentSortColumn = column;
    currentSortAscending = ascending;
    loadCarriers();
    closeColumnFilter();
}

// Клік по назві стовпця в шапці таблиці: перший клік — сортування за
// зростанням, повторний клік по тій самій колонці — перемикає напрямок.
function toggleSort(column) {
    if (currentSortColumn === column) {
        currentSortAscending = !currentSortAscending;
    } else {
        currentSortColumn = column;
        currentSortAscending = true;
    }
    loadCarriers();
}

/* ================================================================= *
 * 6. ФІЛЬТРИ СТОВПЦІВ (ДЛЯ ВСІХ ПОЛІВ)                              *
 * ================================================================= */

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderTableWithColumnFilters() {
    loadCarriers();
}

function openColumnFilter(event, columnKey) {
    event.stopPropagation();
    activeFilterColumn = columnKey;

    const dropdown = document.getElementById("columnFilterDropdown");
    const optionsContainer = document.getElementById("columnFilterOptions");
    const searchInputEl = document.getElementById("columnFilterSearch");

    if (!dropdown || !optionsContainer) return;

    if (searchInputEl) searchInputEl.value = "";
    optionsContainer.innerHTML = "";

    // Збираємо унікальні значення для фільтрації
    let uniqueValues = new Set();
    allCarriersCache.forEach((item) => {
        let val = item[columnKey];
        if (columnKey === "carrier_col") {
            val =
                `${item.name || item.company || ""} ${item.edrpou || ""}`.trim();
        } else if (columnKey === "location_col") {
            val = `${item.city || ""} ${item.region_ukr || ""}`.trim();
        } else if (columnKey === "contacts_col") {
            val = `${item.contact_person_1 || ""} ${item.phone_1 || ""}`.trim();
        } else if (columnKey === "company" && !val && item.name) {
            val = item.name;
        } else if (columnKey === "rating") {
            val = item.rating ? `${item.rating} ★` : "Без оцінки";
        }

        if (val) {
            String(val)
                .split(";")
                .forEach((subVal) => {
                    let cleaned = subVal.trim();
                    if (cleaned) uniqueValues.add(cleaned);
                });
        }
    });

    const currentSelected = activeFiltersState[columnKey];
    // Виправляємо сортування українською мовою (від А до Я)
    const sortedValues = Array.from(uniqueValues).sort((a, b) =>
        a.localeCompare(b, "uk"),
    );

    const selectAllLink = document.getElementById("selectAllLink");
    if (selectAllLink) {
        selectAllLink.textContent = `Вибрати всі (${sortedValues.length})`;
    }

    sortedValues.forEach((val) => {
        // Якщо фільтр для цього стовпця ще не застосовувався (currentSelected === undefined) -> ставимо галочки скрізь.
        const isChecked =
            currentSelected === undefined || currentSelected.includes(val)
                ? "checked"
                : "";

        const label = document.createElement("label");
        label.className = "filter-option-item";
        label.innerHTML = `
            <input type="checkbox" value="${escapeHtml(val)}" ${isChecked} onchange="updateFilterCountText()">
            <span>${escapeHtml(val)}</span>
        `;
        optionsContainer.appendChild(label);
    });

    dropdown.style.display = "block";

    // Позиціонуємо ПІСЛЯ display:block, щоб коректно порахувати розміри вікна
    const rect = event.currentTarget.getBoundingClientRect();
    const dropdownWidth = 280;
    let left = window.scrollX + rect.left - 120;
    // Не даємо вікну вилізти за правий край екрана
    if (left + dropdownWidth > window.scrollX + window.innerWidth) {
        left = window.scrollX + window.innerWidth - dropdownWidth - 16;
    }
    if (left < window.scrollX + 8) left = window.scrollX + 8;

    dropdown.style.top = `${window.scrollY + rect.bottom + 6}px`;
    dropdown.style.left = `${left}px`;

    updateFilterCountText();
}

function selectAllFilterOptions(select) {
    const checkboxes = document.querySelectorAll(
        "#columnFilterOptions input[type='checkbox']",
    );
    checkboxes.forEach((cb) => {
        if (cb.closest("label").style.display !== "none") {
            cb.checked = select;
        }
    });
    updateFilterCountText();
}

function updateFilterCountText() {
    const checkboxes = document.querySelectorAll(
        "#columnFilterOptions input[type='checkbox']",
    );
    let tempSelected = [];
    checkboxes.forEach((cb) => {
        if (cb.checked) tempSelected.push(cb.value);
    });

    let count = allCarriersCache.filter((item) => {
        let itemVal = String(item[activeFilterColumn] || "");
        if (activeFilterColumn === "carrier_col") {
            itemVal = `${item.name || item.company || ""} ${item.edrpou || ""}`;
        } else if (activeFilterColumn === "location_col") {
            itemVal = `${item.city || ""} ${item.region_ukr || ""}`;
        } else if (activeFilterColumn === "contacts_col") {
            itemVal = `${item.contact_person_1 || ""} ${item.phone_1 || ""}`;
        } else if (activeFilterColumn === "rating") {
            itemVal = item.rating ? `${item.rating} ★` : "Без оцінки";
        } else if (!itemVal && activeFilterColumn === "company" && item.name) {
            itemVal = String(item.name);
        }
        return tempSelected.some((val) =>
            itemVal.toLowerCase().includes(val.toLowerCase()),
        );
    }).length;

    const filterShownCount = document.getElementById("filterShownCount");
    if (filterShownCount) {
        filterShownCount.textContent = `Показується рядків: ${count}`;
    }
}

function filterDropdownList() {
    const searchEl = document.getElementById("columnFilterSearch");
    if (!searchEl) return;

    const query = searchEl.value.toLowerCase();
    const labels = document.querySelectorAll(
        "#columnFilterOptions .filter-option-item",
    );
    labels.forEach((label) => {
        const text = label.textContent.toLowerCase();
        label.style.display = text.includes(query) ? "flex" : "none";
    });
}

function closeColumnFilter() {
    const dropdown = document.getElementById("columnFilterDropdown");
    if (dropdown) dropdown.style.display = "none";
    activeFilterColumn = null;
}

function applyColumnFilter() {
    if (!activeFilterColumn) return;

    const checkboxes = document.querySelectorAll(
        "#columnFilterOptions input[type='checkbox']",
    );
    const selected = [];
    const allCheckboxesCount = checkboxes.length;

    checkboxes.forEach((cb) => {
        if (cb.checked) {
            selected.push(cb.value);
        }
    });

    // Якщо вибрані АБСОЛЮТНО ВСІ варіанти — це рівнозначно "без фільтра".
    if (selected.length === allCheckboxesCount) {
        delete activeFiltersState[activeFilterColumn];
    } else {
        activeFiltersState[activeFilterColumn] = selected;
    }

    closeColumnFilter();
    renderTableWithColumnFilters();
}

async function updateCarrierRating(id, newRating) {
    const { error } = await sbClient
        .from("carriers")
        .update({ rating: newRating })
        .eq("id", id);

    if (error) {
        alert("Помилка оновлення рейтингу: " + error.message);
    } else {
        const carrier = allCarriersCache.find((c) => c.id === id);
        if (carrier) carrier.rating = newRating;
        loadCarriers();
    }
}
