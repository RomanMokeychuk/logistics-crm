/* ================================================================= *
 * FURA — ПЕРЕКЛАДАЧ: текст, скріншот, фото або PDF                    *
 * Переклад робить функція fura-assistant (action: "translate").     *
 * ================================================================= */

const SUPABASE_URL = "https://prbfscwmemshwigiftha.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYmZzY3dtZW1zaHdpZ2lmdGhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjA4MzEsImV4cCI6MjEwNTk5NjgzMX0.3o4STZHL9hpamTCNofPemPTDWyWfR3xOK6TZnUXlWyE";

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function logout() {
    await sbClient.auth.signOut();
    window.location.href = "login.html";
}

function toggleSidebar() {
    document.body.classList.toggle("sidebar-collapsed");
    const icon = document.querySelector("#sidebarToggleBtn i");
    if (icon) {
        icon.classList.toggle("bx-chevron-left");
        icon.classList.toggle("bx-chevron-right");
    }
}

const TR = (() => {
    const $ = (s) => document.querySelector(s);
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const MAX_PDF = 8 * 1024 * 1024;
    const OK_TYPES = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/;
    let file = null; // { name, type, data (base64), url (прев'ю) }
    let busy = false;
    let mode = (() => { try { return localStorage.getItem("fura_tr_mode") || "pic"; } catch (e) { return "pic"; } })();

    const toB64 = (blob) => new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] || "");
        r.onerror = rej;
        r.readAsDataURL(blob);
    });

    // Велике фото зменшуємо (до 2000 px), щоб швидко відправити
    async function shrink(img) {
        try {
            const bmp = await createImageBitmap(img);
            const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
            if (k === 1 && img.size < 3.5 * 1024 * 1024) return img;
            const c = document.createElement("canvas");
            c.width = Math.round(bmp.width * k);
            c.height = Math.round(bmp.height * k);
            c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
            return await new Promise((r) => c.toBlob((b) => r(b || img), "image/jpeg", 0.88));
        } catch (e) {
            return img;
        }
    }

    async function setFile(f) {
        if (!f) return;
        if (!OK_TYPES.test(f.type)) return showErr("Підходять лише PDF або фото (PNG, JPG, GIF, WEBP).");
        if (f.type === "application/pdf" && f.size > MAX_PDF) return showErr("PDF завеликий (понад 8 МБ). Розділіть його на частини або надішліть потрібні сторінки.");
        const blob = f.type === "application/pdf" ? f : await shrink(f);
        file = { blob, name: f.name || "скріншот.png", type: blob.type || f.type, data: await toB64(blob), url: f.type.startsWith("image/") ? URL.createObjectURL(blob) : "" };
        paintAtt();
    }
    function paintAtt() {
        const box = $("#trAtt");
        if (!file) { box.hidden = true; box.innerHTML = ""; return; }
        box.hidden = false;
        box.innerHTML = `${file.url ? `<img src="${file.url}" alt="">` : `<i class="bx bxs-file-pdf"></i>`}
            <span class="tr-att-name">${esc(file.name)}</span>
            <span class="tr-mode" title="Як показати переклад">
                <button type="button" data-mode="pic" class="${mode === "pic" ? "on" : ""}">🖼 На картинці</button>
                <button type="button" data-mode="text" class="${mode === "text" ? "on" : ""}">📝 Текстом</button>
            </span>
            <button type="button" class="tr-att-x" title="Прибрати файл">&times;</button>`;
        box.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => {
            mode = b.dataset.mode;
            try { localStorage.setItem("fura_tr_mode", mode); } catch (e) { /* */ }
            paintAtt();
        }));
        box.querySelector(".tr-att-x").onclick = () => { file = null; paintAtt(); };
        $("#trText").placeholder = "Можна дописати, що саме перекласти (необов'язково)…";
    }
    function showErr(msg) {
        $("#trOut").innerHTML = `<div class="tr-err">${esc(msg)}</div>`;
    }


    /* ---------- смужка прогресу ---------- */
    let progTimer = 0, progT0 = 0, progPct = 0;
    function progShow(label) {
        clearInterval(progTimer);
        progT0 = Date.now(); progPct = 0;
        $("#trOut").innerHTML = `<div class="tr-prog">
            <div class="tr-prog-top"><span class="tr-prog-label">${esc(label)}</span><b class="tr-prog-pct">0%</b></div>
            <div class="tr-prog-bar"><i></i></div>
            <div class="tr-prog-sub"></div></div>`;
        progTimer = setInterval(() => {
            const el = $("#trOut .tr-prog-sub");
            if (!el) return clearInterval(progTimer);
            el.textContent = `минуло ${Math.round((Date.now() - progT0) / 1000)} с`;
        }, 1000);
    }
    function prog(pct, label) {
        const box = $("#trOut .tr-prog");
        if (!box) return;
        if (pct != null) {
            progPct = Math.max(progPct, Math.min(100, pct)); // назад не відкочується
            box.querySelector(".tr-prog-bar i").style.width = `${progPct}%`;
            box.querySelector(".tr-prog-pct").textContent = `${Math.round(progPct)}%`;
        }
        if (label) box.querySelector(".tr-prog-label").textContent = label;
    }
    function progStop() { clearInterval(progTimer); }
    // для кроку, де точного % немає (відповідь ШІ): плавно до ~95% від очікуваного часу
    function progEstimate(from, to, seconds, labels) {
        const t0 = Date.now();
        const id = setInterval(() => {
            const t = (Date.now() - t0) / 1000;
            const k = 1 - Math.exp(-t / seconds);
            prog(from + (to - from) * 0.95 * k, labels ? labels(k) : null);
        }, 250);
        return () => clearInterval(id);
    }

    async function go() {
        const text = $("#trText").value;
        if (busy) return;
        if (!text.trim() && !file) return showErr("Вставте текст або додайте PDF чи фото.");
        if (file && mode === "pic") return goPic();
        busy = true;
        $("#trGo").disabled = true;
        $("#trCopy").disabled = true;
        $("#trFrom").textContent = "";
        progShow(file ? "Надсилаю файл…" : "Перекладаю…");
        const mb = file ? file.data.length * 0.75 / 1048576 : 0;
        const expect = file ? (file.type === "application/pdf" ? 12 + mb * 25 : 10) : 3 + text.length / 1200;
        const stopEst = progEstimate(3, 100, expect, (k) => (!file ? "Перекладаю…" : k < 0.15 ? "Надсилаю файл…" : k < 0.55 ? "ШІ читає файл…" : k < 0.85 ? "Перекладаю…" : "Майже готово…"));
        try {
            const { data, error } = await sbClient.functions.invoke("fura-assistant", {
                body: { action: "translate", to: $("#trTo").value, text, file: file ? { name: file.name, type: file.type, data: file.data } : null },
            });
            if (error) {
                let msg = "Перекладач не відповів. Перевірте, чи розгорнута функція fura-assistant.";
                try { const j = await error.context?.json(); if (j?.error) msg = j.error; } catch (_) { /* */ }
                throw new Error(msg);
            }
            stopEst(); prog(100, "Готово ✓");
            const out = String(data?.translation || "").trim();
            $("#trOut").innerHTML = out ? `<div class="tr-text" contenteditable="true" spellcheck="false">${esc(out)}</div>` + (data.cut ? `<div class="tr-warn">Текст дуже довгий — переклад обрізано. Перекладіть решту окремо.</div>` : "") : `<div class="tr-empty">Порожня відповідь.</div>`;
            $("#trFrom").textContent = data?.from ? `з мови: ${data.from}` : "";
            $("#trCopy").disabled = !out;
        } catch (e) {
            showErr(e.message);
        } finally {
            stopEst(); progStop();
            busy = false;
            $("#trGo").disabled = false;
        }
    }

    /* ================= ПЕРЕКЛАД «НА КАРТИНЦІ» (як Google Lens) =================
       1) розпізнаємо текст і де саме він стоїть (Tesseract.js, у браузері)
       2) перекладаємо рядки (fura-assistant → translate_lines)
       3) зафарбовуємо оригінал кольором фону і пишемо переклад на тому самому місці */
    const TESS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const OCR_LANGS = ["ukr", "rus", "pol", "eng", "deu"];
    const MAX_PAGES = 10;
    const loadJs = (src) => new Promise((res, rej) => {
        if (document.querySelector(`script[src="${src}"]`)) return res();
        const sc = document.createElement("script");
        sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error("Не вдалося завантажити модуль розпізнавання. Перевірте інтернет."));
        document.head.appendChild(sc);
    });
    let ocrWorker = null;
    let onOcrLog = null;
    async function getWorker(say) {
        if (ocrWorker) return ocrWorker;
        await loadJs(TESS_URL);
        say("Готую розпізнавання тексту… (перший раз — до хвилини, далі швидко)");
        ocrWorker = await window.Tesseract.createWorker(OCR_LANGS, 1, { logger: (m) => onOcrLog?.(m) });
        return ocrWorker;
    }
    // сторінки → canvas
    async function pagesOf(f, say) {
        if (f.type !== "application/pdf") {
            const bmp = await createImageBitmap(f.blob);
            const c = document.createElement("canvas");
            c.width = bmp.width; c.height = bmp.height;
            c.getContext("2d").drawImage(bmp, 0, 0);
            return [c];
        }
        await loadJs(PDFJS_URL);
        const lib = window.pdfjsLib;
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        const doc = await lib.getDocument({ data: await f.blob.arrayBuffer() }).promise;
        const n = Math.min(doc.numPages, MAX_PAGES);
        const out = [];
        for (let i = 1; i <= n; i++) {
            say(`Відкриваю PDF: сторінка ${i} з ${n}…`);
            const page = await doc.getPage(i);
            const v0 = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale: Math.min(3, 1700 / v0.width) });
            const c = document.createElement("canvas");
            c.width = Math.round(vp.width); c.height = Math.round(vp.height);
            const ctx = c.getContext("2d");
            ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;
            out.push(c);
        }
        if (doc.numPages > MAX_PAGES) out.cut = doc.numPages;
        return out;
    }
    // рядки з результату Tesseract (різні версії віддають по-різному)
    function linesOf(data) {
        let ls = Array.isArray(data?.lines) && data.lines.length ? data.lines : [];
        if (!ls.length && Array.isArray(data?.blocks)) ls = data.blocks.flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []));
        return ls
            .map((l) => ({ text: String(l.text || "").replace(/\s+/g, " ").trim(), b: l.bbox, conf: l.confidence ?? 100 }))
            .filter((l) => l.b && l.text && l.conf >= 25 && /\p{L}{2,}/u.test(l.text) && l.b.x1 - l.b.x0 > 6 && l.b.y1 - l.b.y0 > 5);
    }
    // колір фону (по краях рамки) і колір літер (найдальший від фону всередині)
    function colorsAt(ctx, b, W, H) {
        const px = (x, y) => { const d = ctx.getImageData(Math.max(0, Math.min(W - 1, x)), Math.max(0, Math.min(H - 1, y)), 1, 1).data; return [d[0], d[1], d[2]]; };
        const ring = [];
        const pad = 3;
        for (let i = 0; i <= 12; i++) {
            const x = b.x0 + ((b.x1 - b.x0) * i) / 12;
            ring.push(px(x, b.y0 - pad), px(x, b.y1 + pad));
        }
        for (let i = 0; i <= 4; i++) {
            const y = b.y0 + ((b.y1 - b.y0) * i) / 4;
            ring.push(px(b.x0 - pad, y), px(b.x1 + pad, y));
        }
        const med = (k) => ring.map((c) => c[k]).sort((a, z) => a - z)[ring.length >> 1];
        const bg = [med(0), med(1), med(2)];
        const img = ctx.getImageData(b.x0, b.y0, Math.max(1, b.x1 - b.x0), Math.max(1, b.y1 - b.y0)).data;
        let best = null, bd = -1;
        for (let i = 0; i < img.length; i += 16) {
            const d = Math.abs(img[i] - bg[0]) + Math.abs(img[i + 1] - bg[1]) + Math.abs(img[i + 2] - bg[2]);
            if (d > bd) { bd = d; best = [img[i], img[i + 1], img[i + 2]]; }
        }
        const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
        const fg = bd > 60 ? best : lum(bg) > 128 ? [20, 20, 20] : [245, 245, 245];
        return { bg: `rgb(${bg})`, fg: `rgb(${fg})` };
    }

    // Розпізнавання сторінки: збільшуємо дрібний текст, сірий фон → чіткіше;
    // 2 проходи: звичайний (цілі рядки й абзаци) + «розкиданий текст» (клітинки таблиць, підписи)
    async function ocrPage(worker, src, onPart) {
        const k = Math.max(1, Math.min(3, 2400 / src.width));
        const c = document.createElement("canvas");
        c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingQuality = "high";
        ctx.filter = "grayscale(1) contrast(1.25)";
        ctx.drawImage(src, 0, 0, c.width, c.height);
        const scale = (l) => ({ ...l, b: { x0: l.b.x0 / k, y0: l.b.y0 / k, x1: l.b.x1 / k, y1: l.b.y1 / k } });
        onPart(0);
        await worker.setParameters({ tessedit_pageseg_mode: "3", preserve_interword_spaces: "1" });
        const a = linesOf((await worker.recognize(c, {}, { blocks: true, text: true })).data).map(scale);
        onPart(1);
        await worker.setParameters({ tessedit_pageseg_mode: "11" });
        const b = linesOf((await worker.recognize(c, {}, { blocks: true, text: true })).data).map(scale);
        // додаємо з 2-го проходу те, чого не було в 1-му (не перекривається)
        const area = (q) => Math.max(0, q.x1 - q.x0) * Math.max(0, q.y1 - q.y0);
        const over = (p, q) => area({ x0: Math.max(p.x0, q.x0), y0: Math.max(p.y0, q.y0), x1: Math.min(p.x1, q.x1), y1: Math.min(p.y1, q.y1) });
        const out = [...a];
        b.forEach((l) => { if (!out.some((m) => over(m.b, l.b) > 0.3 * Math.min(area(m.b), area(l.b)))) out.push(l); });
        // великі «рядки» на всю таблицю (рамки) — відкидаємо
        return out.filter((l) => l.b.y1 - l.b.y0 < src.height * 0.2).sort((p, q) => p.b.y0 - q.b.y0 || p.b.x0 - q.b.x0);
    }

    function paintPage(src, lines, tr) {
        const c = document.createElement("canvas");
        c.width = src.width; c.height = src.height;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(src, 0, 0);
        const sctx = src.getContext("2d", { willReadFrequently: true });
        const boxes = [];
        lines.forEach((l, i) => {
            const t = String(tr[i] ?? "").trim();
            if (!t || t === l.text) return;
            const b = l.b, h = b.y1 - b.y0, w = b.x1 - b.x0;
            const col = colorsAt(sctx, b, src.width, src.height);
            let size = Math.max(8, h * 0.82);
            const font = (sz) => `${sz}px Inter, "Helvetica Neue", Arial, sans-serif`;
            ctx.font = font(size);
            let tw = ctx.measureText(t).width;
            if (tw > w) { size = Math.max(h * 0.5, size * (w / tw)); ctx.font = font(size); tw = ctx.measureText(t).width; }
            const fillW = Math.max(w, tw) + 4;
            ctx.fillStyle = col.bg;
            ctx.fillRect(b.x0 - 2, b.y0 - 2, fillW, h + 4);
            ctx.fillStyle = col.fg;
            ctx.textBaseline = "middle";
            ctx.fillText(t, b.x0, b.y0 + h / 2 + 1, Math.max(w * 1.6, tw));
            boxes.push({ x0: b.x0, y0: b.y0, x1: b.x0 + fillW, y1: b.y1, orig: l.text, t });
        });
        c._boxes = boxes;
        return c;
    }

    async function goPic() {
        busy = true;
        $("#trGo").disabled = true;
        $("#trCopy").disabled = true;
        $("#trFrom").textContent = "";
        const out = $("#trOut");
        // 0–8% відкриваємо файл · 8–15% готуємо розпізнавання · 15–100% сторінки (60% розпізнавання + 40% переклад)
        const say = (m) => prog(null, m);
        progShow("Відкриваю файл…");
        const allText = [];
        let stopEst = () => {};
        try {
            const pages = await pagesOf(file, (m) => { say(m); prog(Math.min(8, progPct + 1)); });
            prog(8);
            onOcrLog = (m) => {
                if (/loading|initializ/i.test(m.status || "")) prog(8 + 7 * (m.progress || 0), "Готую розпізнавання тексту… (перший раз — до хвилини)");
            };
            const worker = await getWorker(say);
            prog(15);
            const per = 85 / pages.length;
            const done = [];
            let from = "";
            for (let p = 0; p < pages.length; p++) {
                const pre = pages.length > 1 ? `Сторінка ${p + 1} з ${pages.length}: ` : "";
                const base = 15 + per * p;
                say(pre + "розпізнаю текст…");
                let part = 0;
                onOcrLog = (m) => {
                    if (m.status !== "recognizing text") return;
                    const f = (part + (m.progress || 0)) / 2;
                    prog(base + per * 0.6 * f, `${pre}розпізнаю текст… ${Math.round(f * 100)}%`);
                };
                const lines = await ocrPage(worker, pages[p], (n) => { part = n; });
                onOcrLog = null;
                if (!lines.length) { prog(base + per); done.push({ src: pages[p], res: pages[p], n: 0 }); continue; }
                prog(base + per * 0.6, `${pre}перекладаю ${lines.length} рядків…`);
                stopEst = progEstimate(base + per * 0.6, base + per, 4 + lines.length / 25);
                const { data: r, error } = await sbClient.functions.invoke("fura-assistant", { body: { action: "translate_lines", to: $("#trTo").value, lines: lines.map((l) => l.text) } });
                stopEst();
                prog(base + per);
                if (error) {
                    let msg = "Перекладач не відповів. Перевірте, чи розгорнута нова версія функції fura-assistant.";
                    try { const j = await error.context?.json(); if (j?.error) msg = j.error; } catch (_) { /* */ }
                    throw new Error(msg);
                }
                from = from || r?.from || "";
                const tr = Array.isArray(r?.t) ? r.t : [];
                allText.push(tr.join("\n"));
                done.push({ src: pages[p], res: paintPage(pages[p], lines, tr), n: lines.length });
            }
            prog(100, "Готово ✓");
            progStop();
            showPic(done, pages.cut);
            $("#trFrom").textContent = from ? `з мови: ${from}` : "";
            const txt = allText.join("\n\n").trim();
            $("#trCopy").disabled = !txt;
            out.dataset.copy = txt;
        } catch (e) {
            showErr(e.message || String(e));
        } finally {
            stopEst(); progStop(); onOcrLog = null;
            busy = false;
            $("#trGo").disabled = false;
        }
    }
    function showPic(done, cut) {
        const out = $("#trOut");
        out.innerHTML = `<div class="tr-pic-bar">
                <button type="button" class="tr-pic-btn" data-pic="orig" title="Затисніть, щоб побачити оригінал">👁 Оригінал (затисніть)</button>
                <button type="button" class="tr-pic-btn" data-pic="dl">⬇ Завантажити</button>
                <span class="tr-muted">Наведіть мишку на текст — побачите, як було в оригіналі</span>
            </div>
            ${!done.some((d) => d.n) ? `<div class="tr-warn">На картинці не знайдено тексту для перекладу. Спробуйте режим «📝 Текстом».</div>` : ""}
            ${cut ? `<div class="tr-warn">У PDF ${cut} сторінок — показано перші ${MAX_PAGES}.</div>` : ""}
            <div class="tr-pages"></div><div class="tr-tip" hidden></div>`;
        const host = out.querySelector(".tr-pages");
        const tip = out.querySelector(".tr-tip");
        done.forEach((d, i) => {
            const wrap = document.createElement("div");
            wrap.className = "tr-page";
            d.res.className = "tr-canvas";
            wrap.appendChild(d.res);
            host.appendChild(wrap);
            d.res.addEventListener("mousemove", (e) => {
                const r = d.res.getBoundingClientRect();
                const k = d.res.width / r.width;
                const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
                const b = (d.res._boxes || []).find((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 - 2 && y <= q.y1 + 2);
                if (!b) { tip.hidden = true; return; }
                tip.hidden = false;
                tip.innerHTML = `<b>Оригінал:</b> ${esc(b.orig)}`;
                const ob = out.getBoundingClientRect();
                tip.style.left = `${Math.min(e.clientX - ob.left + 14, ob.width - 260)}px`;
                tip.style.top = `${e.clientY - ob.top + out.scrollTop + 16}px`;
            });
            d.res.addEventListener("mouseleave", () => (tip.hidden = true));
        });
        const swap = (orig) => done.forEach((d) => {
            const ctx = d.res.getContext("2d");
            if (orig) { d.res._saved = d.res._saved || ctx.getImageData(0, 0, d.res.width, d.res.height); ctx.drawImage(d.src, 0, 0); }
            else if (d.res._saved) ctx.putImageData(d.res._saved, 0, 0);
        });
        const ob = out.querySelector('[data-pic="orig"]');
        ["mousedown", "touchstart"].forEach((t) => ob.addEventListener(t, (e) => { e.preventDefault(); swap(true); }));
        ["mouseup", "mouseleave", "touchend"].forEach((t) => ob.addEventListener(t, () => swap(false)));
        out.querySelector('[data-pic="dl"]').onclick = () => done.forEach((d, i) => {
            const a = document.createElement("a");
            a.download = `переклад${done.length > 1 ? `-${i + 1}` : ""}.png`;
            a.href = d.res.toDataURL("image/png");
            a.click();
        });
    }

    function bind() {
        try { const v = localStorage.getItem("fura_tr_to"); if (v) $("#trTo").value = v; } catch (e) { /* */ }
        $("#trTo").addEventListener("change", (e) => { try { localStorage.setItem("fura_tr_to", e.target.value); } catch (err) { /* */ } });
        $("#trGo").addEventListener("click", go);
        $("#trText").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } });
        $("#trFile").addEventListener("change", (e) => { setFile(e.target.files[0]); e.target.value = ""; });
        $("#trClear").addEventListener("click", () => {
            file = null; paintAtt();
            $("#trText").value = "";
            $("#trText").placeholder = "Вставте текст для перекладу…\n\nАбо вставте скріншот (Cmd+V), або перетягніть сюди PDF чи фото.";
            $("#trOut").innerHTML = `<div class="tr-empty">Тут з'явиться переклад.</div>`;
            $("#trFrom").textContent = "";
            $("#trCopy").disabled = true;
            $("#trText").focus();
        });
        $("#trCopy").addEventListener("click", async () => {
            const t = $("#trOut .tr-text")?.innerText || $("#trOut").dataset.copy || "";
            try { await navigator.clipboard.writeText(t); $("#trCopy").innerHTML = `<i class="bx bx-check"></i> Скопійовано`; setTimeout(() => ($("#trCopy").innerHTML = `<i class="bx bx-copy"></i> Копіювати`), 1500); } catch (e) { /* */ }
        });
        // Cmd+V скріншот / файл
        document.addEventListener("paste", (e) => {
            const it = [...(e.clipboardData?.items || [])].find((i) => i.kind === "file" && OK_TYPES.test(i.type));
            if (!it) return;
            e.preventDefault();
            setFile(it.getAsFile());
        });
        // перетягування
        const drop = $("#trDrop");
        ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
        ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
        drop.addEventListener("drop", (e) => setFile(e.dataTransfer?.files?.[0]));
        // текст, переданий з іншої сторінки FURA (кнопка «Перекласти»)
        try {
            const h = localStorage.getItem("fura_tr_in");
            if (h) { localStorage.removeItem("fura_tr_in"); $("#trText").value = h; go(); }
        } catch (e) { /* */ }
        $("#trText").focus();
    }
    return { bind };
})();

document.addEventListener("DOMContentLoaded", async () => {
    const { data: { session } } = await sbClient.auth.getSession();
    if (!session) {
        window.location.href = "login.html";
        return;
    }
    document.body.style.visibility = "visible";
    sbClient.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") window.location.href = "login.html";
    });
    TR.bind();
});
