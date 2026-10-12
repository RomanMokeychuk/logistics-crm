/* ================================================================= *
 * СТОРІНКА "ЛІДИ" — клієнти та робота з ними                         *
 * ================================================================= */

const SUPABASE_URL = "https://prbfscwmemshwigiftha.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function logout() {
    await sbClient.auth.signOut();
    window.location.href = "login.html";
}

/* ---------------- Довідники ---------------- */

// Етапи роботи з клієнтом (порядок = порядок сортування)
const LEAD_STATUSES = [
    { value: "Новий", cls: "status-quote", icon: "bx-star" },
    { value: "Контакт", cls: "status-offer", icon: "bx-phone" },
    { value: "Переговори", cls: "status-progress", icon: "bx-conversation" },
    { value: "Клієнт", cls: "status-confirmed", icon: "bx-check-circle" },
    { value: "Відмова", cls: "status-rejected", icon: "bx-x-circle" },
];

const LEAD_SOURCES = [
    "Вхідний дзвінок",
    "Холодний дзвінок",
    "Lardi-Trans",
    "Della",
    "Сайт",
    "Рекомендація",
    "Viber / Telegram",
    "Email",
    "Виставка",
    "Інше",
];

const COUNTRIES = [
    "УКРАЇНА",
    "ПОЛЬША",
    "НІМЕЧЧИНА",
    "ЛИТВА",
    "ЛАТВІЯ",
    "ЕСТОНІЯ",
    "ЧЕХІЯ",
    "СЛОВАЧЧИНА",
    "УГОРЩИНА",
    "РУМУНІЯ",
    "МОЛДОВА",
    "БОЛГАРІЯ",
    "АВСТРІЯ",
    "ІТАЛІЯ",
    "ІСПАНІЯ",
    "ФРАНЦІЯ",
    "БЕЛЬГІЯ",
    "НІДЕРЛАНДИ",
    "ДАНІЯ",
    "ФІНЛЯНДІЯ",
    "ВЕЛИКОБРИТАНІЯ",
    "ТУРЕЧЧИНА",
    "ГРУЗІЯ",
    "ВІРМЕНІЯ",
    "АЗЕРБАЙДЖАН",
    "СЛОВЕНІЯ",
];

/* ---------------- Стан ---------------- */

let leadsCache = [];
let staffCache = [];
let currentStaff = null;
let requestsByLead = new Map(); // id ліда → кількість запитів
let activeStatus = ""; // "" = всі
let sortColumn = "created_at";
let sortAscending = false;
let currentCardLeadId = null;

const tableBody = document.getElementById("leadsTableBody");
const modalOverlay = document.getElementById("leadModalOverlay");
const leadForm = document.getElementById("leadForm");
const cardOverlay = document.getElementById("leadCardOverlay");
const searchInput = document.getElementById("leadsSearch");
const salesFilter = document.getElementById("leadsSalesFilter");
const todayOnly = document.getElementById("leadsTodayOnly");

/* ---------------- Допоміжні ---------------- */

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatDateOnly(value) {
    if (!value) return "";
    const [y, m, d] = String(value).slice(0, 10).split("-");
    return y && m && d ? `${d}.${m}.${y}` : "";
}

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

const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function statusBadge(status) {
    const s = LEAD_STATUSES.find((x) => x.value === status);
    return `<span class="status-badge ${s ? s.cls : "status-request"}">${escapeHtml(status || "—")}</span>`;
}

const statusOrder = (status) => {
    const i = LEAD_STATUSES.findIndex((x) => x.value === status);
    return i === -1 ? LEAD_STATUSES.length : i;
};

function hasRole(s, list) {
    const roles =
        Array.isArray(s?.roles) && s.roles.length ? s.roles : [s?.role];
    return roles.some((r) => list.includes(r));
}

// Дата наступного контакту: сьогодні — помаранчева, прострочена — червона
function nextContactHtml(lead) {
    if (!lead.next_contact) return "—";
    const d = String(lead.next_contact).slice(0, 10);
    const today = todayIso();
    const closed = ["Клієнт", "Відмова"].includes(lead.status);
    let cls = "";
    let hint = "";
    if (!closed && d < today) {
        cls = "next-overdue";
        hint = `<div class="next-hint"><i class='bx bx-error-circle'></i> прострочено</div>`;
    } else if (!closed && d === today) {
        cls = "next-today";
        hint = `<div class="next-hint"><i class='bx bx-bell'></i> сьогодні</div>`;
    }
    return `<div class="${cls}">${formatDateOnly(d)}${hint}</div>`;
}

const needsContact = (l) =>
    l.next_contact &&
    String(l.next_contact).slice(0, 10) <= todayIso() &&
    !["Клієнт", "Відмова"].includes(l.status);

function phoneLink(phone) {
    if (!phone) return "";
    const digits = phone.replace(/\D/g, "");
    const viber = digits
        ? `<a href="viber://chat?number=%2B${digits}" class="viber-link" title="Відкрити чат у Viber"><i class='bx bxs-message-rounded-dots'></i></a>`
        : "";
    return `${escapeHtml(phone)} ${viber}`;
}

/* ================================================================= *
 * ЗАВАНТАЖЕННЯ                                                       *
 * ================================================================= */

async function loadStaff(session) {
    const { data } = await sbClient
        .from("staff")
        .select("*")
        .order("full_name");
    staffCache = data || [];
    const email = (session?.user?.email || "").toLowerCase();
    currentStaff =
        staffCache.find((s) => (s.email || "").toLowerCase() === email) || null;

    const sales = staffCache.filter(
        (s) => s.active && hasRole(s, ["sales", "head"]),
    );
    salesFilter.innerHTML =
        `<option value="">Усі Sales</option>` +
        (currentStaff ? `<option value="__me">Тільки мої</option>` : "") +
        sales
            .map(
                (s) =>
                    `<option value="${s.id}">${escapeHtml(s.full_name)}</option>`,
            )
            .join("");
}

async function loadLeads() {
    const [{ data, error }, { data: reqs }] = await Promise.all([
        sbClient
            .from("leads")
            .select("*")
            .order("created_at", { ascending: false }),
        sbClient.from("requests").select("lead_id"),
    ]);

    if (error) {
        tableBody.innerHTML = `<tr><td colspan="10" class="empty-row">Помилка завантаження: ${escapeHtml(error.message)}<br>Можливо, ще не виконано leads.sql у Supabase.</td></tr>`;
        return;
    }

    requestsByLead = new Map();
    (reqs || []).forEach((r) => {
        if (r.lead_id)
            requestsByLead.set(
                String(r.lead_id),
                (requestsByLead.get(String(r.lead_id)) || 0) + 1,
            );
    });

    leadsCache = data || [];
    renderTabs();
    renderLeads();
}

/* ================================================================= *
 * ВКЛАДКИ ЕТАПІВ                                                     *
 * ================================================================= */

function renderTabs() {
    const count = (st) =>
        leadsCache.filter((l) => !st || l.status === st).length;
    const tabs = [{ value: "", label: "Усі", icon: "bx-list-ul" }].concat(
        LEAD_STATUSES.map((s) => ({
            value: s.value,
            label: s.value,
            icon: s.icon,
        })),
    );
    document.getElementById("leadTabs").innerHTML = tabs
        .map(
            (t) => `
        <button type="button" class="lead-tab ${t.value === activeStatus ? "active" : ""}" data-status="${escapeHtml(t.value)}">
            <i class='bx ${t.icon}'></i> ${escapeHtml(t.label)} <span class="lead-tab-count">${count(t.value)}</span>
        </button>`,
        )
        .join("");
}

document.getElementById("leadTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".lead-tab");
    if (!btn) return;
    activeStatus = btn.dataset.status;
    renderTabs();
    renderLeads();
});

/* ================================================================= *
 * ТАБЛИЦЯ                                                            *
 * ================================================================= */

function renderLeads() {
    const q = (searchInput.value || "").trim().toLowerCase();
    const salesVal = salesFilter.value;

    let rows = leadsCache.filter((l) => {
        if (activeStatus && l.status !== activeStatus) return false;
        if (
            salesVal === "__me" &&
            String(l.sales_id) !== String(currentStaff?.id)
        )
            return false;
        if (salesVal && salesVal !== "__me" && String(l.sales_id) !== salesVal)
            return false;
        if (todayOnly.checked && !needsContact(l)) return false;
        if (!q) return true;
        return [
            l.name,
            l.edrpou,
            l.contact_person,
            l.phone,
            l.email,
            l.country,
            l.city,
            l.source,
            l.directions,
            l.cargo,
            l.notes,
            l.sales,
            l.status,
        ]
            .join(" ")
            .toLowerCase()
            .includes(q);
    });

    rows.sort((a, b) => {
        let r;
        if (sortColumn === "status")
            r = statusOrder(a.status) - statusOrder(b.status);
        else if (["created_at", "next_contact"].includes(sortColumn)) {
            const va = a[sortColumn] || "";
            const vb = b[sortColumn] || "";
            if (!va && vb) return 1;
            if (va && !vb) return -1;
            r = va < vb ? -1 : va > vb ? 1 : 0;
        } else {
            r = String(a[sortColumn] || "").localeCompare(
                String(b[sortColumn] || ""),
                "uk",
                { numeric: true },
            );
        }
        return sortAscending ? r : -r;
    });

    updateSortIcons();

    const bar = document.getElementById("leadsCountBar");
    const toCall = leadsCache.filter(needsContact).length;
    bar.innerHTML =
        `<span>${rows.length === leadsCache.length ? `Лідів: ${leadsCache.length}` : `Показано: ${rows.length} з ${leadsCache.length}`}</span>` +
        (toCall
            ? `<span class="lead-call-reminder"><i class='bx bx-bell'></i> Зв'язатися сьогодні або прострочено: ${toCall}</span>`
            : "");

    if (!rows.length) {
        tableBody.innerHTML = `<tr><td colspan="10" class="empty-row">${
            leadsCache.length
                ? "Нічого не знайдено за цими умовами"
                : "Лідів ще немає — натисніть «Додати ліда»"
        }</td></tr>`;
        return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach((l, i) => {
        const tr = document.createElement("tr");
        tr.className =
            "clickable-row" + (needsContact(l) ? " lead-attention" : "");
        tr.title = "Натисніть, щоб відкрити картку клієнта";
        const reqCount = requestsByLead.get(String(l.id)) || 0;

        tr.innerHTML = `
            <td class="cell-num">${i + 1}</td>
            <td class="cell-client">
                <strong>${escapeHtml(l.name)}</strong>
                ${l.edrpou ? `<div class="lead-sub"><code>${escapeHtml(l.edrpou)}</code></div>` : ""}
                ${reqCount ? `<div class="lead-sub lead-req-count"><i class='bx bx-list-ul'></i> запитів: ${reqCount}</div>` : ""}
            </td>
            <td>
                ${l.contact_person ? `<strong>${escapeHtml(l.contact_person)}</strong>` : ""}
                ${l.phone ? `<div class="lead-sub">${phoneLink(l.phone)}</div>` : ""}
                ${!l.contact_person && !l.phone ? "—" : ""}
            </td>
            <td>${[l.city, l.country].filter(Boolean).map(escapeHtml).join(", ") || "—"}</td>
            <td class="lead-wrap">${escapeHtml(l.directions) || "—"}</td>
            <td>${statusBadge(l.status)}</td>
            <td class="cell-person">${escapeHtml(l.sales) || "—"}</td>
            <td class="cell-date">${nextContactHtml(l)}</td>
            <td class="cell-date">${formatDateOnly(l.created_at)}</td>
            <td class="cell-actions">
                <button class="btn-icon btn-icon-edit" data-action="edit" title="Редагувати"><i class='bx bx-edit'></i></button>
                <button class="btn-icon text-danger" data-action="delete" title="Видалити"><i class='bx bx-trash'></i></button>
            </td>`;

        tr.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-action]");
            if (btn?.dataset.action === "delete") return deleteLead(l);
            if (btn?.dataset.action === "edit") return openLeadModal(l);
            if (e.target.closest("a")) return;
            openLeadCard(l.id);
        });
        frag.appendChild(tr);
    });
    tableBody.innerHTML = "";
    tableBody.appendChild(frag);
}

document.querySelectorAll(".leads-table .sortable").forEach((el) => {
    el.addEventListener("click", () => {
        const col = el.dataset.sort;
        if (sortColumn === col) sortAscending = !sortAscending;
        else {
            sortColumn = col;
            sortAscending = true;
        }
        renderLeads();
    });
});

function updateSortIcons() {
    document.querySelectorAll(".leads-table .sortable").forEach((el) => {
        const icon = el.querySelector(".sort-icon");
        icon.classList.remove("bx-chevron-up", "bx-chevron-down");
        el.classList.toggle("sorted", el.dataset.sort === sortColumn);
        if (el.dataset.sort === sortColumn)
            icon.classList.add(
                sortAscending ? "bx-chevron-up" : "bx-chevron-down",
            );
    });
}

searchInput.addEventListener("input", renderLeads);
salesFilter.addEventListener("change", renderLeads);
todayOnly.addEventListener("change", renderLeads);

/* ================================================================= *
 * ФОРМА: ДОДАТИ / РЕДАГУВАТИ                                         *
 * ================================================================= */

function renderStatusPicker(selected) {
    document.getElementById("lead_status_picker").innerHTML = LEAD_STATUSES.map(
        (s) => `
        <label class="type-option lead-status-option ${s.cls}">
            <input type="radio" name="lead_status" value="${escapeHtml(s.value)}" ${s.value === selected ? "checked" : ""} />
            <i class='bx ${s.icon}'></i> ${escapeHtml(s.value)}
        </label>`,
    ).join("");
}

function fillSalesSelect(selectedId, legacyName) {
    const list = staffCache.filter(
        (s) =>
            hasRole(s, ["sales", "head"]) &&
            (s.active || String(s.id) === String(selectedId)),
    );
    let html = `<option value="">— не вибрано —</option>`;
    html += list
        .map(
            (s) =>
                `<option value="${s.id}" ${String(s.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(s.full_name)}</option>`,
        )
        .join("");
    if (!selectedId && legacyName) {
        html += `<option value="__legacy" selected>${escapeHtml(legacyName)}</option>`;
    }
    document.getElementById("lead_sales").innerHTML = html;
}

const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v || "";
};

function openLeadModal(lead = null) {
    leadForm.reset();
    setVal("leadId", lead?.id);
    setVal("lead_name", lead?.name);
    setVal("lead_edrpou", lead?.edrpou);
    setVal("lead_source", lead?.source);
    setVal("lead_contact_person", lead?.contact_person);
    setVal("lead_phone", lead?.phone);
    setVal("lead_email", lead?.email);
    setVal("lead_country", lead ? lead.country : "УКРАЇНА");
    setVal("lead_city", lead?.city);
    setVal("lead_directions", lead?.directions);
    setVal("lead_cargo", lead?.cargo);
    setVal(
        "lead_next_contact",
        lead?.next_contact ? String(lead.next_contact).slice(0, 10) : "",
    );
    setVal("lead_notes", lead?.notes);
    renderStatusPicker(lead?.status || "Новий");

    // Новий лід — відповідальний той, хто додає (якщо він Sales / Керівник)
    const defaultSales =
        !lead && currentStaff && hasRole(currentStaff, ["sales", "head"])
            ? currentStaff.id
            : null;
    fillSalesSelect(
        lead ? lead.sales_id : defaultSales,
        lead && !lead.sales_id ? lead.sales : null,
    );

    document.getElementById("leadModalTitle").textContent = lead
        ? "Редагувати ліда"
        : "Додати ліда";
    modalOverlay.classList.add("active");
    setTimeout(() => document.getElementById("lead_name").focus(), 50);
}

const closeLeadModal = () => modalOverlay.classList.remove("active");

leadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const val = (id) => {
        const v = document.getElementById(id).value.trim();
        return v || null;
    };

    const id = val("leadId");
    const existing = id
        ? leadsCache.find((l) => String(l.id) === String(id))
        : null;

    // Дублікати: той самий ЄДРПОУ або назва
    const name = val("lead_name");
    const edrpou = val("lead_edrpou");
    const dup = leadsCache.find(
        (l) =>
            String(l.id) !== String(id) &&
            ((edrpou && String(l.edrpou || "").trim() === edrpou) ||
                String(l.name || "")
                    .trim()
                    .toLowerCase() === String(name || "").toLowerCase()),
    );
    if (
        dup &&
        !confirm(
            `Клієнт «${dup.name}» вже є в списку (Sales: ${dup.sales || "—"}).\n\nВсе одно зберегти?`,
        )
    )
        return;

    const salesSel = document.getElementById("lead_sales");
    const salesId =
        salesSel.value && salesSel.value !== "__legacy" ? salesSel.value : null;
    const salesName =
        salesSel.value === "__legacy"
            ? existing?.sales || null
            : staffCache.find((s) => String(s.id) === String(salesId))
                  ?.full_name || null;

    const status =
        document.querySelector("input[name='lead_status']:checked")?.value ||
        "Новий";

    const payload = {
        name,
        edrpou,
        source: val("lead_source"),
        contact_person: val("lead_contact_person"),
        phone: val("lead_phone"),
        email: val("lead_email"),
        country: val("lead_country"),
        city: val("lead_city"),
        directions: val("lead_directions"),
        cargo: val("lead_cargo"),
        next_contact: val("lead_next_contact"),
        notes: val("lead_notes"),
        status,
        sales_id: salesId,
        sales: salesName,
        updated_at: new Date().toISOString(),
    };

    // Зміна етапу автоматично записується в історію
    const history = Array.isArray(existing?.history)
        ? [...existing.history]
        : [];
    if (!existing) {
        history.push({
            at: new Date().toISOString(),
            author: currentStaff?.full_name || "",
            text: `Лід додано (етап «${status}»)`,
            auto: true,
        });
        payload.created_by = currentStaff?.full_name || null;
    } else if (existing.status !== status) {
        history.push({
            at: new Date().toISOString(),
            author: currentStaff?.full_name || "",
            text: `Етап: «${existing.status}» → «${status}»`,
            auto: true,
        });
    }
    payload.history = history;

    const { error } = id
        ? await sbClient.from("leads").update(payload).eq("id", id)
        : await sbClient.from("leads").insert([payload]);

    if (error) {
        alert("Помилка Supabase: " + error.message);
        return;
    }
    closeLeadModal();
    await loadLeads();
    if (id && currentCardLeadId === id) openLeadCard(id);
});

async function deleteLead(lead) {
    if (
        !confirm(
            `Видалити «${lead.name}»?\n\nПорада: якщо клієнт відмовився, краще поставити етап «Відмова» — історія залишиться.`,
        )
    )
        return;
    const { error } = await sbClient.from("leads").delete().eq("id", lead.id);
    if (error) alert("Помилка при видаленні: " + error.message);
    else loadLeads();
}

document
    .getElementById("openLeadModalBtn")
    .addEventListener("click", () => openLeadModal());
document
    .getElementById("closeLeadModalBtn")
    .addEventListener("click", closeLeadModal);
document
    .getElementById("cancelLeadBtn")
    .addEventListener("click", closeLeadModal);
modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeLeadModal();
});

/* ================================================================= *
 * КАРТКА КЛІЄНТА                                                     *
 * ================================================================= */

function cardRow(label, valueHtml) {
    return `
        <div class="card-row">
            <div class="card-row-label">${label}</div>
            <div class="card-row-value">${valueHtml || "—"}</div>
        </div>`;
}

async function openLeadCard(id) {
    const l = leadsCache.find((x) => String(x.id) === String(id));
    if (!l) return;
    currentCardLeadId = l.id;

    const history = (Array.isArray(l.history) ? l.history : [])
        .slice()
        .reverse();
    const historyHtml = history.length
        ? history
              .map(
                  (h) => `
            <div class="history-item ${h.auto ? "history-auto" : ""}">
                <div class="history-meta">${formatDateTime(h.at)}${h.author ? ` · ${escapeHtml(h.author)}` : ""}</div>
                <div class="history-text">${escapeHtml(h.text)}</div>
            </div>`,
              )
              .join("")
        : `<div class="offer-muted">Записів ще немає</div>`;

    const body = document.getElementById("leadCardBody");
    body.innerHTML = `
        <div class="card-header-block">
            <div class="request-card-icon"><i class='bx bx-buildings'></i></div>
            <div class="card-header-info">
                <div class="card-title">${escapeHtml(l.name)}</div>
                <div class="card-subtitle">${[l.city, l.country].filter(Boolean).map(escapeHtml).join(", ") || "Місто не вказано"}</div>
                <div class="card-header-badges">
                    ${statusBadge(l.status)}
                    <span class="request-card-created">Sales: <b>${escapeHtml(l.sales) || "—"}</b></span>
                    <span class="request-card-created">Наступний контакт: ${nextContactHtml(l)}</span>
                </div>
            </div>
        </div>

        <div class="card-columns">
            <div class="card-col">
                <div class="card-section">
                    <div class="card-section-title">Контакти</div>
                    ${cardRow("Контактна особа:", escapeHtml(l.contact_person))}
                    ${cardRow("Телефон:", phoneLink(l.phone))}
                    ${cardRow("Email:", l.email ? `<a href="mailto:${escapeHtml(l.email)}">${escapeHtml(l.email)}</a>` : "")}
                </div>

                <div class="card-section">
                    <div class="card-section-title">Компанія</div>
                    ${cardRow("ЄДРПОУ / ІПН:", l.edrpou ? `<code>${escapeHtml(l.edrpou)}</code>` : "")}
                    ${cardRow("Звідки прийшов:", escapeHtml(l.source))}
                    ${cardRow("Додано:", `${formatDateTime(l.created_at)}${l.created_by ? ` · ${escapeHtml(l.created_by)}` : ""}`)}
                </div>

                <div class="card-section">
                    <div class="card-section-title">Що возить</div>
                    ${cardRow("Напрямки:", escapeHtml(l.directions))}
                    ${cardRow("Вантаж / авто:", escapeHtml(l.cargo))}
                </div>

                <div class="card-section">
                    <div class="card-section-title">Нотатки</div>
                    <div class="card-block-text" style="white-space:pre-wrap">${escapeHtml(l.notes) || "—"}</div>
                </div>
            </div>

            <div class="card-col">
                <div class="card-section">
                    <div class="card-section-title lead-section-title">
                        <span><i class='bx bx-history'></i> Історія спілкування</span>
                    </div>
                    <div class="history-add">
                        <textarea id="historyText" rows="2" placeholder="Що обговорили? Наприклад: дзвонив, цікавить Польща → Україна, надіслати ціну до п'ятниці"></textarea>
                        <div class="history-add-row">
                            <label>Наступний контакт <input type="date" id="historyNext" value="${l.next_contact ? String(l.next_contact).slice(0, 10) : ""}" /></label>
                            <button type="button" class="btn btn-primary btn-sm" id="historyAddBtn"><i class='bx bx-plus'></i> Додати</button>
                        </div>
                    </div>
                    <div class="history-list">${historyHtml}</div>
                </div>

                <div class="card-section">
                    <div class="card-section-title lead-section-title">
                        <span><i class='bx bx-list-ul'></i> Запити цього клієнта</span>
                        <a class="btn-answer" href="requests.html?new_lead=${encodeURIComponent(l.id)}"><i class='bx bx-plus'></i> Новий запит</a>
                    </div>
                    <div id="leadRequests"><div class="card-block-text offer-muted">Завантаження…</div></div>
                </div>
            </div>
        </div>`;

    document
        .getElementById("historyAddBtn")
        .addEventListener("click", () => addHistory(l.id));
    cardOverlay.classList.add("active");
    loadLeadRequests(l);
}

// Запити цього ліда
async function loadLeadRequests(l) {
    const box = document.getElementById("leadRequests");
    const { data, error } = await sbClient
        .from("requests")
        .select(
            "id, created_at, request_type, load_country, unload_country, status, logistician",
        )
        .eq("lead_id", l.id)
        .order("created_at", { ascending: false })
        .limit(50);
    if (!box) return;
    if (error || !data?.length) {
        box.innerHTML = `<div class="card-block-text offer-muted">Запитів ще немає</div>`;
        return;
    }
    box.innerHTML = data
        .map(
            (r) => `
        <a class="lead-request" href="requests.html?open=${r.id}">
            <span class="lead-request-date">${formatDateOnly(r.created_at)}</span>
            <span>${escapeHtml(r.request_type || "")}</span>
            <span class="lead-request-route">${escapeHtml([r.load_country, r.unload_country].filter(Boolean).join(" → ") || "—")}</span>
            <span class="status-badge status-request">${escapeHtml(r.status)}</span>
        </a>`,
        )
        .join("");
}

async function addHistory(id) {
    const l = leadsCache.find((x) => String(x.id) === String(id));
    if (!l) return;
    const text = document.getElementById("historyText").value.trim();
    const next = document.getElementById("historyNext").value || null;
    if (
        !text &&
        next === (l.next_contact ? String(l.next_contact).slice(0, 10) : null)
    ) {
        document.getElementById("historyText").focus();
        return;
    }

    const history = Array.isArray(l.history) ? [...l.history] : [];
    if (text)
        history.push({
            at: new Date().toISOString(),
            author: currentStaff?.full_name || "",
            text,
        });

    const payload = {
        history,
        next_contact: next,
        updated_at: new Date().toISOString(),
    };
    // Перший контакт з новим лідом — переводимо на етап «Контакт»
    if (text && l.status === "Новий") {
        payload.status = "Контакт";
        history.push({
            at: new Date().toISOString(),
            author: currentStaff?.full_name || "",
            text: "Етап: «Новий» → «Контакт»",
            auto: true,
        });
    }

    const { error } = await sbClient.from("leads").update(payload).eq("id", id);
    if (error) {
        alert("Помилка Supabase: " + error.message);
        return;
    }
    await loadLeads();
    openLeadCard(id);
}

function closeLeadCard() {
    cardOverlay.classList.remove("active");
    currentCardLeadId = null;
}

document
    .getElementById("closeLeadCardBtn")
    .addEventListener("click", closeLeadCard);
document.getElementById("editFromLeadCardBtn").addEventListener("click", () => {
    const l = leadsCache.find(
        (x) => String(x.id) === String(currentCardLeadId),
    );
    closeLeadCard();
    if (l) openLeadModal(l);
});
cardOverlay.addEventListener("click", (e) => {
    if (e.target === cardOverlay) closeLeadCard();
});

/* ================================================================= *
 * БІЧНА ПАНЕЛЬ І "ШЛЯХ"                                              *
 * ================================================================= */

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

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeLeadModal();
        closeLeadCard();
        closeShlyahModal();
    }
});

/* ================================================================= *
 * СТАРТ                                                              *
 * ================================================================= */

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

    document.getElementById("lead_country").innerHTML =
        `<option value="">Країна...</option>` +
        COUNTRIES.map((c) => `<option value="${c}">${c}</option>`).join("");
    document.getElementById("leadSourcesList").innerHTML = LEAD_SOURCES.map(
        (s) => `<option value="${escapeHtml(s)}"></option>`,
    ).join("");

    await loadStaff(session);
    await loadLeads();

    // Перехід із картки запиту: leads.html?open=ID
    const openId = new URLSearchParams(location.search).get("open");
    if (openId) {
        openLeadCard(openId);
        history.replaceState(null, "", location.pathname);
    }
});
