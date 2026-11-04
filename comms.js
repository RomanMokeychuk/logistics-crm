/* ================================================================= *
 * FURA — ПЕРЕПИСКА з клієнтами                                       *
 * • розмови з Outlook, Telegram, WhatsApp, Viber (тільки читання;     *
 *   у Viber — відповідь прямо звідси)                                 *
 * • прив'язка розмови до ліда, передача іншому співробітнику          *
 * • «Підключення» (керівник): ящики, номери, стан каналів             *
 * Співробітник бачить свої розмови, керівник — усі (так і в базі).   *
 * ================================================================= */

const SUPABASE_URL = "https://prbfscwmemshwigiftha.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CH = {
    outlook: { label: "Outlook", icon: "bx-envelope", cls: "ch-outlook" },
    telegram: { label: "Telegram", icon: "bxl-telegram", cls: "ch-telegram" },
    whatsapp: { label: "WhatsApp", icon: "bxl-whatsapp", cls: "ch-whatsapp" },
    viber: { label: "Viber", icon: "bx-phone-call", cls: "ch-viber" },
};
const INTENT = {
    quote_request: ["💰 Просить ставку", "hot"],
    order: ["✅ Заявка / згода", "good"],
    complaint: ["⚠️ Скарга", "bad"],
    question: ["❓ Питання", "warn"],
};

let me = null;
let boss = false;
let staffList = [];
let leads = [];
let threads = [];
let currentId = null;

/* ---------------- Дрібниці ---------------- */

async function logout() {
    await sbClient.auth.signOut();
    window.location.href = "login.html";
}
function toggleSidebar() {
    document.body.classList.toggle("sidebar-collapsed");
    const icon = document.querySelector("#sidebarToggleBtn i");
    if (icon) {
        icon.classList.toggle("bx-chevron-left");
        icon.classList.toggle("bx-chevron-right");
    }
}
function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
const $ = (id) => document.getElementById(id);
const rolesOf = (s) => (Array.isArray(s?.roles) && s.roles.length ? s.roles : s?.role ? [s.role] : []);

function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    return today
        ? d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function waitingFor(iso) {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 60) return `${m} хв`;
    if (m < 48 * 60) return `${Math.round(m / 60)} год`;
    return `${Math.round(m / 1440)} дн.`;
}

let toastTimer = null;
function toast(text, isError = false) {
    const el = $("agToast");
    el.textContent = text;
    el.classList.toggle("error", isError);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), isError ? 7000 : 3000);
}
async function api(body) {
    const { data, error } = await sbClient.functions.invoke("fura-comms", { body });
    if (error) {
        let message = "Сервер не відповів. Перевірте, чи розгорнута функція fura-comms.";
        try {
            const j = await error.context?.json();
            if (j?.error) message = j.error;
        } catch (_) {}
        throw new Error(message);
    }
    return data;
}
async function withBusy(btn, fn) {
    if (btn) btn.disabled = true;
    try {
        return await fn();
    } catch (e) {
        toast(e.message, true);
    } finally {
        if (btn) btn.disabled = false;
    }
}
const chBadge = (c) => {
    const x = CH[c] || { label: c, icon: "bx-chat", cls: "" };
    return `<span class="cm-ch ${x.cls}"><i class="bx ${x.icon}"></i> ${x.label}</span>`;
};

/* ---------------- Список розмов ---------------- */

async function loadThreads() {
    const { data, error } = await sbClient.from("comm_threads").select("*").order("last_message_at", { ascending: false, nullsFirst: false }).limit(800);
    if (error) {
        $("cmThreads").innerHTML = `<p class="ag-empty">Не вдалося прочитати переписку: ${escapeHtml(error.message)}. Чи виконано comms.sql?</p>`;
        return;
    }
    threads = data || [];
    renderThreads();
}

function renderThreads() {
    const q = $("cmSearch").value.trim().toLowerCase();
    const ch = $("cmChannel").value;
    const st = $("cmStaff").value;
    const waiting = $("cmWaiting").checked;
    const unlinked = $("cmUnlinked").checked;
    const list = threads.filter(
        (t) =>
            (!ch || t.channel === ch) &&
            (!st || (st === "__none" ? !t.staff_id : String(t.staff_id) === st)) &&
            (!waiting || (t.unanswered_since && !t.carrier_id)) &&
            (!unlinked || (!t.lead_id && !t.carrier_id)) &&
            (!q || [t.contact_name, t.contact_handle, t.lead_name, t.last_preview, t.staff_name].some((v) => String(v || "").toLowerCase().includes(q))),
    );
    $("cmThreads").innerHTML = list.length
        ? list
              .map(
                  (t) => `<button type="button" class="cm-thread-item ${t.id === currentId ? "active" : ""} ${t.unanswered_since && !t.carrier_id ? "waiting" : ""}" data-id="${t.id}">
                <div class="cm-ti-top">
                    <b>${escapeHtml(t.lead_name || t.contact_name || t.contact_handle)}</b>
                    <span class="cm-ti-time">${fmtTime(t.last_message_at)}</span>
                </div>
                <div class="cm-ti-mid">${chBadge(t.channel)}
                    ${t.carrier_id ? `<span class="ag-chip">перевізник</span>` : t.lead_id ? "" : `<span class="ag-chip warn">без ліда</span>`}
                    ${boss && t.staff_name ? `<span class="cm-ti-staff">${escapeHtml(t.staff_name)}</span>` : ""}
                </div>
                <div class="cm-ti-prev">${t.last_direction === "out" ? "Ви: " : ""}${escapeHtml(t.last_preview || "")}</div>
                ${t.unanswered_since && !t.carrier_id ? `<div class="cm-ti-wait">⏳ чекає ${waitingFor(t.unanswered_since)}</div>` : ""}
            </button>`,
              )
              .join("")
        : `<p class="ag-empty">${threads.length ? "Нічого не знайдено." : "Переписки ще немає — підключіть канали на вкладці «Підключення»."}</p>`;
}

$("cmThreads").addEventListener("click", (e) => {
    const b = e.target.closest(".cm-thread-item");
    if (b) openThread(b.dataset.id);
});
["cmSearch", "cmChannel", "cmStaff", "cmWaiting", "cmUnlinked"].forEach((id) => $(id).addEventListener("input", renderThreads));

/* ---------------- Розмова ---------------- */

async function openThread(id) {
    currentId = id;
    renderThreads();
    const t = threads.find((x) => x.id === id);
    const box = $("cmThread");
    if (!t) {
        box.innerHTML = `<p class="ag-empty cm-placeholder">Розмову не знайдено або вона не ваша.</p>`;
        return;
    }
    const { data: msgs } = await sbClient.from("comm_messages").select("*").eq("thread_id", id).order("sent_at").limit(500);
    history.replaceState(null, "", `comms.html?t=${id}`);

    const staffSel = boss
        ? `<label class="cm-field">Веде
             <select id="cmAssign">${[`<option value="">— не призначено —</option>`]
                 .concat(staffList.filter((s) => s.active).map((s) => `<option value="${escapeHtml(s.id)}" ${String(s.id) === String(t.staff_id) ? "selected" : ""}>${escapeHtml(s.full_name)}</option>`))
                 .join("")}</select></label>`
        : `<span class="ag-hint">Веде: <b>${escapeHtml(t.staff_name || "—")}</b></span>`;

    box.innerHTML = `
        <div class="cm-head">
            <div>
                <h2>${escapeHtml(t.contact_name || t.contact_handle)}</h2>
                <div class="cm-head-sub">${chBadge(t.channel)} <span class="ag-hint">${escapeHtml(t.contact_handle)}</span></div>
            </div>
            <div class="cm-head-actions">
                ${staffSel}
                <label class="cm-field">Лід
                    <input id="cmLeadInput" list="cmLeadList" placeholder="Почніть вводити назву…" value="${escapeHtml(t.carrier_id ? "" : t.lead_name || "")}" />
                </label>
                <button type="button" class="btn btn-secondary btn-sm" id="cmLinkBtn"><i class="bx bx-link"></i> Прив'язати</button>
                ${t.lead_id ? `<a class="btn btn-secondary btn-sm" href="leads.html?open=${encodeURIComponent(t.lead_id)}"><i class="bx bx-link-external"></i> Картка</a>` : ""}
            </div>
        </div>
        ${t.carrier_id ? `<p class="ag-hint">Це перевізник «${escapeHtml(t.lead_name || "")}» — у перевірки клієнтів не потрапляє.</p>` : ""}
        <div class="cm-msgs" id="cmMsgs">
            ${(msgs || [])
                .map((m) => {
                    const intent = INTENT[m.ai_intent];
                    const flags = [
                        intent ? `<span class="ag-chip ${intent[1]}">${intent[0]}</span>` : "",
                        m.direction === "out" && m.ai_has_rate ? `<span class="ag-chip good">ставку названо</span>` : "",
                        m.ai_tone === "rude" ? `<span class="ag-chip bad">грубий тон</span>` : m.ai_tone === "cold" ? `<span class="ag-chip warn">сухо</span>` : "",
                    ].join("");
                    return `<div class="cm-msg ${m.direction}">
                        ${m.subject ? `<div class="cm-msg-subj">${escapeHtml(m.subject)}</div>` : ""}
                        <div class="cm-msg-text">${escapeHtml(m.text || "")}</div>
                        <div class="cm-msg-foot">${fmtTime(m.sent_at)}${m.ai_note ? ` · ${escapeHtml(m.ai_note)}` : ""} ${flags}</div>
                    </div>`;
                })
                .join("")}
        </div>
        ${
            t.channel === "viber"
                ? `<form class="cm-reply" id="cmReply">
                    <textarea id="cmReplyText" rows="2" placeholder="Відповідь клієнту у Viber…" maxlength="4000"></textarea>
                    <button type="submit" class="btn btn-primary"><i class="bx bx-send"></i> Надіслати</button>
                   </form>`
                : `<p class="ag-hint cm-readonly">Відповідайте як звичайно — з ${CH[t.channel]?.label || "каналу"}. Відповідь з'явиться тут сама.</p>`
        }`;
    const msgBox = $("cmMsgs");
    msgBox.scrollTop = msgBox.scrollHeight;

    $("cmLinkBtn").addEventListener("click", (e) =>
        withBusy(e.currentTarget, async () => {
            const name = $("cmLeadInput").value.trim();
            const lead = name ? leads.find((l) => l.name === name) : null;
            if (name && !lead) throw new Error("Оберіть лід зі списку");
            const r = await api({ action: "link", thread_id: id, lead_id: lead?.id || null });
            toast(lead ? `Прив'язано до «${r.lead_name}»` : "Прив'язку знято");
            await loadThreads();
            openThread(id);
        }),
    );
    $("cmAssign")?.addEventListener("change", (e) =>
        withBusy(e.target, async () => {
            if (!e.target.value) return;
            await api({ action: "assign", thread_id: id, staff_id: e.target.value });
            toast("Розмову передано");
            await loadThreads();
        }),
    );
    $("cmReply")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const btn = e.target.querySelector("button");
        withBusy(btn, async () => {
            const text = $("cmReplyText").value.trim();
            if (!text) return;
            await api({ action: "reply_viber", thread_id: id, text });
            $("cmReplyText").value = "";
            await loadThreads();
            openThread(id);
        });
    });
}

/* ---------------- Підключення ---------------- */

async function loadSetup() {
    try {
        const s = await api({ action: "status" });
        const row = (ok, label, hint, setup) =>
            `<div class="cm-st ${ok ? "on" : ""}"><b>${ok ? "✅" : "⚪"} ${label}</b><span class="ag-hint">${hint}</span>${
                setup && ok ? `<button type="button" class="btn btn-secondary btn-sm" data-setup="${setup}">Налаштувати</button>` : ""
            }</div>`;
        $("cmStatus").innerHTML = [
            row(s.secret, "COMMS_SECRET", s.secret ? "є" : "додайте секрет — без нього не працює розклад і пересилання з бота"),
            row(s.outlook, "Outlook", s.outlook ? "програма Microsoft підключена" : "потрібні MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET", "outlook"),
            row(s.telegram, "Telegram Business", "кнопка додає бізнес-оновлення у вебхук бота (один раз)", "telegram"),
            row(s.whatsapp, "WhatsApp", s.whatsapp ? `вебхук у Meta: ${escapeHtml(s.webhook)}?src=whatsapp` : "потрібні WA_VERIFY_TOKEN і WA_APP_SECRET"),
            row(s.viber, "Viber-бот", s.viber ? "кнопка реєструє вебхук у Viber (один раз)" : "потрібен VIBER_TOKEN (після схвалення бота)", "viber"),
            row(s.ai, "Claude", s.ai ? "розбирає повідомлення: запит ставки, скарга, тон" : "без ANTHROPIC_API_KEY — лише час відповіді"),
        ].join("");
    } catch (e) {
        $("cmStatus").innerHTML = `<p class="ag-empty">${escapeHtml(e.message)}</p>`;
    }

    const { data: chans } = await sbClient.from("comm_channels").select("*").order("channel").order("account");
    $("cmChannels").innerHTML = (chans || []).length
        ? `<table class="cm-ch-table"><thead><tr><th>Канал</th><th>Акаунт</th><th>Співробітник</th><th>Стан</th><th></th></tr></thead><tbody>${chans
              .map(
                  (c) => `<tr class="${c.active ? "" : "off"}">
                <td>${chBadge(c.channel)}</td>
                <td>${escapeHtml(c.account_label || c.account)}${c.account_label && c.account_label !== c.account ? `<div class="ag-hint">${escapeHtml(c.account)}</div>` : ""}</td>
                <td><select data-owner="${c.id}" data-channel="${c.channel}" data-account="${escapeHtml(c.account)}" data-label="${escapeHtml(c.account_label || "")}" ${c.channel === "viber" ? "disabled title='Viber — спільний бот компанії'" : ""}>
                    <option value="">— не призначено —</option>
                    ${staffList.filter((s) => s.active).map((s) => `<option value="${escapeHtml(s.id)}" ${String(s.id) === String(c.staff_id) ? "selected" : ""}>${escapeHtml(s.full_name)}</option>`).join("")}
                </select></td>
                <td>${!c.active ? "вимкнено" : c.meta?.error ? `<span class="rop-warn">${escapeHtml(c.meta.error)}</span>` : c.channel === "outlook" ? (c.meta?.subscription_id ? "✅ підписано" : "очікує розкладу…") : "✅"}</td>
                <td>${c.active ? `<button type="button" class="btn btn-secondary btn-sm" data-off="${c.id}">Вимкнути</button>` : ""}</td>
            </tr>`,
              )
              .join("")}</tbody></table>`
        : `<p class="ag-empty">Ще нічого не підключено.</p>`;
}

$("cmStatus").addEventListener("click", (e) => {
    const b = e.target.closest("[data-setup]");
    if (!b) return;
    withBusy(b, async () => {
        const r = await api({ action: "setup", channel: b.dataset.setup });
        toast(r.message || "Готово");
        loadSetup();
    });
});
$("cmChannels").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-owner]");
    if (!sel) return;
    withBusy(sel, async () => {
        await api({ action: "channel_save", channel: sel.dataset.channel, account: sel.dataset.account, account_label: sel.dataset.label, staff_id: sel.value || null });
        toast("Збережено");
        loadThreads();
    });
});
$("cmChannels").addEventListener("click", (e) => {
    const b = e.target.closest("[data-off]");
    if (!b || !confirm("Вимкнути збір переписки з цього акаунта? Уже зібрана переписка лишиться.")) return;
    withBusy(b, async () => {
        await api({ action: "channel_delete", id: b.dataset.off });
        loadSetup();
    });
});
$("cmAddChannel").addEventListener("change", (e) => {
    $("cmAddAccount").placeholder = e.target.value === "outlook" ? "sales1@grandar.com.ua" : "phone_number_id з Meta (напр. 1234567890)";
});
$("cmAddForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector("button");
    withBusy(btn, async () => {
        await api({ action: "channel_save", channel: f.get("channel"), account: f.get("account"), account_label: f.get("account_label"), staff_id: f.get("staff_id") || null });
        toast("Збережено. Outlook підпишеться за кілька хвилин.");
        e.target.reset();
        loadSetup();
    });
});

document.querySelectorAll(".cm-tab").forEach((b) =>
    b.addEventListener("click", () => {
        document.querySelectorAll(".cm-tab").forEach((x) => x.classList.toggle("active", x === b));
        document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
        if (b.dataset.tab === "setup") loadSetup();
    }),
);

/* ---------------- Старт ---------------- */

document.addEventListener("DOMContentLoaded", async () => {
    const {
        data: { session },
    } = await sbClient.auth.getSession();
    if (!session) {
        window.location.href = "login.html";
        return;
    }
    sbClient.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") window.location.href = "login.html";
    });

    const [{ data: staff }, { data: leadRows }] = await Promise.all([
        sbClient.from("staff").select("*"),
        sbClient.from("leads").select("id, name").neq("status", "Відмова").order("name").limit(5000),
    ]);
    staffList = staff || [];
    leads = leadRows || [];
    const email = (session.user?.email || "").toLowerCase();
    me = staffList.find((s) => (s.email || "").toLowerCase() === email) || null;
    boss = rolesOf(me).some((r) => r === "head" || r === "admin");

    const dl = document.createElement("datalist");
    dl.id = "cmLeadList";
    dl.innerHTML = leads.map((l) => `<option value="${escapeHtml(l.name)}"></option>`).join("");
    document.body.appendChild(dl);

    if (boss) {
        $("cmSetupTab").hidden = false;
        $("cmStaff").hidden = false;
        const opts = staffList.filter((s) => s.active).map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.full_name)}</option>`).join("");
        $("cmStaff").innerHTML = `<option value="">Усі співробітники</option><option value="__none">Не призначено</option>${opts}`;
        $("cmAddStaff").innerHTML = `<option value="">— співробітник —</option>${opts}`;
    }
    document.body.style.visibility = "visible";

    await loadThreads();
    const params = new URLSearchParams(location.search);
    if (params.get("t")) openThread(params.get("t"));
    if (params.get("lead")) {
        const l = leads.find((x) => String(x.id) === params.get("lead"));
        if (l) {
            $("cmSearch").value = l.name;
            renderThreads();
        }
    }

    // Нові повідомлення з'являються самі
    let t = null;
    sbClient
        .channel("comms")
        .on("postgres_changes", { event: "*", schema: "public", table: "comm_threads" }, () => {
            clearTimeout(t);
            t = setTimeout(async () => {
                await loadThreads();
                // Не перемальовуємо розмову, поки людина пише відповідь
                if (currentId && !$("cmReplyText")?.value) openThread(currentId);
            }, 800);
        })
        .subscribe();
});
