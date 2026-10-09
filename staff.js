/* ================================================================= *
 * СТОРІНКА "СПІВРОБІТНИКИ"                                           *
 * ================================================================= */

const SUPABASE_URL = "https://prbfscwmemshwigiftha.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function logout() {
    await sbClient.auth.signOut();
    window.location.href = "login.html";
}

// Ролі: значення в базі → підпис і колір плашки
const STAFF_ROLES = [
    { value: "sales", label: "Sales", cls: "role-sales", icon: "bx-briefcase" },
    { value: "logist", label: "Логіст", cls: "role-logist", icon: "bx-car" },
    { value: "head", label: "Керівник", cls: "role-head", icon: "bx-crown" },
];

let staffCache = [];

const tableBody = document.getElementById("staffTableBody");
const modalOverlay = document.getElementById("staffModalOverlay");
const staffForm = document.getElementById("staffForm");

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function roleBadge(role) {
    const r = STAFF_ROLES.find((x) => x.value === role);
    if (!r) return escapeHtml(role || "—");
    return `<span class="role-badge ${r.cls}"><i class='bx ${r.icon}'></i> ${r.label}</span>`;
}

// "@ivan" або "ivan" → посилання на Telegram
function telegramLink(username) {
    const nick = String(username || "")
        .trim()
        .replace(/^@/, "");
    if (!nick) return "—";
    return `<a href="https://t.me/${encodeURIComponent(nick)}" target="_blank" rel="noopener" class="tg-link"><i class='bx bxl-telegram'></i> @${escapeHtml(nick)}</a>`;
}

/* ================================================================= *
 * ЗАВАНТАЖЕННЯ ТА ТАБЛИЦЯ                                            *
 * ================================================================= */

async function loadStaff() {
    const { data, error } = await sbClient
        .from("staff")
        .select("*")
        .order("active", { ascending: false })
        .order("full_name", { ascending: true });

    if (error) {
        console.error(error);
        tableBody.innerHTML = `<tr><td colspan="8" class="empty-row">Помилка завантаження: ${escapeHtml(error.message)}<br>Можливо, ще не виконано staff.sql у Supabase.</td></tr>`;
        return;
    }

    staffCache = data || [];
    renderStaff();
}

function renderStaff() {
    const bar = document.getElementById("staffCountBar");
    const activeCount = staffCache.filter((s) => s.active).length;
    bar.textContent = staffCache.length
        ? `Співробітників: ${activeCount}` +
          (activeCount !== staffCache.length
              ? ` (неактивних: ${staffCache.length - activeCount})`
              : "")
        : "";

    if (!staffCache.length) {
        tableBody.innerHTML = `<tr><td colspan="8" class="empty-row">Ще нікого немає — натисніть «Додати співробітника»</td></tr>`;
        return;
    }

    tableBody.innerHTML = "";
    staffCache.forEach((s, i) => {
        const tr = document.createElement("tr");
        tr.className = "clickable-row" + (s.active ? "" : " staff-inactive");
        tr.title = "Натисніть, щоб редагувати";

        tr.innerHTML = `
            <td class="cell-num">${i + 1}</td>
            <td><strong>${escapeHtml(s.full_name)}</strong></td>
            <td>${roleBadge(s.role)}</td>
            <td>${escapeHtml(s.email) || "—"}</td>
            <td>${escapeHtml(s.phone) || "—"}</td>
            <td>
                ${telegramLink(s.telegram_username)}
                ${s.telegram_chat_id ? `<div class="tg-connected"><i class='bx bx-check'></i> бот підключено</div>` : ""}
            </td>
            <td>${s.active ? `<span class="status-badge status-confirmed">Працює</span>` : `<span class="status-badge status-request">Неактивний</span>`}</td>
            <td class="cell-actions">
                <button class="btn-icon btn-icon-edit" data-action="edit" title="Редагувати"><i class='bx bx-edit'></i></button>
                <button class="btn-icon text-danger" data-action="delete" title="Видалити"><i class='bx bx-trash'></i></button>
            </td>
        `;

        tr.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-action]");
            if (btn && btn.dataset.action === "delete") {
                deleteStaff(s);
                return;
            }
            if (e.target.closest("a")) return; // клік по посиланню Telegram
            openStaffModal(s);
        });

        tableBody.appendChild(tr);
    });
}

/* ================================================================= *
 * ФОРМА                                                              *
 * ================================================================= */

function renderRolePicker(selected) {
    document.getElementById("rolePicker").innerHTML = STAFF_ROLES.map(
        (r) => `
        <label class="role-option ${r.cls}">
            <input type="radio" name="staff_role" value="${r.value}" ${r.value === selected ? "checked" : ""} />
            <i class='bx ${r.icon}'></i> ${r.label}
        </label>`,
    ).join("");
}

function openStaffModal(s = null) {
    staffForm.reset();
    document.getElementById("staffId").value = s ? s.id : "";
    document.getElementById("staff_full_name").value = s?.full_name || "";
    document.getElementById("staff_email").value = s?.email || "";
    document.getElementById("staff_phone").value = s?.phone || "";
    document.getElementById("staff_telegram").value = s?.telegram_username
        ? "@" + String(s.telegram_username).replace(/^@/, "")
        : "";
    document.getElementById("staff_active").checked = s ? s.active : true;
    renderRolePicker(s?.role || "sales");

    document.getElementById("staffModalTitle").textContent = s
        ? "Редагувати співробітника"
        : "Додати співробітника";
    modalOverlay.classList.add("active");
}

function closeStaffModal() {
    modalOverlay.classList.remove("active");
}

staffForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const val = (id) => {
        const v = document.getElementById(id).value.trim();
        return v || null;
    };
    const role =
        document.querySelector("input[name='staff_role']:checked")?.value ||
        "sales";
    const tg = val("staff_telegram");

    const payload = {
        full_name: val("staff_full_name"),
        role,
        email: val("staff_email") ? val("staff_email").toLowerCase() : null,
        phone: val("staff_phone"),
        telegram_username: tg ? tg.replace(/^@/, "") : null,
        active: document.getElementById("staff_active").checked,
    };

    const id = document.getElementById("staffId").value;
    const { error } = id
        ? await sbClient.from("staff").update(payload).eq("id", id)
        : await sbClient.from("staff").insert([payload]);

    if (error) {
        const msg = error.message.includes("staff_email_unique")
            ? "Співробітник з такою поштою вже є."
            : error.message;
        alert("Помилка: " + msg);
        console.error(error);
        return;
    }

    closeStaffModal();
    loadStaff();
});

async function deleteStaff(s) {
    const ok = confirm(
        `Видалити «${s.full_name}»?\n\n` +
            `Порада: якщо людина звільнилась, краще зняти галочку «Працює» — ` +
            `тоді її ім'я залишиться в старих запитах і зникне тільки з вибору.`,
    );
    if (!ok) return;

    const { error } = await sbClient.from("staff").delete().eq("id", s.id);
    if (error) {
        alert("Помилка при видаленні: " + error.message);
    } else {
        loadStaff();
    }
}

document
    .getElementById("openStaffModalBtn")
    .addEventListener("click", () => openStaffModal());
document
    .getElementById("closeStaffModalBtn")
    .addEventListener("click", closeStaffModal);
document
    .getElementById("cancelStaffBtn")
    .addEventListener("click", closeStaffModal);
modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeStaffModal();
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
        closeStaffModal();
        closeShlyahModal();
    }
});

/* ================================================================= *
 * СТАРТ + ПЕРЕВІРКА АВТОРИЗАЦІЇ                                      *
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

    sbClient.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") window.location.href = "login.html";
    });

    loadStaff();
});
