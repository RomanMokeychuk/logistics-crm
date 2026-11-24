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
     * 2. Перегляд фото і PDF (телефон і комп'ютер):                    *
     *    збільшення (пальці, колесо, − +), поворот, «Текст» —           *
     *    розпізнати текст на фото / скані, щоб його можна було виділити *
     * ---------------------------------------------------------------- */
    const loadJs = (src) => new Promise((res, rej) => {
        if (document.querySelector(`script[src="${src}"]`)) return res();
        const sc = document.createElement("script");
        sc.src = src;
        sc.onload = res;
        sc.onerror = () => rej(new Error("Не вдалося завантажити модуль — перевірте інтернет"));
        document.head.appendChild(sc);
    });
    // ---- Розпізнавання тексту: Claude читає фото / скан як людина (fura-assistant → ocr) ----
    // полотно / картинка → JPEG base64 (не більше 2000 px по довшій стороні)
    function jpegOf(src) {
        const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
        const k = Math.min(1, 2000 / Math.max(W, H));
        const c = document.createElement("canvas");
        c.width = Math.round(W * k);
        c.height = Math.round(H * k);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(src, 0, 0, c.width, c.height);
        return c.toDataURL("image/jpeg", 0.88).split(",")[1];
    }
    async function aiText(sources) {
        const db = typeof sbClient !== "undefined" ? sbClient : null;
        if (!db) throw new Error("немає з'єднання з FURA");
        const images = sources.map((x) => ({ type: "image/jpeg", data: jpegOf(x) }));
        const { data, error } = await db.functions.invoke("fura-assistant", { body: { action: "ocr", images } });
        if (error) {
            let m = error.message;
            try { m = (await error.context?.json?.())?.error || m; } catch (e) { /* */ }
            throw new Error(m);
        }
        if (data?.error) throw new Error(data.error);
        return String(data?.text || "").trim() + (data?.cut ? "\n\n[…текст дуже довгий — показано не все]" : "");
    }
    // картинка за адресою → елемент, з якого можна читати пікселі
    async function drawable(img, src) {
        try {
            const c = document.createElement("canvas");
            c.width = 1; c.height = 1;
            c.getContext("2d").drawImage(img, 0, 0, 1, 1);
            c.getContext("2d").getImageData(0, 0, 1, 1);
            return img;
        } catch (e) {
            const blob = await (await fetch(src)).blob();
            return await createImageBitmap(blob);
        }
    }
    const pdfSel = () => String(getSelection?.() || "");
    // Увесь розпізнаний текст — окремим списком: виділити будь-що або «Скопіювати все»
    function textSheet(text) {
        document.querySelector(".mk-tsheet")?.remove();
        const sh = document.createElement("div");
        sh.className = "mk-tsheet";
        sh.innerHTML = `<div class="mk-tsheet-card">
            <div class="mk-tsheet-head"><b>Розпізнаний текст</b>
                <button type="button" data-ts="copy">Скопіювати все</button><button type="button" data-ts="x" aria-label="Закрити">✕</button></div>
            <div class="mk-tsheet-hint">Виділіть потрібне (утримуйте палець на слові) або скопіюйте все. Номери й VIN звіряйте з документом.</div>
            <pre class="mk-tsheet-text"></pre></div>`;
        sh.querySelector(".mk-tsheet-text").textContent = text || "Тексту не знайшов";
        sh.addEventListener("click", async (e) => {
            const b = e.target.closest("[data-ts]");
            if (e.target === sh || b?.dataset.ts === "x") return sh.remove();
            if (b?.dataset.ts === "copy") {
                try { await navigator.clipboard.writeText(text); b.textContent = "Скопійовано ✓"; }
                catch (err) { const r = document.createRange(); r.selectNodeContents(sh.querySelector(".mk-tsheet-text")); getSelection().removeAllRanges(); getSelection().addRange(r); b.textContent = "Виділено — натисніть «Копіювати»"; }
            }
        });
        document.body.appendChild(sh);
    }

    // ---- Фото: збільшення, зсув, поворот, текст ----
    function imgView(box, src, opts = {}) {
        box.innerHTML = `<div class="mk-iv">
            <div class="mk-bar2">
                ${opts.onClose ? `<button type="button" data-iv="close" aria-label="Закрити"><i class="bx bx-x"></i></button>` : ""}
                <button type="button" data-iv="-" aria-label="Зменшити">−</button><span class="mk-z">100%</span><button type="button" data-iv="+" aria-label="Збільшити">+</button>
                <button type="button" data-iv="rot" aria-label="Повернути"><i class="bx bx-rotate-right"></i></button>
                <button type="button" data-iv="ocr" class="mk-ocr-btn" title="Розпізнати текст на фото — виділити й скопіювати"><b>T</b> Текст</button>
                ${opts.save ? `<button type="button" data-iv="save" aria-label="Зберегти або надіслати"><i class="bx bx-share"></i></button>` : ""}
            </div>
            <div class="mk-iv-stage"><div class="mk-iv-wrap"><img class="mk-iv-img" alt="" draggable="false" crossorigin="anonymous" /></div></div>
            <div class="mk-iv-msg" hidden></div></div>`;
        const stage = box.querySelector(".mk-iv-stage"), wrap = box.querySelector(".mk-iv-wrap"), img = box.querySelector(".mk-iv-img"), msg = box.querySelector(".mk-iv-msg");
        img.onerror = () => { if (img.crossOrigin) { img.removeAttribute("crossorigin"); img.src = src; } };
        img.src = src;
        let s = 1, x = 0, y = 0, rot = 0, lastText = null;
        const fit = () => {
            // повернуто на 90/270 — вписуємо «лежачу» картинку в екран
            if (rot % 180 === 0) return 1;
            const w = img.offsetWidth, h = img.offsetHeight, SW = stage.clientWidth, SH = stage.clientHeight;
            return w && h ? Math.min(SW / h, SH / w) : 1;
        };
        const apply = (anim) => {
            wrap.style.transition = anim ? "transform .2s ease" : "none";
            wrap.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${s * fit()})`;
            box.querySelector(".mk-z").textContent = Math.round(s * 100) + "%";
        };
        const clamp = () => {
            if (s <= 1) { s = Math.max(1, s); if (s === 1) { x = 0; y = 0; } return; }
            const r = wrap.getBoundingClientRect(), W = stage.clientWidth, H = stage.clientHeight;
            const maxX = Math.max(0, (r.width - W) / 2), maxY = Math.max(0, (r.height - H) / 2);
            x = Math.max(-maxX, Math.min(maxX, x));
            y = Math.max(-maxY, Math.min(maxY, y));
        };
        const zoomAt = (ns, cx, cy, anim) => {
            const sr = stage.getBoundingClientRect();
            const px = cx - sr.left - sr.width / 2, py = cy - sr.top - sr.height / 2;
            ns = Math.max(1, Math.min(8, ns));
            x = px - ((px - x) * ns) / s;
            y = py - ((py - y) * ns) / s;
            s = ns;
            clamp();
            apply(anim);
        };
        const pts = new Map();
        let start = null, lastTap = 0;
        stage.addEventListener("pointerdown", (e) => {
            // у режимі «Текст» одним пальцем / мишею — виділяємо текст, а не тягнемо
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const p = [...pts.values()];
            if (p.length === 2) {
                start = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), s, cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2, x, y };
            } else if (p.length === 1) {
                if (e.pointerType !== "touch" || s > 1) { try { stage.setPointerCapture(e.pointerId); } catch (er) { /* */ } }
                start = { px: e.clientX, py: e.clientY, x, y };
                const now = Date.now();
                if (now - lastTap < 280 && !pdfSel()) {
                    if (s > 1) { s = 1; x = 0; y = 0; apply(true); } else zoomAt(2.5, e.clientX, e.clientY, true);
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
                const cx = (p[0].x + p[1].x) / 2, cy = (p[0].y + p[1].y) / 2;
                s = start.s; x = start.x + (cx - start.cx); y = start.y + (cy - start.cy);
                zoomAt(start.s * (d / start.d), cx, cy, false);
            } else if (p.length === 1 && start && "px" in start && s > 1) {
                x = start.x + (e.clientX - start.px);
                y = start.y + (e.clientY - start.py);
                apply(false);
            }
        });
        const end = (e) => {
            pts.delete(e.pointerId);
            if (pts.size === 1) { const p = [...pts.values()][0]; start = { px: p.x, py: p.y, x, y }; }
            else if (!pts.size) { clamp(); apply(true); start = null; }
        };
        stage.addEventListener("pointerup", end);
        stage.addEventListener("pointercancel", end);
        stage.addEventListener("wheel", (e) => {
            e.preventDefault();
            zoomAt(s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY, false);
        }, { passive: false });
        const say = (t) => { msg.hidden = !t; msg.textContent = t || ""; };
        box.querySelector(".mk-bar2").addEventListener("click", async (e) => {
            const b = e.target.closest("[data-iv]");
            if (!b) return;
            const k = b.dataset.iv;
            const sr = stage.getBoundingClientRect();
            if (k === "close") return opts.onClose?.();
            if (k === "+" || k === "-") return zoomAt(s * (k === "+" ? 1.4 : 1 / 1.4), sr.left + sr.width / 2, sr.top + sr.height / 2, true);
            if (k === "rot") { rot = (rot + 90) % 360; s = 1; x = 0; y = 0; return apply(true); }
            if (k === "save") return opts.save?.();
            if (k === "ocr") {
                if (lastText != null) return textSheet(lastText);
                b.disabled = true;
                say("Розпізнаю текст… (кілька секунд)");
                try {
                    if (!img.complete) await new Promise((r) => img.addEventListener("load", r, { once: true }));
                    lastText = await aiText([await drawable(img, src)]);
                    say("");
                    textSheet(lastText);
                } catch (err) {
                    say("Не вдалося розпізнати: " + (err?.message || err));
                    setTimeout(() => say(""), 5000);
                } finally { b.disabled = false; }
            }
        });
        img.addEventListener("load", () => apply(false));
        addEventListener("resize", () => apply(false));
    }
    window.furaImgView = imgView;

    // ---- Фото на весь екран ----
    const SKIP_IMG = ".sidebar, .fura-sidebar, .fura-topbar, .mk-bar, .fk, .fh-fab, button:not(.sa-mr-att), .home-company-logo, .gd-logo, [data-no-zoom], .mk-viewer, .mk-iv";
    // на комп'ютері — лише фото документів (переписка, вкладення, CMR); на телефоні — будь-які великі
    const DESK_IMG = ".req-msg-img img, .req-att img, .td-docs img, .cb-docs img, .sa-pv-body img, [data-zoom] img, img[data-zoom]";
    function zoomable(img) {
        if (!img || img.tagName !== "IMG" || img.closest(SKIP_IMG)) return false;
        if (!isPhone() && !img.matches(DESK_IMG)) return false;
        if (/\.svg(\?|$)/i.test(img.currentSrc || img.src || "")) return false;
        const r = img.getBoundingClientRect();
        return r.width >= 40 && r.height >= 30 && (img.naturalWidth || 0) >= 100;
    }
    let viewer = null;
    function openViewer(src, name) {
        closeViewer(true);
        viewer = document.createElement("div");
        viewer.className = "mk-viewer";
        document.body.appendChild(viewer);
        document.documentElement.classList.add("mk-noscroll");
        try { history.pushState({ mkViewer: 1 }, ""); } catch (e) { /* без історії */ }
        imgView(viewer, src, {
            onClose: () => closeViewer(),
            save: async () => {
                const nm = name || decodeURIComponent((src.split("?")[0].split("/").pop() || "").replace(/^\d+_/, "")) || "фото.jpg";
                if (!(await shareHref(src, /\.\w{2,4}$/.test(nm) ? nm : nm + ".jpg"))) window.open(src, "_blank");
            },
        });
    }
    function closeViewer(silent) {
        if (!viewer) return;
        viewer.remove();
        viewer = null;
        document.documentElement.classList.remove("mk-noscroll");
        if (!silent && history.state?.mkViewer) history.back();
    }
    addEventListener("popstate", () => { if (viewer) closeViewer(true); });
    addEventListener("keydown", (e) => { if (e.key === "Escape" && viewer) closeViewer(); });
    document.addEventListener(
        "click",
        (e) => {
            const img = e.target.closest?.("img");
            if (!zoomable(img)) return;
            if (img.closest(".sa-pv-body")) return; // у перегляді вкладень — свій переглядач
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

    /* ---- PDF: сторінки з текстом для виділення, збільшення, поворот, текст зі сканів ---- */
    const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    const PDFJS_W = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    let pdfLibP = null;
    const loadPdfLib = () =>
        (pdfLibP ||= new Promise((res, rej) => {
            if (window.pdfjsLib) return res(window.pdfjsLib);
            const sc = document.createElement("script");
            sc.src = PDFJS;
            sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_W; res(window.pdfjsLib); };
            sc.onerror = () => { pdfLibP = null; rej(new Error("Не вдалося завантажити переглядач PDF — перевірте інтернет")); };
            document.head.appendChild(sc);
        }));
    async function pdfView(box, url) {
        box.innerHTML = `<div class="mk-pdf"><div class="mk-bar2">
                <button type="button" data-z="-" aria-label="Зменшити">−</button><span class="mk-z">100%</span><button type="button" data-z="+" aria-label="Збільшити">+</button>
                <button type="button" data-z="rot" aria-label="Повернути"><i class="bx bx-rotate-right"></i></button>
                <button type="button" data-z="ocr" class="mk-ocr-btn" title="Увесь текст документа — виділити й скопіювати (скани розпізнаються)"><b>T</b> Текст</button>
                <span class="mk-pdf-n"></span></div>
            <div class="mk-iv-msg" hidden></div>
            <div class="mk-pdf-scroll"><div class="mk-pdf-pages"><p class="mk-pdf-load">Відкриваю PDF…</p></div></div></div>`;
        const scroll = box.querySelector(".mk-pdf-scroll"), wrap = box.querySelector(".mk-pdf-pages"), msg = box.querySelector(".mk-iv-msg");
        const say = (t) => { msg.hidden = !t; msg.textContent = t || ""; };
        let lib, doc;
        try {
            lib = await loadPdfLib();
            doc = await lib.getDocument({ url }).promise;
        } catch (e) {
            wrap.innerHTML = `<p class="mk-pdf-load">${esc(e.message || e)}</p>`;
            return;
        }
        box.querySelector(".mk-pdf-n").textContent = `${doc.numPages} стор.`;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        let z = 1, rot = 0, docText = null;
        // 100% = сторінка вміщується на екран: на телефоні — по ширині, на комп'ютері — не ширше 1000 px і по висоті вікна
        let aspect = 1.414;
        const base = () => {
            const w = scroll.clientWidth - 12;
            if (w < 700) return Math.max(200, w);
            return Math.max(320, Math.min(w, 1000, (scroll.clientHeight - 16) / aspect));
        };
        const pages = [];
        wrap.innerHTML = "";
        for (let n = 1; n <= doc.numPages; n++) {
            const page = await doc.getPage(n);
            if (n === 1) { const v = page.getViewport({ scale: 1 }); aspect = v.height / v.width; }
            const el = document.createElement("div");
            el.className = "mk-pdf-page";
            el.dataset.n = n;
            wrap.appendChild(el);
            pages.push({ page, el, drawn: "", ocr: null, hasText: null });
        }
        const vp1 = (p) => p.page.getViewport({ scale: 1, rotation: (p.page.rotate + rot) % 360 });
        const layout = () => {
            for (const p of pages) {
                const v = vp1(p), w = base() * z;
                p.el.style.width = w + "px";
                p.el.style.height = (w * v.height) / v.width + "px";
            }
            box.querySelector(".mk-z").textContent = Math.round(z * 100) + "%";
        };
        async function draw(p) {
            const cssW = base() * z, key = cssW + "|" + rot;
            if (p.drawn === key) return;
            p.drawn = key;
            const v1 = vp1(p), scale = cssW / v1.width;
            const vp = p.page.getViewport({ scale, rotation: (p.page.rotate + rot) % 360 });
            const q = Math.min(dpr, 4000 / vp.width);
            const cv = document.createElement("canvas");
            cv.width = Math.floor(vp.width * q);
            cv.height = Math.floor(vp.height * q);
            await p.page.render({ canvasContext: cv.getContext("2d"), viewport: vp, transform: q !== 1 ? [q, 0, 0, q, 0, 0] : null }).promise;
            if (p.drawn !== key) return;
            const tl = document.createElement("div");
            tl.className = "textLayer";
            tl.style.setProperty("--scale-factor", scale);
            let items = 0;
            try {
                const tc = await p.page.getTextContent();
                items = (tc.items || []).filter((i) => String(i.str || "").trim()).length;
                await lib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] }).promise;
            } catch (e) { /* без тексту — лише картинка */ }
            if (p.drawn !== key) return;
            p.hasText = items > 3;
            if (!p.hasText) tl.style.pointerEvents = "none";
            // сторінку показуємо картинкою — на iPhone на ній працює «Живий текст» (утримати палець на тексті)
            let view = cv;
            try {
                const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.9));
                if (blob && p.drawn === key) {
                    view = new Image();
                    view.className = "mk-pdf-img";
                    view.alt = "";
                    view.src = URL.createObjectURL(blob);
                    await view.decode().catch(() => {});
                    if (p.url) URL.revokeObjectURL(p.url);
                    p.url = view.src;
                }
            } catch (e) { view = cv; }
            if (p.drawn !== key) return;
            p.el.replaceChildren(view, tl);
            if (p.el.dataset.n === "1" && !p.hasText) box.querySelector('[data-z="ocr"]').classList.add("hint");
        }
        // сторінка для розпізнавання (~2000 px завширшки)
        async function pageCanvas(p) {
            const v1 = vp1(p), scale = Math.min(3, 2000 / v1.width);
            const vp = p.page.getViewport({ scale, rotation: (p.page.rotate + rot) % 360 });
            const c = document.createElement("canvas");
            c.width = Math.floor(vp.width);
            c.height = Math.floor(vp.height);
            const ctx = c.getContext("2d");
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, c.width, c.height);
            await p.page.render({ canvasContext: ctx, viewport: vp }).promise;
            return c;
        }
        // увесь текст: справжній текст PDF; якщо це скан — розпізнає Claude
        async function allText(btn) {
            if (docText != null) return textSheet(docText);
            btn.disabled = true;
            try {
                const real = [];
                for (const p of pages) {
                    const tc = await p.page.getTextContent().catch(() => null);
                    real.push((tc?.items || []).map((i) => i.str + (i.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+\n/g, "\n").trim());
                }
                const scans = pages.filter((p, i) => real[i].replace(/\s/g, "").length < 30).slice(0, 12);
                let ai = "";
                if (scans.length) {
                    say(`Розпізнаю текст${scans.length > 1 ? ` (${scans.length} стор.)` : ""}… (кілька секунд)`);
                    ai = await aiText(await Promise.all(scans.map(pageCanvas)));
                }
                docText = scans.length === pages.length
                    ? ai
                    : pages.map((p, i) => (pages.length > 1 ? `— Сторінка ${i + 1} —\n` : "") + (scans.includes(p) ? "(скан — див. розпізнаний текст нижче)" : real[i])).join("\n\n") + (ai ? "\n\n— Розпізнані скани —\n" + ai : "");
                say("");
                textSheet(docText);
            } catch (e) {
                say("Не вдалося: " + (e?.message || e));
                setTimeout(() => say(""), 5000);
            } finally { btn.disabled = false; }
        }
        const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) draw(pages[en.target.dataset.n - 1]); }), { root: scroll, rootMargin: "600px 0px" });
        layout();
        pages.forEach((p) => io.observe(p.el));
        const redrawVisible = () => {
            const top = scroll.scrollTop - 600, bot = scroll.scrollTop + scroll.clientHeight + 600;
            pages.forEach((p) => { const o = p.el.offsetTop; if (o + p.el.offsetHeight > top && o < bot) draw(p); });
        };
        const setZoom = (nz, cx = scroll.clientWidth / 2, cy = scroll.clientHeight / 2) => {
            nz = Math.max(0.5, Math.min(5, nz));
            const k = nz / z;
            const sx = (scroll.scrollLeft + cx) * k - cx, sy = (scroll.scrollTop + cy) * k - cy;
            z = nz;
            layout();
            scroll.scrollLeft = sx;
            scroll.scrollTop = sy;
            redrawVisible();
        };
        box.querySelector(".mk-bar2").addEventListener("click", (e) => {
            const b = e.target.closest("[data-z]");
            if (!b) return;
            if (b.dataset.z === "+" || b.dataset.z === "-") return setZoom(z * (b.dataset.z === "+" ? 1.4 : 1 / 1.4));
            if (b.dataset.z === "rot") { rot = (rot + 90) % 360; layout(); scroll.scrollTop = 0; return redrawVisible(); }
            if (b.dataset.z === "ocr") return allText(b);
        });
        // Ctrl + колесо / щипок на тачпаді (комп'ютер)
        scroll.addEventListener("wheel", (e) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const r = scroll.getBoundingClientRect();
            setZoom(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
        }, { passive: false });
        // двома пальцями: під час жесту — плавне CSS-збільшення, після — чітке перемальовування
        let pinch = null;
        const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        scroll.addEventListener("touchstart", (e) => {
            if (e.touches.length !== 2) return;
            const r = scroll.getBoundingClientRect();
            pinch = { d: dist(e.touches), cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top, k: 1 };
            wrap.style.transformOrigin = `${scroll.scrollLeft + pinch.cx}px ${scroll.scrollTop + pinch.cy}px`;
        }, { passive: true });
        scroll.addEventListener("touchmove", (e) => {
            if (!pinch || e.touches.length !== 2) return;
            e.preventDefault();
            pinch.k = Math.max(0.5 / z, Math.min(5 / z, dist(e.touches) / pinch.d));
            wrap.style.transform = `scale(${pinch.k})`;
        }, { passive: false });
        scroll.addEventListener("touchend", () => {
            if (!pinch) return;
            const p = pinch;
            pinch = null;
            wrap.style.transform = "";
            setZoom(z * p.k, p.cx, p.cy);
        });
        let last = 0;
        scroll.addEventListener("click", (e) => {
            const now = Date.now();
            if (now - last < 300 && !pdfSel()) {
                const r = scroll.getBoundingClientRect();
                setZoom(z > 1.05 ? 1 : 2.2, e.clientX - r.left, e.clientY - r.top);
                last = 0;
            } else last = now;
        });
        addEventListener("resize", () => { layout(); redrawVisible(); });
    }
    window.furaPdfView = pdfView;

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
            <button type="button" data-mk="menu" aria-label="Меню"><i class="bx bx-menu"></i><span>Меню</span></button>`;
        document.body.appendChild(bar);
        const nav = window.navigation;
        const sync = () => {
            const back = bar.querySelector('[data-mk="back"]'), fwd = bar.querySelector('[data-mk="fwd"]');
            if (nav && typeof nav.canGoBack === "boolean") {
                back.classList.toggle("off", !nav.canGoBack && page === "home.html");
                fwd.classList.toggle("off", !nav.canGoForward);
            }
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
        /* Фурик і «Помічник» на телефоні не показуємо — вони закривали картки */
        body:has(.mk-bar) .fh-fab, body:has(.mk-bar) .fk { display: none !important; }
        body:has(.mk-bar) .fura-topbar .fura-burger, body:has(.mk-bar) .fura-topbar .fura-nav-arrows { display: none !important; }
        body:has(.mk-bar) main.main-content { padding-bottom: calc(80px + env(safe-area-inset-bottom)) !important; }
        .mk-dup { display: none !important; }
        body:has(.mk-bar) .fura-toasts { bottom: calc(70px + env(safe-area-inset-bottom)) !important; }
    }
    .mk-noscroll, .mk-noscroll body { overflow: hidden !important; }
    .mk-viewer { position: fixed; inset: 0; z-index: 2147483500; background: #0b0f17; display: flex; flex-direction: column; padding-top: env(safe-area-inset-top); }
    .mk-iv { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
    .mk-bar2 { display: flex; align-items: center; gap: 6px; padding: 6px 8px; color: #fff; flex-wrap: wrap; }
    .mk-bar2 button { min-width: 40px; height: 38px; padding: 0 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.1); color: #fff; font: 600 14px inherit; font-size: 20px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; cursor: pointer; }
    .mk-bar2 button i { font-size: 21px; }
    .mk-bar2 .mk-ocr-btn { font-size: 13.5px; }
    .mk-bar2 .mk-ocr-btn b { font: 800 15px Georgia, serif; }
    .mk-bar2 .mk-ocr-btn.on { background: #d9a944; border-color: #d9a944; color: #1f1504; }
    .mk-bar2 .mk-ocr-btn.hint { border-color: #d9a944; box-shadow: 0 0 0 3px rgba(217,169,68,.35); }
    .mk-bar2 button:disabled { opacity: .5; }
    .mk-bar2 [data-iv="close"] { margin-right: auto; order: -1; }
    .mk-bar2 [data-iv="save"] { margin-left: auto; }
    .mk-z { min-width: 46px; text-align: center; font-size: 13px; }
    .mk-iv-stage { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; touch-action: none; }
    .mk-iv-wrap { position: relative; max-width: 100%; max-height: 100%; transform-origin: center center; will-change: transform; display: inline-block; line-height: 0; }
    .mk-iv-img { user-select: none; -webkit-user-select: none; display: block; max-width: 100%; max-height: calc(100vh - 120px); object-fit: contain; -webkit-user-drag: none; }
    .sa-pv-body .mk-iv-img { max-height: calc(100vh - 150px); }
    .mk-iv-msg { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 3; background: rgba(17,24,39,.92); color: #fff; padding: 8px 14px; border-radius: 10px; font-size: 13px; max-width: 90%; text-align: center; line-height: 1.35; }
    .mk-iv-msg[hidden] { display: none; }
    .mk-ocr { position: absolute; inset: 0; z-index: 2; line-height: 1; container-type: size; user-select: text; -webkit-user-select: text; }
    .mk-text .mk-iv-wrap { user-select: text; -webkit-user-select: text; }
    .mk-ocr span { position: absolute; color: transparent; white-space: pre; overflow: hidden; cursor: text; user-select: text; -webkit-user-select: text; line-height: 1; font-family: Arial, sans-serif; }
    .mk-ocr span::selection { background: rgba(37, 99, 235, .4); color: transparent; }
    .mk-text .mk-iv-stage { touch-action: pinch-zoom; user-select: text; -webkit-user-select: text; }
    .mk-text, .mk-viewer.mk-text { user-select: text; -webkit-user-select: text; }
    .sa-pv-body:has(.mk-pdf), .sa-pv-body:has(.mk-iv) { display: block; overflow: hidden; padding: 0 6px 6px; }
    .mk-pdf { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
    .mk-pdf-n { margin-left: auto; font-size: 13px; color: #cbd5e1; }
    .mk-pdf-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; -webkit-overflow-scrolling: touch; touch-action: pan-x pan-y; }
    .mk-pdf-pages { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 0 6px 20px; width: max-content; min-width: 100%; box-sizing: border-box; }
    .mk-pdf-page { position: relative; background: #fff; border-radius: 4px; overflow: hidden; margin: 0 auto; }
    .mk-pdf-page canvas, .mk-pdf-page .mk-pdf-img { display: block; width: 100%; height: 100%; }
    /* iPhone / iPad: «Живий текст» на фото — утримати палець на тексті */
    @media (pointer: coarse) { .mk-iv-img, .mk-pdf-img { -webkit-touch-callout: default; -webkit-user-select: auto; user-select: auto; } }
    .mk-pdf-load { color: #e5e7eb; padding: 20px; }
    .mk-pdf .textLayer { position: absolute; inset: 0; overflow: hidden; line-height: 1; text-align: initial; opacity: 1; z-index: 2; -webkit-text-size-adjust: none; text-size-adjust: none; forced-color-adjust: none; transform-origin: 0 0; }
    .mk-pdf .textLayer span, .mk-pdf .textLayer br { color: transparent; position: absolute; white-space: pre; cursor: text; transform-origin: 0% 0%; user-select: text; -webkit-user-select: text; }
    .mk-pdf .textLayer ::selection { background: rgba(37, 99, 235, .35); }
    .mk-pdf .textLayer .endOfContent { display: none; }
    .mk-pdf .mk-ocr { z-index: 3; }
    .mk-tsheet { position: fixed; inset: 0; z-index: 2147483650; background: rgba(15,23,42,.5); display: flex; align-items: flex-end; justify-content: center; }
    .mk-tsheet-card { width: 100%; max-width: 720px; max-height: 80vh; background: #fff; border-radius: 18px 18px 0 0; display: flex; flex-direction: column; padding: 14px 14px calc(14px + env(safe-area-inset-bottom)); }
    @media (min-width: 901px) { .mk-tsheet { align-items: center; } .mk-tsheet-card { border-radius: 16px; } }
    .mk-tsheet-head { display: flex; align-items: center; gap: 8px; }
    .mk-tsheet-head b { flex: 1; font-size: 16px; color: #111827; }
    .mk-tsheet-head button { border: 1px solid #e5e7eb; background: #fff; border-radius: 10px; min-height: 38px; padding: 0 12px; font: 600 13.5px inherit; color: #374151; cursor: pointer; }
    .mk-tsheet-head [data-ts="copy"] { background: linear-gradient(135deg, #d9a944, #b8862a); color: #fff; border: 0; }
    .mk-tsheet-hint { font-size: 12px; color: #6b7280; margin: 6px 0 8px; }
    .mk-tsheet-text { flex: 1 1 auto; overflow: auto; margin: 0; padding: 12px; background: #f8fafc; border: 1px solid #eef0f3; border-radius: 10px; white-space: pre-wrap; word-break: break-word; font: 15px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111827; user-select: text; -webkit-user-select: text; }
    .mk-bar2 .mk-list-btn[hidden] { display: none; }
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
