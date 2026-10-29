/* ================================================================= *
 * FURA — «📇 РЕЄСТР» У КАРТЦІ ПЕРЕВІЗНИКА                             *
 * Телефони, e-mail, область і адреса з реєстру ФОП / компаній         *
 * з КВЕД 49.41 (таблиця carrier_registry, carrier_registry.sql).      *
 * Збіг: за кодом ЄДРПОУ — точно; за ПІБ / назвою — «ймовірно».        *
 * Підключається на index.html після script.js.                       *
 * ================================================================= */
(function () {
    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) return;
    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const digits = (v) => String(v || "").replace(/\D/g, "");
    const cap = (s) => String(s || "").toLowerCase().replace(/(^|[\s.-])([a-zа-яіїєґ])/g, (m, a, b) => a + b.toUpperCase());

    const css = document.createElement("style");
    css.textContent = `
        .regc { margin: 12px 0; border: 1px solid #c7d7fe; background: #f5f8ff; border-radius: 12px; padding: 12px 14px; }
        .regc-title { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-weight: 700; color: #1e3a8a; margin-bottom: 8px; }
        .regc-title small { font-weight: 500; color: #64748b; }
        .regc-row { border-top: 1px dashed #c7d7fe; padding: 8px 0; display: grid; gap: 4px; font-size: 14px; }
        .regc-row:first-of-type { border-top: none; padding-top: 0; }
        .regc-name { font-weight: 700; color: #13203f; }
        .regc-line { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; color: #374151; }
        .regc-line a { color: #1d5bd8; text-decoration: none; }
        .regc-muted { color: #64748b; font-size: 12px; }
        .regc-chip { font-size: 11px; font-weight: 700; border-radius: 6px; padding: 1px 7px; background: #e0e7ff; color: #3730a3; }
        .regc-chip.warn { background: #fff7ed; color: #9a3412; }
        .regc-btn { border: 1px solid #93c5fd; background: #fff; color: #1d5bd8; border-radius: 8px; padding: 3px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
        .regc-btn:hover { background: #eff6ff; }`;
    document.head.appendChild(css);

    let seq = 0;

    const phoneList = (s) => String(s || "").split(/,\s*/).filter(Boolean);
    const phoneHtml = (p) => {
        const d = digits(p);
        return `<span><a href="tel:+${d}">${esc(p)}</a> <a href="viber://chat?number=%2B${d}" title="Відкрити чат у Viber"><i class='bx bxs-message-rounded-dots'></i></a></span>`;
    };

    async function renderCard(item) {
        const body = document.getElementById("carrierCardBody");
        const my = ++seq;
        body?.querySelector("#regCardBox")?.remove();
        if (!body || !item) return;
        const { data, error } = await client.rpc("registry_match", { p_code: item.edrpou || "", p_name: item.name || item.company || "" });
        if (my !== seq || error || !data?.length) return; // таблиці ще немає або збігів нема — блок не показуємо

        const code = digits(item.edrpou).replace(/^0+/, "");
        const exact = data.some((r) => r.code && digits(r.code).replace(/^0+/, "") === code);
        const people = new Set(data.map((r) => r.phone || r.address));
        const known = new Set([item.phone_1, item.phone_2].flatMap(phoneList).map(digits).filter(Boolean));

        const rows = data.slice(0, 5).map((r) => {
            const fresh = phoneList(r.phone).filter((p) => !known.has(digits(p)));
            return `<div class="regc-row">
                <div class="regc-name">${esc(r.code ? r.name : cap(r.name))}${r.code ? ` <span class="regc-muted">ЄДРПОУ ${esc(r.code)}</span>` : ""}</div>
                ${r.phone ? `<div class="regc-line">📞 ${phoneList(r.phone).map(phoneHtml).join("")}
                    ${fresh.length ? `<button type="button" class="regc-btn" data-reg-phone="${esc(fresh.join(", "))}" title="Записати в «Телефон» картки">+ у картку</button>` : `<span class="regc-muted">вже в картці</span>`}</div>` : ""}
                ${r.email ? `<div class="regc-line">✉️ ${r.email.split(/,\s*/).map((e) => `<a href="mailto:${esc(e)}">${esc(e)}</a>`).join(" ")}</div>` : ""}
                ${r.boss ? `<div class="regc-line">👤 Керівник: ${esc(r.boss)}</div>` : ""}
                ${r.contacts ? `<div class="regc-line regc-muted">Контакти: ${esc(r.contacts)}</div>` : ""}
                <div class="regc-line">📍 ${esc([r.oblast && cap(r.oblast).replace("Обл.", "обл."), r.city].filter(Boolean).join(", ") || "—")}</div>
                ${r.address ? `<div class="regc-muted">${esc(r.address)}</div>` : ""}
                ${r.reg_date ? `<div class="regc-muted">ФОП зареєстровано ${esc(r.reg_date.split("-").reverse().join("."))}${r.kveds ? " · також КВЕД " + esc(r.kveds) : ""}</div>` : ""}
            </div>`;
        });

        const box = document.createElement("div");
        box.id = "regCardBox";
        box.className = "regc";
        box.innerHTML =
            `<div class="regc-title"><span>📇 Реєстр перевізників (КВЕД 49.41)</span>
                ${exact ? `<span class="regc-chip">збіг за кодом ЄДРПОУ</span>`
                        : people.size > 1 ? `<span class="regc-chip warn">${people.size} людини з таким ПІБ — перевірте область</span>`
                        : `<span class="regc-chip warn">збіг за ПІБ — ймовірно, той самий</span>`}
            </div>` + rows.join("");
        const head = body.querySelector(".card-header-block");
        const eq = body.querySelector("#eqCardBox");
        (eq || head) ? (eq || head).after(box) : body.prepend(box);

        box.addEventListener("click", async (e) => {
            const b = e.target.closest("[data-reg-phone]");
            if (!b) return;
            const add = b.dataset.regPhone;
            const patch = !String(item.phone_1 || "").trim() ? { phone_1: add } : { phone_2: [item.phone_2, add].filter(Boolean).join(", ") };
            b.disabled = true;
            const { data: upd, error: err } = await client.from("carriers").update(patch).eq("id", item.id).select("*");
            if (err || !upd?.length) {
                b.disabled = false;
                alert("Не вдалося зберегти: " + (err?.message || "немає прав"));
                return;
            }
            Object.assign(item, upd[0]);
            if (typeof allCarriersCache !== "undefined") {
                const c = allCarriersCache.find((x) => String(x.id) === String(item.id));
                if (c) Object.assign(c, upd[0]);
            }
            if (typeof openCarrierCard === "function") openCarrierCard(item.id);
        });
    }

    window.furaCarrierRegistry = { renderCard };
})();
