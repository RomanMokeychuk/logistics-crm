/* ================================================================= *
 * FURA — ПОМІЧНИК (безкоштовний): пошук перевізників звичайними      *
 * словами. Кнопка «Помічник» справа внизу на всіх сторінках.         *
 * Потрібен carrier-search.js. Нічого в базі не змінює.               *
 * ================================================================= */

(function () {
    if (window.top !== window.self) return;
    if (window.__furaHelper) return;
    window.__furaHelper = true;

    const client = typeof sbClient !== "undefined" ? sbClient : null;
    const S = window.furaCarrierSearch;
    if (!client || !S) return;

    const EXAMPLES = [
        "тент з Одеси в Польщу",
        "реф у Німеччину",
        "хто возив Україна – Литва",
        "мега зі Львова в Італію",
        "Вест-Карго або ЄДРПОУ",
    ];
    const STORE = "fura_helper_last";

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);

    /* ---------------- Розмітка ---------------- */

    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "helper.css?v=202610192350";
    document.head.appendChild(css);

    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "fh-fab";
    fab.setAttribute("aria-label", "Відкрити помічника: пошук перевізників");
    fab.innerHTML = `<i class="bx bx-search-alt" aria-hidden="true"></i><span>Помічник</span>`;

    const panel = document.createElement("section");
    panel.className = "fh-panel";
    panel.setAttribute("aria-label", "Помічник: пошук перевізників");
    panel.hidden = true;
    panel.innerHTML = `
        <header class="fh-head">
            <div>
                <b>Помічник</b>
                <span>Знайде перевізника за словами: тип авто, звідки, куди, назва</span>
            </div>
            <button type="button" class="fh-icon" data-fh="close" aria-label="Закрити помічника"><i class="bx bx-x"></i></button>
        </header>
        <form class="fh-form">
            <label class="fh-sr" for="fhInput">Кого шукаємо?</label>
            <input id="fhInput" type="search" autocomplete="off" placeholder="Напр.: тент з Одеси в Польщу" />
            <button type="submit" class="fh-go" aria-label="Шукати"><i class="bx bx-search"></i></button>
        </form>
        <div class="fh-body" aria-live="polite"></div>`;

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    const body = panel.querySelector(".fh-body");
    const input = panel.querySelector("#fhInput");

    function hello() {
        body.innerHTML = `
            <p class="fh-muted">Напишіть, кого шукаєте. Я подивлюся і в реєстрі перевізників, і хто вже возив для нас схожим маршрутом.</p>
            <div class="fh-chips">${EXAMPLES.map((e) => `<button type="button" class="fh-chip" data-q="${esc(e)}">${esc(e)}</button>`).join("")}</div>`;
    }

    /* ---------------- Картки результатів ---------------- */

    // Відкрита картка запиту (requests.html + bids.js) — можна одразу додати перевізника до ставок
    const bidsOpen = () => !!window.furaBids?.isOpen?.();

    function actions(c, phone) {
        const btns = [];
        if (c.id) btns.push(`<a class="fh-btn" href="index.html?open=${encodeURIComponent(c.id)}" data-carrier-card="${esc(c.id)}">Картка</a>`);
        if (phone) {
            btns.push(`<button type="button" class="fh-btn fh-viber" data-chat="viber" data-phone="${phone}">Viber</button>`);
            btns.push(`<button type="button" class="fh-btn" data-chat="whatsapp" data-phone="${phone}">WhatsApp</button>`);
        }
        if (bidsOpen()) {
            btns.push(`<button type="button" class="fh-btn fh-add" data-add='${esc(JSON.stringify({ id: c.id || null, name: c.name, phone: phone || c.phone_1 || c.phone || "" }))}'>+ До ставок</button>`);
        }
        return `<div class="fh-actions">${btns.join("")}</div>`;
    }

    function badges(str, cls) {
        return String(str || "")
            .split(";")
            .map((x) => x.split("-")[0].trim())
            .filter(Boolean)
            .slice(0, 6)
            .map((x) => `<span class="fh-badge ${cls || ""}">${esc(x)}</span>`)
            .join("");
    }

    function registryCard(c) {
        const phone = S.phoneDigits(c.phone_1, c.phone_2);
        const where = [c.city, c.region_ukr].filter(Boolean).join(", ");
        return `
            <article class="fh-card">
                <div class="fh-card-top">
                    <b>${esc(c.name || "Без назви")}</b>
                    ${c.rating ? `<span class="fh-rating" title="Рейтинг">★ ${esc(c.rating)}</span>` : ""}
                </div>
                <div class="fh-meta">${esc(where || "місто не вказано")}${c.edrpou ? ` · ЄДРПОУ ${esc(c.edrpou)}` : ""}</div>
                <div class="fh-badges">${badges(c.trailer_type, "tr")}${badges(c.destinations)}</div>
                <div class="fh-meta">${c.contact_person_1 ? esc(c.contact_person_1) + " · " : ""}${phone ? `+${phone}` : "немає мобільного"}</div>
                ${actions(c, phone)}
            </article>`;
    }

    function historyCard(h) {
        const phone = S.phoneDigits(h.phone);
        return `
            <article class="fh-card fh-hist">
                <div class="fh-card-top">
                    <b>${esc(h.name)}</b>
                    <span class="fh-trips">${h.trips} ${h.trips === 1 ? "рейс" : h.trips < 5 ? "рейси" : "рейсів"}</span>
                </div>
                <div class="fh-meta">Останній: ${esc(S.fmtDate(h.last) || "—")}${phone ? ` · +${phone}` : ""}</div>
                ${actions({ id: h.carrier_id, name: h.name, phone: h.phone }, phone)}
            </article>`;
    }

    /* ---------------- Пошук ---------------- */

    let seq = 0;

    async function run(text) {
        const raw = String(text || "").trim();
        if (!raw) return hello();
        input.value = raw;
        try {
            sessionStorage.setItem(STORE, raw);
        } catch (_) {}
        const my = ++seq;
        const q = S.parse(raw);
        const understood = S.describe(q);
        body.innerHTML = `<div class="fh-understood">Шукаю: <b>${esc(understood || raw)}</b></div><p class="fh-muted">Зачекайте…</p>`;

        try {
            const [hist, reg0] = await Promise.all([S.searchHistory(client, q), S.searchRegistry(client, q)]);
            let reg = reg0;
            let relaxed = false;
            if (!reg.length && q.places.length && (q.countries.length || q.trailers.length)) {
                reg = await S.searchRegistry(client, q, { skipPlace: true });
                relaxed = reg.length > 0;
            }
            if (my !== seq) return;

            let html = `<div class="fh-understood">Зрозумів: <b>${esc(understood || raw)}</b></div>`;
            if (hist.length) {
                html += `<h3 class="fh-h">Вже возили для нас (${hist.length})</h3>${hist.map(historyCard).join("")}`;
            }
            if (reg.length) {
                html += `<h3 class="fh-h">З реєстру (${reg.length}${reg.length >= 30 ? "+" : ""})</h3>`;
                if (relaxed) html += `<p class="fh-note">У вибраному регіоні нікого не знайшов — показую всіх, хто підходить за іншими умовами.</p>`;
                html += reg.map(registryCard).join("");
            }
            if (!hist.length && !reg.length) {
                html += `<p class="fh-muted">Нікого не знайшов. Спробуйте простіше: тільки тип авто й країну («тент Польща») або назву перевізника.</p>`;
            }
            body.innerHTML = html;
            body.scrollTop = 0;
        } catch (err) {
            if (my !== seq) return;
            body.innerHTML = `<div class="fh-error">Не вдалося виконати пошук: ${esc(err.message || err)}</div>`;
        }
    }

    /* ---------------- Події ---------------- */

    function open() {
        panel.hidden = false;
        fab.hidden = true;
        let last = "";
        try {
            last = sessionStorage.getItem(STORE) || "";
        } catch (_) {}
        if (last && !body.innerHTML.trim()) run(last);
        else if (!body.innerHTML.trim()) hello();
        input.focus();
        input.select();
    }
    function close() {
        panel.hidden = true;
        fab.hidden = false;
        fab.focus();
    }

    fab.addEventListener("click", open);
    panel.querySelector(".fh-form").addEventListener("submit", (e) => {
        e.preventDefault();
        run(input.value);
    });
    input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
    });
    panel.addEventListener("click", (e) => {
        if (e.target.closest("[data-fh='close']")) return close();
        const chip = e.target.closest("[data-q]");
        if (chip) return run(chip.dataset.q);
        const chat = e.target.closest("[data-chat]");
        if (chat) {
            const text = window.furaBids?.currentText?.() || "";
            S.openChat(chat.dataset.chat, chat.dataset.phone, text);
            return;
        }
        const add = e.target.closest("[data-add]");
        if (add) {
            try {
                window.furaBids.addCarrier(JSON.parse(add.dataset.add));
                add.textContent = "✓ Додано";
                add.disabled = true;
            } catch (_) {}
        }
    });

    window.furaHelper = { open, run };
})();
