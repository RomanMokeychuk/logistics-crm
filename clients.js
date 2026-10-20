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
    $("c_sales").innerHTML =
        `<option value="">— не вибрано —</option>` +
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
                    ${deals.length && profit ? `<div class="client-profit">${money(profit)}</div>` : ""}
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
        openClientForm(clientsCache.find((c) => String(c.id) === edit.dataset.edit));
        return;
    }
    if (ev.target.closest("a")) return; // телефон / Viber / пошта
    const tr = ev.target.closest("tr[data-id]");
    if (tr) openClientCard(tr.dataset.id);
});
["clientsSearch"].forEach((id) => $(id).addEventListener("input", renderClients));
["clientsTradeFilter", "clientsSalesFilter"].forEach((id) => $(id).addEventListener("change", renderClients));

/* ---------------- Картка ---------------- */

function row(label, valueHtml) {
    return `<div class="card-row"><div class="card-row-label">${label}</div><div class="card-row-value">${valueHtml || "—"}</div></div>`;
}

function openClientCard(id) {
    const c = clientsCache.find((x) => String(x.id) === String(id));
    if (!c) return;
    currentClientId = c.id;
    const deals = dealsByLead.get(String(c.id)) || [];
    const extra = Array.isArray(c.contacts) ? c.contacts : [];
    const totalProfit = deals.reduce((s, d) => s + (dealProfit(d) || 0), 0);
    const docsSame = c.docs_address && c.legal_address && c.docs_address.trim() === c.legal_address.trim();

    $("clientCardTitle").textContent = c.name || "Картка клієнта";
    $("clientCardBody").innerHTML = `
        <div class="client-hero">
            <div class="client-hero-icon"><i class="bx bx-buildings"></i></div>
            <div>
                <div class="client-hero-name">${e(c.full_name || c.name || "—")}</div>
                <div class="client-hero-sub">
                    ${c.edrpou ? `Код <code>${e(c.edrpou)}</code>` : "Код не вказано"}
                    ${c.sales ? ` · Менеджер: <b>${e(c.sales)}</b>` : ""}
                    ${c.status && c.status !== STATUS_WORK ? ` · етап «${e(c.status)}»` : ""}
                </div>
                <div class="client-hero-badges">${tradeBadges(c.trade_types)}</div>
            </div>
        </div>

        <div class="card-columns">
            <div class="card-col">
                <div class="card-section">
                    <div class="card-section-title">Реквізити й адреси</div>
                    ${row("Код:", c.edrpou ? `<code>${e(c.edrpou)}</code>` : "")}
                    ${row("Повне найменування:", e(c.full_name))}
                    ${row("Фактична адреса:", e(c.address || [c.city, c.country].filter(Boolean).join(", ")))}
                    ${row("Юридична адреса:", e(c.legal_address))}
                    ${row("Оригінали документів:", docsSame ? "на юридичну адресу" : e(c.docs_address))}
                </div>
                <div class="card-section">
                    <div class="card-section-title">Банківські реквізити</div>
                    ${row("Р/р (IBAN):", c.bank_iban ? `<code class="client-iban">${e(ibanPretty(c.bank_iban))}</code> <button type="button" class="btn-icon client-copy" data-copy="${e(cleanIban(c.bank_iban))}" title="Скопіювати"><i class="bx bx-copy"></i></button>` : "")}
                    ${row("Банк:", e(c.bank_name))}
                    ${row("МФО:", e(c.bank_mfo || mfoFromIban(c.bank_iban)))}
                    ${row("ІПН платника ПДВ:", e(c.vat_number))}
                    ${row("Керівник / підписант:", e(c.director))}
                </div>
                <div class="card-section">
                    <div class="card-section-title">Що і куди возить</div>
                    ${row("Напрямок:", tradeBadges(c.trade_types))}
                    ${row("Звідки → куди:", e(c.directions))}
                    ${row("Вантаж / виробляє:", e(c.cargo))}
                </div>
            </div>
            <div class="card-col">
                <div class="card-section">
                    <div class="card-section-title">Контакти</div>
                    ${row("Контактна особа:", e(c.contact_person))}
                    ${row("Телефон:", phoneHtml(c.phone))}
                    ${row("Пошта:", emailHtml(c.email))}
                    ${extra
                        .map((x) => row(`${e(x.position || "Контакт")}:`, `${x.name ? `<b>${e(x.name)}</b>` : ""}${phoneHtml(x.phone)}${x.email ? `<div>${emailHtml(x.email)}</div>` : ""}`))
                        .join("")}
                </div>
                <div class="card-section">
                    <div class="card-section-title">Договір</div>
                    ${row("№ договору:", c.contract_no ? `<b>${e(c.contract_no)}</b>` : "")}
                    ${row("Дата:", fmtDate(c.contract_date))}
                    ${row("Діє до:", c.contract_until ? `${fmtDate(c.contract_until)}${String(c.contract_until) < new Date().toISOString().slice(0, 10) ? ` <span class="client-expired">закінчився</span>` : ""}` : "")}
                    <div class="client-files" id="clientFiles">${filesHtml(c)}</div>
                    <div class="client-files-actions">
                        <label class="btn btn-secondary btn-sm client-upload"><i class="bx bx-upload"></i> Завантажити файл
                            <input type="file" id="clientFileInput" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" multiple hidden />
                        </label>
                        <span class="client-sub">PDF, фото або Word, до 20 МБ</span>
                    </div>
                </div>
                <div class="card-section">
                    <div class="card-section-title">Менеджер і нотатки</div>
                    ${row("Чий клієнт:", e(c.sales))}
                    ${row("Нотатки:", c.notes ? `<div style="white-space:pre-wrap">${e(c.notes)}</div>` : "")}
                </div>
            </div>
        </div>

        <div class="card-section client-deals">
            <div class="card-section-title client-deals-title">
                <span><i class="bx bx-file"></i> Угоди з клієнтом ${deals.length ? `(${deals.length})` : ""}${deals.length && totalProfit ? ` · прибуток ${money(totalProfit)}` : ""}</span>
                <a class="btn btn-primary btn-sm" href="deals.html?new=1&lead=${encodeURIComponent(c.id)}"><i class="bx bx-plus"></i> Нова угода</a>
            </div>
            ${deals.length
                ? `<table class="client-deals-table">
                    <thead><tr><th>№</th><th>Дата</th><th>Маршрут</th><th>Перевізник / авто</th><th>Статус</th><th>Оплата</th><th>Прибуток</th></tr></thead>
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
                                <td class="${p !== null && p < 0 ? "client-neg" : ""}">${money(p)}</td>
                            </tr>`;
                        })
                        .join("")}</tbody>
                </table>`
                : `<div class="client-empty">Угод з цим клієнтом ще немає. Натисніть «Нова угода» — клієнт підставиться сам.</div>`}
        </div>`;

    bindFiles(c);
    $("clientFileInput").addEventListener("change", (ev) => uploadClientFiles(c, [...ev.target.files]));
    $("clientCardBody").querySelectorAll("[data-copy]").forEach((b) =>
        b.addEventListener("click", () => {
            navigator.clipboard?.writeText(b.dataset.copy);
            b.innerHTML = "<i class='bx bx-check'></i>";
            setTimeout(() => (b.innerHTML = "<i class='bx bx-copy'></i>"), 1200);
        }),
    );
    $("clientCardBody").querySelectorAll("tr[data-deal]").forEach((tr) =>
        tr.addEventListener("click", () => (location.href = `deals.html?open=${encodeURIComponent(tr.dataset.deal)}`)),
    );
    $("clientCardOverlay").classList.add("active");
}

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

function closeClientCard() {
    $("clientCardOverlay").classList.remove("active");
    currentClientId = null;
}
$("clientCardClose").addEventListener("click", closeClientCard);
$("clientCardOverlay").addEventListener("click", (ev) => {
    if (ev.target === $("clientCardOverlay")) closeClientCard();
});
$("clientEditBtn").addEventListener("click", () => {
    const c = clientsCache.find((x) => String(x.id) === String(currentClientId));
    closeClientCard();
    if (c) openClientForm(c);
});

/* ---------------- Форма ---------------- */

function contactRowHtml(x = {}) {
    return `<div class="client-contact-row">
        <input type="text" class="cc-position" placeholder="Хто (бухгалтерія, логіст…)" value="${e(x.position || "")}" />
        <input type="text" class="cc-name" placeholder="Ім'я" value="${e(x.name || "")}" />
        <input type="tel" class="cc-phone" placeholder="Телефон" value="${e(x.phone || "")}" />
        <input type="email" class="cc-email" placeholder="Пошта" value="${e(x.email || "")}" />
        <button type="button" class="pack-del" title="Прибрати">×</button>
    </div>`;
}

function addContactRow(x) {
    $("c_contacts").insertAdjacentHTML("beforeend", contactRowHtml(x));
}
$("c_add_contact").addEventListener("click", () => addContactRow());
$("c_contacts").addEventListener("click", (ev) => {
    if (ev.target.closest(".pack-del")) ev.target.closest(".client-contact-row").remove();
});

function readContacts() {
    return [...document.querySelectorAll("#c_contacts .client-contact-row")]
        .map((r) => ({
            position: r.querySelector(".cc-position").value.trim() || null,
            name: r.querySelector(".cc-name").value.trim() || null,
            phone: r.querySelector(".cc-phone").value.trim() || null,
            email: r.querySelector(".cc-email").value.trim() || null,
        }))
        .filter((x) => x.name || x.phone || x.email);
}

function renderTradePicker(selected) {
    const set = new Set(selected || []);
    $("c_trade_picker").innerHTML = TRADE_TYPES.map(
        (t) => `<label class="loading-chip"><input type="checkbox" name="c_trade" value="${e(t)}"${set.has(t) ? " checked" : ""} /> ${e(t)}</label>`,
    ).join("");
}

function openClientForm(c = null) {
    $("clientForm").reset();
    $("clientFormTitle").textContent = c ? `Клієнт: ${c.name}` : "Новий клієнт";
    $("c_id").value = c ? c.id : "";
    const set = (id, v) => ($(id).value = v ?? "");
    set("c_edrpou", c?.edrpou);
    set("c_name", c?.name);
    set("c_full_name", c?.full_name);
    set("c_address", c?.address);
    set("c_legal_address", c?.legal_address);
    set("c_docs_address", c?.docs_address);
    $("c_docs_same").checked = !!(c?.docs_address && c?.legal_address && c.docs_address.trim() === c.legal_address.trim());
    syncDocsSame();
    set("c_director", c?.director);
    set("c_vat_number", c?.vat_number);
    set("c_contract_no", c?.contract_no);
    set("c_contract_date", c?.contract_date ? String(c.contract_date).slice(0, 10) : "");
    set("c_contract_until", c?.contract_until ? String(c.contract_until).slice(0, 10) : "");
    set("c_bank_iban", c?.bank_iban ? ibanPretty(c.bank_iban) : "");
    set("c_bank_name", c?.bank_name);
    set("c_bank_mfo", c?.bank_mfo);
    set("c_contact_person", c?.contact_person);
    set("c_phone", c?.phone);
    set("c_email", c?.email);
    $("c_contacts").innerHTML = "";
    (Array.isArray(c?.contacts) ? c.contacts : []).forEach(addContactRow);
    renderTradePicker(c?.trade_types);
    set("c_directions", c?.directions);
    set("c_cargo", c?.cargo);
    set("c_sales", c?.sales_id || (!c && currentStaff && hasRole(currentStaff, ["sales", "head"]) ? currentStaff.id : ""));
    set("c_country", c?.country || "УКРАЇНА");
    set("c_city", c?.city);
    set("c_notes", c?.notes);
    $("clientFormOverlay").classList.add("active");
    setTimeout(() => $(c ? "c_full_name" : "c_edrpou").focus(), 50);
}

function syncDocsSame() {
    const same = $("c_docs_same").checked;
    $("c_docs_address").disabled = same;
    if (same) $("c_docs_address").value = $("c_legal_address").value;
}
$("c_docs_same").addEventListener("change", syncDocsSame);
$("c_bank_iban").addEventListener("input", () => {
    const mfo = mfoFromIban($("c_bank_iban").value);
    if (mfo) $("c_bank_mfo").value = mfo;
    $("c_bank_iban").classList.toggle("client-bad", !!cleanIban($("c_bank_iban").value) && cleanIban($("c_bank_iban").value).length >= 29 && !ibanValid($("c_bank_iban").value));
});
$("c_bank_iban").addEventListener("blur", () => {
    if ($("c_bank_iban").value) $("c_bank_iban").value = ibanPretty($("c_bank_iban").value);
});
$("c_legal_address").addEventListener("input", () => {
    if ($("c_docs_same").checked) $("c_docs_address").value = $("c_legal_address").value;
});

function closeClientForm() {
    $("clientFormOverlay").classList.remove("active");
}
$("clientFormClose").addEventListener("click", closeClientForm);
$("clientFormCancel").addEventListener("click", closeClientForm);
$("clientFormOverlay").addEventListener("click", (ev) => {
    if (ev.target === $("clientFormOverlay")) closeClientForm();
});
$("newClientBtn").addEventListener("click", () => openClientForm());

$("clientForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = (id) => $(id).value.trim() || null;
    const id = $("c_id").value;
    const existing = id ? clientsCache.find((c) => String(c.id) === String(id)) : null;
    const salesId = $("c_sales").value || null;
    const salesName = salesId ? staffCache.find((s) => String(s.id) === salesId)?.full_name || null : null;
    const edrpou = digits($("c_edrpou").value) || null;

    const payload = {
        name: v("c_name"),
        edrpou,
        full_name: v("c_full_name"),
        address: v("c_address"),
        legal_address: v("c_legal_address"),
        docs_address: $("c_docs_same").checked ? v("c_legal_address") : v("c_docs_address"),
        director: v("c_director"),
        vat_number: digits($("c_vat_number").value) || null,
        contract_no: v("c_contract_no"),
        contract_date: v("c_contract_date"),
        contract_until: v("c_contract_until"),
        bank_iban: cleanIban($("c_bank_iban").value) || null,
        bank_name: v("c_bank_name"),
        bank_mfo: digits($("c_bank_mfo").value) || mfoFromIban($("c_bank_iban").value) || null,
        contact_person: v("c_contact_person"),
        phone: v("c_phone"),
        email: v("c_email"),
        contacts: readContacts(),
        trade_types: [...document.querySelectorAll("input[name='c_trade']:checked")].map((x) => x.value),
        directions: v("c_directions"),
        cargo: v("c_cargo"),
        sales_id: salesId,
        sales: salesName,
        country: v("c_country"),
        city: v("c_city"),
        notes: v("c_notes"),
        updated_at: new Date().toISOString(),
    };
    if (!payload.name) return alert("Вкажіть назву клієнта.");
    if (payload.bank_iban && !ibanValid(payload.bank_iban)) {
        if (!confirm("IBAN виглядає неправильним (помилка в цифрах).\nВсе одно зберегти?")) return;
    }

    const btn = ev.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
        let res;
        if (existing) {
            res = await sbClient.from("leads").update(payload).eq("id", existing.id).select().single();
        } else {
            // Такий уже є в «Лідах» (той самий код)? — не дублюємо, робимо його клієнтом
            let dup = null;
            if (edrpou) {
                const { data } = await sbClient.from("leads").select("id, name, history").eq("edrpou", edrpou).limit(1);
                dup = data?.[0] || null;
            }
            const history = Array.isArray(dup?.history) ? [...dup.history] : [];
            history.push({ at: new Date().toISOString(), author: currentStaff?.full_name || "", text: dup ? `Етап → «${STATUS_WORK}» (розділ «Клієнти»)` : `Клієнта додано (етап «${STATUS_WORK}»)`, auto: true });
            const full = { ...payload, status: STATUS_WORK, history };
            if (dup) {
                if (!confirm(`«${dup.name}» з кодом ${edrpou} уже є в «Лідах».\nОновити його даними з форми і зробити клієнтом?`)) return;
                res = await sbClient.from("leads").update(full).eq("id", dup.id).select().single();
            } else {
                res = await sbClient.from("leads").insert([{ ...full, created_by: currentStaff?.full_name || null, source: "Клієнт (вручну)" }]).select().single();
            }
        }
        if (res.error) {
            const msg = res.error.message || "";
            alert(/contract_|bank_|vat_number|director/.test(msg)
                ? "Потрібно один раз запустити clients_docs.sql у Supabase (договір і реквізити)."
                : /full_name|legal_address|docs_address|contacts|address/.test(msg)
                ? "Потрібно один раз запустити clients.sql у Supabase (нові поля картки клієнта)."
                : "Не вдалося зберегти: " + msg);
            return;
        }
        closeClientForm();
        await loadClients();
        if (res.data?.id) openClientCard(res.data.id);
    } finally {
        btn.disabled = false;
    }
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
    $("c_country").innerHTML = `<option value="">Країна...</option>` + COUNTRIES.map((c) => `<option value="${c}">${c}</option>`).join("");
    await loadStaff(session);
    await loadClients();

    const openId = new URLSearchParams(location.search).get("open");
    if (openId) {
        openClientCard(openId);
        history.replaceState(null, "", location.pathname);
    }
});
