/* ===================== FURA — спільне для форм у Telegram ===================== */

const FURA_API =
    "https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-bot";

const tg = window.Telegram?.WebApp;

const COUNTRIES = [
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

const CURRENCIES = ["EUR", "USD", "UAH"];

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function fmtDate(value) {
    if (!value) return "";
    const [y, m, d] = String(value).slice(0, 10).split("-");
    return y && m && d ? `${d}.${m}.${y}` : "";
}

function fmtPeriod(from, to) {
    const f = fmtDate(from);
    if (!f) return "";
    const t = fmtDate(to);
    if (!t || t === f) return f;
    const [fd, fm, fy] = f.split(".");
    const [td, tm, ty] = t.split(".");
    if (fy === ty && fm === tm) return `${fd}–${td}.${tm}.${ty}`;
    if (fy === ty) return `${fd}.${fm}–${td}.${tm}.${ty}`;
    return `${f} – ${t}`;
}

function optionsHtml(list, selected = "", placeholder = "") {
    return (
        (placeholder
            ? `<option value="">${escapeHtml(placeholder)}</option>`
            : "") +
        list
            .map(
                (v) =>
                    `<option value="${escapeHtml(v)}" ${v === selected ? "selected" : ""}>${escapeHtml(v)}</option>`,
            )
            .join("")
    );
}

/* Запит до бота */
async function furaApi(action, payload = {}) {
    const res = await fetch(FURA_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            action,
            initData: tg?.initData || "",
            ...payload,
        }),
    });
    let data = {};
    try {
        data = await res.json();
    } catch {
        /* порожня відповідь */
    }
    if (!res.ok || data.error) {
        throw new Error(data.error || `Помилка ${res.status}`);
    }
    return data;
}

/* Екрани замість форми */
function showScreen(icon, title, text = "") {
    document.getElementById("app").innerHTML = `
        <div class="screen">
            <div class="icon">${icon}</div>
            <h2>${escapeHtml(title)}</h2>
            ${text ? `<p>${escapeHtml(text)}</p>` : ""}
        </div>`;
    tg?.MainButton?.hide();
}

function showError(text) {
    const box = document.getElementById("formError");
    if (box) {
        box.textContent = text;
        box.hidden = false;
        box.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    tg?.HapticFeedback?.notificationOccurred("error");
}

/* Старт: перевіряємо, що форму відкрито в Telegram */
function initTelegram() {
    if (!tg || !tg.initData) {
        showScreen(
            "🤖",
            "Відкрийте форму через Telegram",
            "Ця сторінка працює тільки з бота FURA CRM.",
        );
        return false;
    }
    tg.ready();
    tg.expand();
    return true;
}

/* Велика кнопка Telegram внизу екрана */
function setupMainButton(text, onSubmit) {
    const mb = tg.MainButton;
    mb.setText(text);
    mb.show();

    let busy = false;
    mb.onClick(async () => {
        if (busy) return;
        busy = true;
        mb.showProgress(false);
        try {
            await onSubmit();
        } finally {
            busy = false;
            mb.hideProgress();
        }
    });
}

/* Одна дата або період (галочка "період") */
function setupPeriod(root) {
    const toggle = root.querySelector(".js-period");
    const from = root.querySelector(".js-from");
    const to = root.querySelector(".js-to");
    const dash = root.querySelector(".js-dash");

    const sync = () => {
        to.hidden = !toggle.checked;
        dash.hidden = !toggle.checked;
        if (!toggle.checked) to.value = "";
        to.min = from.value || "";
        if (to.value && from.value && to.value < from.value)
            to.value = from.value;
    };

    toggle.addEventListener("change", sync);
    from.addEventListener("change", sync);
    sync();
}

function readPeriod(root) {
    const from = root.querySelector(".js-from").value || null;
    const to = root.querySelector(".js-period").checked
        ? root.querySelector(".js-to").value || null
        : null;
    return { from, to };
}

function periodFieldHtml(label, from = "", to = "") {
    const hasPeriod = Boolean(to && to !== from);
    return `
        <div class="field js-period-root">
            <div class="label-row">
                <label>${escapeHtml(label)}</label>
                <label class="toggle">
                    <input type="checkbox" class="js-period" ${hasPeriod ? "checked" : ""} /> період
                </label>
            </div>
            <div class="dates">
                <input type="date" class="js-from" value="${escapeHtml(from || "")}" />
                <span class="dash js-dash">—</span>
                <input type="date" class="js-to" value="${escapeHtml(hasPeriod ? to : "")}" />
            </div>
        </div>`;
}

function successAndClose(title, text) {
    tg?.HapticFeedback?.notificationOccurred("success");
    showScreen("✅", title, text);
    setTimeout(() => tg?.close(), 1500);
}
