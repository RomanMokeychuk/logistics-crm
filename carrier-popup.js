/* ================================================================= *
 * FURA — КАРТКА ПЕРЕВІЗНИКА ПОВЕРХ БУДЬ-ЯКОЇ СТОРІНКИ                 *
 * Клік по назві перевізника будь-де в CRM відкриває ту саму повну     *
 * картку, що й у «Перевізниках» (з історією, напрямками, Чергою,      *
 * редагуванням) — у вікні поверх сторінки, без переходу.              *
 *                                                                    *
 * Розмітка посилань:                                                 *
 *   <a href="#" data-carrier-card="ID">…</a>      — за id             *
 *   <a href="#" data-carrier-code="ЄДРПОУ">…</a>  — за кодом          *
 *   <a href="#" data-carrier-name="Назва">…</a>   — за точною назвою  *
 * Можна поєднувати (code + name): шукаємо за кодом, потім за назвою.  *
 * Підключається з shell.js на всіх сторінках.                         *
 * ================================================================= */

(function () {
    if (window.furaCarrierPopup) return;
    if (window.top !== window.self) return; // усередині самої картки — не потрібно

    const db = () => (typeof sbClient !== "undefined" ? sbClient : window.sbClient || null);
    const digits = (v) => String(v || "").replace(/\D/g, "").replace(/^0+/, "");

    let wrap = null;
    let frame = null;
    let spinner = null;

    function ensure() {
        if (wrap) return;
        const css = document.createElement("style");
        css.textContent = `
            .fura-cpop { position: fixed; inset: 0; z-index: 2147483000; display: none; }
            .fura-cpop.active { display: block; }
            .fura-cpop-dim { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.45); }
            .fura-cpop iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; }
            .fura-cpop-spin { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: #fff; border-radius: 12px; padding: 14px 20px; font: 600 14px/1.3 inherit;
                color: #13203f; box-shadow: 0 10px 30px rgba(0,0,0,.2); }
            .fura-cpop-toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483001;
                background: #13203f; color: #fff; padding: 10px 16px; border-radius: 10px; font-size: 14px;
                box-shadow: 0 10px 30px rgba(0,0,0,.25); max-width: calc(100% - 32px); }
            a[data-carrier-card], a[data-carrier-code], a[data-carrier-name] { cursor: pointer; }
            .fura-clink { color: inherit; text-decoration: none; border-bottom: 1px dashed currentColor; }
            .fura-clink:hover { color: #1d5bd8; }`;
        document.head.appendChild(css);

        wrap = document.createElement("div");
        wrap.className = "fura-cpop";
        wrap.innerHTML = `<div class="fura-cpop-dim"></div><div class="fura-cpop-spin">Відкриваю картку…</div>`;
        spinner = wrap.querySelector(".fura-cpop-spin");
        wrap.querySelector(".fura-cpop-dim").addEventListener("click", close);
        document.body.appendChild(wrap);

        window.addEventListener("message", (e) => {
            if (e.origin !== location.origin || !e.data || typeof e.data !== "object") return;
            if (e.data.type === "fura-cpop-ready") spinner.style.display = "none";
            if (e.data.type === "fura-cpop-close") close();
            if (e.data.type === "fura-cpop-missing") {
                close();
                toast("Перевізника не знайдено в реєстрі");
            }
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && wrap.classList.contains("active")) close();
        });
    }

    function toast(text) {
        const t = document.createElement("div");
        t.className = "fura-cpop-toast";
        t.textContent = text;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3200);
    }

    function close() {
        if (!wrap) return;
        const id = wrap.dataset.id;
        wrap.classList.remove("active");
        if (frame) {
            frame.remove();
            frame = null;
        }
        document.documentElement.style.overflow = "";
        // Сторінка може оновити дані (напр., телефон дописали в картці)
        if (id) document.dispatchEvent(new CustomEvent("fura-carrier-popup-closed", { detail: { id } }));
    }

    function open(id) {
        if (!id) return;
        // На сторінці «Перевізники» — звичайна картка, без вікна в вікні
        if (typeof window.openCarrierCard === "function" && document.getElementById("carrierCardOverlay")) {
            return window.openCarrierCard(id);
        }
        ensure();
        if (frame) frame.remove();
        wrap.dataset.id = id;
        spinner.style.display = "";
        frame = document.createElement("iframe");
        frame.title = "Картка перевізника";
        frame.src = `index.html?cpop=1&open=${encodeURIComponent(id)}`;
        wrap.appendChild(frame);
        wrap.classList.add("active");
        document.documentElement.style.overflow = "hidden";
    }

    async function resolve({ id, code, name }) {
        if (id) return id;
        const client = db();
        if (!client) return null;
        const c = digits(code);
        if (c) {
            const { data } = await client.from("carriers").select("id").in("edrpou", [c, c.padStart(8, "0")]).limit(1);
            if (data && data[0]) return data[0].id;
        }
        const n = String(name || "").trim();
        if (n) {
            const { data } = await client.from("carriers").select("id").ilike("name", n.replace(/[%_]/g, "\\$&")).limit(1);
            if (data && data[0]) return data[0].id;
        }
        return null;
    }

    async function openBy(spec) {
        const id = await resolve(spec);
        if (id) open(id);
        else toast("Цього перевізника ще немає в «Перевізниках»");
    }

    // Один обробник на всю CRM. Перехоплюємо раніше за обробники рядків таблиць,
    // щоб клік по назві не відкривав ще й угоду/запит.
    document.addEventListener(
        "click",
        (e) => {
            const a = e.target.closest("[data-carrier-card], [data-carrier-code], [data-carrier-name]");
            if (!a) return;
            if (e.metaKey || e.ctrlKey) return; // Cmd+клік — як звичайне посилання (якщо є href)
            e.preventDefault();
            e.stopPropagation();
            openBy({ id: a.dataset.carrierCard, code: a.dataset.carrierCode, name: a.dataset.carrierName });
        },
        true,
    );

    // Готова розмітка посилання на перевізника — для будь-якої сторінки
    function link(text, { id, code, name } = {}) {
        const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch]);
        if (!text) return "—";
        if (!id && !digits(code) && !name) return esc(text);
        const attrs = [
            id ? `data-carrier-card="${esc(id)}"` : "",
            digits(code) ? `data-carrier-code="${esc(digits(code))}"` : "",
            !id ? `data-carrier-name="${esc(name || text)}"` : "",
        ].join(" ");
        return `<a href="${id ? `index.html?open=${encodeURIComponent(id)}` : "#"}" class="fura-clink" ${attrs} title="Відкрити картку перевізника">${esc(text)}</a>`;
    }

    window.furaCarrierPopup = { open, openBy, close, link };
})();
