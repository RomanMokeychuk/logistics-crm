/* ================================================================= *
 * FURA — ФІЛЬТРИ КОЛОНОК І ВИГЛЯД «РЯДКАМИ / КВАДРАТИКАМИ»            *
 * для таблиць, які малюються цілком (Ліди, Клієнти).                  *
 *                                                                    *
 *  furaColFilters(table, { cols: [1, 2, ...] })                      *
 *     — значок-фільтр у заголовку колонки: галочками обрати значення *
 *  furaViewToggle(host, area, key)                                    *
 *     — перемикач ☰ / ▦ (пам'ятається)                                *
 * ================================================================= */
(function () {
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const EMPTY = "— (порожньо)";

    // Значення клітинки: окремі «бейджі», якщо є, інакше перший рядок тексту
    function tokens(td) {
        if (!td) return [EMPTY];
        const parts = [...td.querySelectorAll('.badge, [class*="badge"], [class*="chip"], [class*="-tag"]')]
            .filter((el) => !el.querySelector('.badge, [class*="badge"], [class*="chip"]'))
            .map((el) => el.textContent.replace(/\s+/g, " ").trim())
            .filter(Boolean);
        if (parts.length) return [...new Set(parts)];
        const first = (td.innerText || td.textContent || "").split("\n").map((x) => x.trim()).find(Boolean) || "";
        return [first && first !== "—" ? first : EMPTY];
    }

    const all = []; // усі підключені таблиці — для «Скинути фільтри»

    window.furaColFilters = function (table, opt = {}) {
        if (!table || table.dataset.ffOn) return;
        table.dataset.ffOn = "1";
        const tbody = table.tBodies[0];
        const state = new Map(); // колонка → Set дозволених значень
        let pop = null;
        const api = { reset() { state.clear(); apply(); paintIcons(); }, active: () => state.size > 0 };
        all.push(api);

        const ths = [...table.tHead.rows[0].cells];
        (opt.cols || []).forEach((ci) => {
            const th = ths[ci];
            if (!th || th.querySelector(".ff-icon")) return;
            const ic = document.createElement("i");
            ic.className = "bx bx-filter-alt filter-icon ff-icon";
            ic.title = "Фільтр по колонці";
            ic.dataset.ffCol = ci;
            const host = th.querySelector(".th-label") ? th : th;
            host.appendChild(ic);
            th.classList.add("ff-th");
        });

        function rows() { return [...tbody.rows].filter((tr) => tr.cells.length > 1); }
        function apply() {
            let shown = 0, total = 0;
            rows().forEach((tr) => {
                total++;
                const ok = [...state].every(([ci, set]) => tokens(tr.cells[ci]).some((t) => set.has(t)));
                tr.classList.toggle("ff-hidden", !ok);
                if (ok) shown++;
            });
            let note = table.closest(".table-card")?.parentNode.querySelector(".ff-note");
            if (state.size) {
                if (!note) {
                    note = document.createElement("div");
                    note.className = "ff-note";
                    table.closest(".table-card")?.after(note);
                }
                note.innerHTML = `Фільтр по колонках: показано <b>${shown}</b> з ${total} <button type="button" class="ff-clear">✕ зняти</button>`;
                note.querySelector(".ff-clear").onclick = api.reset;
            } else note?.remove();
        }
        function paintIcons() {
            table.querySelectorAll(".ff-icon").forEach((ic) => ic.classList.toggle("filter-active", state.has(Number(ic.dataset.ffCol))));
        }
        // таблиця перемальовується (пошук, нові дані) — застосовуємо фільтр знову
        let t = 0;
        new MutationObserver(() => { clearTimeout(t); t = setTimeout(apply, 30); }).observe(tbody, { childList: true });

        function close() { pop?.remove(); pop = null; }
        function open(ic) {
            close();
            const ci = Number(ic.dataset.ffCol);
            const counts = new Map();
            rows().forEach((tr) => tokens(tr.cells[ci]).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1)));
            const vals = [...counts.keys()].sort((a, b) => (a === EMPTY) - (b === EMPTY) || a.localeCompare(b, "uk"));
            const cur = state.get(ci);
            pop = document.createElement("div");
            pop.className = "ff-pop";
            pop.innerHTML = `<input type="search" class="ff-q" placeholder="Пошук…">
                <div class="ff-acts"><button type="button" data-ff="all">Усі</button><button type="button" data-ff="none">Зняти всі</button></div>
                <div class="ff-list">${vals.map((v) => `<label class="ff-opt"><input type="checkbox" value="${esc(v)}" ${!cur || cur.has(v) ? "checked" : ""}><span>${esc(v)}</span><em>${counts.get(v)}</em></label>`).join("") || '<div class="ff-empty">Немає значень</div>'}</div>
                <div class="ff-foot"><button type="button" data-ff="cancel">Скасувати</button><button type="button" data-ff="ok" class="ff-ok">Застосувати</button></div>`;
            document.body.appendChild(pop);
            const r = ic.getBoundingClientRect();
            pop.style.top = `${Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8)}px`;
            pop.style.left = `${Math.max(8, Math.min(r.left - 20, innerWidth - pop.offsetWidth - 8))}px`;
            const q = pop.querySelector(".ff-q");
            q.focus();
            q.addEventListener("input", () => {
                const s = norm(q.value);
                pop.querySelectorAll(".ff-opt").forEach((l) => (l.hidden = !!s && !norm(l.textContent).includes(s)));
            });
            pop.addEventListener("click", (e) => {
                const a = e.target.closest("[data-ff]")?.dataset.ff;
                if (!a) return;
                const boxes = [...pop.querySelectorAll(".ff-opt:not([hidden]) input")];
                if (a === "all") boxes.forEach((b) => (b.checked = true));
                if (a === "none") boxes.forEach((b) => (b.checked = false));
                if (a === "cancel") close();
                if (a === "ok") {
                    const on = [...pop.querySelectorAll(".ff-opt input")].filter((b) => b.checked).map((b) => b.value);
                    if (on.length === vals.length) state.delete(ci); else state.set(ci, new Set(on));
                    close();
                    apply();
                    paintIcons();
                }
            });
        }
        table.tHead.addEventListener("click", (e) => {
            const ic = e.target.closest(".ff-icon");
            if (!ic) return;
            e.stopPropagation();
            e.preventDefault();
            if (pop && pop.dataset.col === ic.dataset.ffCol) return close();
            open(ic);
            pop.dataset.col = ic.dataset.ffCol;
        }, true);
        document.addEventListener("mousedown", (e) => { if (pop && !pop.contains(e.target) && !e.target.closest(".ff-icon")) close(); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
        apply();
    };
    window.furaColFiltersReset = () => all.forEach((a) => a.reset());
    window.furaColFiltersActive = () => all.some((a) => a.active());

    window.furaViewToggle = function (host, area, key, opt = {}) {
        if (!host || !area || host.querySelector(".fura-view")) return;
        const sw = document.createElement("span");
        sw.className = "fura-view";
        sw.title = "Як показувати список";
        sw.innerHTML = `<button type="button" data-view="rows" title="Рядками (таблиця)"><i class="bx bx-list-ul"></i></button><button type="button" data-view="tiles" title="Квадратиками (картки)"><i class="bx bx-grid-alt"></i></button>`;
        if (opt.before) host.insertBefore(sw, opt.before); else host.appendChild(sw);
        const get = () => { try { return localStorage.getItem(key) === "tiles" ? "tiles" : "rows"; } catch (e) { return "rows"; } };
        const apply = (v) => {
            area.classList.toggle("fura-tiles", v === "tiles");
            if (opt.titleCol != null) area.dataset.titleCol = opt.titleCol;
            sw.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
        };
        sw.addEventListener("click", (e) => {
            const v = e.target.closest("[data-view]")?.dataset.view;
            if (!v) return;
            try { localStorage.setItem(key, v); } catch (err) { /* без пам'яті */ }
            apply(v);
            area.scrollTop = 0;
        });
        apply(get());
    };

    const css = document.createElement("style");
    css.textContent = `
    .ff-hidden { display: none !important; }
    .ff-th .ff-icon { margin-left: 4px; vertical-align: middle; }
    .ff-icon.filter-active { background: #10b981; color: #fff !important; }
    .ff-note { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; font-size: 13px; color: #6b7280; }
    .ff-note .ff-clear { border: 0; background: none; color: #b42318; font: inherit; font-weight: 600; cursor: pointer; }
    .ff-pop { position: fixed; z-index: 3000; width: 280px; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 18px 50px rgba(15, 23, 42, .22); padding: 10px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
    .ff-q { height: 34px; padding: 0 10px; border: 1px solid #e5e7eb; border-radius: 9px; font: inherit; }
    .ff-q:focus { outline: none; border-color: #d9a944; }
    .ff-acts, .ff-foot { display: flex; gap: 6px; }
    .ff-foot { justify-content: flex-end; }
    .ff-pop button { height: 30px; padding: 0 10px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; font: inherit; font-size: 12.5px; cursor: pointer; }
    .ff-pop .ff-ok { background: linear-gradient(180deg, #f2d27f, #d9a944); border-color: #d9a944; font-weight: 700; color: #2b1d06; }
    .ff-list { max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; }
    .ff-opt { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; padding: 5px 4px; border-radius: 7px; cursor: pointer; }
    .ff-opt:hover { background: #fdf9f0; }
    .ff-opt[hidden] { display: none; }
    .ff-opt em { font-style: normal; color: #9ca3af; font-size: 11.5px; }
    .ff-empty { color: #9ca3af; padding: 6px; }
    `;
    document.head.appendChild(css);
})();
