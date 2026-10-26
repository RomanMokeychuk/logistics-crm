/* ================================================================= *
 * FURA — СТАВКИ ПЕРЕВІЗНИКІВ у картці запиту                         *
 * 1) додати перевізника  2) «Viber» — чат із готовим текстом         *
 * 3) вписати ставку й дату подачі. Найкраща ставка підсвічена.       *
 * Таблиця carrier_bids (carrier_bids.sql). Потрібен carrier-search.js*
 * ================================================================= */

(function () {
    const client = typeof sbClient !== "undefined" ? sbClient : null;
    const S = window.furaCarrierSearch;
    if (!client || !S) return;

    let request = null; // відкритий запит
    let rows = [];
    let me = null;

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);

    function box() {
        return document.getElementById("bidsBox");
    }

    function flash(text, bad) {
        const el = box()?.querySelector(".bd-msg");
        if (!el) return;
        el.textContent = text;
        el.className = `bd-msg${bad ? " bad" : ""}`;
        clearTimeout(flash.t);
        flash.t = setTimeout(() => (el.textContent = ""), bad ? 6000 : 2500);
    }

    async function whoAmI() {
        if (me) return me;
        const { data } = await client.auth.getSession();
        const email = (data?.session?.user?.email || "").toLowerCase();
        const { data: staff } = await client.from("staff").select("id, email").eq("active", true);
        me = (staff || []).find((s) => (s.email || "").toLowerCase() === email) || {};
        return me;
    }

    /* ---------------- Малювання ---------------- */

    // Найкраща ставка: найменша серед тих, де вона є (окремо по кожній валюті — береться найчастіша)
    function bestId() {
        const withPrice = rows.filter((r) => r.status === "bid" && Number(r.price) > 0);
        if (!withPrice.length) return null;
        const counts = {};
        withPrice.forEach((r) => (counts[r.currency] = (counts[r.currency] || 0) + 1));
        const cur = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        return withPrice.filter((r) => r.currency === cur).sort((a, b) => Number(a.price) - Number(b.price))[0].id;
    }

    function render() {
        const el = box();
        if (!el) return;
        const best = bestId();
        const list = rows
            .map((r) => {
                const phone = S.phoneDigits(r.phone);
                const refused = r.status === "refused";
                return `
                <div class="bd-row${r.id === best ? " best" : ""}${refused ? " refused" : ""}" data-id="${r.id}">
                    <div class="bd-who">
                        <b>${r.carrier_id ? `<a href="index.html?open=${encodeURIComponent(r.carrier_id)}" data-carrier-card="${esc(r.carrier_id)}" class="fura-clink" title="Відкрити картку перевізника">${esc(r.carrier_name)}</a>` : esc(r.carrier_name)}</b>
                        <span>${phone ? `+${phone}` : "немає мобільного"}${r.id === best ? ` · <strong class="bd-best">найкраща</strong>` : ""}</span>
                    </div>
                    <div class="bd-chat">
                        ${phone ? `<button type="button" class="bd-btn bd-viber" data-chat="viber" title="Відкрити Viber — текст уже скопійовано, вставте Cmd+V / Ctrl+V">Viber</button>
                        <button type="button" class="bd-btn" data-chat="whatsapp">WhatsApp</button>` : ""}
                        <button type="button" class="bd-btn" data-copy title="Скопіювати текст запиту">Копіювати</button>
                    </div>
                    <div class="bd-fields">
                        <label>Ставка<input type="number" min="0" step="10" inputmode="decimal" data-f="price" value="${r.price ?? ""}" placeholder="—" ${refused ? "disabled" : ""}/></label>
                        <label>Валюта<select data-f="currency" ${refused ? "disabled" : ""}>${["EUR", "USD", "UAH"].map((c) => `<option ${c === r.currency ? "selected" : ""}>${c}</option>`).join("")}</select></label>
                        <label>Подача<input type="date" data-f="load_date" value="${r.load_date || ""}" ${refused ? "disabled" : ""}/></label>
                        <label class="bd-note">Примітка<input type="text" data-f="note" value="${esc(r.note || "")}" placeholder="умови, оплата…"/></label>
                    </div>
                    <div class="bd-end">
                        <button type="button" class="bd-btn bd-small" data-refuse>${refused ? "Повернути" : "Відмовився"}</button>
                        <button type="button" class="bd-x" data-del title="Прибрати перевізника" aria-label="Прибрати">×</button>
                    </div>
                </div>`;
            })
            .join("");

        el.querySelector(".bd-list").innerHTML =
            list ||
            `<div class="bd-empty">Ще нікого не додали. Знайдіть перевізника нижче (або через «Помічник») — і напишіть йому у Viber одним натисканням.</div>`;
        const bids = rows.filter((r) => r.status === "bid").length;
        el.querySelector(".bd-count").textContent = rows.length ? `${bids} із ${rows.length} дали ставку` : "";
    }

    /* ---------------- Дані ---------------- */

    async function load() {
        if (!request) return;
        const { data, error } = await client
            .from("carrier_bids")
            .select("*")
            .eq("request_id", request.id)
            .order("created_at", { ascending: true });
        if (error) {
            box().querySelector(".bd-list").innerHTML = `<div class="bd-empty bad">Таблиця ставок ще не створена: виконайте carrier_bids.sql у Supabase. (${esc(error.message)})</div>`;
            return;
        }
        rows = data || [];
        render();
    }

    async function addCarrier(c) {
        if (!request) return;
        const name = String(c.name || "").trim();
        if (!name) return;
        if (rows.some((r) => (c.id && String(r.carrier_id) === String(c.id)) || r.carrier_name === name)) {
            flash(`${name} вже є в списку`);
            return;
        }
        const who = await whoAmI();
        const { data, error } = await client
            .from("carrier_bids")
            .insert([{ request_id: request.id, carrier_id: c.id ? String(c.id) : null, carrier_name: name, phone: c.phone || null, created_by: who.id || null }])
            .select()
            .maybeSingle();
        if (error) return flash(`Не вдалося додати: ${error.message}`, true);
        rows.push(data);
        render();
        flash(`Додано: ${name}`);
    }

    const saveTimers = {};
    function save(id, patch) {
        const r = rows.find((x) => x.id === id);
        if (!r) return;
        Object.assign(r, patch);
        if ("price" in patch) r.status = Number(r.price) > 0 ? "bid" : "asked";
        render();
        clearTimeout(saveTimers[id]);
        saveTimers[id] = setTimeout(async () => {
            const { error } = await client
                .from("carrier_bids")
                .update({
                    price: r.price === "" || r.price === null ? null : Number(r.price),
                    currency: r.currency,
                    load_date: r.load_date || null,
                    note: r.note || null,
                    status: r.status,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", id);
            flash(error ? `Не збереглося: ${error.message}` : "Збережено", !!error);
        }, 500);
    }

    /* ---------------- Пошук перевізника для додавання ---------------- */

    let searchT = null;
    async function suggest(text) {
        const out = box()?.querySelector(".bd-suggest");
        if (!out) return;
        const v = text.trim();
        if (v.length < 2) {
            out.innerHTML = "";
            return;
        }
        try {
            const list = await S.searchRegistry(client, S.parse(v), { limit: 8 });
            out.innerHTML = list.length
                ? list
                      .map((c) => {
                          const phone = S.phoneDigits(c.phone_1, c.phone_2);
                          const data = esc(JSON.stringify({ id: c.id, name: c.name, phone: c.phone_1 || c.phone_2 || "" }));
                          return `<button type="button" class="bd-sug" data-pick='${data}'><b>${esc(c.name || "Без назви")}</b><span>${esc([c.city, c.trailer_type].filter(Boolean).join(" · "))}${phone ? ` · +${phone}` : ""}</span></button>`;
                      })
                      .join("")
                : `<div class="bd-empty">Нікого не знайдено. Спробуйте «Помічник» — він шукає й за напрямком.</div>`;
        } catch (err) {
            out.innerHTML = `<div class="bd-empty bad">${esc(err.message || err)}</div>`;
        }
    }

    /* ---------------- Підключення до картки ---------------- */

    // Розмітка блоку — вставляє requests.js у картку запиту
    function sectionHtml() {
        return `
        <div class="card-section bd-section" id="bidsBox">
            <div class="card-section-title bd-title">
                <span><i class='bx bx-transfer'></i> Ставки перевізників <small class="bd-count"></small></span>
                <button type="button" class="btn-answer" data-helper title="Знайти перевізників за напрямком">
                    <i class='bx bx-search-alt'></i> Знайти через Помічник
                </button>
            </div>
            <div class="bd-list"><div class="bd-empty">Завантаження…</div></div>
            <div class="bd-add">
                <label class="bd-sr" for="bdSearch">Додати перевізника</label>
                <input id="bdSearch" type="search" autocomplete="off" placeholder="+ Додати перевізника: назва, ЄДРПОУ або «тент Польща»" />
                <div class="bd-suggest"></div>
            </div>
            <div class="bd-msg" role="status" aria-live="polite"></div>
        </div>`;
    }

    function mount(r) {
        request = r;
        rows = [];
        const el = box();
        if (!el) return;

        el.addEventListener("input", (e) => {
            if (e.target.id === "bdSearch") {
                clearTimeout(searchT);
                searchT = setTimeout(() => suggest(e.target.value), 300);
            }
        });
        el.addEventListener("change", (e) => {
            const f = e.target.dataset?.f;
            const id = e.target.closest(".bd-row")?.dataset.id;
            if (f && id) save(id, { [f]: e.target.value });
        });
        el.addEventListener("click", (e) => {
            const pick = e.target.closest("[data-pick]");
            if (pick) {
                addCarrier(JSON.parse(pick.dataset.pick));
                el.querySelector("#bdSearch").value = "";
                el.querySelector(".bd-suggest").innerHTML = "";
                return;
            }
            if (e.target.closest("[data-helper]")) {
                const q = [request.transport_type, request.load_country === "УКРАЇНА" ? request.load_address : request.load_country, "в", request.unload_country === "УКРАЇНА" ? request.unload_address : request.unload_country]
                    .filter(Boolean)
                    .join(" ");
                window.furaHelper?.open();
                window.furaHelper?.run(q);
                return;
            }
            const row = e.target.closest(".bd-row");
            if (!row) return;
            const r0 = rows.find((x) => x.id === row.dataset.id);
            const chat = e.target.closest("[data-chat]");
            if (chat) {
                S.openChat(chat.dataset.chat, S.phoneDigits(r0.phone), currentText());
                flash("Текст скопійовано — у месенджері вставте Cmd+V / Ctrl+V і надішліть");
                return;
            }
            if (e.target.closest("[data-copy]")) {
                S.copyNow(currentText());
                flash("Текст запиту скопійовано");
                return;
            }
            if (e.target.closest("[data-refuse]")) {
                save(r0.id, { status: r0.status === "refused" ? (Number(r0.price) > 0 ? "bid" : "asked") : "refused" });
                return;
            }
            if (e.target.closest("[data-del]")) {
                if (!confirm(`Прибрати ${r0.carrier_name} зі ставок?`)) return;
                client
                    .from("carrier_bids")
                    .delete()
                    .eq("id", r0.id)
                    .then(({ error }) => {
                        if (error) return flash(`Не вдалося: ${error.message}`, true);
                        rows = rows.filter((x) => x.id !== r0.id);
                        render();
                    });
            }
        });
        load();
    }

    function currentText() {
        return request ? S.requestText(request) : "";
    }

    function unmount() {
        request = null;
        rows = [];
    }

    window.furaBids = {
        sectionHtml,
        mount,
        unmount,
        addCarrier,
        currentText,
        isOpen: () => !!request && !!box(),
    };
})();
