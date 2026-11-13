// FURA — зручності для телефона (працює лише на вузькому екрані ≤ 900px).
//  • Фільтри згортаються в кнопку «Фільтри» (пошук лишається видимим).
//  • Коли натискаєте в пошук — усе зайве над ним ховається, видно лише пошук і результати.
(function () {
    const mq = matchMedia("(max-width: 900px)");
    const FILTERS = ".filters-bar, .sa-filters, .rop-filters, .cm-filters, .trips-filters, #ldForm";
    const SEARCH = 'input[type="search"], input.search-input, #gsInput, #ldQ, #eqQ, #cmSearch';

    function activeCount(box) {
        let n = 0;
        box.querySelectorAll("select").forEach((s) => { if (s.value && s.selectedIndex > 0) n++; });
        box.querySelectorAll('input[type="checkbox"]').forEach((c) => { if (c.checked) n++; });
        box.querySelectorAll('input[type="number"], input[type="date"], input.ld-in:not(.ld-cc)').forEach((i) => { if (i.value) n++; });
        return n;
    }

    function setupFilters() {
        document.querySelectorAll(FILTERS).forEach((box) => {
            if (box.dataset.mf) return;
            const isForm = box.id === "ldForm";
            // що лишається видимим у згорнутому стані — поле пошуку
            const keep = isForm ? [] : [...box.children].filter((ch) => ch.matches(SEARCH) || ch.querySelector(SEARCH));
            const rest = isForm ? [...box.children] : [...box.children].filter((ch) => !keep.includes(ch));
            // згортаємо лише справжні фільтри (списки, галочки, поля); звичайні кнопки лишаються на місці
            const hasControls = rest.some((ch) => ch.matches("select, input:not([type=hidden]), textarea") || ch.querySelector("select, input:not([type=hidden]), textarea"));
            if (!rest.length || !hasControls) return;
            box.dataset.mf = "1";
            keep.forEach((k) => k.classList.add("m-keep"));
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "m-filt-btn";
            const label = isForm ? (document.title.includes("Авто") ? "Пошук машин з ціною" : "Пошук вантажів з ціною") : "Фільтри";
            const paint = () => {
                const n = activeCount(box);
                btn.innerHTML = `<i class="bx bx-slider-alt"></i> ${label}${n ? ` <b>${n}</b>` : ""} <i class="bx bx-chevron-down m-chev"></i>`;
            };
            btn.addEventListener("click", () => {
                box.classList.toggle("m-open");
                try { sessionStorage.setItem("m_filt_" + location.pathname + (box.id || box.className), box.classList.contains("m-open") ? "1" : ""); } catch (e) { /* ні */ }
            });
            box.addEventListener("change", paint);
            box.addEventListener("input", paint);
            paint();
            box.classList.add("m-filt");
            try { if (sessionStorage.getItem("m_filt_" + location.pathname + (box.id || box.className))) box.classList.add("m-open"); } catch (e) { /* ні */ }
            if (isForm) box.prepend(btn);
            else box.appendChild(btn);
        });
    }

    // Пошук на весь екран: ховаємо все, що вище поля пошуку (заголовок, кнопки, вкладки, підсумки)
    let hidden = [];
    function focusMode(input) {
        exitFocus();
        const main = document.querySelector("main.main-content");
        if (!main || !main.contains(input)) return;
        let anchor = input;
        while (anchor.parentElement && anchor.parentElement !== main) anchor = anchor.parentElement;
        const isTop = anchor.classList.contains("fura-topbar");
        [...main.children].forEach((ch) => {
            if (ch === anchor || ch.classList.contains("fura-topbar")) return;
            const before = anchor.compareDocumentPosition(ch) & Node.DOCUMENT_POSITION_PRECEDING;
            if (isTop || before) { ch.classList.add("m-hide-search"); hidden.push(ch); }
        });
        document.body.classList.add("m-searching");
    }
    function exitFocus() {
        hidden.forEach((ch) => ch.classList.remove("m-hide-search"));
        hidden = [];
        document.body.classList.remove("m-searching");
    }
    document.addEventListener("focusin", (e) => {
        if (!mq.matches) return;
        if (e.target.matches && e.target.matches(SEARCH)) focusMode(e.target);
    });
    document.addEventListener("focusout", (e) => {
        if (!e.target.matches || !e.target.matches(SEARCH)) return;
        // невелика затримка — щоб встигнути натиснути на результат пошуку
        setTimeout(() => {
            if (document.activeElement && document.activeElement.matches && document.activeElement.matches(SEARCH)) return;
            exitFocus();
        }, 250);
    });

    // Фурик і «Помічник» ховаються, коли гортаєте вниз (не закривають кнопки), і повертаються, коли вгору
    let lastY = scrollY;
    addEventListener("scroll", () => {
        if (!mq.matches) return;
        const y = scrollY;
        if (Math.abs(y - lastY) < 8) return;
        document.body.classList.toggle("m-scroll-down", y > lastY && y > 120);
        lastY = y;
    }, { passive: true });

    function run() { if (mq.matches) setupFilters(); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(run, 50));
    else setTimeout(run, 50);
    // сторінки домальовують фільтри пізніше — перевіряємо ще раз
    setTimeout(run, 1500);
    mq.addEventListener?.("change", run);
})();
