/* ================================================================= *
 * FURA — КЕРУВАННЯ КОЛОНКАМИ ТАБЛИЦІ                                  *
 * • потягніть межу заголовка — колонка стане ширшою / вужчою           *
 * • ✕ у заголовку — сховати колонку                                   *
 * • кнопка «Колонки» над таблицею — повернути сховані, скинути ширину  *
 * Налаштування запам'ятовуються в цьому браузері.                     *
 * ================================================================= */

(function () {
    const store = {
        get(k) {
            try {
                return JSON.parse(localStorage.getItem(k) || "null");
            } catch {
                return null;
            }
        },
        set(k, v) {
            try {
                localStorage.setItem(k, JSON.stringify(v));
            } catch {
                /* без пам'яті — просто не запам'ятаємо */
            }
        },
    };

    const css = document.createElement("style");
    css.textContent = `
        .fura-cols th { position: relative; }
        .fura-col-resize {
            position: absolute; top: 0; right: -4px; width: 9px; height: 100%;
            cursor: col-resize; z-index: 3;
        }
        .fura-col-resize::after {
            content: ""; position: absolute; top: 25%; bottom: 25%; left: 4px; width: 2px;
            border-radius: 2px; background: transparent; transition: background .15s;
        }
        .fura-cols th:hover .fura-col-resize::after,
        .fura-col-resize.dragging::after { background: #2563eb; }
        .fura-col-hide {
            position: absolute; top: 3px; right: 8px; display: none;
            width: 18px; height: 18px; border: none; border-radius: 50%;
            background: #e2e8f0; color: #475569; font-size: 12px; line-height: 18px;
            text-align: center; cursor: pointer; padding: 0; z-index: 4;
        }
        .fura-col-hide:hover { background: #fee2e2; color: #dc2626; }
        .fura-cols th:hover .fura-col-hide { display: block; }
        .fura-cols.fura-sized td { overflow-wrap: anywhere; }
        .fura-cols-bar { display: flex; justify-content: flex-end; margin: 0 0 8px; position: relative; }
        .fura-cols-btn {
            display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
            border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #334155;
            font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
        }
        .fura-cols-btn:hover { border-color: #2563eb; color: #1d4ed8; }
        .fura-cols-btn .fura-cols-count { background: #fee2e2; color: #b91c1c; border-radius: 999px; padding: 0 7px; font-size: 12px; }
        .fura-cols-menu {
            position: absolute; top: 36px; right: 0; z-index: 2000; min-width: 240px; max-height: 360px; overflow: auto;
            background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 10px 28px rgba(15,23,42,.15); padding: 8px;
        }
        .fura-cols-menu label { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; font-size: 13px; cursor: pointer; }
        .fura-cols-menu label:hover { background: #f1f5f9; }
        .fura-cols-menu hr { border: none; border-top: 1px solid #e2e8f0; margin: 6px 0; }
        .fura-cols-menu button { width: 100%; padding: 7px; border: none; border-radius: 6px; background: #f1f5f9; cursor: pointer; font-size: 13px; font-family: inherit; }
        .fura-cols-menu button:hover { background: #e2e8f0; }
    `;
    document.head.appendChild(css);

    function headerText(th) {
        const t = (th.textContent || "").replace(/\s+/g, " ").trim();
        return t || "(без назви)";
    }

    /**
     * table   — таблиця
     * key     — ключ для запам'ятовування (окремий для кожної сторінки)
     * options.fixed — номери колонок (з 0), які не можна сховати (наприклад, № і Дії)
     */
    function attach(table, key, options = {}) {
        if (!table || table.dataset.furaCols) return;
        table.dataset.furaCols = "1";
        table.classList.add("fura-cols");
        const ths = [...table.querySelectorAll("thead tr:first-child > th")];
        const fixed = new Set(options.fixed || []);
        const state = store.get(key) || { widths: {}, hidden: [] };
        state.widths = state.widths || {};
        state.hidden = (state.hidden || []).filter((i) => !fixed.has(i));

        const id =
            table.id || (table.id = "furaTable_" + key.replace(/\W/g, ""));
        const hideStyle = document.createElement("style");
        document.head.appendChild(hideStyle);

        function applyHidden() {
            hideStyle.textContent = state.hidden
                .map(
                    (i) =>
                        `#${id} tr > *:nth-child(${i + 1}) { display: none; }`,
                )
                .join("\n");
            countEl.textContent = state.hidden.length
                ? String(state.hidden.length)
                : "";
            countEl.hidden = !state.hidden.length;
        }

        function setWidth(th, w) {
            th.style.width = w + "px";
            th.style.minWidth = w + "px";
            th.style.maxWidth = w + "px";
        }

        function applyWidths() {
            table.classList.toggle(
                "fura-sized",
                Object.keys(state.widths).length > 0,
            );
            ths.forEach((th, i) => {
                if (state.widths[i]) setWidth(th, state.widths[i]);
            });
        }

        const save = () => store.set(key, state);

        // Ручки для ширини і кнопки "сховати"
        ths.forEach((th, i) => {
            const handle = document.createElement("span");
            handle.className = "fura-col-resize";
            handle.title = "Потягніть, щоб змінити ширину";
            handle.addEventListener("click", (e) => e.stopPropagation());
            handle.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                delete state.widths[i];
                th.style.width = th.style.minWidth = th.style.maxWidth = "";
                applyWidths();
                save();
            });
            handle.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX;
                const startW = th.getBoundingClientRect().width;
                handle.classList.add("dragging");
                document.body.style.cursor = "col-resize";
                const move = (ev) => {
                    const w = Math.max(
                        40,
                        Math.round(startW + ev.clientX - startX),
                    );
                    setWidth(th, w);
                    state.widths[i] = w;
                    table.classList.add("fura-sized");
                };
                const up = () => {
                    handle.classList.remove("dragging");
                    document.body.style.cursor = "";
                    document.removeEventListener("mousemove", move);
                    document.removeEventListener("mouseup", up);
                    save();
                };
                document.addEventListener("mousemove", move);
                document.addEventListener("mouseup", up);
            });
            th.appendChild(handle);

            if (!fixed.has(i)) {
                const x = document.createElement("button");
                x.type = "button";
                x.className = "fura-col-hide";
                x.title = "Сховати колонку";
                x.textContent = "✕";
                x.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (!state.hidden.includes(i)) state.hidden.push(i);
                    applyHidden();
                    save();
                });
                th.appendChild(x);
            }
        });

        // Кнопка "Колонки" над таблицею
        const holder = options.barHost || table.closest(".table-card") || table;
        const bar = document.createElement("div");
        bar.className = "fura-cols-bar";
        bar.innerHTML = `<button type="button" class="fura-cols-btn"><i class='bx bx-columns'></i> Колонки <span class="fura-cols-count" hidden></span></button>`;
        holder.parentNode.insertBefore(bar, holder);
        const countEl = bar.querySelector(".fura-cols-count");
        let menu = null;

        function closeMenu() {
            menu?.remove();
            menu = null;
        }
        bar.querySelector(".fura-cols-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            if (menu) return closeMenu();
            menu = document.createElement("div");
            menu.className = "fura-cols-menu";
            menu.innerHTML =
                ths
                    .map((th, i) =>
                        fixed.has(i)
                            ? ""
                            : `<label><input type="checkbox" data-i="${i}" ${state.hidden.includes(i) ? "" : "checked"}/> ${headerText(th)}</label>`,
                    )
                    .join("") +
                `<hr><button type="button" data-act="reset">Показати всі і скинути ширину</button>`;
            menu.addEventListener("click", (ev) => ev.stopPropagation());
            menu.addEventListener("change", (ev) => {
                const i = Number(ev.target.dataset.i);
                state.hidden = ev.target.checked
                    ? state.hidden.filter((x) => x !== i)
                    : [...state.hidden, i];
                applyHidden();
                save();
            });
            menu.querySelector("[data-act=reset]").addEventListener(
                "click",
                () => {
                    state.hidden = [];
                    state.widths = {};
                    ths.forEach(
                        (th) =>
                            (th.style.width =
                                th.style.minWidth =
                                th.style.maxWidth =
                                    ""),
                    );
                    applyWidths();
                    applyHidden();
                    save();
                    closeMenu();
                },
            );
            bar.appendChild(menu);
        });
        document.addEventListener("click", closeMenu);

        applyWidths();
        applyHidden();
    }

    window.furaTableColumns = attach;
})();
