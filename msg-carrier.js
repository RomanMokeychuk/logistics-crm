/* ================================================================= *
 * FURA — «Написати перевізнику» в Telegram / Viber                  *
 * FURA готує текст (маршрут, вантаж, авто), ви його правите,         *
 * натискаєте Telegram чи Viber — відкривається чат з цим номером,    *
 * а текст уже скопійовано: лишається вставити (Cmd+V) і надіслати.   *
 * Надсилаєте ви самі зі свого акаунта — FURA нічого не шле сама.     *
 *                                                                   *
 * Кнопки: window.furaMsgBtns(phone, ctx) → HTML                     *
 *   ctx = { carrier, person, route, cargo, truck, direction, date }  *
 * Клієнта і ціну клієнта в текст НЕ підставляємо ніколи.             *
 * ================================================================= */
(function () {
    if (window.furaMsgBtns) return;
    const TPL_KEY = "fura_msg_tpl";
    const DEF_TPL =
        "Доброго дня, Компанія Грандар{, логіст [Я]}\n" +
        "\n" +
        "[МАРШРУТ]\n" +
        "{[ВАНТАЖ]}\n" +
        "{[АВТО]}\n" +
        "{[УМОВИ]}\n" +
        "\n" +
        "Скажіть, будь ласка, чи цікавить?";
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const digits = (p) => {
        let d = String(p || "").replace(/\D/g, "");
        if (d.length === 10 && d.startsWith("0")) d = "38" + d;      // 0XX… → 380XX…
        if (d.length === 9) d = "380" + d;                           // XX… без нуля
        return d;
    };
    // Viber вставляє в поле лише перші 100 символів — довший текст не обрізаємо, а даємо вставити повністю (Cmd+V)
    const VB_MAX = 100;
    const vbUrl = (ph, text) => `viber://chat?number=%2B${ph}` + (text.length <= VB_MAX ? `&draft=${encodeURIComponent(text)}` : "");
    const tpl = () => { try { return localStorage.getItem(TPL_KEY) || DEF_TPL; } catch (_) { return DEF_TPL; } };
    const myName = () => {
        try { const s = JSON.parse(localStorage.getItem("fura_compose_sig") || "{}"); if (s.name) return s.name.split(/\s+/)[0]; } catch (_) { /* */ }
        try { return (window.currentStaff?.full_name || window.ME?.full_name || "").split(/\s+/).slice(-1)[0] || ""; } catch (_) { return ""; }
    };
    // {… СЛОВО …} — рядок лишається, лише якщо СЛОВО заповнене
    function build(ctx, t) {
        const v = {
            "ІМʼЯ": String(ctx.person || "").split(/\s+/)[0] || "",
            "Я": myName(),
            "МАРШРУТ": String(ctx.route || ctx.direction || "").replace(/\s*\n\s*/g, " – ").trim(),
            "ВАНТАЖ": String(ctx.cargo || "").split(/\n/).map((l) => l.trim()).filter(Boolean).join("\n"),
            "АВТО": String(ctx.truck || "").trim(),
            "ДАТА": String(ctx.date || "").trim(),
            // з коментаря беремо лише умови (митниця, «без Сенту»…) — рядки з ціною, ставкою, клієнтом НЕ беремо
            "УМОВИ": String(ctx.comment || "").split(/\n|;/).map((l) => l.trim())
                .filter((l) => l && !/(клієнт|клиент|замовник|ставк|ціна|цена|маржа|бюджет|оплат|€|eur|usd|\$|грн|uah|zł|pln|руб)/i.test(l) && !/^[\d\s.,]+$/.test(l))
                .join("\n"),
            "ПЕРЕВІЗНИК": String(ctx.carrier || "").trim(),
        };
        const fill = (s) => s.replace(/\[([^\[\]]+)\]/g, (m, k) => (k in v ? v[k] : m));
        const one = (line) => fill(line.replace(/\{([^{}]*)\}/g, (_, inner) => ((inner.match(/\[([^\[\]]+)\]/g) || []).every((m) => v[m.slice(1, -1)]) ? inner : "")));
        // рядок, що став порожнім через відсутні дані, — прибираємо; навмисні порожні рядки шаблону лишаємо
        return (t || tpl()).split("\n").map((l) => (l.trim() ? one(l) : "\u0000")).filter((l) => l.trim()).map((l) => (l === "\u0000" ? "" : l)).join("\n").trim();
    }

    window.furaMsgBtns = (phone, ctx = {}) => {
        const d = digits(phone);
        if (d.length < 10) return "";
        const data = esc(JSON.stringify({ ...ctx, phone: d }));
        return `<span class="fmsg-btns"><button type="button" class="fmsg-b fmsg-tg" data-fmsg="tg" data-fmsg-ctx="${data}" title="Написати в Telegram (текст підготую)">TG</button><button type="button" class="fmsg-b fmsg-vb" data-fmsg="viber" data-fmsg-ctx="${data}" title="Написати у Viber (текст підготую)">Vb</button></span>`;
    };

    // ---- вікно з текстом ----
    const box = document.createElement("div");
    box.className = "fmsg"; box.hidden = true;
    box.innerHTML = `<div class="fmsg-card" role="dialog">
        <div class="fmsg-head"><b>Написати перевізнику</b><span class="fmsg-who"></span><button type="button" class="fmsg-x" data-fx="close" title="Закрити">&times;</button></div>
        <textarea class="fmsg-text" rows="9"></textarea>
        <div class="fmsg-note">Ціну клієнта і назву клієнта перевізнику не пишемо. Текст можна правити.</div>
        <div class="fmsg-acts">
            <button type="button" class="fmsg-go fmsg-go-tg" data-fx="tg">Telegram</button>
            <button type="button" class="fmsg-go fmsg-go-vb" data-fx="viber">Viber</button>
            <button type="button" class="fmsg-go fmsg-go-cp" data-fx="copy">Скопіювати</button>
            <button type="button" class="fmsg-link" data-fx="tpl">Шаблон…</button>
        </div>
        <div class="fmsg-tpl" hidden>
            <div class="fmsg-note">Шаблон для всіх повідомлень. Слова [ІМʼЯ] [Я] [МАРШРУТ] [УМОВИ] [ВАНТАЖ] [АВТО] [ДАТА] [ПЕРЕВІЗНИК] підставляються самі. Частина у фігурних дужках {…} зникне, якщо даних для неї нема.</div>
            <textarea class="fmsg-tpl-text" rows="8"></textarea>
            <div class="fmsg-acts"><button type="button" class="fmsg-go fmsg-go-cp" data-fx="tplsave">Зберегти шаблон</button><button type="button" class="fmsg-link" data-fx="tplreset">Як було</button></div>
        </div>
    </div>`;
    const css = document.createElement("style");
    css.textContent = `
.fmsg-btns{display:inline-flex;gap:3px;margin-left:4px;vertical-align:middle}
.fmsg-b{border:0;border-radius:6px;height:22px;min-width:26px;padding:0 5px;font:700 10px/22px system-ui,sans-serif;color:#fff;cursor:pointer;letter-spacing:.02em}
.fmsg-tg{background:#2aa3df}.fmsg-vb{background:#7360f2}.fmsg-b:hover{filter:brightness(1.1)}
.fmsg{position:fixed;inset:0;z-index:2147483200;background:rgba(17,24,39,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.fmsg[hidden]{display:none}
.fmsg-card{width:min(560px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:16px 18px;display:flex;flex-direction:column;gap:10px;font-family:inherit;color:#111827}
.fmsg-head{display:flex;align-items:center;gap:10px}.fmsg-head b{font-size:17px;white-space:nowrap}
.fmsg-who{flex:1;min-width:0;color:#6b7280;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fmsg-x{border:0;background:none;font-size:26px;line-height:1;color:#9ca3af;cursor:pointer}
.fmsg-text,.fmsg-tpl-text{width:100%;box-sizing:border-box;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;font:15px/1.45 inherit;font-family:inherit;resize:vertical}
.fmsg-text:focus,.fmsg-tpl-text:focus{outline:none;border-color:#d9a944;box-shadow:0 0 0 3px rgba(217,169,68,.18)}
.fmsg-note{font-size:12px;color:#6b7280}
.fmsg-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.fmsg-go{border:0;border-radius:10px;height:40px;padding:0 16px;font:600 14px inherit;font-family:inherit;color:#fff;cursor:pointer}
.fmsg-go-tg{background:#2aa3df}.fmsg-go-vb{background:#7360f2}.fmsg-go-cp{background:#f3f4f6;color:#111827}
.fmsg-go.main{box-shadow:0 0 0 3px rgba(217,169,68,.45)}
.fmsg-link{border:0;background:none;color:#a8781f;text-decoration:underline;cursor:pointer;font:inherit;font-size:13px;margin-left:auto}
.fmsg-tpl{display:flex;flex-direction:column;gap:8px;border-top:1px dashed #e5e7eb;padding-top:10px}.fmsg-tpl[hidden]{display:none}
.fmsg-app{display:flex;gap:16px;font-size:14px}.fmsg-app label{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.fmsg-list{display:flex;flex-direction:column;gap:4px;max-height:260px;overflow:auto;border:1px solid #f0ece2;border-radius:10px;padding:6px}
.fmsg-it{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:8px;cursor:pointer}.fmsg-it:hover{background:#fdf9f0}
.fmsg-it.done{opacity:.6}.fmsg-itn{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:0 6px;align-items:baseline;font-size:14px}.fmsg-itn small{color:#6b7280}
.fmsg-ok{color:#16a34a;font-size:12px;font-weight:700;white-space:nowrap}
.fmsg-one{border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.fmsg-next{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fmsg-next:disabled{background:#16a34a;opacity:.85;cursor:default}
@media (max-width:600px){.fmsg{align-items:flex-end;padding:0}.fmsg-card{border-radius:16px 16px 0 0;padding-bottom:calc(16px + env(safe-area-inset-bottom))}.fmsg-go{flex:1}.fmsg-b{height:28px;min-width:32px;font-size:11px}}`;
    document.head.appendChild(css);
    const mount = () => { if (!box.isConnected) document.body.appendChild(box); };
    let CTX = {};
    const ta = () => box.querySelector(".fmsg-text");
    function open(ctx, app) {
        mount();
        CTX = ctx;
        box.querySelector(".fmsg-who").textContent = [ctx.carrier, ctx.person, "+" + ctx.phone].filter(Boolean).join(" · ");
        ta().value = build(ctx);
        box.querySelector(".fmsg-tpl").hidden = true;
        box.hidden = false;
        box.querySelectorAll(".fmsg-go-tg, .fmsg-go-vb").forEach((b) => b.classList.toggle("main", b.dataset.fx === app));
        setTimeout(() => ta().focus(), 30);
    }
    async function copy(t) {
        try { await navigator.clipboard.writeText(t); return true; } catch (_) {
            const x = document.createElement("textarea"); x.value = t; document.body.appendChild(x); x.select();
            const okk = document.execCommand("copy"); x.remove(); return okk;
        }
    }
    const say = (m) => (typeof window.furaToast === "function" ? window.furaToast({ icon: "📋", title: m, text: "" }) : (typeof window.toast === "function" ? window.toast(m) : null));
    async function go(app) {
        const text = ta().value.trim();
        await copy(text);
        const ph = CTX.phone;
        const url = app === "tg" ? `https://t.me/+${ph}?text=${encodeURIComponent(text)}` : vbUrl(ph, text);
        const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
        box.querySelector(".fmsg-note").textContent = app !== "tg" && text.length <= VB_MAX
            ? "Текст уже в полі Viber — натисніть «Надіслати»."
            : `Текст скопійовано. У чаті ${app === "tg" ? "Telegram" : "Viber"} клацніть у поле, натисніть Cmd+V (на телефоні — «Вставити») і надішліть.${app !== "tg" ? " Viber сам вставляє лише короткі тексти (до 100 символів)." : ""}`;
        say("Текст скопійовано — вставте в чат і надішліть");
    }
    box.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-fx]"); if (!b) return;
        const k = b.dataset.fx;
        if (k === "close") { box.hidden = true; return; }
        if (k === "tg" || k === "viber") return go(k);
        if (k === "copy") { await copy(ta().value.trim()); b.textContent = "✓ Скопійовано"; setTimeout(() => (b.textContent = "Скопіювати"), 1200); return; }
        if (k === "tpl") { const p = box.querySelector(".fmsg-tpl"); p.hidden = !p.hidden; box.querySelector(".fmsg-tpl-text").value = tpl(); return; }
        if (k === "tplsave") { try { localStorage.setItem(TPL_KEY, box.querySelector(".fmsg-tpl-text").value); } catch (_) { /* */ } ta().value = build(CTX); box.querySelector(".fmsg-tpl").hidden = true; return; }
        if (k === "tplreset") { try { localStorage.removeItem(TPL_KEY); } catch (_) { /* */ } box.querySelector(".fmsg-tpl-text").value = DEF_TPL; ta().value = build(CTX); }
    });
    // кнопки TG / Vb будь-де на сторінці
    document.addEventListener("click", (e) => {
        const b = e.target.closest("[data-fmsg]"); if (!b) return;
        e.preventDefault(); e.stopPropagation();
        let ctx = {}; try { ctx = JSON.parse(b.dataset.fmsgCtx || "{}"); } catch (_) { /* */ }
        // кнопка біля поля з номером: беремо номер із поля і контекст від сторінки
        if (b.dataset.fmsgFrom) {
            const host = b.closest(b.dataset.fmsgFrom);
            const ph = digits(host?.querySelector('[data-ct="phone"]')?.value);
            if (ph.length < 10) return say("Спершу впишіть номер телефону");
            ctx = { ...(typeof window.furaMsgContext === "function" ? window.furaMsgContext(b) : {}), person: host?.querySelector('[data-ct="name"]')?.value || "", phone: ph };
        }
        open(ctx, b.dataset.fmsg);
    }, true);
    window.furaMsgOpen = open;

    /* ---------- Розсилка кільком: обрали перевізників → по черзі відкриваємо чат кожного з готовим текстом ---------- */
    const bx = document.createElement("div");
    bx.className = "fmsg fmsg-batch"; bx.hidden = true;
    bx.innerHTML = `<div class="fmsg-card" role="dialog">
        <div class="fmsg-head"><b>Розіслати перевізникам</b><span class="fmsg-who"></span><button type="button" class="fmsg-x" data-bx="close" title="Закрити">&times;</button></div>
        <div class="fmsg-app"><label><input type="radio" name="fmsgApp" value="viber" checked> <span class="fmsg-b fmsg-vb">Vb</span> Viber</label><label><input type="radio" name="fmsgApp" value="tg"> <span class="fmsg-b fmsg-tg">TG</span> Telegram</label></div>
        <textarea class="fmsg-text fmsg-btext" rows="7"></textarea>
        <div class="fmsg-note">Ім'я кожного підставиться саме ([ІМʼЯ]). Ціну й назву клієнта не пишемо.</div>
        <div class="fmsg-list"></div>
        <div class="fmsg-acts"><button type="button" class="fmsg-go fmsg-go-vb fmsg-next" data-bx="next"></button><button type="button" class="fmsg-link" data-bx="all">обрати всіх / нікого</button></div>
        <div class="fmsg-note fmsg-how">Натисніть кнопку — відкриється чат першого перевізника. Текст скопійовано: клацніть у поле, Cmd+V, «Надіслати» (короткий текст до 100 символів Viber вставить сам). Поверніться сюди — наступний.</div>
    </div>`;
    let B = { list: [], ctx: {}, i: 0 };
    const bmount = () => { if (!bx.isConnected) document.body.appendChild(bx); };
    const app = () => bx.querySelector('[name="fmsgApp"]:checked')?.value || "viber";
    const personal = (it) => build({ ...B.ctx, ...it }, bx.querySelector(".fmsg-btext").value.trim());
    function brender() {
        const left = B.list.filter((x) => x.on && !x.done);
        bx.querySelector(".fmsg-who").textContent = `обрано ${B.list.filter((x) => x.on).length} · надіслано ${B.list.filter((x) => x.done).length}`;
        bx.querySelector(".fmsg-list").innerHTML = B.list.map((x, i) => `<label class="fmsg-it ${x.done ? "done" : ""}">
            <input type="checkbox" data-bi="${i}" ${x.on ? "checked" : ""} ${x.done ? "disabled" : ""}>
            <span class="fmsg-itn"><b>${esc(x.carrier || "—")}</b>${x.person ? ` · ${esc(x.person)}` : ""}<small>+${esc(x.phone)}</small></span>
            ${x.done ? '<span class="fmsg-ok">✓ відкрито</span>' : `<button type="button" class="fmsg-one" data-bone="${i}" title="Відкрити саме цей чат">відкрити</button>`}</label>`).join("") || '<div class="fmsg-note">Немає перевізників з номером телефону.</div>';
        const nb = bx.querySelector(".fmsg-next");
        nb.className = `fmsg-go ${app() === "tg" ? "fmsg-go-tg" : "fmsg-go-vb"} fmsg-next`;
        nb.disabled = !left.length;
        nb.textContent = left.length ? `▶ Відкрити ${app() === "tg" ? "Telegram" : "Viber"}: ${left[0].carrier || "+" + left[0].phone} (залишилось ${left.length})` : "✓ Усім обраним відкрито";
    }
    async function openOne(x) {
        const text = personal(x);
        await copy(text);
        const url = app() === "tg" ? `https://t.me/+${x.phone}?text=${encodeURIComponent(text)}` : vbUrl(x.phone, text);
        const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
        x.done = true;
        brender();
    }
    bx.addEventListener("change", (e) => {
        const c = e.target.closest("[data-bi]"); if (c) { B.list[+c.dataset.bi].on = c.checked; brender(); }
        if (e.target.name === "fmsgApp") { try { localStorage.setItem("fura_msg_app", app()); } catch (_) { /* */ } brender(); }
    });
    bx.addEventListener("click", (e) => {
        const b = e.target.closest("[data-bx],[data-bone]"); if (!b) return;
        if (b.dataset.bone != null) { e.preventDefault(); return openOne(B.list[+b.dataset.bone]); }
        const k = b.dataset.bx;
        if (k === "close") { bx.hidden = true; return; }
        if (k === "all") { const on = !B.list.every((x) => x.on || x.done); B.list.forEach((x) => { if (!x.done) x.on = on; }); return brender(); }
        if (k === "next") { const x = B.list.find((y) => y.on && !y.done); if (x) openOne(x); }
    });
    // list = [{ carrier, person, phone }], ctx = { route, cargo, truck, date }
    window.furaMsgBatch = (list, ctx = {}) => {
        bmount();
        const seen = new Set();
        B = { ctx, list: list.map((x) => ({ ...x, phone: digits(x.phone), on: true, done: false })).filter((x) => x.phone.length >= 10 && !seen.has(x.phone) && seen.add(x.phone)) };
        // текст уже з маршрутом/вантажем; лишається тільки [ІМʼЯ] — для кожного своє
        bx.querySelector(".fmsg-btext").value = build({ ...ctx, person: "\u0001" }).replace(/, \u0001/g, "{, [ІМʼЯ]}").replace(/\u0001/g, "[ІМʼЯ]");
        try { const a = localStorage.getItem("fura_msg_app"); if (a) bx.querySelector(`[name="fmsgApp"][value="${a}"]`).checked = true; } catch (_) { /* */ }
        bx.hidden = false;
        brender();
    };
    window.furaMsgDigits = digits;
})();
