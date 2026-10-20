/* ================================================================= *
 * СТОРІНКА "КЛІЄНТИ" — з ким уже працюємо                            *
 * Клієнт = запис із «Лідів» на етапі «Працюємо» або з угодами.       *
 * Картка: реквізити, контакти, адреси, менеджер, що/куди возить,    *
 * і всі угоди з ним (з «Угод», за lead_id).                          *
 * ================================================================= */

const SUPABASE_URL = "https://prbfscwmemshwigiftha.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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

const STATUS_WORK = "Працюємо";
const LEAD_STATUSES = ["Новий", "Контакт", "Переговори", "Працюємо", "Відмова"];
const TRADE_TYPES = ["Імпорт", "Експорт", "По Україні"];
const COUNTRIES = ["УКРАЇНА", "ПОЛЬША", "НІМЕЧЧИНА", "ЛИТВА", "ЛАТВІЯ", "ЕСТОНІЯ", "ЧЕХІЯ", "СЛОВАЧЧИНА", "УГОРЩИНА",
    "РУМУНІЯ", "МОЛДОВА", "БОЛГАРІЯ", "АВСТРІЯ", "ІТАЛІЯ", "ІСПАНІЯ", "ФРАНЦІЯ", "БЕЛЬГІЯ", "НІДЕРЛАНДИ", "ДАНІЯ",
    "ФІНЛЯНДІЯ", "ВЕЛИКОБРИТАНІЯ", "ТУРЕЧЧИНА", "ГРУЗІЯ", "ВІРМЕНІЯ", "АЗЕРБАЙДЖАН", "СЛОВЕНІЯ", "КАЗАХСТАН"];

let clientsCache = [];
let dealsByLead = new Map(); // id клієнта → [угоди]
let staffCache = [];
let currentStaff = null;
let currentClientId = null;

const $ = (id) => document.getElementById(id);

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
const e = escapeHtml;

function fmtDate(v) {
    if (!v) return "";
    const [y, m, d] = String(v).slice(0, 10).split("-");
    return y && m && d ? `${d}.${m}.${y}` : "";
}

function hasRole(s, list) {
    const roles = Array.isArray(s?.roles) && s.roles.length ? s.roles : [s?.role];
    return roles.some((r) => list.includes(r));
}

function digits(v) {
    return String(v || "").replace(/\D/g, "");
}

function phoneHtml(phone) {
    return String(phone || "")
        .split(/[,;]/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
            const d = digits(p);
            const viber = d.length >= 9
                ? ` <a href="viber://chat?number=%2B${d}" class="viber-link" title="Viber"><i class='bx bxs-message-rounded-dots'></i></a>`
                : "";
            return `<span class="phone-line"><a href="tel:+${d}">${e(p)}</a>${viber}</span>`;
        })
        .join("");
}

function emailHtml(email) {
    return email ? `<a href="mailto:${e(email)}">${e(email)}</a>` : "";
}

function tradeBadges(list) {
    const cls = { "Експорт": "trade-export", "Імпорт": "trade-import", "По Україні": "trade-ua" };
    return (Array.isArray(list) ? list : []).map((t) => `<span class="trade-badge ${cls[t] || ""}">${e(t)}</span>`).join("");
}

// Прибуток угоди в УЕ ($) з вкладки «Розрахунок»
function dealProfit(d) {
    const rows = Array.isArray(d.services) ? d.services : [];
    let inc = 0, exp = 0;
    rows.forEach((r) => {
        const qty = Number(r.qty) || 1;
        const n = (x) => Number(String(x ?? "").replace(",", ".")) || 0;
        if (n(r.in_fx)) inc += (qty * n(r.in_rate)) / n(r.in_fx);
        if (n(r.out_fx)) exp += (qty * n(r.out_rate)) / n(r.out_fx);
    });
    return rows.length ? inc - exp : null;
}

function dealStateLabel(d) {
    if (d.unload_date) return ["Доставлено", "deal-st-done"];
    if (d.load_date) return ["В дорозі", "deal-st-road"];
    if (d.load_date_plan && String(d.load_date_plan).slice(0, 10) < new Date().toISOString().slice(0, 10)) return ["Запізнення", "deal-st-late"];
    return ["Планується", "deal-st-plan"];
}

// IBAN України: UA + 2 контрольні цифри + 6 цифр МФО + 19 цифр рахунку
function cleanIban(v) {
    return String(v || "").replace(/\s+/g, "").toUpperCase();
}
function ibanPretty(v) {
    return cleanIban(v).replace(/(.{4})/g, "$1 ").trim();
}
function mfoFromIban(v) {
    const i = cleanIban(v);
    return /^UA\d{27}$/.test(i) ? i.slice(4, 10) : "";
}
function ibanValid(v) {
    const i = cleanIban(v);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(i)) return false;
    const r = (i.slice(4) + i.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
    let m = 0;
    for (const ch of r) m = (m * 10 + Number(ch)) % 97;
    return m === 1;
}

const money = (v) => (v === null || v === undefined ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("uk-UA", { maximumFractionDigits: 0 })}`);

/* ---------------- Завантаження ---------------- */

async function loadStaff(session) {
    const { data } = await sbClient.from("staff").select("*").order("full_name");
    staffCache = data || [];
    const email = (session?.user?.email || "").toLowerCase();
    currentStaff = staffCache.find((s) => (s.email || "").toLowerCase() === email) || null;
    const sales = staffCache.filter((s) => s.active && hasRole(s, ["sales", "head", "admin"]));
    $("clientsSalesFilter").innerHTML =
        `<option value="">Усі менеджери</option>` +
        (currentStaff ? `<option value="__me">Тільки мої</option>` : "") +
        sales.map((s) => `<option value="${e(s.id)}">${e(s.full_name)}</option>`).join("");
}

async function loadClients() {
    const [{ data: leads, error }, { data: deals }] = await Promise.all([
        sbClient.from("leads").select("*").order("name"),
        sbClient
            .from("deals")
            .select("id, number, lead_id, client, created_at, load_country, load_address, unload_country, unload_address, load_date_plan, load_date, unload_date, carrier_name, truck_plate, services, paid_by_client")
            .order("number", { ascending: false }),
    ]);
    if (error) {
        $("clientsTableBody").innerHTML = `<tr><td colspan="7" class="empty-row">Помилка завантаження: ${e(error.message)}</td></tr>`;
        return;
    }
    dealsByLead = new Map();
    (deals || []).forEach((d) => {
        if (!d.lead_id) return;
        const k = String(d.lead_id);
        if (!dealsByLead.has(k)) dealsByLead.set(k, []);
        dealsByLead.get(k).push(d);
    });
    clientsCache = (leads || []).filter((l) => l.status === STATUS_WORK || dealsByLead.has(String(l.id)));
    renderClients();
}

/* ---------------- Список ---------------- */

function renderClients() {
    const q = $("clientsSearch").value.trim().toLowerCase();
    const trade = $("clientsTradeFilter").value;
    let sales = $("clientsSalesFilter").value;
    if (sales === "__me") sales = currentStaff ? String(currentStaff.id) : "";

    const list = clientsCache.filter((c) => {
        if (trade && !(c.trade_types || []).includes(trade)) return false;
        if (sales && String(c.sales_id || "") !== sales) return false;
        if (q) {
            const extra = (Array.isArray(c.contacts) ? c.contacts : []).map((x) => `${x.name} ${x.phone} ${x.email}`).join(" ");
            const hay = [c.name, c.full_name, c.edrpou, c.contact_person, c.phone, c.email, c.address, c.legal_address,
                c.city, c.directions, c.cargo, c.sales, c.contract_no, c.bank_iban, c.director, extra].filter(Boolean).join(" ").toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    $("clientsCountBar").textContent =
        list.length === clientsCache.length ? `Клієнтів: ${list.length}` : `Знайдено: ${list.length} з ${clientsCache.length}`;

    if (!list.length) {
        $("clientsTableBody").innerHTML = `<tr><td colspan="7" class="empty-row">${clientsCache.length ? "Нічого не знайдено" : "Клієнтів ще немає. Клієнтом стає лід на етапі «Працюємо» або той, з ким є угода. Можна додати й кнопкою «Новий клієнт»."}</td></tr>`;
        return;
    }

    $("clientsTableBody").innerHTML = list
        .map((c) => {
            const deals = dealsByLead.get(String(c.id)) || [];
            const last = deals[0];
            const profit = deals.reduce((s, d) => s + (dealProfit(d) || 0), 0);
            return `
            <tr data-id="${e(c.id)}" class="clickable-row" title="Натисніть, щоб відкрити картку клієнта">
                <td>
                    <div class="client-name">${e(c.name || "—")}</div>
                    ${c.edrpou ? `<code class="client-code">${e(c.edrpou)}</code>` : ""}
                    ${c.city ? `<div class="client-sub">${e(c.city)}</div>` : ""}
                </td>
                <td>${e(c.sales || "—")}</td>
                <td>
                    ${c.contact_person ? `<b>${e(c.contact_person)}</b>` : ""}
                    ${phoneHtml(c.phone)}
                    ${c.email ? `<div class="client-sub">${emailHtml(c.email)}</div>` : ""}
                    ${!c.contact_person && !c.phone && !c.email ? "—" : ""}
                </td>
                <td>${tradeBadges(c.trade_types) || ""}${c.directions ? `<div class="client-sub">${e(c.directions)}</div>` : ""}${!(c.trade_types || []).length && !c.directions ? "—" : ""}</td>
                <td class="client-cargo">${e(c.cargo || "—")}</td>
                <td>
                    ${deals.length ? `<b>${deals.length}</b> <span class="client-sub">угод</span>` : `<span class="client-sub">немає</span>`}
                    ${last ? `<div class="client-sub">остання № ${e(last.number)} · ${fmtDate(last.created_at)}</div>` : ""}
                </td>
                <td><button type="button" class="btn-icon" data-edit="${e(c.id)}" title="Редагувати"><i class="bx bx-edit"></i></button></td>
            </tr>`;
        })
        .join("");
}

$("clientsTableBody").addEventListener("click", (ev) => {
    const edit = ev.target.closest("[data-edit]");
    if (edit) {
        ev.stopPropagation();
        openClientView(edit.dataset.edit);
        return;
    }
    if (ev.target.closest("a")) return; // телефон / Viber / пошта
    const tr = ev.target.closest("tr[data-id]");
    if (tr) openClientView(tr.dataset.id);
});
["clientsSearch"].forEach((id) => $(id).addEventListener("input", renderClients));
["clientsTradeFilter", "clientsSalesFilter"].forEach((id) => $(id).addEventListener("change", renderClients));

/* ---------- Файли договору (Supabase Storage, закрите сховище client-docs) ---------- */
const FILE_BUCKET = "client-docs";

function filesHtml(c) {
    const files = Array.isArray(c.contract_files) ? c.contract_files : [];
    if (!files.length) return `<div class="client-sub client-nofiles">Файлів договору ще немає</div>`;
    return files
        .map(
            (f, i) => `<div class="client-file">
                <i class="bx ${/\.pdf$/i.test(f.name) ? "bxs-file-pdf" : /\.(jpe?g|png)$/i.test(f.name) ? "bx-image" : "bx-file"}"></i>
                <a href="#" data-file="${i}" title="Відкрити">${e(f.name)}</a>
                <span class="client-sub">${fmtDate(f.uploaded_at)}${f.by ? ` · ${e(f.by)}` : ""}</span>
                <button type="button" class="btn-icon" data-file-del="${i}" title="Видалити файл"><i class="bx bx-trash"></i></button>
            </div>`,
        )
        .join("");
}

function bindFiles(c) {
    const box = $("clientFiles");
    if (!box) return;
    box.onclick = async (ev) => {
        const files = Array.isArray(c.contract_files) ? c.contract_files : [];
        const open = ev.target.closest("[data-file]");
        const del = ev.target.closest("[data-file-del]");
        if (open) {
            ev.preventDefault();
            const f = files[Number(open.dataset.file)];
            const win = window.open("", "_blank");
            const { data, error } = await sbClient.storage.from(FILE_BUCKET).createSignedUrl(f.path, 600);
            if (error || !data?.signedUrl) {
                win?.close();
                return alert("Не вдалося відкрити файл: " + (error?.message || ""));
            }
            if (win) win.location = data.signedUrl;
            else location.href = data.signedUrl;
        }
        if (del) {
            const f = files[Number(del.dataset.fileDel)];
            if (!confirm(`Видалити файл «${f.name}»?`)) return;
            await sbClient.storage.from(FILE_BUCKET).remove([f.path]);
            const next = files.filter((_, i) => i !== Number(del.dataset.fileDel));
            const { error } = await sbClient.from("leads").update({ contract_files: next }).eq("id", c.id);
            if (error) return alert("Не вдалося зберегти: " + error.message);
            c.contract_files = next;
            box.innerHTML = filesHtml(c);
        }
    };
}

async function uploadClientFiles(c, list) {
    if (!list.length) return;
    const box = $("clientFiles");
    const files = Array.isArray(c.contract_files) ? [...c.contract_files] : [];
    for (const file of list) {
        if (file.size > 20 * 1024 * 1024) {
            alert(`«${file.name}» більший за 20 МБ — зменшіть файл.`);
            continue;
        }
        box.insertAdjacentHTML("beforeend", `<div class="client-sub client-uploading">Завантаження «${e(file.name)}»…</div>`);
        const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
        const path = `${c.id}/${Date.now()}_${safe}`;
        const { error } = await sbClient.storage.from(FILE_BUCKET).upload(path, file, { contentType: file.type || undefined });
        if (error) {
            box.querySelector(".client-uploading")?.remove();
            alert(/bucket|not found/i.test(error.message || "")
                ? "Сховище файлів ще не створене: один раз запустіть clients_docs.sql у Supabase."
                : "Не вдалося завантажити: " + error.message);
            continue;
        }
        files.push({ path, name: file.name, size: file.size, uploaded_at: new Date().toISOString(), by: currentStaff?.full_name || null });
    }
    const { error } = await sbClient.from("leads").update({ contract_files: files }).eq("id", c.id);
    if (error) alert("Файл завантажено, але не записано в картку: " + error.message);
    else c.contract_files = files;
    box.innerHTML = filesHtml(c);
    $("clientFileInput").value = "";
}


/* ================================================================= *
 * КАРТКА КЛІЄНТА — окрема сторінка, все редагується на місці         *
 * ================================================================= */

const CLIENT_TABS = [
    { key: "req", label: "Реквізити" },
    { key: "contacts", label: "Контакти" },
    { key: "contract", label: "Договір" },
    { key: "cargo", label: "Що і куди возить" },
    { key: "deals", label: "Угоди" },
];
let clientTab = "req";

const listView = $("clientsListView");
const detailView = $("clientDetailView");

function initials(name) {
    return String(name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase();
}

function salesOptions(selectedId, legacyName) {
    const list = staffCache.filter((s) => (s.active && hasRole(s, ["sales", "head", "admin"])) || String(s.id) === String(selectedId));
    return `<option value="">— не вибрано —</option>` +
        list.map((s) => `<option value="${e(s.id)}"${String(s.id) === String(selectedId) ? " selected" : ""}>${e(s.full_name)}</option>`).join("") +
        (!selectedId && legacyName ? `<option value="" selected>${e(legacyName)}</option>` : "");
}

function opt(list, selected, placeholder) {
    return (placeholder ? `<option value="">${placeholder}</option>` : "") +
        list.map((x) => `<option value="${e(x)}"${x === selected ? " selected" : ""}>${e(x)}</option>`).join("") +
        (selected && !list.includes(selected) ? `<option value="${e(selected)}" selected>${e(selected)}</option>` : "");
}

function fld(label, f, c, placeholder = "", type = "text", extra = "") {
    const val = type === "date" && c[f] ? String(c[f]).slice(0, 10) : c[f] ?? "";
    return `<div class="dv-field"><div class="dv-label">${label}</div>
        <input class="dv-in" type="${type}" data-f="${f}" value="${e(val)}" placeholder="${e(placeholder)}" ${extra} /></div>`;
}

function flashSaved(text = "Збережено", bad = false) {
    const el = $("cvSaved");
    if (!el) return;
    el.textContent = (bad ? "⚠ " : "✓ ") + text;
    el.style.color = bad ? "#dc2626" : "";
    el.style.opacity = 1;
    clearTimeout(flashSaved.t);
    flashSaved.t = setTimeout(() => (el.style.opacity = 0), bad ? 6000 : 1800);
}

async function saveClient(c, patch) {
    patch.updated_at = new Date().toISOString();
    const { error } = await sbClient.from("leads").update(patch).eq("id", c.id);
    if (error) {
        const msg = error.message || "";
        flashSaved(/contract_|bank_|vat_number|director/.test(msg) ? "Потрібно запустити clients_docs.sql у Supabase"
            : /full_name|legal_address|docs_address|contacts|address/.test(msg) ? "Потрібно запустити clients.sql у Supabase"
            : "Не збережено: " + msg, true);
        return false;
    }
    Object.assign(c, patch);
    flashSaved();
    refreshHead(c);
    return true;
}

function refreshHead(c) {
    if ($("cvTitle")) $("cvTitle").textContent = c.name || "Новий клієнт";
    if ($("cvFull")) $("cvFull").textContent = c.full_name || "";
    window.furaSetCrumbs?.([{ label: "Клієнти", href: "clients.html" }, c.name || "Новий клієнт"]);
}

// Поля з data-f — зберігаються, коли вийшли з поля / змінили значення
function bindFields(root, c) {
    root.querySelectorAll("[data-f]").forEach((el) => {
        el.addEventListener("change", async () => {
            const f = el.dataset.f;
            let v = el.type === "checkbox" ? el.checked : el.value.trim();
            if (v === "") v = null;
            if (f === "edrpou" && v) {
                v = digits(v);
                el.value = v;
                const other = clientsCache.find((x) => x.id !== c.id && digits(x.edrpou) === v) ||
                    (await sbClient.from("leads").select("id, name").eq("edrpou", v).neq("id", c.id).limit(1)).data?.[0];
                if (other && confirm(`Клієнт / лід з кодом ${v} уже є: «${other.name}».\nВідкрити його замість цього?`)) {
                    if (!c.name || c.name === "Новий клієнт") await sbClient.from("leads").delete().eq("id", c.id);
                    await loadClients();
                    openClientView(other.id);
                    return;
                }
            }
            if (f === "bank_iban" && v) {
                v = cleanIban(v);
                el.value = ibanPretty(v);
                el.classList.toggle("client-bad", !ibanValid(v));
                const mfo = mfoFromIban(v);
                const patch = { bank_iban: v };
                if (mfo && !c.bank_mfo) {
                    patch.bank_mfo = mfo;
                    const m = root.querySelector('[data-f="bank_mfo"]');
                    if (m) m.value = mfo;
                }
                if (!ibanValid(v)) flashSaved("IBAN виглядає неправильним — перевірте цифри", true);
                if (await saveClient(c, patch) && ibanValid(v)) flashSaved();
                return;
            }
            if (["vat_number", "bank_mfo"].includes(f) && v) v = digits(v);
            if (f === "name" && !v) {
                el.value = c.name || "";
                return flashSaved("Назва не може бути порожньою", true);
            }
            const patch = { [f]: v };
            if (f === "legal_address" && c.docs_same) patch.docs_address = v;
            await saveClient(c, patch);
            if (f === "legal_address" && c.docs_same && root.querySelector('[data-f="docs_address"]')) root.querySelector('[data-f="docs_address"]').value = v || "";
        });
    });
}

async function openClientView(id, tab, fromHistory = false) {
    const c = clientsCache.find((x) => String(x.id) === String(id));
    if (!c) return;
    currentClientId = c.id;
    if (tab) clientTab = tab;
    c.docs_same = !!(c.docs_address && c.legal_address && c.docs_address.trim() === c.legal_address.trim());
    renderClientView(c);
    listView.hidden = true;
    detailView.hidden = false;
    if (!fromHistory) {
        if (new URLSearchParams(location.search).get("open") === String(c.id)) history.replaceState(null, "", `?open=${c.id}`);
        else history.pushState(null, "", `?open=${c.id}`);
    }
    refreshHead(c);
}

async function closeClientView(fromHistory = false) {
    // Створили «Новий клієнт» і нічого не заповнили — прибираємо порожній запис
    const c = clientsCache.find((x) => String(x.id) === String(currentClientId));
    if (c && c.name === "Новий клієнт" && !c.edrpou && !c.phone && !c.email && !(dealsByLead.get(String(c.id)) || []).length) {
        await sbClient.from("leads").delete().eq("id", c.id);
        clientsCache = clientsCache.filter((x) => x !== c);
    }
    currentClientId = null;
    detailView.hidden = true;
    detailView.innerHTML = "";
    listView.hidden = false;
    if (fromHistory !== true && location.search) history.pushState(null, "", location.pathname);
    window.furaSetCrumbs?.(["Клієнти"]);
    renderClients();
}

function kpisHtml(c) {
    const deals = dealsByLead.get(String(c.id)) || [];
    const profit = deals.reduce((s, d) => s + (dealProfit(d) || 0), 0);
    const last = deals[0];
    const expired = c.contract_until && String(c.contract_until) < new Date().toISOString().slice(0, 10);
    return `
        <div class="dv-kpi"><div class="dv-label">Угод</div><div class="dv-kpi-v">${deals.length}</div></div>
        <div class="dv-kpi"><div class="dv-label">Остання угода</div><div class="dv-kpi-v">${last ? `№ ${e(last.number)}` : "—"}</div>${last ? `<div class="client-sub">${fmtDate(last.load_date_plan || last.created_at)}</div>` : ""}</div>
        <div class="dv-kpi"><div class="dv-label">Договір</div><div class="dv-kpi-v ${expired ? "client-neg" : ""}">${c.contract_no ? `№ ${e(c.contract_no)}` : "немає"}</div>
            <div class="client-sub">${c.contract_until ? `${expired ? "закінчився" : "діє до"} ${fmtDate(c.contract_until)}` : c.contract_date ? `від ${fmtDate(c.contract_date)}` : ""}</div></div>`;
}

function renderClientView(c) {
    const deals = dealsByLead.get(String(c.id)) || [];
    detailView.innerHTML = `
        <div class="dv-head">
            <h1 class="dv-num" id="cvTitle">${e(c.name || "Новий клієнт")}</h1>
            ${c.edrpou ? `<code class="client-code client-code-lg">${e(c.edrpou)}</code>` : ""}
            <span class="dv-route" id="cvFull">${e(c.full_name || "")}</span>
            <div class="dv-actions">
                <span class="dv-saved" id="cvSaved"></span>
                <a class="btn btn-secondary" href="deals.html?new=1&lead=${encodeURIComponent(c.id)}"><i class="bx bx-plus"></i> Нова угода</a>
                <button type="button" class="btn btn-primary" data-cv="close"><i class="bx bx-check"></i> Готово</button>
            </div>
        </div>

        <div class="dv-layout">
            <aside class="dv-side">
                <div class="dv-sec-title">Клієнт</div>
                ${fld("Код (ЄДРПОУ / ІПН)", "edrpou", c, "12345678", "text", 'inputmode="numeric"')}
                ${fld("Коротка назва <i class='req'>*</i>", "name", c, "ТОВ «…»")}
                <div class="dv-field"><div class="dv-label">Повне найменування</div>
                    <textarea class="dv-in dv-area" data-f="full_name" rows="2" placeholder="ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ «…»">${e(c.full_name || "")}</textarea></div>
                <div class="dv-field"><div class="dv-label">Етап</div>
                    <select class="dv-in" data-f="status">${opt(LEAD_STATUSES, c.status || STATUS_WORK)}</select></div>
                <div class="dv-sec-title dv-sec-gap">Менеджер</div>
                <div class="dv-field"><div class="dv-label">Чий клієнт</div>
                    <div class="dv-person"><span class="dv-avatar" id="cvSalesAv">${e(initials(c.sales) || "?")}</span>
                    <select class="dv-in" id="cvSales">${salesOptions(c.sales_id, c.sales)}</select></div></div>
                <div class="dv-sec-title dv-sec-gap">Де знаходиться</div>
                <div class="dv-field"><div class="dv-label">Країна</div>
                    <select class="dv-in" data-f="country">${opt(COUNTRIES, c.country, "Країна…")}</select></div>
                ${fld("Місто", "city", c, "Луцьк")}
            </aside>

            <div class="dv-main">
                <div class="dv-kpis" id="cvKpis">${kpisHtml(c)}</div>
                <div class="dv-card">
                    <div class="dv-tabs">
                        ${CLIENT_TABS.map((t) => `<button type="button" class="dv-tab ${t.key === clientTab ? "active" : ""}" data-tab="${t.key}">${t.label}${t.key === "deals" && deals.length ? ` <span class="dv-tab-count">${deals.length}</span>` : ""}${t.key === "contract" && (c.contract_files || []).length ? ` <span class="dv-tab-count">${c.contract_files.length}</span>` : ""}</button>`).join("")}
                    </div>
                    <div class="dv-tab-body" id="cvTabBody"></div>
                </div>
            </div>
        </div>`;

    detailView.querySelector("[data-cv=close]").addEventListener("click", closeClientView);
    bindFields(detailView.querySelector(".dv-side"), c);
    $("cvSales").addEventListener("change", async () => {
        const id = $("cvSales").value || null;
        const name = id ? staffCache.find((s) => String(s.id) === id)?.full_name || null : null;
        if (await saveClient(c, { sales_id: id, sales: name })) $("cvSalesAv").textContent = initials(name) || "?";
    });
    detailView.querySelectorAll("[data-tab]").forEach((b) =>
        b.addEventListener("click", () => {
            clientTab = b.dataset.tab;
            detailView.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
            renderClientTab(c);
        }),
    );
    renderClientTab(c);
}

function renderClientTab(c) {
    const box = $("cvTabBody");
    if (clientTab === "req") {
        box.innerHTML = `
            <div class="dv-block-title">Адреси</div>
            <div class="dv-grid cv-grid-2">
                ${fld("Фактична адреса (склад / офіс)", "address", c, "Місто, вулиця, будинок")}
                ${fld("Юридична адреса", "legal_address", c, "Як у виписці з ЄДР")}
            </div>
            <div class="dv-field cv-docs">
                <div class="dv-label">Адреса для відправки оригіналів документів
                    <label class="cv-same"><input type="checkbox" id="cvDocsSame" ${c.docs_same ? "checked" : ""} /> як юридична</label></div>
                <input class="dv-in" data-f="docs_address" value="${e(c.docs_address || "")}" placeholder="Нова пошта №…, місто, отримувач, телефон" ${c.docs_same ? "disabled" : ""} />
            </div>

            <div class="dv-block-title">Банківські реквізити — з якого рахунку платять</div>
            <div class="dv-grid cv-grid-2">
                ${fld("Розрахунковий рахунок (IBAN)", "bank_iban", { ...c, bank_iban: c.bank_iban ? ibanPretty(c.bank_iban) : "" }, "UA21 3223 1300 0002 6007 2335 6600 1", "text", 'autocomplete="off" spellcheck="false"')}
                ${fld("Банк", "bank_name", c, "АТ КБ «ПриватБанк»")}
            </div>
            <div class="dv-grid">
                ${fld("МФО <small>(з IBAN)</small>", "bank_mfo", c, "305299", "text", 'inputmode="numeric"')}
                ${fld("ІПН платника ПДВ", "vat_number", c, "якщо платник ПДВ", "text", 'inputmode="numeric"')}
                <div class="dv-field cv-span-2"><div class="dv-label">Керівник / підписант</div>
                    <input class="dv-in" data-f="director" value="${e(c.director || "")}" placeholder="Директор Іваненко І.І., діє на підставі Статуту" /></div>
            </div>
            ${c.bank_iban ? `<button type="button" class="pack-add cv-copy" id="cvCopyReq"><i class="bx bx-copy"></i> Скопіювати реквізити</button>` : ""}`;
        bindFields(box, c);
        const iban = box.querySelector('[data-f="bank_iban"]');
        if (c.bank_iban && !ibanValid(c.bank_iban)) iban.classList.add("client-bad");
        iban.addEventListener("input", () => {
            const mfo = mfoFromIban(iban.value);
            if (mfo && !box.querySelector('[data-f="bank_mfo"]').value) box.querySelector('[data-f="bank_mfo"]').value = mfo;
        });
        $("cvDocsSame").addEventListener("change", async () => {
            const same = $("cvDocsSame").checked;
            c.docs_same = same;
            const input = box.querySelector('[data-f="docs_address"]');
            input.disabled = same;
            if (same) {
                input.value = c.legal_address || "";
                await saveClient(c, { docs_address: c.legal_address || null });
            }
        });
        $("cvCopyReq")?.addEventListener("click", () => {
            const text = [c.full_name || c.name, c.edrpou && `Код ЄДРПОУ: ${c.edrpou}`, c.vat_number && `ІПН: ${c.vat_number}`,
                c.legal_address && `Юр. адреса: ${c.legal_address}`, c.bank_iban && `IBAN: ${cleanIban(c.bank_iban)}`,
                c.bank_name && `Банк: ${c.bank_name}`, (c.bank_mfo || mfoFromIban(c.bank_iban)) && `МФО: ${c.bank_mfo || mfoFromIban(c.bank_iban)}`,
                c.director].filter(Boolean).join("\n");
            navigator.clipboard?.writeText(text);
            flashSaved("Реквізити скопійовано");
        });
        return;
    }

    if (clientTab === "contacts") {
        const extra = Array.isArray(c.contacts) ? c.contacts : [];
        box.innerHTML = `
            <div class="dv-block-title">Основний контакт</div>
            <div class="dv-grid">
                ${fld("Контактна особа", "contact_person", c, "Ім'я, посада")}
                <div class="dv-field"><div class="dv-label">Телефон</div>
                    <div class="dv-phone"><input class="dv-in" data-f="phone" value="${e(c.phone || "")}" placeholder="380…" />
                    ${digits(c.phone).length >= 9 ? `<a class="dv-viber" href="viber://chat?number=%2B${digits(c.phone)}" title="Viber"><i class="bx bxs-message-rounded-dots"></i></a>` : ""}</div></div>
                <div class="dv-field cv-span-2"><div class="dv-label">Електронна пошта</div>
                    <input class="dv-in" type="email" data-f="email" value="${e(c.email || "")}" placeholder="name@company.com" /></div>
            </div>
            <div class="dv-block-title">Інші контакти <small>(бухгалтерія, логіст, директор, склад…)</small></div>
            <div class="cv-contacts" id="cvContacts">
                ${extra.map((x, i) => contactRow(x, i)).join("")}
            </div>
            <button type="button" class="pack-add" id="cvAddContact"><i class="bx bx-plus"></i> Додати контакт</button>`;
        bindFields(box, c);
        const saveContacts = async () => {
            const list = [...box.querySelectorAll(".cv-contact")]
                .map((r) => ({
                    position: r.querySelector('[data-c="position"]').value.trim() || null,
                    name: r.querySelector('[data-c="name"]').value.trim() || null,
                    phone: r.querySelector('[data-c="phone"]').value.trim() || null,
                    email: r.querySelector('[data-c="email"]').value.trim() || null,
                }))
                .filter((x) => x.position || x.name || x.phone || x.email);
            await saveClient(c, { contacts: list });
        };
        $("cvContacts").addEventListener("change", saveContacts);
        $("cvContacts").addEventListener("click", async (ev) => {
            if (!ev.target.closest(".cv-del")) return;
            ev.target.closest(".cv-contact").remove();
            await saveContacts();
        });
        $("cvAddContact").addEventListener("click", () => {
            $("cvContacts").insertAdjacentHTML("beforeend", contactRow({}, $("cvContacts").children.length));
            $("cvContacts").lastElementChild.querySelector("input").focus();
        });
        return;
    }

    if (clientTab === "contract") {
        box.innerHTML = `
            <div class="dv-block-title">Договір з клієнтом</div>
            <div class="dv-grid">
                ${fld("№ договору", "contract_no", c, "наприклад: 15/10-2026")}
                ${fld("Дата договору", "contract_date", c, "", "date")}
                ${fld("Діє до", "contract_until", c, "", "date")}
            </div>
            <div class="dv-block-title">Підписаний договір (скан / PDF)</div>
            <div class="client-files" id="clientFiles">${filesHtml(c)}</div>
            <div class="client-files-actions cv-drop" id="cvDrop">
                <label class="btn btn-secondary btn-sm client-upload"><i class="bx bx-upload"></i> Завантажити файл
                    <input type="file" id="clientFileInput" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" multiple hidden />
                </label>
                <span class="client-sub">або перетягніть файл сюди · PDF, фото, Word до 20 МБ</span>
            </div>`;
        bindFields(box, c);
        box.querySelectorAll('[data-f^="contract_"]').forEach((el) => el.addEventListener("change", () => setTimeout(() => ($("cvKpis").innerHTML = kpisHtml(c)), 300)));
        bindFiles(c);
        $("clientFileInput").addEventListener("change", (ev) => uploadClientFiles(c, [...ev.target.files]));
        const drop = $("cvDrop");
        ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
        ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
        drop.addEventListener("drop", (ev) => {
            ev.preventDefault();
            uploadClientFiles(c, [...(ev.dataTransfer?.files || [])]);
        });
        return;
    }

    if (clientTab === "cargo") {
        const set = new Set(c.trade_types || []);
        box.innerHTML = `
            <div class="dv-block-title">Напрямок</div>
            <div class="cv-trade" id="cvTrade">
                ${TRADE_TYPES.map((t) => `<label class="loading-chip"><input type="checkbox" value="${e(t)}"${set.has(t) ? " checked" : ""} /> ${e(t)}</label>`).join("")}
            </div>
            <div class="dv-grid cv-grid-2">
                ${fld("Звідки → куди", "directions", c, "наприклад: Польща → Україна, Україна → Молдова")}
                ${fld("Що возить або виробляє", "cargo", c, "наприклад: молочка, РЕФ, 10–15 авто на місяць")}
            </div>
            <div class="dv-block-title">Нотатки</div>
            <textarea class="dv-in dv-area" data-f="notes" rows="5" placeholder="Що важливо знати: умови оплати, особливості завантаження, контакти на складі…">${e(c.notes || "")}</textarea>`;
        bindFields(box, c);
        $("cvTrade").addEventListener("change", () =>
            saveClient(c, { trade_types: [...$("cvTrade").querySelectorAll("input:checked")].map((x) => x.value) }),
        );
        return;
    }

    // Угоди
    const deals = dealsByLead.get(String(c.id)) || [];
    box.innerHTML = deals.length
        ? `<table class="client-deals-table">
            <thead><tr><th>№</th><th>Дата</th><th>Маршрут</th><th>Перевізник / авто</th><th>Статус</th><th>Оплата</th></tr></thead>
            <tbody>${deals
                .map((d) => {
                    const [st, cls] = dealStateLabel(d);
                    const p = dealProfit(d);
                    const from = [d.load_address, d.load_country].filter(Boolean).join(", ");
                    const to = [d.unload_address, d.unload_country].filter(Boolean).join(", ");
                    return `<tr data-deal="${e(d.id)}" title="Відкрити угоду">
                        <td><b>№ ${e(d.number)}</b></td>
                        <td>${fmtDate(d.load_date_plan || d.created_at)}</td>
                        <td>${e(from || "—")} → ${e(to || "—")}</td>
                        <td>${e(d.carrier_name || "—")}${d.truck_plate ? `<div class="client-sub">${e(d.truck_plate)}</div>` : ""}</td>
                        <td><span class="deal-state ${cls}">${st}</span></td>
                        <td>${d.paid_by_client ? `<span class="client-paid">оплачено</span>` : `<span class="client-sub">очікуємо</span>`}</td>
                    </tr>`;
                })
                .join("")}</tbody>
        </table>`
        : `<div class="client-empty">Угод з цим клієнтом ще немає. Натисніть «Нова угода» вгорі — клієнт і договір підставляться самі.</div>`;
    box.querySelectorAll("tr[data-deal]").forEach((tr) =>
        tr.addEventListener("click", () => (location.href = `deals.html?open=${encodeURIComponent(tr.dataset.deal)}`)),
    );
}

function contactRow(x, i) {
    const d = digits(x.phone);
    return `<div class="cv-contact">
        <input class="dv-in" data-c="position" value="${e(x.position || "")}" placeholder="Хто (бухгалтерія…)" />
        <input class="dv-in" data-c="name" value="${e(x.name || "")}" placeholder="Ім'я" />
        <div class="dv-phone"><input class="dv-in" data-c="phone" value="${e(x.phone || "")}" placeholder="Телефон" />
            ${d.length >= 9 ? `<a class="dv-viber" href="viber://chat?number=%2B${d}" title="Viber"><i class="bx bxs-message-rounded-dots"></i></a>` : ""}</div>
        <input class="dv-in" type="email" data-c="email" value="${e(x.email || "")}" placeholder="Пошта" />
        <button type="button" class="btn-icon cv-del" title="Прибрати"><i class="bx bx-trash"></i></button>
    </div>`;
}

// Новий клієнт — одразу створюємо запис і відкриваємо картку (як «Нова угода»)
$("newClientBtn").addEventListener("click", async () => {
    const payload = {
        name: "Новий клієнт",
        status: STATUS_WORK,
        source: "Клієнт (вручну)",
        country: "УКРАЇНА",
        created_by: currentStaff?.full_name || null,
        history: [{ at: new Date().toISOString(), author: currentStaff?.full_name || "", text: `Клієнта додано (етап «${STATUS_WORK}»)`, auto: true }],
    };
    if (currentStaff && hasRole(currentStaff, ["sales", "head"])) Object.assign(payload, { sales_id: currentStaff.id, sales: currentStaff.full_name });
    const { data, error } = await sbClient.from("leads").insert([payload]).select().single();
    if (error) return alert("Не вдалося створити клієнта: " + error.message);
    await loadClients();
    clientTab = "req";
    await openClientView(data.id);
    const code = detailView.querySelector('[data-f="edrpou"]');
    code?.focus();
});


/* ---------------- Старт ---------------- */

document.addEventListener("DOMContentLoaded", async () => {
    const { data: { session } } = await sbClient.auth.getSession();
    if (!session) {
        window.location.href = "login.html";
        return;
    }
    document.body.style.visibility = "visible";
    sbClient.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") window.location.href = "login.html";
    });
    await loadStaff(session);
    await loadClients();

    const openId = new URLSearchParams(location.search).get("open");
    if (openId) openClientView(openId);
});

window.addEventListener("popstate", () => {
    const id = new URLSearchParams(location.search).get("open");
    if (id) {
        if (String(currentClientId) !== id) openClientView(id, undefined, true);
    } else if (currentClientId) closeClientView(true);
});
