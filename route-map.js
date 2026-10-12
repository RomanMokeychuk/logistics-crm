/* ================================================================= *
 * FURA — КАРТА МАРШРУТУ В КАРТЦІ ЗАПИТУ                              *
 * Маршрут для фури (TomTom), кілометри, час, кордон, затори          *
 * Дані йдуть через функцію Supabase "fura-geo" (ключі сховані)       *
 * ================================================================= */

(function () {
    const esc = (s) =>
        String(s ?? "").replace(
            /[&<>"']/g,
            (c) =>
                ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#039;",
                })[c],
        );

    /* ---------------- Стилі ---------------- */
    const style = document.createElement("style");
    style.textContent = `
        .route-section { margin-bottom: 16px; }
        .route-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
        .route-head .card-section-title { margin: 0; }
        .route-via { margin-left: auto; max-width: 280px; padding: 6px 10px; border: 1px solid #cbd5e1;
            border-radius: 8px; font-size: 13px; background: #fff; color: #0f172a; }
        .route-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; min-height: 30px; align-items: center; }
        .route-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 999px;
            background: #f1f5f9; color: #0f172a; font-size: 13px; font-weight: 600; }
        .route-chip i { font-size: 16px; color: #2563eb; }
        .route-chip.warn { background: #fef3c7; color: #92400e; } .route-chip.warn i { color: #d97706; }
        .route-chip.bad { background: #fee2e2; color: #b91c1c; } .route-chip.bad i { color: #dc2626; }
        .route-chip.ok { background: #dcfce7; color: #166534; } .route-chip.ok i { color: #16a34a; }
        .route-note { font-size: 13px; color: #64748b; }
        .route-map { height: 360px; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; background: #f8fafc; }
        .route-details { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 12px; }
        @media (max-width: 800px) { .route-details { grid-template-columns: 1fr; } .route-map { height: 280px; } }
        .route-plan { grid-column: 1 / -1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; }
        .route-plan-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
        .route-plan-head .route-list-title { margin: 0; }
        .route-plan-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px 18px; }
        .route-plan-row { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; color: #475569; padding: 4px 0; border-bottom: 1px dashed #e2e8f0; }
        .route-plan-row b { color: #0f172a; white-space: nowrap; }
        .route-delivery-total { margin-top: 10px; padding: 10px 12px; border-radius: 10px; background: #dcfce7; color: #166534;
            font-size: 15px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .route-delivery-total i { font-size: 20px; }
        .route-delivery-total b { font-size: 17px; }
        .route-delivery-total span { font-size: 12px; color: #15803d; }
        .route-plan-note { margin-top: 8px; font-size: 12px; color: #64748b; line-height: 1.45; }
        .route-list-title { font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .03em; margin-bottom: 6px; }
        .route-li { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #334155; }
        .route-li:last-child { border-bottom: none; }
        .route-li b { color: #0f172a; }
        .route-km { flex-shrink: 0; min-width: 58px; color: #64748b; font-variant-numeric: tabular-nums; }
        .route-links { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        .route-link { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border: 1px solid #cbd5e1;
            border-radius: 8px; color: #1d4ed8; font-size: 13px; font-weight: 600; text-decoration: none; background: #fff;
            cursor: pointer; font-family: inherit; }
        .route-link:hover { border-color: #2563eb; background: #eff6ff; }
        .route-pin { width: 26px; height: 26px; border-radius: 50%; color: #fff; font: 700 13px/26px sans-serif;
            text-align: center; border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,.35); }
        .route-border-pin { width: 28px; height: 28px; border-radius: 8px; background: #0f172a; color: #fff;
            display: flex; align-items: center; justify-content: center; font-size: 17px; border: 2px solid #fff;
            box-shadow: 0 2px 6px rgba(0,0,0,.35); }
    `;
    document.head.appendChild(style);

    /* ---------------- MapLibre (карта) підвантажуємо тільки коли треба ---------------- */
    const MAPLIBRE = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl";
    let mapLibReady = null;
    function loadMapLib() {
        if (window.maplibregl) return Promise.resolve();
        if (mapLibReady) return mapLibReady;
        mapLibReady = new Promise((resolve, reject) => {
            const css = document.createElement("link");
            css.rel = "stylesheet";
            css.href = MAPLIBRE + ".css";
            document.head.appendChild(css);
            const js = document.createElement("script");
            js.src = MAPLIBRE + ".js";
            js.onload = resolve;
            js.onerror = reject;
            document.head.appendChild(js);
        });
        return mapLibReady;
    }

    // Підписи на карті українською (де немає — латиницею)
    function localizeMap(map, lang) {
        const name = [
            "coalesce",
            ["get", `name:${lang}`],
            ["get", "name:latin"],
            ["get", "name"],
        ];
        for (const layer of map.getStyle().layers || []) {
            const tf = layer.layout?.["text-field"];
            if (
                layer.type === "symbol" &&
                tf &&
                JSON.stringify(tf).includes("name")
            ) {
                try {
                    map.setLayoutProperty(layer.id, "text-field", name);
                } catch (e) {
                    /* шар без підписів — пропускаємо */
                }
            }
        }
    }

    function mapStyle(mapKey) {
        if (mapKey)
            return `https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=${encodeURIComponent(mapKey)}`;
        // Запасний варіант: звичайна OpenStreetMap (підписи мовою країни)
        return {
            version: 8,
            sources: {
                osm: {
                    type: "raster",
                    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                    tileSize: 256,
                    attribution:
                        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                },
            },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
        };
    }

    /* ---------------- Допоміжні ---------------- */
    function fmtDur(sec) {
        const m = Math.round((sec || 0) / 60);
        const h = Math.floor(m / 60);
        const mm = m % 60;
        if (!h) return `${mm} хв`;
        return mm ? `${h} год ${mm} хв` : `${h} год`;
    }
    const fmtKm = (km) => `${Number(km || 0).toLocaleString("uk-UA")} км`;

    /* ---------------- Норми праці водіїв (Регламент ЄС 561/2006 / ЄУТР-AETR) ----------------
     * 1 водій: перерва 45 хв після 4,5 год керування; до 9 год на добу (двічі на тиждень — 10 год);
     *          щоденний відпочинок 11 год (тричі між тижневими — 9 год); до 56 год на тиждень,
     *          до 90 год за 2 тижні; тижневий відпочинок 45 год після 6 робочих діб.
     * 2 водії: машина їде до 18 год (двічі на тиждень — 20 год), потім 9 год відпочинку
     *          (у межах 30 год); перерви не потрібні — другий водій відпочиває в дорозі.
     * Усе в хвилинах. Черга на кордоні й митниця не враховуються. */
    function driverPlan(driveMin, crew) {
        const two = crew === 2;
        const DAY = two ? 1080 : 540,
            DAY_EXT = two ? 1200 : 600;
        const WEEK = two ? 112 * 60 : 56 * 60,
            FORTNIGHT = two ? 180 * 60 : 90 * 60;
        let rem = Math.round(driveMin),
            total = 0,
            breaks = 0,
            daily = 0,
            weekly = 0;
        let week = 0,
            prevWeek = 0,
            ext = 2,
            reduced = 3,
            days = 0,
            shifts = 0;
        const weeklyRest = () => {
            weekly += 2700;
            total += 2700;
            prevWeek = week;
            week = 0;
            ext = 2;
            reduced = 3;
            days = 0;
        };
        let guard = 0;
        while (rem > 0 && guard++ < 200) {
            const cap = Math.min(WEEK, FORTNIGHT - prevWeek) - week;
            if (cap <= 0) {
                weeklyRest();
                continue;
            }
            const lim = rem > DAY && ext > 0 ? DAY_EXT : DAY;
            const d = Math.min(rem, lim, cap);
            if (d > DAY) ext--;
            const b = two ? 0 : Math.floor((d - 1) / 270) * 45;
            total += d + b;
            breaks += b;
            rem -= d;
            week += d;
            days++;
            shifts++;
            if (rem <= 0) break;
            if (days >= 6 || Math.min(WEEK, FORTNIGHT - prevWeek) - week <= 0)
                weeklyRest();
            else {
                const r = two ? 540 : reduced > 0 ? 540 : 660;
                if (!two && reduced > 0) reduced--;
                daily += r;
                total += r;
            }
        }
        return {
            total,
            drive: Math.round(driveMin),
            breaks,
            daily,
            weekly,
            shifts,
        };
    }

    const plural = (n, one, few, many) => {
        const m10 = n % 10,
            m100 = n % 100;
        if (m10 === 1 && m100 !== 11) return one;
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
        return many;
    };
    function fmtDays(min) {
        const d = Math.floor(min / 1440);
        const h = Math.round((min % 1440) / 60);
        if (!d) return `${h} год`;
        return `${d} ${plural(d, "доба", "доби", "діб")}${h ? ` ${h} год` : ""}`;
    }

    /* ---------------- Термін доставки (орієнтовно) ----------------
     * Рух за нормами водія + завантаження 48 год + черга на кордоні + розвантаження/розмитнення 48 год.
     * Кордони всередині ЄС — без черги. */
    const EU = new Set([
        "Польща",
        "Німеччина",
        "Литва",
        "Латвія",
        "Естонія",
        "Чехія",
        "Словаччина",
        "Угорщина",
        "Румунія",
        "Болгарія",
        "Австрія",
        "Італія",
        "Іспанія",
        "Франція",
        "Бельгія",
        "Нідерланди",
        "Данія",
        "Фінляндія",
        "Словенія",
        "Люксембург",
        "Хорватія",
        "Швеція",
        "Греція",
        "Португалія",
    ]);
    const LOADING = 48 * 60; // завантаження — 48 год (практика компанії)
    const UNLOADING = 48 * 60; // розвантаження + розмитнення — 48 год (практика компанії)
    function deliveryEstimate(transitMin, borders) {
        let bMin = 0,
            bMax = 0,
            outsideEU = false;
        const items = [];
        for (const b of borders) {
            if (EU.has(b.from) && EU.has(b.to)) continue; // всередині ЄС
            outsideEU = true;
            const ua = b.from === "Україна" || b.to === "Україна";
            const [lo, hi] = ua ? [360, 2160] : [180, 720];
            bMin += lo;
            bMax += hi;
            items.push({ name: b.name || `${b.from} → ${b.to}`, lo, hi });
        }
        const min = transitMin + LOADING + UNLOADING + bMin;
        const max = transitMin + LOADING + UNLOADING + bMax;
        const dMin = Math.max(1, Math.ceil(min / 1440));
        const dMax = Math.max(dMin, Math.ceil(max / 1440));
        return { min, max, dMin, dMax, items, outsideEU };
    }
    const daysRange = (a, b) =>
        a === b
            ? `${a} ${plural(a, "день", "дні", "днів")}`
            : `${a}–${b} ${plural(b, "день", "дні", "днів")}`;

    const crossingsList = () =>
        typeof BORDER_CROSSINGS !== "undefined" ? BORDER_CROSSINGS : [];

    const cache = new Map(); // ключ → дані маршруту (на час роботи сторінки)

    async function fetchRoute(r, via) {
        const code = window.furaCountryCode || (() => "");
        const body = {
            action: "route",
            from: r.load_address,
            to: r.unload_address,
            fromCountry: code(r.load_country),
            toCountry: code(r.unload_country),
            via,
        };
        const key = JSON.stringify(body);
        const hit = cache.get(key);
        if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.data;
        const { data, error } = await sbClient.functions.invoke("fura-geo", {
            body,
        });
        if (error) throw error;
        if (!data?.error) cache.set(key, { t: Date.now(), data });
        return data;
    }

    const ERRORS = {
        no_address:
            "Вкажіть місто завантаження і розвантаження — тоді з'явиться маршрут.",
        from_not_found:
            "Не вдалося знайти місце завантаження. Перевірте адресу (краще обрати з підказок).",
        to_not_found:
            "Не вдалося знайти місце розвантаження. Перевірте адресу (краще обрати з підказок).",
        no_route:
            "Маршрут для фури не знайдено. Спробуйте інший пункт пропуску або уточніть адресу.",
    };

    /* ---------------- Малюємо ---------------- */

    function render(box, r) {
        if (!box) return;
        const hasAddr =
            (r.load_address || "").trim() && (r.unload_address || "").trim();
        const known = crossingsList();
        const initialVia = known.includes(r.border_crossing)
            ? r.border_crossing
            : "";

        box.innerHTML = `
            <div class="card-section route-section">
                <div class="route-head">
                    <div class="card-section-title"><i class='bx bx-map-alt'></i> Карта маршруту</div>
                    ${
                        hasAddr && known.length
                            ? `<select class="route-via" title="Через який пункт пропуску їхати">
                                <option value="">Пункт пропуску: автоматично</option>
                                ${known.map((c) => `<option value="${esc(c)}"${c === initialVia ? " selected" : ""}>${esc(c)}</option>`).join("")}
                               </select>`
                            : ""
                    }
                </div>
                <div class="route-stats"><span class="route-note">${hasAddr ? "Будую маршрут для фури…" : esc(ERRORS.no_address)}</span></div>
                ${hasAddr ? `<div class="route-map"></div><div class="route-details"></div><div class="route-links"></div>` : ""}
            </div>`;
        if (!hasAddr) return;

        const sel = box.querySelector(".route-via");
        sel?.addEventListener("change", () => draw(box, r, sel.value));
        draw(box, r, initialVia);
    }

    let mapInstance = null;

    async function draw(box, r, via) {
        const stats = box.querySelector(".route-stats");
        const details = box.querySelector(".route-details");
        const links = box.querySelector(".route-links");
        const mapEl = box.querySelector(".route-map");
        stats.innerHTML = `<span class="route-note">Будую маршрут для фури…</span>`;
        mapEl.style.display = "none";
        details.innerHTML = "";
        links.innerHTML = "";

        let data;
        try {
            [data] = await Promise.all([fetchRoute(r, via), loadMapLib()]);
        } catch (e) {
            console.warn("route:", e);
            stats.innerHTML = `<span class="route-note">Маршрут зараз недоступний. Спробуйте пізніше.<br><small>Деталі: ${esc(e?.message || e)}</small></span>`;
            return;
        }
        if (!document.body.contains(box)) return; // картку вже закрили
        if (data?.error) {
            mapEl.style.display = "none";
            stats.innerHTML = `<span class="route-note">${esc(ERRORS[data.error] || "Не вдалося побудувати маршрут.")}${
                data.detail
                    ? `<br><small>Деталі: ${esc(data.detail)}</small>`
                    : ""
            }</span>`;
            return;
        }
        mapEl.style.display = "";

        /* --- Цифри --- */
        const delayMin = Math.round((data.delaySec || 0) / 60);
        const uaBorder = data.borders.find((b) => b.ukraine);
        stats.innerHTML = [
            `<span class="route-chip ok route-delivery-chip" title="Орієнтовно: завантаження 48 год + рух за нормами водія + черга на кордоні + розвантаження/розмитнення 48 год"><i class='bx bx-package'></i><span class="route-delivery"></span></span>`,
            `<span class="route-chip" title="Чистий час за кермом з урахуванням поточного трафіку"><i class='bx bx-time-five'></i>${fmtDur(data.timeSec)} за кермом</span>`,
            `<span class="route-chip route-days-chip" title="З перервами і відпочинком за нормами ЄС/ЄУТР. Без черги на кордоні."><i class='bx bx-trip'></i><span class="route-days"></span></span>`,
            delayMin >= 1
                ? `<span class="route-chip ${delayMin >= 30 ? "bad" : "warn"}"><i class='bx bx-traffic-cone'></i>Затори: +${fmtDur(data.delaySec)}</span>`
                : `<span class="route-chip ok"><i class='bx bx-check-circle'></i>Без заторів зараз</span>`,
            uaBorder
                ? `<span class="route-chip"><i class='bx bx-shield-quarter'></i>${esc(uaBorder.name || "кордон")}</span>`
                : "",
            data.warning
                ? `<span class="route-chip bad"><i class='bx bx-error'></i>${esc(data.warning)}</span>`
                : "",
        ].join("");

        /* --- Списки: кордони і затори --- */
        const bordersHtml = data.borders.length
            ? data.borders
                  .map(
                      (
                          b,
                      ) => `<div class="route-li"><span class="route-km">${fmtKm(b.km)}</span>
                        <span><b>${esc(b.name || "Кордон")}</b><br>${esc(b.from)} → ${esc(b.to)}</span></div>`,
                  )
                  .join("")
            : `<div class="route-li">Маршрут без перетину кордонів</div>`;

        const jams = [...data.jams]
            .sort((a, b) => b.delay - a.delay)
            .slice(0, 6);
        const jamName = (j) =>
            j.level >= 4 || j.kind === "ROAD_CLOSURE"
                ? "Перекриття"
                : j.kind === "ROAD_WORK"
                  ? "Ремонт дороги"
                  : j.level >= 3
                    ? "Сильний затор"
                    : "Затор";
        const jamsHtml = jams.length
            ? jams
                  .map(
                      (
                          j,
                      ) => `<div class="route-li"><span class="route-km">${fmtKm(j.km)}</span>
                        <span><b>${jamName(j)}</b>${j.delay ? ` · +${fmtDur(j.delay)}` : ""}${j.speed ? ` · ${j.speed} км/год` : ""}</span></div>`,
                  )
                  .join("")
            : `<div class="route-li">Заторів на маршруті зараз немає</div>`;

        details.innerHTML = `
            <div class="route-plan"></div>
            <div><div class="route-list-title">Кордони</div>${bordersHtml}</div>
            <div><div class="route-list-title">Затори і ремонти зараз</div>${jamsHtml}</div>`;

        /* --- Час у дорозі за нормами праці водіїв --- */
        const planBox = details.querySelector(".route-plan");
        const updatePlan = () => {
            const p = driverPlan(data.timeSec / 60, 1); // завжди 1 водій (2 водії — рідкість)
            const dl = deliveryEstimate(p.total, data.borders);
            const fmtRange = (lo, hi) =>
                `${fmtDur(lo * 60)} – ${fmtDur(hi * 60)}`;
            stats.querySelector(".route-delivery").textContent =
                `Доставка ≈ ${daysRange(dl.dMin, dl.dMax)}`;
            const arrive = new Date(Date.now() + p.total * 60000);
            const arriveTxt = arrive.toLocaleString("uk-UA", {
                weekday: "short",
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
            });
            stats.querySelector(".route-days").textContent =
                `≈ ${fmtDays(p.total)} в дорозі = ${fmtKm(data.km)}`;
            const row = (label, val) =>
                `<div class="route-plan-row"><span>${label}</span><b>${val}</b></div>`;
            planBox.innerHTML = `
                <div class="route-plan-head">
                    <div class="route-list-title">Час у дорозі за нормами праці водія (ЄС 561/2006 / ЄУТР)</div>
                </div>
                <div class="route-plan-grid">
                    ${row("За кермом", fmtDur(p.drive * 60))}
                    ${row("Перерви по 45 хв", p.breaks ? fmtDur(p.breaks * 60) : "—")}
                    ${row("Щоденний відпочинок", p.daily ? fmtDur(p.daily * 60) : "—")}
                    ${p.weekly ? row("Тижневий відпочинок", fmtDur(p.weekly * 60)) : ""}
                    ${row("Разом у дорозі", `≈ ${fmtDays(p.total)}`)}
                    ${row("Прибуття, якщо виїхати зараз", arriveTxt)}
                </div>
                <div class="route-plan-head" style="margin-top:12px">
                    <div class="route-list-title">Термін доставки вантажу (орієнтовно)</div>
                </div>
                <div class="route-plan-grid">
                    ${row("Рух з відпочинком водія", `≈ ${fmtDays(p.total)}`)}
                    ${row("Завантаження", fmtDur(LOADING * 60))}
                    ${dl.items.map((it) => row(`Черга: ${esc(it.name)}`, fmtRange(it.lo, it.hi))).join("")}
                    ${row(dl.outsideEU ? "Розвантаження + розмитнення" : "Розвантаження", fmtDur(UNLOADING * 60))}
                </div>
                <div class="route-delivery-total">
                    <i class='bx bx-package'></i> Термін доставки: <b>${daysRange(dl.dMin, dl.dMax)}</b>
                    <span>(${fmtDays(dl.min)} – ${fmtDays(dl.max)})</span>
                </div>
                <div class="route-plan-note">
                    Перерва 45 хв кожні 4,5 год; до 9 год за кермом на добу (двічі на тиждень — 10);
                    відпочинок 11 год (тричі на тиждень — 9); до 56 год на тиждень; тижневий відпочинок 45 год.
                    Черга на кордоні з Україною взята 6–36 год, на інших кордонах поза ЄС — 3–12 год; кордони всередині ЄС — без черги.
                    Актуальну чергу перевіряйте в єЧерзі.
                </div>`;
        };
        updatePlan();

        /* --- Посилання --- */
        const ll = (p) => `${p.lat},${p.lon}`;
        const gm = new URL("https://www.google.com/maps/dir/");
        gm.searchParams.set("api", "1");
        gm.searchParams.set("origin", ll(data.from));
        gm.searchParams.set("destination", ll(data.to));
        if (uaBorder) gm.searchParams.set("waypoints", ll(uaBorder));
        gm.searchParams.set("travelmode", "driving");
        links.innerHTML = `
            <button type="button" class="route-link route-full-btn"><i class='bx bx-fullscreen'></i> Карта на весь екран</button>
            <a class="route-link" href="${esc(gm.toString())}" target="_blank" rel="noopener"><i class='bx bx-map'></i> Відкрити в Google Maps</a>
            ${uaBorder ? `<a class="route-link" href="https://echerha.gov.ua/" target="_blank" rel="noopener"><i class='bx bx-time'></i> Черга на кордоні (єЧерга)</a>` : ""}`;

        /* --- Карта --- */
        if (mapInstance) {
            mapInstance.remove();
            mapInstance = null;
        }
        const gl = window.maplibregl;
        const coords = data.line.map(([lat, lon]) => [lon, lat]);
        const bounds = coords.reduce(
            (b, c) => b.extend(c),
            new gl.LngLatBounds(coords[0], coords[0]),
        );

        const map = new gl.Map({
            container: mapEl,
            style: mapStyle(data.mapKey),
            bounds,
            fitBoundsOptions: { padding: 40 },
            scrollZoom: false,
            attributionControl: {
                compact: true,
                customAttribution: "Маршрут © TomTom",
            },
        });
        mapInstance = map;
        map.addControl(
            new gl.NavigationControl({ showCompass: false }),
            "top-right",
        );
        map.addControl(new gl.FullscreenControl(), "top-right");
        map.on("styleimagemissing", () => {}); // тихо пропускаємо відсутні значки стилю

        map.on("load", () => {
            if (data.mapKey) localizeMap(map, "uk");

            map.addSource("route", {
                type: "geojson",
                data: {
                    type: "Feature",
                    geometry: { type: "LineString", coordinates: coords },
                },
            });
            map.addLayer({
                id: "route-casing",
                type: "line",
                source: "route",
                layout: { "line-join": "round", "line-cap": "round" },
                paint: { "line-color": "#ffffff", "line-width": 9 },
            });
            map.addLayer({
                id: "route-line",
                type: "line",
                source: "route",
                layout: { "line-join": "round", "line-cap": "round" },
                paint: { "line-color": "#2563eb", "line-width": 5 },
            });

            const jamFeatures = data.jams
                .filter((j) => j.line.length > 1)
                .map((j) => ({
                    type: "Feature",
                    properties: {
                        color:
                            j.level >= 4
                                ? "#7f1d1d"
                                : j.level >= 3
                                  ? "#dc2626"
                                  : j.level >= 2
                                    ? "#f97316"
                                    : "#eab308",
                        title: `${jamName(j)}${j.delay ? " · +" + fmtDur(j.delay) : ""}${j.speed ? " · " + j.speed + " км/год" : ""}`,
                    },
                    geometry: {
                        type: "LineString",
                        coordinates: j.line.map(([lat, lon]) => [lon, lat]),
                    },
                }));
            map.addSource("jams", {
                type: "geojson",
                data: { type: "FeatureCollection", features: jamFeatures },
            });
            map.addLayer({
                id: "jams-line",
                type: "line",
                source: "jams",
                layout: { "line-join": "round", "line-cap": "round" },
                paint: { "line-color": ["get", "color"], "line-width": 7 },
            });

            const popup = new gl.Popup({
                closeButton: false,
                closeOnClick: false,
            });
            map.on("mousemove", "jams-line", (e) => {
                map.getCanvas().style.cursor = "pointer";
                popup
                    .setLngLat(e.lngLat)
                    .setText(e.features[0].properties.title)
                    .addTo(map);
            });
            map.on("mouseleave", "jams-line", () => {
                map.getCanvas().style.cursor = "";
                popup.remove();
            });
        });

        const marker = (lat, lon, html, title) => {
            const el = document.createElement("div");
            el.innerHTML = html;
            el.title = title;
            new gl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
        };
        marker(
            data.from.lat,
            data.from.lon,
            `<div class="route-pin" style="background:#16a34a">A</div>`,
            "Завантаження: " + data.from.label,
        );
        marker(
            data.to.lat,
            data.to.lon,
            `<div class="route-pin" style="background:#dc2626">B</div>`,
            "Розвантаження: " + data.to.label,
        );
        for (const b of data.borders) {
            marker(
                b.lat,
                b.lon,
                `<div class="route-border-pin"><i class='bx bx-shield-quarter'></i></div>`,
                `${b.name || "Кордон"}: ${b.from} → ${b.to}`,
            );
        }

        // Велика карта: на весь екран (Esc — назад). У великій карті колесо мишки масштабує.
        links
            .querySelector(".route-full-btn")
            ?.addEventListener("click", () => {
                const el = map.getContainer();
                (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
            });
        const onFs = () => {
            const full = document.fullscreenElement === map.getContainer();
            if (full) map.scrollZoom.enable();
            else map.scrollZoom.disable();
            setTimeout(() => {
                map.resize();
                map.fitBounds(bounds, { padding: full ? 80 : 40, duration: 0 });
            }, 150);
        };
        document.addEventListener("fullscreenchange", onFs);
        map.on("remove", () =>
            document.removeEventListener("fullscreenchange", onFs),
        );

        // Картка відкривається з анімацією — підганяємо розмір карти
        setTimeout(() => {
            map.resize();
            map.fitBounds(bounds, { padding: 40, duration: 0 });
        }, 250);
    }

    window.furaRouteMap = { render };
})();
