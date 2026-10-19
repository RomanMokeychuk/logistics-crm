/* ================================================================= *
 * FURA — ФУРИК ДОПОМАГАЄ З ВІДПОВІДДЮ (картка запиту)                *
 * Логісту: які ставки перевізникам були на цьому маршруті, найкраща   *
 *          ставка, зібрана по запиту, шаблон нотатки до відповіді.    *
 * Sales:   готове повідомлення клієнту за відповіддю логіста —        *
 *          коротко / детально / терміново; копіювати, Viber, WhatsApp. *
 * Ціну клієнту ставить тільки Sales: Фурик лише підказує маржу.      *
 * Підключається на requests.html після requests.js.                   *
 * ================================================================= */

(function () {
    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) return;

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const num = (v) => Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")) || 0;
    const money = (v, cur) => `${Math.round(v).toLocaleString("uk-UA").replace(/ /g, " ")} ${cur || ""}`.trim();
    const fmtDate = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join(".") : "");
    const cap = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : "—");
    const median = (arr) => {
        const a = [...arr].sort((x, y) => x - y);
        if (!a.length) return 0;
        const m = Math.floor(a.length / 2);
        return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    };

    const roleOf = (list) => (typeof currentStaff !== "undefined" && currentStaff && typeof hasRole === "function" ? hasRole(currentStaff, list) : false);
    const answersOf = (r) => (typeof getAnswers === "function" ? getAnswers(r) : Array.isArray(r.answers) ? r.answers : []);

    let req = null;
    let stats = null;
    let tone = "short";

    /* ---------------- Ціни по маршруту з угод ---------------- */

    async function routeStats(r) {
        if (!r.load_country || !r.unload_country) return null;
        const since = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
        const { data, error } = await client
            .from("deals")
            .select("services, trailer_type, load_date, created_at")
            .ilike("load_country", r.load_country)
            .ilike("unload_country", r.unload_country)
            .or(`load_date.gte.${since},load_date.is.null`)
            .limit(300);
        if (error || !data?.length) return null;

        const want = String(r.transport_type || "").split(/[;,]/)[0].trim().toUpperCase();
        let rows = data;
        let byTrailer = false;
        if (want) {
            const same = data.filter((d) => String(d.trailer_type || "").toUpperCase().includes(want));
            if (same.length >= 3) {
                rows = same;
                byTrailer = true;
            }
        }

        const carrier = {}; // валюта → [ставки перевізнику]
        const clientP = {};
        const margin = {};
        for (const d of rows) {
            let inn = {}, out = {};
            for (const s of Array.isArray(d.services) ? d.services : []) {
                const q = num(s.qty) || 1;
                if (num(s.in_rate)) inn[s.in_cur || "EUR"] = (inn[s.in_cur || "EUR"] || 0) + q * num(s.in_rate);
                if (num(s.out_rate)) out[s.out_cur || "EUR"] = (out[s.out_cur || "EUR"] || 0) + q * num(s.out_rate);
            }
            for (const [c, v] of Object.entries(out)) (carrier[c] = carrier[c] || []).push(v);
            for (const [c, v] of Object.entries(inn)) (clientP[c] = clientP[c] || []).push(v);
            for (const c of Object.keys(out)) if (inn[c]) (margin[c] = margin[c] || []).push(inn[c] - out[c]);
        }
        const main = Object.keys(carrier).sort((a, b) => carrier[b].length - carrier[a].length)[0];
        if (!main) return null;
        const pack = (arr) => (arr?.length ? { min: Math.min(...arr), max: Math.max(...arr), med: median(arr), n: arr.length } : null);
        return { cur: main, carrier: pack(carrier[main]), client: pack(clientP[main]), margin: pack(margin[main]), trips: rows.length, byTrailer, trailer: want };
    }

    async function bestBid(r) {
        const { data, error } = await client
            .from("carrier_bids")
            .select("carrier_name, price, currency, load_date")
            .eq("request_id", r.id)
            .eq("status", "bid")
            .order("price", { ascending: true })
            .limit(1);
        return error ? null : data?.[0] || null;
    }

    /* ---------------- Тексти для клієнта ---------------- */

    function clientMessage(r, offer, price, cur, kind) {
        const route = `${cap(r.load_country)}${r.load_address ? ` (${r.load_address.split(",")[0]})` : ""} → ${cap(r.unload_country)}${r.unload_address ? ` (${r.unload_address.split(",")[0]})` : ""}`;
        const loadDate = fmtDate(r.desired_date) + (r.desired_date_to && r.desired_date_to !== r.desired_date ? `–${fmtDate(r.desired_date_to)}` : "");
        const truckDate = offer?.date_flexible ? "за погодженням" : fmtDate(offer?.date) + (offer?.date_to ? `–${fmtDate(offer.date_to)}` : "") || loadDate || "за погодженням";
        const p = price ? money(price, cur) : "[ЦІНА]";
        const lead = typeof leadById === "function" ? leadById(r.lead_id) || (typeof findLeadByName === "function" ? findLeadByName(r.client) : null) : null;
        const contact = lead?.contact_person ? `, ${lead.contact_person.split(" ")[0]}` : "";
        const me = typeof currentStaff !== "undefined" && currentStaff?.full_name ? currentStaff.full_name : "";
        const cargo = [r.cargo, r.transport_type, r.weight].filter(Boolean).join(" · ");
        const customs = [r.customs_export && `замитнення: ${r.customs_export}`, r.border_crossing && `кордон: ${r.border_crossing}`, r.customs_import && `розмитнення: ${r.customs_import}`].filter(Boolean).join(", ");

        if (kind === "detail") {
            const out = [`Добрий день${contact}!`, "Дякуємо за запит. Пропонуємо:", `• Маршрут: ${route}`];
            if (cargo) out.push(`• Вантаж: ${cargo}`);
            if (loadDate) out.push(`• Дата завантаження: ${loadDate}`);
            out.push(`• Подача авто: ${truckDate}`);
            if (customs) out.push(`• Митниця: ${customs}`);
            out.push(`• Вартість: ${p}`, "", "Ціна актуальна протягом 24 годин. Якщо все підходить — підтвердіть, і ми закріпимо авто за вами.", "", `З повагою${me ? `, ${me}` : ""}`, "Грандар");
            return out.join("\n");
        }
        if (kind === "urgent") {
            const until = new Date(Date.now() + 3 * 3600e3);
            const hh = `${String(until.getHours()).padStart(2, "0")}:${String(until.getMinutes()).padStart(2, "0")}`;
            return `Добрий день${contact}! Є вільне авто під ваш вантаж ${route}, подача ${truckDate}: ${p}.\nТакі авто швидко розбирають — просимо підтвердити сьогодні до ${hh}, щоб ми його закріпили за вами.`;
        }
        return `Добрий день${contact}! По вашому запиту ${route}${loadDate ? `, ${loadDate}` : ""}: ${p}${cargo ? ` (${cargo})` : ""}. Подача авто — ${truckDate}. Підтверджуємо?`;
    }

    /* ---------------- Розмітка ---------------- */

    function sectionHtml(r) {
        const showLogist = roleOf(["logist", "head", "admin"]) && ["Запит", "Відповідь"].includes(r.status);
        const showSales = roleOf(["sales", "head", "admin"]) && answersOf(r).some((a) => (a.offers || []).length);
        if (!showLogist && !showSales) return "";
        return `
        <div class="card-section fr" id="furikHelp">
            <div class="card-section-title fr-title">
                <span class="fr-face" aria-hidden="true">
                    <svg viewBox="0 0 40 30" width="34" height="26"><rect x="1" y="5" width="22" height="17" rx="3" fill="#13203f"/><path d="M24 9h8l5 7v6H24z" fill="#f57c00"/><circle cx="28" cy="13" r="1.8" fill="#fff"/><circle cx="33" cy="13" r="1.8" fill="#fff"/><circle cx="28.4" cy="13.3" r=".9" fill="#13203f"/><circle cx="33.4" cy="13.3" r=".9" fill="#13203f"/><path d="M28 18q2.5 2 5 0" stroke="#13203f" stroke-width="1.2" fill="none" stroke-linecap="round"/><circle cx="8" cy="24" r="3" fill="#13203f"/><circle cx="30" cy="24" r="3" fill="#13203f"/></svg>
                </span>
                <span>Фурик підкаже</span>
            </div>
            <div class="fr-body">
                ${showLogist ? `<div class="fr-block" data-fr="logist"><h4>Логісту: яку ціну давати</h4><div class="fr-prices">Рахую ціни по маршруту…</div>
                    <div class="fr-actions"><button type="button" class="fr-btn" data-fr-note>Вставити нотатку у мою відповідь</button></div></div>` : ""}
                ${showSales ? `<div class="fr-block" data-fr="sales"><h4>Sales: відповідь клієнту</h4><div class="fr-sales"></div></div>` : ""}
            </div>
        </div>`;
    }

    function pricesHtml(st, bid) {
        if (!st && !bid) return `<p class="fr-muted">По цьому маршруту ще немає угод за пів року — орієнтуйтеся на ставки перевізників.</p>`;
        const lines = [];
        if (st) {
            const label = `${cap(req.load_country)} → ${cap(req.unload_country)}${st.byTrailer ? `, ${st.trailer.toLowerCase()}` : ""}`;
            lines.push(`<p class="fr-muted">За пів року по маршруту <b>${esc(label)}</b> — ${st.trips} ${st.trips === 1 ? "рейс" : st.trips < 5 ? "рейси" : "рейсів"}:</p>`);
            const tiles = [];
            if (st.carrier) tiles.push(`<div class="fr-tile"><span>Перевізнику</span><b>${money(st.carrier.med, st.cur)}</b><small>${money(st.carrier.min, "")}–${money(st.carrier.max, st.cur)}</small></div>`);
            if (st.client) tiles.push(`<div class="fr-tile"><span>Клієнту</span><b>${money(st.client.med, st.cur)}</b><small>${money(st.client.min, "")}–${money(st.client.max, st.cur)}</small></div>`);
            if (st.margin) tiles.push(`<div class="fr-tile"><span>Маржа зазвичай</span><b>≈ ${money(st.margin.med, st.cur)}</b></div>`);
            lines.push(`<div class="fr-tiles">${tiles.join("")}</div>`);
        }
        if (bid) lines.push(`<p class="fr-best">Найкраща ставка по цьому запиту: <b>${money(bid.price, bid.currency)}</b> — ${esc(bid.carrier_name)}${bid.load_date ? `, подача ${fmtDate(bid.load_date)}` : ""}.</p>`);
        return lines.join("");
    }

    function salesHtml() {
        const offers = [];
        for (const a of answersOf(req)) (a.offers || []).forEach((o, i) => offers.push({ ...o, logist: a.logist, key: `${a.logist_id || a.logist}-${i}` }));
        const chosen = req.chosen_offer;
        const pickIdx = Math.max(0, chosen ? offers.findIndex((o) => num(o.price) === num(chosen.price) && o.currency === chosen.currency) : 0);
        return `
            <label class="fr-lbl">Варіант логіста
                <select data-fr-offer>${offers
                    .map((o, i) => `<option value="${i}" ${i === pickIdx ? "selected" : ""}>${esc(o.logist || "Логіст")}: ${o.price ? money(num(o.price), o.currency) : "без ціни"}${o.date ? ` · авто ${fmtDate(o.date)}` : o.date_flexible ? " · плаваюча дата" : ""}</option>`)
                    .join("")}</select>
            </label>
            <div class="fr-row">
                <label class="fr-lbl">Ціна для клієнта
                    <input type="number" min="0" step="10" data-fr-price placeholder="напр. 2600" />
                </label>
                <div class="fr-hint" data-fr-hint></div>
            </div>
            <div class="fr-tabs" role="tablist" aria-label="Стиль повідомлення">
                <button type="button" role="tab" data-tone="short" aria-selected="true">Коротко</button>
                <button type="button" role="tab" data-tone="detail" aria-selected="false">Детально</button>
                <button type="button" role="tab" data-tone="urgent" aria-selected="false">Терміново</button>
            </div>
            <label class="fr-sr" for="frText">Текст для клієнта</label>
            <textarea id="frText" rows="6" data-fr-text></textarea>
            <ul class="fr-tips" data-fr-tips></ul>
            <div class="fr-actions">
                <button type="button" class="fr-btn fr-main" data-fr-copy>Копіювати</button>
                <button type="button" class="fr-btn fr-viber" data-fr-chat="viber">Viber</button>
                <button type="button" class="fr-btn" data-fr-chat="whatsapp">WhatsApp</button>
            </div>
            <div class="fr-msg" role="status" aria-live="polite"></div>`;
    }

    /* ---------------- Логіка Sales ---------------- */

    function salesState(box) {
        const offers = [];
        for (const a of answersOf(req)) (a.offers || []).forEach((o) => offers.push({ ...o, logist: a.logist }));
        const offer = offers[Number(box.querySelector("[data-fr-offer]")?.value || 0)] || offers[0] || {};
        const price = num(box.querySelector("[data-fr-price]")?.value);
        return { offer, price, cur: offer.currency || stats?.cur || "EUR" };
    }

    function refreshSales(regenerate = true) {
        const box = document.querySelector("#furikHelp [data-fr='sales']");
        if (!box) return;
        const { offer, price, cur } = salesState(box);
        const cost = num(offer.price);

        // Підказка: ціна логіста + звичайна маржа
        const hint = box.querySelector("[data-fr-hint]");
        const usual = stats?.margin && stats.cur === cur ? stats.margin.med : 0;
        hint.innerHTML = cost
            ? `Ціна логіста: <b>${money(cost, cur)}</b>${usual ? ` · зазвичай маржа ≈ <b>${money(usual, cur)}</b> → <button type="button" class="fr-link" data-fr-suggest="${Math.round((cost + usual) / 10) * 10}">${money(Math.round((cost + usual) / 10) * 10, cur)}</button>` : ""}`
            : "Логіст не вказав ціну — уточніть у переписці запиту.";

        // Поради
        const tips = [];
        if (!price) tips.push(`<li class="warn">Впишіть ціну для клієнта — у тексті поки стоїть [ЦІНА].</li>`);
        else if (cost && price <= cost) tips.push(`<li class="bad">Ціна для клієнта не вища за ставку логіста (${money(cost, cur)}) — збиток.</li>`);
        else if (cost && (price - cost) / price < 0.05) tips.push(`<li class="warn">Маржа менше 5% (${money(price - cost, cur)}). Точно так?</li>`);
        else if (cost) tips.push(`<li class="ok">Маржа: ${money(price - cost, cur)} (${Math.round(((price - cost) / price) * 100)}%).</li>`);
        if (tone !== "short") tips.push(`<li>Назвіть термін дії ціни — це підштовхує клієнта відповісти швидше.</li>`);
        if (!req.desired_date) tips.push(`<li>У запиті немає дати завантаження — уточніть її в клієнта.</li>`);
        box.querySelector("[data-fr-tips]").innerHTML = tips.join("");

        if (regenerate) box.querySelector("[data-fr-text]").value = clientMessage(req, offer, price, cur, tone);
    }

    function flash(text) {
        const el = document.querySelector("#furikHelp .fr-msg");
        if (!el) return;
        el.textContent = text;
        clearTimeout(flash.t);
        flash.t = setTimeout(() => (el.textContent = ""), 3000);
    }

    /* ---------------- Підключення ---------------- */

    async function mount(r) {
        req = r;
        stats = null;
        const root = document.getElementById("furikHelp");
        if (!root) return;

        const salesBox = root.querySelector("[data-fr='sales'] .fr-sales");
        if (salesBox) {
            salesBox.innerHTML = salesHtml();
            refreshSales(true);
        }

        root.addEventListener("input", (e) => {
            if (e.target.matches("[data-fr-price]")) refreshSales(true);
        });
        root.addEventListener("change", (e) => {
            if (e.target.matches("[data-fr-offer]")) refreshSales(true);
        });
        root.addEventListener("click", (e) => {
            const t = e.target.closest("[data-tone]");
            if (t) {
                tone = t.dataset.tone;
                root.querySelectorAll("[data-tone]").forEach((b) => b.setAttribute("aria-selected", String(b === t)));
                return refreshSales(true);
            }
            const sug = e.target.closest("[data-fr-suggest]");
            if (sug) {
                root.querySelector("[data-fr-price]").value = sug.dataset.frSuggest;
                return refreshSales(true);
            }
            const text = root.querySelector("[data-fr-text]")?.value || "";
            if (e.target.closest("[data-fr-copy]")) {
                window.furaCarrierSearch?.copyNow(text);
                return flash("Скопійовано — вставте клієнту (Cmd+V / Ctrl+V)");
            }
            const chat = e.target.closest("[data-fr-chat]");
            if (chat) {
                const lead = typeof leadById === "function" ? leadById(req.lead_id) || (typeof findLeadByName === "function" ? findLeadByName(req.client) : null) : null;
                const phone = window.furaCarrierSearch?.phoneDigits(lead?.phone);
                if (!phone) {
                    window.furaCarrierSearch?.copyNow(text);
                    return flash("У ліда немає мобільного — текст скопійовано, вставте вручну");
                }
                window.furaCarrierSearch.openChat(chat.dataset.frChat, phone, text);
                return flash("Текст скопійовано — у месенджері вставте Cmd+V / Ctrl+V і надішліть");
            }
            if (e.target.closest("[data-fr-note]")) {
                const note = [
                    "Ціна актуальна 24 год.",
                    req.desired_date ? `Подача під завантаження ${fmtDate(req.desired_date)}.` : "Подача — за погодженням.",
                    req.transport_type ? `${req.transport_type}${req.weight ? `, ${req.weight}` : ""}.` : "",
                    "Оплата перевізнику — за погодженням.",
                ]
                    .filter(Boolean)
                    .join(" ");
                if (typeof openAnswerModal === "function") {
                    const id = req.id;
                    if (typeof closeRequestCard === "function") closeRequestCard();
                    openAnswerModal(id);
                    const ta = document.getElementById("ans_notes");
                    if (ta) {
                        ta.value = ta.value ? `${ta.value}\n${note}` : note;
                        ta.focus();
                    }
                }
            }
        });

        // Ціни по маршруту й найкраща ставка
        const [st, bid] = await Promise.all([routeStats(r).catch(() => null), bestBid(r).catch(() => null)]);
        if (req !== r) return;
        stats = st;
        const prices = root.querySelector(".fr-prices");
        if (prices) prices.innerHTML = pricesHtml(st, bid);
        refreshSales(false);

        // Прийшли з нагадування Фурика — одразу до підказки
        if (new URLSearchParams(location.search).get("furik") === "1") {
            root.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }

    window.furikReply = { sectionHtml, mount };
})();
