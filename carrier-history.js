/* ================================================================= *
 * FURA — ІСТОРІЯ В КАРТЦІ ПЕРЕВІЗНИКА                                *
 * Усі рейси для нас (з угод), ставка перевізнику, маршрути,          *
 * а також ставки, які він давав по запитах (carrier_bids).           *
 * Підключається на index.html після script.js.                       *
 * ================================================================= */

(function () {
    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) return;

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const quoted = (v) => `"${String(v).replace(/["\\]/g, " ")}"`;
    const num = (v) => Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")) || 0;
    const fmtDate = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join(".") : "—");
    const money = (v, cur) => `${Math.round(v).toLocaleString("uk-UA").replace(/\u00a0/g, " ")} ${cur}`;
    const cap = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : "—");

    // Ставка перевізнику в угоді = рядки «вихідна» сторона (out_rate × кількість), по валютах
    function carrierCost(d) {
        const by = {};
        for (const r of Array.isArray(d.services) ? d.services : []) {
            const v = (num(r.qty) || 1) * num(r.out_rate);
            if (v > 0) by[r.out_cur || "EUR"] = (by[r.out_cur || "EUR"] || 0) + v;
        }
        return by;
    }

    let seq = 0;

    async function render(item) {
        const body = document.getElementById("carrierCardBody");
        if (!body || !item) return;
        const my = ++seq;
        body.querySelector("#carrierHistory")?.remove();
        const box = document.createElement("div");
        box.id = "carrierHistory";
        box.className = "ch";
        box.innerHTML = `<div class="ch-title"><i class="bx bx-history"></i> Історія з нами</div><div class="ch-body"><div class="ch-empty">Завантаження…</div></div>`;
        body.appendChild(box);

        const conds = [`carrier_id.eq.${quoted(item.id)}`];
        if (item.edrpou) conds.push(`carrier_edrpou.eq.${quoted(item.edrpou)}`);
        if (item.name) conds.push(`carrier_name.ilike.${quoted(item.name)}`);

        const [dealsRes, bidsRes] = await Promise.all([
            client
                .from("deals")
                .select("id, number, client, load_country, load_address, unload_country, unload_address, load_date, status, services, truck_plate")
                .or(conds.join(","))
                .order("load_date", { ascending: false, nullsFirst: false })
                .limit(60),
            client
                .from("carrier_bids")
                .select("price, currency, load_date, status, created_at, request_id")
                .or([`carrier_id.eq.${quoted(item.id)}`, item.name ? `carrier_name.ilike.${quoted(item.name)}` : null].filter(Boolean).join(","))
                .order("created_at", { ascending: false })
                .limit(40),
        ]);
        if (my !== seq) return;

        const deals = dealsRes.data || [];
        const bids = bidsRes.error ? [] : bidsRes.data || [];
        const out = box.querySelector(".ch-body");

        if (!deals.length && !bids.length) {
            out.innerHTML = `<div class="ch-empty">Для нас ще не возив і ставок не давав.</div>`;
            return;
        }

        // Зведення
        const routes = {};
        const costs = {}; // валюта → [суми]
        for (const d of deals) {
            const k = `${cap(d.load_country)} → ${cap(d.unload_country)}`;
            routes[k] = (routes[k] || 0) + 1;
            for (const [cur, v] of Object.entries(carrierCost(d))) (costs[cur] = costs[cur] || []).push(v);
        }
        const topRoutes = Object.entries(routes).sort((a, b) => b[1] - a[1]).slice(0, 3);
        const mainCur = Object.keys(costs).sort((a, b) => costs[b].length - costs[a].length)[0];
        const avg = mainCur ? costs[mainCur].reduce((a, b) => a + b, 0) / costs[mainCur].length : 0;

        const bidPrices = bids.filter((b) => b.status === "bid" && num(b.price) > 0);
        const bidCur = bidPrices.length ? bidPrices[0].currency : null;
        const bidSame = bidPrices.filter((b) => b.currency === bidCur);
        const bidAvg = bidSame.length ? bidSame.reduce((a, b) => a + num(b.price), 0) / bidSame.length : 0;
        const refused = bids.filter((b) => b.status === "refused").length;

        const tiles = [
            `<div class="ch-tile"><span>Рейсів для нас</span><b>${deals.length}${deals.length >= 60 ? "+" : ""}</b></div>`,
            `<div class="ch-tile"><span>Останній рейс</span><b>${deals.length ? fmtDate(deals[0].load_date) : "—"}</b></div>`,
            `<div class="ch-tile"><span>Середня ставка перевізнику</span><b>${mainCur ? money(avg, mainCur) : "—"}</b>${mainCur ? `<small>по ${costs[mainCur].length} рейс.</small>` : ""}</div>`,
            `<div class="ch-tile"><span>Ставки по запитах</span><b>${bidSame.length ? money(bidAvg, bidCur) : "—"}</b><small>${bidPrices.length} став.${refused ? ` · ${refused} відмов` : ""}</small></div>`,
        ].join("");

        const routesHtml = topRoutes.length
            ? `<div class="ch-routes">${topRoutes.map(([r, n]) => `<span>${esc(r)} <b>×${n}</b></span>`).join("")}</div>`
            : "";

        const rows = deals
            .slice(0, 10)
            .map((d) => {
                const c = carrierCost(d);
                const cost = Object.entries(c).map(([cur, v]) => money(v, cur)).join(" + ") || "—";
                const route = `${cap(d.load_country)}${d.load_address ? ` (${d.load_address.split(",")[0]})` : ""} → ${cap(d.unload_country)}${d.unload_address ? ` (${d.unload_address.split(",")[0]})` : ""}`;
                return `<a class="ch-row" href="deals.html?open=${encodeURIComponent(d.id)}">
                    <span class="ch-date">${fmtDate(d.load_date)}</span>
                    <span class="ch-route">${esc(route)}<small>№ ${esc(d.number ?? "—")}${d.client ? ` · ${esc(d.client)}` : ""}${d.truck_plate ? ` · ${esc(d.truck_plate)}` : ""}</small></span>
                    <span class="ch-cost">${esc(cost)}</span>
                    <span class="ch-status">${esc(d.status || "")}</span>
                </a>`;
            })
            .join("");

        out.innerHTML = `
            <div class="ch-tiles">${tiles}</div>
            ${routesHtml}
            ${rows ? `<div class="ch-list">${rows}</div>` : ""}
            ${deals.length > 10 ? `<div class="ch-more">Показано 10 останніх із ${deals.length}${deals.length >= 60 ? "+" : ""}</div>` : ""}`;
    }

    window.furaCarrierHistory = { render };
})();
