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
let tripByDeal = new Map(); // id угоди → її рейс

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
function tripMini(d) {
    const t = tripByDeal.get(String(d.id));
    if (!t) return "";
    return `<div class="deal-trip-mini" title="Трекінг рейсу"><i class="bx bx-map-pin"></i> рейс № ${escapeHtml(t.trip_no)} · ${escapeHtml((typeof TRIP_LABELS !== "undefined" && TRIP_LABELS[t.status]) || t.status)}</div>`;
}
// Етапи рейсу, які показуємо як статус угоди (коли трекінг запущено)
const TRIP_STATE_BADGE = {
    assigned: ["Чекає водія", "deal-st-plan"],
    confirmed: ["Водій підтвердив", "deal-st-plan"],
    to_loading: ["Їде на завантаження", "deal-st-road"],
    at_loading: ["Завантаження в процесі", "deal-st-road"],
    loaded: ["В дорозі", "deal-st-road"],
    at_border: ["На кордоні", "deal-st-late"],
    crossed_border: ["Пройшов кордон", "deal-st-road"],
    at_unloading: ["На розвантаженні", "deal-st-road"],
    unloaded: ["Доставлено", "deal-st-done"],
};
function stateBadge(d) {
    const t = typeof tripByDeal !== "undefined" ? tripByDeal.get(String(d.id)) : null;
    const ts = t && TRIP_STATE_BADGE[t.status];
    if (ts) return `<span class="deal-state ${ts[1]}" title="Статус з трекінгу рейсу № ${escapeHtml(t.trip_no)}"><i class="bx bx-map-pin"></i> ${ts[0]}</span>`;
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
    // Рейс кожної угоди — для позначки «Трекінг» у таблиці
    const { data: trs } = await sbClient
        .from("trips")
        .select("id, deal_id, trip_no, status, created_at")
        .not("deal_id", "is", null)
        .order("created_at", { ascending: true });
    tripByDeal = new Map((trs || []).map((t) => [String(t.deal_id), t]));
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
            <td class="deal-num">№ ${escapeHtml(d.number)}${d.deal_type ? `<div class="deal-type-mini">${escapeHtml(d.deal_type)}</div>` : ""}${d.copied_from ? `<div class="lead-sub">копія № ${escapeHtml(d.copied_from)}</div>` : ""}</td>
            <td>${stateBadge(d)}${tripMini(d)}</td>
            <td><strong>${escapeHtml(d.client) || "—"}</strong>${d.cargo ? `<div class="lead-sub">${escapeHtml(d.cargo)}</div>` : ""}</td>
            <td class="deal-route">
                <div>${escapeHtml(place(d.load_country, cityOf(d.load_address))) || "—"}</div>
                <div class="deal-arrow">↓ ${d.border_crossing ? escapeHtml(d.border_crossing) : ""}</div>
                <div>${escapeHtml(place(d.unload_country, cityOf(d.unload_address))) || "—"}</div>
            </td>
            <td><strong>${d.carrier_name && (d.carrier_id || d.carrier_edrpou) ? `<a href="#" ${d.carrier_id ? `data-carrier-card="${escapeHtml(d.carrier_id)}"` : `data-carrier-code="${escapeHtml(d.carrier_edrpou)}"`} class="fura-clink" title="Відкрити картку перевізника">${escapeHtml(d.carrier_name)}</a>` : escapeHtml(d.carrier_name) || "—"}</strong>${d.trailer_type ? `<div class="lead-sub">${escapeHtml(d.trailer_type)}</div>` : ""}</td>
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
            if (btn?.dataset.action === "edit") return openDealCard(d.id);
            if (btn?.dataset.action === "copy") return duplicateDeal(d);
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
    // Форма угоди — окрема сторінка (не маленьке вікно поверх)
    $("dealsListView").hidden = true;
    $("dealDetailView").hidden = true;
    modalOverlay.classList.add("active");
    modalOverlay.scrollTop = 0;
    window.furaSetCrumbs?.([
        { label: "Угоди", href: "deals.html" },
        copy ? `Копія № ${d.number}` : deal ? `№ ${d.number} — редагування` : "Нова угода",
    ]);
    setTimeout(() => (deal ? null : $("deal_client").focus()), 50);
}

function closeDealModal() {
    if (!modalOverlay.classList.contains("active")) return;
    modalOverlay.classList.remove("active");
    // Повертаємось туди, звідки прийшли: у відкриту угоду або до списку
    const d = dealsCache.find((x) => String(x.id) === String(currentCardDealId));
    if (d) openDealCard(d.id);
    else {
        $("dealsListView").hidden = false;
        window.furaSetCrumbs?.(["Угоди"]);
    }
}
$("openDealModalBtn").addEventListener("click", () => createDeal());
$("closeDealModalBtn").addEventListener("click", closeDealModal);
$("cancelDealBtn").addEventListener("click", closeDealModal);
// Форму переносимо всередину сторінки (замість спливаючого вікна)
document.querySelector("main.main-content")?.appendChild(modalOverlay);
modalOverlay.classList.add("deal-form-page");

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
    modalOverlay.classList.remove("active");
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
    ["originals_from_client", "Оригінали на клієнта"],
    ["originals_from_carrier", "Оригінали від перевізника"],
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

/* ---------------- Розрахунок: послуги (дохід від клієнта / витрати перевізнику) ---------------- */
// Як у 1С: стаття, кількість, ставка, ПДВ, валюта, курс → сума в УЕ (долари).
// Курс = скільки одиниць валюти за 1 долар (UAH ≈ 41, EUR ≈ 0,87, USD = 1).

const CALC_CURRENCIES = ["UAH", "EUR", "USD"];
const VAT_TYPES = ["З ПДВ 20%", "Без ПДВ", "ПДВ 0%", "Не ПДВ"];
// Статті доходу (як у 1С) і ПДВ, що ставиться автоматично
const ARTICLES = [
    { name: "Авто Саша 0%", vat: "ПДВ 0%" },
    { name: "Авто Саша з ПДВ", vat: "З ПДВ 20%" },
    { name: "Авто Саша не ПДВ", vat: "ПДВ 0%" },
    { name: "Авто Саша Профіт з ПДВ", vat: "З ПДВ 20%" },
    { name: "Авто Саша Профіт не ПДВ", vat: "Не ПДВ" },
    { name: "Додаткові витрати", vat: "" },
    { name: "Перетарка", vat: "" },
    { name: "Простой", vat: "" },
    { name: "ТЕО", vat: "" },
];
// Види оплати (рахунки) і їхня валюта
const PAY_ACCOUNTS = [
    { name: "GRANDAR BG LTD (UBB)", cur: "USD" },
    { name: "Аванс Маерск", cur: "USD" },
    { name: "Аванс МШК", cur: "USD" },
    { name: "БлюМ (EURO)", cur: "EUR" },
    { name: "БлюМ (ГРН)", cur: "UAH" },
    { name: "ВСТ БАНК (EURO)", cur: "EUR" },
    { name: "ВСТ БАНК (USD)", cur: "USD" },
    { name: "ВСТ БАНК (ГРН)", cur: "UAH" },
    { name: "Касса (UAH)", cur: "UAH" },
    { name: "Касса (USD)", cur: "USD" },
    { name: "Корпоративна карта", cur: "UAH" },
];
const CALC_STATUSES = ["Новий", "Погоджено", "Рахунок виставлено", "Оплачено"];

const num = (v) => {
    const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
    return isFinite(n) ? n : 0;
};
const fmt2 = (v) => Number(v || 0).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRate = (v) => (v ? Number(v).toLocaleString("uk-UA", { maximumFractionDigits: 4 }) : "");
const usd = (v) => `${fmt2(v)} $`;

function rowCalc(r) {
    const qty = num(r.qty) || 1;
    const inSum = qty * num(r.in_rate);
    const outSum = qty * num(r.out_rate);
    const inUe = num(r.in_fx) ? inSum / num(r.in_fx) : 0;
    const outUe = num(r.out_fx) ? outSum / num(r.out_fx) : 0;
    return { inSum, outSum, inUe, outUe };
}
function calcTotals(d) {
    const rows = Array.isArray(d.services) ? d.services : [];
    let income = 0, expense = 0;
    rows.forEach((r) => {
        const c = rowCalc(r);
        income += c.inUe;
        expense += c.outUe;
    });
    return { income, expense, profit: income - expense };
}

// Курс НБУ (скільки валюти за 1 долар); якщо не вдалося — вводиться вручну
// Курс НБУ на дату розрахунку (якщо дати немає — найсвіжіший, зокрема вже встановлений на завтра)
const nbuCache = new Map();
async function nbuFor(dateIso) {
    const ymd = (dt) => `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
    const tries = [];
    if (dateIso) tries.push(String(dateIso).slice(0, 10).replace(/-/g, ""));
    else {
        const t = new Date();
        const tm = new Date(t.getTime() + 86400000);
        tries.push(ymd(tm), ymd(t));
    }
    for (const key of tries) {
        if (nbuCache.has(key)) return nbuCache.get(key);
        try {
            const res = await fetch(`https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=${key}&json`);
            const list = await res.json();
            const uah = (cc) => list.find((x) => x.cc === cc)?.rate;
            const usdUah = uah("USD"), eurUah = uah("EUR");
            if (usdUah && eurUah) {
                const r = { USD: 1, UAH: usdUah, EUR: usdUah / eurUah, date: list[0]?.exchangedate };
                nbuCache.set(key, r);
                return r;
            }
        } catch {
            /* немає доступу до НБУ — курс вводиться вручну */
        }
    }
    return null;
}
let calcDealRef = null;
const loadNbu = () => nbuFor(calcDealRef?.calc_date);

function newServiceRow(d, title) {
    return { title: title || "", qty: 1, in_rate: "", in_vat: "Без ПДВ", in_cur: "EUR", in_fx: "", in_pay: "", out_rate: "", out_vat: "Без ПДВ", out_cur: "EUR", out_fx: "", out_pay: "", note: "" };
}

let calcSaveTimer = null;
function saveServicesSoon(d) {
    clearTimeout(calcSaveTimer);
    calcSaveTimer = setTimeout(() => saveDeal(d, { services: d.services }), 700);
}

function updateProfitKpis(d) {
    const t = calcTotals(d);
    if ($("dvPlanProfit")) $("dvPlanProfit").textContent = usd(t.profit);
    if ($("dvFactProfit")) $("dvFactProfit").textContent = usd(d.paid_by_client && d.paid_to_carrier ? t.profit : 0);
    if ($("dvCalcIncome")) $("dvCalcIncome").textContent = usd(t.income);
    if ($("dvCalcExpense")) $("dvCalcExpense").textContent = usd(t.expense);
    if ($("dvCalcProfit")) {
        $("dvCalcProfit").textContent = usd(t.profit);
        $("dvCalcProfit").classList.toggle("neg", t.profit < 0);
    }
}

function renderCalc(d, box) {
    const e = escapeHtml;
    calcDealRef = d;
    if (!Array.isArray(d.services) || !d.services.length) d.services = [newServiceRow(d, "")];
    const sel = (list, v, cls, f, ph) => `<select class="cc-in ${cls || ""}" data-c="${f}">${optList(list, v, ["title", "in_pay", "out_pay"].includes(f) ? "— оберіть —" : undefined)}</select>`;
    const inp = (v, f, cls, ph) => `<input class="cc-in ${cls || ""}" data-c="${f}" value="${e(v ?? "")}" ${ph ? `placeholder="${ph}"` : ""} />`;
    const rowsHtml = d.services
        .map((r, i) => {
            const c = rowCalc(r);
            return `<tr data-i="${i}">
                <td class="cc-n">${i + 1}</td>
                <td>${sel(ARTICLES.map((a) => a.name), r.title, "cc-title", "title")}</td>
                <td>${inp(r.qty, "qty", "cc-num cc-qty")}</td>
                <td class="cc-in-side">${inp(r.in_rate, "in_rate", "cc-num", "0,00")}</td>
                <td class="cc-in-side">${sel(VAT_TYPES, r.in_vat, "cc-vat", "in_vat")}</td>
                <td class="cc-in-side cc-sum" data-o="inSum">${fmt2(c.inSum)}</td>
                <td class="cc-in-side">${sel(CALC_CURRENCIES, r.in_cur, "cc-cur", "in_cur")}</td>
                <td class="cc-in-side">${inp(fmtRate(r.in_fx), "in_fx", "cc-num cc-fx", "курс")}</td>
                <td class="cc-in-side cc-sum cc-ue" data-o="inUe">${fmt2(c.inUe)}</td>
                <td class="cc-in-side">${sel(PAY_ACCOUNTS.map((a) => a.name), r.in_pay, "cc-pay", "in_pay")}</td>
                <td class="cc-out-side">${inp(r.out_rate, "out_rate", "cc-num", "0,00")}</td>
                <td class="cc-out-side">${sel(VAT_TYPES, r.out_vat, "cc-vat", "out_vat")}</td>
                <td class="cc-out-side cc-sum cc-red" data-o="outSum">${fmt2(c.outSum)}</td>
                <td class="cc-out-side">${sel(CALC_CURRENCIES, r.out_cur, "cc-cur", "out_cur")}</td>
                <td class="cc-out-side">${inp(fmtRate(r.out_fx), "out_fx", "cc-num cc-fx", "курс")}</td>
                <td class="cc-out-side cc-sum cc-ue cc-red" data-o="outUe">${fmt2(c.outUe)}</td>
                <td class="cc-out-side">${sel(PAY_ACCOUNTS.map((a) => a.name), r.out_pay, "cc-pay", "out_pay")}</td>
                <td>${inp(r.note, "note", "cc-note", "Примітка")}</td>
                <td><button type="button" class="cc-del" data-del="${i}" title="Видалити рядок">✕</button></td>
            </tr>`;
        })
        .join("");
    const t = calcTotals(d);
    box.innerHTML = `
        <div class="dv-block-head">
            <div class="dv-block-title">Послуги перевезення</div>
            <button type="button" class="dv-ghost dv-ghost-right" id="ccAdd">+ Додати рядок</button>
        </div>
        <div class="dv-grid dv-grid-calc">
            <div class="dv-field"><div class="dv-label">Дата розрахунку</div>
                <input type="date" class="dv-in" data-f="calc_date" value="${e(String(d.calc_date || "").slice(0, 10))}" /></div>
        </div>
        <div class="cc-wrap">
            <table class="cc-table">
                <thead>
                    <tr class="cc-group">
                        <th colspan="3"></th>
                        <th colspan="7" class="cc-in-side">Дохід</th>
                        <th colspan="7" class="cc-out-side">Витрати</th>
                        <th colspan="2"></th>
                    </tr>
                    <tr>
                        <th>№</th><th>Стаття доходу</th><th>Кіл.</th>
                        <th class="cc-in-side">Ставка</th><th class="cc-in-side">ПДВ</th><th class="cc-in-side">Дохід</th><th class="cc-in-side">Вал.</th><th class="cc-in-side">Курс</th><th class="cc-in-side">Дохід УЕ</th><th class="cc-in-side">Вид оплати</th>
                        <th class="cc-out-side">Ставка</th><th class="cc-out-side">ПДВ</th><th class="cc-out-side">Витрати</th><th class="cc-out-side">Вал.</th><th class="cc-out-side">Курс</th><th class="cc-out-side">Витрати УЕ</th><th class="cc-out-side">Вид оплати</th>
                        <th>Примітка</th><th></th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>

        </div>
        <div class="dv-totals">
            <div class="dv-kpi"><div class="dv-label">Всього дохід</div><div class="dv-kpi-v" id="dvCalcIncome">${usd(t.income)}</div></div>
            <div class="dv-kpi"><div class="dv-label">Всього витрати</div><div class="dv-kpi-v cc-red" id="dvCalcExpense">${usd(t.expense)}</div></div>
            <div class="dv-kpi"><div class="dv-label">Профіт</div><div class="dv-kpi-v green ${t.profit < 0 ? "neg" : ""}" id="dvCalcProfit">${usd(t.profit)}</div></div>
            <button class="dv-invoice" disabled title="Скоро">Виставити рахунок на послуги</button>
        </div>`;

    bindFields(box, d);
    // Нова дата розрахунку — курси НБУ на цю дату
    box.querySelector("[data-f=calc_date]")?.addEventListener("change", async (ev) => {
        d.calc_date = ev.target.value || null;
        const rates = await loadNbu();
        if (!rates) return;
        d.services.forEach((r) => ["in", "out"].forEach((side) => (r[`${side}_fx`] = +Number(rates[r[`${side}_cur`]] || 0).toFixed(4) || "")));
        saveServicesSoon(d);
        renderCalc(d, box);
    });

    // Зміна будь-якої клітинки — перерахунок рядка, підсумків і збереження
    box.querySelector("tbody").addEventListener("input", (ev) => onCell(ev, d, box));
    box.querySelector("tbody").addEventListener("change", (ev) => onCell(ev, d, box, true));
    box.querySelectorAll("[data-del]").forEach((b) =>
        b.addEventListener("click", () => {
            const i = Number(b.dataset.del);
            if (d.services.length === 1 && !confirm("Очистити останній рядок?")) return;
            d.services.splice(i, 1);
            saveServicesSoon(d);
            updateProfitKpis(d);
            renderCalc(d, box);
        }),
    );
    $("ccAdd").addEventListener("click", () => {
        d.services.push(newServiceRow(d, ""));
        saveServicesSoon(d);
        renderCalc(d, box);
        box.querySelector(`tr[data-i="${d.services.length - 1}"] .cc-title`)?.focus();
    });

    // Порожній курс — підставляємо курс НБУ (якщо доступний)
    loadNbu().then((rates) => {
        if (!rates) return;
        let changed = false;
        d.services.forEach((r, i) => {
            ["in", "out"].forEach((side) => {
                if (!r[`${side}_fx`] && rates[r[`${side}_cur`]]) {
                    r[`${side}_fx`] = +rates[r[`${side}_cur`]].toFixed(4);
                    const el = box.querySelector(`tr[data-i="${i}"] [data-c="${side}_fx"]`);
                    if (el) el.value = fmtRate(r[`${side}_fx`]);
                    changed = true;
                }
            });
        });
        if (changed) {
            refreshCalcRows(d, box);
            saveServicesSoon(d);
        }
    });
}

function refreshCalcRows(d, box) {
    box.querySelectorAll("tbody tr[data-i]").forEach((tr) => {
        const c = rowCalc(d.services[Number(tr.dataset.i)] || {});
        tr.querySelectorAll("[data-o]").forEach((td) => (td.textContent = fmt2(c[td.dataset.o])));
    });
    updateProfitKpis(d);
}

async function onCell(ev, d, box, isChange) {
    const el = ev.target.closest("[data-c]");
    if (!el) return;
    const tr = el.closest("tr[data-i]");
    const r = d.services[Number(tr.dataset.i)];
    const f = el.dataset.c;
    r[f] = ["qty", "in_rate", "out_rate", "in_fx", "out_fx"].includes(f) ? (el.value.trim() === "" ? "" : num(el.value)) : el.value;
    // Стаття → ПДВ підставляється сам
    if (isChange && f === "title") {
        const a = ARTICLES.find((x) => x.name === r.title);
        if (a?.vat) {
            r.in_vat = r.out_vat = a.vat;
            tr.querySelectorAll('[data-c="in_vat"],[data-c="out_vat"]').forEach((x) => (x.value = a.vat));
        }
    }
    // Вид оплати → валюта цього рахунку (і курс)
    let curChanged = null;
    if (isChange && (f === "in_pay" || f === "out_pay")) {
        const side = f.slice(0, -4);
        const acc = PAY_ACCOUNTS.find((x) => x.name === r[f]);
        if (acc && acc.cur !== r[`${side}_cur`]) {
            r[`${side}_cur`] = acc.cur;
            const c = tr.querySelector(`[data-c="${side}_cur"]`);
            if (c) c.value = acc.cur;
            curChanged = `${side}_cur`;
        }
    }
    // Змінили валюту — ставимо курс НБУ для неї
    const fCur = curChanged || f;
    if (isChange && (fCur === "in_cur" || fCur === "out_cur")) {
        const f = fCur;
        const side = f.slice(0, -4);
        const rates = await loadNbu();
        r[`${side}_fx`] = r[f] === "USD" ? 1 : rates?.[r[f]] ? +rates[r[f]].toFixed(4) : "";
        const fx = tr.querySelector(`[data-c="${side}_fx"]`);
        if (fx) fx.value = fmtRate(r[`${side}_fx`]);
    }
    refreshCalcRows(d, box);
    saveServicesSoon(d);
}

/* ---------- Кілька точок завантаження і замитнення (кнопка «+») ---------- */
function extraLoadsHtml(d) {
    const e = escapeHtml;
    const list = Array.isArray(d.extra_loads) ? d.extra_loads : [];
    return (
        list
            .map(
                (p, i) => `
        <div class="dv-extra" data-x="extra_loads" data-i="${i}">
            <div class="dv-extra-head"><span>Точка завантаження ${i + 2}</span><button type="button" class="dv-x-del" data-xdel title="Прибрати точку">✕</button></div>
            <select class="dv-in dv-rc-country-in" data-xf="country">${optList(COUNTRIES, p.country, "Країна…")}</select>
            <input class="dv-in dv-rc-city-in" data-xf="address" value="${e(p.address || "")}" placeholder="Місто, село, індекс" />
            <div class="dv-rc-row"><span>План</span><input type="date" class="dv-in dv-date" data-xf="date_plan" value="${e(p.date_plan || "")}" /></div>
            <div class="dv-rc-row"><span>Факт</span><input type="date" class="dv-in dv-date" data-xf="date" value="${e(p.date || "")}" /></div>
        </div>`,
            )
            .join("") + `<button type="button" class="dv-add" data-xadd="extra_loads">+ Ще точка завантаження</button>`
    );
}

function extraCustomsHtml(d) {
    const e = escapeHtml;
    const list = Array.isArray(d.extra_customs) ? d.extra_customs : [];
    return (
        list
            .map(
                (p, i) => `
        <div class="dv-extra" data-x="extra_customs" data-i="${i}">
            <div class="dv-extra-head"><span>Замитнення ${i + 2}</span><button type="button" class="dv-x-del" data-xdel title="Прибрати">✕</button></div>
            <div class="dv-customs-in">
                <select class="dv-in" data-xf="country">${optList(COUNTRIES, p.country, "Країна…")}</select>
                <input class="dv-in" data-xf="place" value="${e(p.place || "")}" placeholder="Місто митниці" />
            </div>
        </div>`,
            )
            .join("") + `<button type="button" class="dv-add" data-xadd="extra_customs">+ Ще замитнення</button>`
    );
}

function bindExtras(box, d) {
    const listOf = (k) => (Array.isArray(d[k]) ? d[k] : (d[k] = []));
    box.querySelectorAll("[data-xadd]").forEach((b) =>
        b.addEventListener("click", async () => {
            const k = b.dataset.xadd;
            listOf(k).push({});
            await saveDeal(d, { [k]: d[k] });
            renderTab(d);
        }),
    );
    box.querySelectorAll(".dv-extra").forEach((row) => {
        const k = row.dataset.x;
        const i = Number(row.dataset.i);
        row.querySelector("[data-xdel]").addEventListener("click", async () => {
            listOf(k).splice(i, 1);
            await saveDeal(d, { [k]: d[k] });
            renderTab(d);
        });
        row.querySelectorAll("[data-xf]").forEach((el) =>
            el.addEventListener("change", () => {
                listOf(k)[i][el.dataset.xf] = el.value.trim() || null;
                saveDeal(d, { [k]: d[k] });
            }),
        );
        // Підказки міст для додаткових точок
        const addr = row.querySelector('[data-xf="address"], [data-xf="place"]');
        const ctry = row.querySelector('[data-xf="country"]');
        if (addr && window.furaAddressSuggest) window.furaAddressSuggest(addr, { countrySelect: ctry, mode: "full" });
    });
}

/* ---------------- Редагування прямо на сторінці угоди ---------------- */

const DEAL_TYPES = ["Імпорт", "Експорт", "Внутрішнє", "Move gray"];

// Розділи вкладки можна згортати стрілочкою (запам'ятовується в цьому браузері)
function makeCollapsible(root) {
    let closed = [];
    try {
        closed = JSON.parse(localStorage.getItem("fura_deal_collapsed") || "[]");
    } catch {
        /* без пам'яті — все відкрите */
    }
    root.querySelectorAll(".dv-block-title").forEach((t) => {
        const name = t.textContent.trim();
        const body = t.nextElementSibling;
        if (!body) return;
        t.classList.add("dv-collapsible");
        t.insertAdjacentHTML("afterbegin", `<i class="bx bx-chevron-down dv-chev"></i>`);
        const apply = (isClosed) => {
            t.classList.toggle("closed", isClosed);
            body.hidden = isClosed;
        };
        apply(closed.includes(name));
        t.addEventListener("click", () => {
            const isClosed = !t.classList.contains("closed");
            apply(isClosed);
            closed = isClosed ? [...new Set([...closed, name])] : closed.filter((x) => x !== name);
            try {
                localStorage.setItem("fura_deal_collapsed", JSON.stringify(closed));
            } catch {
                /* не страшно */
            }
        });
    });
}

// Типи причепів — усі, що є в реєстрі перевізників (+ базові)
let trailerTypes = [...TRAILERS];
async function loadTrailerTypes() {
    try {
        const cached = JSON.parse(sessionStorage.getItem("fura_trailer_types") || "null");
        if (Array.isArray(cached) && cached.length) return (trailerTypes = cached);
    } catch {
        /* немає пам'яті браузера — просто завантажимо */
    }
    const set = new Set(TRAILERS);
    const CHUNK = 1000;
    for (let from = 0; from < 50000; from += CHUNK) {
        const { data, error } = await sbClient.from("carriers").select("trailer_type").not("trailer_type", "is", null).range(from, from + CHUNK - 1);
        if (error || !data?.length) break;
        data.forEach((r) =>
            String(r.trailer_type)
                .split(/[;,]/)
                .map((t) => t.replace(/\(.*?\)/g, "").trim().toUpperCase())
                .filter((t) => t && t.length < 40)
                .forEach((t) => set.add(t)),
        );
        if (data.length < CHUNK) break;
    }
    trailerTypes = [...set].sort((a, b) => a.localeCompare(b, "uk"));
    try {
        sessionStorage.setItem("fura_trailer_types", JSON.stringify(trailerTypes));
    } catch {
        /* не страшно */
    }
    return trailerTypes;
}

// Кнопка «написати у Viber» (одразу відкриває переписку з цим номером)
function viberBtn(phone) {
    const digits = String(phone || "").split(",")[0].replace(/\D/g, "");
    if (!digits) return "";
    return `<a class="dv-viber" href="viber://chat?number=%2B${digits}" title="Написати у Viber"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M11.4 2C8.5 2 3 2.7 3 9.9c0 3.5 1.2 5.8 3.3 6.9V20c0 .5.6.8 1 .4l2.2-2.5h1.9c2.9 0 8.6-.7 8.6-8 0-7.2-5.7-7.9-8.6-7.9zm4.4 11.5c-.3.6-1 1.2-1.7 1.3-.5.1-1.1.1-3-.7-2.4-1-4-3.4-4.1-3.6-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.7 1.1 1.4 1.8 1 .9 1.8 1.1 2.1 1.3.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.8.9c.3.1.4.2.5.3 0 .1 0 .7-.3 1.3z"/></svg></a>`;
}

function optList(list, selected, placeholder) {
    const has = selected && !list.includes(selected);
    return (
        (placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : "") +
        (has ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>` : "") +
        list.map((v) => `<option value="${escapeHtml(v)}" ${v === selected ? "selected" : ""}>${escapeHtml(v)}</option>`).join("")
    );
}

function staffOpts(roles, selectedId, legacyName) {
    const list = staffCache.filter((s) => (s.active !== false && hasRole(s, roles)) || String(s.id) === String(selectedId));
    let html = `<option value="">— не вибрано —</option>`;
    if (!selectedId && legacyName) html += `<option value="" selected>${escapeHtml(legacyName)}</option>`;
    return html + list.map((s) => `<option value="${s.id}" ${String(s.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(s.full_name)}</option>`).join("");
}

let savedTimer = null;
function flashSaved(text, bad = false) {
    const el = $("dvSaved");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("bad", bad);
    el.classList.add("show");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => el.classList.remove("show"), bad ? 6000 : 1600);
}

// Зберегти зміну одразу в базу і оновити шапку (маршрут, статус)
async function saveDeal(d, patch) {
    flashSaved("Зберігаю…");
    const { error } = await sbClient.from("deals").update(patch).eq("id", d.id);
    if (error) {
        flashSaved("Не збережено: " + error.message, true);
        return false;
    }
    Object.assign(d, patch);
    const c = dealsCache.find((x) => x.id === d.id);
    if (c && c !== d) Object.assign(c, patch);
    if ($("dvRoute")) $("dvRoute").textContent = `${shortPlace(d.load_country, d.load_address)} → ${shortPlace(d.unload_country, d.unload_address)}`;
    if ($("dvState")) $("dvState").innerHTML = stateBadge(d);
    flashSaved("Збережено ✓");
    syncTrip(d, patch);
    return true;
}

// Усі поля з data-f зберігаються, щойно їх змінили
function bindFields(root, d) {
    root.querySelectorAll("[data-f]").forEach((el) =>
        el.addEventListener("change", () => {
            let v = el.value.trim();
            if (el.dataset.up) v = v.toUpperCase().replace(/\s+/g, "");
            if (el.dataset.phone && v) v = cleanPhone(v);
            if (el.value !== v) el.value = v;
            const f = el.dataset.f;
            if ((d[f] ?? "") === v) return;
            saveDeal(d, { [f]: v || null });
        }),
    );
}

function bindSide(d) {
    const side = detailView.querySelector(".dv-side");
    bindFields(side, d);

    // Клієнт — тільки з Лідів
    suggestBox($("dvClient"), $("dvClientSg"), {
        search: async (q) => {
            const { data } = await sbClient.from("leads").select("id, name, edrpou, city, sales_id, sales").or(`name.ilike.%${q}%,edrpou.ilike.%${q}%`).limit(10);
            return data || [];
        },
        render: (l) => `<strong>${escapeHtml(l.name)}</strong><span>${escapeHtml([l.edrpou, l.city, l.sales].filter(Boolean).join(" · "))}</span>`,
        onPick: async (l) => {
            if (!l) return;
            const patch = { lead_id: l.id, client: l.name };
            if (!d.sales_id && l.sales_id) Object.assign(patch, { sales_id: l.sales_id, sales: l.sales || null });
            $("dvClient").value = l.name;
            if (await saveDeal(d, patch)) renderDealView(d);
        },
    });
    $("dvClient").addEventListener("blur", () => setTimeout(() => ($("dvClient") ? ($("dvClient").value = d.client || "") : null), 250));

    // Перевізник — тільки з реєстру
    suggestBox($("dvCarrier"), $("dvCarrierSg"), {
        search: async (q) => {
            const { data } = await sbClient.from("carriers").select("id, name, edrpou, city, region_ukr, trailer_type, phone_1, contact_person_1").or(`name.ilike.%${q}%,edrpou.ilike.%${q}%`).limit(12);
            return data || [];
        },
        render: (c) => `<strong>${escapeHtml(c.name)}</strong><span>${escapeHtml([c.edrpou, c.city || c.region_ukr, c.trailer_type].filter(Boolean).join(" · "))}</span>`,
        onPick: async (c) => {
            if (!c) return;
            const patch = { carrier_id: String(c.id), carrier_name: c.name, carrier_edrpou: c.edrpou || null };
            if (!d.trailer_type && c.trailer_type) patch.trailer_type = String(c.trailer_type).split(";")[0].trim();
            // Логіст перевізника — перший контакт з реєстру
            if (c.contact_person_1 || c.phone_1) {
                patch.carrier_contact = c.contact_person_1 || null;
                patch.carrier_phone = c.phone_1 ? cleanPhone(c.phone_1) : null;
            }
            $("dvCarrier").value = c.name;
            if (await saveDeal(d, patch)) renderDealView(d);
        },
    });
    $("dvCarrier").addEventListener("blur", () => setTimeout(() => ($("dvCarrier") ? ($("dvCarrier").value = d.carrier_name || "") : null), 250));

    // Відповідальні
    const nameOf = (id) => staffCache.find((s) => String(s.id) === String(id));
    $("dvSales").addEventListener("change", async (ev) => {
        const s = nameOf(ev.target.value);
        if (await saveDeal(d, { sales_id: s?.id || null, sales: s?.full_name || null })) $("dvSalesAv").textContent = initials(s?.full_name) || "?";
    });
    $("dvLogist").addEventListener("change", async (ev) => {
        const s = nameOf(ev.target.value);
        const patch = { logist_id: s?.id || null, logist_name: s?.full_name || null };
        if (s?.phone) patch.logist_phone = cleanPhone(s.phone);
        if (await saveDeal(d, patch)) $("dvLogistAv").textContent = initials(s?.full_name) || "?";
    });
}

// Нова угода: створюється одразу і відкривається — поля заповнюються прямо на сторінці
async function createDeal(lead = null) {
    const me = currentStaff;
    const payload = { deal_kind: "FTL" };
    // З картки клієнта: deals.html?new=1&lead=ID — одразу з цим клієнтом
    if (lead) {
        Object.assign(payload, { lead_id: lead.id, client: lead.name });
        // Договір клієнта — одразу в угоду
        if (lead.contract_no) {
            const dt = lead.contract_date ? String(lead.contract_date).slice(0, 10).split("-").reverse().join(".") : "";
            payload.contract = `№ ${lead.contract_no}${dt ? ` від ${dt}` : ""}`;
        }
    }
    if (me && hasRole(me, ["sales", "head"])) Object.assign(payload, { sales_id: me.id, sales: me.full_name });
    if (me && hasRole(me, ["logist"])) Object.assign(payload, { logist_id: me.id, logist_name: me.full_name, logist_phone: me.phone ? cleanPhone(me.phone) : null });
    const { data, error } = await sbClient.from("deals").insert([payload]).select().single();
    if (error) return alert("Не вдалося створити угоду: " + error.message);
    await loadDeals();
    openDealCard(data.id, "auto");
    setTimeout(() => $("dvClient")?.focus(), 100);
}

// Дублювати: нова угода з новим номером, ті самі дані без фактичних дат і галочок
async function duplicateDeal(d) {
    const skip = new Set(["id", "number", "created_at", "updated_at", "created_by", "load_date", "unload_date",
        "paid_by_client", "originals_from_client", "confirmed_cfo", "paid_to_carrier", "originals_from_carrier"]);
    const payload = Object.fromEntries(Object.entries(d).filter(([k]) => !skip.has(k)));
    payload.copied_from = d.number;
    const { data, error } = await sbClient.from("deals").insert([payload]).select().single();
    if (error) return alert("Не вдалося дублювати: " + error.message);
    await loadDeals();
    openDealCard(data.id, "auto");
    flashSaved(`Копія угоди № ${d.number} створена`);
}

let replaceNextOpen = false;
function openDealCard(id, tab, fromHistory = false) {
    const d = dealsCache.find((x) => String(x.id) === String(id));
    if (!d) return;
    currentCardDealId = d.id;
    if (tab) detailTab = tab;
    renderDealView(d);
    listView.hidden = true;
    detailView.hidden = false;
    // Кнопки «назад / вперед» повертають між списком і угодами
    if (!fromHistory) {
        if (replaceNextOpen || new URLSearchParams(location.search).get("open") === String(d.id)) {
            replaceNextOpen = false;
            history.replaceState(null, "", `?open=${d.id}`);
        }
        else history.pushState(null, "", `?open=${d.id}`);
    }
    window.furaSetCrumbs?.([{ label: "Угоди", href: "deals.html" }, `№ ${d.number}`]);
}

function closeDealCard(fromHistory = false) {
    currentCardDealId = null;
    detailView.hidden = true;
    detailView.innerHTML = "";
    listView.hidden = false;
    if (fromHistory !== true && location.search) history.pushState(null, "", location.pathname);
    window.furaSetCrumbs?.(["Угоди"]);
}

function renderDealView(d) {
    const e = escapeHtml;
    const created = d.created_at ? fmtDate(String(d.created_at).slice(0, 10)) : "—";
    detailView.innerHTML = `
        <div class="dv-head">
            <h1 class="dv-num">№ ${e(d.number)}</h1>
            <span id="dvState">${stateBadge(d)}</span>
            <span class="dv-route" id="dvRoute">${e(shortPlace(d.load_country, d.load_address))} → ${e(shortPlace(d.unload_country, d.unload_address))}</span>
            <div class="dv-actions">
                <span class="dv-saved" id="dvSaved"></span>
                <button type="button" class="btn btn-secondary dv-del" data-dv="delete" title="Видалити угоду"><i class="bx bx-trash"></i></button>
                <button type="button" class="btn btn-secondary" data-dv="copy"><i class="bx bx-copy"></i> Дублювати</button>
                <button type="button" class="btn btn-primary" data-dv="close"><i class="bx bx-check"></i> Готово</button>
            </div>
        </div>

        <div class="dv-layout">
            <aside class="dv-side">
                <div class="dv-sec-title">Угода</div>
                <div class="dv-field"><div class="dv-label">Тип угоди</div>
                    <select class="dv-in" data-f="deal_type">${optList(DEAL_TYPES, d.deal_type, "Оберіть…")}</select></div>
                <div class="dv-field deal-pick"><div class="dv-label">Клієнт <i class='req'>*</i>
                    ${d.lead_id ? `<a href="clients.html?open=${e(d.lead_id)}" class="dv-mini-link" title="Відкрити картку клієнта"><i class="bx bx-link-external"></i></a>` : ""}</div>
                    <input class="dv-in" id="dvClient" value="${e(d.client || "")}" placeholder="Почніть вводити назву або ЄДРПОУ…" autocomplete="off" />
                    <div class="deal-suggest" id="dvClientSg" hidden></div></div>
                <div class="dv-field"><div class="dv-label">Договір</div>
                    <input class="dv-in" data-f="contract" value="${e(d.contract || "")}" placeholder="№ і дата договору" /></div>
                <div class="dv-field deal-pick"><div class="dv-label">Перевізник <i class='req'>*</i> <small>(з реєстру)</small>
                    ${d.carrier_id ? `<a href="#" data-carrier-card="${e(d.carrier_id)}" class="dv-mini-link" title="Відкрити картку перевізника"><i class="bx bx-link-external"></i></a>` : ""}</div>
                    <input class="dv-in" id="dvCarrier" value="${e(d.carrier_name || "")}" placeholder="Назва або ЄДРПОУ перевізника…" autocomplete="off" />
                    <span class="dv-code" id="dvCarrierCode">${e(d.carrier_edrpou || "")}</span>
                    <div class="deal-suggest" id="dvCarrierSg" hidden></div></div>
                <div class="dv-sec-title dv-sec-gap">Відповідальні</div>
                <div class="dv-field"><div class="dv-label">Sales manager</div>
                    <div class="dv-person"><span class="dv-avatar" id="dvSalesAv">${e(initials(d.sales) || "?")}</span>
                    <select class="dv-in" id="dvSales">${staffOpts(["sales", "head"], d.sales_id, d.sales)}</select></div></div>
                <div class="dv-field"><div class="dv-label">Логіст</div>
                    <div class="dv-person"><span class="dv-avatar" id="dvLogistAv">${e(initials(d.logist_name) || "?")}</span>
                    <select class="dv-in" id="dvLogist">${staffOpts(["logist"], d.logist_id, d.logist_name)}</select></div></div>
            </aside>

            <div class="dv-main">
                <div class="dv-kpis">
                    <div class="dv-kpi"><div class="dv-label">План профіту</div><div class="dv-kpi-v" id="dvPlanProfit">${usd(calcTotals(d).profit)}</div></div>
                    <div class="dv-kpi"><div class="dv-label">Факт профіту</div><div class="dv-kpi-v" id="dvFactProfit">${usd(d.paid_by_client && d.paid_to_carrier ? calcTotals(d).profit : 0)}</div></div>
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
    detailView.querySelector("[data-dv=copy]").addEventListener("click", () => duplicateDeal(d));
    detailView.querySelector("[data-dv=delete]").addEventListener("click", async () => {
        if (!confirm(`Видалити угоду № ${d.number}${d.client ? ` (${d.client})` : ""}?`)) return;
        const { error } = await sbClient.from("deals").delete().eq("id", d.id);
        if (error) return alert("Не вдалося видалити: " + error.message);
        closeDealCard();
        loadDeals();
    });
    bindSide(d);
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
            updateProfitKpis(d);
        }),
    );
    renderTab(d);
}

function renderTab(d) {
    const box = $("dvTabBody");
    const e = escapeHtml;
    if (detailTab === "auto") {
        const here = (k) => d[`customs_${k}`] === CUSTOMS_HERE;
        box.innerHTML = `
            <div class="dv-block-title">Авто і водій</div>
            <div class="dv-grid">
                <div class="dv-field"><div class="dv-label">Номер тягача і причепа</div>
                    <input class="dv-in" id="dvPlates" value="${e([d.truck_plate, d.trailer_plate].filter(Boolean).join("/"))}" placeholder="AC1234AB/AC5678XX" /></div>
                <div class="dv-field"><div class="dv-label">ПІБ водія</div>
                    <input class="dv-in" data-f="driver_name" value="${e(d.driver_name || "")}" placeholder="Прізвище Ім'я" /></div>
                <div class="dv-field"><div class="dv-label">Телефон водія</div>
                    <div class="dv-phone"><input class="dv-in dv-link-in" data-f="driver_phone" data-phone="1" value="${e(d.driver_phone || "")}" placeholder="380XXXXXXXXX" />${viberBtn(d.driver_phone)}</div></div>
                <div></div>
            </div>
            <div class="dv-block-title">Вантаж</div>
            <div class="dv-grid dv-grid-cargo">
                <div class="dv-field"><div class="dv-label">Назва вантажу</div>
                    <input class="dv-in" data-f="cargo" value="${e(d.cargo || "")}" placeholder="наприклад: обладнання на палетах, 20 т" /></div>
                <div class="dv-field"><div class="dv-label">Тип причепу</div>
                    <select class="dv-in dv-trailer-in" data-f="trailer_type">${optList(trailerTypes, d.trailer_type, "Оберіть…")}</select></div>
                <div></div>
            </div>
            <div class="dv-block-title">Логіст перевізника</div>
            <div class="dv-grid dv-grid-cargo">
                <div class="dv-field"><div class="dv-label">ПІБ логіста перевізника</div>
                    <input class="dv-in" data-f="carrier_contact" value="${e(d.carrier_contact || "")}" placeholder="Ім'я та прізвище" /></div>
                <div class="dv-field"><div class="dv-label">Телефон логіста перевізника</div>
                    <div class="dv-phone"><input class="dv-in dv-link-in" data-f="carrier_phone" data-phone="1" value="${e(d.carrier_phone || "")}" placeholder="380XXXXXXXXX" />${viberBtn(d.carrier_phone)}</div></div>
                <div></div>
            </div>
            <div class="dv-block-title">Маршрут</div>
            <div class="dv-route-cards">
                <div class="dv-rc">
                    <div class="dv-rc-title"><i class="dot blue"></i> Завантаження</div>
                    <select class="dv-in dv-rc-country-in" data-f="load_country" id="dvLoadCountry">${optList(COUNTRIES, d.load_country, "Країна…")}</select>
                    <input class="dv-in dv-rc-city-in" data-f="load_address" id="dvLoadAddr" value="${e(d.load_address || "")}" placeholder="Місто, село, індекс" />
                    <div class="dv-rc-row"><span>План</span><input type="date" class="dv-in dv-date" data-f="load_date_plan" value="${e(String(d.load_date_plan || "").slice(0, 10))}" /></div>
                    <div class="dv-rc-row"><span>Факт</span><input type="date" class="dv-in dv-date" data-f="load_date" value="${e(String(d.load_date || "").slice(0, 10))}" /></div>
                    ${extraLoadsHtml(d)}
                </div>
                <i class="bx bx-right-arrow-alt dv-rc-arrow"></i>
                <div class="dv-rc">
                    <div class="dv-rc-title"><i class="dot orange"></i> Митниця і кордон</div>
                    <select class="dv-in dv-rc-city-in" data-f="border_crossing">${optList(BORDER_CROSSINGS, d.border_crossing, "Пункт пропуску…")}</select>
                    ${["export", "import"].map((k) => `
                    <div class="dv-customs">
                        <div class="dv-rc-row"><span>${k === "export" ? "Замитнення" : "Розмитнення"}</span>
                            <label class="dv-here"><input type="checkbox" data-here="${k}" ${here(k) ? "checked" : ""}/> по місцю ${k === "export" ? "завантаження" : "розвантаження"}</label></div>
                        <div class="dv-customs-in" ${here(k) ? "hidden" : ""}>
                            <select class="dv-in" data-f="customs_${k}_country" id="dvC_${k}_country">${optList(COUNTRIES, d[`customs_${k}_country`], "Країна…")}</select>
                            <input class="dv-in" data-f="customs_${k}" id="dvC_${k}" value="${e(here(k) ? "" : d[`customs_${k}`] || "")}" placeholder="Місто митниці" />
                        </div>
                    </div>${k === "export" ? extraCustomsHtml(d) : ""}`).join("")}
                </div>
                <i class="bx bx-right-arrow-alt dv-rc-arrow"></i>
                <div class="dv-rc">
                    <div class="dv-rc-title"><i class="dot green"></i> Вивантаження</div>
                    <select class="dv-in dv-rc-country-in" data-f="unload_country" id="dvUnloadCountry">${optList(COUNTRIES, d.unload_country, "Країна…")}</select>
                    <input class="dv-in dv-rc-city-in" data-f="unload_address" id="dvUnloadAddr" value="${e(d.unload_address || "")}" placeholder="Місто, село, індекс" />
                    <div class="dv-rc-row"><span>План</span><input type="date" class="dv-in dv-date" data-f="unload_date_plan" value="${e(String(d.unload_date_plan || "").slice(0, 10))}" /></div>
                    <div class="dv-rc-row"><span>Факт</span><input type="date" class="dv-in dv-date" data-f="unload_date" value="${e(String(d.unload_date || "").slice(0, 10))}" /></div>
                </div>
            </div>`;
        bindFields(box, d);
        makeCollapsible(box);
        $("dvPlates").addEventListener("change", (ev) => {
            const [truck, trailer] = ev.target.value.toUpperCase().replace(/\s+/g, "").split(/[\/\\|,;]+/);
            ev.target.value = [truck, trailer].filter(Boolean).join("/");
            saveDeal(d, { truck_plate: truck || null, trailer_plate: trailer || null });
        });
        // Значок Viber оновлюється разом із номером
        box.querySelectorAll("[data-phone]").forEach((inp) =>
            inp.addEventListener("change", () => {
                const wrap = inp.closest(".dv-phone");
                wrap.querySelector(".dv-viber")?.remove();
                wrap.insertAdjacentHTML("beforeend", viberBtn(inp.value));
            }),
        );
        bindExtras(box, d);
        box.querySelectorAll("[data-here]").forEach((cb) =>
            cb.addEventListener("change", async () => {
                const k = cb.dataset.here;
                cb.closest(".dv-customs").querySelector(".dv-customs-in").hidden = cb.checked;
                const patch = cb.checked
                    ? { [`customs_${k}`]: CUSTOMS_HERE, [`customs_${k}_country`]: null }
                    : { [`customs_${k}`]: null };
                await saveDeal(d, patch);
            }),
        );
        if (window.furaAddressSuggest) {
            [["dvLoadAddr", "dvLoadCountry"], ["dvUnloadAddr", "dvUnloadCountry"], ["dvC_export", "dvC_export_country"], ["dvC_import", "dvC_import_country"]].forEach(
                ([i, c]) => $(i) && window.furaAddressSuggest($(i), { countrySelect: $(c), mode: "full" }),
            );
        }
        return;
    }
    if (detailTab === "calc") {
        renderCalc(d, box);
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

// Один рейс = одна угода. Скасований рейс можна замінити новим.
const TRIP_DEAD = ["cancelled", "declined"];
const TRIP_LABELS = {
    assigned: "Очікує підтвердження", confirmed: "Підтверджено водієм", declined: "Водій відмовився",
    to_loading: "Їде на завантаження", at_loading: "На завантаженні", loaded: "В дорозі",
    at_border: "На кордоні", crossed_border: "Пройшов кордон", at_unloading: "На розвантаженні",
    unloaded: "Виконано", timeout: "Трекінг зупинено", cancelled: "Скасовано",
};

async function renderTrackTab(d, box) {
    box.innerHTML = `<div class="dv-empty">Завантаження трекінгу…</div>`;
    const { data, error } = await sbClient
        .from("trips")
        .select("id, trip_no, status")
        .eq("deal_id", d.id)
        .order("created_at", { ascending: false })
        .limit(1);
    if (detailTab !== "track" || currentCardDealId !== d.id) return;
    if (error) {
        box.innerHTML = `<div class="dv-dev">Трекінг недоступний: ${escapeHtml(error.message)}<br>Можливо, ще не виконано deals_ui.sql.</div>`;
        return;
    }
    const trip = data?.[0];
    if (trip) {
        tripByDeal.set(String(d.id), { deal_id: d.id, ...trip });
        if ($("dvState")) $("dvState").innerHTML = stateBadge(d);
        const dead = TRIP_DEAD.includes(trip.status);
        box.innerHTML = `
            <div class="dv-track-bar">
                <span>Рейс № ${escapeHtml(trip.trip_no)} цієї угоди · ${escapeHtml(TRIP_LABELS[trip.status] || trip.status)}</span>
                ${dead ? `<button type="button" class="btn btn-primary" id="dvRestartTrack"><i class="bx bx-refresh"></i> Запустити трекінг заново</button>` : ""}
            </div>
            <iframe class="dv-track-frame" src="trips.html?embed=1&trip=${encodeURIComponent(trip.id)}" title="Трекінг рейсу"></iframe>`;
        $("dvRestartTrack")?.addEventListener("click", () => startTrackForm(d, box));
        return;
    }

    // Рейсу ще немає: створити новий або прив'язати вже наявний (створений раніше без угоди)
    box.innerHTML = `
        <div class="dv-track-empty">
            <i class="bx bx-map-alt"></i>
            <div><b>Трекінг ще не запущено</b><br>Рейс створиться одразу з «Дані авто»: маршрут, пункт пропуску, авто, водій, дати. Водій отримає код для застосунку «FURA Водій». Потім зміни в «Дані авто» самі переносяться в трекінг.</div>
            <button type="button" class="btn btn-primary" id="dvStartTrack"><i class="bx bx-send"></i> Запустити трекінг</button>
        </div>
        <div class="dv-track-link" id="dvLinkBox" hidden>
            <span>або прив'язати рейс, створений раніше без угоди:</span>
            <select id="dvLinkSelect"></select>
            <button type="button" class="btn btn-secondary" id="dvLinkBtn">Прив'язати</button>
        </div>`;
    $("dvStartTrack").addEventListener("click", () => startTrackForm(d, box));

    const { data: free } = await sbClient
        .from("trips")
        .select("id, trip_no, status, load_address, unload_address, driver_name, created_at")
        .is("deal_id", null)
        .not("status", "in", "(cancelled,declined)")
        .order("created_at", { ascending: false })
        .limit(30);
    if (!free?.length || detailTab !== "track" || currentCardDealId !== d.id) return;
    const short = (a) => String(a || "—").split(",")[0];
    $("dvLinkSelect").innerHTML = free
        .map((t) => `<option value="${escapeHtml(t.id)}">№ ${escapeHtml(t.trip_no)} · ${escapeHtml(short(t.load_address))} → ${escapeHtml(short(t.unload_address))} · ${escapeHtml(t.driver_name || "")} · ${escapeHtml(TRIP_LABELS[t.status] || t.status)}</option>`)
        .join("");
    $("dvLinkBox").hidden = false;
    $("dvLinkBtn").addEventListener("click", async () => {
        const id = $("dvLinkSelect").value;
        const { error: e2 } = await sbClient.from("trips").update({ deal_id: d.id }).eq("id", id);
        if (e2) return alert("Не вдалося прив'язати: " + e2.message);
        renderTab(d);
    });
}

// Рейс створюється одразу з «Дані авто» — без окремої форми
function tripFieldsFromDeal(d) {
    const load = d.load_date_plan ? new Date(`${String(d.load_date_plan).slice(0, 10)}T08:00:00`) : null;
    let unload = d.unload_date_plan ? new Date(`${String(d.unload_date_plan).slice(0, 10)}T17:00:00`) : null;
    if (load && (!unload || unload < load)) unload = new Date(load.getTime() + 26 * 3600000);
    return {
        client: d.client || null,
        carrier_id: d.carrier_id ? String(d.carrier_id) : null,
        carrier_name: d.carrier_name || null,
        driver_name: d.driver_name || null,
        driver_phone: d.driver_phone ? cleanPhone(d.driver_phone).split(",")[0] : null,
        truck_plate: d.truck_plate || null,
        trailer_plate: d.trailer_plate || null,
        load_country: d.load_country || null,
        load_address: d.load_address || null,
        unload_country: d.unload_country || null,
        unload_address: d.unload_address || null,
        load_planned_at: load ? load.toISOString() : null,
        unload_planned_at: unload ? unload.toISOString() : null,
        logist_name: d.logist_name || currentStaff?.full_name || null,
        logist_phone: d.logist_phone || (currentStaff?.phone ? cleanPhone(currentStaff.phone) : null),
    };
}

async function tripRoute(d) {
    const code = window.furaCountryCode || (() => "");
    try {
        const { data, error } = await sbClient.functions.invoke("fura-geo", {
            body: {
                action: "route",
                from: d.load_address,
                to: d.unload_address,
                fromCountry: code(d.load_country),
                toCountry: code(d.unload_country),
                via: BORDER_CROSSINGS.includes(d.border_crossing) ? d.border_crossing : "",
            },
        });
        if (error || !data || data.error) return null;
        const line = Array.isArray(data.line) ? data.line : [];
        const step = Math.max(1, Math.ceil(line.length / 1500));
        return {
            load_lat: data.from?.lat ?? null,
            load_lon: data.from?.lon ?? null,
            unload_lat: data.to?.lat ?? null,
            unload_lon: data.to?.lon ?? null,
            route_line: line.filter((_, i) => i % step === 0).concat(line.length ? [line[line.length - 1]] : []),
            route_km: data.km ?? null,
            borders: data.borders || [],
        };
    } catch {
        return null;
    }
}

async function startTrackForm(d, box) {
    const missing = [];
    if (!d.load_address) missing.push("місто завантаження");
    if (!d.unload_address) missing.push("місто вивантаження");
    if (!d.load_date_plan) missing.push("план дати завантаження");
    if (!d.driver_name) missing.push("ПІБ водія");
    if (!d.driver_phone) missing.push("телефон водія");
    if (missing.length) {
        box.innerHTML = `
            <div class="dv-track-empty dv-track-warn">
                <i class="bx bx-error-circle"></i>
                <div><b>Для трекінгу заповніть у «Дані авто»:</b><br>${missing.map(escapeHtml).join(", ")}</div>
                <button type="button" class="btn btn-primary" id="dvGoAuto">Перейти в «Дані авто»</button>
            </div>`;
        $("dvGoAuto").addEventListener("click", () => detailView.querySelector('[data-tab="auto"]')?.click());
        return;
    }
    box.innerHTML = `<div class="dv-empty">Створюю рейс і будую маршрут для фури…</div>`;
    const payload = { ...tripFieldsFromDeal(d), deal_id: d.id };
    Object.assign(payload, (await tripRoute(d)) || {});
    const { data, error } = await sbClient.from("trips").insert([payload]).select("id, trip_no, status").single();
    if (error) {
        box.innerHTML = `<div class="dv-dev">Не вдалося створити рейс: ${escapeHtml(error.message)}</div>`;
        return;
    }
    tripByDeal.set(String(d.id), { deal_id: d.id, ...data });
    if ($("dvState")) $("dvState").innerHTML = stateBadge(d);
    box.innerHTML = `<iframe class="dv-track-frame" src="trips.html?embed=1&trip=${encodeURIComponent(data.id)}&invite=1" title="Трекінг рейсу"></iframe>`;
}

// Змінили «Дані авто» — оновлюємо і рейс (поки він не завершений)
const TRIP_SYNC_FIELDS = ["client", "carrier_id", "carrier_name", "driver_name", "driver_phone", "truck_plate", "trailer_plate",
    "load_country", "load_address", "unload_country", "unload_address", "load_date_plan", "unload_date_plan", "logist_name", "logist_phone", "border_crossing"];
const ROUTE_FIELDS = ["load_country", "load_address", "unload_country", "unload_address", "border_crossing"];
async function syncTrip(d, patch) {
    const keys = Object.keys(patch);
    if (!keys.some((k) => TRIP_SYNC_FIELDS.includes(k))) return;
    const t = tripByDeal.get(String(d.id));
    if (!t || ["unloaded", "timeout", "cancelled", "declined"].includes(t.status)) return;
    const upd = tripFieldsFromDeal(d);
    if (keys.some((k) => ROUTE_FIELDS.includes(k)) && d.load_address && d.unload_address) Object.assign(upd, (await tripRoute(d)) || {});
    const { error } = await sbClient.from("trips").update(upd).eq("id", t.id ?? (await tripIdOf(d)));
    if (!error) flashSaved("Збережено ✓ (і в трекінгу)");
}
async function tripIdOf(d) {
    const { data } = await sbClient.from("trips").select("id").eq("deal_id", d.id).order("created_at", { ascending: false }).limit(1);
    return data?.[0]?.id;
}

// Повідомлення з вкладки «Трекінг» (рейс створено / форму закрили)
window.addEventListener("message", (ev) => {
    if (ev.origin !== location.origin || !ev.data?.type) return;
    const d = dealsCache.find((x) => String(x.id) === String(currentCardDealId));
    if (!d || detailTab !== "track") return;
    if (ev.data.type === "fura-trip-close") renderTab(d);
    if (ev.data.type === "fura-trip-height") {
        const fr = document.querySelector(".dv-track-frame");
        if (fr) fr.style.height = Math.max(700, Number(ev.data.height) || 0) + 20 + "px";
    }
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
    // Список типів причепів з реєстру (у фоні); відкрита вкладка «Дані авто» оновиться
    loadTrailerTypes().then(() => {
        const d = dealsCache.find((x) => String(x.id) === String(currentCardDealId));
        if (d && detailTab === "auto" && !document.activeElement?.closest?.("#dvTabBody")) renderTab(d);
    });

    const params = new URLSearchParams(location.search);
    if (params.get("new") === "1") {
        const leadId = params.get("lead");
        if (leadId) {
            sbClient.from("leads").select("*").eq("id", leadId).maybeSingle().then(({ data }) => createDeal(data || null));
        } else createDeal();
        // Нова угода відкриється на місці цього запису історії — «назад» поверне туди, звідки прийшли
        replaceNextOpen = true;
    }
    if (params.get("open")) openDealCard(params.get("open"));
    else if ([...params.keys()].length) history.replaceState(null, "", location.pathname);
});

// Назад / вперед у браузері або стрілками CRM: відкриваємо ту угоду, що в адресі
window.addEventListener("popstate", () => {
    const id = new URLSearchParams(location.search).get("open");
    if (id) {
        if (String(currentCardDealId) !== id) openDealCard(id, undefined, true);
    } else if (currentCardDealId) closeDealCard(true);
});
