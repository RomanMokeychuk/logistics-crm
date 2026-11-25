/* ================================================================= *
 * FURA — 📊 АКТИВНІСТЬ КОЛЕГ З ПЕРЕВІЗНИКАМИ                           *
 * Хто скільки додав / відредагував / пробив через Lardi.             *
 * Бачать лише керівник і адмін (head / admin) — і кнопку, і значки   *
 * «✓ пробито», і самі дані (обмеження в базі: carrier_activity.sql). *
 * Сторінки: «Перевізники» і «Черга».                                 *
 * ================================================================= */
(function () {
    if (window.furaActivity) return;
    window.furaActivity = true;
    const client = () => (typeof sbClient !== "undefined" ? sbClient : null); // eslint-disable-line no-undef
    if (!client()) return;
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const root = document.documentElement;
    const KEY = "fura_is_boss";

    // Значки «✓ пробито» і смужка «Пробиті» — лише для керівника (до перевірки — сховані)
    const css = document.createElement("style");
    css.textContent = `
    html:not(.fura-boss) .eq-chk, html:not(.fura-boss) #eqChkBar, html:not(.fura-boss) .cg-chk, html:not(.fura-boss) .sa-act-btn { display: none !important; }
    .sa-act-btn { display: inline-flex; align-items: center; gap: 6px; }
    .sa-act-ov[hidden] { display: none !important; }
    .sa-act-ov { position: fixed; inset: 0; z-index: 9000; background: rgba(15, 23, 42, .45); display: flex; align-items: flex-start; justify-content: center; padding: 5vh 16px; overflow: auto; }
    .sa-act { width: min(980px, 100%); background: #fff; border-radius: 18px; box-shadow: 0 24px 60px rgba(15, 23, 42, .3); padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; font-size: 14px; }
    .sa-act-h { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .sa-act-h h2 { margin: 0; font-size: 19px; flex: 1; }
    .sa-act-x { border: 0; background: #f3f4f6; width: 34px; height: 34px; border-radius: 10px; font-size: 18px; cursor: pointer; }
    .sa-act-per { display: flex; gap: 6px; flex-wrap: wrap; }
    .sa-act-per button, .sa-act-f button { border: 1px solid #e5e7eb; background: #fff; border-radius: 999px; padding: 5px 12px; font: inherit; font-size: 13px; cursor: pointer; }
    .sa-act-per button.on, .sa-act-f button.on { background: #fdf3d8; border-color: #d9a944; font-weight: 700; }
    .sa-act-tbl { width: 100%; border-collapse: collapse; }
    .sa-act-tbl th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #9ca3af; padding: 6px 10px; border-bottom: 1px solid #f1ede3; }
    .sa-act-tbl td { padding: 8px 10px; border-bottom: 1px solid #f6f3ec; }
    .sa-act-tbl td.n { text-align: center; width: 120px; }
    .sa-act-tbl td.n button { min-width: 44px; border: 1px solid transparent; background: #f8fafc; border-radius: 8px; padding: 4px 10px; font: inherit; font-weight: 700; cursor: pointer; }
    .sa-act-tbl td.n button:hover { border-color: #d9a944; background: #fffaeb; }
    .sa-act-tbl td.n button.on { background: #fdf3d8; border-color: #d9a944; }
    .sa-act-tbl td.n .z { color: #d1d5db; }
    .sa-act-tbl tr.me td:first-child { font-weight: 700; }
    .sa-act-sub { font-weight: 700; font-size: 15px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .sa-act-list { display: flex; flex-direction: column; border: 1px solid #f1ede3; border-radius: 12px; max-height: 46vh; overflow: auto; }
    .sa-act-it { display: grid; grid-template-columns: 1fr 120px 120px 130px; gap: 10px; align-items: center; padding: 8px 12px; border-bottom: 1px solid #f6f3ec; font-size: 13px; }
    .sa-act-it:last-child { border-bottom: 0; }
    .sa-act-it a { color: #8a5f12; font-weight: 700; text-decoration: none; }
    .sa-act-it a:hover { text-decoration: underline; }
    .sa-act-it small { color: #9ca3af; }
    .sa-act-tag { justify-self: start; border-radius: 999px; padding: 2px 9px; font-size: 12px; font-weight: 700; }
    .sa-act-tag.add { background: #e0f2fe; color: #0369a1; } .sa-act-tag.edit { background: #fef3c7; color: #92400e; } .sa-act-tag.lardi { background: #dcfce7; color: #15803d; }
    .sa-act-empty { padding: 24px; text-align: center; color: #9ca3af; }
    .sa-act-hint { margin: 0; font-size: 12px; color: #9ca3af; }
    @media (max-width: 760px) { .sa-act { padding: 14px; } .sa-act-it { grid-template-columns: 1fr auto; } .sa-act-it .w, .sa-act-it .e { display: none; } .sa-act-tbl td.n { width: auto; } }
    `;
    document.head.appendChild(css);
    try { if (sessionStorage.getItem(KEY) === "1") root.classList.add("fura-boss"); } catch (_) { /* */ }

    let ME = "";
    (async () => {
        try {
            const { data: s } = await client().auth.getSession();
            const email = (s?.session?.user?.email || "").toLowerCase();
            const { data } = await client().from("staff").select("full_name, role, roles").ilike("email", email).limit(1);
            const me = data?.[0];
            ME = me?.full_name || "";
            const boss = !!me && (/(^|[^a-z_])(head|admin)([^a-z_]|$)/.test(JSON.stringify(me.roles || "")) || ["head", "admin"].includes(me.role));
            root.classList.toggle("fura-boss", boss);
            try { sessionStorage.setItem(KEY, boss ? "1" : "0"); } catch (_) { /* */ }
            if (boss) mountBtn();
        } catch (_) { /* */ }
    })();

    function mountBtn() {
        if (window.top !== window.self || document.querySelector(".sa-act-btn")) return; // картка у вікні — без кнопки
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-secondary sa-act-btn";
        b.title = "Хто з колег скільки додав, відредагував і пробив перевізників (бачите лише ви)";
        b.innerHTML = "📊 Активність колег";
        b.addEventListener("click", () => openPanel());
        const add = document.getElementById("openModalBtn"); // «Перевізники»
        const eq = document.getElementById("eqFiltersToggle"); // «Черга»
        if (add) add.before(b);
        else if (eq) { b.classList.add("eq-filters-toggle"); eq.after(b); }
        else return;
    }

    const PERIODS = [["today", "Сьогодні"], ["yday", "Вчора"], ["7", "7 днів"], ["30", "30 днів"], ["all", "Усе"]];
    const ACT = { add: ["Додав", "add"], edit: ["Відредагував", "edit"], lardi: ["Пробив Lardi", "lardi"] };
    const S = { per: "today", who: "", act: "", rows: [] };
    let ov = null;

    function range(per) {
        const d0 = new Date(); d0.setHours(0, 0, 0, 0);
        if (per === "today") return [d0, null];
        if (per === "yday") return [new Date(+d0 - 86400e3), d0];
        if (per === "7") return [new Date(+d0 - 6 * 86400e3), null];
        if (per === "30") return [new Date(+d0 - 29 * 86400e3), null];
        return [null, null];
    }
    async function load() {
        const [from, to] = range(S.per);
        const all = [];
        for (let page = 0; page < 10; page++) {
            let q = client().from("carrier_activity").select("carrier_id, carrier_name, edrpou, action, by_name, by_email, at").order("at", { ascending: false }).range(page * 1000, page * 1000 + 999);
            if (from) q = q.gte("at", from.toISOString());
            if (to) q = q.lt("at", to.toISOString());
            const { data, error } = await q;
            if (error) throw new Error(/carrier_activity|does not exist|schema cache/.test(error.message) ? "Один раз запустіть carrier_activity.sql у Supabase → SQL Editor." : error.message);
            all.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
        S.rows = all;
    }
    const who = (r) => r.by_name || r.by_email || "—";
    const fmt = (d) => new Date(d).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

    function paint() {
        const box = ov.querySelector(".sa-act-body");
        // зведення: людина × дія (унікальні перевізники)
        const sum = new Map();
        for (const r of S.rows) {
            const k = who(r);
            const m = sum.get(k) || sum.set(k, { add: new Set(), edit: new Set(), lardi: new Set(), all: new Set() }).get(k);
            (m[r.action] || m.edit).add(r.carrier_id);
            m.all.add(r.carrier_id);
        }
        const people = [...sum.entries()].sort((a, b) => b[1].all.size - a[1].all.size);
        const cell = (k, a, n) => `<td class="n">${n ? `<button type="button" data-who="${esc(k)}" data-act="${a}" class="${S.who === k && S.act === a ? "on" : ""}">${n}</button>` : '<span class="z">0</span>'}</td>`;
        const tbl = people.length ? `<table class="sa-act-tbl"><thead><tr><th>Хто</th><th style="text-align:center">➕ Додав</th><th style="text-align:center">✏️ Відредагував</th><th style="text-align:center">✓ Пробив Lardi</th><th style="text-align:center">Усього перевізників</th></tr></thead><tbody>
            ${people.map(([k, m]) => `<tr class="${k === ME ? "me" : ""}"><td>${k === ME ? "👤 " : ""}${esc(k)}</td>${cell(k, "add", m.add.size)}${cell(k, "edit", m.edit.size)}${cell(k, "lardi", m.lardi.size)}${cell(k, "", m.all.size)}</tr>`).join("")}</tbody></table>`
            : `<div class="sa-act-empty">За цей період ніхто нічого не додавав і не редагував.</div>`;
        // список: обрана людина / дія, або всі останні дії
        let list = S.rows.filter((r) => (!S.who || who(r) === S.who) && (!S.act || r.action === S.act));
        // один рядок на перевізника + дію (останній раз)
        const seen = new Set();
        list = list.filter((r) => { const k = r.carrier_id + "|" + r.action + "|" + who(r); if (seen.has(k)) return false; seen.add(k); return true; });
        const title = S.who ? `${esc(S.who)}${S.act ? " · " + ACT[S.act][0] : " · усі дії"} — ${list.length}` : `Останні дії — ${list.length}`;
        const items = list.slice(0, 500).map((r) => `<div class="sa-act-it">
                <span><a href="carriers.html?open=${encodeURIComponent(r.carrier_id)}" data-carrier-card="${esc(r.carrier_id)}" title="Відкрити картку перевізника">${esc(r.carrier_name || "перевізник")}</a> <small>${esc(r.edrpou || "")}</small></span>
                <span class="sa-act-tag ${esc((ACT[r.action] || ACT.edit)[1])}">${esc((ACT[r.action] || ACT.edit)[0])}</span>
                <span class="w">${esc(who(r))}</span>
                <span class="e"><small>${esc(fmt(r.at))}</small></span>
            </div>`).join("");
        box.innerHTML = tbl + `<div class="sa-act-sub">${title}${S.who ? ' <button type="button" class="btn btn-secondary" data-who="" data-act="">✕ показати всіх</button>' : ""}</div>
            <div class="sa-act-list">${items || '<div class="sa-act-empty">Нічого</div>'}</div>
            <p class="sa-act-hint">Натисніть на число — побачите, яких саме перевізників. Натисніть на перевізника — відкриється його картка. Рахуються дії людей на сайті з моменту запуску carrier_activity.sql; автоматичний нічний обхід Lardi не рахується.</p>`;
    }
    async function refresh() {
        const box = ov.querySelector(".sa-act-body");
        ov.querySelectorAll(".sa-act-per button").forEach((b) => b.classList.toggle("on", b.dataset.per === S.per));
        box.innerHTML = '<div class="sa-act-empty">Завантажую…</div>';
        try { await load(); paint(); } catch (e) { box.innerHTML = `<div class="sa-act-empty">${esc(e.message)}</div>`; }
    }
    function openPanel() {
        if (!ov) {
            ov = document.createElement("div");
            ov.className = "sa-act-ov";
            ov.innerHTML = `<div class="sa-act" role="dialog"><div class="sa-act-h"><h2>📊 Активність колег з перевізниками</h2>
                <div class="sa-act-per">${PERIODS.map(([k, t]) => `<button type="button" data-per="${k}">${t}</button>`).join("")}</div>
                <button type="button" class="sa-act-x" data-close title="Закрити">✕</button></div><div class="sa-act-body"></div></div>`;
            document.body.appendChild(ov);
            ov.addEventListener("click", (e) => {
                if (e.target === ov || e.target.closest("[data-close]")) return (ov.hidden = true);
                const p = e.target.closest("[data-per]");
                if (p) { S.per = p.dataset.per; S.who = ""; S.act = ""; return refresh(); }
                const w = e.target.closest("[data-who]");
                if (w) {
                    const same = S.who === w.dataset.who && S.act === w.dataset.act;
                    S.who = same ? "" : w.dataset.who; S.act = same ? "" : w.dataset.act;
                    return paint();
                }
                // відкрили картку перевізника — ховаємо вікно, щоб було видно картку
                if (e.target.closest("[data-carrier-card]")) ov.hidden = true;
            });
            document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ov && !ov.hidden) ov.hidden = true; });
        }
        ov.hidden = false;
        refresh();
    }
    window.furaActivityOpen = openPanel;
})();
