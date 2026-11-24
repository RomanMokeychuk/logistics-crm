/* ================================================================= *
 * FURA — ✨ ПОМІЧНИК ТЕКСТУ                                           *
 * У полях, де людина пише повідомлення (пошта, чат із Sales, Viber,   *
 * нотатки до запиту/відповіді), з'являється кнопка «✨».               *
 * Вона:                                                              *
 *   • виправляє помилки (без зміни змісту)                           *
 *   • пропонує 3 варіанти: простий · напівофіційний · офіційний       *
 *   • якщо поле порожнє — пропонує відповідь на останнє повідомлення  *
 * Працює через функцію fura-assistant (action: "write").             *
 * ================================================================= */
(function () {
    if (window.furaAiWriter) return;
    window.furaAiWriter = true;

    // Де вмикаємо: поля для листів і повідомлень людям
    const TARGETS = [
        ["form textarea[name=body]", "лист електронною поштою"],
        ["#reqChatText", "чат по запиту між логістом і Sales"],
        ["#cmReplyText", "відповідь клієнту у Viber"],
        ["#replyText", "відповідь клієнту"],
        ['textarea[id^="draft-"]', "лист клієнту"],
        ["#refusalComment", "коментар Sales про відмову клієнта"],
        ["#ans_notes", "нотатки логіста до прорахунку для Sales"],
        ["#req_notes", "нотатки Sales до запиту для логіста"],
        ["#historyText", "запис про розмову з клієнтом"],
        [".pa-in", "відповідь у кабінеті клієнта/перевізника"],
        ["#frText", "повідомлення"],
        ["[data-ai-write]", "повідомлення"],
    ];
    const where = (ta) => (TARGETS.find(([sel]) => ta.matches(sel)) || [])[1];

    // Попередня розмова — щоб варіанти були саме відповіддю
    function contextOf(ta) {
        const cut = (s, n = 3000) => String(s || "").replace(/\n{3,}/g, "\n\n").trim().slice(-n);
        if (ta.matches("form textarea[name=body]")) {
            const f = ta.form;
            const subj = f?.subject?.value ? `Тема: ${f.subject.value}\n` : "";
            const q = f?.querySelector(".sa-cmp-qtext")?.textContent || "";
            return cut(subj + q);
        }
        if (ta.id === "reqChatText") return cut(document.getElementById("reqChatList")?.innerText);
        if (ta.id === "cmReplyText") return cut(document.getElementById("cmMsgs")?.innerText);
        const host = ta.closest("[data-ai-context]");
        return host ? cut(host.dataset.aiContext || host.innerText) : "";
    }

    const client = () => (typeof sbClient !== "undefined" ? sbClient : window.sbClient || window.supabaseClient || null);
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const LANGS = [["auto", "Мова як у тексті"], ["українська", "Українська"], ["англійська", "English"], ["польська", "Polski"], ["російська", "Русский"]];
    let lang = "auto";
    try { lang = localStorage.getItem("fura_aiw_lang") || "auto"; } catch (e) { /* без пам'яті */ }

    /* ---------- кнопка ✨ біля активного поля ---------- */
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "aiw-btn";
    btn.innerHTML = "✨";
    btn.title = "Помічник тексту: виправити помилки і 3 варіанти (простий / напівофіційний / офіційний)";
    btn.hidden = true;
    let cur = null; // поле, біля якого кнопка
    let hideT = 0;

    function place() {
        if (!cur || !cur.isConnected) { btn.hidden = true; return; }
        const r = cur.getBoundingClientRect();
        if (!r.width || !r.height) { btn.hidden = true; return; }
        btn.hidden = false;
        btn.style.top = `${Math.max(4, r.bottom - 30)}px`;
        btn.style.left = `${Math.min(innerWidth - 34, r.right - 32)}px`;
    }
    function attachTo(ta) {
        clearTimeout(hideT);
        cur = ta;
        if (!btn.isConnected) document.body.appendChild(btn);
        place();
    }
    document.addEventListener("focusin", (e) => {
        const ta = e.target;
        if (ta instanceof HTMLTextAreaElement && !ta.readOnly && !ta.disabled && where(ta)) attachTo(ta);
    });
    document.addEventListener("focusout", (e) => {
        if (e.target !== cur) return;
        hideT = setTimeout(() => { if (!pop && document.activeElement !== cur) btn.hidden = true; }, 250);
    });
    addEventListener("scroll", () => { place(); placePop(); }, true);
    addEventListener("resize", () => { place(); placePop(); });
    document.addEventListener("input", (e) => { if (e.target === cur) place(); });
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // не забирати фокус з поля
    btn.addEventListener("click", () => (pop ? closePop() : openPop(cur)));

    /* ---------- вікно з варіантами ---------- */
    let pop = null, target = null;
    function placePop() {
        if (!pop || !target?.isConnected) return;
        const r = target.getBoundingClientRect();
        const w = Math.min(520, innerWidth - 16);
        pop.style.width = `${w}px`;
        const h = pop.offsetHeight;
        let top = r.top - h - 8;
        if (top < 8) top = Math.min(innerHeight - h - 8, r.bottom + 8);
        pop.style.top = `${Math.max(8, top)}px`;
        pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
    }
    function closePop() { pop?.remove(); pop = null; }

    function openPop(ta) {
        if (!ta) return;
        closePop();
        target = ta;
        const empty = !ta.value.trim();
        const ctx = contextOf(ta);
        pop = document.createElement("div");
        pop.className = "aiw-pop";
        pop.innerHTML = `<div class="aiw-head"><b>✨ Помічник тексту</b>
                <select class="aiw-lang" title="Мова варіантів">${LANGS.map(([v, t]) => `<option value="${v}" ${v === lang ? "selected" : ""}>${t}</option>`).join("")}</select>
                <button type="button" class="aiw-x" title="Закрити">&times;</button></div>
            <div class="aiw-body">${empty && !ctx
                ? `<div class="aiw-note">Напишіть кілька слів у полі — помічник виправить помилки і запропонує 3 варіанти тексту.</div>`
                : `<div class="aiw-load">${empty ? "Готую варіанти відповіді…" : "Виправляю і готую 3 варіанти…"}</div>`}</div>`;
        document.body.appendChild(pop);
        placePop();
        pop.addEventListener("mousedown", (e) => { if (!e.target.closest("select")) e.preventDefault(); });
        pop.querySelector(".aiw-x").onclick = closePop;
        pop.querySelector(".aiw-lang").onchange = (e) => {
            lang = e.target.value;
            try { localStorage.setItem("fura_aiw_lang", lang); } catch (err) { /* без пам'яті */ }
            run(ta);
        };
        if (!empty || ctx) run(ta);
    }

    let seq = 0;
    async function run(ta) {
        const my = ++seq;
        const box = pop?.querySelector(".aiw-body");
        if (!box) return;
        const empty = !ta.value.trim();
        box.innerHTML = `<div class="aiw-load">${empty ? "Готую варіанти відповіді…" : "Виправляю і готую 3 варіанти…"}</div>`;
        placePop();
        let res;
        try {
            const c = client();
            if (!c) throw new Error("Немає з'єднання з FURA. Оновіть сторінку.");
            const { data, error } = await c.functions.invoke("fura-assistant", {
                body: { action: "write", text: ta.value, context: contextOf(ta), where: where(ta), lang },
            });
            if (error) {
                let msg = "Помічник тексту не відповів. Перевірте, чи розгорнута функція fura-assistant.";
                try { const j = await error.context?.json(); if (j?.error) msg = j.error; } catch (_) { /* */ }
                throw new Error(msg);
            }
            res = data || {};
        } catch (e) {
            if (my !== seq || !pop) return;
            box.innerHTML = `<div class="aiw-err">${esc(e.message)}</div><button type="button" class="aiw-retry">Спробувати ще раз</button>`;
            box.querySelector(".aiw-retry").onclick = () => run(ta);
            placePop();
            return;
        }
        if (my !== seq || !pop) return;
        const items = [
            ["fixed", "✔ Виправлено", "Ваш текст без помилок"],
            ["simple", "Простий", "як у звичайній переписці"],
            ["semi", "Напівофіційний", "ввічливо, по-діловому"],
            ["formal", "Офіційний", "для листування з клієнтами"],
        ].filter(([k]) => res[k] && !(k === "fixed" && res.fixed.trim() === ta.value.trim()));
        const same = res.fixed && res.fixed.trim() === ta.value.trim();
        box.innerHTML = (same ? `<div class="aiw-ok">✔ Помилок не знайдено.</div>` : "") +
            items.map(([k, t, sub]) => `<div class="aiw-card" data-k="${k}">
                <div class="aiw-ct"><b>${t}</b><span>${sub}</span></div>
                <div class="aiw-text">${esc(res[k]).replace(/\n/g, "<br>")}</div>
                <div class="aiw-acts"><button type="button" class="aiw-use" data-use="${k}">Вставити</button><button type="button" class="aiw-copy" data-copy="${k}">Копіювати</button></div>
            </div>`).join("") +
            `<button type="button" class="aiw-retry">↻ Інші варіанти</button>`;
        box.querySelector(".aiw-retry").onclick = () => run(ta);
        box.addEventListener("click", async (e) => {
            const u = e.target.closest("[data-use]")?.dataset.use;
            const c = e.target.closest("[data-copy]")?.dataset.copy;
            if (u) {
                ta.value = res[u];
                ta.dispatchEvent(new Event("input", { bubbles: true }));
                ta.dispatchEvent(new Event("change", { bubbles: true }));
                closePop();
                ta.focus();
            }
            if (c) {
                try { await navigator.clipboard.writeText(res[c]); e.target.textContent = "Скопійовано ✓"; } catch (err) { /* */ }
            }
        });
        placePop();
    }
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop) closePop(); });
    document.addEventListener("mousedown", (e) => { if (pop && !pop.contains(e.target) && e.target !== btn && e.target !== target) closePop(); });

    const css = document.createElement("style");
    css.textContent = `
    .aiw-btn { position: fixed; z-index: 2147483600; width: 28px; height: 26px; border: 1px solid #ecd9a8; border-radius: 8px; background: linear-gradient(180deg, #fff8e6, #f6e3b0); font-size: 14px; line-height: 1; cursor: pointer; box-shadow: 0 2px 8px rgba(120, 90, 20, .18); padding: 0; }
    .aiw-btn:hover { background: linear-gradient(180deg, #f2d27f, #d9a944); }
    .aiw-btn[hidden] { display: none; }
    .aiw-pop { position: fixed; z-index: 2147483601; max-height: min(70vh, 640px); display: flex; flex-direction: column; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 18px 50px rgba(15, 23, 42, .25); font-size: 13.5px; color: #1f2937; }
    .aiw-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #f1f1f1; }
    .aiw-head b { flex: 1; font-size: 14px; }
    .aiw-lang { height: 28px; border: 1px solid #e5e7eb; border-radius: 8px; font: inherit; font-size: 12.5px; padding: 0 6px; background: #fff; }
    .aiw-x { border: 0; background: none; font-size: 20px; line-height: 1; cursor: pointer; color: #6b7280; }
    .aiw-body { padding: 10px 12px 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
    .aiw-load { color: #6b7280; padding: 14px 4px; }
    .aiw-load::before { content: ""; display: inline-block; width: 12px; height: 12px; margin-right: 8px; border: 2px solid #d9a944; border-right-color: transparent; border-radius: 50%; vertical-align: -2px; animation: aiwspin .8s linear infinite; }
    @keyframes aiwspin { to { transform: rotate(360deg); } }
    .aiw-err { background: #fef2f2; color: #b42318; border-radius: 10px; padding: 10px 12px; }
    .aiw-note, .aiw-ok { color: #4b5563; padding: 4px 2px; }
    .aiw-ok { color: #047857; font-weight: 600; }
    .aiw-card { border: 1px solid #eee5cf; border-radius: 12px; padding: 9px 11px; background: #fffdf7; }
    .aiw-card[data-k="fixed"] { background: #f0fdf4; border-color: #bbf7d0; }
    .aiw-ct { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
    .aiw-ct span { color: #9ca3af; font-size: 12px; }
    .aiw-text { white-space: normal; line-height: 1.45; }
    .aiw-acts { display: flex; gap: 6px; margin-top: 8px; }
    .aiw-acts button, .aiw-retry { height: 28px; padding: 0 12px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; font: inherit; font-size: 12.5px; cursor: pointer; }
    .aiw-use { background: linear-gradient(180deg, #f2d27f, #d9a944) !important; border-color: #d9a944 !important; font-weight: 700; color: #2b1d06; }
    .aiw-retry { align-self: flex-start; }
    `;
    document.head.appendChild(css);
})();
