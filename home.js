/* ================================================================= *
 * FURA — ГОЛОВНА СТОРІНКА (швидкі команди)                           *
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

const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function rolesOf(s) {
    return Array.isArray(s?.roles) && s.roles.length
        ? s.roles
        : s?.role
          ? [s.role]
          : [];
}

/* ---------------- Швидкі команди ---------------- */

function quickCard({
    href,
    onclick,
    icon,
    color,
    title,
    sub,
    count,
    countTone,
}) {
    const attrs = href ? `href="${href}"` : `href="#" data-action="${onclick}"`;
    return `
        <a class="quick-card" ${attrs} style="--qc:${color}">
            <span class="quick-icon"><i class='bx ${icon}'></i></span>
            <span class="quick-text">
                <span class="quick-title">${escapeHtml(title)}</span>
                <span class="quick-sub">${escapeHtml(sub || "")}</span>
            </span>
            ${count ? `<span class="quick-count ${countTone || ""}">${count}</span>` : ""}
        </a>`;
}

async function renderHome(session) {
    const email = (session.user?.email || "").toLowerCase();
    const { data: staff } = await sbClient.from("staff").select("*");
    const me =
        (staff || []).find((s) => (s.email || "").toLowerCase() === email) ||
        null;
    const roles = rolesOf(me);
    const isBoss = roles.includes("admin") || roles.includes("head");

    // Привітання
    const h = new Date().getHours();
    const hello =
        h < 12 ? "Доброго ранку" : h < 18 ? "Добрий день" : "Добрий вечір";
    const firstName = (me?.full_name || "").split(" ").slice(-1)[0];
    document.getElementById("homeGreeting").textContent =
        `${hello}${firstName ? ", " + firstName : ""}!`;
    const dateText = new Date().toLocaleDateString("uk-UA", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    });
    document.getElementById("homeDate").textContent =
        dateText.charAt(0).toUpperCase() + dateText.slice(1);

    // Лічильники (кожен бачить тільки те, що йому доступно)
    const [{ data: reqs }, { data: leads }] = await Promise.all([
        sbClient
            .from("requests")
            .select(
                "id, status, created_at, logistician_ids, logistician_id, answers",
            ),
        sbClient.from("leads").select("id, status, sales_id, next_contact"),
    ]);
    const myId = String(me?.id || "");
    const newReqs = (reqs || []).filter((r) => r.status === "Запит");
    const overdue = newReqs.filter(
        (r) => Date.now() - new Date(r.created_at).getTime() > 2 * 3600000,
    );
    const forMe = newReqs.filter((r) => {
        const ids = (r.logistician_ids || []).map(String);
        const answered = (r.answers || []).some(
            (a) => String(a.logist_id) === myId,
        );
        return (
            (ids.includes(myId) || String(r.logistician_id) === myId) &&
            !answered
        );
    });
    const inWork = (reqs || []).filter((r) => r.status === "В роботі");
    const toCall = (leads || []).filter(
        (l) =>
            (isBoss || String(l.sales_id) === myId) &&
            l.next_contact &&
            String(l.next_contact).slice(0, 10) <= todayIso() &&
            !["Працюємо", "Відмова"].includes(l.status),
    );

    const cards = [
        quickCard({
            href: "requests.html?new=1",
            icon: "bx-plus-circle",
            color: "#2a78d6",
            title: "Новий запит",
            sub: "Створити запит для логіста",
        }),
        quickCard({
            href: "leads.html?new=1",
            icon: "bx-user-plus",
            color: "#1baf7a",
            title: "Новий лід",
            sub: "Додати клієнта",
        }),
        quickCard({
            href: "index.html?new=1",
            icon: "bx-car",
            color: "#6250d6",
            title: "Додати перевізника",
            sub: "У реєстр перевізників",
        }),
        quickCard({
            href: "requests.html",
            icon: "bx-time-five",
            color: "#eda100",
            title: "Запити без відповіді",
            sub: overdue.length
                ? `з них понад 2 год: ${overdue.length}`
                : "нові запити",
            count: newReqs.length || "",
            countTone: overdue.length ? "tone-red" : "tone-amber",
        }),
    ];
    if (forMe.length) {
        cards.push(
            quickCard({
                href: "requests.html",
                icon: "bx-bell",
                color: "#e34948",
                title: "Чекають моєї відповіді",
                sub: "запити, надіслані вам",
                count: forMe.length,
                countTone: "tone-red",
            }),
        );
    }
    cards.push(
        quickCard({
            href: "leads.html?today=1",
            icon: "bx-phone-call",
            color: "#e87ba4",
            title: "Кому подзвонити сьогодні",
            sub: isBoss ? "усі Sales" : "ваші клієнти",
            count: toCall.length || "",
            countTone: "tone-amber",
        }),
        quickCard({
            href: "requests.html",
            icon: "bx-briefcase",
            color: "#008300",
            title: "В роботі",
            sub: "запити, де обрано логіста",
            count: inWork.length || "",
        }),
        quickCard({
            href: "reports.html",
            icon: "bx-bar-chart-alt-2",
            color: "#2a78d6",
            title: "Підсумки місяця",
            sub: "графіки і хто як працює",
        }),
        quickCard({
            onclick: "shlyah",
            icon: "bx-search-alt",
            color: "#52514e",
            title: "Шлях",
            sub: "перевірка транспортного засобу",
        }),
    );

    document.getElementById("quickGrid").innerHTML = cards.join("");
}

// Клік по плитці "Шлях" (вішаємо один раз — плитки перемальовуються)
document.getElementById("quickGrid").addEventListener("click", (e) => {
    const a = e.target.closest("[data-action]");
    if (!a) return;
    e.preventDefault();
    if (a.dataset.action === "shlyah") openShlyahModal();
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
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeShlyahModal();
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
    renderHome(session);
    // Новий запит / відповідь логіста — лічильники оновлюються самі (notify.js)
    window.furaOnRequestsChanged = () => renderHome(session);
});
