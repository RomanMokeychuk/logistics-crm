/* ================================================================= *
 * FURA — СПОВІЩЕННЯ «ОБРАНА МАШИНА ПРОЙШЛА КОРДОН»                    *
 * Працює на всіх сторінках (підключає shell.js).                       *
 * Обрані (★) ставляться на вкладці «Черга»; «пройшла» позначає         *
 * функція fura-echerha, коли машина зникає з черги.                    *
 * ================================================================= */
(function () {
    if (window.top !== window.self || window.__furaWatchNotify) return;
    window.__furaWatchNotify = true;
    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) return;
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const cpShort = (n) => String(n || "").replace(/\s*\((для|Туреччина)[^)]*\)\s*$/i, "");
    const shown = new Set();

    function toast(w) {
        if (shown.has(w.id) || typeof window.furaToast !== "function") return false;
        shown.add(w.id);
        window.furaToast({
            kind: "answer",
            icon: "✅",
            title: "Обрана машина пройшла кордон",
            text: `<b>${esc(w.plate)}</b>${w.trailer ? " / " + esc(w.trailer) : ""} — ${esc(cpShort(w.checkpoint))}${w.carrier ? `<br>${esc(w.carrier)}` : ""}`,
            href: "echerha.html?view=watch",
            tag: "watch-" + w.id,
        });
        return true;
    }

    async function start() {
        const { data: { session } } = await client.auth.getSession();
        if (!session) return;
        const uid = session.user.id;

        // пропущене, поки CRM була закрита
        const { data, error } = await client.from("echerha_watch").select("*").eq("status", "passed").eq("seen", false).limit(10);
        if (error) return; // таблиці ще немає — тихо виходимо
        const ids = (data || []).filter(toast).map((w) => w.id);
        if (ids.length) client.from("echerha_watch").update({ seen: true }).in("id", ids).then(() => {});

        client
            .channel("fura-watch-notify")
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "echerha_watch", filter: `user_id=eq.${uid}` }, (p) => {
                const w = p.new || {};
                if (w.status === "passed" && !w.seen && toast(w)) {
                    client.from("echerha_watch").update({ seen: true }).eq("id", w.id).then(() => {});
                }
            })
            .subscribe();
    }

    // notify.js (furaToast) підключається після shell.js — чекаємо, поки сторінка довантажиться
    const go = () => setTimeout(() => start().catch((e) => console.warn("FURA обрані:", e)), 800);
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go);
})();
