/* ================================================================= *
 * FURA — «ЗАРАЗ У ЧЕРЗІ НА КОРДОНІ» в картці перевізника              *
 * Показується, лише якщо машини цього ЄДРПОУ є в «Черзі» (echerha_*). *
 * Підключається на index.html після script.js.                       *
 * ================================================================= */
(function () {
    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) return;
    if (!document.querySelector('link[href^="echerha.css"]')) {
        const l = document.createElement("link");
        l.rel = "stylesheet";
        l.href = "echerha.css?v=202610241650";
        document.head.appendChild(l);
    }
    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const dShort = (v) => {
        const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/);
        return m ? `${m[3]}.${m[2]}${m[4] ? " " + m[4] : ""}` : "—";
    };
    let seq = 0;

    async function renderCard(item) {
        const body = document.getElementById("carrierCardBody");
        const my = ++seq;
        body?.querySelector("#eqCardBox")?.remove();
        const digits = String(item?.edrpou || "").replace(/\D/g, "");
        if (!body || !digits) return;
        const bare = digits.replace(/^0+/, "");
        const variants = [...new Set([digits, bare, bare.padStart(8, "0")])];
        try {
            const { data: sync } = await client.from("echerha_sync").select("sync_id, synced_at").eq("id", 1).maybeSingle();
            if (!sync?.sync_id) return;
            const { data } = await client
                .from("echerha_queue")
                .select("checkpoint, entry_at, tractor, trailer, trailer_body, note")
                .eq("sync_id", sync.sync_id)
                .in("edrpou", variants)
                .order("entry_at", { ascending: true })
                .limit(50);
            if (my !== seq || !data?.length) return;
            const box = document.createElement("div");
            box.id = "eqCardBox";
            box.className = "eqc";
            box.innerHTML =
                `<div class="eqc-title"><i class="bx bxs-truck"></i> Зараз у черзі на кордоні: ${data.length} маш.` +
                `<a href="echerha.html">Відкрити «Чергу» →</a></div>` +
                data.map((r) => `<div class="eqc-row">
                    <b>${esc(String(r.checkpoint).replace(/\s*\(для[^)]*\)\s*$/, ""))}</b>
                    <span>в'їзд ${dShort(r.entry_at)}</span>
                    <span class="eq-mono">${esc(r.tractor)}${r.trailer ? " / " + esc(r.trailer) : ""}</span>
                    ${r.trailer_body ? `<span class="eq-body">${esc(r.trailer_body)}</span>` : ""}
                    ${r.note ? `<span class="eq-muted">${esc(r.note)}</span>` : ""}
                </div>`).join("") +
                `<div class="eq-muted eq-sm" style="margin-top:6px">Дані «Эчерги» на ${new Date(sync.synced_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>`;
            // одразу під шапкою картки — щоб було видно без прокрутки
            const head = body.querySelector(".card-header-block");
            head ? head.after(box) : body.prepend(box);
        } catch (e) {
            console.warn("FURA Черга в картці:", e);
        }
    }

    window.furaEcherha = { renderCard };
})();
