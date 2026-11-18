/* ================================================================= *
 * FURA — «Оновити з Lardi» у картці перевізника                      *
 * Офіційний Lardi API (ключ компанії, функція fura-lardi):           *
 * посилання, фото, реєстраційні дані, контакти, транспорт.           *
 * Спершу показуємо, що зміниться, — записуємо після «Зберегти».       *
 * ================================================================= */
(function () {
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const curId = () => { try { return currentCardCarrierId; } catch (e) { return null; } }; // eslint-disable-line no-undef

    async function call(body) {
        const { data, error } = await sbClient.functions.invoke("fura-lardi", { body }); // eslint-disable-line no-undef
        if (error) {
            let m = "";
            try { m = (await error.context?.json())?.error || ""; } catch (e) { /* */ }
            throw new Error(m || "Lardi не відповів. Спробуйте ще раз.");
        }
        return data;
    }

    let box = null;
    function modal(html) {
        if (!box) {
            box = document.createElement("div");
            box.className = "le-ov";
            document.body.appendChild(box);
            box.addEventListener("click", (e) => { if (e.target === box || e.target.closest("[data-le=close]")) box.hidden = true; });
        }
        box.innerHTML = `<div class="le-card" role="dialog"><div class="le-head"><b>Оновити з Lardi</b><button type="button" class="le-x" data-le="close">&times;</button></div>${html}</div>`;
        box.hidden = false;
    }

    async function run(id) {
        modal(`<div class="le-load">Шукаю перевізника в Lardi…</div>`);
        let r;
        try { r = await call({ action: "carrier_enrich", carrier_id: id }); } catch (e) { return modal(`<div class="le-err">${esc(e.message)}</div>`); }
        if (!r.found) return modal(`<div class="le-err">${esc(r.message || "Не знайдено")}</div>`);
        const list = r.changes || [];
        const rows = list.map((c, i) => `<label class="le-row"><input type="checkbox" data-f="${esc(c.field)}" checked>
            <span class="le-lbl">${esc(c.label)}</span>
            <span class="le-val">${c.old && !c.added ? `<s>${esc(c.old)}</s> → ` : ""}${c.added ? `+ ${esc(c.added.join(", "))}` : esc(c.new)}</span></label>`).join("");
        modal(`<div class="le-sub">Профіль: <a href="${esc(r.profile)}" target="_blank" rel="noopener">lardi-trans.com/log/user/${esc(r.ref)} ↗</a> · заявок «авто» за 60 днів: ${r.trucks}</div>
            ${list.length ? `<div class="le-list">${rows}</div>
                <div class="le-note">Заповнене вручну не перезаписується — лише порожні поля й нові пункти у списках.</div>
                <div class="le-acts"><button type="button" class="le-go" data-le="save">Зберегти обране</button><button type="button" class="le-link" data-le="close">Скасувати</button></div>`
            : `<div class="le-ok">Нового в Lardi немає — картка вже актуальна.</div>`}
            <details class="le-dbg"><summary>Технічні дані (для налаштування)</summary><pre>${esc(JSON.stringify(r.debug, null, 1))}</pre></details>`);
        box.querySelector("[data-le=save]")?.addEventListener("click", async (e) => {
            const fields = [...box.querySelectorAll("[data-f]:checked")].map((x) => x.dataset.f);
            if (!fields.length) return (box.hidden = true);
            e.target.disabled = true; e.target.textContent = "Зберігаю…";
            try {
                const res = await call({ action: "carrier_enrich", carrier_id: id, apply: true, fields });
                box.hidden = true;
                await refresh(id);
                window.furaToast?.({ icon: "✅", title: "Картку оновлено з Lardi", text: `Полів: ${res.applied || 0}` });
            } catch (err) { e.target.disabled = false; e.target.textContent = "Зберегти обране"; alert(err.message); }
        });
    }

    async function refresh(id) {
        const { data } = await sbClient.from("carriers").select("*").eq("id", id).maybeSingle(); // eslint-disable-line no-undef
        if (data && typeof allCarriersCache !== "undefined") { // eslint-disable-line no-undef
            const i = allCarriersCache.findIndex((c) => String(c.id) === String(id)); // eslint-disable-line no-undef
            if (i >= 0) allCarriersCache[i] = { ...allCarriersCache[i], ...data }; // eslint-disable-line no-undef
        }
        if (typeof openCarrierCard === "function") openCarrierCard(id); // eslint-disable-line no-undef
    }

    function mount() {
        const acts = document.querySelector("#carrierCardOverlay .carrier-card-actions");
        if (!acts || document.getElementById("leBtn")) return;
        const b = document.createElement("button");
        b.type = "button";
        b.id = "leBtn";
        b.className = "btn-card-edit le-btn";
        b.title = "Підтягнути з Lardi: посилання, фото, реєстраційні дані, контакти, транспорт";
        b.innerHTML = "<i class='bx bx-refresh'></i> З Lardi";
        b.addEventListener("click", () => { const id = curId(); if (id) run(id); });
        acts.prepend(b);
    }
    const css = document.createElement("style");
    css.textContent = `
    .le-ov{position:fixed;inset:0;z-index:2147483100;background:rgba(17,24,39,.45);display:flex;align-items:center;justify-content:center;padding:16px}
    .le-ov[hidden]{display:none}
    .le-card{width:min(640px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:16px 18px;display:flex;flex-direction:column;gap:10px;color:#111827;font-size:14px}
    .le-head{display:flex;justify-content:space-between;align-items:center}.le-head b{font-size:17px}
    .le-x{border:0;background:none;font-size:26px;color:#9ca3af;cursor:pointer;line-height:1}
    .le-sub,.le-note{font-size:12.5px;color:#6b7280}.le-sub a{color:#a8781f;font-weight:600}
    .le-list{display:flex;flex-direction:column;border:1px solid #f1ead9;border-radius:12px;overflow:hidden}
    .le-row{display:grid;grid-template-columns:auto 150px 1fr;gap:10px;align-items:start;padding:9px 12px;cursor:pointer}
    .le-row+.le-row{border-top:1px solid #f5efe1}.le-row input{accent-color:#c9973a;margin-top:2px}
    .le-lbl{color:#6b7280;font-size:13px}.le-val{word-break:break-word}.le-val s{color:#9ca3af}
    .le-acts{display:flex;align-items:center;gap:12px}
    .le-go{border:0;border-radius:10px;height:40px;padding:0 18px;font:600 14px inherit;font-family:inherit;color:#2b1d06;background:linear-gradient(180deg,#f2d27f,#d9a944);cursor:pointer}
    .le-link{border:0;background:none;color:#a8781f;text-decoration:underline;cursor:pointer;font:inherit;font-size:13px}
    .le-load,.le-ok{padding:18px 4px;color:#374151}.le-err{padding:14px;border-radius:10px;background:#fff5f5;color:#b42318}
    .le-dbg{font-size:11.5px;color:#9ca3af}.le-dbg pre{white-space:pre-wrap;max-height:200px;overflow:auto;background:#f8fafc;padding:8px;border-radius:8px}
    @media (max-width:600px){.le-row{grid-template-columns:auto 1fr}.le-val{grid-column:2}}`;
    document.head.appendChild(css);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
    setTimeout(mount, 1500);
})();
