/* ================================================================= *
 * FURA — Аналітика: розрахунки (без DOM, щоб перевіряти окремо)      *
 * Гроші — так само, як у картці угоди (deals.js → calcTotals):       *
 * сума × кількість ÷ курс до долара, тобто все в $.                  *
 * ================================================================= */

(function (root) {
    const DAY = 864e5;
    const num = (v) => {
        const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
        return isFinite(n) ? n : 0;
    };
    const WON = ["В роботі", "Виконано"];

    // Дохід / витрати / профіт угоди в $ + чи заповнені курси
    function dealMoney(d) {
        const rows = Array.isArray(d.services) ? d.services : [];
        let income = 0, expense = 0, missing = false, any = false;
        for (const r of rows) {
            const qty = num(r.qty) || 1;
            const inSum = qty * num(r.in_rate), outSum = qty * num(r.out_rate);
            if (inSum || outSum) any = true;
            if (inSum) {
                if (num(r.in_fx)) income += inSum / num(r.in_fx);
                else missing = true;
            }
            if (outSum) {
                if (num(r.out_fx)) expense += outSum / num(r.out_fx);
                else missing = true;
            }
        }
        return { income, expense, profit: income - expense, complete: any && !missing && income > 0 };
    }

    // Дата угоди за обраною базою
    function dealDate(d, basis) {
        if (basis === "created") return d.created_at || null;
        if (basis === "unload") return d.unload_date || null;
        return d.load_date || d.load_date_plan || d.created_at || null; // load
    }

    const inRange = (iso, from, to) => {
        if (!iso) return false;
        const t = String(iso).slice(0, 10);
        return t >= from && t <= to;
    };

    // Попередній період такої самої довжини
    function prevRange(from, to) {
        const f = Date.parse(from), t = Date.parse(to);
        const len = Math.round((t - f) / DAY) + 1;
        const pt = new Date(f - DAY), pf = new Date(f - len * DAY);
        return { from: pf.toISOString().slice(0, 10), to: pt.toISOString().slice(0, 10) };
    }

    function matches(d, f) {
        if (f.sales && String(d.sales_id || d.sales) !== f.sales) return false;
        if (f.logist && String(d.logist_id || d.logist_name) !== f.logist) return false;
        if (f.kind && (d.deal_kind || "FTL") !== f.kind) return false;
        if (f.q) {
            const hay = `${d.number} ${d.client || ""} ${d.carrier_name || ""} ${d.load_country || ""} ${d.unload_country || ""}`.toLowerCase();
            if (!hay.includes(f.q.toLowerCase())) return false;
        }
        return true;
    }

    function summarize(deals) {
        const s = { deals: deals.length, income: 0, expense: 0, profit: 0, fact: 0, complete: 0, incomplete: 0, negative: 0, receivable: 0, overdue: 0, payable: 0 };
        const now = Date.now();
        for (const d of deals) {
            const m = d._m;
            if (!m.complete) {
                s.incomplete++;
                continue;
            }
            s.complete++;
            s.income += m.income;
            s.expense += m.expense;
            s.profit += m.profit;
            if (m.profit < 0) s.negative++;
            if (d.paid_by_client && d.paid_to_carrier) s.fact += m.profit;
            if (d.unload_date && !d.paid_by_client) {
                s.receivable += m.income;
                if (now - Date.parse(d.unload_date) > 14 * DAY) s.overdue += m.income;
            }
            if (d.unload_date && !d.paid_to_carrier) s.payable += m.expense;
        }
        s.margin = s.income ? (s.profit / s.income) * 100 : null;
        s.avgProfit = s.complete ? s.profit / s.complete : null;
        return s;
    }

    // Групування по людях / клієнтах / напрямках
    function groupBy(deals, keyFn, labelFn) {
        const map = new Map();
        for (const d of deals) {
            const k = keyFn(d);
            if (!k) continue;
            if (!map.has(k)) map.set(k, { key: k, label: labelFn(d), items: [] });
            map.get(k).items.push(d);
        }
        return [...map.values()].map((g) => ({ ...g, ...summarize(g.items) }));
    }

    // Головний розрахунок для сторінки
    function compute({ deals, requests, staff, from, to, basis, filters }) {
        const all = deals.map((d) => (d._m ? d : { ...d, _m: dealMoney(d) }));
        const pick = (a, b) => all.filter((d) => inRange(dealDate(d, basis), a, b) && matches(d, filters));
        const cur = pick(from, to);
        const pr = prevRange(from, to);
        const prev = pick(pr.from, pr.to);
        const total = summarize(cur);
        const before = summarize(prev);

        const nameById = new Map(staff.map((s) => [String(s.id), s.full_name]));
        const salesKey = (d) => String(d.sales_id || d.sales || "");
        const salesLabel = (d) => nameById.get(String(d.sales_id)) || d.sales || "Без Sales";
        const logistKey = (d) => String(d.logist_id || d.logist_name || "");
        const logistLabel = (d) => nameById.get(String(d.logist_id)) || d.logist_name || "Без логіста";

        // Перша угода клієнта взагалі — щоб рахувати нових клієнтів
        const firstDeal = new Map();
        for (const d of all) {
            const c = clientKey(d);
            const t = dealDate(d, basis);
            if (!c || !t) continue;
            if (!firstDeal.has(c) || t < firstDeal.get(c)) firstDeal.set(c, t);
        }

        // Запити → в роботі (конверсія Sales), за датою створення запиту
        const reqs = requests.filter((r) => inRange(r.created_at, from, to));
        const reqBy = new Map();
        for (const r of reqs) {
            const k = String(r.sales_id || r.sales || "");
            if (!k) continue;
            const x = reqBy.get(k) || { total: 0, won: 0, refused: 0 };
            x.total++;
            if (WON.includes(r.status)) x.won++;
            if (r.status === "Відмова") x.refused++;
            reqBy.set(k, x);
        }

        const sales = groupBy(cur, salesKey, salesLabel).map((g) => {
            const clients = new Set(g.items.map(clientKey).filter(Boolean));
            const fresh = [...clients].filter((c) => inRange(firstDeal.get(c), from, to)).length;
            const rq = reqBy.get(g.key) || (() => {
                // запити могли бути записані на ім'я
                const byName = [...reqBy.entries()].find(([k]) => k === g.label);
                return byName ? byName[1] : { total: 0, won: 0, refused: 0 };
            })();
            const prevG = summarize(prev.filter((d) => salesKey(d) === g.key));
            return {
                ...g,
                clients: clients.size,
                newClients: fresh,
                share: total.profit > 0 && g.profit >= 0 ? (g.profit / total.profit) * 100 : null,
                requests: rq.total,
                conversion: rq.total ? (rq.won / rq.total) * 100 : null,
                prevProfit: prevG.profit,
            };
        });
        // Sales без угод у періоді, але з запитами — теж показуємо
        for (const [k, rq] of reqBy) {
            if (sales.some((s) => s.key === k || s.label === k)) continue;
            const label = nameById.get(k) || k;
            sales.push({ key: k, label, items: [], ...summarize([]), clients: 0, newClients: 0, share: null, requests: rq.total, conversion: (rq.won / rq.total) * 100, prevProfit: 0 });
        }
        sales.sort((a, b) => b.profit - a.profit);

        const logists = groupBy(cur, logistKey, logistLabel).sort((a, b) => b.profit - a.profit);
        const clients = groupBy(cur, clientKey, (d) => d.client || "Без клієнта").sort((a, b) => b.profit - a.profit);
        const routes = groupBy(cur, routeKey, routeKey).sort((a, b) => b.profit - a.profit);

        return { cur, prev, total, before, prevRange: pr, sales, logists, clients, routes };
    }

    // Профіт по місяцях (для графіка) — останні n місяців до `to`
    function monthly(deals, basis, filters, to, n = 12) {
        const end = new Date(to);
        const out = [];
        for (let i = n - 1; i >= 0; i--) {
            const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            out.push({ key, y: d.getFullYear(), m: d.getMonth(), list: [] });
        }
        const idx = new Map(out.map((x, i) => [x.key, i]));
        for (const d of deals) {
            if (!matches(d, filters)) continue;
            const t = dealDate(d, basis);
            if (!t) continue;
            const i = idx.get(String(t).slice(0, 7));
            if (i !== undefined) out[i].list.push(d._m ? d : { ...d, _m: dealMoney(d) });
        }
        return out.map((x) => ({ key: x.key, y: x.y, m: x.m, ...summarize(x.list) }));
    }

    function clientKey(d) {
        return d.lead_id ? `lead:${d.lead_id}` : d.client ? `name:${String(d.client).trim().toLowerCase()}` : "";
    }
    function routeKey(d) {
        return d.load_country || d.unload_country ? `${d.load_country || "?"} → ${d.unload_country || "?"}` : "";
    }

    root.FuraAnalytics = { dealMoney, dealDate, prevRange, summarize, compute, monthly, inRange, clientKey, routeKey };
})(typeof window !== "undefined" ? window : globalThis);
