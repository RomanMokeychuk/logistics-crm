/* ================================================================= *
 * FURA — «Задачі від РОПа» на головній сторінці.                     *
 * Кожен бачить лише свої відкриті задачі; керівник — ще й посилання  *
 * на сторінку «РОП» з кількістю термінових задач по відділу.         *
 * Потрібен sbClient (оголошений у home.js).                          *
 * ================================================================= */

(function () {
    const KIND_LABEL = {
        logist_reply: "Запит без відповіді",
        sales_react: "Ставка без реакції",
        lead_overdue: "Прострочений контакт",
        lead_stale: "Лід без руху",
        negotiation_long: "Затяжні переговори",
        client_silent: "Клієнт затих",
        payment_late: "Немає оплати",
        low_profit: "Низький профіт",
        deal_late: "Запізнення завантаження",
        draft_wait: "Листи AI-продажів",
        reply_waiting: "Клієнт відповів",
        assign_lead: "Лід без відповідального",
    };
    const SHOW = 8;

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const safeLink = (l) => (/^[a-z-]+\.html(\?[\w=&%.-]*)?$/i.test(String(l || "")) ? String(l) : "");
    const rolesOf = (s) => (Array.isArray(s?.roles) && s.roles.length ? s.roles : s?.role ? [s.role] : []);

    let me = null;
    let boss = false;

    async function load() {
        const block = document.getElementById("ropHomeBlock");
        if (!block || !me) return;
        const { data, error } = await sbClient
            .from("rop_tasks")
            .select("*")
            .eq("status", "open")
            .eq("assignee_id", String(me.id))
            .order("priority")
            .order("created_at", { ascending: false })
            .limit(50);
        // Таблиці ще немає (rop.sql не виконано) — плитку не показуємо
        if (error) {
            block.hidden = true;
            return;
        }
        let bossLine = "";
        if (boss) {
            const { count } = await sbClient
                .from("rop_tasks")
                .select("id", { count: "exact", head: true })
                .eq("status", "open")
                .eq("priority", 1);
            bossLine = `<a class="ag-link" href="rop.html">Звіт РОПа по відділу${count ? ` · термінових задач: <b>${count}</b>` : ""} →</a>`;
        }
        const list = data || [];
        if (!list.length && !boss) {
            block.hidden = true;
            return;
        }
        block.hidden = false;
        document.getElementById("ropHomeCount").textContent = list.length || "";
        document.getElementById("ropHomeList").innerHTML =
            (list.length
                ? list
                      .slice(0, SHOW)
                      .map((t) => {
                          const link = safeLink(t.link);
                          return `<div class="rop-task p${t.priority}">
                            <div class="rop-task-main">
                                <div class="rop-task-top">
                                    <span class="rop-prio"></span>
                                    <span class="ag-chip">${esc(KIND_LABEL[t.kind] || t.kind)}</span>
                                </div>
                                <div class="rop-task-title">${esc(t.title)}</div>
                                ${t.details ? `<div class="rop-task-details">${esc(t.details)}</div>` : ""}
                            </div>
                            <div class="rop-task-actions">
                                ${link ? `<a class="btn btn-secondary btn-sm" href="${link}"><i class="bx bx-link-external"></i> Відкрити</a>` : ""}
                                <button type="button" class="btn btn-secondary btn-sm" data-rop="done" data-id="${t.id}"><i class="bx bx-check"></i> Зроблено</button>
                                <button type="button" class="btn btn-secondary btn-sm" data-rop="dismissed" data-id="${t.id}" title="Сховати на 7 днів">Не актуально</button>
                            </div>
                        </div>`;
                      })
                      .join("")
                : `<p class="ag-empty">Особистих задач немає 🎉</p>`) +
            (list.length > SHOW ? `<p class="rop-home-more ag-hint">І ще ${list.length - SHOW}…</p>` : "") +
            (bossLine ? `<p class="rop-home-more">${bossLine}</p>` : "");
    }

    document.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-rop]");
        if (!b) return;
        b.disabled = true;
        const { error } = await sbClient.functions.invoke("fura-rop", { body: { action: "task", id: b.dataset.id, status: b.dataset.rop } });
        if (error) {
            b.disabled = false;
            alert("Не вдалося оновити задачу. Спробуйте ще раз.");
            return;
        }
        load();
    });

    document.addEventListener("DOMContentLoaded", async () => {
        if (typeof sbClient === "undefined") return;
        const {
            data: { session },
        } = await sbClient.auth.getSession();
        if (!session) return;
        const email = (session.user?.email || "").toLowerCase();
        const { data } = await sbClient.from("staff").select("id, full_name, email, role, roles").ilike("email", email).limit(1);
        me = data?.[0] || null;
        boss = rolesOf(me).some((r) => r === "head" || r === "admin");
        await load();
        let t = null;
        sbClient
            .channel("rop-home")
            .on("postgres_changes", { event: "*", schema: "public", table: "rop_tasks" }, () => {
                clearTimeout(t);
                t = setTimeout(load, 800);
            })
            .subscribe();
    });
})();
