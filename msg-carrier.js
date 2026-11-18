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
    // Без вантажу (відкрили з картки перевізника) — питаємо про вільні авто
    const FREE_TPL =
        "Доброго дня, Компанія Грандар{, логіст [Я]}\n" +
        "\n" +
        "Чи є у вас зараз вільні авто? Підкажіть, будь ласка, де вони і куди шукаєте завантаження.";
    // Telegram-бот FURA: спільне посилання для перевізників і розсилка через бота
    const sbc = () => (typeof sbClient !== "undefined" ? sbClient : null);
    async function agent(body) {
        const { data, error } = await sbc().functions.invoke("fura-agent", { body });
        if (error) { let m = ""; try { m = (await error.context?.json())?.error || ""; } catch (_) { /* */ } throw new Error(m || "Сервер не відповів"); }
        return data;
    }
    let JOIN = null;
    async function joinLink() {
        if (JOIN) return JOIN;
        try { JOIN = localStorage.getItem("fura_bot_join") || ""; } catch (_) { JOIN = ""; }
        if (!JOIN) { try { JOIN = (await agent({ action: "join_link" }))?.link || ""; localStorage.setItem("fura_bot_join", JOIN); } catch (_) { JOIN = ""; } }
        return JOIN;
    }
    window.furaJoinLink = joinLink;
    const JOIN_LINE = (l) => `\n\nЩоб отримувати наші запити одразу в Telegram — натисніть: ${l}`;
    let REQS = null; // мої запити з Блокнота
    async function loadReqs() {
        if (REQS) return REQS;
        try {
            const c = typeof sbClient !== "undefined" ? sbClient : null;
            const { data } = await c.from("my_requests").select("id, addresses, direction, cargo, truck, comment, status, updated_at")
                .order("updated_at", { ascending: false }).limit(40);
            REQS = (data || []).filter((r) => !/закрит|відмов|архів/i.test(r.status || ""));
        } catch (_) { REQS = []; }
        return REQS;
    }
    try { if (/Цікаво\? Підкажіть, будь ласка, ставку/.test(localStorage.getItem(TPL_KEY) || "")) localStorage.removeItem(TPL_KEY); } catch (_) { /* старий шаблон — прибрати */ }
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
        <label class="fmsg-pick" hidden><span>Вантаж:</span><select class="fmsg-req"><option value="">— без вантажу (спитати про вільні авто) —</option></select></label>
        <textarea class="fmsg-text" rows="9"></textarea>
        <div class="fmsg-note">Ціну клієнта і назву клієнта перевізнику не пишемо. Текст можна правити.</div>
        <label class="fmsg-join fmsg-short"><input type="checkbox" class="fmsg-shorton"> Коротко, до 100 символів — тоді Viber сам вставить текст у поле (без Cmd+V)</label>
        <label class="fmsg-join fmsg-sjoin"><input type="checkbox" class="fmsg-joinon1" checked> Додати посилання на бота FURA (щоб наступні запити приходили йому автоматично)</label>
        <div class="fmsg-acts">
            <button type="button" class="fmsg-go fmsg-go-bot fmsg-sbot" data-fx="bot" hidden>🤖 Надіслати ботом</button>
            <button type="button" class="fmsg-go fmsg-go-tg" data-fx="tg">Telegram</button>
            <button type="button" class="fmsg-go fmsg-go-vb" data-fx="viber">Viber</button>
            <button type="button" class="fmsg-go fmsg-go-cp" data-fx="copy">Скопіювати</button>
            <button type="button" class="fmsg-go fmsg-go-vbf" data-fx="vbfwd" title="Viber відкриє «Поділитися» з усім текстом — оберіть цього перевізника і «Надіслати»">Viber · весь текст</button>
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
.fmsg-go-tg{background:#2aa3df}.fmsg-go-vbf{background:#5a48d6}.fmsg-go-vb{background:#7360f2}.fmsg-go-cp{background:#f3f4f6;color:#111827}
.fmsg-go.main{box-shadow:0 0 0 3px rgba(217,169,68,.45)}
.fmsg-link{border:0;background:none;color:#a8781f;text-decoration:underline;cursor:pointer;font:inherit;font-size:13px;margin-left:auto}
.fmsg-tpl{display:flex;flex-direction:column;gap:8px;border-top:1px dashed #e5e7eb;padding-top:10px}.fmsg-tpl[hidden]{display:none}
.fmsg-pick{display:flex;align-items:center;gap:8px;font-size:13px;color:#6b7280}.fmsg-pick[hidden]{display:none}
.fmsg-req{flex:1;min-width:0;border:1px solid #e5e7eb;border-radius:9px;padding:8px 10px;font:inherit;font-size:14px;color:#111827;background:#fff}
.fmsg-go-bot{background:#0f8fd0}.fmsg-hint{background:#fff7e0;border:1px solid #f2d48a;color:#6b4f12;border-radius:10px;padding:10px 12px;font-size:14px}.fmsg-join.off{opacity:.45;pointer-events:none}.fmsg-go[hidden],.fmsg-join[hidden]{display:none}.fmsg-go-bot:disabled{opacity:.6;cursor:default}
.fmsg-botrow{gap:10px}.fmsg-botrow[hidden]{display:none}
.fmsg-botb{font-style:normal;font-size:11px;color:#1d7fb0;background:#e6f4fb;border-radius:6px;padding:1px 6px}
.fmsg-err{font-style:normal;font-size:11px;color:#b42318}
.fmsg-join{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:#4b5563;cursor:pointer}.fmsg-join input{margin-top:2px;accent-color:#c9971f}
.fmsg-app{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:14px}.fmsg-app label{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
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
        const pick = box.querySelector(".fmsg-pick"), sel = box.querySelector(".fmsg-req");
        const hasLoad = !!(ctx.route || ctx.cargo);
        pick.hidden = hasLoad;
        ta().value = hasLoad ? build(ctx) : build(ctx, FREE_TPL);
        if (!hasLoad) {
            // з картки перевізника: можна обрати вантаж зі свого Блокнота
            sel.length = 1;
            loadReqs().then((list) => {
                sel.length = 1;
                list.forEach((r) => sel.add(new Option(`${r.addresses || r.direction || "—"}${r.cargo ? " · " + String(r.cargo).split("\n")[0].slice(0, 40) : ""}${r.status ? " · " + r.status : ""}`, r.id)));
            });
            sel.onchange = () => {
                const r = (REQS || []).find((x) => x.id === sel.value);
                CTX = { ...ctx, ...(r ? { route: r.addresses || r.direction || "", cargo: r.cargo || "", truck: r.truck || "", comment: r.comment || "" } : {}) };
                ta().value = r ? build(CTX) : build(ctx, FREE_TPL);
            };
        }
        box.querySelector(".fmsg-tpl").hidden = true;
        const note = box.querySelector(".fmsg-note"); note.classList.remove("fmsg-hint"); note.textContent = "Ціну клієнта і назву клієнта перевізнику не пишемо. Текст можна правити.";
        let sh = false; try { sh = localStorage.getItem("fura_msg_short") === "1"; } catch (_) { /* */ }
        box.querySelector(".fmsg-shorton").checked = sh;
        if (sh) ta().value = shortText(CTX);
        box.querySelector(".fmsg-sjoin").classList.toggle("off", sh);
        // уже в боті — надсилаємо ботом, посилання не потрібне
        const sb = box.querySelector(".fmsg-sbot"), sj = box.querySelector(".fmsg-sjoin");
        sb.hidden = true; sj.hidden = false;
        if (ctx.carrier_id && sbc()) sbc().from("carriers").select("tg_chat_id").eq("id", ctx.carrier_id).maybeSingle().then(({ data }) => { if (data?.tg_chat_id) { sb.hidden = false; sj.hidden = true; } }, () => {});
        joinLink();
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
    // Короткий текст (≤100 символів): Viber вставляє його в поле сам
    const city = (side) => String(side || "").split(",")[0].replace(/\(.*?\)/g, "").trim();
    function shortText(ctx) {
        const route = String(ctx.route || "").split(/\s+[-–—]\s+|\n/).filter(Boolean).map(city).join(" – ");
        const cargo = String(ctx.cargo || "").split("\n")[0].trim();
        const parts = ["Доброго дня! Грандар.", route && route + ".", cargo && cargo + ".", ctx.truck && String(ctx.truck).replace(/\s*\n\s*/g, ", ").trim() + ".", "Цікаво?"].filter(Boolean);
        let t = parts.join(" ");
        if (t.length > VB_MAX) t = parts.filter((x) => x !== String(ctx.truck || "").replace(/\s*\n\s*/g, ", ").trim() + ".").join(" ");
        if (t.length > VB_MAX && cargo) t = t.replace(cargo + ".", cargo.slice(0, Math.max(10, cargo.length - (t.length - VB_MAX) - 1)) + "…");
        return t.slice(0, VB_MAX);
    }
    const shortOn = () => box.querySelector(".fmsg-shorton").checked;
    box.addEventListener("change", (e) => {
        if (!e.target.classList.contains("fmsg-shorton")) return;
        try { localStorage.setItem("fura_msg_short", shortOn() ? "1" : ""); } catch (_) { /* */ }
        ta().value = shortOn() ? shortText(CTX) : (CTX.route || CTX.cargo ? build(CTX) : build(CTX, FREE_TPL));
        box.querySelector(".fmsg-sjoin").classList.toggle("off", shortOn());
    });
    async function go(app) {
        const text = ta().value.trim() + (!shortOn() && box.querySelector(".fmsg-joinon1").checked && !box.querySelector(".fmsg-sjoin").hidden && JOIN ? JOIN_LINE(JOIN) : "");
        await copy(text);
        const ph = CTX.phone;
        const url = app === "tg" ? `https://t.me/+${ph}?text=${encodeURIComponent(text)}` : vbUrl(ph, text);
        const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
        const note = box.querySelector(".fmsg-note");
        note.classList.add("fmsg-hint");
        note.innerHTML = app !== "tg" && text.length <= VB_MAX
            ? "✅ Текст уже в полі Viber — натисніть там «Надіслати»."
            : `👉 Перейдіть у ${app === "tg" ? "Telegram" : "Viber"} → клацніть у поле повідомлення → <b>Cmd+V</b> → «Надіслати». Текст уже скопійовано.`;
    }
    box.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-fx]"); if (!b) return;
        const k = b.dataset.fx;
        if (k === "close") { box.hidden = true; return; }
        if (k === "tg" || k === "viber") return go(k);
        if (k === "vbfwd") {
            // спроба: «Поділитися» у Viber приймає довгий текст; контакт обираєте у вікні Viber
            const text = ta().value.trim() + (!shortOn() && box.querySelector(".fmsg-joinon1").checked && !box.querySelector(".fmsg-sjoin").hidden && JOIN ? JOIN_LINE(JOIN) : "");
            await copy(text);
            const a = document.createElement("a"); a.href = `viber://forward?text=${encodeURIComponent(text)}`; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
            const note = box.querySelector(".fmsg-note"); note.classList.add("fmsg-hint");
            note.innerHTML = `👉 У Viber відкрилось «Поділитися»: знайдіть перевізника (номер <b>+${esc(CTX.phone)}</b> або ім'я) і натисніть «Надіслати». Якщо Viber не вставив весь текст — він у буфері, Cmd+V.`;
            return;
        }
        if (k === "bot") {
            b.disabled = true; b.textContent = "⏳ Надсилаю…";
            try {
                const r = await agent({ action: "direct_send", request_id: CTX.request_id || undefined, my_request_id: CTX.my_request_id || undefined, items: [{ carrier_id: CTX.carrier_id, text: ta().value.trim() }] });
                if (r?.sent) { b.textContent = "✓ Надіслано ботом"; say("Надіслано ботом. Відповідь прийде вам у Telegram."); return; }
                b.textContent = "Не вдалося: " + (r?.results?.[0]?.error || "помилка");
            } catch (er) { b.textContent = "Не вдалося: " + er.message; }
            setTimeout(() => { b.disabled = false; b.textContent = "🤖 Надіслати ботом"; }, 3000);
            return;
        }
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
        <div class="fmsg-app"><label><input type="radio" name="fmsgApp" value="viber" checked> <span class="fmsg-b fmsg-vb">Vb</span> Viber</label><label><input type="radio" name="fmsgApp" value="vbf"> <span class="fmsg-b fmsg-vb">Vb</span> Viber · весь текст («Поділитися»)</label><label><input type="radio" name="fmsgApp" value="tg"> <span class="fmsg-b fmsg-tg">TG</span> Telegram</label></div>
        <textarea class="fmsg-text fmsg-btext" rows="7"></textarea>
        <div class="fmsg-note">Ім'я кожного підставиться саме ([ІМʼЯ]). Ціну й назву клієнта не пишемо.</div>
        <div class="fmsg-list"></div>
        <div class="fmsg-acts fmsg-botrow" hidden><button type="button" class="fmsg-go fmsg-go-bot" data-bx="bot"></button><span class="fmsg-note">надсилає бот FURA одразу всім, хто підключений, — без вашої участі</span></div>
        <label class="fmsg-join"><input type="checkbox" class="fmsg-joinon" checked> Тим, хто не в боті, додати посилання на бота (щоб наступного разу все йшло автоматично)</label>
        <div class="fmsg-acts"><button type="button" class="fmsg-go fmsg-go-vb fmsg-next" data-bx="next"></button><button type="button" class="fmsg-link" data-bx="all">обрати всіх / нікого</button></div>
        <div class="fmsg-note fmsg-how">Натисніть кнопку — відкриється чат першого перевізника. Текст скопійовано: клацніть у поле, Cmd+V, «Надіслати» (короткий текст до 100 символів Viber вставить сам). Поверніться сюди — наступний.</div>
    </div>`;
    let B = { list: [], ctx: {}, i: 0 };
    const bmount = () => { if (!bx.isConnected) document.body.appendChild(bx); };
    const app = () => bx.querySelector('[name="fmsgApp"]:checked')?.value || "viber";
    const personal = (it) => build({ ...B.ctx, ...it }, bx.querySelector(".fmsg-btext").value.trim());
    const withJoin = (t) => (bx.querySelector(".fmsg-joinon").checked && JOIN ? t + JOIN_LINE(JOIN) : t);
    function brender() {
        const left = B.list.filter((x) => x.on && !x.done && !(x.bot && B.useBot));
        const bots = B.list.filter((x) => x.on && !x.done && x.bot);
        const br = bx.querySelector(".fmsg-botrow");
        br.hidden = !B.list.some((x) => x.bot);
        const bb = bx.querySelector(".fmsg-go-bot");
        bb.disabled = !bots.length || B.sending;
        bb.textContent = B.sending ? "⏳ Надсилаю…" : bots.length ? `🤖 Надіслати ботом зараз (${bots.length})` : "🤖 Усім у боті надіслано";
        bx.querySelector(".fmsg-who").textContent = `обрано ${B.list.filter((x) => x.on).length} · надіслано ${B.list.filter((x) => x.done).length}`;
        bx.querySelector(".fmsg-list").innerHTML = B.list.map((x, i) => `<label class="fmsg-it ${x.done ? "done" : ""}">
            <input type="checkbox" data-bi="${i}" ${x.on ? "checked" : ""} ${x.done ? "disabled" : ""}>
            <span class="fmsg-itn"><b>${esc(x.carrier || "—")}</b>${x.person ? ` · ${esc(x.person)}` : ""}<small>+${esc(x.phone)}</small>${x.bot ? '<em class="fmsg-botb">🤖 у боті</em>' : ""}${x.err ? `<em class="fmsg-err">${esc(x.err)}</em>` : ""}</span>
            ${x.done ? `<span class="fmsg-ok">✓ ${x.viaBot ? "надіслано ботом" : "відкрито"}</span>` : x.bot && B.useBot ? '<span class="fmsg-ok" style="color:#2aa3df">чекає бота</span>' : `<button type="button" class="fmsg-one" data-bone="${i}" title="Відкрити саме цей чат">відкрити</button>`}</label>`).join("") || '<div class="fmsg-note">Немає перевізників з номером телефону.</div>';
        const nb = bx.querySelector(".fmsg-next");
        nb.className = `fmsg-go ${app() === "tg" ? "fmsg-go-tg" : "fmsg-go-vb"} fmsg-next`;
        bx.querySelector(".fmsg-how").innerHTML = app() === "vbf"
            ? "Viber відкриє «Поділитися» з усім текстом: у пошуку введіть номер чи ім'я перевізника (його номер — у списку вище), оберіть і «Надіслати». Працює для тих, хто є у ваших контактах Viber або з ким ви вже переписувались."
            : "Натисніть кнопку — відкриється чат перевізника. Текст скопійовано: клацніть у поле, Cmd+V, «Надіслати» (текст до 100 символів Viber вставить сам). Поверніться сюди — наступний.";
        nb.disabled = !left.length;
        nb.textContent = left.length ? `▶ Відкрити ${app() === "tg" ? "Telegram" : app() === "vbf" ? "Viber «Поділитися»" : "Viber"}: ${left[0].carrier || "+" + left[0].phone} (залишилось ${left.length})` : "✓ Усім обраним відкрито";
    }
    async function sendBots() {
        const bots = B.list.filter((x) => x.on && !x.done && x.bot);
        if (!bots.length) return;
        B.sending = true; brender();
        try {
            const r = await agent({ action: "direct_send", request_id: B.ctx.request_id || undefined, my_request_id: B.ctx.my_request_id || undefined,
                items: bots.map((x) => ({ carrier_id: x.carrier_id, text: personal(x) })) });
            for (const res of r?.results || []) {
                const x = bots.find((y) => String(y.carrier_id) === String(res.carrier_id));
                if (!x) continue;
                if (res.ok) { x.done = true; x.viaBot = true; } else { x.bot = false; x.err = res.error; } // не вийшло — лишаємо в ручній черзі
            }
            say(`Бот надіслав: ${r?.sent || 0}. Відповіді прийдуть вам у Telegram.`);
        } catch (e) { say("Бот не надіслав: " + e.message); }
        B.sending = false; brender();
    }
    async function openOne(x) {
        const text = x.bot ? personal(x) : withJoin(personal(x));
        await copy(text);
        const url = app() === "tg" ? `https://t.me/+${x.phone}?text=${encodeURIComponent(text)}` : app() === "vbf" ? `viber://forward?text=${encodeURIComponent(text)}` : vbUrl(x.phone, text);
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
        if (k === "bot") return sendBots();
        if (k === "next") { const x = B.list.find((y) => y.on && !y.done && !(y.bot && B.useBot)); if (x) openOne(x); }
    });
    // list = [{ carrier, person, phone }], ctx = { route, cargo, truck, date }
    window.furaMsgBatch = (list, ctx = {}) => {
        bmount();
        const seen = new Set();
        B = { ctx, useBot: true, list: list.map((x) => ({ ...x, phone: digits(x.phone), on: true, done: false })).filter((x) => x.phone.length >= 10 && !seen.has(x.phone) && seen.add(x.phone)) };
        // хто вже підключений до Telegram-бота FURA — тим надішле бот сам
        const ids = [...new Set(B.list.map((x) => x.carrier_id).filter(Boolean).map(String))];
        if (ids.length && sbc()) {
            sbc().from("carriers").select("id, tg_chat_id").in("id", ids).then(({ data }) => {
                const on = new Set((data || []).filter((c) => c.tg_chat_id).map((c) => String(c.id)));
                B.list.forEach((x) => { x.bot = on.has(String(x.carrier_id || "")); });
                brender();
            }, () => {});
        }
        joinLink();
        // текст уже з маршрутом/вантажем; лишається тільки [ІМʼЯ] — для кожного своє
        bx.querySelector(".fmsg-btext").value = build({ ...ctx, person: "\u0001" }).replace(/, \u0001/g, "{, [ІМʼЯ]}").replace(/\u0001/g, "[ІМʼЯ]");
        try { const a = localStorage.getItem("fura_msg_app"); if (a) bx.querySelector(`[name="fmsgApp"][value="${a}"]`).checked = true; } catch (_) { /* */ }
        bx.hidden = false;
        brender();
    };
    window.furaMsgDigits = digits;
})();
