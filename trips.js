/* ================================================================= *
 * FURA — СТОРІНКА "РЕЙСИ": онлайн-трекінг авто з застосунку водія    *
 *                                                                   *
 *  • створення рейсу із запиту «В роботі» → код для водія            *
 *  • карта: маршрут TomTom (fura-geo) + точки GPS з телефону         *
 *  • етапи план / факт, прогноз прибуття, сповіщення                 *
 *  • живі оновлення через Supabase Realtime                         *
 * ================================================================= */

const SUPABASE_URL = "https://prbfscwmemshwigiftha.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Посилання на застосунок у магазинах — вписати після публікації
const APP_LINKS = {
    android: "", // https://play.google.com/store/apps/details?id=ua.grandar.furadriver
    ios: "", // https://apps.apple.com/app/id...
};

const NO_SIGNAL_MIN = 60; // без точок довше — червоне попередження
const STANDING_MIN = 120; // стоїть довше — жовте
const LATE_MIN = 60; // прогноз пізніше плану більше ніж на годину
const NOT_CONFIRMED_HOURS = 6; // за скільки годин до завантаження чекаємо підтвердження

async function logout() {
    await sbClient.auth.signOut();
    window.location.href = "login.html";
}

/* ---------------- Довідники ---------------- */

const STATUS = {
    assigned: { label: "Очікує підтвердження", cls: "tb-grey" },
    confirmed: { label: "Підтверджено водієм", cls: "tb-blue" },
    declined: { label: "Водій відмовився", cls: "tb-red" },
    to_loading: { label: "Їде на завантаження", cls: "tb-blue" },
    at_loading: { label: "На завантаженні", cls: "tb-blue" },
    loaded: { label: "В дорозі", cls: "tb-blue" },
    at_border: { label: "На кордоні", cls: "tb-amber" },
    crossed_border: { label: "Пройшов кордон", cls: "tb-blue" },
    at_unloading: { label: "На розвантаженні", cls: "tb-blue" },
    unloaded: { label: "Виконано", cls: "tb-green" },
    timeout: { label: "Трекінг зупинено", cls: "tb-grey" },
    cancelled: { label: "Скасовано", cls: "tb-grey" },
};
const ACTIVE = [
    "confirmed",
    "to_loading",
    "at_loading",
    "loaded",
    "at_border",
    "crossed_border",
    "at_unloading",
];
const MOVING = ["to_loading", "loaded", "crossed_border"];
const FINISHED = ["unloaded", "timeout", "cancelled", "declined"];

const EVENT_LABELS = {
    assigned: "Рейс створено",
    confirmed: "Водій підтвердив рейс",
    declined: "Водій відмовився",
    tracking_started: "Трекінг почався",
    arrived_loading: "Прибув на завантаження",
    loaded: "Завантажено, виїхав",
    arrived_border: "Прибув на кордон",
    crossed_border: "Пройшов кордон",
    arrived_unloading: "Прибув на розвантаження",
    unloaded: "Розвантажено",
    problem: "Проблема",
    doc_uploaded: "Фото документа",
    cancelled: "Рейс скасовано",
    timeout: "Трекінг зупинено автоматично",
    code_rotated: "Новий код для водія",
    note: "Нотатка",
};

// Які етапи ще попереду після поточного статусу
const STAGE_FLOW = [
    ["confirmed", "Водій підтвердив рейс"],
    ["arrived_loading", "Прибув на завантаження"],
    ["loaded", "Завантажено, виїхав"],
    ["arrived_border", "Прибув на кордон"],
    ["crossed_border", "Пройшов кордон"],
    ["arrived_unloading", "Прибув на розвантаження"],
    ["unloaded", "Розвантажено"],
];

const COUNTRIES = [
    "УКРАЇНА", "ПОЛЬША", "НІМЕЧЧИНА", "ЛИТВА", "ЛАТВІЯ", "ЕСТОНІЯ", "ЧЕХІЯ",
    "СЛОВАЧЧИНА", "УГОРЩИНА", "РУМУНІЯ", "МОЛДОВА", "БОЛГАРІЯ", "АВСТРІЯ",
    "ІТАЛІЯ", "ІСПАНІЯ", "ФРАНЦІЯ", "БЕЛЬГІЯ", "НІДЕРЛАНДИ", "ДАНІЯ",
    "ФІНЛЯНДІЯ", "ВЕЛИКОБРИТАНІЯ", "ТУРЕЧЧИНА", "ГРУЗІЯ", "ВІРМЕНІЯ",
    "АЗЕРБАЙДЖАН", "СЛОВЕНІЯ",
];

const LIST_COLUMNS = [
    "id", "trip_no", "created_at", "request_id", "client", "logist_name",
    "carrier_name", "driver_name", "driver_phone", "truck_plate", "trailer_plate",
    "load_address", "unload_address", "load_planned_at", "unload_planned_at",
    "tracking_start_at", "tracking_deadline", "status", "invite_code",
    "confirmed_at", "finished_at", "last_lat", "last_lon", "last_speed_kmh",
    "last_point_at", "last_battery", "points_count", "eta_at", "eta_note",
    "eta_remaining_km", "eta_traffic_delay_min",
].join(",");

/* ---------------- Стан ---------------- */

let currentStaff = null;
// Рейс усередині угоди (вкладка «Трекінг»): trips.html?embed=1&trip=… або &new_from_deal=…
const EMBED = new URLSearchParams(location.search).get("embed") === "1";
let pendingDealId = null;
let trips = [];
let recentProblems = new Map(); // trip_id → остання проблема за 12 год
let filter = "active";
let selectedId = null;
let detail = null; // { trip, events, positions, docs }
let map = null;
let mapReady = false;

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

function fmtDT(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("uk-UA", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function fmtDur(min) {
    min = Math.max(0, Math.round(min));
    if (min < 60) return `${min} хв`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h < 24) return m ? `${h} год ${m} хв` : `${h} год`;
    const d = Math.floor(h / 24);
    const hh = h % 24;
    return hh ? `${d} дн ${hh} год` : `${d} дн`;
}

const minutesSince = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;

function ago(iso) {
    if (!iso) return "—";
    const m = minutesSince(iso);
    return m < 1 ? "щойно" : `${fmtDur(m)} тому`;
}

function shortPlace(address) {
    if (!address) return "—";
    return String(address).split(",")[0].trim();
}

function statusBadge(status) {
    const s = STATUS[status] || { label: status, cls: "tb-grey" };
    return `<span class="tbadge ${s.cls}">${escapeHtml(s.label)}</span>`;
}

// datetime-local ↔ ISO
function toLocalInput(date) {
    const d = new Date(date);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function distM(a, b) {
    const R = 6371000;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

/* ---------------- Попередження ---------------- */

function alertsFor(t, standingMin = null) {
    const out = [];
    const now = Date.now();
    if (
        t.status === "assigned" &&
        now > new Date(t.load_planned_at).getTime() - NOT_CONFIRMED_HOURS * 3600000
    ) {
        out.push({ tone: "amber", short: "Не підтверджено", text: "Водій ще не підтвердив рейс, а завантаження вже скоро." });
    }
    const trackingOn = ACTIVE.includes(t.status) && now > new Date(t.tracking_start_at).getTime();
    if (trackingOn) {
        if (!t.last_point_at && now > new Date(t.tracking_start_at).getTime() + 30 * 60000) {
            out.push({ tone: "red", short: "Немає даних", text: "Трекінг мав початися, але телефон водія не передав жодної точки. Зателефонуйте водію: застосунок відкритий, геолокація «Завжди»?" });
        } else if (t.last_point_at && minutesSince(t.last_point_at) > NO_SIGNAL_MIN) {
            const m = minutesSince(t.last_point_at);
            out.push({ tone: "red", short: `Немає сигналу ${fmtDur(m)}`, text: `Остання точка ${fmtDur(m)} тому. Можливо, немає мережі — точки прийдуть пізніше. Якщо довше 2 год — зателефонуйте водію.` });
        }
    }
    if (standingMin != null && standingMin > STANDING_MIN && MOVING.includes(t.status)) {
        out.push({ tone: "amber", short: `Стоїть ${fmtDur(standingMin)}`, text: `Авто стоїть на місці ${fmtDur(standingMin)}, хоча за етапом має бути в дорозі.` });
    }
    if (t.eta_at && ACTIVE.includes(t.status)) {
        const late = (new Date(t.eta_at) - new Date(t.unload_planned_at)) / 60000;
        if (late > LATE_MIN) {
            out.push({ tone: "amber", short: `Прогноз +${fmtDur(late)}`, text: `За прогнозом прибуття ${fmtDT(t.eta_at)} — пізніше плану на ${fmtDur(late)}. Попередьте клієнта.` });
        }
    }
    const p = recentProblems.get(t.id);
    if (p && ACTIVE.includes(t.status)) {
        out.push({ tone: "amber", short: "Проблема", text: `Водій повідомив: «${p.note || "проблема"}» (${fmtDT(p.at)}).` });
    }
    return out;
}

/* ---------------- Завантаження ---------------- */

async function loadStaff(session) {
    const { data } = await sbClient.from("staff").select("*");
    const email = (session?.user?.email || "").toLowerCase();
    currentStaff = (data || []).find((s) => (s.email || "").toLowerCase() === email) || null;
}

async function loadTrips() {
    const since = new Date(Date.now() - 45 * 86400000).toISOString();
    const [{ data, error }, problems] = await Promise.all([
        sbClient
            .from("trips")
            .select(LIST_COLUMNS)
            .or(`created_at.gte.${since},status.in.(${ACTIVE.join(",")},assigned)`)
            .order("created_at", { ascending: false })
            .limit(300),
        sbClient
            .from("trip_events")
            .select("trip_id,note,at")
            .eq("type", "problem")
            .gte("at", new Date(Date.now() - 12 * 3600000).toISOString())
            .order("at", { ascending: true }),
    ]);
    if (error) {
        console.error(error);
        document.getElementById("tripsList").innerHTML =
            `<div class="trips-empty">Не вдалося завантажити рейси: ${escapeHtml(error.message)}.<br>Чи виконано SQL-міграцію рейсів?</div>`;
        return;
    }
    trips = data || [];
    recentProblems = new Map((problems.data || []).map((p) => [p.trip_id, p]));
    renderChips();
    renderList();
}

/* ---------------- Фільтри і список ---------------- */

const FILTERS = [
    { key: "active", label: "В дорозі", test: (t) => ACTIVE.includes(t.status) },
    { key: "attention", label: "Увага", test: (t) => (ACTIVE.includes(t.status) || t.status === "assigned") && alertsFor(t).length > 0 },
    { key: "assigned", label: "Очікують підтвердження", test: (t) => t.status === "assigned" },
    { key: "finished", label: "Завершені", test: (t) => FINISHED.includes(t.status) },
    { key: "all", label: "Усі", test: () => true },
];

function renderChips() {
    document.getElementById("tripChips").innerHTML = FILTERS.map((f) => {
        const n = trips.filter(f.test).length;
        return `<button type="button" class="trip-chip" data-filter="${f.key}" aria-pressed="${f.key === filter}">${escapeHtml(f.label)}<span class="n">${n}</span></button>`;
    }).join("");
}

document.getElementById("tripChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    filter = b.dataset.filter;
    renderChips();
    renderList();
});

document.getElementById("tripsSearch").addEventListener("input", renderList);

function renderList() {
    const box = document.getElementById("tripsList");
    const q = document.getElementById("tripsSearch").value.trim().toLowerCase();
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[0];
    const list = trips.filter(f.test).filter((t) => {
        if (!q) return true;
        return [t.trip_no, t.client, t.load_address, t.unload_address, t.driver_name, t.driver_phone, t.truck_plate, t.trailer_plate, t.carrier_name, t.invite_code]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q);
    });

    if (!list.length) {
        box.innerHTML = `<div class="trips-empty">${trips.length ? "Немає рейсів за цим фільтром" : "Рейсів ще немає. Натисніть «Новий рейс»."}</div>`;
        return;
    }

    box.innerHTML = list
        .map((t) => {
            const alerts = alertsFor(t);
            const last = ACTIVE.includes(t.status)
                ? t.last_point_at
                    ? `Точка ${ago(t.last_point_at)}`
                    : now() < new Date(t.tracking_start_at)
                      ? `Трекінг з ${fmtDT(t.tracking_start_at)}`
                      : "Точок ще немає"
                : t.status === "assigned"
                  ? `Код ${escapeHtml(t.invite_code)} · завантаження ${fmtDT(t.load_planned_at)}`
                  : `Завершено ${fmtDT(t.finished_at)}`;
            const eta = t.eta_at && ACTIVE.includes(t.status) ? ` · прибуття ~${fmtDT(t.eta_at)}` : "";
            return `
            <button type="button" class="trip-card" data-id="${t.id}" aria-current="${t.id === selectedId}">
                <div class="trip-card-top">
                    <span class="trip-no">№ ${t.trip_no}</span>
                    ${statusBadge(t.status)}
                </div>
                <div class="trip-route">${escapeHtml(shortPlace(t.load_address))} → ${escapeHtml(shortPlace(t.unload_address))}</div>
                <div class="trip-meta">${escapeHtml(t.driver_name)}${t.truck_plate ? " · " + escapeHtml(t.truck_plate) : ""}${t.client ? " · " + escapeHtml(t.client) : ""}</div>
                <div class="trip-meta">${last}${eta}</div>
                ${alerts.length ? `<div class="trip-alerts">${alerts.map((a) => `<span class="tbadge tb-${a.tone}">${escapeHtml(a.short)}</span>`).join("")}</div>` : ""}
            </button>`;
        })
        .join("");
}

const now = () => new Date();

document.getElementById("tripsList").addEventListener("click", (e) => {
    const card = e.target.closest("[data-id]");
    if (card) openTrip(card.dataset.id);
});

/* ---------------- Деталі рейсу ---------------- */

async function openTrip(id) {
    selectedId = id;
    renderList();
    const box = document.getElementById("tripDetail");
    box.innerHTML = `<div class="trip-detail-empty">Завантаження…</div>`;
    history.replaceState(null, "", EMBED ? `?embed=1&trip=${id}` : `?trip=${id}`);

    const [tripRes, evRes, posRes, docRes] = await Promise.all([
        sbClient.from("trips").select("*").eq("id", id).single(),
        sbClient.from("trip_events").select("*").eq("trip_id", id).order("at", { ascending: true }),
        sbClient
            .from("trip_positions")
            .select("recorded_at,lat,lon,speed_kmh")
            .eq("trip_id", id)
            .order("recorded_at", { ascending: true })
            .limit(10000),
        sbClient.from("trip_docs").select("*").eq("trip_id", id).order("uploaded_at", { ascending: true }),
    ]);
    if (tripRes.error) {
        box.innerHTML = `<div class="trip-detail-empty">Не вдалося відкрити рейс: ${escapeHtml(tripRes.error.message)}</div>`;
        return;
    }
    if (selectedId !== id) return; // поки вантажили, обрали інший

    const docs = docRes.data || [];
    await Promise.all(
        docs.map(async (d) => {
            const { data } = await sbClient.storage.from("trip-docs").createSignedUrl(d.path, 3600);
            d.url = data?.signedUrl || null;
        }),
    );

    detail = {
        trip: tripRes.data,
        events: evRes.data || [],
        positions: posRes.data || [],
        docs,
    };
    renderDetail();
}

// Скільки хвилин авто стоїть на місці (радіус 300 м від останньої точки)
function standingMinutes(positions) {
    if (positions.length < 2) return null;
    const last = positions[positions.length - 1];
    let since = last.recorded_at;
    for (let i = positions.length - 2; i >= 0; i--) {
        if (distM(positions[i], last) > 300) break;
        since = positions[i].recorded_at;
    }
    return (new Date(last.recorded_at) - new Date(since)) / 60000;
}

function field(label, value, sub = "", mono = false) {
    return `<div class="td-field"><div class="l">${escapeHtml(label)}</div><div class="v ${mono ? "mono" : ""}">${value}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
}

function renderDetail(keepMap = false) {
    if (!detail) return;
    const { trip: t, events, positions, docs } = detail;
    const box = document.getElementById("tripDetail");
    const standing = standingMinutes(positions);
    const alerts = alertsFor(t, standing);
    const active = ACTIVE.includes(t.status);

    // Етапи: що вже було + що попереду
    const done = new Set(events.map((e) => e.type));
    const hasUaBorder = (t.borders || []).some((b) => b.ukraine);
    const ahead = FINISHED.includes(t.status)
        ? []
        : STAGE_FLOW.filter(([k]) => !done.has(k) && (hasUaBorder || !["arrived_border", "crossed_border"].includes(k)));
    const planFor = (type) =>
        type === "arrived_loading" ? t.load_planned_at : type === "arrived_unloading" ? t.unload_planned_at : null;
    const devFor = (type, at) => {
        const plan = planFor(type);
        if (!plan) return "";
        const d = (new Date(at) - new Date(plan)) / 60000;
        if (Math.abs(d) < 15) return ` · <span class="tbadge tb-green">вчасно</span>`;
        return d > 0
            ? ` · <span class="tbadge tb-amber">+${fmtDur(d)}</span>`
            : ` · <span class="tbadge tb-green">−${fmtDur(-d)}</span>`;
    };

    const eventsHtml = events
        .map((e) => {
            const plan = planFor(e.type);
            return `<li>
                <span class="dot ${e.type === "problem" ? "problem" : ""}"></span>
                <div class="tl-main">
                    <div class="tl-label">${escapeHtml(EVENT_LABELS[e.type] || e.type)}${devFor(e.type, e.at)}</div>
                    ${e.note ? `<div class="tl-note">${escapeHtml(e.note)}</div>` : ""}
                    ${e.author && e.source === "crm" ? `<div class="tl-note">${escapeHtml(e.author)}</div>` : ""}
                </div>
                <div class="tl-time">${fmtDT(e.at)}${plan ? `<div class="plan">план ${fmtDT(plan)}</div>` : ""}</div>
            </li>`;
        })
        .join("");
    const aheadHtml = ahead
        .map(([k, label]) => {
            const plan = planFor(k);
            return `<li><span class="dot todo"></span><div class="tl-main"><div class="tl-label" style="color:#64748b">${escapeHtml(label)}</div></div><div class="tl-time">${plan ? `<div class="plan">план ${fmtDT(plan)}</div>` : ""}</div></li>`;
        })
        .join("");

    const etaHtml =
        t.eta_at && active
            ? field(
                  "Прибуття (прогноз)",
                  fmtDT(t.eta_at),
                  `${escapeHtml(t.eta_note || "")}${t.eta_traffic_delay_min ? ` · затори +${t.eta_traffic_delay_min} хв` : ""}${t.eta_updated_at ? ` · оновлено ${ago(t.eta_updated_at)}` : ""}`,
              )
            : field("Розвантаження (план)", fmtDT(t.unload_planned_at));

    box.innerHTML = `
        <div class="td-head">
            <div>
                <div class="trip-no">Рейс № ${t.trip_no}${t.client ? " · " + escapeHtml(t.client) : ""}</div>
                <h2 class="td-title">${escapeHtml(shortPlace(t.load_address))} → ${escapeHtml(shortPlace(t.unload_address))}</h2>
                <div style="margin-top:6px">${statusBadge(t.status)}${
                    t.deal_id && !EMBED ? ` <a href="deals.html?open=${escapeHtml(t.deal_id)}" class="td-deal-link"><i class="bx bx-file"></i> Відкрити угоду</a>` : ""
                }</div>
            </div>
            <div class="td-actions">
                ${!FINISHED.includes(t.status) ? `<button type="button" class="btn btn-secondary" data-act="invite"><i class="bx bx-send"></i> Повідомлення водію</button>` : ""}
                ${!FINISHED.includes(t.status) ? `<button type="button" class="btn btn-secondary" data-act="rotate" title="Якщо водій змінив телефон"><i class="bx bx-refresh"></i> Новий код</button>` : ""}
                <button type="button" class="btn btn-secondary" data-act="note"><i class="bx bx-note"></i> Нотатка</button>
                ${!FINISHED.includes(t.status) ? `<button type="button" class="btn btn-secondary" data-act="cancel"><i class="bx bx-x-circle"></i> Скасувати</button>` : ""}
            </div>
        </div>
        <div class="td-body">
            ${alerts.map((a) => `<div class="td-alert ${a.tone}"><b>${escapeHtml(a.short)}</b>${escapeHtml(a.text)}</div>`).join("")}

            <div>
                <div class="td-map" id="tripMap"></div>
                <div class="td-legend">
                    <span><i class="sw" style="background:#93c5fd"></i>Маршрут TomTom</span>
                    <span><i class="sw" style="background:#2563eb"></i>Фактичний шлях (GPS)</span>
                    <span><i class="sw" style="background:#0f172a;width:10px;height:10px"></i>Кордон</span>
                </div>
            </div>

            <div class="td-grid">
                ${field("Водій", `${escapeHtml(t.driver_name)}`, t.driver_phone ? `<a href="tel:${escapeHtml(t.driver_phone)}">${escapeHtml(t.driver_phone)}</a>` : "")}
                ${field("Перевізник", escapeHtml(t.carrier_name || "—"))}
                ${field("Авто", escapeHtml([t.truck_plate, t.trailer_plate].filter(Boolean).join(" / ") || "—"), "", true)}
                ${field("Остання точка", t.last_point_at ? ago(t.last_point_at) : "—", t.last_point_at ? fmtDT(t.last_point_at) : "")}
                ${field("Швидкість", t.last_speed_kmh != null && active ? `${Math.round(t.last_speed_kmh)} км/год` : "—", standing != null && standing > 10 && active ? `стоїть ${fmtDur(standing)}` : "")}
                ${etaHtml}
                ${field("Залишилось", t.eta_remaining_km != null && active ? `${Math.round(t.eta_remaining_km)} км` : "—", t.route_km ? `маршрут ${Math.round(t.route_km)} км` : "")}
                ${field("Батарея телефону", t.last_battery != null ? `${t.last_battery}%` : "—", `точок: ${t.points_count || 0}`)}
                ${field("Трекінг", `${fmtDT(t.tracking_start_at)} — ${t.finished_at ? fmtDT(t.finished_at) : "до розвантаження"}`, t.status === "assigned" ? `код водія: <b>${escapeHtml(t.invite_code)}</b>` : "")}
            </div>

            <div>
                <div class="td-section-title"><i class="bx bx-list-check"></i> Етапи рейсу</div>
                <ul class="tl">${eventsHtml}${aheadHtml}</ul>
            </div>

            <div>
                <div class="td-section-title"><i class="bx bx-file"></i> Документи (${docs.length})</div>
                ${docs.length ? `<div class="td-docs">${docs.map((d) => (d.url ? `<a href="${escapeHtml(d.url)}" target="_blank" rel="noopener" title="${escapeHtml(d.kind.toUpperCase())} · ${fmtDT(d.uploaded_at)}"><img src="${escapeHtml(d.url)}" alt="${escapeHtml(d.kind.toUpperCase())} від ${fmtDT(d.uploaded_at)}" loading="lazy" /></a>` : "")).join("")}</div>` : `<div class="tl-note">Водій ще не надіслав фото CMR.</div>`}
            </div>

            ${t.notes ? `<div><div class="td-section-title">Нотатка</div><div class="tl-note">${escapeHtml(t.notes)}</div></div>` : ""}
        </div>`;

    if (!keepMap) drawMap();
}

document.getElementById("tripDetail").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn || !detail) return;
    const t = detail.trip;
    const act = btn.dataset.act;

    if (act === "invite") openInvite(t);

    if (act === "rotate") {
        if (!confirm("Видати новий код? Старий код перестане працювати, застосунок на старому телефоні відключиться.")) return;
        const { data, error } = await sbClient.rpc("rotate_trip_code", { p_trip: t.id });
        if (error) return alert("Помилка: " + error.message);
        t.invite_code = data;
        openInvite(t);
        openTrip(t.id);
    }

    if (act === "note") {
        const note = prompt("Нотатка до рейсу (побачать співробітники в етапах):");
        if (!note || !note.trim()) return;
        const { error } = await sbClient.from("trip_events").insert({
            trip_id: t.id,
            type: "note",
            source: "crm",
            author: currentStaff?.full_name || null,
            note: note.trim(),
        });
        if (error) return alert("Помилка: " + error.message);
        openTrip(t.id);
    }

    if (act === "cancel") {
        if (!confirm(`Скасувати рейс № ${t.trip_no}? Трекінг на телефоні водія зупиниться.`)) return;
        const { error } = await sbClient
            .from("trips")
            .update({ status: "cancelled", finished_at: new Date().toISOString() })
            .eq("id", t.id);
        if (error) return alert("Помилка: " + error.message);
        await sbClient.from("trip_events").insert({
            trip_id: t.id,
            type: "cancelled",
            source: "crm",
            author: currentStaff?.full_name || null,
        });
        await loadTrips();
        openTrip(t.id);
    }
});

/* ---------------- Карта (MapLibre + OSM, маршрут TomTom з fura-geo) ---------------- */

const MAPLIBRE = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl";
let mapLibPromise = null;

function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve();
    if (mapLibPromise) return mapLibPromise;
    mapLibPromise = new Promise((resolve, reject) => {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = MAPLIBRE + ".css";
        document.head.appendChild(css);
        const js = document.createElement("script");
        js.src = MAPLIBRE + ".js";
        js.onload = resolve;
        js.onerror = reject;
        document.head.appendChild(js);
    });
    return mapLibPromise;
}

const OSM_STYLE = {
    version: 8,
    sources: {
        osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
};

let truckMarker = null;

function trackGeoJson() {
    return {
        type: "Feature",
        geometry: {
            type: "LineString",
            coordinates: (detail?.positions || []).map((p) => [p.lon, p.lat]),
        },
    };
}

async function drawMap() {
    const el = document.getElementById("tripMap");
    if (!el || !detail) return;
    try {
        await loadMapLibre();
    } catch {
        el.innerHTML = `<div class="td-map-note">Не вдалося завантажити карту</div>`;
        return;
    }
    const gl = window.maplibregl;
    const t = detail.trip;
    if (map) {
        map.remove();
        map = null;
        mapReady = false;
        truckMarker = null;
    }

    const route = Array.isArray(t.route_line) ? t.route_line.map(([lat, lon]) => [lon, lat]) : [];
    const track = detail.positions.map((p) => [p.lon, p.lat]);
    const pts = [...route, ...track];
    if (t.load_lat != null) pts.push([t.load_lon, t.load_lat]);
    if (t.unload_lat != null) pts.push([t.unload_lon, t.unload_lat]);

    if (!pts.length) {
        el.innerHTML = `<div class="td-map-note">Немає координат маршруту. Позиція зʼявиться, коли водій почне рейс.</div>`;
        return;
    }
    const bounds = pts.reduce((b, c) => b.extend(c), new gl.LngLatBounds(pts[0], pts[0]));

    map = new gl.Map({
        container: el,
        style: OSM_STYLE,
        bounds,
        fitBoundsOptions: { padding: 40, maxZoom: 13 },
        scrollZoom: false,
        attributionControl: { compact: true, customAttribution: "Маршрут © TomTom" },
    });
    map.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new gl.FullscreenControl(), "top-right");

    // Шари додаємо, щойно завантажився стиль — не чекаючи всіх плиток карти
    const init = () => {
        if (mapReady || !map || !map.isStyleLoaded()) return;
        mapReady = true;
        if (route.length > 1) {
            map.addSource("route", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: route } } });
            map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#93c5fd", "line-width": 6, "line-opacity": 0.9 } });
        }
        map.addSource("track", { type: "geojson", data: trackGeoJson() });
        map.addLayer({ id: "track", type: "line", source: "track", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#2563eb", "line-width": 4 } });

        const pin = (lat, lon, html, title) => {
            if (lat == null || lon == null) return;
            const d = document.createElement("div");
            d.innerHTML = html;
            d.title = title;
            new gl.Marker({ element: d.firstElementChild }).setLngLat([lon, lat]).addTo(map);
        };
        pin(t.load_lat, t.load_lon, `<div class="map-pin" style="background:#16a34a">A</div>`, "Завантаження: " + (t.load_address || ""));
        pin(t.unload_lat, t.unload_lon, `<div class="map-pin" style="background:#dc2626">B</div>`, "Розвантаження: " + (t.unload_address || ""));
        (t.borders || []).forEach((b) =>
            pin(b.lat, b.lon, `<div class="map-border"><i class='bx bx-shield-quarter'></i></div>`, `${b.name || "Кордон"}${b.from ? ": " + b.from + " → " + b.to : ""}`),
        );
        placeTruck();
    };
    map.on("styledata", init);
    map.on("load", init);
    // Запасний варіант: подія могла прийти раніше, ніж стиль позначився завантаженим
    const self = map;
    let tries = 0;
    const tick = setInterval(() => {
        if (map !== self || mapReady || ++tries > 100) return clearInterval(tick);
        init();
    }, 200);
}

function placeTruck() {
    if (!map || !mapReady || !detail) return;
    const t = detail.trip;
    const last = detail.positions[detail.positions.length - 1];
    const lat = last?.lat ?? t.last_lat;
    const lon = last?.lon ?? t.last_lon;
    if (lat == null || lon == null) return;
    const stale = !ACTIVE.includes(t.status) || (t.last_point_at && minutesSince(t.last_point_at) > NO_SIGNAL_MIN);
    if (!truckMarker) {
        const d = document.createElement("div");
        d.className = "map-truck";
        d.innerHTML = "<i class='bx bxs-truck'></i>";
        truckMarker = new window.maplibregl.Marker({ element: d }).setLngLat([lon, lat]).addTo(map);
    }
    truckMarker.setLngLat([lon, lat]);
    truckMarker.getElement().classList.toggle("stale", Boolean(stale));
    truckMarker.getElement().title = `Остання точка: ${fmtDT(t.last_point_at)}`;
}

/* ---------------- Живі оновлення ---------------- */

function subscribeRealtime() {
    sbClient
        .channel("fura-trips")
        .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, (payload) => {
            const row = payload.new;
            if (!row?.id) return;
            const i = trips.findIndex((t) => t.id === row.id);
            const slim = Object.fromEntries(LIST_COLUMNS.split(",").map((k) => [k, row[k]]));
            if (i >= 0) trips[i] = { ...trips[i], ...slim };
            else trips.unshift(slim);
            renderChips();
            renderList();
            if (detail && detail.trip.id === row.id) {
                const statusChanged = detail.trip.status !== row.status;
                detail.trip = { ...detail.trip, ...row };
                if (statusChanged) openTrip(row.id);
                else placeTruck();
            }
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_positions" }, (payload) => {
            const p = payload.new;
            if (!detail || p.trip_id !== detail.trip.id) return;
            detail.positions.push({ recorded_at: p.recorded_at, lat: p.lat, lon: p.lon, speed_kmh: p.speed_kmh });
            detail.positions.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
            if (map && mapReady && map.getSource("track")) map.getSource("track").setData(trackGeoJson());
            placeTruck();
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_events" }, (payload) => {
            const ev = payload.new;
            if (ev.type === "problem") {
                recentProblems.set(ev.trip_id, ev);
                renderList();
            }
            if (detail && ev.trip_id === detail.trip.id) openTrip(ev.trip_id);
        })
        .subscribe();
}

/* ---------------- Новий рейс ---------------- */

const tripModal = document.getElementById("tripModalOverlay");
const tripForm = document.getElementById("tripForm");
let requestsForTrips = [];
let carriers = [];

const $ = (id) => document.getElementById(id);

async function openTripModal(preselectRequestId = null) {
    tripForm.reset();
    pendingDealId = null;
    $("tripFormStatus").textContent = "";
    $("trip_logist_phone").value = currentStaff?.phone || "";
    const base = new Date();
    base.setDate(base.getDate() + 1);
    base.setHours(8, 0, 0, 0);
    $("trip_load_at").value = toLocalInput(base);
    $("trip_unload_at").value = toLocalInput(new Date(base.getTime() + 26 * 3600000));
    tripModal.classList.add("active");

    const [reqRes, carRes] = await Promise.all([
        sbClient
            .from("requests")
            .select("*")
            .eq("status", "В роботі")
            .order("created_at", { ascending: false })
            .limit(150),
        Promise.resolve({ data: [] }), // перевізники шукаються під час введення (нижче)
    ]);
    requestsForTrips = reqRes.data || [];
    carriers = carRes.data || [];

    $("trip_request").innerHTML =
        `<option value="">— без запиту —</option>` +
        requestsForTrips
            .map(
                (r) =>
                    `<option value="${r.id}">${escapeHtml(r.client || "Без клієнта")} · ${escapeHtml(shortPlace(r.load_address) || r.load_country || "")} → ${escapeHtml(shortPlace(r.unload_address) || r.unload_country || "")}${r.desired_date ? " · " + escapeHtml(r.desired_date) : ""}</option>`,
            )
            .join("");
    $("tripCarriers").innerHTML = carriers.map((c) => `<option value="${escapeHtml(c.name)}"></option>`).join("");
    $("tripCountries").innerHTML = COUNTRIES.map((c) => `<option value="${c}"></option>`).join("");

    if (preselectRequestId && requestsForTrips.some((r) => r.id === preselectRequestId)) {
        $("trip_request").value = preselectRequestId;
        fillFromRequest(preselectRequestId);
    }
}

function fillFromRequest(id) {
    const r = requestsForTrips.find((x) => x.id === id);
    if (!r) return;
    $("trip_client").value = r.client || "";
    $("trip_load_country").value = r.load_country || "";
    $("trip_load_address").value = r.load_address || "";
    $("trip_unload_country").value = r.unload_country || "";
    $("trip_unload_address").value = r.unload_address || "";
    if (r.desired_date) {
        const load = new Date(`${r.desired_date}T08:00:00`);
        if (!isNaN(load)) {
            $("trip_load_at").value = toLocalInput(load);
            $("trip_unload_at").value = toLocalInput(new Date(load.getTime() + 26 * 3600000));
        }
    }
}

$("trip_request").addEventListener("change", (e) => fillFromRequest(e.target.value));

// Підказки перевізників із реєстру під час введення назви або ЄДРПОУ
let carrierTimer = null;
$("trip_carrier").addEventListener("input", () => {
    clearTimeout(carrierTimer);
    const q = $("trip_carrier").value.replace(/[,()%*\\]/g, " ").trim();
    if (q.length < 2) return;
    carrierTimer = setTimeout(async () => {
        const { data } = await sbClient
            .from("carriers")
            .select("id,name,edrpou")
            .or(`name.ilike.%${q}%,edrpou.ilike.%${q}%`)
            .limit(20);
        (data || []).forEach((c) => {
            if (!carriers.some((x) => String(x.id) === String(c.id))) carriers.push(c);
        });
        $("tripCarriers").innerHTML = (data || []).map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.edrpou || "")}</option>`).join("");
    }, 250);
});
$("openTripModalBtn").addEventListener("click", () => openTripModal());
function closeTripModal() {
    tripModal.classList.remove("active");
    // У вкладці угоди: форму закрили без рейсу — повертаємо угоді її вигляд
    if (EMBED && !selectedId) parent.postMessage({ type: "fura-trip-close" }, location.origin);
}
$("closeTripModalBtn").addEventListener("click", closeTripModal);
$("cancelTripBtn").addEventListener("click", closeTripModal);

// Рейс з угоди: усе, що є в угоді, підставляємо у форму
async function openTripFromDeal(dealId) {
    const { data: d, error } = await sbClient.from("deals").select("*").eq("id", dealId).single();
    if (error || !d) return alert("Не вдалося відкрити угоду: " + (error?.message || "не знайдено"));
    await openTripModal(d.request_id || null);
    pendingDealId = d.id;
    const set = (id, v) => {
        if (v != null && v !== "") $(id).value = v;
    };
    set("trip_client", d.client);
    set("trip_load_country", d.load_country);
    set("trip_load_address", d.load_address);
    set("trip_unload_country", d.unload_country);
    set("trip_unload_address", d.unload_address);
    set("trip_carrier", d.carrier_name);
    if (d.carrier_id && d.carrier_name) carriers.push({ id: d.carrier_id, name: d.carrier_name, edrpou: d.carrier_edrpou });
    set("trip_driver_name", d.driver_name);
    set("trip_driver_phone", d.driver_phone);
    set("trip_truck", d.truck_plate);
    set("trip_trailer", d.trailer_plate);
    set("trip_logist_phone", d.logist_phone);
    if (d.notes) set("trip_notes", d.notes);
    const loadDay = d.load_date || d.load_date_plan;
    if (loadDay) {
        const load = new Date(`${loadDay}T08:00:00`);
        if (!isNaN(load)) {
            $("trip_load_at").value = toLocalInput(load);
            const unloadDay = d.unload_date || d.unload_date_plan;
            const unload = unloadDay ? new Date(`${unloadDay}T17:00:00`) : new Date(load.getTime() + 26 * 3600000);
            $("trip_unload_at").value = toLocalInput(unload < load ? new Date(load.getTime() + 26 * 3600000) : unload);
        }
    }
    const title = tripModal.querySelector("h2, .modal-title");
    if (title) title.textContent = `Трекінг для угоди № ${d.number}`;
}

// Маршрут для фури через уже наявну функцію fura-geo (TomTom)
async function routeFor(payload) {
    const code = window.furaCountryCode || (() => "");
    try {
        const { data, error } = await sbClient.functions.invoke("fura-geo", {
            body: {
                action: "route",
                from: payload.load_address,
                to: payload.unload_address,
                fromCountry: code(payload.load_country),
                toCountry: code(payload.unload_country),
            },
        });
        if (error || !data || data.error) return null;
        return data;
    } catch {
        return null;
    }
}

// Не зберігаємо тисячі точок маршруту — проріджуємо до ~1500
function thinLine(line, max = 1500) {
    if (!Array.isArray(line) || line.length <= max) return line || null;
    const step = Math.ceil(line.length / max);
    const out = line.filter((_, i) => i % step === 0);
    out.push(line[line.length - 1]);
    return out;
}

tripForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const loadAt = new Date($("trip_load_at").value);
    const unloadAt = new Date($("trip_unload_at").value);
    if (isNaN(loadAt) || isNaN(unloadAt)) return alert("Вкажіть дати завантаження і розвантаження.");
    if (unloadAt < loadAt) return alert("Розвантаження не може бути раніше завантаження.");

    const carrierName = $("trip_carrier").value.trim();
    const carrier = carriers.find((c) => (c.name || "").trim().toLowerCase() === carrierName.toLowerCase());

    const payload = {
        request_id: $("trip_request").value || null,
        client: $("trip_client").value.trim() || null,
        logist_name: currentStaff?.full_name || null,
        logist_phone: $("trip_logist_phone").value.trim() || null,
        carrier_id: carrier ? String(carrier.id) : null,
        carrier_name: carrierName || null,
        driver_name: $("trip_driver_name").value.trim(),
        driver_phone: $("trip_driver_phone").value.trim(),
        truck_plate: $("trip_truck").value.trim().toUpperCase() || null,
        trailer_plate: $("trip_trailer").value.trim().toUpperCase() || null,
        load_country: $("trip_load_country").value.trim() || null,
        load_address: $("trip_load_address").value.trim(),
        unload_country: $("trip_unload_country").value.trim() || null,
        unload_address: $("trip_unload_address").value.trim(),
        load_planned_at: loadAt.toISOString(),
        unload_planned_at: unloadAt.toISOString(),
        notes: $("trip_notes").value.trim() || null,
    };
    if (pendingDealId) payload.deal_id = pendingDealId;

    const saveBtn = $("saveTripBtn");
    saveBtn.disabled = true;
    $("tripFormStatus").textContent = "Будуємо маршрут TomTom…";

    const route = await routeFor(payload);
    if (route) {
        Object.assign(payload, {
            load_lat: route.from?.lat ?? null,
            load_lon: route.from?.lon ?? null,
            unload_lat: route.to?.lat ?? null,
            unload_lon: route.to?.lon ?? null,
            route_line: thinLine(route.line),
            route_km: route.km ?? null,
            borders: route.borders || [],
        });
    } else {
        $("tripFormStatus").textContent = "Маршрут не знайдено — рейс створимо без нього (прогноз прибуття не рахуватиметься).";
    }

    const { data, error } = await sbClient.from("trips").insert(payload).select("*").single();
    saveBtn.disabled = false;
    if (error) {
        $("tripFormStatus").textContent = "";
        return alert("Помилка Supabase: " + error.message);
    }
    tripModal.classList.remove("active");
    if (EMBED) {
        // Перевантажуємо вкладку вже з готовим рейсом і відразу показуємо повідомлення водію
        location.replace(`trips.html?embed=1&trip=${data.id}&invite=1`);
        return;
    }
    filter = "assigned";
    await loadTrips();
    openTrip(data.id);
    openInvite(data);
});

/* ---------------- Повідомлення водію ---------------- */

const inviteModal = $("inviteModalOverlay");

function inviteText(t) {
    return [
        `Рейс № ${t.trip_no} · GRANDAR`,
        `${shortPlace(t.load_address)} → ${shortPlace(t.unload_address)}`,
        `Завантаження: ${fmtDT(t.load_planned_at)}`,
        t.truck_plate ? `Авто: ${[t.truck_plate, t.trailer_plate].filter(Boolean).join(" / ")}` : null,
        "",
        "1) Встановіть застосунок «FURA Водій»:",
        `Android: ${APP_LINKS.android || "[посилання Google Play]"}`,
        `iPhone: ${APP_LINKS.ios || "[посилання App Store]"}`,
        `2) Відкрийте застосунок і введіть код рейсу: ${t.invite_code}`,
        "",
        "Застосунок передає місцезнаходження лише під час рейсу і вимикається після розвантаження.",
    ]
        .filter((x) => x !== null)
        .join("\n");
}

function openInvite(t) {
    $("inviteCode").textContent = t.invite_code;
    $("inviteText").value = inviteText(t);
    inviteModal.classList.add("active");
}

$("copyInviteBtn").addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText($("inviteText").value);
        $("copyInviteBtn").innerHTML = "<i class='bx bx-check'></i> Скопійовано";
        setTimeout(() => ($("copyInviteBtn").innerHTML = "<i class='bx bx-copy'></i> Скопіювати"), 1500);
    } catch {
        $("inviteText").select();
    }
});
$("closeInviteModalBtn").addEventListener("click", () => inviteModal.classList.remove("active"));
$("doneInviteBtn").addEventListener("click", () => inviteModal.classList.remove("active"));

/* ---------------- "Шлях" з меню ---------------- */

function openShlyahModal() {
    window.open("https://shlyah.dsbt.gov.ua/lc.html", "_blank", "noopener");
}

/* ---------------- Бічна панель ---------------- */

function toggleSidebar() {
    document.body.classList.toggle("sidebar-collapsed");
    const icon = document.querySelector("#sidebarToggleBtn i");
    if (icon) {
        icon.classList.toggle("bx-chevron-left");
        icon.classList.toggle("bx-chevron-right");
    }
}

/* ---------------- Старт ---------------- */

(async function start() {
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
    await sbClient.rpc("close_stale_trips"); // закрити рейси, де минув запас часу
    await loadTrips();
    subscribeRealtime();

    // Раз на хвилину оновлюємо «N хв тому» і попередження
    setInterval(async () => {
        await loadTrips();
        if (detail) renderDetailTextOnly();
    }, 60 * 1000);

    const params = new URLSearchParams(location.search);
    if (params.get("trip")) {
        filter = "all";
        renderChips();
        renderList();
        await openTrip(params.get("trip"));
        if (params.get("invite") === "1" && detail?.trip) openInvite(detail.trip);
    }
    // Вкладка «Трекінг» в угоді: trips.html?embed=1&new_from_deal=<id>
    if (params.get("new_from_deal")) {
        await openTripFromDeal(params.get("new_from_deal"));
    }
    // Перехід із картки запиту: trips.html?new_from_request=<id>
    if (params.get("new_from_request")) {
        openTripModal(params.get("new_from_request"));
        history.replaceState(null, "", location.pathname);
    }
})();

// Перемальовуємо текст деталей, а наявну карту переносимо як є (без перезавантаження)
function renderDetailTextOnly() {
    if (!detail) return;
    const fresh = trips.find((t) => t.id === detail.trip.id);
    if (fresh) detail.trip = { ...detail.trip, ...fresh };
    const oldMapEl = document.getElementById("tripMap");
    if (!map || !oldMapEl) {
        renderDetail();
        return;
    }
    oldMapEl.remove();
    renderDetail(true);
    const slot = document.getElementById("tripMap");
    if (slot) {
        slot.replaceWith(oldMapEl);
        map.resize();
        placeTruck();
    }
}
