/* ================================================================= *
 * FURA — AI-АГЕНТИ (агент ставок у Telegram)                          *
 * • черга чернеток: «Надіслати» / «Не надсилати»                       *
 * • відповіді перевізників зі ставкою й датою, які витяг агент          *
 * • пошук перевізників: запрошення в Telegram і запит на ставку         *
 * Усе надсилання робить сервер (функція fura-agent).                   *
 * ================================================================= */

const SUPABASE_URL = "https://prbfscwmemshwigiftha.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const params = new URLSearchParams(location.search);
const REQUEST_ID = params.get("request") || "";

const requestsById = new Map();
const selectedCarriers = new Set();
// Перевізники, обрані в «Машини з черги» (request-match.js): agents.html?request=…&carriers=1,2,3
const PRESET_CARRIERS = (params.get("carriers") || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 60);

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

function fmtTime(value) {
    if (!value) return "";
    const d = new Date(value);
    const today = new Date().toDateString() === d.toDateString();
    const hm = d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
    return today ? hm : `${d.toLocaleDateString("uk-UA")} ${hm}`;
}

function routeOf(r) {
    if (!r) return "запит";
    return `${r.load_country || "—"} → ${r.unload_country || "—"}`;
}

let toastTimer = null;
function toast(text, isError = false) {
    const el = document.getElementById("agToast");
    el.textContent = text;
    el.classList.toggle("error", isError);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), isError ? 6000 : 3000);
}

// Виклик функції fura-agent від імені того, хто увійшов
async function agent(body) {
    const { data, error } = await sbClient.functions.invoke("fura-agent", { body });
    if (error) {
        let message = "Сервер агента не відповів. Перевірте, чи розгорнута функція fura-agent.";
        try {
            const j = await error.context?.json();
            if (j?.error) message = j.error;
        } catch (_) {}
        throw new Error(message);
    }
    return data;
}

async function ensureRequests(ids) {
    const missing = [...new Set(ids)].filter((id) => id && !requestsById.has(id));
    if (!missing.length) return;
    const { data } = await sbClient
        .from("requests")
        .select("id, client, load_country, load_address, unload_country, unload_address, desired_date, desired_date_to, cargo, transport_type, weight, request_type, status")
        .in("id", missing);
    (data || []).forEach((r) => requestsById.set(r.id, r));
}

/* ---------------- Запит (якщо відкрито з картки) ---------------- */

async function renderRequest() {
    if (!REQUEST_ID) return;
    await ensureRequests([REQUEST_ID]);
    const r = requestsById.get(REQUEST_ID);
    const panel = document.getElementById("requestPanel");
    panel.hidden = false;
    if (!r) {
        document.getElementById("requestSummary").innerHTML = `<p class="ag-empty">Запит не знайдено.</p>`;
        return;
    }
    const date = fmtDate(r.desired_date) + (r.desired_date_to && r.desired_date_to !== r.desired_date ? ` – ${fmtDate(r.desired_date_to)}` : "");
    const cargo = [r.cargo, r.transport_type, r.weight].filter(Boolean).join(" · ");
    document.getElementById("requestSummary").innerHTML = `
        <div><span>Маршрут:</span> <b>${escapeHtml(routeOf(r))}</b></div>
        ${date ? `<div><span>Дата:</span> ${escapeHtml(date)}</div>` : ""}
        ${cargo ? `<div><span>Вантаж:</span> ${escapeHtml(cargo)}</div>` : ""}
        <div><span>Клієнт:</span> ${escapeHtml(r.client || "—")} <span class="ag-chip warn">перевізник не бачить</span></div>`;
    document.getElementById("carriersHint").textContent =
        "Позначте перевізників з Telegram або телефоном і натисніть «Підготувати запит на ставку». Клієнта й ціну агент не називає.";
}

/* ---------------- Черга чернеток ---------------- */

const carriersById = new Map();

async function ensureCarriers(ids) {
    const missing = [...new Set(ids.map(String))].filter((id) => id && !carriersById.has(id));
    if (!missing.length) return;
    const { data } = await sbClient.from("carriers").select("id, name, phone_1, phone_2, tg_chat_id").in("id", missing);
    (data || []).forEach((c) => carriersById.set(String(c.id), c));
}

// Телефон перевізника для Viber/WhatsApp: спершу мобільний (Viber працює тільки з мобільними)
const UA_MOBILE = /^380(39|50|63|66|67|68|73|89|9[1-9])\d{7}$/;

function phoneDigits(c) {
    const all = [];
    for (const raw of [c?.phone_1, c?.phone_2]) {
        for (const m of String(raw || "").match(/\+?\d[\d\s\-().]{7,}\d/g) || []) {
            let d = m.replace(/\D/g, "");
            if (d.length === 10 && d.startsWith("0")) d = "38" + d; // 067… → 38067…
            else if (d.length === 9) d = "380" + d; // 67… → 38067…
            if (d.length >= 10 && d.length <= 15) all.push(d);
        }
    }
    return all.find((d) => UA_MOBILE.test(d)) || all.find((d) => !d.startsWith("380")) || all[0] || "";
}

function prettyPhone(d) {
    return d ? `+${d}` : "";
}

function chatLink(kind, digits, text) {
    const t = encodeURIComponent(text);
    if (kind === "viber") return `viber://chat?number=%2B${digits}&draft=${t}`;
    return `https://wa.me/${digits}?text=${t}`;
}

async function loadQueue() {
    let q = sbClient
        .from("agent_messages")
        .select("*")
        .eq("direction", "out")
        .eq("status", "draft")
        .order("created_at", { ascending: true })
        .limit(100);
    if (REQUEST_ID) q = q.eq("request_id", REQUEST_ID);
    const { data, error } = await q;
    const box = document.getElementById("queueList");
    document.getElementById("queueCount").textContent = String(data?.length || 0);

    if (error) {
        box.innerHTML = `<p class="ag-empty">Не вдалося завантажити: ${escapeHtml(error.message)}. Чи виконано agent_bids.sql?</p>`;
        return;
    }
    if (!data?.length) {
        box.innerHTML = `<p class="ag-empty">Немає чернеток. Знайдіть перевізників нижче й підготуйте запит на ставку.</p>`;
        return;
    }
    await ensureRequests(data.map((m) => m.request_id));
    await ensureCarriers(data.map((m) => m.carrier_id));

    box.innerHTML = data
        .map((m) => {
            const r = requestsById.get(m.request_id);
            const c = carriersById.get(String(m.carrier_id));
            const tg = !!c?.tg_chat_id;
            const phone = phoneDigits(c);
            const buttons = [];
            if (phone) {
                buttons.push(`<button type="button" class="btn-primary ag-viber" data-open="viber" data-id="${m.id}" data-phone="${phone}"><i class="bx bx-phone"></i> Відкрити у Viber</button>`);
                buttons.push(`<button type="button" class="btn-secondary" data-open="whatsapp" data-id="${m.id}" data-phone="${phone}"><i class="bx bxl-whatsapp"></i> WhatsApp</button>`);
                buttons.push(`<button type="button" class="btn-secondary" data-copy-draft="${m.id}"><i class="bx bx-copy"></i> Копіювати текст</button>`);
            }
            if (tg) buttons.push(`<button type="button" class="${phone ? "btn-secondary" : "btn-primary"}" data-send="${m.id}"><i class="bx bx-send"></i> Надіслати в Telegram</button>`);
            if (tg) buttons.push(`<button type="button" class="btn-secondary" data-test="${m.id}" title="Повідомлення прийде у ваш Telegram, перевізнику — нічого">Мені (тест)</button>`);
            buttons.push(`<button type="button" class="btn-secondary" data-reject="${m.id}">Не надсилати</button>`);
            return `
            <article class="ag-item" data-id="${m.id}">
                <div class="ag-item-meta">
                    <strong>${m.carrier_id ? `<a href="#" data-carrier-card="${escapeHtml(m.carrier_id)}" class="fura-clink" title="Відкрити картку перевізника">${escapeHtml(m.carrier_name || "Перевізник")}</a>` : escapeHtml(m.carrier_name || "Перевізник")}</strong>
                    ${phone ? `<span class="ag-chip">${escapeHtml(prettyPhone(phone))}</span>` : ""}
                    ${tg ? `<span class="ag-chip good">Telegram</span>` : ""}
                    <a class="ag-link" href="agents.html?request=${encodeURIComponent(m.request_id)}">${escapeHtml(routeOf(r))}</a>
                    <span>${escapeHtml(fmtTime(m.created_at))}</span>
                </div>
                <label class="ag-label" for="draft-${m.id}">Чернетка агента — можна виправити</label>
                <textarea id="draft-${m.id}">${escapeHtml(m.text)}</textarea>
                <div class="ag-item-actions">${buttons.join("")}</div>
                <div class="ag-confirm" data-confirm="${m.id}" hidden>
                    <span>Текст уже скопійовано. У месенджері клікніть у поле повідомлення → <b>Cmd+V</b> (Mac) або <b>Ctrl+V</b> (Windows) → надішліть. Тільки після цього натисніть «Я надіслав».</span>
                    <button type="button" class="btn-primary" data-marked="${m.id}">Я надіслав</button>
                </div>
                ${!phone && !tg ? `<span class="ag-hint">У перевізника немає телефону в базі — додайте його в картці перевізника.</span>` : ""}
            </article>`;
        })
        .join("");
}

// Копіюємо одразу в момент натискання (після запиту до бази браузер може заборонити)
function copyNow(text) {
    let ok = false;
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
    } catch (_) {}
    try {
        navigator.clipboard?.writeText(text).catch(() => {});
        ok = true;
    } catch (_) {}
    return ok;
}

document.getElementById("queueList").addEventListener("click", async (e) => {
    // Viber / WhatsApp: телефон із бази, текст агента — логісту лишається натиснути «Надіслати»
    const copyId = e.target.closest("[data-copy-draft]")?.dataset.copyDraft;
    if (copyId) {
        const text = document.getElementById(`draft-${copyId}`).value.trim();
        toast(copyNow(text) ? "Текст скопійовано — вставте в месенджер (Cmd+V / Ctrl+V)" : "Не вдалося скопіювати — виділіть текст і скопіюйте вручну", !text);
        return;
    }

    const openBtn = e.target.closest("[data-open]");
    if (openBtn) {
        const id = openBtn.dataset.id;
        const kind = openBtn.dataset.open;
        const card = openBtn.closest(".ag-item");
        const text = document.getElementById(`draft-${id}`).value.trim();
        const phone = openBtn.dataset.phone || "";
        if (!text || !phone) return toast("Немає тексту або телефону", true);
        copyNow(text);
        const url = chatLink(kind, phone, text);
        if (kind === "viber") window.location.href = url;
        else window.open(url, "_blank", "noopener");
        const box = card.querySelector("[data-confirm]");
        box.hidden = false;
        box.dataset.channel = kind;
        box.querySelector("[data-marked]").textContent = kind === "viber" ? "Я надіслав у Viber" : "Я надіслав у WhatsApp";
        return;
    }

    const markedId = e.target.closest("[data-marked]")?.dataset.marked;
    if (markedId) {
        const card = e.target.closest(".ag-item");
        const channel = card.querySelector("[data-confirm]").dataset.channel || "manual";
        card.querySelectorAll("button").forEach((b) => (b.disabled = true));
        try {
            const text = document.getElementById(`draft-${markedId}`).value.trim();
            await agent({ action: "mark_sent", id: markedId, channel, text });
            toast("Позначено як надіслане. Коли перевізник відповість — вставте відповідь праворуч.");
            refreshAll();
        } catch (err) {
            toast(err.message, true);
            card.querySelectorAll("button").forEach((b) => (b.disabled = false));
        }
        return;
    }

    const testId = e.target.closest("[data-test]")?.dataset.test;
    if (testId) {
        const btn = e.target.closest("[data-test]");
        btn.disabled = true;
        try {
            const text = document.getElementById(`draft-${testId}`).value.trim();
            await agent({ action: "test_send", id: testId, text });
            toast("Тест надіслано у ваш Telegram. Перевізнику нічого не пішло.");
        } catch (err) {
            toast(err.message, true);
        } finally {
            btn.disabled = false;
        }
        return;
    }

    const sendId = e.target.closest("[data-send]")?.dataset.send;
    const rejectId = e.target.closest("[data-reject]")?.dataset.reject;
    const id = sendId || rejectId;
    if (!id) return;
    const card = e.target.closest(".ag-item");
    card.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
        if (sendId) {
            const text = document.getElementById(`draft-${id}`).value.trim();
            if (!text) throw new Error("Порожній текст");
            await agent({ action: "send", id, text });
            toast("Надіслано в Telegram");
        } else {
            await agent({ action: "reject", id });
            toast("Не надіслано");
        }
        refreshAll();
    } catch (err) {
        toast(err.message, true);
        card.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
});

/* ---------------- Вставити відповідь перевізника (з Viber / WhatsApp) ---------------- */

async function renderReplyForm() {
    const form = document.getElementById("replyForm");
    // Кому вже надіслали запит: по цьому запиту, або (на загальній сторінці) за останні 14 днів
    let q = sbClient
        .from("agent_messages")
        .select("request_id, carrier_id, carrier_name, channel, sent_at")
        .eq("direction", "out")
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(100);
    if (REQUEST_ID) q = q.eq("request_id", REQUEST_ID);
    else q = q.gte("sent_at", new Date(Date.now() - 14 * 864e5).toISOString());
    const { data } = await q;
    const seen = new Map();
    (data || []).forEach((m) => {
        const key = `${m.request_id}|${m.carrier_id}`;
        if (!seen.has(key)) seen.set(key, m);
    });
    if (!seen.size) {
        form.hidden = true;
        return;
    }
    await ensureRequests([...seen.values()].map((m) => m.request_id));
    const sel = document.getElementById("replyCarrier");
    const keep = sel.value;
    sel.innerHTML = [...seen.entries()]
        .map(([key, m]) => {
            const label = REQUEST_ID ? m.carrier_name || "Перевізник" : `${m.carrier_name || "Перевізник"} — ${routeOf(requestsById.get(m.request_id))}`;
            return `<option value="${escapeHtml(key)}" data-channel="${escapeHtml(m.channel || "manual")}">${escapeHtml(label)}</option>`;
        })
        .join("");
    if (keep && seen.has(keep)) sel.value = keep;
    form.hidden = false;
}

document.getElementById("replyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sel = document.getElementById("replyCarrier");
    const ta = document.getElementById("replyText");
    const btn = document.getElementById("replyBtn");
    const text = ta.value.trim();
    if (!text) return toast("Вставте текст відповіді перевізника", true);
    btn.disabled = true;
    btn.textContent = "Агент читає…";
    try {
        const [requestId, carrierId] = String(sel.value).split("|");
        await agent({
            action: "manual_reply",
            request_id: requestId,
            carrier_id: carrierId,
            channel: sel.selectedOptions[0]?.dataset.channel || "manual",
            text,
        });
        ta.value = "";
        toast("Готово: ставку записано, чернетка відповіді — у черзі ліворуч");
        refreshAll();
    } catch (err) {
        toast(err.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = "Розібрати відповідь";
    }
});

/* ---------------- Відповіді перевізників ---------------- */

async function loadBids() {
    let q = sbClient
        .from("agent_messages")
        .select("*")
        .eq("direction", "in")
        .order("created_at", { ascending: false })
        .limit(REQUEST_ID ? 100 : 30);
    if (REQUEST_ID) q = q.eq("request_id", REQUEST_ID);
    const { data, error } = await q;
    const box = document.getElementById("bidsList");
    if (error) {
        box.innerHTML = `<p class="ag-empty">Не вдалося завантажити: ${escapeHtml(error.message)}</p>`;
        return;
    }
    if (!data?.length) {
        box.innerHTML = `<p class="ag-empty">Ще ніхто не відповів.</p>`;
        return;
    }
    await ensureRequests(data.map((m) => m.request_id));

    box.innerHTML = data
        .map((m) => {
            const x = m.extracted || {};
            const r = requestsById.get(m.request_id);
            const chip = x.has_bid && x.price
                ? `<span class="ag-chip good">ставка</span>`
                : x.can_do === false
                  ? `<span class="ag-chip">відмова</span>`
                  : x.questions?.length
                    ? `<span class="ag-chip warn">питання</span>`
                    : "";
            const bid = x.has_bid && x.price
                ? `<div class="ag-bid">
                        <div><span>Ставка</span><b>${escapeHtml(x.price)} ${escapeHtml(x.currency || "")}</b></div>
                        <div><span>Подача</span><b>${escapeHtml(fmtDate(x.load_date) || "—")}${x.load_time ? " " + escapeHtml(x.load_time) : ""}</b></div>
                        <div><span>Оплата</span><b>${escapeHtml(x.payment_terms || "—")}</b></div>
                   </div>`
                : "";
            return `
            <article class="ag-item reply">
                <div class="ag-item-meta">
                    <strong>${m.carrier_id ? `<a href="#" data-carrier-card="${escapeHtml(m.carrier_id)}" class="fura-clink" title="Відкрити картку перевізника">${escapeHtml(m.carrier_name || "Перевізник")}</a>` : escapeHtml(m.carrier_name || "Перевізник")}</strong>
                    ${chip}
                    <a class="ag-link" href="agents.html?request=${encodeURIComponent(m.request_id)}">${escapeHtml(routeOf(r))}</a>
                    <span>${escapeHtml(fmtTime(m.created_at))}</span>
                </div>
                ${bid}
                ${x.summary ? `<div class="ag-hint">Агент: ${escapeHtml(x.summary)}</div>` : ""}
                <p class="ag-item-text">${escapeHtml(m.text)}</p>
            </article>`;
        })
        .join("");
}

/* ---------------- Перевізники: пошук, запрошення, вибір ---------------- */

let searchTimer = null;

async function searchCarriers() {
    const box = document.getElementById("carrierResults");
    const raw = document.getElementById("carrierSearch").value.trim();
    const onlyLinked = document.getElementById("onlyLinked").checked;
    // Символи, які ламають фільтр Supabase, прибираємо
    const term = raw.replace(/[,()%*\\]/g, " ").trim();

    const preset = !term && !onlyLinked && PRESET_CARRIERS.length > 0;
    if (!term && !onlyLinked && !preset) {
        box.innerHTML = `<p class="ag-empty" style="padding:10px 4px">Почніть вводити назву або ЄДРПОУ.</p>`;
        return;
    }

    let q = sbClient.from("carriers").select("id, name, edrpou, city, phone_1, phone_2, tg_chat_id, tg_linked_at").limit(preset ? 60 : 25);
    if (preset) q = q.in("id", PRESET_CARRIERS);
    if (term) q = q.or(`name.ilike.%${term}%,edrpou.ilike.%${term}%`);
    if (onlyLinked) q = q.not("tg_chat_id", "is", null);
    q = q.order("name", { ascending: true });

    const { data, error } = await q;
    if (error) {
        box.innerHTML = `<p class="ag-empty" style="padding:10px 4px">Помилка пошуку: ${escapeHtml(error.message)}. Чи виконано agent_bids.sql?</p>`;
        return;
    }
    if (!data?.length) {
        box.innerHTML = `<p class="ag-empty" style="padding:10px 4px">Нічого не знайдено.</p>`;
        return;
    }

    box.innerHTML = data
        .map((c) => {
            const id = String(c.id);
            const linked = !!c.tg_chat_id;
            const phone = phoneDigits(c);
            const canPick = REQUEST_ID && (linked || phone);
            const info = [c.edrpou && `ЄДРПОУ ${c.edrpou}`, c.city].filter(Boolean).join(" · ");
            return `
            <div class="ag-carrier" data-carrier="${escapeHtml(id)}">
                <label>
                    ${canPick ? `<input type="checkbox" data-pick="${escapeHtml(id)}" ${selectedCarriers.has(id) ? "checked" : ""} />` : ""}
                    <span>
                        <span class="name">${escapeHtml(c.name || "Без назви")}</span> <a href="#" data-carrier-card="${escapeHtml(id)}" class="ag-card-link" title="Відкрити картку перевізника"><i class="bx bx-link-external"></i></a><br />
                        <span class="muted">${escapeHtml(info)}</span>
                    </span>
                </label>
                ${phone ? `<span class="ag-chip">Viber / WhatsApp ${escapeHtml(prettyPhone(phone))}</span>` : `<span class="ag-chip warn">немає телефону</span>`}
                ${linked
                    ? `<span class="ag-chip good">Telegram підключено</span>`
                    : `<div class="ag-invite"><button type="button" class="btn-secondary" data-invite="${escapeHtml(id)}"><i class="bx bx-link"></i> Запрошення в Telegram</button></div>`}
            </div>`;
        })
        .join("");
}

function updateSelected() {
    document.getElementById("selectedCount").textContent = String(selectedCarriers.size);
    document.getElementById("draftActions").hidden = !REQUEST_ID || selectedCarriers.size === 0;
}

document.getElementById("carrierSearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchCarriers, 300);
});
document.getElementById("onlyLinked").addEventListener("change", searchCarriers);

document.getElementById("carrierResults").addEventListener("change", (e) => {
    const id = e.target.dataset?.pick;
    if (!id) return;
    if (e.target.checked) selectedCarriers.add(id);
    else selectedCarriers.delete(id);
    updateSelected();
});

document.getElementById("carrierResults").addEventListener("click", async (e) => {
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
        const input = copyBtn.parentElement.querySelector("input");
        try {
            await navigator.clipboard.writeText(input.value);
            toast("Посилання скопійовано — надішліть його перевізнику");
        } catch (_) {
            input.select();
            toast("Скопіюйте посилання вручну (Ctrl+C)");
        }
        return;
    }

    const id = e.target.closest("[data-invite]")?.dataset.invite;
    if (!id) return;
    const holder = e.target.closest(".ag-invite");
    holder.innerHTML = `<span class="ag-hint">Створюю посилання…</span>`;
    try {
        const res = await agent({ action: "invite", carrier_id: id });
        holder.innerHTML = `
            <input type="text" readonly value="${escapeHtml(res.link)}" aria-label="Посилання-запрошення" />
            <button type="button" class="btn-secondary" data-copy="1"><i class="bx bx-copy"></i> Копіювати</button>`;
    } catch (err) {
        holder.innerHTML = `<span class="ag-hint">${escapeHtml(err.message)}</span>`;
    }
});

document.getElementById("createDraftsBtn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
        const res = await agent({ action: "draft", request_id: REQUEST_ID, carrier_ids: [...selectedCarriers] });
        if (res.created) {
            toast(`Агент підготував ${res.created} чернетк${res.created === 1 ? "у" : "и"} — перевірте й надішліть`);
        } else {
            toast(res.note || "Нових чернеток немає — цим перевізникам уже писали по цьому запиту");
        }
        selectedCarriers.clear();
        updateSelected();
        searchCarriers();
        refreshAll();
    } catch (err) {
        toast(err.message, true);
    } finally {
        btn.disabled = false;
    }
});

/* ---------------- Старт ---------------- */

function refreshAll() {
    loadQueue();
    loadBids();
    renderReplyForm();
}

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

    await renderRequest();
    refreshAll();
    if (REQUEST_ID && PRESET_CARRIERS.length) {
        PRESET_CARRIERS.forEach((id) => selectedCarriers.add(id));
        const hint = document.getElementById("carrierSearch");
        if (hint) hint.placeholder = `Обрано з «Машини з черги»: ${PRESET_CARRIERS.length}. Пошук — щоб додати ще.`;
    }
    searchCarriers();
    updateSelected();

    // Нові відповіді й чернетки з'являються самі
    let t = null;
    sbClient
        .channel("agent-messages")
        .on("postgres_changes", { event: "*", schema: "public", table: "agent_messages" }, () => {
            clearTimeout(t);
            t = setTimeout(refreshAll, 400);
        })
        .subscribe();
});
