/* ================================================================= *
 * FURA — «ЗАРАЗ У CRM»                                                 *
 * Хто з колег зараз відкрив FURA і на якій сторінці.                   *
 * Працює через Supabase Realtime Presence: нічого не пише в базу,      *
 * SQL і нові таблиці не потрібні. Підключається з shell.js.            *
 * • зелена крапка — працює зараз                                      *
 * • жовта — вкладка відкрита, але 5+ хв без дій або згорнута          *
 * ================================================================= */
(function () {
    if (window.top !== window.self || window.__furaPresence) return;
    window.__furaPresence = true;

    const IDLE_MS = 5 * 60 * 1000;
    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const initials = (name) =>
        String(name || "?")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0])
            .join("")
            .toUpperCase() || "?";

    function css() {
        const st = document.createElement("style");
        st.textContent = `
.fura-online{margin-top:12px;padding:10px 6px 0;border-top:1px solid rgba(255,255,255,.08)}
.fura-online-title{display:flex;align-items:center;gap:6px;color:#8392b4;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}
.fura-online-title b{background:rgba(46,204,113,.18);color:#2ecc71;border-radius:9px;padding:0 7px;font-size:11px}
.fura-online-list{display:flex;flex-direction:column;gap:4px;max-height:210px;overflow-y:auto}
.fura-online-item{display:flex;align-items:center;gap:8px;min-width:0;padding:3px 0}
.fura-online-av{position:relative;width:28px;height:28px;flex-shrink:0;border-radius:50%;background:#2b3a5c;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.fura-online-av::after{content:"";position:absolute;right:-1px;bottom:-1px;width:9px;height:9px;border-radius:50%;background:#2ecc71;border:2px solid #14213d}
.fura-online-item.idle .fura-online-av::after{background:#f5b700}
.fura-online-text{display:flex;flex-direction:column;min-width:0}
.fura-online-name{color:#e6ebf5;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fura-online-page{color:#8392b4;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fura-online-empty{color:#8392b4;font-size:12px}
body.sidebar-collapsed .fura-online-title span,body.sidebar-collapsed .fura-online-text,body.sidebar-collapsed .fura-online-empty{display:none}
body.sidebar-collapsed .fura-online-item{justify-content:center}`;
        document.head.appendChild(st);
    }

    function mountBox() {
        const user = document.getElementById("furaUser");
        if (!user) return null;
        let box = document.getElementById("furaOnline");
        if (box) return box;
        box = document.createElement("div");
        box.className = "fura-online";
        box.id = "furaOnline";
        box.innerHTML = `<div class="fura-online-title"><i class="bx bx-wifi"></i><span>Зараз у FURA</span> <b>…</b></div>
                         <div class="fura-online-list"></div>`;
        user.parentNode.insertBefore(box, user);
        return box;
    }

    function pageLabel() {
        const crumbs = document.getElementById("furaCrumbs");
        const parts = crumbs
            ? [...crumbs.children].filter((el) => !el.classList.contains("fura-sep")).map((el) => el.textContent.trim()).filter(Boolean)
            : [];
        if (parts[0] === "FURA" && parts.length > 1) parts.shift();
        const t = parts.join(" / ");
        return t || document.title.replace(/^FURA\s*—\s*/, "") || "FURA";
    }

    function render(box, state, myId) {
        const people = Object.entries(state).map(([id, metas]) => {
            // одна людина може мати кілька вкладок — беремо найактивнішу / найсвіжішу
            const m = [...metas].sort((a, b) => (a.idle === b.idle ? (b.at || 0) - (a.at || 0) : a.idle ? 1 : -1))[0] || {};
            return { id, name: m.name, page: m.page, idle: !!m.idle, tabs: metas.length };
        });
        people.sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : a.idle - b.idle || String(a.name).localeCompare(String(b.name), "uk")));
        box.querySelector(".fura-online-title b").textContent = people.length;
        const list = box.querySelector(".fura-online-list");
        if (!people.length) {
            list.innerHTML = `<div class="fura-online-empty">Нікого</div>`;
            return;
        }
        list.innerHTML = people
            .map((p) => {
                const who = p.id === myId ? `${esc(p.name)} (ви)` : esc(p.name);
                const where = (p.idle ? "відійшов · " : "") + (p.page || "");
                const tip = `${p.name} — ${p.idle ? "неактивний" : "працює"}: ${p.page || ""}${p.tabs > 1 ? ` (вкладок: ${p.tabs})` : ""}`;
                return `<div class="fura-online-item${p.idle ? " idle" : ""}" title="${esc(tip)}">
                    <span class="fura-online-av">${esc(initials(p.name))}</span>
                    <span class="fura-online-text"><span class="fura-online-name">${who}</span><span class="fura-online-page">${esc(where)}</span></span>
                </div>`;
            })
            .join("");
    }

    async function start() {
        if (typeof sbClient === "undefined" || !sbClient.channel) return;
        const {
            data: { session },
        } = await sbClient.auth.getSession();
        if (!session) return;
        const email = (session.user?.email || "").toLowerCase();
        let name = email;
        try {
            const { data } = await sbClient.from("staff").select("full_name").ilike("email", email).limit(1);
            if (data?.[0]?.full_name) name = data[0].full_name;
        } catch (e) {
            /* ім'ям буде e-mail */
        }

        css();
        const box = mountBox();
        if (!box) return;

        const myId = session.user.id;
        const ch = sbClient.channel("fura-online", { config: { presence: { key: myId } } });
        let lastAction = Date.now();
        let sent = "";
        const meta = () => ({ name, page: pageLabel(), idle: document.hidden || Date.now() - lastAction > IDLE_MS });
        const push = (force) => {
            const m = meta();
            const sig = m.page + "|" + m.idle;
            if (!force && sig === sent) return;
            sent = sig;
            ch.track({ ...m, at: Date.now() }).catch(() => {});
        };

        ch.on("presence", { event: "sync" }, () => render(box, ch.presenceState(), myId));
        ch.subscribe((status) => {
            if (status === "SUBSCRIBED") push(true);
        });

        ["pointerdown", "keydown", "scroll", "mousemove"].forEach((ev) =>
            window.addEventListener(
                ev,
                () => {
                    const wasIdle = Date.now() - lastAction > IDLE_MS;
                    lastAction = Date.now();
                    if (wasIdle) push();
                },
                { passive: true, capture: true },
            ),
        );
        document.addEventListener("visibilitychange", () => push());
        setInterval(() => push(), 20000); // сторінка/угода змінилась або минули 5 хв без дій
        window.addEventListener("pagehide", () => ch.untrack().catch(() => {}));
    }

    start().catch((e) => console.warn("FURA online:", e));
})();
