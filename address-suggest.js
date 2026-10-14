/* ================================================================= *
 * FURA — ПІДКАЗКИ АДРЕС (місто, село, поштовий індекс)               *
 * Працює через функцію Supabase "fura-geo" (ключ Geoapify схований)   *
 * Підключається на сторінках: Запити, Ліди, Перевізники              *
 * ================================================================= */

(function () {
    // Назва країни в CRM → код країни
    const COUNTRY_CODES = {
        "УКРАЇНА": "ua", "ПОЛЬША": "pl", "НІМЕЧЧИНА": "de", "ЛИТВА": "lt",
        "ЛАТВІЯ": "lv", "ЕСТОНІЯ": "ee", "ЧЕХІЯ": "cz", "СЛОВАЧЧИНА": "sk",
        "УГОРЩИНА": "hu", "РУМУНІЯ": "ro", "МОЛДОВА": "md", "БОЛГАРІЯ": "bg",
        "АВСТРІЯ": "at", "ІТАЛІЯ": "it", "ІСПАНІЯ": "es", "ФРАНЦІЯ": "fr",
        "БЕЛЬГІЯ": "be", "НІДЕРЛАНДИ": "nl", "ДАНІЯ": "dk", "ФІНЛЯНДІЯ": "fi",
        "ВЕЛИКОБРИТАНІЯ": "gb", "ТУРЕЧЧИНА": "tr", "ГРУЗІЯ": "ge",
        "ВІРМЕНІЯ": "am", "АЗЕРБАЙДЖАН": "az", "СЛОВЕНІЯ": "si",
    };
    const CODE_TO_COUNTRY = Object.fromEntries(
        Object.entries(COUNTRY_CODES).map(([k, v]) => [v, k]),
    );

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);

    const shortState = (s) =>
        String(s || "")
            .replace(/\s*область$/i, " обл.")
            .replace(/^Автономна Республіка Крим$/i, "АР Крим");

    function settlementOf(r) {
        return r.city || (["city", "postcode", "suburb", "district", "county"].includes(r.type) ? r.name : "") || r.name || "";
    }

    function streetOf(r) {
        return r.street ? `${r.street}${r.housenumber ? " " + r.housenumber : ""}` : "";
    }

    /* ---------------- Стилі (вбудовані, щоб не плодити файли) ---------------- */

    const style = document.createElement("style");
    style.textContent = `
        .addr-suggest {
            position: fixed; z-index: 5000; max-height: 300px; overflow-y: auto;
            background: #fff; border: 1px solid #cbd5e1; border-radius: 10px;
            box-shadow: 0 10px 28px rgba(15,23,42,.16); padding: 4px; display: none;
        }
        .addr-suggest.open { display: block; }
        .addr-item {
            display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px;
            border-radius: 7px; cursor: pointer; line-height: 1.3;
        }
        .addr-item i { font-size: 18px; color: #2563eb; margin-top: 1px; flex-shrink: 0; }
        .addr-item.active, .addr-item:hover { background: #eff6ff; }
        .addr-main { font-size: 14px; font-weight: 600; color: #0f172a; }
        .addr-sub { font-size: 12px; color: #64748b; }
        .addr-note { padding: 9px 10px; font-size: 13px; color: #94a3b8; }
    `;
    document.head.appendChild(style);

    /* ---------------- Запит до сервера ---------------- */

    async function fetchSuggest(text, country) {
        // sbClient оголошений у скрипті сторінки
        const client = typeof sbClient !== "undefined" ? sbClient : null;
        if (!client) throw new Error("no client");
        const { data, error } = await client.functions.invoke("fura-geo", {
            body: { action: "suggest", text, country },
        });
        if (error) throw error;
        return data?.results || [];
    }

    /* ---------------- Сам віджет ---------------- */

    /**
     * input     — поле для міста/адреси
     * opts.countrySelect — <select> з країною (або null)
     * opts.fixedCountry  — код країни, якщо країна завжди одна (напр. "ua")
     * opts.mode          — "full" (місто, область, індекс / вулиця) або "city" (тільки назва)
     * opts.onPick(r)     — додатково після вибору
     */
    function attach(input, opts = {}) {
        if (!input || input.dataset.addrAttached) return;
        input.dataset.addrAttached = "1";
        input.setAttribute("autocomplete", "off");

        const box = document.createElement("div");
        box.className = "addr-suggest";
        document.body.appendChild(box);

        let items = [];
        let active = -1;
        let timer = null;
        let reqNo = 0;

        const countryCode = () => {
            if (opts.fixedCountry) return opts.fixedCountry;
            const v = (opts.countrySelect?.value || "").toUpperCase();
            return COUNTRY_CODES[v] || "";
        };

        function place() {
            const r = input.getBoundingClientRect();
            box.style.left = Math.min(r.left, window.innerWidth - Math.max(r.width, 280) - 8) + "px";
            box.style.width = Math.max(r.width, 280) + "px";
            // Список завжди в межах екрана: знизу, а якщо місця мало — над полем
            const below = window.innerHeight - r.bottom - 12;
            const above = r.top - 12;
            if (below < 220 && above > below) {
                box.style.maxHeight = Math.min(300, above) + "px";
                box.style.top = "auto";
                box.style.bottom = window.innerHeight - r.top + 4 + "px";
            } else {
                box.style.maxHeight = Math.min(300, Math.max(below, 120)) + "px";
                box.style.bottom = "auto";
                box.style.top = r.bottom + 4 + "px";
            }
        }

        function close() {
            box.classList.remove("open");
            active = -1;
        }

        // Якщо поле внизу екрана — трохи прокручуємо сторінку вгору, щоб список вліз повністю
        function makeRoom() {
            const need = 330 - (window.innerHeight - input.getBoundingClientRect().bottom);
            if (need <= 0) return;
            let el = input.parentElement;
            while (el && el !== document.body) {
                const oy = getComputedStyle(el).overflowY;
                if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
                    const can = el.scrollHeight - el.clientHeight - el.scrollTop;
                    if (can > 0) el.scrollTop += Math.min(need, can);
                    return;
                }
                el = el.parentElement;
            }
        }

        function show(html) {
            // Користувач уже пішов з поля (або форму закрили) — нічого не показуємо
            if (document.activeElement !== input || input.offsetParent === null) return close();
            box.innerHTML = html;
            if (!box.classList.contains("open")) makeRoom();
            place();
            box.classList.add("open");
        }

        function render() {
            if (!items.length) {
                show(`<div class="addr-note">Нічого не знайдено${countryCode() ? " у цій країні" : ""}</div>`);
                return;
            }
            show(
                items
                    .map((r, i) => {
                        const town = settlementOf(r);
                        const street = streetOf(r);
                        const main = street ? `${street}, ${town}` : town || r.formatted;
                        const sub = [r.postcode, shortState(r.state), r.country].filter(Boolean).join(", ");
                        const icon = street ? "bx-map-pin" : r.type === "postcode" ? "bx-envelope" : "bx-buildings";
                        return `<div class="addr-item${i === active ? " active" : ""}" data-i="${i}">
                            <i class='bx ${icon}'></i>
                            <div><div class="addr-main">${esc(main)}</div><div class="addr-sub">${esc(sub)}</div></div>
                        </div>`;
                    })
                    .join(""),
            );
        }

        function pick(i) {
            const r = items[i];
            if (!r) return;
            const town = settlementOf(r);
            const street = streetOf(r);
            if (opts.mode === "city") {
                input.value = town;
            } else {
                input.value = [town, street, r.postcode, street ? "" : shortState(r.state)]
                    .filter(Boolean)
                    .join(", ");
            }
            input.dataset.lat = r.lat ?? "";
            input.dataset.lon = r.lon ?? "";

            // Якщо країну не обрали — підставимо самі
            const sel = opts.countrySelect;
            const cname = CODE_TO_COUNTRY[String(r.country_code || "").toLowerCase()];
            if (sel && !sel.value && cname && [...sel.options].some((o) => o.value === cname)) {
                sel.value = cname;
                sel.dispatchEvent(new Event("change", { bubbles: true }));
            }

            opts.onPick?.(r);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            close();
        }

        async function load() {
            const text = input.value.trim();
            if (text.length < 2) return close();
            const my = ++reqNo;
            show(`<div class="addr-note">Шукаю…</div>`);
            try {
                const res = await fetchSuggest(text, countryCode());
                if (my !== reqNo) return; // вже ввели інше
                const seen = new Set();
                items = res.filter((r) => {
                    const k = [settlementOf(r), streetOf(r), r.postcode, r.state].join("|").toLowerCase();
                    if (seen.has(k)) return false;
                    seen.add(k);
                    return true;
                });
                active = -1;
                render();
            } catch (e) {
                if (my !== reqNo) return;
                console.warn("address suggest:", e);
                show(`<div class="addr-note">Підказки зараз недоступні — введіть вручну</div>`);
            }
        }

        input.addEventListener("input", (e) => {
            if (!e.isTrusted) return; // це ми самі підставили значення
            clearTimeout(timer);
            timer = setTimeout(load, 300);
        });

        input.addEventListener("keydown", (e) => {
            if (!box.classList.contains("open") || !items.length) return;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                active = (active + 1) % items.length;
                render();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                active = (active - 1 + items.length) % items.length;
                render();
            } else if (e.key === "Enter" && active >= 0) {
                e.preventDefault();
                pick(active);
            } else if (e.key === "Escape") {
                e.stopPropagation();
                close();
            }
        });

        box.addEventListener("mousedown", (e) => {
            e.preventDefault(); // щоб поле не втратило фокус до вибору
            const el = e.target.closest(".addr-item");
            if (el) pick(Number(el.dataset.i));
        });

        input.addEventListener("blur", () => setTimeout(close, 150));
        // Змінили країну — старі підказки вже не актуальні
        opts.countrySelect?.addEventListener("change", close);
        window.addEventListener("scroll", () => box.classList.contains("open") && place(), true);
        window.addEventListener("resize", () => box.classList.contains("open") && place());
    }

    /* ---------------- Підключення до полів на сторінках ---------------- */

    function oblastFromState(state) {
        // "Волинська область" → "ВОЛИНСЬКА ОБЛ."; "Київ" → "М. КИЇВ"
        const s = String(state || "").trim().toUpperCase();
        if (!s) return "";
        if (s === "КИЇВ") return "М. КИЇВ";
        return s.replace(/\s*ОБЛАСТЬ$/, "") + " ОБЛ.";
    }

    function init() {
        const $ = (id) => document.getElementById(id);

        // Запити: завантаження / розвантаження
        attach($("req_load_address"), { countrySelect: $("req_load_country"), mode: "full" });
        attach($("req_unload_address"), { countrySelect: $("req_unload_country"), mode: "full" });
        attach($("req_customs_export"), { countrySelect: $("req_customs_export_country"), mode: "full" });
        attach($("req_customs_import"), { countrySelect: $("req_customs_import_country"), mode: "full" });

        // Ліди: місто клієнта
        attach($("lead_city"), { countrySelect: $("lead_country"), mode: "city" });

        // Перевізники: місто в Україні + автоматично область
        attach($("city"), {
            fixedCountry: "ua",
            mode: "city",
            onPick: (r) => {
                const sel = $("region_ukr");
                const v = oblastFromState(r.state);
                if (sel && v && [...sel.options].some((o) => o.value === v)) sel.value = v;
            },
        });
    }

    window.furaAddressSuggest = attach;
    window.furaCountryCode = (name) => COUNTRY_CODES[String(name || "").toUpperCase()] || "";
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
