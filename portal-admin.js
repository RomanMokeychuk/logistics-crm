/* ================================================================= *
 * FURA — КЕРУВАННЯ КАБІНЕТАМИ З CRM                                   *
 *  • Клієнти: «🌐 Кабінет клієнта» — видати доступ (посилання), вимкнути *
 *  • Перевізники: «🌐 Кабінет перевізника» — Telegram або посилання     *
 *  • Запити: ціна для клієнта, яку він бачить і погоджує в кабінеті    *
 * Підключається на requests.html, clients.html, index.html.           *
 * ================================================================= */
(function () {
    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) return;
    const FN_URL = "https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-portal";
    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const fmtDT = (v) => (v ? new Date(v).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

    const css = document.createElement("style");
    css.textContent = `
        .pa-box { margin: 12px 0; border: 1px solid #fed7aa; background: #fff7ed; border-radius: 12px; padding: 12px 14px; font-size: 14px; }
        .pa-title { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 700; color: #9a3412; margin-bottom: 8px; }
        .pa-chip { font-size: 11px; font-weight: 700; border-radius: 6px; padding: 2px 8px; background: #ffedd5; color: #9a3412; }
        .pa-chip.ok { background: #dcfce7; color: #166534; }
        .pa-chip.wait { background: #fef3c7; color: #92400e; }
        .pa-chip.off { background: #f1f5f9; color: #64748b; }
        .pa-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 6px; }
        .pa-in { border: 1px solid #e5e7eb; border-radius: 8px; padding: 6px 8px; font: inherit; font-size: 14px; background: #fff; min-width: 0; }
        .pa-btn { border: 1px solid #f97316; background: #f97316; color: #fff; border-radius: 8px; padding: 6px 12px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
        .pa-btn.ghost { background: #fff; color: #c2410c; }
        .pa-btn:disabled { opacity: .5; }
        .pa-muted { color: #64748b; font-size: 12px; }
        .pa-acc { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 6px 0; border-top: 1px dashed #fed7aa; }
        .pa-acc:first-child { border-top: 0; }
        .pa-link { margin-top: 8px; background: #fff; border: 1px dashed #f97316; border-radius: 8px; padding: 8px; word-break: break-all; font-size: 12px; }
        .pa-side { margin-top: 18px; }
        .pa-msgs { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; margin: 6px 0; }
        .pa-msg { align-self: flex-start; max-width: 90%; background: #fff; border: 1px solid #fed7aa; border-radius: 10px 10px 10px 3px; padding: 6px 10px; white-space: pre-wrap; word-break: break-word; }
        .pa-msg.out { align-self: flex-end; background: #eff6ff; border-color: #bfdbfe; border-radius: 10px 10px 3px 10px; }
        textarea.pa-in { resize: vertical; }
        #paPending { margin: 0 0 14px; }
        .pa-reg .pa-title { flex-direction: column; align-items: flex-start; }
        .pa-reg .pa-title .pa-muted { font-weight: 400; }
        .pa-reg-item { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 0; border-top: 1px dashed #fed7aa; }
        .pa-reg-main { display: grid; gap: 3px; min-width: 260px; flex: 1; }
        .pa-reg-find { flex-basis: 100%; display: grid; gap: 6px; }
        .pa-reg-res { display: flex; gap: 6px; flex-wrap: wrap; }`;
    document.head.appendChild(css);

    async function api(action, data = {}) {
        const { data: s } = await client.auth.getSession();
        const res = await fetch(FN_URL, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${s?.session?.access_token || ""}` },
            body: JSON.stringify({ action, ...data }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "Функція fura-portal недоступна — її ще не розгорнуто?");
        return j;
    }

    async function copy(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            return false;
        }
    }

    /* ---------- Доступи (спільне для клієнта і перевізника) ---------- */

    function accountsHtml(list, kind) {
        if (!list.length) return `<div class="pa-muted">Доступу ще немає.</div>`;
        return list
            .map(
                (a) => `<div class="pa-acc">
                    <div>${esc(a.name || (a.tg_chat_id ? "через Telegram" : "без імені"))}${a.email ? ` <span class="pa-muted">${esc(a.email)}</span>` : ""}
                        <div class="pa-muted">${a.last_login_at ? `заходив ${fmtDT(a.last_login_at)}` : "ще не заходив"}${a.tg_chat_id ? " · Telegram" : ""}</div></div>
                    <div class="pa-row" style="margin:0">
                        ${a.active ? `<span class="pa-chip ok">активний</span>` : `<span class="pa-chip off">вимкнено</span>`}
                        ${!a.tg_chat_id || kind === "client" ? `<button type="button" class="pa-btn ghost" data-pa-relink="${esc(a.id)}" title="Нове посилання для входу (старе перестане діяти)">посилання</button>` : ""}
                        <button type="button" class="pa-btn ghost" data-pa-toggle="${esc(a.id)}" data-on="${a.active ? "0" : "1"}">${a.active ? "вимкнути" : "увімкнути"}</button>
                    </div>
                </div>`,
            )
            .join("");
    }

    async function mountAccess(box, kind, refId, intro) {
        box.innerHTML = `<div class="pa-title"><span>🌐 ${kind === "client" ? "Кабінет клієнта" : "Кабінет перевізника"}</span></div>${intro || ""}<div class="pa-muted">Завантаження…</div>`;
        let res;
        try {
            res = await api("admin_accounts", { kind, ref_id: refId });
        } catch (err) {
            box.innerHTML = `<div class="pa-title"><span>🌐 Кабінет</span></div><div class="pa-muted">${esc(err.message)}</div>`;
            return;
        }
        box.innerHTML = `
            <div class="pa-title"><span>🌐 ${kind === "client" ? "Кабінет клієнта" : "Кабінет перевізника"}</span></div>
            ${intro || ""}
            <div data-pa-list>${accountsHtml(res.accounts, kind)}</div>
            <form class="pa-row" data-pa-new>
                <input class="pa-in" name="name" placeholder="${kind === "client" ? "Ім'я людини клієнта" : "Ім'я (диспетчер, власник)"}" style="flex:1 1 140px" />
                <input class="pa-in" name="email" type="email" placeholder="e-mail (необов'язково)" style="flex:1 1 160px" />
                <button type="submit" class="pa-btn">+ Видати доступ</button>
            </form>
            <div data-pa-out></div>
            <div class="pa-muted" style="margin-top:6px">Посилання діє 7 днів; перший вхід — по ньому, далі кабінет пам'ятає людину 30 днів.${
                kind === "client" ? " Клієнт бачить свої запити, перевезення, статуси й суми — без перевізника і його ставки." : " Перевізник бачить запропоновані йому рейси (без клієнта) і свої рейси."
            }</div>`;

        const showLink = async (link) => {
            const copied = await copy(link);
            box.querySelector("[data-pa-out]").innerHTML = `<div class="pa-link">${esc(link)}</div><div class="pa-muted">${copied ? "✅ Скопійовано — " : ""}надішліть людині у Viber / e-mail / Telegram.</div>`;
        };
        const reload = () => mountAccess(box, kind, refId, intro);

        box.querySelector("[data-pa-new]").addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const f = Object.fromEntries(new FormData(ev.target).entries());
            const btn = ev.target.querySelector("button");
            btn.disabled = true;
            try {
                const r = await api("admin_invite", { kind, ref_id: refId, name: f.name, email: f.email });
                await reload();
                await showLink(r.link);
            } catch (err) {
                alert(err.message);
                btn.disabled = false;
            }
        });
        box.querySelectorAll("[data-pa-relink]").forEach((b) =>
            b.addEventListener("click", async () => {
                b.disabled = true;
                try {
                    const r = await api("admin_invite", { kind, ref_id: refId, account_id: b.dataset.paRelink });
                    await showLink(r.link);
                } catch (err) {
                    alert(err.message);
                }
                b.disabled = false;
            }),
        );
        box.querySelectorAll("[data-pa-toggle]").forEach((b) =>
            b.addEventListener("click", async () => {
                const on = b.dataset.on === "1";
                if (!on && !confirm("Вимкнути доступ? Людину одразу буде розлогінено.")) return;
                try {
                    await api("admin_toggle", { account_id: b.dataset.paToggle, active: on });
                    reload();
                } catch (err) {
                    alert(err.message);
                }
            }),
        );
    }

    /* ---------- Клієнти: блок у лівій колонці картки ---------- */

    if (typeof renderClientView === "function") {
        const orig = renderClientView;
        window.renderClientView = function (c) {
            orig.apply(this, arguments);
            const side = document.querySelector(".dv-side");
            if (!side || !c?.id) return;
            const box = document.createElement("div");
            box.className = "pa-box pa-side";
            side.appendChild(box);
            mountAccess(box, "client", String(c.id));
            hasPortal(c.id).then((yes) => {
                if (!yes || !document.body.contains(side)) return;
                const chatBox = document.createElement("div");
                chatBox.className = "pa-box pa-side";
                side.appendChild(chatBox);
                mountStaffChat(chatBox, { lead_id: c.id }, "Переписка з клієнтом (кабінет)");
            });
        };
    }

    /* ---------- Перевізники: блок у картці ---------- */

    function carrierCard(item) {
        const body = document.getElementById("carrierCardBody");
        body?.querySelector("#paCarrierBox")?.remove();
        if (!body || !item?.id) return;
        const box = document.createElement("div");
        box.id = "paCarrierBox";
        box.className = "pa-box";
        const intro = item.tg_chat_id
            ? `<div class="pa-row" style="margin:0 0 6px"><span class="pa-chip ok">Telegram підключено</span><span class="pa-muted">Перевізник відкриває кабінет у боті командою /cabinet — окреме посилання не потрібне.</span></div>`
            : `<div class="pa-row" style="margin:0 0 6px"><span class="pa-chip wait">Telegram не підключено</span><span class="pa-muted">Найпростіше — запросити в бот (AI-агент → «Запросити в Telegram»), або видати посилання нижче.</span></div>`;
        body.appendChild(box); // у кінці картки — основні дані перевізника лишаються вгорі
        mountAccess(box, "carrier", String(item.id), intro);
        hasCarrierPortal(item.id).then((yes) => {
            if (!yes || !document.body.contains(box)) return;
            const chatBox = document.createElement("div");
            chatBox.className = "pa-box";
            chatBox.id = "paCarrierChat";
            body.querySelector("#paCarrierChat")?.remove();
            box.after(chatBox);
            mountStaffChat(chatBox, { carrier_id: item.id }, "Переписка з перевізником (кабінет)");
        });
    }
    window.furaPortalAdmin = { carrierCard };

    /* ---------- Переписка з клієнтом (кабінет) ---------- */

    let meCache = null;
    async function me() {
        if (meCache) return meCache;
        const { data: s } = await client.auth.getSession();
        const email = s?.session?.user?.email || "";
        const { data } = await client.from("staff").select("id, full_name").ilike("email", email.replace(/[%_\\]/g, "\\$&")).maybeSingle();
        meCache = data || { id: null, full_name: "Грандар" };
        return meCache;
    }

    async function mountStaffChat(box, f, title) {
        box.innerHTML = `<div class="pa-title"><span>💬 ${esc(title)}</span></div><div class="pa-muted">Завантаження…</div>`;
        const party = f.carrier_id ? "carrier" : "client";
        const col = party === "carrier" ? "carrier_id" : "lead_id";
        const ref = String(f.carrier_id || f.lead_id);
        let q = client.from("portal_messages").select("*").eq("party", party).eq(col, ref);
        if (f.deal_id) q = q.eq("deal_id", String(f.deal_id));
        if (f.request_id) q = q.eq("request_id", f.request_id);
        const { data, error } = await q.order("created_at", { ascending: true }).limit(300);
        if (error) {
            box.innerHTML = `<div class="pa-title"><span>💬 ${esc(title)}</span></div><div class="pa-muted">Чат ще не підключено — виконайте portal_chat.sql у Supabase.</div>`;
            return;
        }
        const msgs = data || [];
        const unread = msgs.filter((m) => m.direction === "in" && !m.read_at).map((m) => m.id);
        if (unread.length) client.from("portal_messages").update({ read_at: new Date().toISOString() }).in("id", unread).then(() => {});
        box.innerHTML = `
            <div class="pa-title"><span>💬 ${esc(title)}</span>${unread.length ? `<span class="pa-chip wait">${unread.length} нових</span>` : ""}</div>
            <div class="pa-msgs">${
                msgs.length
                    ? msgs
                          .map(
                              (m) => `<div class="pa-msg ${m.direction === "out" ? "out" : ""}">
                                <div>${esc(m.text)}</div>
                                <div class="pa-muted">${esc(m.author || (m.direction === "out" ? "Грандар" : "Клієнт"))} · ${fmtDT(m.created_at)}${
                                    m.direction === "out" ? (m.read_at ? " · ✓ прочитано" : " · не прочитано") : ""
                                }${!f.deal_id && !f.request_id && (m.deal_id || m.request_id) ? ` · ${m.deal_id ? `<a href="deals.html?open=${esc(m.deal_id)}">угода</a>` : `<a href="requests.html?open=${esc(m.request_id)}">запит</a>`}` : ""}</div></div>`,
                          )
                          .join("")
                    : `<div class="pa-muted">Повідомлень ще немає. ${party === "carrier" ? "Перевізник" : "Клієнт"} бачить цю переписку у своєму кабінеті.</div>`
            }</div>
            <form class="pa-row" data-pa-msg>
                <textarea class="pa-in" rows="2" placeholder="Відповідь ${party === "carrier" ? "перевізнику" : "клієнту"} (побачить у кабінеті)…" style="flex:1 1 240px" required></textarea>
                <button type="submit" class="pa-btn">Надіслати</button>
            </form>
            <div class="pa-muted">Це окремо від внутрішнього чату — тут лише те, що бачить ${party === "carrier" ? "перевізник" : "клієнт"}.</div>`;
        const list = box.querySelector(".pa-msgs");
        list.scrollTop = list.scrollHeight;
        box.querySelector("[data-pa-msg]").addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const ta = ev.target.querySelector("textarea");
            const btn = ev.target.querySelector("button");
            btn.disabled = true;
            const who = await me();
            const { data: saved, error: err } = await client.from("portal_messages").insert({
                party,
                [col]: ref,
                deal_id: f.deal_id ? String(f.deal_id) : null,
                request_id: f.request_id || null,
                direction: "out",
                staff_id: who.id,
                author: who.full_name ? `${who.full_name}, Грандар` : "Грандар",
                text: ta.value.trim(),
            }).select("id");
            if (err) {
                btn.disabled = false;
                return alert("Не вдалося надіслати: " + err.message);
            }
            if (party === "carrier" && saved?.[0]?.id) api("admin_notify", { message_id: saved[0].id }).catch(() => {}); // + у Telegram перевізнику
            mountStaffChat(box, f, title);
        });
    }

    /* ---------- Угоди: переписка з клієнтом у картці угоди ---------- */

    if (typeof renderDealView === "function") {
        const origDeal = renderDealView;
        window.renderDealView = function (d) {
            origDeal.apply(this, arguments);
            const side = document.querySelector(".dv-side");
            if (!side) return;
            if (d?.lead_id)
                hasPortal(d.lead_id).then((yes) => {
                    if (!yes || !document.body.contains(side)) return;
                    const box = document.createElement("div");
                    box.className = "pa-box pa-side";
                    side.appendChild(box);
                    mountStaffChat(box, { lead_id: d.lead_id, deal_id: d.id }, "Клієнт бачить цю угоду в кабінеті · переписка");
                });
            if (d?.carrier_id)
                hasCarrierPortal(d.carrier_id).then((yes) => {
                    if (!yes || !document.body.contains(side)) return;
                    const box = document.createElement("div");
                    box.className = "pa-box pa-side";
                    side.appendChild(box);
                    mountStaffChat(box, { carrier_id: d.carrier_id, deal_id: d.id }, "Перевізник бачить цей рейс у кабінеті · переписка");
                });
        };
    }


    /* ---------- Запити: ціна для клієнта в кабінеті ---------- */

    const carrierPortal = new Map();
    async function hasCarrierPortal(id) {
        if (!id) return false;
        if (carrierPortal.has(String(id))) return carrierPortal.get(String(id));
        const { count } = await client.from("portal_accounts").select("id", { count: "exact", head: true }).eq("carrier_id", String(id)).eq("active", true);
        const yes = (count || 0) > 0;
        carrierPortal.set(String(id), yes);
        return yes;
    }
    const leadPortal = new Map(); // lead_id → чи є кабінет
    async function hasPortal(leadId) {
        if (!leadId) return false;
        if (leadPortal.has(String(leadId))) return leadPortal.get(String(leadId));
        const { count } = await client.from("portal_accounts").select("id", { count: "exact", head: true }).eq("lead_id", String(leadId)).eq("active", true);
        const yes = (count || 0) > 0;
        leadPortal.set(String(leadId), yes);
        return yes;
    }

    function decisionHtml(r) {
        if (r.client_decision === "accepted") return `<span class="pa-chip ok">✅ клієнт погодив ${fmtDT(r.client_decision_at)}</span>`;
        if (r.client_decision === "discuss") return `<span class="pa-chip wait">💬 клієнт хоче обговорити ${fmtDT(r.client_decision_at)}</span>`;
        if (r.client_price) return `<span class="pa-chip wait">чекає рішення клієнта</span>`;
        return "";
    }

    async function requestBox(id) {
        const body = document.getElementById("requestCardBody");
        if (!body) return;
        body.querySelector("#paReqBox")?.remove();
        const r = typeof requestsCache !== "undefined" ? requestsCache.find((x) => String(x.id) === String(id)) : null;
        if (!r) return;
        const portal = r.source === "portal" || (await hasPortal(r.lead_id));
        if (!portal || String(currentCardRequestIdSafe()) !== String(r.id)) return;
        const box = document.createElement("div");
        box.id = "paReqBox";
        box.className = "pa-box";
        box.innerHTML = `
            <div class="pa-title"><span>🌐 Кабінет клієнта ${r.source === "portal" ? `<span class="pa-chip">запит створив клієнт</span>` : ""}</span>${decisionHtml(r)}</div>
            ${r.client_decision_note ? `<div>Коментар клієнта: <b>${esc(r.client_decision_note)}</b></div>` : ""}
            <div class="pa-muted">Ціна, яку клієнт бачить у кабінеті й може погодити. Ставки перевізників і маржу клієнт не бачить.</div>
            <form class="pa-row" data-pa-price>
                <input class="pa-in" name="price" inputmode="decimal" placeholder="Ціна для клієнта" value="${esc(r.client_price ?? "")}" style="width:140px" />
                <select class="pa-in" name="currency">${["EUR", "USD", "UAH"].map((c) => `<option ${(r.client_currency || "EUR") === c ? "selected" : ""}>${c}</option>`).join("")}</select>
                <input class="pa-in" name="note" placeholder="Умови: подача, оплата, термін дії…" value="${esc(r.client_price_note || "")}" style="flex:1 1 200px" />
                <button type="submit" class="pa-btn">${r.client_price ? "Оновити ціну" : "Показати клієнту"}</button>
                ${r.client_price ? `<button type="button" class="pa-btn ghost" data-pa-clear>Прибрати</button>` : ""}
            </form>`;
        const head = body.querySelector(".card-header-block");
        head ? head.after(box) : body.prepend(box);
        if (r.lead_id) {
            const chatBox = document.createElement("div");
            chatBox.style.marginTop = "10px";
            box.appendChild(chatBox);
            mountStaffChat(chatBox, { lead_id: r.lead_id, request_id: r.id }, "Переписка з клієнтом по цьому запиту");
        }

        const save = async (patch) => {
            const { data, error } = await client.from("requests").update(patch).eq("id", r.id).select().single();
            if (error) return alert("Не вдалося зберегти: " + error.message + (/column/.test(error.message) ? "\n\nВиконайте portal.sql у Supabase." : ""));
            Object.assign(r, data);
            requestBox(r.id);
        };
        box.querySelector("[data-pa-price]").addEventListener("submit", (ev) => {
            ev.preventDefault();
            const f = Object.fromEntries(new FormData(ev.target).entries());
            const price = Number(String(f.price).replace(",", ".").replace(/\s/g, ""));
            if (!(price > 0)) return alert("Вкажіть ціну.");
            const changed = Number(r.client_price) !== price || r.client_currency !== f.currency;
            save({
                client_price: price,
                client_currency: f.currency,
                client_price_note: f.note.trim() || null,
                client_price_at: new Date().toISOString(),
                // нова ціна — клієнт погоджує заново
                ...(changed ? { client_decision: null, client_decision_at: null, client_decision_note: null } : {}),
            });
        });
        box.querySelector("[data-pa-clear]")?.addEventListener("click", () => {
            if (confirm("Прибрати ціну з кабінету клієнта?"))
                save({ client_price: null, client_currency: null, client_price_note: null, client_price_at: null, client_decision: null, client_decision_at: null, client_decision_note: null });
        });
    }
    function currentCardRequestIdSafe() {
        return typeof currentCardRequestId !== "undefined" ? currentCardRequestId : null;
    }

    /* ---------- Нові реєстрації (самі зареєструвались у кабінеті) ---------- */
    const REG_KIND = /clients\.html$/.test(location.pathname) ? "client" : /перевізник/i.test(document.querySelector("main .top-bar h1")?.textContent || "") ? "carrier" : null;
    async function pendingBox() {
        if (!REG_KIND) return;
        let box = document.getElementById("paPending");
        if (!box) {
            const bar = document.querySelector("main .top-bar");
            if (!bar) return;
            box = document.createElement("div");
            box.id = "paPending";
            bar.insertAdjacentElement("afterend", box);
        }
        let list = [];
        try {
            list = (await api("admin_pending", { kind: REG_KIND })).pending || [];
        } catch {
            return; // функцію ще не оновлено — мовчимо
        }
        if (!list.length) return (box.innerHTML = "");
        const what = REG_KIND === "client" ? "клієнта" : "перевізника";
        box.innerHTML = `<div class="pa-box pa-reg">
            <div class="pa-title"><span>🆕 Нові реєстрації в кабінеті — ${list.length}</span>
            <span class="pa-muted">Людина зареєструвалась сама. Перевірте компанію (подзвоніть), прив'яжіть до картки або створіть нову — і їй відкриється кабінет. До підтвердження вона нічого не бачить.</span></div>
            ${list
                .map((a) => {
                    const r = a.reg || {};
                    return `<div class="pa-reg-item" data-id="${esc(a.id)}">
                    <div class="pa-reg-main"><b>${esc(r.company || "—")}</b> <span class="pa-chip">ЄДРПОУ ${esc(r.edrpou || "—")}</span>${r.city ? ` <span class="pa-muted">${esc(r.city)}</span>` : ""}
                        <div>${esc(r.name || "")} · <a href="tel:${esc(String(r.phone || "").replace(/[^\d+]/g, ""))}">${esc(r.phone || "")}</a>${r.email ? ` · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ""} · логін <code>${esc(a.login || "—")}</code></div>
                        ${r.note ? `<div class="pa-muted">«${esc(r.note)}»</div>` : ""}
                        <div class="pa-muted">Заявка ${fmtDT(a.created_at)}</div></div>
                    <div class="pa-row">
                        ${a.match ? `<button class="pa-btn" data-reg="link" data-ref="${esc(a.match.id)}" title="У FURA вже є компанія з цим ЄДРПОУ">✓ Прив'язати до «${esc(a.match.name)}»</button>` : `<button class="pa-btn" data-reg="create">✓ Створити ${what} і відкрити доступ</button>`}
                        <button class="pa-btn ghost" data-reg="find">Інша компанія…</button>
                        <button class="pa-btn ghost" data-reg="reject">Відхилити</button>
                    </div>
                    <div class="pa-reg-find" hidden><input class="pa-in" placeholder="Назва або ЄДРПОУ ${what} у FURA" /><div class="pa-reg-res"></div></div>
                </div>`;
                })
                .join("")}</div>`;
    }
    async function regAction(item, payload, okText) {
        try {
            const r = await api(payload.reject ? "admin_reject" : "admin_approve", { account_id: item.dataset.id, ...payload });
            item.innerHTML = `<div class="pa-chip ok">${esc(okText(r))}</div>`;
            setTimeout(pendingBox, 2500);
            if (typeof loadClients === "function") loadClients();
        } catch (err) {
            alert(err.message);
        }
    }
    document.addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-reg], [data-reg-pick]");
        if (!b || !b.closest("#paPending")) return;
        const item = b.closest(".pa-reg-item");
        if (b.dataset.regPick) return regAction(item, { ref_id: b.dataset.regPick }, (r) => `Доступ відкрито — прив'язано до «${r.company}»`);
        const act = b.dataset.reg;
        if (act === "link") return regAction(item, { ref_id: b.dataset.ref }, (r) => `Доступ відкрито — прив'язано до «${r.company}»`);
        if (act === "create") {
            if (!confirm(`Створити нову картку ${REG_KIND === "client" ? "клієнта (лід «Новий»)" : "перевізника"} і відкрити доступ до кабінету?`)) return;
            return regAction(item, { create: true }, (r) => `Створено «${r.company}», доступ відкрито`);
        }
        if (act === "reject") {
            const reason = prompt("Відхилити заявку? Можна вказати причину (бачите лише ви):", "");
            if (reason === null) return;
            return regAction(item, { reject: true, reason }, () => "Заявку відхилено");
        }
        if (act === "find") {
            const f = item.querySelector(".pa-reg-find");
            f.hidden = !f.hidden;
            f.querySelector("input").focus();
        }
    });
    let findT = null;
    document.addEventListener("input", (ev) => {
        const inp = ev.target.closest("#paPending .pa-reg-find input");
        if (!inp) return;
        clearTimeout(findT);
        findT = setTimeout(async () => {
            const q = inp.value.trim().replace(/[%,()]/g, " ");
            const res = inp.nextElementSibling;
            if (q.length < 2) return (res.innerHTML = "");
            const { data } = await client.from(REG_KIND === "client" ? "leads" : "carriers").select("id, name, edrpou").or(`name.ilike.%${q}%,edrpou.ilike.%${q}%`).limit(8);
            res.innerHTML = (data || []).map((c) => `<button class="pa-btn ghost" data-reg-pick="${esc(c.id)}">${esc(c.name)}${c.edrpou ? ` · ${esc(c.edrpou)}` : ""}</button>`).join("") || `<span class="pa-muted">Нічого не знайдено</span>`;
        }, 300);
    });
    if (REG_KIND) {
        setTimeout(pendingBox, 1200);
        setInterval(pendingBox, 120000);
    }

    if (typeof openRequestCard === "function") {
        const orig = openRequestCard;
        window.openRequestCard = function (id) {
            const res = orig.apply(this, arguments);
            requestBox(id);
            return res;
        };
    }
})();
