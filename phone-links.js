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
    .fm-row.fm-tel i { color: #2563eb; } .fm-row.fm-viber i { color: #7360f2; } .fm-row.fm-wa i { color: #25d366; } .fm-row.fm-tg i { color: #229ed9; } .fm-row.fm-copy i { color: #6b7280; }
    `;
    document.head.appendChild(css);
})();
