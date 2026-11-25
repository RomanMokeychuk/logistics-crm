/* ================================================================= *
 * FURA — НОМЕР ТЕЛЕФОНУ → ДЗВІНОК / VIBER / WHATSAPP / TELEGRAM       *
 * Скрізь, де біля номера є іконка Viber, з'являються ще іконки        *
 * 📞 · WhatsApp · Telegram (сірі; при наведенні — кольорові).          *
 * Клік по самому номеру — віконце з вибором, куди писати/дзвонити.    *
 * ================================================================= */
(function () {
    if (window.furaPhoneLinks) return;
    window.furaPhoneLinks = true;

    const norm = (v) => {
        let d = String(v || "").replace(/\D/g, "");
        if (d.length === 10 && d.startsWith("0")) d = "38" + d;
        if (d.length === 9) d = "380" + d;
        return d.length >= 10 && d.length <= 15 ? d : "";
    };
    const links = (d) => ({
        tel: `tel:+${d}`,
        viber: `viber://chat?number=%2B${d}`,
        wa: `https://wa.me/${d}`,
        tg: `tg://resolve?phone=${d}`,
    });
    const ICONS = {
        tel: ["bx bxs-phone", "Подзвонити"],
        viber: ["bx bxs-message-rounded-dots", "Viber"],
        wa: ["bx bxl-whatsapp", "WhatsApp"],
        tg: ["bx bxl-telegram", "Telegram"],
    };
    const groupHtml = (d) => {
        const l = links(d);
        return ["tel", "viber", "wa", "tg"].map((k) =>
            `<a class="fm-ico fm-${k}" href="${l[k]}"${k === "wa" ? ' target="_blank" rel="noopener"' : ""} title="${ICONS[k][1]}: +${d}" data-fm="${k}"><i class="${ICONS[k][0]}"></i></a>`).join("");
    };

    // Іконку Viber біля номера перетворюємо на групу з 4 іконок; сам номер робимо натискним
    function upgrade(root) {
        root.querySelectorAll('a[href^="viber://chat?number="]:not([data-fm]):not([data-fm-done])').forEach((a) => {
            if (a.closest(".fm-group, .fm-pop")) return;
            const d = norm(decodeURIComponent((a.getAttribute("href").match(/number=([^&]+)/) || [])[1] || ""));
            a.dataset.fmDone = "1";
            if (!d) return;
            const g = document.createElement("span");
            g.className = "fm-group";
            g.innerHTML = groupHtml(d);
            a.replaceWith(g);
            // номер перед іконками → натискний (віконце з вибором)
            let prev = g.previousSibling;
            while (prev && prev.nodeType === 3 && !prev.textContent.trim()) prev = prev.previousSibling;
            if (prev && prev.nodeType === 3 && norm(prev.textContent) === d) {
                const s = document.createElement("span");
                s.className = "fm-num";
                s.dataset.fmPhone = d;
                s.textContent = prev.textContent.trim();
                s.title = "Натисніть: подзвонити або написати у Viber / WhatsApp / Telegram";
                prev.replaceWith(" ", s, " ");
            } else if (prev && prev.nodeType === 1 && !prev.dataset.fmPhone && norm(prev.textContent) === d) {
                prev.classList.add("fm-num");
                prev.dataset.fmPhone = d;
            }
        });
    }

    let pop = null;
    function closePop() { pop?.remove(); pop = null; }
    function openPop(el, d) {
        closePop();
        const l = links(d);
        pop = document.createElement("div");
        pop.className = "fm-pop";
        pop.innerHTML = `<div class="fm-pop-num">+${d.replace(/^(\d{3})(\d{2})(\d{3})(\d{2})(\d{2})$/, "$1 $2 $3 $4 $5")}</div>
            <a href="${l.tel}" data-fm="tel" class="fm-row fm-tel"><i class="${ICONS.tel[0]}"></i> Подзвонити</a>
            <a href="${l.viber}" data-fm="viber" class="fm-row fm-viber"><i class="${ICONS.viber[0]}"></i> Viber</a>
            <a href="${l.wa}" target="_blank" rel="noopener" data-fm="wa" class="fm-row fm-wa"><i class="${ICONS.wa[0]}"></i> WhatsApp</a>
            <a href="${l.tg}" data-fm="tg" class="fm-row fm-tg"><i class="${ICONS.tg[0]}"></i> Telegram</a>
            <button type="button" class="fm-row fm-copy"><i class="bx bx-copy"></i> Копіювати номер</button>`;
        document.body.appendChild(pop);
        const r = el.getBoundingClientRect();
        pop.style.top = `${Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 6)}px`;
        pop.style.left = `${Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left))}px`;
        pop.querySelector(".fm-copy").onclick = async (e) => {
            try { await navigator.clipboard.writeText("+" + d); e.currentTarget.innerHTML = `<i class="bx bx-check"></i> Скопійовано`; } catch (err) { /* */ }
            setTimeout(closePop, 700);
        };
        pop.addEventListener("click", (e) => { if (e.target.closest("a")) setTimeout(closePop, 100); });
    }
    // клік по номеру або по іконці — не відкриваємо картку рядка під ним
    document.addEventListener("click", (e) => {
        const ico = e.target.closest(".fm-ico");
        if (ico) { e.stopPropagation(); return; }
        const num = e.target.closest("[data-fm-phone]");
        if (num) {
            e.preventDefault();
            e.stopPropagation();
            if (pop && pop.dataset.for === num.dataset.fmPhone) return closePop();
            openPop(num, num.dataset.fmPhone);
            pop.dataset.for = num.dataset.fmPhone;
            return;
        }
        if (pop && !e.target.closest(".fm-pop")) closePop();
    }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });
    addEventListener("scroll", closePop, true);

    let t = 0;
    const run = () => { clearTimeout(t); t = setTimeout(() => upgrade(document.body), 60); };
    new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
    if (document.body) upgrade(document.body); else document.addEventListener("DOMContentLoaded", () => upgrade(document.body));

    /* ---------- Viber з готовим текстом ----------
     * Сайт не може сам натиснути «Надіслати» і не може вписати довгий текст у Viber:
     * Viber приймає в посиланні лише короткий текст (~100 символів).
     * Тому: короткий текст — одразу в полі; довгий — копіюємо, відкриваємо чат і підказуємо «Cmd+V → Enter». */
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS/.test(navigator.userAgent);
    const touch = matchMedia("(pointer: coarse)").matches;
    function copyText(t) {
        let ok = false;
        try {
            const ta = document.createElement("textarea");
            ta.value = t; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
            document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length);
            ok = document.execCommand("copy"); ta.remove();
        } catch (_) { /* */ }
        try { navigator.clipboard?.writeText(t).catch(() => {}); ok = true; } catch (_) { /* */ }
        return ok;
    }
    const SHORT = 95;
    function viberHint(text, d, drafted) {
        document.querySelector(".fv-hint")?.remove();
        const h = document.createElement("div");
        h.className = "fv-hint";
        const paste = touch ? "утримуйте палець на полі повідомлення → <b>«Вставити»</b>" : `клікніть у поле повідомлення → <b>${isMac ? "⌘ Cmd + V" : "Ctrl + V"}</b>`;
        h.innerHTML = `<button type="button" class="fv-x" title="Закрити">✕</button>
            <div class="fv-t">📋 Текст скопійовано (${text.length} символів)</div>
            ${drafted ? `<ol><li>Відкрився чат у Viber${d ? " з +" + d : ""}, текст має стояти в полі</li><li>Якщо текст <b>обрізаний</b>: клікніть у поле → <b>${isMac ? "⌘A, потім ⌘V" : "Ctrl+A, потім Ctrl+V"}</b></li><li>Натисніть <b>${touch ? "➤ Надіслати" : "Enter"}</b></li></ol>`
                : `<ol><li>Відкрився чат у Viber${d ? " з +" + d : ""}</li><li>${paste}</li><li>Натисніть <b>${touch ? "➤ Надіслати" : "Enter"}</b></li></ol>`}
            <div class="fv-b"><button type="button" class="fv-again">📋 Скопіювати ще раз</button>${d ? `<a class="fv-open" href="viber://chat?number=%2B${d}">Відкрити чат знову</a>` : ""}</div>`;
        document.body.appendChild(h);
        h.addEventListener("click", (e) => {
            if (e.target.closest(".fv-x")) h.remove();
            if (e.target.closest(".fv-again")) { copyText(text); e.target.textContent = "✓ Скопійовано"; setTimeout(() => (e.target.textContent = "📋 Скопіювати ще раз"), 1200); }
        });
        clearTimeout(viberHint.t);
        viberHint.t = setTimeout(() => h.remove(), 45000);
    }
    // furaViber("380671234567", "текст") — відкрити чат з текстом; повертає true, якщо текст ліг у поле сам
    // Налаштування «вставляти довгий текст прямо в поле» — деякі версії Viber Desktop приймають довгу чернетку
    const longDraft = () => { try { return localStorage.getItem("fura_viber_long_draft") === "1"; } catch (_) { return false; } };
    window.furaViberLongDraft = (v) => { try { if (v === undefined) return longDraft(); localStorage.setItem("fura_viber_long_draft", v ? "1" : "0"); } catch (_) { /* */ } return !!v; };
    window.furaViber = (digits, text, opts = {}) => {
        const d = norm(digits);
        text = String(text || "").trim();
        if (!d) return false;
        // Viber бере в поле лише ~100 символів (перевірено на Viber для Mac) — довший текст не вставляємо, щоб не відправити обрізаний
        const short = text && text.length <= SHORT;
        const draft = short;
        if (text) copyText(text);
        location.href = `viber://chat?number=%2B${d}${draft ? "&draft=" + encodeURIComponent(text) + "&text=" + encodeURIComponent(text) : ""}`; // різні версії Viber читають draft або text
        if (text && !short && !opts.quiet) viberHint(text, d, draft);
        return short;
    };
    window.furaCopyText = copyText;
    // Короткий текст пропозиції (щоб разом із «Доброго вечора, Олександр!» влізло в ~95 символів —
    // тоді Viber вставляє його в поле сам, без ⌘V)
    window.furaShortOffer = (r, max = 66) => {
        r = r || {};
        const city = (addr, cc) => String(addr || "").split(/[,(]/)[0].replace(/\s+/g, " ").trim() || String(cc || "").trim();
        const from = city(r.load_address, r.load_country), to = city(r.unload_address, r.unload_country);
        const dm = (d) => (d ? String(d).slice(8, 10) + "." + String(d).slice(5, 7) : "");
        const date = r.desired_date ? (r.desired_date_to && r.desired_date_to !== r.desired_date ? `${dm(r.desired_date)}–${dm(r.desired_date_to)}` : dm(r.desired_date)) : "";
        const tr = String(r.transport_type || "").split(/[,;/]/)[0].trim().toLowerCase();
        const w = String(r.weight || "").trim();
        const parts = [from && to ? `${from}→${to}` : from || to, tr, w, date && "завант. " + date].filter(Boolean);
        const make = (p) => `${p.join(", ")}. Ставка?`;
        while (parts.length > 1 && make(parts).length > max) parts.splice(parts.length - (parts.length > 2 ? 2 : 1), 1);
        let t = make(parts);
        if (t.length > max) t = t.slice(0, max - 1) + "…";
        return t;
    };

    const css = document.createElement("style");
    css.textContent = `
    .fm-group { display: inline-flex; align-items: center; gap: 3px; margin-left: 6px; vertical-align: middle; white-space: nowrap; }
    .fm-ico { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 7px; background: #eef0f3; color: #8a919c; font-size: 14px; text-decoration: none !important; transition: background .15s, color .15s, transform .1s; }
    .fm-ico:hover { color: #fff; transform: translateY(-1px); }
    .fm-ico.fm-tel:hover { background: #2563eb; }
    .fm-ico.fm-viber:hover { background: #7360f2; }
    .fm-ico.fm-wa:hover { background: #25d366; }
    .fm-ico.fm-tg:hover { background: #229ed9; }
    .fm-num { cursor: pointer; border-bottom: 1px dashed #c9ccd3; }
    .fm-num:hover { color: #7c5a12; border-bottom-color: #d9a944; }
    .fm-pop { position: fixed; z-index: 2147483300; min-width: 200px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 16px 40px rgba(15, 23, 42, .22); padding: 6px; display: flex; flex-direction: column; font-size: 13.5px; }
    .fm-pop-num { padding: 6px 10px 8px; font-weight: 700; color: #1f2937; border-bottom: 1px solid #f1f1f1; margin-bottom: 4px; font-variant-numeric: tabular-nums; }
    .fm-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; color: #1f2937 !important; text-decoration: none !important; border: 0; background: none; font: inherit; cursor: pointer; text-align: left; }
    .fm-row i { font-size: 18px; width: 20px; text-align: center; }
    .fm-row:hover { background: #f6f7f9; }
    .fv-hint { position: fixed; z-index: 2147483400; right: 18px; bottom: 18px; width: 330px; max-width: calc(100vw - 24px); background: #fff; border: 2px solid #7360f2; border-radius: 14px; box-shadow: 0 18px 44px rgba(15, 23, 42, .25); padding: 12px 14px; font-size: 13.5px; color: #1f2937; animation: fvIn .2s ease-out; }
    .fv-t { font-weight: 800; font-size: 14px; margin-bottom: 6px; padding-right: 20px; }
    .fv-hint ol { margin: 0 0 10px; padding-left: 20px; line-height: 1.6; }
    .fv-x { position: absolute; top: 8px; right: 8px; border: 0; background: none; font-size: 16px; color: #9ca3af; cursor: pointer; }
    .fv-b { display: flex; gap: 8px; flex-wrap: wrap; }
    .fv-again, .fv-open { border: 1px solid #ddd6fe; background: #f5f3ff; color: #5b21b6 !important; border-radius: 9px; padding: 6px 10px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; text-decoration: none !important; }
    @media (max-width: 760px) { .fv-hint { left: 12px; right: 12px; bottom: calc(76px + env(safe-area-inset-bottom)); width: auto; } }
    @keyframes fvIn { from { transform: translateY(20px); opacity: 0; } to { transform: none; opacity: 1; } }
    .fm-row.fm-tel i { color: #2563eb; } .fm-row.fm-viber i { color: #7360f2; } .fm-row.fm-wa i { color: #25d366; } .fm-row.fm-tg i { color: #229ed9; } .fm-row.fm-copy i { color: #6b7280; }
    `;
    document.head.appendChild(css);
})();
