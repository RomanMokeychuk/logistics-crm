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
        .route-list-title { font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .03em; margin-bottom: 6px; }
        .route-li { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #334155; }
        .route-li:last-child { border-bottom: none; }
        .route-li b { color: #0f172a; }
        .route-km { flex-shrink: 0; min-width: 58px; color: #64748b; font-variant-numeric: tabular-nums; }
        .route-links { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        .route-link { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border: 1px solid #cbd5e1;
            border-radius: 8px; color: #1d4ed8; font-size: 13px; font-weight: 600; text-decoration: none; background: #fff; }
        .route-link:hover { border-color: #2563eb; background: #eff6ff; }
        .route-pin { width: 26px; height: 26px; border-radius: 50%; color: #fff; font: 700 13px/26px sans-serif;
            text-align: center; border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,.35); }
        .route-border-pin { width: 28px; height: 28px; border-radius: 8px; background: #0f172a; color: #fff;
            display: flex; align-items: center; justify-content: center; font-size: 17px; border: 2px solid #fff;
            box-shadow: 0 2px 6px rgba(0,0,0,.35); }
    `;
    document.head.appendChild(style);

    /* ---------------- Leaflet (карта) підвантажуємо тільки коли треба ---------------- */
    let leafletReady = null;
    function loadLeaflet() {
        if (window.L) return Promise.resolve();
        if (leafletReady) return leafletReady;
        leafletReady = new Promise((resolve, reject) => {
            const css = document.createElement("link");
            css.rel = "stylesheet";
            css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
            document.head.appendChild(css);
            const js = document.createElement("script");
            js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
            js.onload = resolve;
            js.onerror = reject;
            document.head.appendChild(js);
        });
        return leafletReady;
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
        details.innerHTML = "";
        links.innerHTML = "";

        let data;
        try {
            [data] = await Promise.all([fetchRoute(r, via), loadLeaflet()]);
        } catch (e) {
            console.warn("route:", e);
            stats.innerHTML = `<span class="route-note">Маршрут зараз недоступний. Спробуйте пізніше.</span>`;
            return;
        }
        if (!document.body.contains(box)) return; // картку вже закрили
        if (data?.error) {
            stats.innerHTML = `<span class="route-note">${esc(ERRORS[data.error] || "Не вдалося побудувати маршрут.")}</span>`;
            return;
        }

        /* --- Цифри --- */
        const driveH = data.timeSec / 3600;
        const days = Math.max(1, Math.ceil(driveH / 9)); // 9 год керування на добу
        const delayMin = Math.round((data.delaySec || 0) / 60);
        const uaBorder = data.borders.find((b) => b.ukraine);
        stats.innerHTML = [
            `<span class="route-chip"><i class='bx bx-trip'></i>${fmtKm(data.km)}</span>`,
            `<span class="route-chip" title="Чистий час за кермом з урахуванням поточного трафіку"><i class='bx bx-time-five'></i>${fmtDur(data.timeSec)} за кермом</span>`,
            `<span class="route-chip" title="Якщо водій їде до 9 год на добу (норми відпочинку). Без черги на кордоні."><i class='bx bx-calendar'></i>≈ ${days} ${days === 1 ? "доба" : days < 5 ? "доби" : "діб"} в дорозі</span>`,
            delayMin >= 1
                ? `<span class="route-chip ${delayMin >= 30 ? "bad" : "warn"}"><i class='bx bx-traffic-cone'></i>Затори: +${fmtDur(data.delaySec)}</span>`
                : `<span class="route-chip ok"><i class='bx bx-check-circle'></i>Без заторів зараз</span>`,
            uaBorder
                ? `<span class="route-chip"><i class='bx bx-shield-quarter'></i>${esc(uaBorder.name || "кордон")}</span>`
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
            <div><div class="route-list-title">Кордони</div>${bordersHtml}</div>
            <div><div class="route-list-title">Затори і ремонти зараз</div>${jamsHtml}</div>`;

        /* --- Посилання --- */
        const ll = (p) => `${p.lat},${p.lon}`;
        const gm = new URL("https://www.google.com/maps/dir/");
        gm.searchParams.set("api", "1");
        gm.searchParams.set("origin", ll(data.from));
        gm.searchParams.set("destination", ll(data.to));
        if (uaBorder) gm.searchParams.set("waypoints", ll(uaBorder));
        gm.searchParams.set("travelmode", "driving");
        links.innerHTML = `
            <a class="route-link" href="${esc(gm.toString())}" target="_blank" rel="noopener"><i class='bx bx-map'></i> Відкрити в Google Maps</a>
            ${uaBorder ? `<a class="route-link" href="https://echerha.gov.ua/" target="_blank" rel="noopener"><i class='bx bx-time'></i> Черга на кордоні (єЧерга)</a>` : ""}`;

        /* --- Карта --- */
        if (mapInstance) {
            mapInstance.remove();
            mapInstance = null;
        }
        const L = window.L;
        const map = L.map(mapEl, {
            scrollWheelZoom: false,
            attributionControl: true,
        });
        mapInstance = map;
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 18,
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · маршрут © TomTom',
        }).addTo(map);

        const line = L.polyline(data.line, {
            color: "#2563eb",
            weight: 5,
            opacity: 0.85,
        }).addTo(map);
        for (const j of data.jams) {
            const color =
                j.level >= 4
                    ? "#7f1d1d"
                    : j.level >= 3
                      ? "#dc2626"
                      : j.level >= 2
                        ? "#f97316"
                        : "#eab308";
            L.polyline(j.line, { color, weight: 7, opacity: 0.95 })
                .addTo(map)
                .bindTooltip(
                    `${jamName(j)}${j.delay ? " · +" + fmtDur(j.delay) : ""}`,
                );
        }

        const pin = (txt, bg) =>
            L.divIcon({
                className: "",
                html: `<div class="route-pin" style="background:${bg}">${txt}</div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13],
            });
        L.marker([data.from.lat, data.from.lon], { icon: pin("A", "#16a34a") })
            .addTo(map)
            .bindTooltip("Завантаження: " + esc(data.from.label));
        L.marker([data.to.lat, data.to.lon], { icon: pin("B", "#dc2626") })
            .addTo(map)
            .bindTooltip("Розвантаження: " + esc(data.to.label));
        for (const b of data.borders) {
            L.marker([b.lat, b.lon], {
                icon: L.divIcon({
                    className: "",
                    html: `<div class="route-border-pin"><i class='bx bx-shield-quarter'></i></div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14],
                }),
            })
                .addTo(map)
                .bindTooltip(
                    `${esc(b.name || "Кордон")}<br>${esc(b.from)} → ${esc(b.to)}`,
                );
        }

        map.fitBounds(line.getBounds(), { padding: [30, 30] });
        setTimeout(() => {
            map.invalidateSize();
            map.fitBounds(line.getBounds(), { padding: [30, 30] });
        }, 250);
    }

    window.furaRouteMap = { render };
})();
