/* ================================================================= *
 * FURA — AI-ПОМІЧНИК (кнопка «Помічник» справа внизу на всіх сторінках) *
 * Питання → функція fura-assistant → відповідь із посиланнями на картки *
 * Підключається з shell.js. Нічого в базі не змінює — тільки шукає.     *
 * ================================================================= */

(function () {
    if (window.top !== window.self) return; // всередині іншої сторінки — не показуємо
    if (window.__furaAssistant) return;
    window.__furaAssistant = true;

    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) return;

    const STORE_KEY = "fura_assistant_chat";
    const SUGGESTIONS = [
        "Знайди перевізників на тент, що їздять у Польщу",
        "Хто вже возив для нас Україна → Німеччина?",
        "Які запити ще без відповіді логіста?",
        "Кому з лідів треба подзвонити сьогодні?",
        "Де зараз фури в дорозі?",
    ];

    let messages = load();
    let busy = false;

    function load() {
        try {
            const v = JSON.parse(sessionStorage.getItem(STORE_KEY) || "[]");
            return Array.isArray(v) ? v.slice(-30) : [];
        } catch (_) {
            return [];
        }
    }
    function save() {
        try {
            sessionStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-30)));
        } catch (_) {}
    }

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);

    // Мінімальний Markdown: посилання, жирний, списки, абзаци. Спершу все екрануємо.
    function render(md) {
        const lines = esc(md).split("\n");
        let html = "";
        let inList = false;
        for (const raw of lines) {
            let line = raw
                .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
                .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
                    const safe = /^(https?:\/\/|[a-z0-9_-]+\.html)/i.test(url) ? url : "#";
                    const ext = /^https?:/i.test(safe) ? ' target="_blank" rel="noopener"' : "";
                    return `<a href="${safe}"${ext}>${text}</a>`;
                });
            const item = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
            if (item) {
                if (!inList) {
                    html += "<ul>";
                    inList = true;
                }
                html += `<li>${item[1]}</li>`;
                continue;
            }
            if (inList) {
                html += "</ul>";
                inList = false;
            }
            const h = line.match(/^#{1,4}\s+(.*)$/);
            if (h) html += `<p><b>${h[1]}</b></p>`;
            else if (line.trim()) html += `<p>${line}</p>`;
        }
        if (inList) html += "</ul>";
        return html;
    }

    /* ---------------- Розмітка ---------------- */

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "assistant.css?v=202610192330";
    document.head.appendChild(link);

    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "fa-fab";
    fab.setAttribute("aria-label", "Відкрити AI-помічника");
    fab.innerHTML = `<i class="bx bx-bot" aria-hidden="true"></i><span>Помічник</span>`;

    const panel = document.createElement("section");
    panel.className = "fa-panel";
    panel.setAttribute("aria-label", "AI-помічник FURA");
    panel.hidden = true;
    panel.innerHTML = `
        <header class="fa-head">
            <div>
                <b>AI-помічник</b>
                <span>Шукає в базі FURA. Нічого не змінює.</span>
            </div>
            <div class="fa-head-actions">
                <button type="button" class="fa-icon" data-fa="reset" title="Нова розмова" aria-label="Нова розмова"><i class="bx bx-refresh"></i></button>
                <button type="button" class="fa-icon" data-fa="close" title="Закрити" aria-label="Закрити помічника"><i class="bx bx-x"></i></button>
            </div>
        </header>
        <div class="fa-body" aria-live="polite"></div>
        <form class="fa-form">
            <label class="fa-sr" for="faInput">Ваше питання</label>
            <textarea id="faInput" rows="2" placeholder="Напр.: перевізники на реф з Одеси в Німеччину"></textarea>
            <button type="submit" class="fa-send" aria-label="Надіслати питання"><i class="bx bx-send"></i></button>
        </form>`;

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    const body = panel.querySelector(".fa-body");
    const input = panel.querySelector("#faInput");

    function draw() {
        if (!messages.length) {
            body.innerHTML = `
                <div class="fa-hello">
                    <p>Привіт! Я знаходжу перевізників, запити, угоди, рейси й лідів. Спитайте звичайними словами.</p>
                    <div class="fa-chips">
                        ${SUGGESTIONS.map((s) => `<button type="button" class="fa-chip" data-q="${esc(s)}">${esc(s)}</button>`).join("")}
                    </div>
                </div>`;
            return;
        }
        body.innerHTML = messages
            .map((m) =>
                m.role === "user"
                    ? `<div class="fa-msg fa-user">${esc(m.content)}</div>`
                    : `<div class="fa-msg fa-bot${m.error ? " fa-error" : ""}">${render(m.content)}</div>`,
            )
            .join("");
        if (busy) body.insertAdjacentHTML("beforeend", `<div class="fa-msg fa-bot fa-typing"><span></span><span></span><span></span> Шукаю в базі…</div>`);
        body.scrollTop = body.scrollHeight;
    }

    async function ask(text) {
        const q = String(text || "").trim();
        if (!q || busy) return;
        messages.push({ role: "user", content: q });
        busy = true;
        save();
        draw();
        try {
            const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
            const { data, error } = await client.functions.invoke("fura-assistant", { body: { messages: history } });
            if (error) {
                let msg = "Помічник не відповів. Перевірте, чи розгорнута функція fura-assistant.";
                try {
                    const j = await error.context?.json();
                    if (j?.error) msg = j.error;
                } catch (_) {}
                throw new Error(msg);
            }
            messages.push({ role: "assistant", content: data?.reply || "Порожня відповідь." });
        } catch (err) {
            messages.push({ role: "assistant", content: err.message, error: true });
        } finally {
            busy = false;
            save();
            draw();
        }
    }

    function open() {
        panel.hidden = false;
        fab.hidden = true;
        draw();
        input.focus();
    }
    function close() {
        panel.hidden = true;
        fab.hidden = false;
        fab.focus();
    }

    fab.addEventListener("click", open);
    panel.addEventListener("click", (e) => {
        const act = e.target.closest("[data-fa]")?.dataset.fa;
        if (act === "close") close();
        if (act === "reset") {
            messages = [];
            save();
            draw();
            input.focus();
        }
        const chip = e.target.closest("[data-q]");
        if (chip) ask(chip.dataset.q);
    });
    panel.querySelector(".fa-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const v = input.value;
        input.value = "";
        ask(v);
    });
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            panel.querySelector(".fa-form").requestSubmit();
        }
        if (e.key === "Escape") close();
    });

    window.furaAssistant = { open, ask };
})();
