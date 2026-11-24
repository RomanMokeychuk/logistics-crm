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
        file = { name: f.name || "скріншот.png", type: blob.type || f.type, data: await toB64(blob), url: f.type.startsWith("image/") ? URL.createObjectURL(blob) : "" };
        paintAtt();
    }
    function paintAtt() {
        const box = $("#trAtt");
        if (!file) { box.hidden = true; box.innerHTML = ""; return; }
        box.hidden = false;
        box.innerHTML = `${file.url ? `<img src="${file.url}" alt="">` : `<i class="bx bxs-file-pdf"></i>`}
            <span class="tr-att-name">${esc(file.name)}</span>
            <button type="button" class="tr-att-x" title="Прибрати файл">&times;</button>`;
        box.querySelector(".tr-att-x").onclick = () => { file = null; paintAtt(); };
        $("#trText").placeholder = "Можна дописати, що саме перекласти (необов'язково)…";
    }
    function showErr(msg) {
        $("#trOut").innerHTML = `<div class="tr-err">${esc(msg)}</div>`;
    }

    async function go() {
        const text = $("#trText").value;
        if (busy) return;
        if (!text.trim() && !file) return showErr("Вставте текст або додайте PDF чи фото.");
        busy = true;
        $("#trGo").disabled = true;
        $("#trCopy").disabled = true;
        $("#trFrom").textContent = "";
        $("#trOut").innerHTML = `<div class="tr-load">${file ? "Читаю файл і перекладаю… (PDF на кілька сторінок — до хвилини)" : "Перекладаю…"}</div>`;
        try {
            const { data, error } = await sbClient.functions.invoke("fura-assistant", {
                body: { action: "translate", to: $("#trTo").value, text, file: file ? { name: file.name, type: file.type, data: file.data } : null },
            });
            if (error) {
                let msg = "Перекладач не відповів. Перевірте, чи розгорнута функція fura-assistant.";
                try { const j = await error.context?.json(); if (j?.error) msg = j.error; } catch (_) { /* */ }
                throw new Error(msg);
            }
            const out = String(data?.translation || "").trim();
            $("#trOut").innerHTML = out ? `<div class="tr-text" contenteditable="true" spellcheck="false">${esc(out)}</div>` + (data.cut ? `<div class="tr-warn">Текст дуже довгий — переклад обрізано. Перекладіть решту окремо.</div>` : "") : `<div class="tr-empty">Порожня відповідь.</div>`;
            $("#trFrom").textContent = data?.from ? `з мови: ${data.from}` : "";
            $("#trCopy").disabled = !out;
        } catch (e) {
            showErr(e.message);
        } finally {
            busy = false;
            $("#trGo").disabled = false;
        }
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
            const t = $("#trOut .tr-text")?.innerText || "";
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
