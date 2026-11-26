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

// Вантажі — /proposals/search/cargo; машини — шлях визначаємо при першому запиті (Lardi називає їх по-різному)
type Kind = "cargo" | "truck";
const TRUCK_PATHS = ["lorry", "truck", "transport", "trans"];
let truckPath = "";
async function searchPage(from: string, to: string, page: number, extra: Any, kind: Kind = "cargo"): Promise<{ items: Any[]; pages: number }> {
    if (kind === "truck" && !truckPath) {
        let last: unknown = null;
        for (const path of TRUCK_PATHS) {
            try {
                const r = await searchPageRetry(from, to, page, extra, path);
                truckPath = path;
                return r;
            } catch (e) {
                last = e;
                if (!(e instanceof LardiError) || (e.status !== 404 && e.status !== 405)) throw e;
            }
        }
        throw last instanceof Error ? last : new Error("Lardi: пошук машин недоступний");
    }
    return await searchPageRetry(from, to, page, extra, kind === "truck" ? truckPath : "cargo");
}

async function searchPageRetry(from: string, to: string, page: number, extra: Any, path: string): Promise<{ items: Any[]; pages: number }> {
    // Lardi обмежує частоту запитів: на 429 чекаємо й пробуємо ще (5 с, 15 с, 30 с)
    for (const wait of [5000, 15000, 30000, 0]) {
        try {
            return await searchPageOnce(from, to, page, extra, path);
        } catch (e) {
            if (!(e instanceof LardiError) || e.status !== 429 || !wait) throw e;
            await sleep(wait);
        }
    }
    throw new LardiError(429, "Lardi просить зачекати");
}

async function searchPageOnce(from: string, to: string, page: number, extra: Any, path = "cargo"): Promise<{ items: Any[]; pages: number }> {
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
    const res = await fetch(`${API}/proposals/search/${path}?language=uk`, {
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

async function searchAll(from: string, to: string, extra: Any = {}, maxPages = MAX_PAGES, kind: Kind = "cargo"): Promise<Any[]> {
    const out: Any[] = [];
    for (let p = 1; p <= maxPages; p++) {
        if (requestCount) await sleep(1500); // м'яко, без шквалу запитів
        const { items, pages } = await searchPage(from, to, p, extra, kind);
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
const lardiUrl = (id: unknown, from: string, to: string, fromTown: number | null, toTown: number | null, kind: Kind = "cargo") => {
    const part = (town: number | null, cc: string) => (town ? `5i${town}` : COUNTRY_IDS[cc] ? `1i${COUNTRY_IDS[cc]}` : "");
    const f = part(fromTown, from), t = part(toTown, to);
    const filter = f && t ? `/wf${f}iwt${t}iq1pc4pt1` : "";
    return `https://lardi-trans.com/log/search/${kind === "truck" ? "trans" : "gruz"}${filter}?currentId=${id}`;
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

// Дозволи й документи з заявки: ADR (клас), TIR, CMR, T1, ЕКМТ, санпаспорт… — одним рядком
function permitsOf(p: Any): string | null {
    const out = new Set<string>();
    const adr = nameOf(p.cargoAdr) ?? names(p.transAdr) ?? (num(p.adr) ? txt(p.adr) : null);
    if (adr) out.add(/adr/i.test(adr) ? adr : `ADR ${adr}`);
    const RX = /tir|cmr|ekmt|ecmt|екмт|^t1$|t1|sanpass|санпасп|document|permit|dozvil|дозв/i;
    const visit = (o: Any, path: string) => {
        if (!o || typeof o !== "object") return;
        for (const [k, v] of Object.entries(o)) {
            const kp = `${path}.${k}`;
            if (/owner|contact|waypoint|payment|proposalUser/i.test(k)) continue;
            if (Array.isArray(v) && RX.test(k)) v.forEach((x) => { const n = nameOf(x); if (n) out.add(n); });
            else if (v === true && RX.test(k)) out.add(k.replace(/^(has|need|is)/i, "").toUpperCase().replace("ECMT", "ЕКМТ").replace("EKMT", "ЕКМТ"));
            else if (v && typeof v === "object") visit(v, kp);
        }
    };
    visit(p, "");
    return out.size ? [...out].join(", ") : null;
}

function toRow(p: Any, from: string, to: string, ownerType: string, now: string, kind: Kind = "cargo"): Any | null {
    const pay = p.payment || {};
    let value = num(pay.value ?? p.paymentValue);
    if (!value || value <= 0) return null; // і вантажі, і машини — лише з ціною

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
    // машини: size.body (+ size.trailer для зчіпки) — { mass, volume }
    const sumOf = (k: string) => {
        const v = (num(size.body?.[k]) || 0) + (num(size.trailer?.[k]) || 0);
        return v > 0 ? v : null;
    };
    const mass = num(size.massTo ?? size.massFrom ?? size.mass ?? p.gruzMass) ?? sumOf("mass");
    const volume = num(size.volumeTo ?? size.volumeFrom ?? size.volume ?? p.gruzVolume) ?? sumOf("volume");

    // «1 €», «10 €» — заглушки замість ціни: такі заявки не беремо
    if (perKm ? value < 0.3 : !perT && value < 50) return null; // «1 €», «10 €» — заглушки
    const price = value == null ? null : perKm ? (distance ? Math.round(value * distance) : null) : perT ? null : value;
    const pricePerKm = value == null ? null : perKm ? value : price && distance ? Math.round((price / distance) * 100) / 100 : null;

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
        cargo: nameOf(p.content) ?? txt(p.gruzName) ?? nameOf(p.transBodyTypeCategory), // у машин — «Тягач + напівпричіп» тощо
        mass_t: mass,
        volume_m3: volume,
        body_types: names(p.cargoBodyTypes) ?? nameOf(p.bodyType) ?? nameOf(p.transBodyType),
        load_types: names(p.loadTypes),
        adr: permitsOf(p),
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
        raw: { ...p, _lardi_url: lardiUrl(p.id, from, to, src[0]?.townId ?? null, dst[0]?.townId ?? null, kind) },
    };
}


/* ------------------------------------------------------------------ */
/* «Авто»: перевізники з Lardi ↔ «Перевізники» FURA                    */
/* ------------------------------------------------------------------ */
// Збіг — за телефоном (останні 9 цифр) або за назвою без «ФОП/ТОВ/ПП» і лапок.
// Знайденому перевізнику дописуємо в картку напрямок: країну (з областю/воєводством)
// у «Закордон» і область України у «Напрямки в Україні». Нових перевізників не додаємо.

// Назви країн — як у списку «Закордон» картки перевізника
const CARRIER_COUNTRY: Record<string, string> = {
    PL: "ПОЛЬША", DE: "НІМЕЧЧИНА", LT: "ЛИТВА", LV: "ЛАТВІЯ", ES: "ІСПАНІЯ", IT: "ІТАЛІЯ", RO: "РУМУНІЯ",
    CZ: "ЧЕХІЯ", AT: "АВСТРІЯ", AZ: "АЗЕРБАЙДЖАН", AM: "ВІРМЕНІЯ", BE: "БЕЛЬГІЯ", BG: "БОЛГАРІЯ",
    GB: "ВЕЛИКОБРИТАНІЯ", HU: "УГОРЩИНА", FR: "ФРАНЦІЯ", DK: "ДАНІЯ", MD: "МОЛДОВА", NL: "НІДЕРЛАНДИ",
    SK: "СЛОВАЧЧИНА", SI: "СЛОВЕНІЯ", TR: "ТУРЕЧЧИНА", GE: "ГРУЗІЯ", FI: "ФІНЛЯНДІЯ", EE: "ЕСТОНІЯ", KZ: "КАЗАХСТАН",
};
let regionNames: Intl.DisplayNames | null = null;
try { regionNames = new Intl.DisplayNames(["uk"], { type: "region" }); } catch { regionNames = null; }
const carrierCountry = (cc: string) => CARRIER_COUNTRY[cc] || (regionNames?.of(cc) || cc).toLocaleUpperCase("uk");

const digits9 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-9);
const phonesIn = (v: unknown): string[] =>
    (String(v ?? "").match(/\+?\d[\d\s()\-]{7,}\d/g) || []).map(digits9).filter((x) => x.length === 9);
const nameKey = (v: unknown) =>
    String(v ?? "")
        .toLocaleUpperCase("uk")
        .replace(/[«»"“”'’ʼ`]/g, "")
        .replace(/ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ/g, "ТОВ")
        .replace(/ПРИВАТНЕ ПІДПРИЄМСТВО/g, "ПП")
        .replace(/ФІЗИЧНА ОСОБА[- ]+ПІДПРИЄМЕЦЬ/g, "ФОП")
        .replace(/(^|[\s,.])(ФОП|ТОВ|ПП|ПРАТ|ПАТ|ТЗОВ|LTD|LLC|SP\. Z O\.O\.|SP Z OO)(?=$|[\s,.])/g, " ")
        .replace(/[.,]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

type Carrier = { id: number; name: string | null; phone_1: string | null; phone_2: string | null; destinations: string | null; ukraine_directions: string | null; profile_url?: string | null };
let CARRIERS: { byPhone: Map<string, Carrier[]>; byName: Map<string, Carrier[]> } | null = null;

async function loadCarriers() {
    if (CARRIERS) return CARRIERS;
    const byPhone = new Map<string, Carrier[]>(), byName = new Map<string, Carrier[]>();
    const add = (m: Map<string, Carrier[]>, k: string, c: Carrier) => { if (!k) return; const a = m.get(k) || []; if (!a.includes(c)) a.push(c); m.set(k, a); };
    for (let from = 0; from < 100000; from += 1000) {
        const { data, error } = await db.from("carriers").select("id, name, phone_1, phone_2, destinations, ukraine_directions, profile_url").order("id").range(from, from + 999);
        if (error) throw new Error("Перевізники FURA: " + error.message);
        for (const c of (data || []) as Carrier[]) {
            for (const ph of [...phonesIn(c.phone_1), ...phonesIn(c.phone_2)]) add(byPhone, ph, c);
            const k = nameKey(c.name);
            if (k.length >= 4) add(byName, k, c);
        }
        if (!data || data.length < 1000) break;
    }
    CARRIERS = { byPhone, byName };
    return CARRIERS;
}

// Усі телефони з машини Lardi (власник і контакт)
function lardiPhones(p: Any): string[] {
    const o = p.owner || p.proposalUser || {};
    const raw = JSON.stringify([o.phones, o.contact?.phones, o.contact?.phoneItem1, o.contact?.phoneItem2, o.contact?.phoneItem3, p.contact]);
    return [...new Set(phonesIn(raw))];
}

function matchCarrier(p: Any, ownerName: string | null): Carrier | null {
    if (!CARRIERS) return null;
    for (const ph of lardiPhones(p)) {
        const a = CARRIERS.byPhone.get(ph);
        if (a?.length === 1) return a[0];
    }
    const k = nameKey(ownerName);
    const a = k.length >= 4 ? CARRIERS.byName.get(k) : undefined;
    return a?.length === 1 ? a[0] : null;
}

// «ПОЛЬША - Поморське воєв., Мазовецьке воєв.; БЕЛЬГІЯ» ⇄ Map
function parseDest(s: string | null): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const item of String(s || "").split(";")) {
        const i = item.indexOf("-");
        const c = (i >= 0 ? item.slice(0, i) : item).trim();
        if (!c) continue;
        const regs = i >= 0 ? item.slice(i + 1).split(",").map((x) => x.trim()).filter(Boolean) : [];
        m.set(c, [...new Set([...(m.get(c) || []), ...regs])]);
    }
    return m;
}
const serDest = (m: Map<string, string[]>) => [...m].map(([c, r]) => (r.length ? `${c} - ${r.join(", ")}` : c)).join("; ");

const uaOblast = (region: string | null, town: string | null): string | null => {
    const r = String(region || "").trim();
    if (/^м\.?\s*київ$/i.test(r) || (!r && /^київ$/i.test(String(town || "")))) return "М. КИЇВ";
    if (!/обл\.?$/i.test(r)) return null;
    return r.replace(/\s*обл\.?$/i, "").toLocaleUpperCase("uk") + " ОБЛ.";
};

// Дописати перевізнику напрямок машини; повертає true, якщо картку змінено
function addRoute(c: Carrier, row: Any): boolean {
    // По Україні: дописуємо обидві області (звідки й куди) у «Напрямки в Україні»
    if (row.from_country === "UA" && row.to_country === "UA") {
        const list = String(c.ukraine_directions || "").split(";").map((x) => x.trim()).filter(Boolean);
        let changed = false;
        for (const ob of [uaOblast(row.from_region, row.from_town), uaOblast(row.to_region, row.to_town)]) {
            if (ob && !list.includes(ob)) { list.push(ob); changed = true; }
        }
        if (changed) c.ukraine_directions = list.join("; ");
        return changed;
    }
    const imp = row.to_country === "UA" && row.from_country !== "UA";
    const exp = row.from_country === "UA" && row.to_country !== "UA";
    if (!imp && !exp) return false;
    const foreignCc = imp ? row.from_country : row.to_country;
    const foreignRegion = imp ? row.from_region : row.to_region;
    const ua = imp ? uaOblast(row.to_region, row.to_town) : uaOblast(row.from_region, row.from_town);

    const dest = parseDest(c.destinations);
    const country = carrierCountry(foreignCc);
    const regs = dest.get(country) || [];
    const reg = foreignRegion ? String(foreignRegion).trim() : "";
    const nextRegs = reg && !regs.some((x) => x.toLowerCase() === reg.toLowerCase()) ? [...regs, reg] : regs;
    let changed = false;
    if (!dest.has(country) || nextRegs.length !== regs.length) {
        dest.set(country, nextRegs);
        c.destinations = serDest(dest);
        changed = true;
    }
    if (ua) {
        const list = String(c.ukraine_directions || "").split(";").map((x) => x.trim()).filter(Boolean);
        if (!list.includes(ua)) {
            c.ukraine_directions = [...list, ua].join("; ");
            changed = true;
        }
    }
    return changed;
}

/* ------------------------------------------------------------------ */
/* Запуск                                                              */
/* ------------------------------------------------------------------ */

async function run(trigger: string, by: string, onlyFrom = "", onlyTo = "", kind: Kind = "cargo", staleMs = 0) {
    const TRUCK = kind === "truck";
    const TABLE = TRUCK ? "lardi_trucks" : "lardi_cargo";
    const LAST = TRUCK ? "truck_last_run_at" : "last_run_at", FOUND = TRUCK ? "truck_last_found" : "last_found";
    if (!KEY) return { ok: false, error: "Не задано LARDI_API_KEY у секретах функції" };
    // не запускаємо друге оновлення, поки йде перше (інакше Lardi відповідає «забагато запитів»)
    const { data: running } = await db.from("lardi_runs").select("id, started_at").is("finished_at", null)
        .gte("started_at", new Date(Date.now() - 160000).toISOString()).limit(1);
    if (running?.length) return { ok: false, error: "Оновлення вже йде — зачекайте кілька хвилин і оновіть сторінку." };
    requestCount = 0;
    let { data: runRow } = await db.from("lardi_runs").insert({ trigger, started_by: by, kind }).select("id").single();
    if (!runRow) ({ data: runRow } = await db.from("lardi_runs").insert({ trigger, started_by: by }).select("id").single()); // ще без колонки kind
    const runId = runRow?.id;
    const now = new Date().toISOString();

    // Найдавніше оновлені — першими; один запуск працює до ~100 с, решта — наступного разу
    await loadCountryIds();
    // можна оновити лише вибраний напрямок (напр. PL → UA) або всі напрямки з/в одну країну
    let dq = db.from("lardi_directions").select("*").eq("active", true);
    if (onlyFrom) dq = dq.eq("from_country", onlyFrom);
    if (onlyTo) dq = dq.eq("to_country", onlyTo);
    // розклад: лише напрямки, які давно не оновлювались (щоб кожен оновлювався ~3 рази на день)
    if (staleMs > 0) dq = dq.or(`${LAST}.is.null,${LAST}.lt.${new Date(Date.now() - staleMs).toISOString()}`);
    const { data: dirs } = await dq
        .order(LAST, { ascending: true, nullsFirst: true }).order("id");
    if (!(dirs || []).length) {
        if (runId) await db.from("lardi_runs").update({ finished_at: new Date().toISOString(), found: 0, saved: 0, requests: requestCount }).eq("id", runId);
        return { ok: false, error: `Напрямку ${onlyFrom || "усі"} → ${onlyTo || "усі"} немає в списку — додайте його в «Напрямки»`, found: 0, saved: 0, requests: requestCount, directions: [], left: 0 };
    }
    const t0 = Date.now();
    // Supabase обриває функцію через ~150 с — беремо порцію до ~100 с
    const BUDGET_MS = Number(Deno.env.get("LARDI_BUDGET_MS") || 100000);
    let skipped = 0;
    const perDir: Any[] = [];
    let found = 0, saved = 0;
    let error: string | null = null;

    const errors: string[] = [];
    let linked = 0, cardsUpdated = 0;
    const touched = new Map<number, Carrier>();
    if (TRUCK) {
        try { await loadCarriers(); } catch (e) { errors.push(String((e as Error).message || e)); }
    }
    for (const d of dirs || []) {
        if (Date.now() - t0 > BUDGET_MS) { skipped++; continue; }
        const from = String(d.from_country).toUpperCase(), to = String(d.to_country).toUpperCase();
        try {
            // По Україні заявок набагато більше — беремо більше сторінок
            const all = await searchAll(from, to, {}, from === to ? Math.max(MAX_PAGES, 8) : MAX_PAGES, kind);
            if (!all.length) {
                perDir.push({ direction: `${from} → ${to}`, received: 0, priced: 0 });
                await db.from("lardi_directions").update({ [LAST]: new Date().toISOString(), [FOUND]: 0 }).eq("id", d.id);
                continue;
            }
            // хто розмістив вантаж: окремі запити з фільтрами Lardi (для машин — не потрібно)
            const shippers = TRUCK ? new Set<string>() : new Set((await searchAll(from, to, { onlyShippers: true }, 1)).map((x) => String(x.id)));
            const carriers = TRUCK ? new Set<string>() : new Set((await searchAll(from, to, { onlyCarrier: true }, 1)).map((x) => String(x.id)));

            const rows = all
                .map((p) => {
                    const id = String(p.id);
                    const type = TRUCK ? "Перевізник" : shippers.has(id) ? "Вантажовласник" : carriers.has(id) ? "Перевізник" : "Експедиція / інші";
                    const row = toRow(p, from, to, type, now, kind);
                    if (row && TRUCK) {
                        const c = matchCarrier(p, row.owner_name);
                        row.carrier_id = c?.id ?? null;
                        if (c) {
                            linked++;
                            if (addRoute(c, row)) touched.set(c.id, c);
                            // посилання на профіль Lardi — у картку, якщо там ще порожньо
                            if (!c.profile_url && row.owner_ref) {
                                c.profile_url = `https://lardi-trans.com/user/${row.owner_ref}/`;
                                touched.set(c.id, c);
                            }
                        }
                    }
                    return row;
                })
                .filter(Boolean);
            const uniq = [...new Map(rows.map((r: Any) => [r.id, r])).values()];
            found += uniq.length;

            // пачками по 100; якщо база не встигла (statement timeout) — ще раз дрібніше
            for (let i = 0; i < uniq.length; i += 100) {
                const part = uniq.slice(i, i + 100);
                let { error: e } = await db.from(TABLE).upsert(part, { onConflict: "id" });
                if (e && /timeout/i.test(e.message)) {
                    e = null;
                    for (let j = 0; j < part.length && !e; j += 20) ({ error: e } = await db.from(TABLE).upsert(part.slice(j, j + 20), { onConflict: "id" }));
                }
                if (e) throw new Error("База: " + e.message);
            }
            saved += uniq.length;
            perDir.push({ direction: `${from} → ${to}`, received: all.length, priced: uniq.length, shippers: shippers.size, carriers: carriers.size });
            await db.from("lardi_directions").update({ [LAST]: new Date().toISOString(), [FOUND]: uniq.length }).eq("id", d.id);
            // картки перевізників FURA: дописуємо нові напрямки одразу (якщо функцію оборве — вже збережено)
            for (const c of touched.values()) {
                const { error: e } = await db.from("carriers").update({ destinations: c.destinations, ukraine_directions: c.ukraine_directions, profile_url: c.profile_url ?? null }).eq("id", c.id);
                if (e) errors.push("Картка перевізника: " + e.message);
                else cardsUpdated++;
            }
            touched.clear();
        } catch (e) {
            const msg = String((e as Error)?.message || e).slice(0, 300);
            console.error("fura-lardi:", from, to, msg);
            perDir.push({ direction: `${from} → ${to}`, error: msg });
            // країни, якої Lardi не знає (напр. XK — Косово): вимикаємо напрямок і не вважаємо це помилкою
            const known = Object.keys(COUNTRY_IDS).length > 4;
            if (e instanceof LardiError && e.status === 406 && known && (!COUNTRY_IDS[from] || !COUNTRY_IDS[to])) {
                await db.from("lardi_directions").update({ active: false, [LAST]: new Date().toISOString(), [FOUND]: 0 }).eq("id", d.id);
                perDir[perDir.length - 1].error = "Lardi не знає цю країну — напрямок вимкнено";
                continue;
            }
            // ключ / пакет — далі немає сенсу; інші помилки — пробуємо наступні напрямки
            if (e instanceof LardiError && (e.status === 401 || e.status === 403)) { errors.push(msg); break; }
            errors.push(`${from} → ${to}: ${msg}`);
        }
    }
    if (errors.length) error = errors.join(" | ").slice(0, 500);

    if (runId) {
        await db.from("lardi_runs").update({
            finished_at: new Date().toISOString(), found, saved, requests: requestCount, error,
            details: { kind, truck_path: truckPath || null, linked, cards_updated: cardsUpdated, directions: perDir, page_size: PAGE_SIZE, max_pages: MAX_PAGES, left_for_next_run: skipped },
        }).eq("id", runId);
    }
    return { ok: !error, error, found, saved, linked, cardsUpdated, requests: requestCount, directions: perDir, left: skipped };
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

/* ================================================================== */
/* Оновити картку перевізника з Lardi (офіційний API, ключ компанії)   */
/*  1. refId — з посилання в картці або пошуком /users/search за ЄДРПОУ */
/*  2. дані профілю — методи користувача, які дає ключ                  */
/*  3. транспорт — заявки «авто» цього перевізника з lardi_trucks        */
/*  Повертає список змін; записує лише після підтвердження (apply).     */
/* ================================================================== */
const LARDI_COUNTRY_UA: Record<string, string> = {
    PL: "ПОЛЬША", DE: "НІМЕЧЧИНА", LT: "ЛИТВА", LV: "ЛАТВІЯ", EE: "ЕСТОНІЯ", CZ: "ЧЕХІЯ", SK: "СЛОВАЧЧИНА", HU: "УГОРЩИНА",
    RO: "РУМУНІЯ", MD: "МОЛДОВА", BG: "БОЛГАРІЯ", TR: "ТУРЕЧЧИНА", AT: "АВСТРІЯ", IT: "ІТАЛІЯ", FR: "ФРАНЦІЯ", NL: "НІДЕРЛАНДИ",
    BE: "БЕЛЬГІЯ", ES: "ІСПАНІЯ", PT: "ПОРТУГАЛІЯ", DK: "ДАНІЯ", SE: "ШВЕЦІЯ", FI: "ФІНЛЯНДІЯ", NO: "НОРВЕГІЯ", CH: "ШВЕЙЦАРІЯ",
    GB: "ВЕЛИКОБРИТАНІЯ", GR: "ГРЕЦІЯ", SI: "СЛОВЕНІЯ", HR: "ХОРВАТІЯ", RS: "СЕРБІЯ", GE: "ГРУЗІЯ", AM: "ВІРМЕНІЯ", AZ: "АЗЕРБАЙДЖАН",
    KZ: "КАЗАХСТАН", UZ: "УЗБЕКИСТАН", LU: "ЛЮКСЕМБУРГ", IE: "ІРЛАНДІЯ", MK: "МАКЕДОНІЯ", AL: "АЛБАНІЯ", BA: "БОСНІЯ",
};
// Назви країн — як у FURA (список у формі перевізника): «ПОЛЬША», «ВЕЛИКОБРИТАНІЯ»…
const COUNTRY_ALIAS: Record<string, string> = { "ПОЛЬЩА": "ПОЛЬША", "ВЕЛИКА БРИТАНІЯ": "ВЕЛИКОБРИТАНІЯ", "БОСНІЯ І ГЕРЦЕГОВИНА": "БОСНІЯ", "ПІВНІЧНА МАКЕДОНІЯ": "МАКЕДОНІЯ" };
const normCountry = (v: string) => { const c = String(v || "").trim().toUpperCase().replace(/\s+/g, " "); return COUNTRY_ALIAS[c] || c; };
const digitsOnly = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const codeKey = (v: unknown) => digitsOnly(v).replace(/^0+/, "");

// Ручна кнопка «З Lardi» — чекаємо терпляче (до ~1 хв), щоб не показувати помилку при короткій паузі Lardi
let patient = false;
let patientUntil = 0; // не чекаємо довше ~45 с на один клік, щоб вікно не «висіло»
async function lardiGet(path: string, tries = patient ? 5 : 3): Promise<Any | null> {
    requestCount++;
    let res: Response;
    try {
        res = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}language=uk`, { headers: { Authorization: KEY, Accept: "application/json" } });
    } catch (e) {
        if (tries > 1) { await sleep(1500); return lardiGet(path, tries - 1); }
        throw new LardiError(503, "Lardi не відповідає. Спробуйте за хвилину.");
    }
    const text = await res.text();
    // Lardi обмежує частоту (автоматичний обхід теж робить запити) — чекаємо і пробуємо ще
    if (res.status === 429 && patient && Date.now() > patientUntil) throw new LardiError(429, "Lardi тимчасово обмежив запити від FURA (ліміт ключа). Спробуйте через 10–15 хв.");
    if ((res.status === 429 || res.status >= 500) && tries > 1) { await sleep(res.status === 429 ? (patient ? [4000, 8000, 15000, 25000][Math.max(0, 5 - tries)] ?? 4000 : 4000) : 1500); return lardiGet(path, tries - 1); }
    if (res.status === 429) throw new LardiError(429, "Lardi тимчасово обмежив запити від FURA (ліміт ключа). Спробуйте через 10–15 хв.");
    if (!res.ok) return null;
    try { return JSON.parse(text); } catch { return null; }
}

// Усі пари «ключ → значення» з відповіді (вкладені об'єкти теж)
function walk(o: Any, out: Array<[string, Any, string]> = [], path = ""): Array<[string, Any, string]> {
    if (o && typeof o === "object") {
        for (const [k, v] of Object.entries(o)) {
            const p = path ? `${path}.${k}` : k;
            if (v && typeof v === "object") walk(v, out, p);
            else out.push([k, v, p]);
        }
    }
    return out;
}
const pick = (pairs: Array<[string, Any, string]>, rx: RegExp, ok: (v: string) => boolean = (v) => !!v.trim()) => {
    for (const [k, v, p] of pairs) {
        const tail = p.split(".").filter((x) => !/^\d+$/.test(x)).slice(-2).join(".");
        if (rx.test(k) || rx.test(tail)) { const s = String(v ?? "").trim(); if (s && ok(s)) return s; }
    }
    return "";
};

// ПІБ людей з картки (керівник, контакти) — ФОП-перевізник часто зареєстрований у Lardi на себе, а не на ТОВ
function personNames(c: Any): string[] {
    const raw: string[] = [c.director, c.contact_person_1, c.contact_person_2];
    const ex = Array.isArray(c.extra_contacts) ? c.extra_contacts : [];
    ex.forEach((x: Any) => raw.push(x?.name));
    const out: string[] = [];
    for (const r of raw) {
        const nm = String(r || "").replace(/(^|[\s,.(])(ФОП|ФО-П|ТОВ|ПП|директор|керівник|логіст|диспетчер|власник)(?=$|[\s,.)])/gi, " ").replace(/[^A-Za-zА-Яа-яІіЇїЄєҐґ'’ -]/g, " ").replace(/\s+/g, " ").trim();
        const words = nm.split(" ").filter((w) => w.length > 1);
        if (words.length < 2 || !/[А-Яа-яІіЇїЄєҐґ]/.test(nm)) continue;
        const key = words.slice(0, 3).join(" ");
        if (!out.some((o) => o.toLowerCase() === key.toLowerCase())) out.push(key);
    }
    return out.slice(0, 3);
}
// Телефони з картки (основні + додаткові контакти) — останні 9 цифр: 0503225360 / +380503225360 / 38 050 322-53-60 → 503225360
function phonesOf(c: Any): string[] {
    const raw: string[] = [c.phone_1, c.phone_2];
    (Array.isArray(c.extra_contacts) ? c.extra_contacts : []).forEach((x: Any) => raw.push(x?.phone));
    const out: string[] = [];
    for (const r of raw) for (const part of String(r || "").split(/[,;/]|\s{2,}/)) {
        const d = digitsOnly(part);
        if (d.length >= 9 && d.length <= 13) { const k = d.slice(-9); if (!out.includes(k)) out.push(k); }
    }
    return out.slice(0, 5);
}
const normWords = (v: unknown) => String(v || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-zа-яіїєґ0-9 ]/gi, " ").split(/\s+/).filter(Boolean);
// назва профілю — з верхнього рівня (а не town.name тощо)
const nameOfUser = (u: Any) => String(u?.nameWithBrand || u?.name || u?.fullName || u?.companyName || u?.firmName || "").trim() || pick(walk(u), /^(name|nameWithBrand|fullName|companyName)$/);
const cityOfUser = (u: Any) => pick(walk(u), /^(town|city|townName|cityName|locality)(\.(name|title|value))?$/i, (v) => !/^\d+$/.test(v)).toLowerCase();

async function findRef(c: Any): Promise<{ ref: string; user: Any | null; via?: Any }> {
    const m = String(c.profile_url || "").match(/user\/(\d+)/);
    if (m) return { ref: m[1], user: null };
    const code = codeKey(c.edrpou);
    // назва без «ТОВ», лапок тощо: ТОВ "АВАНТОС" → авантос
    const core = normWords(String(c.name || "").replace(/(^|[\s"«(])(ТОВ|ПП|ФОП|ФО-П|ПрАТ|ПАТ|АТ|ТзОВ|LLC|ООО|SP\.? Z O\.?O\.?)(?=$|[\s"»),.])/gi, " ")).filter((w) => w.length > 2).join(" ");
    const people = personNames(c).map((p) => normWords(p));
    const phones = phonesOf(c);
    // у профілі Lardi є наш номер телефону
    const hasPhone = (u: Any) => {
        if (!phones.length) return "";
        const d = walk(u).map(([, v]) => digitsOnly(String(v ?? ""))).join(" ");
        return phones.find((p) => d.includes(p)) || "";
    };
    // у будь-якому тексті профілю (опис діяльності, назва, примітки) — наш ЄДРПОУ, назва ТОВ або повне ПІБ
    const mentionsUs = (u: Any) => {
        const txt = " " + normWords(walk(u).map(([, v]) => (typeof v === "string" ? v : "")).join(" ")).join(" ") + " ";
        const digits = walk(u).map(([, v]) => digitsOnly(String(v ?? ""))).join(" ");
        if (code && code.length >= 8 && (digits.includes(code) || txt.includes(" " + code + " "))) return "code";
        if (core && core.length >= 4 && txt.includes(" " + core + " ")) return "name";
        if (hasPhone(u)) return "phone";
        if (people.some((pw) => pw.length >= 3 && pw.every((w) => txt.includes(" " + w + " ")))) return "person";
        return "";
    };
    for (const q of [...new Set([c.edrpou, c.name, core].filter(Boolean).map(String))]) {
        const r = await lardiGet(`/users/search?query=${encodeURIComponent(String(q))}&queryLimit=10`);
        const list: Any[] = Array.isArray(r) ? r : (r?.content || r?.users || r?.items || r?.result || []);
        if (!list.length) continue;
        // профіль згадує нас в описі — навіть якщо зареєстрований на іншу особу (ФОП керівника тощо)
        const mentioned = list.filter((u) => mentionsUs(u));
        if (mentioned.length === 1 && !list.some((u) => walk(u).some(([k, v]) => /edrpou|okpo|code|inn|tax/i.test(k) && codeKey(v) === code))) {
            const u = mentioned[0];
            const own = normWords(nameOfUser(u)).join(" ");
            const ref = u.refId ?? u.id ?? u.userId;
            if (ref && core && !own.includes(core)) {
                const why = mentionsUs(u);
                return { ref: String(ref), user: u, via: { kind: "text", person: why === "code" ? `ЄДРПОУ ${c.edrpou} в описі профілю` : why === "name" ? `назву «${c.name}» в описі профілю` : why === "phone" ? `телефон з картки в профілі` : "ПІБ з картки в описі профілю", name: nameOfUser(u), city: cityOfUser(u) ? pick(walk(u), /^(town|city|townName|cityName|locality)(\.(name|title|value))?$/i, (v) => !/^\d+$/.test(v)) : "", sameCity: false } };
            }
        }
        // збіг за ЄДРПОУ — надійний; за назвою — лише якщо знайшовся один (або один з нашим телефоном)
        const byCode = code ? list.find((u) => walk(u).some(([k, v]) => /edrpou|okpo|code|inn|tax/i.test(k) && codeKey(v) === code)) : null;
        const byPhone = list.filter((u) => hasPhone(u));
        // пошук за ЄДРПОУ, що дав рівно одну компанію, — це вона (Lardi шукає за кодом, але код не повертає)
        const u = byCode || (list.length === 1 ? list[0] : byPhone.length === 1 ? byPhone[0] : null);
        const ref = u && (u.refId ?? u.id ?? u.userId);
        if (ref) return { ref: String(ref), user: u };
    }
    // Запасний шлях 1: за номером телефону з картки (Lardi шукає фірми і за телефоном)
    for (const p of phones.slice(0, 3)) {
        for (const q of ["380" + p, "0" + p]) {
            await sleep(300);
            const r = await lardiGet(`/users/search?query=${encodeURIComponent(q)}&queryLimit=10`);
            const list: Any[] = Array.isArray(r) ? r : (r?.content || r?.users || r?.items || r?.result || []);
            if (!list.length) continue;
            const withPhone = list.filter((u) => hasPhone(u) === p);
            const u = withPhone.length === 1 ? withPhone[0] : list.length === 1 ? list[0] : null;
            const ref = u && (u.refId ?? u.id ?? u.userId);
            if (!ref) continue;
            const own = normWords(nameOfUser(u)).join(" ");
            const same = (core && own.includes(core)) || (code && walk(u).some(([k, v]) => /edrpou|okpo|code|inn|tax/i.test(k) && codeKey(v) === code));
            if (same) return { ref: String(ref), user: u };
            return { ref: String(ref), user: u, via: { kind: "phone", person: `телефон +380${p} з картки`, name: nameOfUser(u), city: cityOfUser(u) ? pick(walk(u), /^(town|city|townName|cityName|locality)(\.(name|title|value))?$/i, (v) => !/^\d+$/.test(v)) : "", sameCity: false } };
        }
    }
    // Запасний шлях 2: за ПІБ керівника / контакту (напр. ТОВ «АВАНТОС» → у Lardi «Соболівський Олексій Михайлович, ФОП»)
    const myCity = normWords(c.city).find((w) => w.length > 2) || "";
    const myRegion = normWords(c.region_ukr).find((w) => w.length > 3)?.slice(0, 5) || "";
    for (const person of personNames(c)) {
        await sleep(300);
        const r = await lardiGet(`/users/search?query=${encodeURIComponent(person)}&queryLimit=10`);
        const list: Any[] = Array.isArray(r) ? r : (r?.content || r?.users || r?.items || r?.result || []);
        const pw = normWords(person);
        // у назві профілю є всі слова ПІБ (прізвище, ім'я, по батькові)
        const hits = list.filter((u) => {
            const nw = normWords(nameOfUser(u));
            return pw.every((w) => nw.includes(w)) || (pw.length >= 3 && !!mentionsUs(u));
        });
        if (!hits.length) continue;
        const sameCity = hits.filter((u) => {
            const pairs = walk(u);
            const city = cityOfUser(u);
            const region = pick(pairs, /^(region|area|oblast|regionName|areaName)(\.(name|title|value))?$/i, (v) => !/^\d+$/.test(v)).toLowerCase();
            return (myCity && city.includes(myCity)) || (myRegion && region.includes(myRegion));
        });
        // надійно: ПІБ з 3 слів і один такий профіль, або збіг міста / області
        const u = sameCity.length === 1 ? sameCity[0] : hits.length === 1 && (pw.length >= 3 || sameCity.length) ? hits[0] : null;
        const ref = u && (u.refId ?? u.id ?? u.userId);
        if (ref) {
            const pairs = walk(u);
            return {
                ref: String(ref),
                user: u,
                via: {
                    kind: "person",
                    person,
                    name: nameOfUser(u),
                    city: cityOfUser(u) ? pick(pairs, /^(town|city|townName|cityName|locality)(\.(name|title|value))?$/i, (v) => !/^\d+$/.test(v)) : "",
                    sameCity: sameCity.includes(u),
                },
            };
        }
    }
    return { ref: "", user: null };
}

async function carrierEnrich(body: Any, row: Any = null) {
    if (!KEY) return { status: 400, data: { error: "Не задано LARDI_API_KEY у Supabase Secrets" } };
    const c = row || (await db.from("carriers").select("*").eq("id", body.carrier_id).maybeSingle()).data;
    if (!c) return { status: 404, data: { error: "Перевізника не знайдено" } };

    const { ref, user, via } = await findRef(c);
    const stamp = { lardi_checked_at: new Date().toISOString(), lardi_found: !!ref };
    if (!ref) { if ("lardi_checked_at" in c) await db.from("carriers").update(stamp).eq("id", c.id); }
    if (!ref) return { status: 200, data: { found: false, message: "У Lardi не знайшов цього перевізника (за ЄДРПОУ, назвою, телефонами і ПІБ керівника чи контактів). Якщо знаєте його профіль — вставте посилання в картку і спробуйте ще раз." } };

    // Методи профілю: беремо ті, що дає ключ (решта просто пропускаються)
    const tried: Record<string, boolean> = {};
    const parts: Any[] = user ? [user] : [];
    // Ключ Lardi дає лише пошук компаній (перевірено: /users/{id}, /contacts, /autopark — закриті)
    if (!user) {
        // профіль знайдено за посиланням — шукаємо його ж у пошуку Lardi (там є місто, область, фото)
        for (const q of [c.edrpou, c.name, ref].filter(Boolean)) {
            const r = await lardiGet(`/users/search?query=${encodeURIComponent(String(q))}&queryLimit=20`);
            const list: Any[] = Array.isArray(r) ? r : (r?.content || r?.users || r?.items || r?.result || []);
            tried[`/users/search?query=${String(q).slice(0, 20)}`] = list.length > 0;
            const u = list.find((x) => String(x.refId ?? x.id ?? x.userId) === ref);
            if (u) { parts.push(u); break; }
            await sleep(300);
        }
    }
    const pairs = parts.flatMap((p) => walk(p));

    const isUrl = (v: string) => /^(https?:)?\/\/|^\/[a-z]/i.test(v) && /\.(png|jpe?g|webp|gif)|avatar|logo|photo|image|img/i.test(v);
    const bodiesFromFleet = new Set<string>();
    const found = {
        name: pick(pairs, /^(name|nameWithBrand|fullName|companyName)$/),
        edrpou: pick(pairs, /edrpou|okpo/i, (v) => digitsOnly(v).length >= 8),
        region: pick(pairs, /^(region|area|oblast|regionName|areaName)(\.(name|title|value))?$/i, (v) => !/^\d+$/.test(v)),
        city: pick(pairs, /^(town|city|townName|cityName|locality)(\.(name|title|value))?$/i, (v) => !/^\d+$/.test(v)),
        address: pick(pairs, /^(address|street|addressLine)(\.(name|value))?$/i, (v) => !/^\d+$/.test(v)),
        director: pick(pairs, /director|chief|head(Name)?$|boss/i),
        avatar: pick(pairs, /avatar|logo|photo|image/i, isUrl),
    };
    // контакти: ім'я + телефони
    const phones: Array<{ name: string; phone: string }> = [];
    const seen = new Set<string>();
    for (const p of parts) {
        const contacts: Any[] = [];
        // ім'я — з самого контакту або з батьківського (номер часто лежить у вкладеному phones: [...])
        const visit = (o: Any, parent = "") => {
            if (!o || typeof o !== "object") return;
            if (Array.isArray(o)) return o.forEach((x) => visit(x, parent));
            const nm = String(o.face ?? o.contactName ?? o.name ?? "").trim() || parent;
            for (const [k, v] of Object.entries(o)) {
                if (/phone|tel|mobile/i.test(k) && (typeof v === "string" || typeof v === "number")) contacts.push({ name: nm, phone: String(v) });
                else if (v && typeof v === "object") visit(v, nm);
            }
        };
        visit(p);
        for (const x of contacts) {
            const d = digitsOnly(x.phone);
            if (d.length < 9) continue;
            const key = d.slice(-9);
            if (seen.has(key)) continue;
            seen.add(key);
            phones.push({ name: x.name, phone: d.length === 12 ? "+" + d : x.phone.trim() });
        }
    }

    // Контакти із заявок цього перевізника (вантажі й авто) — ім'я + телефон, як у Lardi
    for (const tb of ["lardi_trucks", "lardi_cargo"]) {
        const { data: rows } = await db.from(tb).select("owner_face, owner_phone, seen_last").eq("owner_ref", Number(ref)).order("seen_last", { ascending: false }).limit(300);
        for (const r of rows || []) {
            for (const ph of String(r.owner_phone || "").split(/[,;]/)) {
                const d = digitsOnly(ph);
                if (d.length < 9) continue;
                const key = d.slice(-9);
                if (seen.has(key)) { const x = phones.find((p) => digitsOnly(p.phone).slice(-9) === key); if (x && !x.name && r.owner_face) x.name = String(r.owner_face).trim(); continue; }
                seen.add(key);
                phones.push({ name: String(r.owner_face || "").trim(), phone: d.length === 12 ? "+" + d : d.length === 10 ? "+38" + d : ph.trim() });
            }
        }
    }

    // «Мій автопарк» у Lardi: беремо, якщо ключ дає цей метод
    const fleet: string[] = [];
    let fleetMass = 0, fleetVol = 0;

    // транспорт: заявки «авто» цього перевізника за 60 днів
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    const { data: trucks } = await db.from("lardi_trucks").select("from_country, to_country, from_region, to_region, from_town, to_town, from_zone, to_zone, mass_t, volume_m3, body_types, adr, seen_last")
        .eq("owner_ref", Number(ref)).gte("seen_last", since).limit(500);
    const tl = trucks || [];
    const bodies = new Set<string>(), countries = new Set<string>(), uaRegions = new Set<string>();
    const places = new Map<string, Set<string>>(); // країна → воєводства / міста / квадрати
    const permits = new Set<string>(); // ADR, TIR, CMR, T1, ЕКМТ…
    let mass = 0, vol = 0;
    for (const t of tl) {
        String(t.body_types || "").split(/[;,]\s*/).map((b: string) => b.trim().toUpperCase()).filter(Boolean).forEach((b: string) => bodies.add(b.replace(/^ТЕНТОВАНИЙ$/, "ТЕНТ").replace(/^РЕФРИЖЕРАТОР$/, "РЕФ")));
        for (const [cc, rg, tw, zn] of [[t.from_country, t.from_region, t.from_town, t.from_zone], [t.to_country, t.to_region, t.to_town, t.to_zone]]) {
            if (!cc || cc === "UA" || cc === "BY" || cc === "RU" || !LARDI_COUNTRY_UA[cc]) continue; // Білорусь і Росію не записуємо
            const name = LARDI_COUNTRY_UA[cc];
            countries.add(name);
            const set = places.get(name) || new Set<string>();
            // воєводство / земля / регіон; квадрат (зона), якщо Lardi його дав; інакше — місто
            const reg = String(rg || "").replace(/\s*(воєв(одство)?|обл(асть)?)\.?$/i, "").trim();
            if (reg && reg !== tw) set.add(reg);
            else if (tw) set.add(String(tw).trim());
            if (zn) set.add(`${String(zn).replace(/\D/g, "").padStart(2, "0")} кв.`);
            places.set(name, set);
        }
        for (const [cc, rg] of [[t.from_country, t.from_region], [t.to_country, t.to_region]]) if (cc === "UA" && rg && /обл/i.test(String(rg))) uaRegions.add(String(rg).replace(/\s*обл(\.|асть)?$/i, "").trim().toUpperCase() + " ОБЛ.");
        String(t.adr || "").split(/,\s*/).map((x: string) => x.trim()).filter(Boolean).forEach((x: string) => permits.add(x));
        mass = Math.max(mass, Number(t.mass_t) || 0);
        vol = Math.max(vol, Number(t.volume_m3) || 0);
    }

    // Пропозиції змін: порожнє — заповнюємо; списки — доповнюємо; заповнене не чіпаємо
    const changes: Any[] = [];
    const add = (field: string, label: string, val: string) => { // eslint-disable-line
        const old = String(c[field] ?? "").trim();
        if (!val || !(field in c) || old === val) return;
        if (old && !["trailer_type", "destinations", "ukraine_directions", "extra_contacts", "fleet_params", "additional"].includes(field)) return;
        changes.push({ field, label, old, new: val });
    };
    const profile = `https://lardi-trans.com/log/user/${ref}/`;
    // рейтинг Lardi (окремі поля — свої зірки FURA не чіпаємо)
    const lr = Number(pick(pairs, /^rating\.points$/i)) || 0;
    const lp = Number(pick(pairs, /^rating\.positiveCommentCount$/i)) || 0;
    const ln = Number(pick(pairs, /^rating\.negativeCommentCount$/i)) || 0;
    const ratingUpd: Any = "lardi_rating" in c ? { lardi_ref: Number(ref), lardi_rating: lr ? Math.round(lr * 10) / 10 : null, lardi_reviews_pos: lp, lardi_reviews_neg: ln } : {};
    if (!c.profile_url || !/\/log\/user\//.test(c.profile_url)) changes.push({ field: "profile_url", label: "Lardi / профіль", old: c.profile_url || "", new: profile });
    add("logo_url", "Фото", !found.avatar ? "" : found.avatar.startsWith("//") ? "https:" + found.avatar : found.avatar.startsWith("/") ? "https://lardi-trans.com" + found.avatar : found.avatar);
    add("director", "Директор", found.director);
    add("region_ukr", "Область", found.region ? found.region.toUpperCase().replace(/\s*ОБЛАСТЬ$/, " ОБЛ.") : "");
    add("city", "Місто / Адреса", [found.city, found.address].filter(Boolean).join(", "));
    if (!c.edrpou && found.edrpou) add("edrpou", "ЄДРПОУ", digitsOnly(found.edrpou));
    bodiesFromFleet.forEach((b) => bodies.add(b));
    if (mass || fleetMass) add("tonnage", "Тоннаж, т", String(Math.max(mass, fleetMass)));
    if (vol || fleetVol) add("volume", "Об'єм, м³", String(Math.max(vol, fleetVol)));
    if (fleet.length) {
        const old = String(c.fleet_params || "").trim();
        const next = [`Автопарк Lardi (${fleet.length}):`, ...fleet].join("\n");
        if ("fleet_params" in c && old !== next) changes.push({ field: "fleet_params", label: "Автопарк", old, new: next });
    }
    const mergeList = (field: string, label: string, items: Set<string>, keyOf = (x: string) => x.split("-")[0].trim().toUpperCase()) => {
        const cur = String(c[field] || "").split(";").map((x: string) => x.trim()).filter(Boolean);
        const have = new Set(cur.map(keyOf));
        const extra = [...items].filter((x) => !have.has(keyOf(x)));
        if (extra.length) changes.push({ field, label, old: cur.join(";"), new: [...cur, ...extra].join(";"), added: extra });
    };
    mergeList("trailer_type", "Тип причепу", bodies);
    // дозволи — у «Додатково» (через кому, без повторів)
    if (permits.size && "additional" in c) {
        const cur = String(c.additional || "").split(/[,;]\s*/).map((x: string) => x.trim()).filter(Boolean);
        const low = new Set(cur.map((x: string) => x.toLowerCase().replace(/\?$/, "")));
        const extra = [...permits].filter((x) => !low.has(x.toLowerCase()));
        if (extra.length) changes.push({ field: "additional", label: "Дозволи (ADR, TIR…)", old: cur.join(", "), new: [...cur.filter((x: string) => x !== "ADR?"), ...extra].join(", "), added: extra });
    }
    // Закордон: «КРАЇНА - регіон, регіон; …» — доповнюємо і країни, і регіони в них
    {
        const cur = String(c.destinations || "").split(";").map((x: string) => x.trim()).filter(Boolean);
        const map = new Map<string, string[]>();
        for (const e of cur) {
            const i = e.indexOf("-");
            const cn = normCountry(i >= 0 ? e.slice(0, i) : e);
            const rg = i >= 0 ? e.slice(i + 1).split(",").map((x) => x.trim()).filter(Boolean) : [];
            map.set(cn, [...(map.get(cn) || []), ...rg.filter((r) => !(map.get(cn) || []).some((x) => x.toLowerCase() === r.toLowerCase()))]);
        }
        const added: string[] = [];
        for (const cn of countries) {
            const have = map.get(cn);
            const low = new Set((have || []).map((x) => x.toLowerCase()));
            const fresh = [...(places.get(cn) || [])].filter((x) => !low.has(x.toLowerCase()));
            if (!have) { map.set(cn, fresh); added.push(fresh.length ? `${cn} (${fresh.join(", ")})` : cn); }
            else if (fresh.length) { map.set(cn, [...have, ...fresh]); added.push(`${cn}: ${fresh.join(", ")}`); }
        }
        if (added.length) changes.push({ field: "destinations", label: "Напрямки закордон", old: cur.join(";"),
            new: [...map].map(([cn, rg]) => (rg.length ? `${cn} - ${rg.join(", ")}` : cn)).join(";"), added });
    }
    mergeList("ukraine_directions", "Напрямки в Україні", uaRegions, (x) => x.trim().toUpperCase());
    // телефони, яких ще немає в картці
    const haveP = new Set([c.phone_1, c.phone_2, ...(Array.isArray(c.extra_contacts) ? c.extra_contacts.map((x: Any) => x?.phone) : [])]
        .flatMap((v) => String(v || "").split(/[,;]/)).map((v) => digitsOnly(v).slice(-9)).filter((v) => v.length === 9));
    const newPh = phones.filter((p) => !haveP.has(digitsOnly(p.phone).slice(-9)));
    // телефон уже є, а підпису нема — підписуємо ім'ям з Lardi
    // підпис «Офіс» / «Власник» / порожній — замінюємо справжнім ім'ям з Lardi
    const GENERIC = /^(власник|офіс|офис|office|контакт|телефон|тел\.?|диспетчер|приймальня|менеджер|логіст|ai\s*звіт|звіт|замовлення|повідомлення)?\s*(\(.*\))?\s*:?\s*$/i; // «Власник (ФОП)», «Офіс», порожній
    const extras: Any[] = Array.isArray(c.extra_contacts) ? c.extra_contacts : [];
    const renamed = extras.map((x: Any) => {
        const k = digitsOnly(x?.phone).slice(-9);
        const y = k && GENERIC.test(String(x?.name || "").trim()) && phones.find((p) => p.name && !GENERIC.test(p.name) && digitsOnly(p.phone).slice(-9) === k);
        return y ? { ...x, name: y.name } : x;
    });
    if (renamed.some((x: Any, i: number) => x !== extras[i])) changes.push({ field: "extra_contacts", label: "Імена до телефонів", old: extras.map((x: Any) => `${x?.name || "—"}: ${x?.phone}`).join("; "), new: renamed.map((x: Any) => `${x?.name || "—"}: ${x?.phone}`).join("; "), value: renamed });
    for (const n of [1, 2]) {
        const ph = digitsOnly(c[`phone_${n}`]).slice(-9);
        const nm = String(c[`contact_person_${n}`] || "").trim();
        if (!ph || !GENERIC.test(nm)) continue;
        const x = phones.find((p) => p.name && !GENERIC.test(p.name) && digitsOnly(p.phone).slice(-9) === ph);
        if (x && x.name !== nm) changes.push({ field: `contact_person_${n}`, label: `Підпис телефону ${n}`, old: nm, new: x.name });
    }
    if (newPh.length) changes.push({ field: "contacts", label: "Нові телефони", old: "", new: newPh.map((p) => `${p.name ? p.name + ": " : ""}${p.phone}`).join("; "), phones: newPh });

    if (body.apply) {
        const want = new Set<string>(Array.isArray(body.fields) ? body.fields : changes.map((x) => x.field));
        const upd: Any = { ...ratingUpd, ...("lardi_checked_at" in c ? stamp : {}) };
        for (const ch of changes) {
            if (!want.has(ch.field)) continue;
            if (ch.field === "extra_contacts") { upd.extra_contacts = [...ch.value, ...(Array.isArray(upd.extra_contacts) ? upd.extra_contacts.slice(extras.length) : [])]; continue; }
            if (ch.field !== "contacts") { upd[ch.field] = ch.new; continue; }
            const list = [...ch.phones];
            if (!c.phone_1 && list.length) { const p = list.shift(); upd.phone_1 = p.phone; if (!c.contact_person_1 && p.name) upd.contact_person_1 = p.name; }
            if (!c.phone_2 && list.length) { const p = list.shift(); upd.phone_2 = p.phone; if (!c.contact_person_2 && p.name) upd.contact_person_2 = p.name; }
            if (list.length && "extra_contacts" in c) upd.extra_contacts = [...(Array.isArray(upd.extra_contacts) ? upd.extra_contacts : extras), ...list];
        }
        if (!Object.keys(upd).length) return { status: 200, data: { applied: 0 } };
        const { error } = await db.from("carriers").update(upd).eq("id", c.id);
        if (error) return { status: 500, data: { error: error.message } };
        const real = Object.keys(upd).filter((k) => !/^lardi_/.test(k));
        return { status: 200, data: { applied: real.length, fields: real } };
    }
    return {
        status: 200,
        data: {
            found: true, ref, profile, changes, trucks: tl.length, via: via || null,
            // для налаштування: які методи Lardi відповіли і які поля прийшли
            debug: { endpoints: tried, sample: pairs.slice(0, 60).map(([, v, p]) => `${p} = ${String(v).slice(0, 60)}`), keys: [...new Set(pairs.map(([, , p]) => p.replace(/\.\d+\./g, ".*.")))].slice(0, 120) },
        },
    };
}

/* Обхід усіх перевізників FURA порціями (розклад): спершу ті, кого ще не перевіряли,
   далі — перевірені понад 7 днів тому. Записує одразу (лише порожнє й нове). */
// Пауза обходу: вручну («⏸ Пауза») або поки людина сама працює з Lardi (15 хв після дії)
const QUIET_MS = 15 * 60000;
async function pauseState() {
    const { data } = await db.from("lardi_pause").select("*").eq("id", 1).maybeSingle();
    return data || null;
}
async function touchActivity() {
    try { await db.from("lardi_pause").upsert({ id: 1, last_activity: new Date().toISOString() }); } catch { /* таблиці ще нема */ }
}
async function enrichTick(limit: number) {
    const ps = await pauseState().catch(() => null);
    const now = Date.now();
    if (ps?.paused_until && new Date(ps.paused_until).getTime() > now) return { ok: true, skipped: `пауза до ${ps.paused_until}` };
    if (ps?.last_activity && now - new Date(ps.last_activity).getTime() < QUIET_MS) return { ok: true, skipped: "людина працює з Lardi — чекаємо" };
    const week = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: list, error } = await db.from("carriers").select("*")
        .or(`lardi_checked_at.is.null,lardi_checked_at.lt.${week}`)
        .order("lardi_checked_at", { ascending: true, nullsFirst: true }).order("id").limit(limit);
    if (error) return { error: error.message };
    let done = 0, found = 0, updated = 0;
    const started = Date.now();
    for (const c of list || []) {
        if (Date.now() - started > 120000) break; // не довше 2 хв за раз
        try {
            const r = await carrierEnrich({ apply: true }, c);
            done++;
            if (r.data?.applied !== undefined || r.data?.found !== false) found += r.data?.found === false ? 0 : 1;
            if ((r.data?.applied || 0) > 0) updated++;
        } catch (e) {
            if (e instanceof LardiError && e.status === 429) break; // Lardi просить паузу — продовжимо наступного разу
            await db.from("carriers").update({ lardi_checked_at: new Date().toISOString() }).eq("id", c.id);
        }
        await sleep(1200);
    }
    const { count: left } = await db.from("carriers").select("id", { count: "exact", head: true }).is("lardi_checked_at", null);
    return { ok: true, done, found, updated, left_unchecked: left ?? null };
}

/* Скріншот профілю Lardi → текст (Claude читає картинку). Далі текст розбирає сайт (lardi-enrich.js) */
const AI_KEY = env("ANTHROPIC_API_KEY");
const OCR_MODEL = env("LARDI_OCR_MODEL", "claude-sonnet-5-5");
async function ocrScreens(body: Any) {
    if (!AI_KEY) return { status: 400, data: { error: "Не задано ANTHROPIC_API_KEY у Supabase Secrets" } };
    const imgs = (Array.isArray(body.images) ? body.images : []).slice(0, 4)
        .filter((i: Any) => /^image\/(png|jpeg|webp|gif)$/.test(i?.media_type) && typeof i?.data === "string" && i.data.length < 7_000_000);
    if (!imgs.length) return { status: 400, data: { error: "Немає картинки" } };
    const prompt = `Це скріншот(и) профілю перевізника на сайті Lardi-Trans. Перепиши з них дані ПРОСТИМ ТЕКСТОМ, кожен пункт з нового рядка, нічого не вигадуй і не пропускай:
- контакти: «Ім'я Прізвище +380XXXXXXXXX» (кожна особа з її телефоном в одному рядку; якщо телефонів кілька — кожен окремим рядком з тим самим ім'ям);
- адреса: «Місто, Область обл., Україна» і в наступному рядку вулицю;
- реєстраційні дані: «Мітка: значення» (ЄДРПОУ:, ПІБ керівника:, Область:, Місто:, Адреса:, Тип реєстрації:, Дата реєстрації на Ларді-Транс:, Профіль діяльності:);
- автопарк: рядок «Усього авто N», далі кожна машина з нового рядка («Вантажівка VOLVO», «Тент», «Власний»…);
- відгуки: для кожного відгуку рядок «дд.мм.рррр КОДИ_КРАЇН_ЗВІДКИ - КОДИ_КРАЇН_КУДИ Місто - Місто», напр. «09.09.2026 UA - RO Хмельницький - Сучава».
Лише текст, без пояснень і без markdown.`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
            model: OCR_MODEL, max_tokens: 4000,
            messages: [{ role: "user", content: [...imgs.map((i: Any) => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })), { type: "text", text: prompt }] }],
        }),
    });
    const data = await res.json();
    if (!res.ok) return { status: 502, data: { error: `Не вдалося прочитати скріншот (${res.status}: ${data?.error?.message || "помилка"})`.slice(0, 300) } };
    const text = (data.content || []).filter((b: Any) => b.type === "text").map((b: Any) => b.text).join("").trim();
    return { status: 200, data: { text } };
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return new Response("FURA Lardi monitor is running");
    const url = new URL(req.url);

    let body: Any;
    try { body = await req.json(); } catch { return json(400, { error: "bad request" }); }

    try {
        if (body.action === "enrich_tick") {
            if (!secretOk(req, url)) return json(403, { error: "forbidden" });
            return json(200, await enrichTick(Math.max(1, Math.min(60, Number(body.limit) || 30))));
        }
        if (body.action === "tick") {
            if (!secretOk(req, url)) return json(403, { error: "forbidden" });
            // body.kind: "cargo" (вантажі) або "truck" (машини); body.stale_hours — оновлювати напрямки, старші за N год
            const kind: Kind = body.kind === "truck" ? "truck" : "cargo";
            const hours = Math.max(0, Math.min(48, Number(body.stale_hours ?? 0) || 0));
            if (hours > 0) {
                const LAST = kind === "truck" ? "truck_last_run_at" : "last_run_at";
                const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
                const { count } = await db.from("lardi_directions").select("id", { count: "exact", head: true })
                    .eq("active", true).or(`${LAST}.is.null,${LAST}.lt.${cutoff}`);
                if (!count) return json(200, { ok: true, skipped: "усі напрямки свіжі" });
            }
            return json(200, await run("cron", kind === "truck" ? "розклад · авто" : "розклад · вантажі", "", "", kind, hours * 3600000));
        }

        const me = await staffFromRequest(req);
        if (!me) return json(403, { error: "Вас немає серед співробітників FURA" });

        if (["run", "carrier_enrich", "ocr", "activity"].includes(body.action)) await touchActivity();

        switch (body.action) {
            case "activity":
                return json(200, { ok: true });
            case "pause": {
                const min = Math.max(0, Math.min(480, Number(body.minutes) || 0));
                const until = min ? new Date(Date.now() + min * 60000).toISOString() : null;
                const { error } = await db.from("lardi_pause").upsert({ id: 1, paused_until: until, paused_by: min ? (me.full_name || me.email || "") : null });
                if (error) return json(500, { error: "Запустіть lardi_pause.sql у Supabase: " + error.message });
                return json(200, { ok: true, paused_until: until });
            }
            case "run":
            {
                const cc = (v: unknown) => String(v || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
                const kind: Kind = body.kind === "truck" ? "truck" : "cargo";
                return json(200, await run("manual", me.full_name || me.email || "співробітник", cc(body.from), cc(body.to), kind));
            }
            case "directions": {
                if (!isBoss(me)) return json(403, { error: "Напрямки змінює лише керівник" });
                const out = await directions(body);
                return json(out.status, out.data);
            }
            case "carrier_enrich": {
                patient = true;
                patientUntil = Date.now() + 45000;
                const out = await carrierEnrich(body);
                return json(out.status, out.data);
            }
            case "ocr": {
                const out = await ocrScreens(body);
                return json(out.status, out.data);
            }
            case "enrich_status": {
                const q = (f: (x: Any) => Any) => f(db.from("carriers").select("id", { count: "exact", head: true }));
                const [all, checked, found] = await Promise.all([q((x) => x), q((x) => x.not("lardi_checked_at", "is", null)), q((x) => x.eq("lardi_found", true))]);
                return json(200, { all: all.count, checked: checked.count, found: found.count });
            }
            case "status":
                return json(200, { key: !!KEY, cron: !!CRON_SECRET, boss: isBoss(me), pageSize: PAGE_SIZE, maxPages: MAX_PAGES });
            default:
                return json(400, { error: "unknown action" });
        }
    } catch (e) {
        console.error(e);
        if (e instanceof LardiError) return json(e.status === 429 ? 429 : 502, { error: e.message });
        return json(500, { error: "Помилка сервера: " + String((e as Error)?.message || e).slice(0, 200) });
    }
});
