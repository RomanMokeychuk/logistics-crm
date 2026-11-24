/* ================================================================= *
 * FURA — телефон: нижня панель, файли через «Поділитися», зум фото    *
 *  • Нижня панель (≤ 900px): Назад · Вперед · Головна · Пошук ·       *
 *    Фурик · Меню — як у звичайних застосунках.                       *
 *  • «Завантажити» на телефоні відкриває меню «Поділитися»: зберегти  *
 *    у Фото / Файли, надіслати у Viber, Telegram, пошту.              *
 *  • Фото (переписка, пошта, CMR) — на весь екран, збільшуються       *
 *    двома пальцями або подвійним дотиком.                            *
 * ================================================================= */
(function () {
    if (window.furaMobileKit) return;
    window.furaMobileKit = true;

    const narrow = matchMedia("(max-width: 900px)");
    const touch = matchMedia("(pointer: coarse)");
    const isPhone = () => narrow.matches || touch.matches;
    const isTouch = () => touch.matches;
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

    /* ---------------------------------------------------------------- *
     * 1. Файли: «Поділитися» замість мовчазного збереження в «Файли»   *
     * ---------------------------------------------------------------- */
    const canShareFiles = () => {
        try {
            return !!(navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.txt", { type: "text/plain" })] }));
        } catch (e) {
            return false;
        }
    };
    const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", heic: "image/heic", csv: "text/csv", txt: "text/plain", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword", zip: "application/zip" };
    const typeOfName = (name, fallback) => MIME[String(name || "").split(".").pop().toLowerCase()] || fallback || "application/octet-stream";

    let sheet = null;
    function closeSheet() {
        sheet?.remove();
        sheet = null;
    }
    // Якщо телефон не дав відкрити «Поділитися» одразу (минуло багато часу після дотику) — кнопка, яку треба натиснути ще раз
    function offerSheet(file) {
        closeSheet();
        sheet = document.createElement("div");
        sheet.className = "mk-sheet";
        sheet.innerHTML = `<div class="mk-sheet-card">
            <div class="mk-sheet-name"><i class="bx bx-file"></i> ${esc(file.name)}</div>
            <button type="button" class="mk-sheet-go" data-mk="share"><i class="bx bx-share"></i> Зберегти або надіслати</button>
            <button type="button" class="mk-sheet-x" data-mk="close">Закрити</button></div>`;
        sheet.addEventListener("click", (e) => {
            const b = e.target.closest("[data-mk]");
            if (e.target === sheet || b?.dataset.mk === "close") return closeSheet();
            if (b?.dataset.mk === "share")
                navigator.share({ files: [file], title: file.name }).then(closeSheet, (err) => {
                    if (err?.name === "AbortError") closeSheet();
                });
        });
        document.body.appendChild(sheet);
    }
    async function saveFile(blob, name) {
        const file = blob instanceof File && blob.name ? blob : new File([blob], name || "файл", { type: blob.type || typeOfName(name) });
        if (!canShareFiles() || !navigator.canShare({ files: [file] })) return false;
        try {
            await navigator.share({ files: [file], title: file.name });
        } catch (err) {
            if (err?.name !== "AbortError") offerSheet(file);
        }
        return true;
    }
    window.furaSaveFile = async (blob, name) => {
        if (isTouch() && (await saveFile(blob, name))) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name || "файл";
        origClick.call(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };
    async function shareHref(href, name) {
        try {
            const res = await fetch(href);
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            const type = blob.type && blob.type !== "application/octet-stream" ? blob.type : typeOfName(name);
            return await saveFile(new File([blob], name || "файл", { type }), name);
        } catch (e) {
            return false;
        }
    }
    // Будь-яке «завантажити» (<a download>), навіть створене кодом і натиснуте через .click()
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        if (this.hasAttribute("download") && this.href && isTouch() && canShareFiles()) {
            const a = this;
            shareHref(a.href, a.getAttribute("download") || "").then((ok) => {
                if (!ok) origClick.call(a);
            });
            return;
        }
        return origClick.call(this);
    };
    document.addEventListener(
        "click",
        (e) => {
            const a = e.target.closest?.("a[download]");
            if (!a || !a.href || !isTouch() || !canShareFiles() || a.dataset.mkPass) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            shareHref(a.href, a.getAttribute("download") || "").then((ok) => {
                if (!ok) {
                    a.dataset.mkPass = "1";
                    origClick.call(a);
                    delete a.dataset.mkPass;
                }
            });
        },
        true,
    );

    /* ---------------------------------------------------------------- *
     * 2. Перегляд фото на весь екран зі збільшенням                    *
     * ---------------------------------------------------------------- */
    const SKIP_IMG = ".sidebar, .fura-sidebar, .fura-topbar, .mk-bar, .fk, .fh-fab, button:not(.sa-mr-att), .home-company-logo, .gd-logo, [data-no-zoom], .mk-viewer";
    function zoomable(img) {
        if (!img || img.tagName !== "IMG" || img.closest(SKIP_IMG)) return false;
        if (/\.svg(\?|$)/i.test(img.currentSrc || img.src || "")) return false;
        const r = img.getBoundingClientRect();
        return r.width >= 56 && r.height >= 40 && (img.naturalWidth || 0) >= 120;
    }
    let viewer = null;
    function openViewer(src, name) {
        closeViewer(true);
        viewer = document.createElement("div");
        viewer.className = "mk-viewer";
        viewer.innerHTML = `
            <div class="mk-v-stage"><img class="mk-v-img" alt="" draggable="false" /></div>
            <div class="mk-v-top">
                <button type="button" class="mk-v-btn" data-v="close" aria-label="Закрити"><i class="bx bx-x"></i></button>
                <span class="mk-v-hint">Двома пальцями — збільшити</span>
                <button type="button" class="mk-v-btn" data-v="save" aria-label="Зберегти або надіслати"><i class="bx bx-share"></i></button>
            </div>`;
        const img = viewer.querySelector(".mk-v-img");
        img.src = src;
        document.body.appendChild(viewer);
        document.documentElement.classList.add("mk-noscroll");
        try {
            history.pushState({ mkViewer: 1 }, "");
        } catch (e) {
            /* без історії */
        }

        // масштаб і зсув
        let s = 1, x = 0, y = 0;
        const pts = new Map();
        let start = null, lastTap = 0;
        const apply = (anim) => {
            img.style.transition = anim ? "transform .2s ease" : "none";
            img.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
        };
        const clamp = () => {
            if (s <= 1) { s = 1; x = 0; y = 0; return; }
            const r = img.getBoundingClientRect(), W = innerWidth, H = innerHeight;
            const w = r.width, h = r.height;
            const maxX = Math.max(0, (w - W) / 2), maxY = Math.max(0, (h - H) / 2);
            x = Math.max(-maxX, Math.min(maxX, x));
            y = Math.max(-maxY, Math.min(maxY, y));
        };
        const stage = viewer.querySelector(".mk-v-stage");
        stage.addEventListener("pointerdown", (e) => {
            stage.setPointerCapture(e.pointerId);
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const p = [...pts.values()];
            if (p.length === 2) start = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), s, x, y, cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2 };
            else if (p.length === 1) {
                start = { px: e.clientX, py: e.clientY, x, y };
                const now = Date.now();
                if (now - lastTap < 280) {
                    // подвійний дотик: збільшити в місці дотику / повернути
                    if (s > 1) { s = 1; x = 0; y = 0; }
                    else { s = 2.5; x = (innerWidth / 2 - e.clientX) * 1.5; y = (innerHeight / 2 - e.clientY) * 1.5; clamp(); }
                    apply(true);
                    lastTap = 0;
                } else lastTap = now;
            }
        });
        stage.addEventListener("pointermove", (e) => {
            if (!pts.has(e.pointerId)) return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const p = [...pts.values()];
            if (p.length >= 2 && start?.d) {
                const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
                s = Math.max(1, Math.min(6, start.s * (d / start.d)));
                const cx = (p[0].x + p[1].x) / 2, cy = (p[0].y + p[1].y) / 2;
                x = start.x + (cx - start.cx);
                y = start.y + (cy - start.cy);
                apply(false);
            } else if (p.length === 1 && start && "px" in start && s > 1) {
                x = start.x + (e.clientX - start.px);
                y = start.y + (e.clientY - start.py);
                apply(false);
            }
        });
        const end = (e) => {
            pts.delete(e.pointerId);
            if (pts.size === 1) {
                const p = [...pts.values()][0];
                start = { px: p.x, py: p.y, x, y };
            } else if (!pts.size) {
                clamp();
                apply(true);
                start = null;
            }
        };
        stage.addEventListener("pointerup", end);
        stage.addEventListener("pointercancel", end);
        // колесо / тачпад на ПК
        stage.addEventListener("wheel", (e) => {
            e.preventDefault();
            s = Math.max(1, Math.min(6, s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
            clamp();
            apply(false);
        }, { passive: false });

        viewer.addEventListener("click", async (e) => {
            const b = e.target.closest("[data-v]");
            if (!b) return;
            if (b.dataset.v === "close") return closeViewer();
            if (b.dataset.v === "save") {
                const nm = name || (decodeURIComponent((src.split("?")[0].split("/").pop() || "").replace(/^\d+_/, "")) || "фото.jpg");
                if (!(await shareHref(src, /\.\w{2,4}$/.test(nm) ? nm : nm + ".jpg"))) window.open(src, "_blank");
            }
        });
    }
    function closeViewer(silent) {
        if (!viewer) return;
        viewer.remove();
        viewer = null;
        document.documentElement.classList.remove("mk-noscroll");
        if (!silent && history.state?.mkViewer) history.back();
    }
    addEventListener("popstate", () => {
        if (viewer) closeViewer(true);
    });
    addEventListener("keydown", (e) => {
        if (e.key === "Escape" && viewer) closeViewer();
    });
    document.addEventListener(
        "click",
        (e) => {
            if (!isPhone()) return;
            const img = e.target.closest?.("img");
            if (!zoomable(img)) return;
            const a = img.closest("a");
            // посилання на іншу сторінку (не на сам файл) — не чіпаємо
            if (a && a.getAttribute("href") && !/^#|\.(png|jpe?g|webp|gif|heic)(\?|$)|storage\/v1|blob:|data:image/i.test(a.getAttribute("href"))) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            openViewer(img.currentSrc || img.src, img.getAttribute("alt") || "");
        },
        true,
    );
    window.furaZoomImage = openViewer;

    /* ---------------------------------------------------------------- *
     * 3. Нижня панель на телефоні                                      *
     * ---------------------------------------------------------------- */
    const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const NO_BAR = /^(login|cabinet|tg-answer|tg-request|truck)\.html$/;
    function buildBar() {
        if (window.top !== window.self || NO_BAR.test(page) || document.querySelector(".mk-bar") || !document.querySelector("main.main-content")) return;
        const bar = document.createElement("nav");
        bar.className = "mk-bar";
        bar.setAttribute("aria-label", "Навігація");
        bar.innerHTML = `
            <button type="button" data-mk="back" aria-label="Назад"><i class="bx bx-chevron-left"></i><span>Назад</span></button>
            <button type="button" data-mk="fwd" aria-label="Вперед"><i class="bx bx-chevron-right"></i><span>Вперед</span></button>
            <a href="home.html" data-mk="home" class="${page === "home.html" ? "on" : ""}"><i class="bx bx-home-alt"></i><span>Головна</span></a>
            <button type="button" data-mk="helper" aria-label="Пошук перевізника"><i class="bx bx-search-alt"></i><span>Пошук</span></button>
            <button type="button" data-mk="furik" aria-label="Фурик"><i class="bx bx-bell"></i><span>Фурик</span><b class="mk-badge" hidden></b></button>
            <button type="button" data-mk="menu" aria-label="Меню"><i class="bx bx-menu"></i><span>Меню</span></button>`;
        document.body.appendChild(bar);
        const nav = window.navigation;
        const sync = () => {
            const back = bar.querySelector('[data-mk="back"]'), fwd = bar.querySelector('[data-mk="fwd"]');
            if (nav && typeof nav.canGoBack === "boolean") {
                back.classList.toggle("off", !nav.canGoBack && page === "home.html");
                fwd.classList.toggle("off", !nav.canGoForward);
            }
            bar.querySelector('[data-mk="helper"]').hidden = !document.querySelector(".fh-fab");
            bar.querySelector('[data-mk="furik"]').hidden = !document.querySelector(".fk-me");
            const fb = document.querySelector(".fk-badge");
            const mb = bar.querySelector(".mk-badge");
            mb.hidden = !fb || fb.hidden;
            if (fb) mb.textContent = fb.textContent;
        };
        sync();
        nav?.addEventListener?.("currententrychange", sync);
        setInterval(sync, 1500);
        bar.addEventListener("click", (e) => {
            const b = e.target.closest("[data-mk]");
            if (!b) return;
            const k = b.dataset.mk;
            if (k === "home") return;
            e.preventDefault();
            if (k === "back") {
                if (nav && typeof nav.canGoBack === "boolean" ? nav.canGoBack : history.length > 1) history.back();
                else if (page !== "home.html") location.href = "home.html";
            }
            if (k === "fwd") history.forward();
            if (k === "helper") document.querySelector(".fh-fab")?.click();
            if (k === "furik") document.querySelector(".fk-me")?.click();
            if (k === "menu") (document.getElementById("furaBurger") || document.querySelector(".fura-burger"))?.click();
        });
        // відкрито клавіатуру (друкуємо) — панель ховаємо, щоб не заважала
        document.addEventListener("focusin", (e) => {
            if (e.target.matches?.("input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select, [contenteditable]")) document.body.classList.add("mk-typing");
        });
        document.addEventListener("focusout", () => setTimeout(() => {
            const a = document.activeElement;
            if (!a || !a.matches?.("input, textarea, select, [contenteditable]")) document.body.classList.remove("mk-typing");
        }, 120));
    }

    const css = document.createElement("style");
    css.textContent = `
    .mk-bar { display: none; }
    @media (max-width: 900px) {
        .mk-bar {
            display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
            position: fixed; left: 0; right: 0; bottom: 0; z-index: 900;
            padding: 4px 4px calc(4px + env(safe-area-inset-bottom));
            background: rgba(255, 255, 255, .94); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
            border-top: 1px solid rgba(214, 168, 72, .35); box-shadow: 0 -6px 24px rgba(15, 23, 42, .08);
        }
        .mk-bar > [hidden] { display: none !important; }
        .mk-bar > a, .mk-bar > button {
            position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
            min-height: 50px; border: 0; background: none; border-radius: 12px; color: #4b5563; text-decoration: none;
            font: 600 10.5px/1.1 inherit; -webkit-tap-highlight-color: transparent; cursor: pointer; padding: 0;
        }
        .mk-bar i { font-size: 23px; line-height: 1; }
        .mk-bar > :active { background: #f6efe1; }
        .mk-bar > .on { color: #8a6412; }
        .mk-bar > .off { opacity: .35; }
        .mk-badge { position: absolute; top: 3px; left: 54%; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: #e11d48; color: #fff; font-size: 10.5px; line-height: 17px; text-align: center; }
        body.mk-typing .mk-bar, body.fura-menu-open .mk-bar { display: none; }
        /* панель знизу замінює плаваючі кнопки, бургер і стрілки вгорі */
        body:has(.mk-bar) .fh-fab, body:has(.mk-bar) .fk-me { display: none !important; }
        body:has(.mk-bar) .fk { right: 10px !important; bottom: calc(66px + env(safe-area-inset-bottom)) !important; transform: none !important; }
        body:has(.mk-bar) .fura-topbar .fura-burger, body:has(.mk-bar) .fura-topbar .fura-nav-arrows { display: none !important; }
        body:has(.mk-bar) main.main-content { padding-bottom: calc(80px + env(safe-area-inset-bottom)) !important; }
        .mk-dup { display: none !important; }
        body:has(.mk-bar) .fura-toasts { bottom: calc(70px + env(safe-area-inset-bottom)) !important; }
    }
    .mk-noscroll, .mk-noscroll body { overflow: hidden !important; }
    .mk-viewer { position: fixed; inset: 0; z-index: 2147483500; background: #000; touch-action: none; user-select: none; -webkit-user-select: none; }
    .mk-v-stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; touch-action: none; }
    .mk-v-img { max-width: 100%; max-height: 100%; object-fit: contain; transform-origin: center center; will-change: transform; -webkit-user-drag: none; }
    .mk-v-top { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: calc(10px + env(safe-area-inset-top)) 12px 10px; background: linear-gradient(rgba(0,0,0,.65), transparent); pointer-events: none; }
    .mk-v-top > * { pointer-events: auto; }
    .mk-v-btn { width: 44px; height: 44px; border-radius: 50%; border: 0; background: rgba(255,255,255,.16); color: #fff; font-size: 24px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .mk-v-hint { color: rgba(255,255,255,.75); font-size: 12.5px; }
    .mk-sheet { position: fixed; inset: 0; z-index: 2147483600; background: rgba(15,23,42,.45); display: flex; align-items: flex-end; justify-content: center; }
    .mk-sheet-card { width: 100%; max-width: 480px; background: #fff; border-radius: 18px 18px 0 0; padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; }
    .mk-sheet-name { font-weight: 700; color: #1f2937; display: flex; gap: 8px; align-items: center; word-break: break-all; }
    .mk-sheet-go { min-height: 48px; border: 0; border-radius: 12px; background: linear-gradient(135deg, #d9a944, #b8862a); color: #fff; font: 700 15px inherit; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
    .mk-sheet-x { min-height: 44px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; color: #374151; font: 600 14px inherit; }`;
    document.head.appendChild(css);

    // Заголовок сторінки дублює назву у шапці — на телефоні ховаємо його, щоб звільнити місце
    function dedupeTitle() {
        const box = document.getElementById("furaCrumbs");
        const crumb = box?.lastElementChild || box;
        const t = (crumb?.textContent || "").trim().toLowerCase();
        if (!t) return;
        document.querySelectorAll("main.main-content .top-bar h1, main.main-content .nb-title h1, main.main-content > header h1").forEach((h) => {
            h.classList.toggle("mk-dup", h.textContent.trim().toLowerCase() === t && !h.querySelector("button, input, select, a"));
        });
    }
    const ready = () => {
        buildBar();
        dedupeTitle();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
    else ready();
    // меню й шапка з'являються трохи пізніше (shell.js)
    setTimeout(ready, 800);
    setTimeout(dedupeTitle, 2500);
})();
