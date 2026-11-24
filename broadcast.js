/* ================================================================= *
 * FURA — 📣 VIBER-РОЗСИЛКИ (Київстар)                                  *
 *   Логіст: запит → перевізникам, підібраним під маршрут (+ кого       *
 *           вкажете вручну). Текст — опис вантажу без клієнта і цін.   *
 *   Sales:  свої клієнти / ліди (за статусом, пошуком).                *
 * Відправляє функція fura-broadcast. Поки не підключено Київстар —     *
 * тестовий режим: усе видно, але нічого не надсилається.               *
 *                                                                     *
 *   furaBroadcast.open({ kind: "carriers", request })                 *
 *   furaBroadcast.open({ kind: "clients" })                            *
 *   furaBroadcast.history()                                            *
 * ================================================================= */
(function () {
    if (window.furaBroadcast) return;
    const client = () => (typeof sbClient !== "undefined" ? sbClient : null);
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const PRICE = 1.75; // грн за повідомлення (орієнтовно, реклама у Viber)
    const SIGN_KEY = "fura_bc_sign";
    const normPhone = (v) => {
        let d = String(v ?? "").replace(/\D/g, "");
        if (d.length === 10 && d.startsWith("0")) d = "38" + d;
        if (d.length === 9) d = "380" + d;
        if (d.length === 11 && d.startsWith("80")) d = "3" + d;
        return /^380\d{9}$/.test(d) ? d : "";
    };
    const fmtPhone = (p) => (p ? `+${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}` : "");
    const upper = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, " ");
    const ALIAS = { "ПОЛЬЩА": "ПОЛЬША", "ВЕЛИКА БРИТАНІЯ": "ВЕЛИКОБРИТАНІЯ" };
    const isUA = (c) => /^(УКРАЇНА|UKRAINE|UA)$/i.test(String(c || "").trim());
    let cfg = null;
    async function config() {
        if (cfg) return cfg;
        try { const { data } = await client().functions.invoke("fura-broadcast", { body: { action: "config" } }); cfg = data || {}; } catch (e) { cfg = {}; }
        return cfg;
    }
    async function call(body) {
        const { data, error } = await client().functions.invoke("fura-broadcast", { body });
        if (error) {
            let msg = "Сервер розсилок не відповів. Перевірте, чи розгорнута функція fura-broadcast.";
            try { const j = await error.context?.json(); if (j?.error) msg = j.error; } catch (_) { /* */ }
            throw new Error(msg);
        }
        return data;
    }

    /* ---------- вікно ---------- */
    let root = null;
    function shell(title) {
        close();
        root = document.createElement("div");
        root.className = "bc-overlay";
        root.innerHTML = `<div class="bc-modal"><div class="bc-head"><b>${title}</b>
            <span class="bc-mode"></span>
            <button type="button" class="bc-tab-hist" title="Історія розсилок"><i class="bx bx-history"></i> Історія</button>
            <button type="button" class="bc-x" title="Закрити">&times;</button></div><div class="bc-body"></div></div>`;
        document.body.appendChild(root);
        root.querySelector(".bc-x").onclick = close;
        root.querySelector(".bc-tab-hist").onclick = () => history();
        root.addEventListener("mousedown", (e) => { if (e.target === root) close(); });
        config().then((c) => {
            const m = root?.querySelector(".bc-mode");
            if (m) m.innerHTML = c.test ? `<span class="bc-test" title="Київстар ще не підключено: повідомлення НЕ надсилаються, лише перевірка">🧪 тестовий режим</span>` : c.sender ? `<span class="bc-live">Viber: ${esc(c.sender)}</span>` : "";
        });
        return root.querySelector(".bc-body");
    }
    function close() { root?.remove(); root = null; }
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && root) close(); });

    /* ---------- спільний список отримувачів ---------- */
    // items: [{ id, name, phone, sub, score }]
    function listUi(box, items, opt) {
        const sel = new Set(items.filter((x) => x.phone && x.checked !== false).map((x) => String(x.id)));
        let q = "";
        const paint = () => {
            const s = q.toLowerCase();
            const shown = items.filter((x) => !s || (x.name + " " + x.sub + " " + x.phone).toLowerCase().includes(s));
            box.querySelector(".bc-list").innerHTML = shown.length ? shown.map((x) => `<label class="bc-row ${x.phone ? "" : "nophone"}">
                <input type="checkbox" data-id="${esc(x.id)}" ${sel.has(String(x.id)) ? "checked" : ""} ${x.phone ? "" : "disabled"}>
                <span class="bc-nm"><b>${esc(x.name || "—")}</b><small>${esc(x.sub || "")}</small></span>
                <span class="bc-ph">${x.phone ? fmtPhone(x.phone) : "немає мобільного"}</span></label>`).join("") : `<div class="bc-empty">${esc(opt.empty || "Нікого не знайдено")}</div>`;
            const n = sel.size;
            box.querySelector(".bc-count").innerHTML = `Обрано <b>${n}</b> з ${items.filter((x) => x.phone).length} · ≈ ${Math.round(n * PRICE)} грн`;
            opt.onChange?.(n);
        };
        box.querySelector(".bc-list").addEventListener("change", (e) => {
            const id = e.target.dataset?.id;
            if (!id) return;
            if (e.target.checked) sel.add(id); else sel.delete(id);
            paint();
        });
        box.querySelector(".bc-q").addEventListener("input", (e) => { q = e.target.value.trim(); paint(); });
        box.querySelector("[data-all]").onclick = () => { items.forEach((x) => x.phone && sel.add(String(x.id))); paint(); };
        box.querySelector("[data-none]").onclick = () => { sel.clear(); paint(); };
        paint();
        return {
            sel,
            add(item) {
                if (!items.some((x) => String(x.id) === String(item.id))) items.unshift(item);
                if (item.phone) sel.add(String(item.id));
                paint();
            },
            repaint: paint,
        };
    }
    const listHtml = (ph) => `<div class="bc-listbar"><input type="search" class="bc-q" placeholder="${esc(ph)}">
        <button type="button" data-all>Усі</button><button type="button" data-none>Жодного</button><span class="bc-count"></span></div>
        <div class="bc-list"></div>`;

    function textHtml(text, hint) {
        let sign = "";
        try { sign = localStorage.getItem(SIGN_KEY) || ""; } catch (e) { /* */ }
        return `<div class="bc-text-wrap">
            <label class="bc-lbl">Текст повідомлення <small>${esc(hint)}</small></label>
            <textarea class="bc-text" data-ai-write maxlength="1000">${esc(text)}</textarea>
            <label class="bc-lbl">Підпис (ваш телефон — щоб дзвонили саме вам)</label>
            <input class="bc-sign" placeholder="Напр.: Роман, ТОВ «Грандар», +380 99 123 45 67" value="${esc(sign)}">
            <div class="bc-len"></div></div>`;
    }
    const fullText = (box) => {
        const t = box.querySelector(".bc-text").value.trim();
        const s = box.querySelector(".bc-sign").value.trim();
        return s ? `${t}\n\n${s}` : t;
    };
    function bindText(box) {
        const upd = () => {
            const n = fullText(box).length;
            box.querySelector(".bc-len").textContent = `${n} / 1000 символів`;
            box.querySelector(".bc-len").classList.toggle("over", n > 1000);
        };
        box.querySelector(".bc-text").addEventListener("input", upd);
        box.querySelector(".bc-sign").addEventListener("input", (e) => { try { localStorage.setItem(SIGN_KEY, e.target.value); } catch (err) { /* */ } upd(); });
        upd();
    }

    async function doSend(box, kind, ui, extra) {
        const text = fullText(box);
        const ids = [...ui.sel];
        if (!ids.length) return alert("Оберіть, кому надіслати.");
        if (text.length < 10) return alert("Напишіть текст розсилки.");
        if (text.length > 1000) return alert("Текст задовгий (більше 1000 символів).");
        const c = await config();
        const who = kind === "carriers" ? "перевізникам" : "клієнтам";
        if (!confirm(`${c.test ? "ТЕСТ (нічого не надішлеться). " : ""}Надіслати у Viber ${ids.length} ${who}?\nОрієнтовна вартість: ≈ ${Math.round(ids.length * PRICE)} грн.`)) return;
        const btn = box.querySelector(".bc-send");
        btn.disabled = true;
        btn.innerHTML = `<i class="bx bx-loader-alt bx-spin"></i> Надсилаю ${ids.length}…`;
        try {
            const r = await call({ action: "send", kind, ids, text, ...extra });
            showResult(r);
        } catch (e) {
            alert(e.message);
            btn.disabled = false;
            btn.innerHTML = `<i class="bx bxl-viber"></i> Надіслати`;
        }
    }
    function showResult(r) {
        const body = root?.querySelector(".bc-body");
        if (!body) return;
        body.innerHTML = `<div class="bc-done">
            <div class="bc-done-ico">${r.test ? "🧪" : "✅"}</div>
            <h3>${r.test ? "Тест пройшов — повідомлення НЕ надсилались" : "Розсилку відправлено"}</h3>
            <p>Отримувачів: <b>${r.total}</b> · ${r.test ? "перевірено" : "прийнято Київстаром"}: <b>${r.sent}</b>${r.failed ? ` · помилок: <b class="bad">${r.failed}</b>` : ""}${r.skipped ? ` · пропущено (просили не надсилати): ${r.skipped}` : ""}</p>
            ${r.test ? `<p class="bc-muted">Щойно Київстар буде підключено (ключі в Supabase Secrets), ці ж кнопки почнуть надсилати по-справжньому.</p>` : `<p class="bc-muted">Статуси «доставлено / прочитано» оновлюються в «Історії».</p>`}
            <button type="button" class="bc-btn" data-open="${r.id}">Подивитись статуси</button></div>`;
        body.querySelector("[data-open]").onclick = () => details(r.id);
    }

    /* ---------- логіст → перевізникам ---------- */
    async function openCarriers(r) {
        const body = shell("📣 Розсилка перевізникам у Viber");
        const loadC = r.load_country, unloadC = r.unload_country;
        const foreign = !isUA(unloadC) ? unloadC : !isUA(loadC) ? loadC : "";
        const country = ALIAS[upper(foreign)] || upper(foreign);
        const trailers = String(r.transport_type || "").split(/[,;/]+/).map(upper).filter(Boolean);
        const text = typeof carrierTextOf === "function" ? carrierTextOf(r) : "";
        body.innerHTML = `<div class="bc-grid">
            <section class="bc-col">
                <div class="bc-filt">
                    <span class="bc-chip">${country ? `Напрямок: <b>${esc(country)}</b>` : "По Україні"}</span>
                    ${trailers.length ? `<label class="bc-chk"><input type="checkbox" class="bc-tr" checked> лише ${esc(trailers.join(" / ").toLowerCase())}</label>` : ""}
                    <label class="bc-chk"><input type="checkbox" class="bc-lardi"> лише знайдені на Lardi</label>
                </div>
                <div class="bc-add"><input type="search" class="bc-find" placeholder="➕ Додати конкретного перевізника: назва, ЄДРПОУ або телефон…"><div class="bc-sugg" hidden></div></div>
                ${listHtml("Пошук у списку…")}
            </section>
            <section class="bc-col">${textHtml(text, "без клієнта і ціни — як «Текст перевізнику»")}
                <div class="bc-foot"><span class="bc-muted">Відповідати будуть дзвінком або повідомленням вам — за підписом.</span>
                <button type="button" class="bc-btn bc-send"><i class="bx bxl-viber"></i> Надіслати</button></div>
            </section></div>`;
        bindText(body);
        body.querySelector(".bc-list").innerHTML = `<div class="bc-empty">Підбираю перевізників…</div>`;

        let ui = null;
        async function load() {
            let qb = client().from("carriers").select("id, name, edrpou, phone_1, phone_2, region_ukr, city, trailer_type, destinations, lardi_found, lardi_rating").limit(1500);
            if (country) {
                const alts = [country, ...Object.keys(ALIAS).filter((k) => ALIAS[k] === country)];
                qb = qb.or(alts.map((a) => `destinations.ilike.%${a.replace(/[,()]/g, " ")}%`).join(","));
            }
            const onlyTr = body.querySelector(".bc-tr")?.checked;
            if (onlyTr && trailers.length) qb = qb.or(trailers.map((t) => `trailer_type.ilike.%${t.replace(/[,()]/g, " ")}%`).join(","));
            if (body.querySelector(".bc-lardi")?.checked) qb = qb.eq("lardi_found", true);
            const { data, error } = await qb;
            if (error) { body.querySelector(".bc-list").innerHTML = `<div class="bc-empty">Помилка: ${esc(error.message)}</div>`; return; }
            const items = (data || []).map((c) => ({
                id: c.id, name: c.name || "", phone: normPhone(c.phone_1) || normPhone(c.phone_2),
                sub: [c.region_ukr, c.trailer_type, c.lardi_rating ? `Lardi ★${c.lardi_rating}` : ""].filter(Boolean).join(" · "),
                score: (c.lardi_found ? 2 : 0) + Number(c.lardi_rating || 0) / 10,
            })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "uk"));
            // одразу позначені — лише перші 100 (щоб випадково не розіслати тисячам)
            items.forEach((x, i) => (x.checked = i < 100));
            const extra = ui ? [...ui.sel] : [];
            ui = listUi(body, items, { empty: "Під цей напрямок у базі нікого — додайте перевізника вручну зверху." });
            extra.forEach((id) => items.some((x) => String(x.id) === id) && ui.sel.add(id));
            ui.repaint();
        }
        body.querySelector(".bc-tr")?.addEventListener("change", load);
        body.querySelector(".bc-lardi").addEventListener("change", load);
        await load();

        // додати конкретного перевізника
        const find = body.querySelector(".bc-find"), sugg = body.querySelector(".bc-sugg");
        let ft = 0;
        find.addEventListener("input", () => {
            clearTimeout(ft);
            const v = find.value.trim();
            if (v.length < 2) { sugg.hidden = true; return; }
            ft = setTimeout(async () => {
                const d = v.replace(/\D/g, "");
                const s = v.replace(/[,()%]/g, " ");
                const ors = [`name.ilike.%${s}%`, `edrpou.ilike.%${s}%`];
                if (d.length >= 5) ors.push(`phone_1.ilike.%${d.slice(-9)}%`, `phone_2.ilike.%${d.slice(-9)}%`);
                const { data } = await client().from("carriers").select("id, name, edrpou, phone_1, phone_2, region_ukr, trailer_type").or(ors.join(",")).limit(8);
                sugg.hidden = false;
                sugg.innerHTML = (data || []).map((c) => `<button type="button" data-c='${esc(JSON.stringify({ id: c.id, name: c.name || "", phone: normPhone(c.phone_1) || normPhone(c.phone_2), sub: [c.edrpou, c.region_ukr, c.trailer_type].filter(Boolean).join(" · ") }))}'>
                    <b>${esc(c.name)}</b> <small>${esc(c.edrpou || "")} · ${esc(fmtPhone(normPhone(c.phone_1) || normPhone(c.phone_2)) || "немає мобільного")}</small></button>`).join("") || `<div class="bc-empty">Не знайдено</div>`;
            }, 250);
        });
        sugg.addEventListener("click", (e) => {
            const b = e.target.closest("[data-c]");
            if (!b) return;
            const it = JSON.parse(b.dataset.c);
            if (!it.phone) return alert("У цього перевізника немає українського мобільного номера.");
            ui?.add(it);
            find.value = ""; sugg.hidden = true;
        });
        body.querySelector(".bc-send").onclick = () => doSend(body, "carriers", ui, { request_id: r.id });
    }

    /* ---------- Sales → клієнтам ---------- */
    async function openClients() {
        const body = shell("📣 Розсилка клієнтам у Viber");
        const c = await config();
        const STAT = ["Працюємо", "Переговори", "Контакт", "Новий"];
        body.innerHTML = `<div class="bc-grid">
            <section class="bc-col">
                <div class="bc-filt">${STAT.map((s) => `<label class="bc-chk"><input type="checkbox" class="bc-st" value="${s}" ${s === "Працюємо" ? "checked" : ""}> ${s}</label>`).join("")}
                ${c.boss ? `<label class="bc-chk"><input type="checkbox" class="bc-mine" checked> лише мої</label>` : ""}</div>
                ${listHtml("Пошук: назва, телефон…")}
            </section>
            <section class="bc-col">${textHtml("", "напр. вільні машини, нові напрямки, акція")}
                <div class="bc-foot"><span class="bc-muted">Відповідати будуть дзвінком або повідомленням вам — за підписом.</span>
                <button type="button" class="bc-btn bc-send"><i class="bx bxl-viber"></i> Надіслати</button></div>
            </section></div>`;
        bindText(body);
        const { data: { user } } = await client().auth.getUser();
        const { data: staff } = await client().from("staff").select("id, email, full_name");
        const me = (staff || []).find((s) => String(s.email || "").toLowerCase() === String(user?.email || "").toLowerCase());
        const nameOf = (id) => (staff || []).find((s) => String(s.id) === String(id))?.full_name || "";
        const { data: leads } = await client().from("leads").select("*").order("name");
        let ui = null;
        const load = () => {
            const st = new Set([...body.querySelectorAll(".bc-st:checked")].map((x) => x.value));
            const mineOnly = !c.boss || body.querySelector(".bc-mine")?.checked;
            const items = (leads || [])
                .filter((l) => st.has(l.status) && (!mineOnly || String(l.sales_id) === String(me?.id)))
                .map((l) => ({
                    id: l.id, name: l.name || "",
                    phone: [l.phone, ...(Array.isArray(l.contacts) ? l.contacts.map((x) => x?.phone) : [])].map(normPhone).find(Boolean) || "",
                    sub: [l.status, l.city, c.boss ? nameOf(l.sales_id) : ""].filter(Boolean).join(" · "),
                }));
            ui = listUi(body, items, { empty: "Немає клієнтів з такими статусами." });
        };
        body.querySelectorAll(".bc-st, .bc-mine").forEach((x) => x.addEventListener("change", load));
        load();
        body.querySelector(".bc-send").onclick = () => doSend(body, "clients", ui, {});
    }

    /* ---------- історія ---------- */
    const ST = { queued: "у черзі", sent: "надіслано", delivered: "доставлено", read: "прочитано", failed: "помилка", test: "тест", skipped: "пропущено" };
    async function history() {
        const body = shell("📣 Історія розсилок");
        body.innerHTML = `<div class="bc-empty">Завантажую…</div>`;
        const { data, error } = await client().from("broadcasts").select("*").order("created_at", { ascending: false }).limit(50);
        if (error) { body.innerHTML = `<div class="bc-empty">Історія ще недоступна: запустіть broadcasts.sql у Supabase. (${esc(error.message)})</div>`; return; }
        body.innerHTML = (data || []).length ? `<div class="bc-hist">${data.map((b) => `<button type="button" class="bc-hrow" data-open="${b.id}">
            <span class="bc-hk">${b.kind === "carriers" ? "🚚 Перевізникам" : "🤝 Клієнтам"}${b.test ? " · 🧪 тест" : ""}</span>
            <span class="bc-ht">${esc(String(b.text).split("\n")[0].slice(0, 90))}</span>
            <span class="bc-hn">${b.total} · ✓${b.sent}${b.failed ? ` · ✗${b.failed}` : ""}</span>
            <span class="bc-hd">${new Date(b.created_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}${b.staff_name ? ` · ${esc(b.staff_name)}` : ""}</span></button>`).join("")}</div>`
            : `<div class="bc-empty">Розсилок ще не було.</div>`;
        body.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => details(b.dataset.open)));
    }
    async function details(id) {
        const body = shell("📣 Розсилка — статуси");
        body.innerHTML = `<div class="bc-empty">Оновлюю статуси…</div>`;
        let r;
        try { r = await call({ action: "status", id }); } catch (e) { body.innerHTML = `<div class="bc-empty">${esc(e.message)}</div>`; return; }
        const recs = r.recipients || [];
        const cnt = (s) => recs.filter((x) => x.status === s).length;
        body.innerHTML = `<div class="bc-det-top"><button type="button" class="bc-btn-s" data-back>← Історія</button>
            <span>Усього ${recs.length} · надіслано ${cnt("sent")} · доставлено ${cnt("delivered")} · прочитано ${cnt("read")}${cnt("failed") ? ` · помилок ${cnt("failed")}` : ""}${cnt("test") ? ` · тест ${cnt("test")}` : ""}</span>
            <button type="button" class="bc-btn-s" data-re>↻ Оновити</button></div>
            <pre class="bc-pre">${esc(r.broadcast?.text || "")}</pre>
            <div class="bc-list bc-det">${recs.map((x) => `<div class="bc-row"><span class="bc-nm"><b>${esc(x.name || "—")}</b><small>${esc(x.error || "")}</small></span>
                <span class="bc-ph">${fmtPhone(x.phone)}</span><span class="bc-st-${esc(x.status)}">${esc(ST[x.status] || x.status)}</span>
                <button type="button" class="bc-opt" data-opt="${esc(x.phone)}" title="Людина попросила більше не надсилати — цей номер буде пропускатися в усіх розсилках">🚫</button></div>`).join("")}</div>`;
        body.querySelector("[data-back]").onclick = history;
        body.querySelector("[data-re]").onclick = () => details(id);
        body.querySelectorAll("[data-opt]").forEach((b) => (b.onclick = async () => {
            if (!confirm(`Більше НЕ надсилати розсилки на ${fmtPhone(b.dataset.opt)}?`)) return;
            try { await call({ action: "optout", phone: b.dataset.opt }); b.textContent = "✓"; b.disabled = true; } catch (e) { alert(e.message); }
        }));
    }

    window.furaBroadcast = {
        open(o = {}) { return o.kind === "clients" ? openClients() : openCarriers(o.request || {}); },
        history,
    };

    const css = document.createElement("style");
    css.textContent = `
    .bc-overlay { position: fixed; inset: 0; z-index: 2147482000; background: rgba(15, 23, 42, .45); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .bc-modal { width: min(1100px, 100%); max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: #fff; border-radius: 18px; box-shadow: 0 30px 80px rgba(15, 23, 42, .35); overflow: hidden; font-size: 14px; color: #1f2937; }
    .bc-head { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid #f1ece0; }
    .bc-head b { font-size: 16px; }
    .bc-mode { flex: 1; }
    .bc-test { background: #fef3c7; color: #92400e; border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 700; }
    .bc-live { background: #ede9fe; color: #5b21b6; border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 700; }
    .bc-tab-hist, .bc-btn-s { height: 32px; padding: 0 12px; border: 1px solid #e5e7eb; border-radius: 9px; background: #fff; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .bc-x { border: 0; background: none; font-size: 26px; line-height: 1; color: #6b7280; cursor: pointer; }
    .bc-body { overflow: auto; padding: 16px 18px; }
    .bc-grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 18px; min-height: 0; }
    .bc-col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .bc-filt { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .bc-chip { background: #fdf6e3; border: 1px solid #ecd9a8; border-radius: 999px; padding: 4px 10px; font-size: 13px; }
    .bc-chk { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: #374151; cursor: pointer; }
    .bc-add { position: relative; }
    .bc-find, .bc-q, .bc-sign { width: 100%; height: 36px; border: 1px solid #e5e7eb; border-radius: 10px; padding: 0 12px; font: inherit; font-size: 13.5px; box-sizing: border-box; }
    .bc-sugg { position: absolute; z-index: 5; left: 0; right: 0; top: 40px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 12px 30px rgba(15,23,42,.18); max-height: 280px; overflow: auto; }
    .bc-sugg[hidden] { display: none; }
    .bc-sugg button { display: block; width: 100%; text-align: left; border: 0; background: #fff; padding: 8px 12px; font: inherit; cursor: pointer; }
    .bc-sugg button:hover { background: #fdf9f0; }
    .bc-sugg small { color: #6b7280; }
    .bc-listbar { display: flex; align-items: center; gap: 6px; }
    .bc-listbar .bc-q { flex: 1; }
    .bc-listbar button { height: 32px; padding: 0 10px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; font: inherit; font-size: 12.5px; cursor: pointer; }
    .bc-count { font-size: 12.5px; color: #6b7280; white-space: nowrap; }
    .bc-list { border: 1px solid #eee5cf; border-radius: 12px; max-height: 46vh; overflow: auto; }
    .bc-row { display: grid; grid-template-columns: auto 1fr auto auto auto; gap: 10px; align-items: center; padding: 7px 12px; border-bottom: 1px solid #f6f1e4; cursor: pointer; }
    .bc-det .bc-row { grid-template-columns: 1fr auto auto auto; cursor: default; }
    .bc-row:last-child { border-bottom: 0; }
    .bc-row.nophone { opacity: .5; cursor: default; }
    .bc-nm { display: flex; flex-direction: column; min-width: 0; }
    .bc-nm b { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bc-nm small { color: #6b7280; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bc-ph { font-variant-numeric: tabular-nums; font-size: 12.5px; color: #374151; white-space: nowrap; }
    .bc-empty { padding: 18px; color: #6b7280; text-align: center; }
    .bc-lbl { font-size: 12.5px; font-weight: 700; color: #374151; }
    .bc-lbl small { font-weight: 400; color: #9ca3af; }
    .bc-text-wrap { display: flex; flex-direction: column; gap: 6px; }
    .bc-text { min-height: 260px; border: 1px solid #e5e7eb; border-radius: 12px; padding: 10px 12px; font: inherit; font-size: 14px; line-height: 1.5; resize: vertical; }
    .bc-len { font-size: 12px; color: #9ca3af; text-align: right; }
    .bc-len.over { color: #b42318; font-weight: 700; }
    .bc-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: auto; }
    .bc-muted { color: #6b7280; font-size: 12.5px; }
    .bc-btn { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 18px; border: 1px solid #7c3aed; border-radius: 11px; background: linear-gradient(180deg, #8b5cf6, #7c3aed); color: #fff; font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
    .bc-btn:disabled { opacity: .6; cursor: default; }
    .bc-done { text-align: center; padding: 30px 10px; }
    .bc-done-ico { font-size: 44px; }
    .bc-done .bad { color: #b42318; }
    .bc-hist { display: flex; flex-direction: column; gap: 6px; }
    .bc-hrow { display: grid; grid-template-columns: 160px 1fr auto 170px; gap: 10px; align-items: center; text-align: left; border: 1px solid #eee5cf; border-radius: 10px; background: #fffdf7; padding: 9px 12px; font: inherit; font-size: 13px; cursor: pointer; }
    .bc-hrow:hover { border-color: #d9a944; }
    .bc-ht { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #374151; }
    .bc-hn, .bc-hd { color: #6b7280; font-size: 12.5px; white-space: nowrap; }
    .bc-det-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
    .bc-det-top span { flex: 1; color: #374151; }
    .bc-pre { white-space: pre-wrap; background: #f9fafb; border-radius: 10px; padding: 10px 12px; font: inherit; font-size: 13px; color: #374151; margin: 0 0 10px; max-height: 160px; overflow: auto; }
    [class^="bc-st-"] { font-size: 12px; font-weight: 700; border-radius: 999px; padding: 2px 8px; background: #f3f4f6; color: #374151; white-space: nowrap; }
    .bc-st-delivered { background: #dcfce7; color: #166534; } .bc-st-read { background: #dbeafe; color: #1e40af; } .bc-st-failed { background: #fee2e2; color: #b42318; } .bc-st-test { background: #fef3c7; color: #92400e; }
    .bc-opt { border: 0; background: none; cursor: pointer; font-size: 14px; opacity: .55; }
    .bc-opt:hover { opacity: 1; }
    @media (max-width: 860px) { .bc-grid { grid-template-columns: 1fr; } .bc-hrow { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(css);
})();
