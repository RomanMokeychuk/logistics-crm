// FURA — моніторинг Lardi-Trans (Supabase Edge Function "fura-lardi")
//
// Що робить:
//   1. Бере активні напрямки з таблиці lardi_directions (PL → UA, DE → UA, …).
//   2. По кожному напрямку питає офіційний Lardi API (POST /v2/proposals/search/cargo)
//      ключем компанії — лише заявки з ціною.
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
//   LARDI_PAGE_SIZE     — заявок на сторінку (типово 100)
//   LARDI_EXTRA_FILTER  — JSON, що додається до фільтра (наприклад {"onlyActual":true})
//
// Розгортання: supabase functions deploy fura-lardi --no-verify-jwt
// (перевірку робимо самі: співробітник — за входом на сайт; розклад — за секретом).

import { createClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Any = any;

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const API = "https://api.lardi-trans.com/v2";
const KEY = env("LARDI_API_KEY");
const CRON_SECRET = env("LARDI_CRON_SECRET");
const MAX_PAGES = Math.max(1, Math.min(10, Number(env("LARDI_MAX_PAGES", "3")) || 3));
const PAGE_SIZE = Math.max(10, Math.min(150, Number(env("LARDI_PAGE_SIZE", "100")) || 100));
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

async function searchPage(from: string, to: string, page: number, extra: Any): Promise<{ items: Any[]; pages: number }> {
    requestCount++;
    const body = {
        filter: {
            directionFrom: { directionRows: [{ countrySign: from }] },
            directionTo: { directionRows: [{ countrySign: to }] },
            paymentValue: 1, // «Сума від 1» — заявки з «запит вартості» Lardi не віддає
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
        try { const j = JSON.parse(text); msg = j.message || j.error || j.errors?.[0]?.message || msg; } catch { /* текст як є */ }
        if (res.status === 401 || res.status === 403) {
            throw new LardiError(res.status, `Lardi не пускає до пошуку заявок (${res.status}): ${msg}. ` +
                "Перевірте ключ і чи активний пакет «Розширений API» на Lardi.");
        }
        if (res.status === 429) throw new LardiError(429, "Lardi просить зачекати (забагато запитів). Спробуйте пізніше.");
        throw new LardiError(res.status, `Lardi API ${res.status}: ${msg}`);
    }
    const data = JSON.parse(text);
    const items = Array.isArray(data) ? data : (data.content || data.proposals || data.result?.proposals || []);
    const pag = data.paginator || data.result?.paginator || {};
    return { items, pages: Number(pag.pages ?? pag.totalPages ?? 0) || 0 };
}

async function searchAll(from: string, to: string, extra: Any = {}): Promise<Any[]> {
    const out: Any[] = [];
    for (let p = 1; p <= MAX_PAGES; p++) {
        const { items, pages } = await searchPage(from, to, p, extra);
        out.push(...items);
        if (!items.length || items.length < PAGE_SIZE || (pages && p >= pages)) break;
        await new Promise((r) => setTimeout(r, 400)); // м'яко, без шквалу запитів
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* Перетворення заявки Lardi → рядок FURA                              */
/* ------------------------------------------------------------------ */

const ZW = /[​-‏⁠﻿]/g; // невидимі мітки в текстах
const txt = (v: unknown, max = 500): string | null => {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(ZW, "").trim();
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

function point(w: Any): { town: string | null; region: string | null; country: string | null } {
    const town = nameOf(w?.town) ?? txt(w?.townName) ?? txt(w?.address);
    const region = nameOf(w?.region) ?? txt(w?.regionName) ?? nameOf(w?.area) ?? txt(w?.areaName);
    const country = txt(w?.countrySign) ?? nameOf(w?.country);
    return { town, region, country };
}
const pointText = (p: { town: string | null; region: string | null; country: string | null }) =>
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
        raw: p,
    };
}

/* ------------------------------------------------------------------ */
/* Запуск                                                              */
/* ------------------------------------------------------------------ */

async function run(trigger: string, by: string) {
    if (!KEY) return { ok: false, error: "Не задано LARDI_API_KEY у секретах функції" };
    requestCount = 0;
    const { data: runRow } = await db.from("lardi_runs").insert({ trigger, started_by: by }).select("id").single();
    const runId = runRow?.id;
    const now = new Date().toISOString();

    const { data: dirs } = await db.from("lardi_directions").select("*").eq("active", true).order("id");
    const perDir: Any[] = [];
    let found = 0, saved = 0;
    let error: string | null = null;

    try {
        for (const d of dirs || []) {
            const from = String(d.from_country).toUpperCase(), to = String(d.to_country).toUpperCase();
            const all = await searchAll(from, to);
            // хто розмістив: окремі запити з фільтрами Lardi
            const shippers = new Set((await searchAll(from, to, { onlyShippers: true })).map((x) => String(x.id)));
            const carriers = new Set((await searchAll(from, to, { onlyCarrier: true })).map((x) => String(x.id)));

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
        }
    } catch (e) {
        error = String((e as Error)?.message || e).slice(0, 500);
        console.error("fura-lardi:", error);
    }

    if (runId) {
        await db.from("lardi_runs").update({
            finished_at: new Date().toISOString(), found, saved, requests: requestCount, error,
            details: { directions: perDir, page_size: PAGE_SIZE, max_pages: MAX_PAGES },
        }).eq("id", runId);
    }
    return { ok: !error, error, found, saved, requests: requestCount, directions: perDir };
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
