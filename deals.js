/* ================================================================= *
 * FURA — УГОДИ                                                        *
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

const COUNTRIES = [
    "УКРАЇНА", "ПОЛЬША", "НІМЕЧЧИНА", "ЛИТВА", "ЛАТВІЯ", "ЕСТОНІЯ", "ЧЕХІЯ", "СЛОВАЧЧИНА", "УГОРЩИНА",
    "РУМУНІЯ", "МОЛДОВА", "БОЛГАРІЯ", "АВСТРІЯ", "ІТАЛІЯ", "ІСПАНІЯ", "ФРАНЦІЯ", "БЕЛЬГІЯ", "НІДЕРЛАНДИ",
    "ДАНІЯ", "ФІНЛЯНДІЯ", "ВЕЛИКОБРИТАНІЯ", "ТУРЕЧЧИНА", "ГРУЗІЯ", "ВІРМЕНІЯ", "АЗЕРБАЙДЖАН", "СЛОВЕНІЯ",
];
const BORDER_CROSSINGS = [
    "Ягодин – Дорогуськ (PL)", "Устилуг – Зосін (PL)", "Рава-Руська – Гребенне (PL)", "Краковець – Корчова (PL)",
    "Шегині – Медика (PL)", "Угринів – Долгобичув (PL)", "Ужгород – Вишнє Нємецьке (SK)", "Малий Березний – Убля (SK)",
    "Тиса – Захонь (HU)", "Лужанка – Берегшурань (HU)", "Дякове – Халмеу (RO)", "Порубне – Сірет (RO)",
    "Дяківці – Раковець (MD)", "Могилів-Подільський – Отач (MD)", "Паланка – Маяки-Удобне (MD)", "Рені – Джурджулешти (MD)",
];
const TRAILERS = ["ТЕНТ", "РЕФ", "ІЗОТЕРМ", "ЦІЛЬНОМЕТ", "КОНТЕЙНЕРОВОЗ", "МЕГА", "СЦЕПКА", "БУС", "ЦИСТЕРНА", "ЗЕРНОВОЗ", "САМОСКИД", "ПЛАТФОРМА", "ТРАЛ", "АВТОВОЗ"];
const CUSTOMS_HERE = "По місцю";

// Статус угоди визначається з дат — нічого вручну перемикати не треба
const DEAL_STATES = [
    { key: "plan", label: "Планується", cls: "deal-st-plan" },
    { key: "late", label: "Запізнення", cls: "deal-st-late" },
    { key: "road", label: "В дорозі", cls: "deal-st-road" },
    { key: "done", label: "Доставлено", cls: "deal-st-done" },
];

/* ---------------- Стан ---------------- */

let dealsCache = [];
let staffCache = [];
let currentStaff = null;
let activeState = "";
let currentCardDealId = null;

const tableBody = document.getElementById("dealsTableBody");
const modalOverlay = document.getElementById("dealModalOverlay");
const dealForm = document.getElementById("dealForm");
const searchInput = document.getElementById("dealsSearch");

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
const $ = (id) => document.getElementById(id);
const rolesOf = (s) => (Array.isArray(s?.roles) && s.roles.length ? s.roles : s?.role ? [s.role] : []);
const hasRole = (s, list) => rolesOf(s).some((r) => list.includes(r));
const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function fmtDate(v) {
    if (!v) return "";
    const [y, m, d] = String(v).slice(0, 10).split("-");
    return `${d}.${m}.${y}`;
}
// Телефон — тільки цифри (кілька номерів через кому): +38(067)-111-22-33 → 380671112233
function cleanPhone(v) {
    return String(v || "")
        .split(/[,;]/)
        .map((part) => {
            let d = part.replace(/\D/g, "");
            if (d.length === 9) d = "380" + d;
            else if (d.length === 10 && d.startsWith("0")) d = "38" + d;
            else if (d.length === 11 && d.startsWith("80")) d = "3" + d;
            return d;
        })
        .filter(Boolean)
        .join(", ");
}

function dealState(d) {
    if (d.unload_date) return "done";
    if (d.load_date) return "road";
    if (d.load_date_plan && String(d.load_date_plan).slice(0, 10) < todayIso()) return "late";
    return "plan";
}
function stateBadge(d) {
    const s = DEAL_STATES.find((x) => x.key === dealState(d));
    return `<span class="deal-state ${s.cls}">${s.label}</span>`;
}
function place(country, address) {
    return [address, country].filter(Boolean).join(", ");
}
function customsText(country, place_, kind) {
    if (place_ === CUSTOMS_HERE) return kind === "export" ? "По місцю завантаження" : "По місцю розвантаження";
    return [place_, country].filter(Boolean).join(", ");
}
function dateCell(plan, fact) {
    if (!plan && !fact) return "—";
    return `${plan ? `<div class="deal-date-plan">план: ${fmtDate(plan)}</div>` : ""}${
        fact ? `<div class="deal-date-fact">факт: ${fmtDate(fact)}</div>` : ""
    }`;
}

/* ---------------- Завантаження ---------------- */

async function loadStaff(session) {
    const { data } = await sbClient.from("staff").select("*").order("full_name");
    staffCache = data || [];
    const email = (session.user?.email || "").toLowerCase();
    currentStaff = staffCache.find((s) => (s.email || "").toLowerCase() === email) || null;
}

async function loadDeals() {
    const { data, error } = await sbClient.from("deals").select("*").order("number", { ascending: false });
    if (error) {
        tableBody.innerHTML = `<tr><td colspan="11" class="empty-row">Помилка завантаження: ${escapeHtml(error.message)}<br>Можливо, ще не виконано deals.sql у Supabase.</td></tr>`;
        return;
    }
    dealsCache = data || [];
    renderTabs();
    renderDeals();
}

/* ---------------- Вкладки статусів ---------------- */

function renderTabs() {
    const count = (k) => dealsCache.filter((d) => !k || dealState(d) === k).length;
    const tabs = [{ key: "", label: "Усі", icon: "bx-list-ul" }, ...DEAL_STATES.map((s) => ({ ...s, icon: "bx-circle" }))];
    $("dealTabs").innerHTML = tabs
        .map(
            (t) => `<button type="button" class="lead-tab ${activeState === t.key ? "active" : ""}" data-key="${t.key}">
                ${escapeHtml(t.label)} <span class="lead-tab-count">${count(t.key)}</span></button>`,
        )
        .join("");
    $("dealTabs").querySelectorAll("[data-key]").forEach((b) =>
        b.addEventListener("click", () => {
            activeState = b.dataset.key;
            renderTabs();
            renderDeals();
        }),
    );
}

/* ---------------- Таблиця ---------------- */

function renderDeals() {
    const q = (searchInput.value || "").trim().toLowerCase();
    const rows = dealsCache.filter((d) => {
        if (activeState && dealState(d) !== activeState) return false;
        if (!q) return true;
        return [
            d.number, d.client, d.cargo, d.carrier_name, d.carrier_edrpou, d.truck_plate, d.trailer_plate, d.driver_name,
            d.driver_phone, d.load_country, d.load_address, d.unload_country, d.unload_address, d.border_crossing,
            d.logist_name, d.sales, d.notes,
        ]
            .join(" ")
            .toLowerCase()
            .includes(q);
    });

    $("dealsCountBar").innerHTML = `<span>${rows.length === dealsCache.length ? `Угод: ${dealsCache.length}` : `Показано: ${rows.length} з ${dealsCache.length}`}</span>`;

    if (!rows.length) {
        tableBody.innerHTML = `<tr><td colspan="11" class="empty-row">${dealsCache.length ? "Нічого не знайдено" : "Угод ще немає — натисніть «Нова угода»"}</td></tr>`;
        return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach((d) => {
        const tr = document.createElement("tr");
        tr.className = "clickable-row";
        tr.innerHTML = `
            <td class="deal-num">№ ${escapeHtml(d.number)}${d.copied_from ? `<div class="lead-sub">копія № ${escapeHtml(d.copied_from)}</div>` : ""}</td>
            <td>${stateBadge(d)}</td>
            <td><strong>${escapeHtml(d.client) || "—"}</strong>${d.cargo ? `<div class="lead-sub">${escapeHtml(d.cargo)}</div>` : ""}</td>
            <td class="deal-route">
                <div>${escapeHtml(place(d.load_country, d.load_address)) || "—"}</div>
                <div class="deal-arrow">↓ ${d.border_crossing ? escapeHtml(d.border_crossing) : ""}</div>
                <div>${escapeHtml(place(d.unload_country, d.unload_address)) || "—"}</div>
            </td>
            <td><strong>${escapeHtml(d.carrier_name) || "—"}</strong>${d.trailer_type ? `<div class="lead-sub">${escapeHtml(d.trailer_type)}</div>` : ""}</td>
            <td>
                ${d.truck_plate || d.trailer_plate ? `<div class="deal-plates">${escapeHtml([d.truck_plate, d.trailer_plate].filter(Boolean).join(" / "))}</div>` : ""}
                ${d.driver_name ? `<div>${escapeHtml(d.driver_name)}</div>` : ""}
                ${d.driver_phone ? `<div class="lead-sub"><a href="tel:+${escapeHtml(cleanPhone(d.driver_phone))}">${escapeHtml(d.driver_phone)}</a></div>` : ""}
                ${!d.truck_plate && !d.trailer_plate && !d.driver_name ? "—" : ""}
            </td>
            <td class="cell-date">${dateCell(d.load_date_plan, d.load_date)}</td>
            <td class="cell-date">${dateCell(d.unload_date_plan, d.unload_date)}</td>
            <td class="cell-person">${escapeHtml(d.logist_name) || "—"}</td>
            <td class="cell-person">${escapeHtml(d.sales) || "—"}</td>
            <td class="cell-actions">
                <button class="btn-icon" data-action="copy" title="Дублювати (нова угода з новим номером)"><i class='bx bx-copy'></i></button>
                <button class="btn-icon btn-icon-edit" data-action="edit" title="Редагувати"><i class='bx bx-edit'></i></button>
                <button class="btn-icon text-danger" data-action="delete" title="Видалити"><i class='bx bx-trash'></i></button>
            </td>`;
        tr.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-action]");
            if (btn?.dataset.action === "edit") return openDealModal(d);
            if (btn?.dataset.action === "copy") return openDealModal(d, { copy: true });
            if (btn?.dataset.action === "delete") return deleteDeal(d);
            if (e.target.closest("a")) return;
            openDealCard(d.id);
        });
        frag.appendChild(tr);
    });
    tableBody.innerHTML = "";
    tableBody.appendChild(frag);
}

searchInput.addEventListener("input", renderDeals);

async function deleteDeal(d) {
    if (!confirm(`Видалити угоду № ${d.number} (${d.client || "—"})?`)) return;
    const { error } = await sbClient.from("deals").delete().eq("id", d.id);
    if (error) return alert("Не вдалося видалити: " + error.message);
    await loadDeals();
}

/* ---------------- Підказки: клієнт (Ліди) і перевізник (реєстр) ---------------- */

// Прибираємо символи, які ламають пошуковий запит
const safeQ = (q) => q.replace(/[,()%*\\]/g, " ").trim();

function suggestBox(input, box, { search, render, onPick }) {
    let timer = null;
    let items = [];
    let reqNo = 0;
    input.addEventListener("input", (e) => {
        if (!e.isTrusted) return;
        onPick(null); // змінили текст — вибір скасовується
        clearTimeout(timer);
        const q = safeQ(input.value);
        if (q.length < 2) {
            box.hidden = true;
            return;
        }
        timer = setTimeout(async () => {
            const my = ++reqNo;
            box.hidden = false;
            box.innerHTML = `<div class="deal-sg-note">Шукаю…</div>`;
            items = await search(q);
            if (my !== reqNo) return;
            box.innerHTML = items.length
                ? items.map((it, i) => `<div class="deal-sg-item" data-i="${i}">${render(it)}</div>`).join("")
                : `<div class="deal-sg-note">Нічого не знайдено</div>`;
        }, 250);
    });
    box.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const el = e.target.closest("[data-i]");
        if (!el) return;
        onPick(items[Number(el.dataset.i)]);
        box.hidden = true;
    });
    input.addEventListener("blur", () => setTimeout(() => (box.hidden = true), 150));
}

function setClient(lead) {
    $("deal_lead_id").value = lead ? lead.id : "";
    if (lead) {
        $("deal_client").value = lead.name;
        if (lead.sales_id && !$("deal_sales").dataset.touched) $("deal_sales").value = lead.sales_id;
    }
}

function setCarrier(c) {
    $("deal_carrier_id").value = c ? c.id : "";
    $("deal_carrier_edrpou").value = c ? c.edrpou || "" : "";
    const hint = $("dealCarrierHint");
    if (c) {
        $("deal_carrier").value = c.name;
        if (!$("deal_trailer_type").value && c.trailer_type) $("deal_trailer_type").value = String(c.trailer_type).split(";")[0].trim();
        hint.innerHTML = `<span class="deal-ok"><i class='bx bx-check-circle'></i> З реєстру${c.edrpou ? ` · ЄДРПОУ/ІПН ${escapeHtml(c.edrpou)}` : ""}${
            c.phone_1 ? ` · ${escapeHtml(c.phone_1)}` : ""
        }</span>`;
    } else {
        hint.innerHTML = $("deal_carrier").value.trim()
            ? `<span class="deal-warn">Оберіть перевізника зі списку. Немає в реєстрі? <a href="index.html?new=1" target="_blank">Додати перевізника</a>, потім оберіть тут.</span>`
            : "";
    }
}

/* ---------------- Форма ---------------- */

function fillSelects() {
    const countryOpts = `<option value="">Оберіть країну...</option>` + COUNTRIES.map((c) => `<option value="${c}">${c}</option>`).join("");
    ["deal_load_country", "deal_unload_country", "deal_customs_export_country", "deal_customs_import_country"].forEach(
        (id) => ($(id).innerHTML = countryOpts),
    );
    $("dealBorderList").innerHTML = BORDER_CROSSINGS.map((b) => `<option value="${escapeHtml(b)}"></option>`).join("");
    $("dealTrailerList").innerHTML = TRAILERS.map((t) => `<option value="${t}"></option>`).join("");

    const active = staffCache.filter((s) => s.active !== false);
    const sales = active.filter((s) => hasRole(s, ["sales", "head"]));
    const logists = active.filter((s) => hasRole(s, ["logist"]));
    $("deal_sales").innerHTML = `<option value="">—</option>` + sales.map((s) => `<option value="${s.id}">${escapeHtml(s.full_name)}</option>`).join("");
    $("deal_logist").innerHTML = `<option value="">— не потрібно —</option>` + logists.map((s) => `<option value="${s.id}">${escapeHtml(s.full_name)}</option>`).join("");
}

$("deal_sales").addEventListener("change", (e) => (e.target.dataset.touched = "1"));
$("deal_logist").addEventListener("change", (e) => {
    const s = staffCache.find((x) => String(x.id) === e.target.value);
    $("deal_logist_phone").value = s?.phone ? cleanPhone(s.phone) : "";
});

function updateCustomsHere(kind) {
    const here = $(`deal_customs_${kind}_here`).checked;
    [`deal_customs_${kind}_country`, `deal_customs_${kind}`].forEach((id) => {
        $(id).disabled = here;
        if (here) $(id).value = "";
    });
}
["export", "import"].forEach((k) => $(`deal_customs_${k}_here`).addEventListener("change", () => updateCustomsHere(k)));

function setVal(id, v) {
    $(id).value = v === null || v === undefined ? "" : String(v).match(/^\d{4}-\d{2}-\d{2}T/) ? String(v).slice(0, 10) : v;
}

let editingDeal = null;

function openDealModal(deal = null, { copy = false } = {}) {
    dealForm.reset();
    editingDeal = copy ? null : deal;
    $("deal_sales").dataset.touched = deal ? "1" : "";
    const d = deal || {};

    setVal("dealId", copy ? "" : d.id);
    setVal("deal_copied_from", copy ? d.number : d.copied_from);
    setVal("deal_client", d.client);
    setVal("deal_lead_id", d.lead_id);
    setVal("deal_cargo", d.cargo);
    setVal("deal_kind", d.deal_kind || "FTL");
    setVal("deal_load_country", d.load_country || "");
    setVal("deal_load_address", d.load_address);
    setVal("deal_border_crossing", d.border_crossing);
    setVal("deal_unload_country", d.unload_country || "");
    setVal("deal_unload_address", d.unload_address);
    ["export", "import"].forEach((k) => {
        const placeV = d[`customs_${k}`];
        $(`deal_customs_${k}_here`).checked = placeV === CUSTOMS_HERE;
        setVal(`deal_customs_${k}_country`, placeV === CUSTOMS_HERE ? "" : d[`customs_${k}_country`]);
        setVal(`deal_customs_${k}`, placeV === CUSTOMS_HERE ? "" : placeV);
        updateCustomsHere(k);
    });
    setVal("deal_carrier", d.carrier_name);
    setVal("deal_carrier_id", d.carrier_id);
    setVal("deal_carrier_edrpou", d.carrier_edrpou);
    $("dealCarrierHint").innerHTML = d.carrier_id
        ? `<span class="deal-ok"><i class='bx bx-check-circle'></i> З реєстру${d.carrier_edrpou ? ` · ЄДРПОУ/ІПН ${escapeHtml(d.carrier_edrpou)}` : ""}</span>`
        : "";
    setVal("deal_trailer_type", d.trailer_type);
    setVal("deal_truck_plate", d.truck_plate);
    setVal("deal_trailer_plate", d.trailer_plate);
    setVal("deal_driver_name", d.driver_name);
    setVal("deal_driver_phone", d.driver_phone);

    // Відповідальні: для нової угоди — я (як Sales або логіст)
    const meSales = !deal && currentStaff && hasRole(currentStaff, ["sales", "head"]) ? currentStaff.id : "";
    const meLogist = !deal && currentStaff && hasRole(currentStaff, ["logist"]) ? currentStaff.id : "";
    $("deal_sales").value = d.sales_id || meSales || "";
    $("deal_logist").value = d.logist_id || meLogist || "";
    const lg = staffCache.find((x) => String(x.id) === $("deal_logist").value);
    setVal("deal_logist_phone", d.logist_phone || (lg?.phone ? cleanPhone(lg.phone) : ""));

    setVal("deal_load_date_plan", d.load_date_plan);
    setVal("deal_unload_date_plan", d.unload_date_plan);
    // Копія — фактичні дати не переносимо
    setVal("deal_load_date", copy ? "" : d.load_date);
    setVal("deal_unload_date", copy ? "" : d.unload_date);
    setVal("deal_notes", d.notes);

    $("dealModalTitle").textContent = copy
        ? `Нова угода — копія № ${d.number}`
        : deal
          ? `Угода № ${d.number}`
          : "Нова угода";
    modalOverlay.classList.add("active");
}

const closeDealModal = () => modalOverlay.classList.remove("active");
$("openDealModalBtn").addEventListener("click", () => openDealModal());
$("closeDealModalBtn").addEventListener("click", closeDealModal);
$("cancelDealBtn").addEventListener("click", closeDealModal);
modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeDealModal();
});

dealForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = (id) => {
        const x = $(id).value.trim();
        return x || null;
    };

    if (!v("deal_lead_id")) {
        alert("Оберіть клієнта зі списку Лідів (почніть вводити назву і клацніть на потрібного).");
        return $("deal_client").focus();
    }
    if (!v("deal_carrier_id")) {
        alert("Перевізник має бути з реєстру Перевізників.\n\nПочніть вводити назву і оберіть зі списку. Якщо його немає — спершу додайте в розділі «Перевізники».");
        return $("deal_carrier").focus();
    }

    const salesId = v("deal_sales");
    const logistId = v("deal_logist");
    const nameOf = (id) => staffCache.find((s) => String(s.id) === String(id))?.full_name || null;

    const payload = {
        lead_id: v("deal_lead_id"),
        client: v("deal_client"),
        cargo: v("deal_cargo"),
        deal_kind: v("deal_kind") || "FTL",
        load_country: v("deal_load_country"),
        load_address: v("deal_load_address"),
        customs_export_country: v("deal_customs_export_country"),
        customs_export: $("deal_customs_export_here").checked ? CUSTOMS_HERE : v("deal_customs_export"),
        border_crossing: v("deal_border_crossing"),
        customs_import_country: v("deal_customs_import_country"),
        customs_import: $("deal_customs_import_here").checked ? CUSTOMS_HERE : v("deal_customs_import"),
        unload_country: v("deal_unload_country"),
        unload_address: v("deal_unload_address"),
        carrier_id: v("deal_carrier_id"),
        carrier_name: v("deal_carrier"),
        carrier_edrpou: v("deal_carrier_edrpou"),
        trailer_type: v("deal_trailer_type"),
        truck_plate: v("deal_truck_plate")?.toUpperCase().replace(/\s+/g, "") || null,
        trailer_plate: v("deal_trailer_plate")?.toUpperCase().replace(/\s+/g, "") || null,
        driver_name: v("deal_driver_name"),
        driver_phone: v("deal_driver_phone") ? cleanPhone(v("deal_driver_phone")) : null,
        sales_id: salesId,
        sales: nameOf(salesId),
        logist_id: logistId,
        logist_name: nameOf(logistId),
        logist_phone: v("deal_logist_phone") ? cleanPhone(v("deal_logist_phone")) : null,
        load_date_plan: v("deal_load_date_plan"),
        load_date: v("deal_load_date"),
        unload_date_plan: v("deal_unload_date_plan"),
        unload_date: v("deal_unload_date"),
        notes: v("deal_notes"),
        copied_from: v("deal_copied_from") ? Number(v("deal_copied_from")) : null,
    };

    const id = v("dealId");
    const res = id
        ? await sbClient.from("deals").update(payload).eq("id", id).select().single()
        : await sbClient.from("deals").insert([payload]).select().single();
    if (res.error) return alert("Не вдалося зберегти: " + res.error.message);
    closeDealModal();
    await loadDeals();
    if (res.data) openDealCard(res.data.id);
});

/* ---------------- Угода на всю сторінку ---------------- */

const listView = $("dealsListView");
const detailView = $("dealDetailView");
let detailTab = "auto";

const DEAL_TABS = [
    { key: "auto", label: "Дані авто" },
    { key: "calc", label: "Розрахунок" },
    { key: "track", label: "Трекінг" },
    { key: "inv", label: "Рахунки" },
    { key: "inv_in", label: "Вхідні рахунки" },
    { key: "files", label: "Файли та примітки" },
    { key: "act", label: "Активності" },
];

const FLAGS = [
    ["paid_by_client", "Оплата від клієнта"],
    ["paid_to_carrier", "Оплата перевізнику"],
    ["originals_from_client", "Оригінали від клієнта"],
    ["originals_from_carrier", "Оригінали від перевізника"],
    ["confirmed_cfo", "Confirmed by CFO"],
];

const countryCode = (c) => ((window.furaCountryCode && window.furaCountryCode(c)) || "").toUpperCase();
const cityOf = (addr) => String(addr || "").split(",")[0].trim();
function shortPlace(country, addr) {
    const city = cityOf(addr);
    const code = countryCode(country) || country || "";
    return [city, code].filter(Boolean).join(", ") || "—";
}
function initials(name) {
    return String(name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase();
}
const money = (v) => `${Number(v || 0).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function dvField(label, valueHtml, cls = "") {
    return `<div class="dv-field ${cls}"><div class="dv-label">${label}</div><div class="dv-value">${valueHtml || "—"}</div></div>`;
}
function personRow(label, name) {
    return `<div class="dv-field"><div class="dv-label">${label}</div><div class="dv-value dv-person">${
        name ? `<span class="dv-avatar">${escapeHtml(initials(name))}</span>${escapeHtml(name)}` : "—"
    }</div></div>`;
}

function openDealCard(id, tab) {
    const d = dealsCache.find((x) => String(x.id) === String(id));
    if (!d) return;
    currentCardDealId = d.id;
    if (tab) detailTab = tab;
    renderDealView(d);
    listView.hidden = true;
    detailView.hidden = false;
    history.replaceState(null, "", `?open=${d.id}`);
    window.furaSetCrumbs?.([{ label: "Угоди", href: "deals.html" }, `№ ${d.number}`]);
}

function closeDealCard() {
    currentCardDealId = null;
    detailView.hidden = true;
    detailView.innerHTML = "";
    listView.hidden = false;
    history.replaceState(null, "", location.pathname);
    window.furaSetCrumbs?.(["Угоди"]);
}

function renderDealView(d) {
    const e = escapeHtml;
    const created = d.created_at ? fmtDate(String(d.created_at).slice(0, 10)) : "—";
    detailView.innerHTML = `
        <div class="dv-head">
            <h1 class="dv-num">№ ${e(d.number)}</h1>
            ${stateBadge(d)}
            <span class="dv-route">${e(shortPlace(d.load_country, d.load_address))} → ${e(shortPlace(d.unload_country, d.unload_address))}</span>
            <div class="dv-actions">
                <button type="button" class="btn btn-secondary" data-dv="copy"><i class="bx bx-copy"></i> Дублювати</button>
                <button type="button" class="btn btn-secondary" data-dv="close">Закрити</button>
                <button type="button" class="btn btn-primary" data-dv="edit"><i class="bx bx-edit"></i> Редагувати</button>
            </div>
        </div>

        <div class="dv-layout">
            <aside class="dv-side">
                <div class="dv-sec-title">Угода</div>
                ${dvField("Тип перевезення", e([d.deal_kind || "FTL", d.trailer_type].filter(Boolean).join(" · ")))}
                ${dvField("Клієнт <i class='req'>*</i>", d.client ? (d.lead_id ? `<a href="leads.html?open=${e(d.lead_id)}" class="dv-link">${e(d.client)}</a>` : e(d.client)) : "")}
                ${dvField("Вантаж", e(d.cargo))}
                ${dvField("Перевізник <i class='req'>*</i>", d.carrier_name ? `${e(d.carrier_name)} ${d.carrier_edrpou ? `<span class="dv-code">${e(d.carrier_edrpou)}</span>` : ""}` : "")}
                <div class="dv-sec-title dv-sec-gap">Відповідальні</div>
                ${personRow("Sales manager", d.sales)}
                ${personRow("Логіст", d.logist_name)}
            </aside>

            <div class="dv-main">
                <div class="dv-kpis">
                    <div class="dv-kpi"><div class="dv-label">План профіту</div><div class="dv-kpi-v">${money(0)}</div></div>
                    <div class="dv-kpi"><div class="dv-label">Факт профіту</div><div class="dv-kpi-v">${money(0)}</div></div>
                    <div class="dv-kpi"><div class="dv-label">Створено</div><div class="dv-kpi-v">${created}</div></div>
                    <div class="dv-kpi dv-flags">
                        ${FLAGS.map(([k, label]) => `<label class="dv-flag"><input type="checkbox" data-flag="${k}" ${d[k] ? "checked" : ""}/> ${label}</label>`).join("")}
                    </div>
                </div>

                <div class="dv-card">
                    <div class="dv-tabs">
                        ${DEAL_TABS.map((t) => `<button type="button" class="dv-tab ${t.key === detailTab ? "active" : ""}" data-tab="${t.key}">${t.label}</button>`).join("")}
                    </div>
                    <div class="dv-tab-body" id="dvTabBody"></div>
                </div>
            </div>
        </div>`;

    detailView.querySelector("[data-dv=close]").addEventListener("click", closeDealCard);
    detailView.querySelector("[data-dv=edit]").addEventListener("click", () => openDealModal(d));
    detailView.querySelector("[data-dv=copy]").addEventListener("click", () => openDealModal(d, { copy: true }));
    detailView.querySelectorAll("[data-tab]").forEach((b) =>
        b.addEventListener("click", () => {
            detailTab = b.dataset.tab;
            detailView.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
            renderTab(d);
        }),
    );
    detailView.querySelectorAll("[data-flag]").forEach((cb) =>
        cb.addEventListener("change", async () => {
            const k = cb.dataset.flag;
            const { error } = await sbClient.from("deals").update({ [k]: cb.checked }).eq("id", d.id);
            if (error) {
                cb.checked = !cb.checked;
                return alert("Не вдалося зберегти: " + error.message + "\n\nМожливо, ще не виконано deals_ui.sql.");
            }
            d[k] = cb.checked;
        }),
    );
    renderTab(d);
}

function renderTab(d) {
    const box = $("dvTabBody");
    const e = escapeHtml;
    if (detailTab === "auto") {
        box.innerHTML = `
            <div class="dv-block-title">Авто і водій</div>
            <div class="dv-grid">
                ${dvField("Номер тягача і причепа", e([d.truck_plate, d.trailer_plate].filter(Boolean).join("/")))}
                ${dvField("ПІБ водія", e(d.driver_name))}
                ${dvField("Телефон", d.driver_phone ? `<a href="tel:+${e(cleanPhone(d.driver_phone))}" class="dv-link">${e(d.driver_phone)}</a>` : "")}
                <div></div>
            </div>
            <div class="dv-block-title">Вантаж</div>
            <div class="dv-grid dv-grid-cargo">
                ${dvField("Назва вантажу", e(d.cargo))}
                ${dvField("Тип причепу", d.trailer_type ? `<span class="dv-trailer">${e(d.trailer_type)}</span>` : "")}
                ${dvField("Перевізник", e(d.carrier_name))}
            </div>
            <div class="dv-block-title">Маршрут</div>
            <div class="dv-route-cards">
                <div class="dv-rc">
                    <div class="dv-rc-title"><i class="dot blue"></i> Завантаження</div>
                    <div class="dv-rc-city">${e(cityOf(d.load_address)) || "—"}</div>
                    <div class="dv-rc-country">${e(d.load_country || "")}</div>
                    <div class="dv-rc-row"><span>План</span><b>${fmtDate(d.load_date_plan) || "—"}</b></div>
                    <div class="dv-rc-row"><span>Факт</span><b>${fmtDate(d.load_date) || "—"}</b></div>
                </div>
                <i class="bx bx-right-arrow-alt dv-rc-arrow"></i>
                <div class="dv-rc">
                    <div class="dv-rc-title"><i class="dot orange"></i> Митниця і кордон</div>
                    <div class="dv-rc-city">${e(String(d.border_crossing || "—").replace(/\s*\([A-Z]{2}\)$/, ""))}</div>
                    <div class="dv-rc-row dv-rc-small"><span>Замитнення</span><b>${e(customsText(d.customs_export_country, d.customs_export, "export")) || "—"}</b></div>
                    <div class="dv-rc-row dv-rc-small"><span>Розмитнення</span><b>${e(customsText(d.customs_import_country, d.customs_import, "import")) || "—"}</b></div>
                </div>
                <i class="bx bx-right-arrow-alt dv-rc-arrow"></i>
                <div class="dv-rc">
                    <div class="dv-rc-title"><i class="dot green"></i> Вивантаження</div>
                    <div class="dv-rc-city">${e(cityOf(d.unload_address)) || "—"}</div>
                    <div class="dv-rc-country">${e(d.unload_country || "")}</div>
                    <div class="dv-rc-row"><span>План</span><b>${fmtDate(d.unload_date_plan) || "—"}</b></div>
                    <div class="dv-rc-row"><span>Факт</span><b>${fmtDate(d.unload_date) || "—"}</b></div>
                </div>
            </div>`;
        return;
    }
    if (detailTab === "calc") {
        const route = [cityOf(d.load_address), cityOf(d.unload_address)].filter(Boolean).join(" — ") || "маршрут";
        box.innerHTML = `
            <div class="dv-dev"><i class="bx bx-time-five"></i> Розрахунок у розробці — поки це лише вигляд, дані не зберігаються.</div>
            <div class="dv-block-head"><div class="dv-block-title">Послуги перевезення</div><span class="dv-pill">Статус: Новий</span><button class="dv-ghost" disabled>+ Додати послугу</button></div>
            <div class="dv-grid">${dvField("Дата розрахунку", "")}<div></div>${dvField("Валюта", "EUR")}</div>
            <table class="dv-table"><thead><tr><th>Послуга</th><th>Платник / отримувач</th><th>Дохід</th><th>Витрати</th><th>Курс</th><th>Дохід, грн</th><th>Витрати, грн</th></tr></thead>
                <tbody><tr><td>Перевезення ${e(route)}</td><td>${e(d.client || "—")}</td><td>0,00</td><td>0,00</td><td>—</td><td>0,00</td><td>0,00</td></tr></tbody></table>
            <div class="dv-totals">
                <div class="dv-kpi"><div class="dv-label">Всього дохід</div><div class="dv-kpi-v">${money(0)}</div></div>
                <div class="dv-kpi"><div class="dv-label">Всього витрати</div><div class="dv-kpi-v">${money(0)}</div></div>
                <div class="dv-kpi"><div class="dv-label">Профіт</div><div class="dv-kpi-v green">${money(0)}</div></div>
                <button class="dv-invoice" disabled>Виставити рахунок на послуги</button>
            </div>
            <div class="dv-block-head"><div class="dv-block-title">Додаткові послуги</div><span class="dv-pill">Статус: Новий</span><button class="dv-ghost" disabled>+ Додати послугу</button></div>
            <table class="dv-table"><thead><tr><th>Послуга</th><th>Платник / отримувач</th><th>Дохід</th><th>Витрати</th><th>Дохід, грн</th><th>Витрати, грн</th></tr></thead>
                <tbody><tr><td colspan="6" class="dv-empty">Немає даних</td></tr></tbody></table>`;
        return;
    }
    if (detailTab === "track") {
        renderTrackTab(d, box);
        return;
    }
    if (detailTab === "inv" || detailTab === "inv_in") {
        box.innerHTML = `<div class="dv-dev"><i class="bx bx-time-five"></i> Розділ «${detailTab === "inv" ? "Рахунки" : "Вхідні рахунки"}» у розробці.</div>`;
        return;
    }
    if (detailTab === "files") {
        box.innerHTML = `
            <div class="dv-block-title">Примітки</div>
            <textarea id="dvNotes" class="dv-notes" rows="5" placeholder="Що важливо по угоді...">${e(d.notes || "")}</textarea>
            <div class="dv-notes-bar"><button type="button" class="btn btn-primary" id="dvNotesSave">Зберегти примітку</button><span id="dvNotesMsg"></span></div>
            <div class="dv-block-title">Файли</div>
            <div class="dv-dev"><i class="bx bx-time-five"></i> Завантаження файлів у розробці. Фото CMR від водія — у вкладці «Трекінг».</div>`;
        $("dvNotesSave").addEventListener("click", async () => {
            const notes = $("dvNotes").value.trim() || null;
            const { error } = await sbClient.from("deals").update({ notes }).eq("id", d.id);
            $("dvNotesMsg").textContent = error ? "Помилка: " + error.message : "Збережено ✓";
            if (!error) d.notes = notes;
        });
        return;
    }
    if (detailTab === "act") {
        const author = staffCache.find((s) => String(s.id) === String(d.created_by))?.full_name;
        const items = [
            [d.created_at, "Угоду створено", author ? `Автор: ${author}` : ""],
            d.copied_from ? [d.created_at, `Скопійовано з угоди № ${d.copied_from}`, ""] : null,
            d.load_date ? [d.load_date, "Завантажено (факт)", ""] : null,
            d.unload_date ? [d.unload_date, "Розвантажено (факт)", ""] : null,
            d.updated_at && d.updated_at !== d.created_at ? [d.updated_at, "Останні зміни", ""] : null,
        ].filter(Boolean);
        box.innerHTML = `<ul class="dv-act">${items
            .map(([at, t, sub]) => `<li><span class="dv-act-dot"></span><div><b>${e(t)}</b>${sub ? `<div class="dv-sub">${e(sub)}</div>` : ""}</div><span class="dv-act-time">${fmtDate(String(at).slice(0, 10))}</span></li>`)
            .join("")}</ul>`;
    }
}

/* ---------- Трекінг: рейс із розділу «Рейси» всередині угоди ---------- */

async function renderTrackTab(d, box) {
    box.innerHTML = `<div class="dv-empty">Завантаження трекінгу…</div>`;
    const { data, error } = await sbClient.from("trips").select("id, trip_no, status").eq("deal_id", d.id).order("created_at", { ascending: false }).limit(1);
    if (detailTab !== "track" || currentCardDealId !== d.id) return;
    if (error) {
        box.innerHTML = `<div class="dv-dev">Трекінг недоступний: ${escapeHtml(error.message)}<br>Можливо, ще не виконано deals_ui.sql.</div>`;
        return;
    }
    const trip = data?.[0];
    if (trip) {
        box.innerHTML = `
            <div class="dv-track-bar">Рейс № ${escapeHtml(trip.trip_no)} · <a href="trips.html?trip=${escapeHtml(trip.id)}" class="dv-link" target="_blank">відкрити в «Рейсах»</a></div>
            <iframe class="dv-track-frame" src="trips.html?embed=1&trip=${encodeURIComponent(trip.id)}" title="Трекінг рейсу"></iframe>`;
        return;
    }
    box.innerHTML = `
        <div class="dv-track-empty">
            <i class="bx bx-map-alt"></i>
            <div><b>Трекінг ще не запущено</b><br>Створіть рейс — дані угоди (адреси, водій, авто, дати) підставляться самі. Водій отримає код для застосунку «FURA Водій».</div>
            <button type="button" class="btn btn-primary" id="dvStartTrack"><i class="bx bx-send"></i> Запустити трекінг</button>
        </div>`;
    $("dvStartTrack").addEventListener("click", () => {
        box.innerHTML = `<iframe class="dv-track-frame" src="trips.html?embed=1&new_from_deal=${encodeURIComponent(d.id)}" title="Новий рейс"></iframe>`;
    });
}

// Повідомлення з вкладки «Трекінг» (рейс створено / форму закрили)
window.addEventListener("message", (ev) => {
    if (ev.origin !== location.origin || !ev.data?.type) return;
    const d = dealsCache.find((x) => String(x.id) === String(currentCardDealId));
    if (!d || detailTab !== "track") return;
    if (ev.data.type === "fura-trip-close") renderTab(d);
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
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeShlyahModal();
    closeDealModal();
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

    await loadStaff(session);
    fillSelects();

    suggestBox($("deal_client"), $("dealClientSuggest"), {
        search: async (q) => {
            const { data } = await sbClient.from("leads").select("id, name, edrpou, city, sales_id, sales").or(`name.ilike.%${q}%,edrpou.ilike.%${q}%`).limit(10);
            return data || [];
        },
        render: (l) => `<strong>${escapeHtml(l.name)}</strong><span>${escapeHtml([l.edrpou, l.city, l.sales].filter(Boolean).join(" · "))}</span>`,
        onPick: setClient,
    });
    suggestBox($("deal_carrier"), $("dealCarrierSuggest"), {
        search: async (q) => {
            const { data } = await sbClient
                .from("carriers")
                .select("id, name, edrpou, city, region_ukr, trailer_type, phone_1")
                .or(`name.ilike.%${q}%,edrpou.ilike.%${q}%`)
                .limit(12);
            return data || [];
        },
        render: (c) =>
            `<strong>${escapeHtml(c.name)}</strong><span>${escapeHtml([c.edrpou, c.city || c.region_ukr, c.trailer_type].filter(Boolean).join(" · "))}</span>`,
        onPick: setCarrier,
    });

    // Підказки адрес (address-suggest.js)
    if (window.furaAddressSuggest) {
        [
            ["deal_load_address", "deal_load_country"],
            ["deal_unload_address", "deal_unload_country"],
            ["deal_customs_export", "deal_customs_export_country"],
            ["deal_customs_import", "deal_customs_import_country"],
        ].forEach(([inp, sel]) => window.furaAddressSuggest($(inp), { countrySelect: $(sel), mode: "full" }));
    }

    await loadDeals();

    const params = new URLSearchParams(location.search);
    if (params.get("new") === "1") openDealModal();
    if (params.get("open")) openDealCard(params.get("open"));
    else if ([...params.keys()].length) history.replaceState(null, "", location.pathname);
});
