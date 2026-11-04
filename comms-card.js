/* ================================================================= *
 * FURA — блок «Переписка» в картці ліда (leads.html) і клієнта       *
 * (clients.html). Уся переписка з клієнтом з Outlook, Telegram,      *
 * WhatsApp і Viber однією стрічкою.                                  *
 * Хто що бачить, вирішує база (comms.sql → comm_can_see):            *
 * керівник — усе; Sales, за яким закріплений клієнт, — переписку     *
 * цього клієнта; інші (і логісти) — лише свої розмови.               *
 *   window.furaCommsBlock(leadId, element)                           *
 * Потрібен sbClient (оголошений на сторінці).                        *
 * ================================================================= */

(function () {
    const CH = {
        outlook: ["Outlook", "#0b4fb3", "#e0ecff", "bx-envelope"],
        telegram: ["Telegram", "#0369a1", "#e0f2fe", "bxl-telegram"],
        whatsapp: ["WhatsApp", "#15803d", "#dcfce7", "bxl-whatsapp"],
        viber: ["Viber", "#6d28d9", "#ede9fe", "bx-phone-call"],
    };
    const INTENT = {
        quote_request: ["💰 просить ставку", "#9a3412", "#fff1e6"],
        order: ["✅ заявка / згода", "#166534", "#dcfce7"],
        complaint: ["⚠️ скарга", "#b91c1c", "#fee2e2"],
        question: ["❓ питання", "#92400e", "#fef3c7"],
    };
    const FEED_LIMIT = 40;

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const when = (iso) =>
        iso ? new Date(iso).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    const ago = (iso) => {
        const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        return m < 60 ? `${m} хв` : m < 2880 ? `${Math.round(m / 60)} год` : `${Math.round(m / 1440)} дн.`;
    };
    const chip = (text, color, bg) => `<span class="cc-chip" style="color:${color};background:${bg}">${text}</span>`;
    const chBadge = (c) => {
        const x = CH[c] || [c, "#334155", "#f1f5f9", "bx-chat"];
        return chip(`<i class="bx ${x[3]}"></i> ${x[0]}`, x[1], x[2]);
    };

    // Стилі — тут же, щоб блок працював на будь-якій сторінці без окремого CSS
    if (!document.getElementById("cc-style")) {
        const st = document.createElement("style");
        st.id = "cc-style";
        st.textContent = `
            .cc-wrap{display:grid;gap:10px}
            .cc-top{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
            .cc-threads{display:flex;gap:6px;flex-wrap:wrap}
            .cc-thread{display:inline-flex;gap:6px;align-items:center;border:1px solid #e4e8ef;border-radius:10px;padding:4px 8px;font-size:12px;text-decoration:none;color:inherit;background:#fff}
            .cc-thread.wait{border-color:#f59e0b;background:#fffbeb}
            .cc-wait{font-weight:700;color:#b45309}
            .cc-chip{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;padding:1px 7px;border-radius:8px}
            .cc-feed{display:flex;flex-direction:column;gap:6px;max-height:420px;overflow-y:auto;padding:2px}
            .cc-msg{max-width:88%;padding:7px 10px;border-radius:12px;background:#f1f5f9;align-self:flex-start}
            .cc-msg.out{align-self:flex-end;background:#e8f0ff}
            .cc-subj{font-weight:700;font-size:12px;margin-bottom:2px}
            .cc-text{white-space:pre-wrap;word-break:break-word;font-size:13px;max-height:160px;overflow:auto}
            .cc-foot{margin-top:3px;font-size:11px;color:#6b7280;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
            .cc-empty{font-size:13px;color:#6b7280}
            .cc-open{font-size:13px;font-weight:600;color:#1d5bd8;text-decoration:none;white-space:nowrap}`;
        document.head.appendChild(st);
    }

    async function render(leadId, box) {
        if (!box || !leadId || typeof sbClient === "undefined") return;
        box.innerHTML = `<div class="cc-empty">Завантаження переписки…</div>`;
        const { data: threads, error } = await sbClient
            .from("comm_threads")
            .select("id, channel, contact_name, contact_handle, staff_name, unanswered_since, last_message_at, carrier_id")
            .eq("lead_id", String(leadId))
            .order("last_message_at", { ascending: false })
            .limit(50);
        // Переписку ще не підключено (немає таблиць) — блок мовчки ховаємо
        if (error) {
            box.closest("[data-cc-section]")?.setAttribute("hidden", "");
            box.innerHTML = "";
            return;
        }
        const open = `<a class="cc-open" href="comms.html?lead=${encodeURIComponent(leadId)}">Відкрити в «Переписці» →</a>`;
        if (!threads?.length) {
            box.innerHTML = `<div class="cc-top"><span class="cc-empty">Переписки з цим клієнтом ще немає або вона вам не доступна.
                Пошта й WhatsApp прив'язуються самі за e-mail / телефоном з картки; Telegram і Viber — у «Переписці» → поле «Лід».</span></div>`;
            return;
        }
        const ids = threads.map((t) => t.id);
        const byId = new Map(threads.map((t) => [t.id, t]));
        const { data: msgs } = await sbClient
            .from("comm_messages")
            .select("id, thread_id, channel, direction, sent_at, subject, text, ai_intent, ai_has_rate, ai_note")
            .in("thread_id", ids)
            .order("sent_at", { ascending: false })
            .limit(FEED_LIMIT);
        const feed = (msgs || []).slice().reverse();

        box.innerHTML = `
            <div class="cc-wrap">
                <div class="cc-top">
                    <div class="cc-threads">${threads
                        .map((t) => {
                            const wait = t.unanswered_since && !t.carrier_id;
                            return `<a class="cc-thread ${wait ? "wait" : ""}" href="comms.html?t=${t.id}" title="${esc(t.contact_handle)}">
                                ${chBadge(t.channel)} ${esc(t.contact_name || t.contact_handle)}
                                ${t.staff_name ? `<span class="cc-empty">· ${esc(t.staff_name)}</span>` : ""}
                                ${wait ? `<span class="cc-wait">⏳ ${ago(t.unanswered_since)}</span>` : ""}
                            </a>`;
                        })
                        .join("")}</div>
                    ${open}
                </div>
                <div class="cc-feed">${feed
                    .map((m) => {
                        const t = byId.get(m.thread_id) || {};
                        const it = INTENT[m.ai_intent];
                        return `<div class="cc-msg ${m.direction}">
                            ${m.subject ? `<div class="cc-subj">${esc(m.subject)}</div>` : ""}
                            <div class="cc-text">${esc(m.text || "")}</div>
                            <div class="cc-foot">
                                ${chBadge(m.channel)}
                                <span>${m.direction === "out" ? esc(t.staff_name || "Грандар") : esc(t.contact_name || t.contact_handle || "Клієнт")}</span>
                                <span>${when(m.sent_at)}</span>
                                ${it ? chip(it[0], it[1], it[2]) : ""}
                                ${m.direction === "out" && m.ai_has_rate ? chip("ставку названо", "#166534", "#dcfce7") : ""}
                                ${m.ai_note ? `<span>${esc(m.ai_note)}</span>` : ""}
                            </div>
                        </div>`;
                    })
                    .join("")}</div>
                ${(msgs || []).length >= FEED_LIMIT ? `<span class="cc-empty">Показано останні ${FEED_LIMIT} повідомлень. Уся історія — в «Переписці».</span>` : ""}
            </div>`;
        const f = box.querySelector(".cc-feed");
        if (f) f.scrollTop = f.scrollHeight;
    }

    window.furaCommsBlock = render;
})();
