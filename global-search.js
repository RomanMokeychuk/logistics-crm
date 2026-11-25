/* ================================================================= *
 * FURA — ОДИН ПОШУК НА ВСЮ CRM (рядок у верхній смузі)               *
 * Номер фури, перевізник, клієнт, № угоди, ЄДРПОУ, телефон →         *
 * одразу відкриває потрібну картку. Cmd+K / Ctrl+K — фокус у пошук.  *
 * Підключається з shell.js на всіх сторінках.                        *
 * ================================================================= */

(function () {
    if (window.top !== window.self || window.__furaGlobalSearch) return;
    window.__furaGlobalSearch = true;

    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) return;

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);

    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "global-search.css?v=202610200010";
    document.head.appendChild(css);

    /* ---------------- Підготовка тексту ---------------- */

    // Номери авто пишуть і кирилицею, і латиницею — шукаємо обидва варіанти
    const CYR2LAT = { А: "A", В: "B", С: "C", Е: "E", Н: "H", І: "I", К: "K", М: "M", О: "O", Р: "P", Т: "T", Х: "X" };
    const LAT2CYR = Object.fromEntries(Object.entries(CYR2LAT).map(([c, l]) => [l, c]));

    // Безпечне значення для фільтра or(...) у лапках
    const quoted = (v) => `"${String(v).replace(/["\\]/g, " ")}"`;
    const like = (col, v) => `${col}.ilike.${quoted(`%${v}%`)}`;

    function plateVariants(q) {
        const up = q.toUpperCase().replace(/[\s\-]/g, "");
        if (!/^[A-ZА-ЯІЇЄ]{0,3}\d{2,5}[A-ZА-ЯІЇЄ]{0,3}$/.test(up) || !/\d/.test(up)) return [];
        const lat = up.replace(/[АВСЕНІКМОРТХ]/g, (ch) => CYR2LAT[ch] || ch);
        const cyr = up.replace(/[ABCEHIKMOPTX]/g, (ch) => LAT2CYR[ch] || ch);
        // «AA1234BC» → «AA%1234%BC», щоб знайти й «AA 1234 BC»
        const gap = (s) => s.replace(/([A-ZА-ЯІЇЄ]+)(\d+)/, "$1%$2").replace(/(\d+)([A-ZА-ЯІЇЄ]+)/, "$1%$2");
        return [...new Set([gap(lat), gap(cyr)])];
    }

    // Перевізник за номером тягача — з митних даних (carrier_routes.plates)
    async function carriersByPlate(plates, cols) {
        if (!plates.length) return [];
        const { data: rt } = await client
            .from("carrier_routes")
            .select("edrpou, plates")
            .or(plates.map((p) => like("plates", p)).join(","))
            .limit(40);
        if (!rt || !rt.length) return [];
        const re = new RegExp(plates[0].replace(/%/g, "\\s*"), "i");
        const plateOf = new Map();
        rt.forEach((r) => {
            const k = String(r.edrpou || "").replace(/\D/g, "").replace(/^0+/, "");
            const hit = String(r.plates || "").split(/[,;]\s*/).find((x) => re.test(x));
            if (k && !plateOf.has(k)) plateOf.set(k, hit || "");
        });
        const codes = [...plateOf.keys()].flatMap((k) => [k, k.padStart(8, "0")]);
        const { data } = await client.from("carriers").select(cols).in("edrpou", [...new Set(codes)]).limit(10);
        return (data || []).map((c) => ({ c, plate: plateOf.get(String(c.edrpou || "").replace(/\D/g, "").replace(/^0+/, "")) }));
    }

    /* ---------------- Пошук по всіх розділах ---------------- */

    const SECTIONS = [
        {
            // «Сталь», «масло», «зерно»… — хто цей товар возив (угоди), хто відправляв (клієнти) і хто виставляє на Lardi
            key: "goods",
            title: "Товар — хто возив і хто відправляє",
            icon: "bx-package",
            async run(q, plates, digits) {
                if (q.length < 3 || digits.length >= 3 || plates.length) return [];
                const since = new Date(Date.now() - 30 * 86400000).toISOString();
                const [deals, reqs, leads, lardi, notes, customs, cgoods] = await Promise.all([
                    client.from("deals").select("carrier_id, carrier_name, client, cargo, load_date").ilike("cargo", `%${q}%`).order("load_date", { ascending: false }).limit(300),
                    client.from("requests").select("client, lead_id, cargo, created_at").ilike("cargo", `%${q}%`).order("created_at", { ascending: false }).limit(300),
                    client.from("leads").select("id, name, cargo, status").ilike("cargo", `%${q}%`).limit(20),
                    client.from("lardi_cargo").select("owner_name, owner_ref, cargo").ilike("cargo", `%${q}%`).gte("seen_last", since).limit(500),
                    // перевізники, у нотатках яких є цей товар («Що везли: …»)
                    client.from("carriers").select("id, name, notes").ilike("notes", `%${q}%`).limit(8),
                    // митні дані: що везли перевізники (опис товару з декларацій)
                    client.from("carrier_routes").select("edrpou, goods, records, direction, country").ilike("goods", `%${q}%`).limit(400),
                    // повна митна база: хто й коли возив цей товар (усі місяці)
                    client.from("carrier_goods").select("edrpou, carrier, direction, goods, countries, last_month, records").or(`goods.ilike.%${q.replace(/[,()*%]/g, " ").trim()}%,groups.ilike.%${q.replace(/[,()*%]/g, " ").trim()}%`).order("records", { ascending: false }).limit(300),
                ].map((p) => p.then((r) => r.data || []).catch(() => [])));
                const dShort = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join(".") : "");
                const goods = (a) => [...new Set(a.map((x) => String(x.cargo || "").trim()).filter(Boolean))].slice(0, 2).join(", ");
                const group = (arr, key) => {
                    const m = new Map();
                    arr.forEach((x) => { const k = key(x); if (!k) return; (m.get(k) || m.set(k, []).get(k)).push(x); });
                    return [...m.values()].sort((a, b) => b.length - a.length);
                };
                const out = [];
                // Перевізники, які возили
                group(deals, (d) => d.carrier_id || d.carrier_name).slice(0, 4).forEach((a) => {
                    const d = a[0];
                    out.push({
                        href: d.carrier_id ? `carriers.html?open=${encodeURIComponent(d.carrier_id)}` : `deals.html?q=${encodeURIComponent(d.carrier_name)}`,
                        carrier: d.carrier_id || null,
                        title: `🚛 ${d.carrier_name || "Перевізник"}`,
                        sub: `возив: ${goods(a)} · ${a.length} рейс(и) · останній ${dShort(d.load_date)}`,
                    });
                });
                // Митні дані + нотатки перевізників
                const snip = (t) => {
                    const s2 = String(t || "").replace(/\s+/g, " ");
                    const i = s2.toLowerCase().indexOf(q.toLowerCase());
                    if (i < 0) return s2.slice(0, 70);
                    const a = Math.max(0, i - 25), b = Math.min(s2.length, i + q.length + 45);
                    return (a ? "…" : "") + s2.slice(a, b) + (b < s2.length ? "…" : "");
                };
                const seenC = new Set(out.map((o) => String(o.carrier || "")));
                if (customs.length) {
                    const byCode = group(customs, (r) => r.edrpou);
                    const codes = byCode.slice(0, 12).map((a) => a[0].edrpou);
                    const { data: cs } = await client.from("carriers").select("id, name, edrpou").in("edrpou", codes).limit(20);
                    const byE = new Map((cs || []).map((c) => [String(c.edrpou), c]));
                    byCode.forEach((a) => {
                        const c = byE.get(String(a[0].edrpou));
                        if (!c || seenC.has(String(c.id)) || out.length >= 8) return;
                        seenC.add(String(c.id));
                        const recs = a.reduce((n, r) => n + (Number(r.records) || 1), 0);
                        out.push({
                            href: `carriers.html?open=${encodeURIComponent(c.id)}`, carrier: c.id,
                            title: `🚛 ${c.name}`,
                            sub: `митниця: ${snip(a[0].goods)} · ${recs} запис(и) · ${[...new Set(a.map((r) => r.country))].slice(0, 3).join(", ")}`,
                        });
                    });
                }
                if (cgoods.length) {
                    const byCode = group(cgoods, (r) => r.edrpou);
                    const codes = byCode.slice(0, 25).map((a) => a[0].edrpou);
                    const { data: cs } = await client.from("carriers").select("id, name, edrpou").in("edrpou", codes).limit(40);
                    const byE = new Map((cs || []).map((c) => [String(c.edrpou), c]));
                    // спершу ті, хто вже є у FURA
                    byCode.sort((a, b) => (byE.has(String(b[0].edrpou)) - byE.has(String(a[0].edrpou))) || b.reduce((n, r) => n + r.records, 0) - a.reduce((n, r) => n + r.records, 0));
                    byCode.forEach((a) => {
                        if (out.length >= 14) return;
                        const c = byE.get(String(a[0].edrpou));
                        if (c && seenC.has(String(c.id))) return;
                        if (c) seenC.add(String(c.id));
                        const recs = a.reduce((n, r) => n + (Number(r.records) || 0), 0);
                        const last = a.map((r) => r.last_month).sort().pop() || "";
                        const sub = `${[...new Set(a.map((r) => r.direction))].join("+").toLowerCase()} · ${snip(a[0].goods)} · ${recs} перевез. · ост. ${last.split("-").reverse().join(".")} · ${String(a[0].countries || "").split(", ").slice(0, 2).join(", ")}`;
                        out.push(c
                            ? { href: `carriers.html?open=${encodeURIComponent(c.id)}`, carrier: c.id, title: `🚛 ${c.name}`, sub }
                            : { href: `https://opendatabot.ua/c/${encodeURIComponent(a[0].edrpou)}`, title: `🚚 ${a[0].carrier || a[0].edrpou} · немає у FURA`, sub: `ЄДРПОУ ${a[0].edrpou} · ${sub}` });
                    });
                }
                notes.forEach((c) => {
                    if (seenC.has(String(c.id)) || out.length >= 10) return;
                    seenC.add(String(c.id));
                    out.push({ href: `carriers.html?open=${encodeURIComponent(c.id)}`, carrier: c.id, title: `🚛 ${c.name}`, sub: `у картці: ${snip(c.notes)}` });
                });
                // Клієнти, які відправляли (угоди + запити) і в кого це у «Що возить / виробляє»
                const cl = group([...deals.map((d) => ({ name: d.client, cargo: d.cargo })), ...reqs.map((r) => ({ name: r.client, cargo: r.cargo, id: r.lead_id }))], (x) => String(x.name || "").trim().toLowerCase());
                cl.slice(0, 3).forEach((a) => {
                    const id = a.find((x) => x.id)?.id;
                    out.push({
                        href: id ? `clients.html?open=${encodeURIComponent(id)}` : `requests.html?q=${encodeURIComponent(a[0].name)}`,
                        title: `🏢 ${a[0].name}`,
                        sub: `відправляв: ${goods(a)} · ${a.length} раз(и)`,
                    });
                });
                const shown = new Set(cl.slice(0, 3).map((a) => String(a[0].name || "").trim().toLowerCase()));
                leads.filter((l) => !shown.has(String(l.name || "").trim().toLowerCase())).slice(0, 3).forEach((l) => out.push({
                    href: l.status === "Працюємо" ? `clients.html?open=${encodeURIComponent(l.id)}` : `leads.html?open=${encodeURIComponent(l.id)}`,
                    title: `🏢 ${l.name}`,
                    sub: `возить / виробляє: ${String(l.cargo).slice(0, 80)}`,
                }));
                // Хто зараз виставляє такий вантаж на Lardi (за 30 днів)
                group(lardi, (x) => x.owner_ref || x.owner_name).slice(0, 3).forEach((a) => out.push({
                    href: `lardi.html?q=${encodeURIComponent(q)}`,
                    title: `📦 ${a[0].owner_name || "Компанія"} (Lardi)`,
                    sub: `виставляє: ${goods(a)} · ${a.length} заявок за 30 днів`,
                }));
                return out.slice(0, 18);
            },
        },
        {
            key: "deals",
            title: "Угоди",
            icon: "bx-file",
            async run(q, plates, digits) {
                const conds = [like("client", q), like("carrier_name", q), like("driver_name", q), like("load_address", q), like("unload_address", q)];
                plates.forEach((p) => conds.push(like("truck_plate", p), like("trailer_plate", p)));
                if (/^\d{1,7}$/.test(q)) conds.push(`number.eq.${q}`);
                const { data } = await client
                    .from("deals")
                    .select("id, number, client, carrier_name, truck_plate, load_country, unload_country, load_date, status")
                    .or(conds.join(","))
                    .order("number", { ascending: false })
                    .limit(6);
                return (data || []).map((d) => ({
                    href: `deals.html?open=${encodeURIComponent(d.id)}`,
                    title: `№ ${d.number ?? "—"} · ${d.client || "без клієнта"}`,
                    sub: [d.carrier_name, d.truck_plate, d.load_country && `${d.load_country} → ${d.unload_country || "—"}`, d.status].filter(Boolean).join(" · "),
                }));
            },
        },
        {
            key: "trips",
            title: "Рейси",
            icon: "bx-map-alt",
            async run(q, plates) {
                const conds = [like("trip_no", q), like("carrier_name", q), like("client", q), like("driver_name", q)];
                plates.forEach((p) => conds.push(like("truck_plate", p), like("trailer_plate", p)));
                const { data } = await client
                    .from("trips")
                    .select("id, trip_no, client, carrier_name, truck_plate, status")
                    .or(conds.join(","))
                    .limit(5);
                return (data || []).map((t) => ({
                    href: `trips.html?trip=${encodeURIComponent(t.id)}`,
                    title: `${t.truck_plate || t.trip_no || "Рейс"}${t.client ? ` · ${t.client}` : ""}`,
                    sub: [t.carrier_name, t.status].filter(Boolean).join(" · "),
                }));
            },
        },
        {
            // Машини, що зараз у Черзі на кордоні (тягач або причіп)
            key: "queue",
            title: "Черга (на кордоні зараз)",
            icon: "bx-time-five",
            async run(q, plates) {
                if (!plates.length) return [];
                const conds = [];
                plates.forEach((p) => conds.push(like("tractor", p), like("trailer", p)));
                const { data } = await client
                    .from("echerha_queue")
                    .select("tractor, trailer, checkpoint, entry_at, carrier, edrpou")
                    .or(conds.join(","))
                    .limit(5);
                return (data || []).map((t) => ({
                    href: `echerha.html?q=${encodeURIComponent(t.tractor || t.trailer || q)}`,
                    title: `🚛 ${[t.tractor, t.trailer].filter(Boolean).join(" / ")}`,
                    sub: [t.carrier, String(t.checkpoint || "").replace(/\.\s*Товари.*$/i, "").replace(/\s*\([^)]*\)/g, ""), t.entry_at && `в'їзд ${t.entry_at}`].filter(Boolean).join(" · "),
                }));
            },
        },
        {
            key: "carriers",
            title: "Перевізники",
            icon: "bx-group",
            async run(q, plates, digits) {
                const conds = [like("name", q), like("edrpou", q), like("contact_person_1", q)];
                if (digits.length >= 6) conds.push(like("phone_1", digits.slice(-7)), like("phone_2", digits.slice(-7)));
                const cols = "id, name, edrpou, city, trailer_type, phone_1";
                const [{ data }, byPlate] = await Promise.all([
                    client.from("carriers").select(cols).or(conds.join(",")).limit(6),
                    carriersByPlate(plates, cols),
                ]);
                const seen = new Set();
                return [...byPlate, ...(data || []).map((c) => ({ c }))]
                    .filter((x) => !seen.has(x.c.id) && seen.add(x.c.id))
                    .slice(0, 8)
                    .map(({ c, plate }) => ({
                        href: `carriers.html?open=${encodeURIComponent(c.id)}`,
                        carrier: c.id,
                        title: c.name || "Без назви",
                        sub: [plate && `🚛 возив ${plate}`, c.edrpou && `ЄДРПОУ ${c.edrpou}`, c.city, c.trailer_type, c.phone_1].filter(Boolean).join(" · "),
                    }));
            },
        },
        {
            key: "requests",
            title: "Запити",
            icon: "bx-list-ul",
            async run(q) {
                const { data } = await client
                    .from("requests")
                    .select("id, client, load_country, unload_country, desired_date, status, created_at")
                    .or([like("client", q), like("load_address", q), like("unload_address", q), like("cargo", q)].join(","))
                    .order("created_at", { ascending: false })
                    .limit(5);
                return (data || []).map((r) => ({
                    href: `requests.html?open=${encodeURIComponent(r.id)}`,
                    title: r.client || "Запит",
                    sub: [`${r.load_country || "—"} → ${r.unload_country || "—"}`, r.status, r.desired_date && String(r.desired_date).slice(0, 10).split("-").reverse().join(".")].filter(Boolean).join(" · "),
                }));
            },
        },
        {
            key: "leads",
            title: "Ліди",
            icon: "bx-briefcase-alt-2",
            async run(q, plates, digits) {
                const conds = [like("name", q), like("edrpou", q), like("contact_person", q)];
                if (digits.length >= 6) conds.push(like("phone", digits.slice(-7)));
                const { data } = await client
                    .from("leads")
                    .select("id, name, edrpou, city, contact_person, status")
                    .or(conds.join(","))
                    .limit(5);
                return (data || []).map((l) => ({
                    href: l.status === "Працюємо" ? `clients.html?open=${encodeURIComponent(l.id)}` : `leads.html?open=${encodeURIComponent(l.id)}`,
                    title: l.name || "Лід",
                    sub: [l.edrpou && `ЄДРПОУ ${l.edrpou}`, l.contact_person, l.city, l.status].filter(Boolean).join(" · "),
                }));
            },
        },
    ];

    /* ---------------- Розмітка ---------------- */

    function mount() {
        const bar = document.querySelector(".fura-topbar");
        if (!bar || bar.querySelector(".gs")) return false;
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
        const wrap = document.createElement("div");
        wrap.className = "gs";
        wrap.innerHTML = `
            <label class="gs-sr" for="gsInput">Пошук по всій CRM</label>
            <i class="bx bx-search gs-ico" aria-hidden="true"></i>
            <input id="gsInput" type="search" autocomplete="off" spellcheck="false"
                placeholder="Пошук: номер фури, перевізник, клієнт, № угоди…"
                role="combobox" aria-expanded="false" aria-controls="gsList" />
            <kbd class="gs-kbd">${isMac ? "⌘K" : "Ctrl K"}</kbd>
            <div class="gs-list" id="gsList" role="listbox" hidden></div>`;
        const date = bar.querySelector(".fura-date");
        bar.insertBefore(wrap, date || null);
        wire(wrap);
        return true;
    }

    function wire(wrap) {
        const input = wrap.querySelector("#gsInput");
        const list = wrap.querySelector("#gsList");
        let timer = null;
        let seq = 0;
        let items = [];
        let active = -1;

        function show(html) {
            list.innerHTML = html;
            list.hidden = !html;
            input.setAttribute("aria-expanded", html ? "true" : "false");
        }

        function highlight(i) {
            const links = list.querySelectorAll(".gs-item");
            links.forEach((a, k) => a.classList.toggle("on", k === i));
            active = i;
            links[i]?.scrollIntoView({ block: "nearest" });
        }

        async function search(raw) {
            const q = raw.trim().replace(/[,()%*]/g, " ").replace(/\s+/g, " ").slice(0, 60);
            if (q.length < 2) return show("");
            const my = ++seq;
            show(`<div class="gs-empty">Шукаю «${esc(q)}»…</div>`);
            const plates = plateVariants(q);
            const digits = q.replace(/\D/g, "");
            const results = await Promise.all(
                SECTIONS.map((s) => s.run(q, plates, digits).then((r) => ({ s, r })).catch(() => ({ s, r: [] }))),
            );
            if (my !== seq) return;
            items = [];
            const html = results
                .filter(({ r }) => r.length)
                .map(({ s, r }) => {
                    const rows = r
                        .map((it) => {
                            items.push(it);
                            return `<a class="gs-item" role="option" href="${esc(it.href)}"${it.carrier ? ` data-carrier-card="${esc(it.carrier)}"` : ""}>
                                <i class="bx ${s.icon}" aria-hidden="true"></i>
                                <span><b>${esc(it.title)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span>
                            </a>`;
                        })
                        .join("");
                    return `<div class="gs-group">${esc(s.title)}</div>${rows}`;
                })
                .join("");
            active = -1;
            show(html || `<div class="gs-empty">Нічого не знайдено за «${esc(q)}». Спробуйте частину назви, ЄДРПОУ або номер авто.</div>`);
        }

        input.addEventListener("input", () => {
            clearTimeout(timer);
            timer = setTimeout(() => search(input.value), 250);
        });
        input.addEventListener("focus", () => {
            if (list.innerHTML && input.value.trim().length >= 2) show(list.innerHTML);
        });
        input.addEventListener("keydown", (e) => {
            const n = list.querySelectorAll(".gs-item").length;
            if (e.key === "ArrowDown" && n) {
                e.preventDefault();
                highlight((active + 1) % n);
            } else if (e.key === "ArrowUp" && n) {
                e.preventDefault();
                highlight((active - 1 + n) % n);
            } else if (e.key === "Enter") {
                const target = items[active >= 0 ? active : 0];
                if (target) {
                    e.preventDefault();
                    if (target.carrier && window.furaCarrierPopup) {
                        show("");
                        input.blur();
                        window.furaCarrierPopup.open(target.carrier);
                    } else window.location.href = target.href;
                }
            } else if (e.key === "Escape") {
                show("");
                input.blur();
            }
        });
        document.addEventListener("click", (e) => {
            if (!wrap.contains(e.target)) show("");
        });
        document.addEventListener("keydown", (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                input.focus();
                input.select();
            }
        });
    }

    // Верхня смуга з'являється з shell.js — чекаємо, якщо її ще немає
    if (!mount()) {
        let tries = 0;
        const t = setInterval(() => {
            if (mount() || ++tries > 40) clearInterval(t);
        }, 100);
    }
})();
