// FURA — моніторинг Lardi-Trans (Supabase Edge Function "fura-lardi")
//
// Що робить:
//   1. Бере активні напрямки з таблиці lardi_directions (PL → UA, DE → UA, …).
//   2. По кожному напрямку питає офіційний Lardi API (POST /v2/proposals/search/cargo)
//      ключем компанії; заявки без ціни («запит вартості») відкидаємо самі.
//   3. Визначає, хто розмістив: окремо питає «лише вантажовласники» (onlyShippers)
//      і «лише перевізники» (onlyCarrier); решта — «Експедиція / інші».
//   4. Записує заявки в lardi_cargo (повторно знайдена — оновлюється), запуск — у lardi_runs.
//
// Важливо: пошук заявок у Lardi API доступний лише з пакетом «Розширений API»
// (lardi-trans.com → Послуги та ціни → extended.api). Без нього Lardi відповість 401/403 —
// функція так і напише в журналі на сторінці «Ларді».
//
// Секрети (Supabase → Edge Functions → Secrets):
//   LARDI_API_KEY       — токен API з налаштувань компанії на Lardi
//   LARDI_CRON_SECRET   — будь-який довгий випадковий рядок (той самий — у розкладі в lardi.sql)
// Необов'язково:
//   LARDI_MAX_PAGES     — скільки сторінок по кожному напрямку (типово 3)
//   LARDI_PAGE_SIZE     — заявок на сторінку (типово 150)
//   LARDI_EXTRA_FILTER  — JSON, що додається до фільтра (наприклад {"onlyActual":true})
//
// Розгортання: supabase functions deploy fura-lardi --no-verify-jwt
// (перевірку робимо самі: співробітник — за входом на сайт; розклад — за секретом).

import { createClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Any = any;

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const API = "https://api.lardi-trans.com/v2";
const KEY = env("LARDI_API_KEY").replace(/\s+/g, ""); // без пробілів і переносів рядка
const CRON_SECRET = env("LARDI_CRON_SECRET");
const MAX_PAGES = Math.max(1, Math.min(10, Number(env("LARDI_MAX_PAGES", "3")) || 3));
const PAGE_SIZE = Math.max(10, Math.min(150, Number(env("LARDI_PAGE_SIZE", "150")) || 150));
let EXTRA: Any = {};
try { EXTRA = JSON.parse(env("LARDI_EXTRA_FILTER", "{}")) || {}; } catch { EXTRA = {}; }

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info, x-lardi-secret",
};
const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } });

/* ------------------------------------------------------------------ */
/* Хто викликає                                                        */
/* ------------------------------------------------------------------ */

function rolesOf(s: Any): string[] {
    if (Array.isArray(s?.roles) && s.roles.length) return s.roles.map(String);
    return s?.role ? [String(s.role)] : [];
}
const isBoss = (s: Any) => rolesOf(s).some((r) => r === "head" || r === "admin");

async function staffFromRequest(req: Request): Promise<Any | null> {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return null;
    const { data } = await db.auth.getUser(jwt);
    const email = data?.user?.email;
    if (!email) return null;
    const { data: me } = await db
        .from("staff")
        .select("*")
        .ilike("email", email.replace(/[\\%_]/g, (ch) => "\\" + ch))
        .eq("active", true)
        .maybeSingle();
    return me || null;
}

function secretOk(req: Request, url: URL): boolean {
    if (!CRON_SECRET) return false;
    return (req.headers.get("x-lardi-secret") || url.searchParams.get("key")) === CRON_SECRET;
}

/* ------------------------------------------------------------------ */
/* Lardi API                                                           */
/* ------------------------------------------------------------------ */

class LardiError extends Error {
    constructor(public status: number, message: string) { super(message); }
}

let requestCount = 0;

// Безкоштовний метод API (пошук користувачів) — чи Lardi взагалі знає цей ключ
async function basicKeyWorks(): Promise<boolean> {
    try {
        requestCount++;
        const res = await fetch(`${API}/users/search?language=uk&query=${encodeURIComponent("Грандар")}&queryLimit=1`, {
            headers: { Authorization: KEY, Accept: "application/json" },
        });
        await res.text();
        return res.ok;
    } catch {
        return false;
    }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function searchPage(from: string, to: string, page: number, extra: Any): Promise<{ items: Any[]; pages: number }> {
    // Lardi обмежує частоту запитів: на 429 чекаємо й пробуємо ще (5 с, 15 с, 30 с)
    for (const wait of [5000, 15000, 30000, 0]) {
        try {
            return await searchPageOnce(from, to, page, extra);
        } catch (e) {
            if (!(e instanceof LardiError) || e.status !== 429 || !wait) throw e;
            await sleep(wait);
        }
    }
    throw new LardiError(429, "Lardi просить зачекати");
}

async function searchPageOnce(from: string, to: string, page: number, extra: Any): Promise<{ items: Any[]; pages: number }> {
    requestCount++;
    const body = {
        filter: {
            directionFrom: { directionRows: [{ countrySign: from }] },
            directionTo: { directionRows: [{ countrySign: to }] },
            ...EXTRA,
            ...extra,
        },
        options: { pageNumber: page, pageSize: PAGE_SIZE },
    };
    const res = await fetch(`${API}/proposals/search/cargo?language=uk`, {
        method: "POST",
        headers: { Authorization: KEY, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
        let msg = text.slice(0, 300);
        try {
            const j = JSON.parse(text);
            msg = j.message || j.error || j.errors?.[0]?.message || msg;
            if (j.wrongFields) msg += " — поля: " + JSON.stringify(j.wrongFields).slice(0, 300);
        } catch { /* текст як є */ }
        if (res.status === 401 || res.status === 403) {
            // Розрізняємо: ключ невірний чи ключ правильний, але немає пакета «Розширений API»
            const keyOk = await basicKeyWorks();
            throw new LardiError(res.status, keyOk
                ? `Ключ Lardi правильний, але пошук заявок закритий (${res.status}: ${msg}). ` +
                  "Потрібен платний пакет «Розширений API» на Lardi (Послуги та ціни → Розширений API)."
                : `Lardi не знає цей ключ (${res.status}: ${msg}). Скопіюйте токен заново в Lardi → Налаштування → API.`);
        }
        if (res.status === 429) throw new LardiError(429, "Lardi просить зачекати (забагато запитів). Спробуйте пізніше.");
        throw new LardiError(res.status, `Lardi API ${res.status}: ${msg}`);
    }
    const data = JSON.parse(text);
    const items = Array.isArray(data) ? data : (data.content || data.proposals || data.result?.proposals || []);
    const pag = data.paginator || data.result?.paginator || {};
    return { items, pages: Number(pag.pages ?? pag.totalPages ?? 0) || 0 };
}

async function searchAll(from: string, to: string, extra: Any = {}, maxPages = MAX_PAGES): Promise<Any[]> {
    const out: Any[] = [];
    for (let p = 1; p <= maxPages; p++) {
        if (requestCount) await sleep(1500); // м'яко, без шквалу запитів
        const { items, pages } = await searchPage(from, to, p, extra);
        out.push(...items);
        if (!items.length || items.length < PAGE_SIZE || (pages && p >= pages)) break;
    }
    return out;
}

/* Коди країн Lardi для посилань на пошук (…/log/search/gruz/wf1i491iwt1i640…) */
const COUNTRY_IDS: Record<string, number> = { PL: 491, DE: 100, TR: 625, UA: 640 }; // відомі заздалегідь
async function loadCountryIds() {
    try {
        requestCount++;
        const res = await fetch(`${API}/references/countries?language=uk`, { headers: { Authorization: KEY, Accept: "application/json" } });
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.content || data.items || data.countries || []);
        for (const c of list) {
            const sign = String(c.sign ?? c.countrySign ?? c.code ?? c.alpha2 ?? "").toUpperCase();
            const id = Number(c.id ?? c.countryId);
            if (sign.length === 2 && id) COUNTRY_IDS[sign] = id;
        }
    } catch { /* лишаються відомі коди */ }
}
// Пошук Lardi в адресі: «wf» — звідки, «wt» — куди; «5i<id>» — місто, «1i<id>» — країна.
// Місто → місто звужує пошук, тож заявка завжди на першій сторінці й картка не закривається.
const lardiUrl = (id: unknown, from: string, to: string, fromTown: number | null, toTown: number | null) => {
    const part = (town: number | null, cc: string) => (town ? `5i${town}` : COUNTRY_IDS[cc] ? `1i${COUNTRY_IDS[cc]}` : "");
    const f = part(fromTown, from), t = part(toTown, to);
    const filter = f && t ? `/wf${f}iwt${t}iq1pc4pt1` : "";
    return `https://lardi-trans.com/log/search/gruz${filter}?currentId=${id}`;
};

/* ------------------------------------------------------------------ */
/* Перетворення заявки Lardi → рядок FURA                              */
/* ------------------------------------------------------------------ */

const ZW = /[​-‏⁠﻿]/g; // невидимі мітки в текстах
const ENT: Record<string, string> = { "&quot;": '"', "&amp;": "&", "&#039;": "'", "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
const txt = (v: unknown, max = 500): string | null => {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(ZW, "").replace(/&(quot|amp|#0?39|apos|lt|gt|nbsp);/g, (m) => ENT[m] ?? m).trim();
    return s ? s.slice(0, max) : null;
};
const nameOf = (v: Any): string | null => (v && typeof v === "object" ? txt(v.name ?? v.value ?? v.title) : txt(v));
const names = (list: Any): string | null => {
    if (!Array.isArray(list)) return nameOf(list);
    const n = list.map((x) => nameOf(x?.type ?? x)).filter(Boolean);
    return n.length ? [...new Set(n)].join(", ") : null;
};
const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : null;
};
function day(v: unknown): string | null {
    if (v === null || v === undefined || v === "") return null;
    const d = typeof v === "number" ? new Date(v) : new Date(String(v));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function ts(v: unknown): string | null {
    if (v === null || v === undefined || v === "") return null;
    const d = typeof v === "number" ? new Date(v) : new Date(String(v));
    return isNaN(d.getTime()) ? null : d.toISOString();
}

type Pt = { town: string | null; region: string | null; country: string | null; zone: string | null; postcode: string | null; townId: number | null };
const first = (v: Any): string | null => (Array.isArray(v) ? txt(v[0]) : txt(v));
function point(w: Any): Pt {
    const town = nameOf(w?.town) ?? txt(w?.townName) ?? txt(w?.address);
    const region = nameOf(w?.region) ?? txt(w?.regionName) ?? nameOf(w?.area) ?? txt(w?.areaName);
    const country = txt(w?.countrySign) ?? nameOf(w?.country);
    const postcode = first(w?.postalCodes) ?? txt(w?.postalCode) ?? txt(w?.postcode) ?? txt(w?.zip);
    const zone = first(w?.postalZones) ?? txt(w?.postalZone) ?? (postcode ? postcode.replace(/\D/g, "").slice(0, 2) || null : null);
    const townId = Number(w?.townId ?? w?.town?.id ?? 0) || null;
    return { town, region, country, zone, postcode, townId };
}
const pointText = (p: Pt) =>
    [p.town, p.region ? `(${p.region})` : null].filter(Boolean).join(" ") || p.country || "";

const CUR: Record<string, string> = { "€": "EUR", EUR: "EUR", "$": "USD", USD: "USD", "ГРН": "UAH", UAH: "UAH", PLN: "PLN", "ZŁ": "PLN" };

function toRow(p: Any, from: string, to: string, ownerType: string, now: string): Any | null {
    const pay = p.payment || {};
    const value = num(pay.value ?? p.paymentValue);
    if (!value || value <= 0) return null; // лише з ціною

    const unitRaw = String(nameOf(pay.unit) ?? "").toLowerCase();
    const perKm = /км|km/.test(unitRaw);
    const perT = /^т|тон|ton|\bt\b/.test(unitRaw);
    const curName = String(nameOf(pay.currency) ?? "").toUpperCase();
    const currency = CUR[curName] || curName || null;

    const src = (p.waypointListSource || []).map(point);
    const dst = (p.waypointListTarget || []).map(point);
    const distM = num(p.distanceLine ?? p.distance);
    const distance = distM ? Math.round(distM > 20000 ? distM / 1000 : distM) : null; // метри → км

    const size = p.size || {};
    const mass = num(size.massTo ?? size.massFrom ?? size.mass ?? p.gruzMass);
    const volume = num(size.volumeTo ?? size.volumeFrom ?? size.volume ?? p.gruzVolume);

    // «1 €», «10 €» — заглушки замість ціни: такі заявки не беремо
    if (perKm ? value < 0.3 : !perT && value < 50) return null;
    const price = perKm ? (distance ? Math.round(value * distance) : null) : perT ? null : value;
    const pricePerKm = perKm ? value : price && distance ? Math.round((price / distance) * 100) / 100 : null;

    const owner = p.owner || p.proposalUser || {};
    const phones = owner.phones || owner.contact?.phones || [];
    const phone = txt(Array.isArray(phones) ? (phones[0]?.phone ?? phones[0]?.number ?? phones[0]) : phones)
        ?? txt(owner.contact?.phoneItem1?.phone);
    const ratingRaw = Array.isArray(owner.rating) ? owner.rating[0] : owner.rating;
    const rating = num(ratingRaw?.ratingBall ?? ratingRaw?.value ?? ratingRaw);

    return {
        id: Number(p.id),
        seen_last: now,
        from_country: from,
        to_country: to,
        direction: `${from} → ${to}`,
        from_town: src[0]?.town ?? null,
        from_region: src[0]?.region ?? src[0]?.town ?? null,
        from_points: src.map(pointText).join("; ") || null,
        to_town: dst[0]?.town ?? null,
        to_region: dst[0]?.region ?? dst[0]?.town ?? null,
        to_points: dst.map(pointText).join("; ") || null,
        from_zone: src[0]?.zone ?? null,
        from_postcode: src[0]?.postcode ?? null,
        to_zone: dst[0]?.zone ?? null,
        to_postcode: dst[0]?.postcode ?? null,
        date_from: day(p.dateFrom),
        date_to: day(p.dateTo),
        distance_km: distance,
        cargo: nameOf(p.content) ?? txt(p.gruzName),
        mass_t: mass,
        volume_m3: volume,
        body_types: names(p.cargoBodyTypes) ?? nameOf(p.bodyType),
        load_types: names(p.loadTypes),
        adr: nameOf(p.cargoAdr) ?? txt(p.adr),
        groupage: p.groupage === true,
        price,
        price_per_km: pricePerKm,
        currency,
        payment_unit: txt(nameOf(pay.unit)),
        payment_raw: value,
        payment_forms: names(p.paymentForms?.map?.((f: Any) => ({ name: [nameOf(f.type), f.vat ? "з ПДВ" : ""].filter(Boolean).join(" ") }))),
        prepay: num(pay.prepay),
        delay_days: num(pay.delay),
        owner_ref: num(owner.refId) ? Number(owner.refId) : null,
        owner_name: txt(owner.name ?? owner.contact?.nameWithBrand),
        owner_face: txt(owner.face ?? owner.contact?.face),
        owner_phone: phone,
        owner_type: ownerType,
        owner_rating: rating,
        raw: { ...p, _lardi_url: lardiUrl(p.id, from, to, src[0]?.townId ?? null, dst[0]?.townId ?? null) },
    };
}

/* ------------------------------------------------------------------ */
/* Запуск                                                              */
/* ------------------------------------------------------------------ */

async function run(trigger: string, by: string) {
    if (!KEY) return { ok: false, error: "Не задано LARDI_API_KEY у секретах функції" };
    // не запускаємо друге оновлення, поки йде перше (інакше Lardi відповідає «забагато запитів»)
    const { data: running } = await db.from("lardi_runs").select("id, started_at").is("finished_at", null)
        .gte("started_at", new Date(Date.now() - 6 * 60000).toISOString()).limit(1);
    if (running?.length) return { ok: false, error: "Оновлення вже йде — зачекайте кілька хвилин і оновіть сторінку." };
    requestCount = 0;
    const { data: runRow } = await db.from("lardi_runs").insert({ trigger, started_by: by }).select("id").single();
    const runId = runRow?.id;
    const now = new Date().toISOString();

    // Найдавніше оновлені — першими; один запуск працює до ~4 хв, решта — наступного разу
    await loadCountryIds();
    const { data: dirs } = await db.from("lardi_directions").select("*").eq("active", true)
        .order("last_run_at", { ascending: true, nullsFirst: true }).order("id");
    const t0 = Date.now();
    const BUDGET_MS = 240000;
    let skipped = 0;
    const perDir: Any[] = [];
    let found = 0, saved = 0;
    let error: string | null = null;

    const errors: string[] = [];
    for (const d of dirs || []) {
        if (Date.now() - t0 > BUDGET_MS) { skipped++; continue; }
        const from = String(d.from_country).toUpperCase(), to = String(d.to_country).toUpperCase();
        try {
            const all = await searchAll(from, to);
            if (!all.length) {
                perDir.push({ direction: `${from} → ${to}`, received: 0, priced: 0 });
                await db.from("lardi_directions").update({ last_run_at: new Date().toISOString(), last_found: 0 }).eq("id", d.id);
                continue;
            }
            // хто розмістив: окремі запити з фільтрами Lardi
            const shippers = new Set((await searchAll(from, to, { onlyShippers: true }, 1)).map((x) => String(x.id)));
            const carriers = new Set((await searchAll(from, to, { onlyCarrier: true }, 1)).map((x) => String(x.id)));

            const rows = all
                .map((p) => {
                    const id = String(p.id);
                    const type = shippers.has(id) ? "Вантажовласник" : carriers.has(id) ? "Перевізник" : "Експедиція / інші";
                    return toRow(p, from, to, type, now);
                })
                .filter(Boolean);
            const uniq = [...new Map(rows.map((r: Any) => [r.id, r])).values()];
            found += uniq.length;

            for (let i = 0; i < uniq.length; i += 200) {
                const { error: e } = await db.from("lardi_cargo").upsert(uniq.slice(i, i + 200), { onConflict: "id" });
                if (e) throw new Error("База: " + e.message);
            }
            saved += uniq.length;
            perDir.push({ direction: `${from} → ${to}`, received: all.length, priced: uniq.length, shippers: shippers.size, carriers: carriers.size });
            await db.from("lardi_directions").update({ last_run_at: new Date().toISOString(), last_found: uniq.length }).eq("id", d.id);
        } catch (e) {
            const msg = String((e as Error)?.message || e).slice(0, 300);
            console.error("fura-lardi:", from, to, msg);
            perDir.push({ direction: `${from} → ${to}`, error: msg });
            // ключ / пакет — далі немає сенсу; інші помилки — пробуємо наступні напрямки
            if (e instanceof LardiError && (e.status === 401 || e.status === 403)) { errors.push(msg); break; }
            errors.push(`${from} → ${to}: ${msg}`);
        }
    }
    if (errors.length) error = errors.join(" | ").slice(0, 500);

    if (runId) {
        await db.from("lardi_runs").update({
            finished_at: new Date().toISOString(), found, saved, requests: requestCount, error,
            details: { directions: perDir, page_size: PAGE_SIZE, max_pages: MAX_PAGES, left_for_next_run: skipped },
        }).eq("id", runId);
    }
    return { ok: !error, error, found, saved, requests: requestCount, directions: perDir, left: skipped };
}

/* Напрямки: додати / вимкнути / видалити (лише керівник) */
async function directions(body: Any) {
    const cc = (v: unknown) => String(v || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
    if (body.op === "add") {
        const from = cc(body.from), to = cc(body.to);
        if (from.length !== 2 || to.length !== 2) return { status: 400, data: { error: "Вкажіть коди країн, наприклад PL і UA" } };
        const { error } = await db.from("lardi_directions").upsert({ from_country: from, to_country: to, active: true }, { onConflict: "from_country,to_country" });
        if (error) return { status: 500, data: { error: error.message } };
    } else if (body.op === "toggle") {
        const { error } = await db.from("lardi_directions").update({ active: !!body.active }).eq("id", body.id);
        if (error) return { status: 500, data: { error: error.message } };
    } else if (body.op === "delete") {
        const { error } = await db.from("lardi_directions").delete().eq("id", body.id);
        if (error) return { status: 500, data: { error: error.message } };
    } else return { status: 400, data: { error: "unknown op" } };
    return { status: 200, data: { ok: true } };
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return new Response("FURA Lardi monitor is running");
    const url = new URL(req.url);

    let body: Any;
    try { body = await req.json(); } catch { return json(400, { error: "bad request" }); }

    try {
        if (body.action === "tick") {
            if (!secretOk(req, url)) return json(403, { error: "forbidden" });
            return json(200, await run("cron", "розклад"));
        }

        const me = await staffFromRequest(req);
        if (!me) return json(403, { error: "Вас немає серед співробітників FURA" });

        switch (body.action) {
            case "run":
                return json(200, await run("manual", me.full_name || me.email || "співробітник"));
            case "directions": {
                if (!isBoss(me)) return json(403, { error: "Напрямки змінює лише керівник" });
                const out = await directions(body);
                return json(out.status, out.data);
            }
            case "status":
                return json(200, { key: !!KEY, cron: !!CRON_SECRET, boss: isBoss(me), pageSize: PAGE_SIZE, maxPages: MAX_PAGES });
            default:
                return json(400, { error: "unknown action" });
        }
    } catch (e) {
        console.error(e);
        return json(500, { error: "Помилка сервера. Спробуйте ще раз." });
    }
});
