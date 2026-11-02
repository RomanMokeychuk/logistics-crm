// FURA — кабінети клієнта і перевізника (Supabase Edge Function "fura-portal")
//
// Клієнти й перевізники не мають акаунтів Supabase і не читають таблиці напряму:
// кабінет (cabinet.html) звертається тільки сюди, а функція віддає лише дозволені поля.
//
//   Клієнт бачить:     свої запити й перевезення, статуси, ціну Грандар, номер авто й водія.
//                      Не бачить: перевізника, його ставку, маржу, чужі запити, нотатки логістів.
//   Перевізник бачить: запропоновані йому рейси (без клієнта й адрес), свої ставки, свої рейси з адресами.
//                      Не бачить: клієнта, ціну клієнта, ставки інших.
//
// Вхід:   Telegram (Mini App, перевізник, підключений до бота) · посилання-запрошення від менеджера ·
//         код на e-mail (коли налаштовано Resend).
// Секрети: TELEGRAM_BOT_TOKEN (вже є) · необов'язково APP_URL, RESEND_API_KEY + PORTAL_FROM (код на e-mail)
// Розгортання: Edge Functions → fura-portal → вставити код → Deploy; «Verify JWT» — ВИМКНУТИ.

import { createClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Any = any;

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const BOT_TOKEN = env("TELEGRAM_BOT_TOKEN");
const APP_URL = env("APP_URL", "https://romanmokeychuk.github.io/logistics-crm").replace(/\/$/, "");
const RESEND_KEY = env("RESEND_API_KEY");
const MAIL_FROM = env("PORTAL_FROM") || env("SALES_FROM");
const COMPANY = env("COMPANY_NAME", "Грандар");

const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const DAY = 86400000;

const CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-portal-token",
    "access-control-allow-methods": "POST, OPTIONS",
};

class Fail extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}
const fail = (status: number, message: string): never => {
    throw new Fail(status, message);
};

/* ------------------------------------------------------------------ */
/* Допоміжні                                                           */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
async function sha256(s: string) {
    return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
}
function randomToken(bytes = 32) {
    const b = crypto.getRandomValues(new Uint8Array(bytes));
    return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const nowIso = () => new Date().toISOString();
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();
function str(v: unknown, max = 300): string | null {
    const s = String(v ?? "").trim().slice(0, max);
    return s || null;
}
function isoDate(v: unknown): string | null {
    const s = String(v ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function num(v: unknown): number | null {
    const n = Number(String(v ?? "").replace(",", ".").replace(/\s/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
}
const plate = (v: unknown) =>
    String(v ?? "")
        .toUpperCase()
        .replace(/[\s-]/g, "")
        .replace(/[АВСЕНІКМОРТХ]/g, (c) => "ABCEHIKMOPTX"["АВСЕНІКМОРТХ".indexOf(c)]);
const likeSafe = (s: string) => s.replace(/[%_\\]/g, "\\$&");
const esc = (v: unknown) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const CURRENCIES = ["EUR", "USD", "UAH"];

function ipOf(req: Request) {
    return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "";
}

async function log(accountId: string | null, action: string, details: Any, ip: string) {
    await db.from("portal_log").insert({ account_id: accountId, action, details: details ?? null, ip: ip || null });
}

// Захист від перебору й спаму: не більше max подій за хвилини з однієї адреси / акаунта
async function limit(field: "ip" | "account_id", value: string, action: string, max: number, minutes: number) {
    if (!value) return;
    const { count } = await db
        .from("portal_log")
        .select("id", { count: "exact", head: true })
        .eq(field, value)
        .eq("action", action)
        .gte("at", new Date(Date.now() - minutes * 60000).toISOString());
    if ((count ?? 0) >= max) fail(429, "Забагато спроб. Спробуйте трохи пізніше.");
}

async function tgSend(chatId: number | string | null | undefined, text: string, url?: string) {
    if (!BOT_TOKEN || !chatId) return;
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                chat_id: Number(chatId),
                text,
                parse_mode: "HTML",
                disable_web_page_preview: true,
                ...(url ? { reply_markup: { inline_keyboard: [[{ text: "Відкрити в CRM", url }]] } } : {}),
            }),
        });
    } catch (e) {
        console.error("telegram:", e);
    }
}

async function notifyStaff(ids: unknown[], text: string, url?: string) {
    const list = [...new Set(ids.filter(Boolean).map(String))];
    if (!list.length) return;
    const { data } = await db.from("staff").select("telegram_chat_id, active").in("id", list);
    for (const s of data || []) if (s.active && s.telegram_chat_id) await tgSend(s.telegram_chat_id, text, url);
}
async function headIds(): Promise<string[]> {
    const { data } = await db.from("staff").select("id, role, roles, active").eq("active", true);
    return (data || [])
        .filter((s: Any) => (Array.isArray(s.roles) ? s.roles : [s.role]).includes("head"))
        .map((s: Any) => String(s.id));
}

let botUser = "";
async function botUsername() {
    if (botUser || !BOT_TOKEN) return botUser;
    try {
        const r = await (await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`)).json();
        botUser = r?.result?.username || "";
    } catch {
        /* немає — кнопка «Увійти через Telegram» просто не з'явиться */
    }
    return botUser;
}

/* ------------------------------------------------------------------ */
/* Сесії                                                               */
/* ------------------------------------------------------------------ */

async function companyOf(a: Any) {
    if (a.kind === "client") {
        const { data } = await db.from("leads").select("id, name, sales, sales_id").eq("id", a.lead_id).maybeSingle();
        return data;
    }
    const { data } = await db.from("carriers").select("id, name, edrpou").eq("id", a.carrier_id).maybeSingle();
    return data;
}

async function publicAccount(a: Any) {
    const c = await companyOf(a);
    return { kind: a.kind, name: a.name || null, company: c?.name || "—", manager: a.kind === "client" ? c?.sales || null : null };
}

async function newSession(a: Any, ip: string, via: string) {
    const token = randomToken();
    await db.from("portal_tokens").insert({ hash: await sha256(token), account_id: a.id, purpose: "session", expires_at: inDays(SESSION_DAYS) });
    await db.from("portal_accounts").update({ last_login_at: nowIso() }).eq("id", a.id);
    // Прибрати прострочене
    await db.from("portal_tokens").delete().eq("account_id", a.id).lt("expires_at", nowIso());
    await log(a.id, "login", { via }, ip);
    return { token, account: await publicAccount(a) };
}

async function sessionAccount(req: Request) {
    const token = req.headers.get("x-portal-token") || "";
    if (token.length < 20) fail(401, "Увійдіть ще раз.");
    const { data: t } = await db
        .from("portal_tokens")
        .select("account_id, expires_at")
        .eq("hash", await sha256(token))
        .eq("purpose", "session")
        .maybeSingle();
    if (!t || t.expires_at < nowIso()) fail(401, "Сесія завершилась — увійдіть ще раз.");
    const { data: a } = await db.from("portal_accounts").select("*").eq("id", t!.account_id).maybeSingle();
    if (!a || !a.active) fail(401, "Доступ вимкнено. Зверніться до вашого менеджера Грандар.");
    return a;
}

/* ------------------------------------------------------------------ */
/* Вхід                                                                */
/* ------------------------------------------------------------------ */

async function hmac(key: Uint8Array, data: string) {
    const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
async function verifyInitData(initData: string): Promise<number | null> {
    if (!initData || !BOT_TOKEN) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    const pairs: string[] = [];
    params.forEach((v, k) => k !== "hash" && pairs.push(`${k}=${v}`));
    pairs.sort();
    const secret = await hmac(enc.encode("WebAppData"), BOT_TOKEN);
    if (toHex(await hmac(secret, pairs.join("\n"))) !== hash) return null;
    const authDate = Number(params.get("auth_date") || 0);
    if (!authDate || Date.now() / 1000 - authDate > 24 * 3600) return null;
    try {
        const u = JSON.parse(params.get("user") || "{}");
        return u.id ? Number(u.id) : null;
    } catch {
        return null;
    }
}

async function loginTelegram(body: Any, ip: string) {
    await limit("ip", ip, "login_fail", 20, 15);
    const tgId = await verifyInitData(String(body.initData || ""));
    if (!tgId) {
        await log(null, "login_fail", { via: "telegram" }, ip);
        fail(403, "Не вдалося перевірити Telegram. Відкрийте кабінет кнопкою в боті ще раз.");
    }
    // Уже є доступ з цього Telegram
    const { data: acc } = await db.from("portal_accounts").select("*").eq("tg_chat_id", tgId).eq("active", true).limit(1);
    if (acc?.length) return newSession(acc[0], ip, "telegram");

    // Перевізник, підключений до бота (посилання-запрошення від логіста)
    const { data: c } = await db.from("carriers").select("id, name").eq("tg_chat_id", tgId).limit(1);
    if (c?.length) {
        const { data: old } = await db.from("portal_accounts").select("*").eq("kind", "carrier").eq("carrier_id", String(c[0].id)).is("tg_chat_id", null).eq("active", true).limit(1);
        if (old?.length) {
            await db.from("portal_accounts").update({ tg_chat_id: tgId }).eq("id", old[0].id);
            return newSession({ ...old[0], tg_chat_id: tgId }, ip, "telegram");
        }
        const { data: created, error } = await db
            .from("portal_accounts")
            .insert({ kind: "carrier", carrier_id: String(c[0].id), tg_chat_id: tgId, name: null })
            .select("*")
            .single();
        if (error) fail(500, "Не вдалося створити доступ. Спробуйте ще раз.");
        return newSession(created, ip, "telegram");
    }
    await log(null, "login_fail", { via: "telegram", tg: tgId }, ip);
    fail(403, `Цей Telegram ще не підключено до ${COMPANY}. Попросіть логіста надіслати вам посилання-запрошення в бот.`);
}

async function loginInvite(body: Any, ip: string) {
    await limit("ip", ip, "login_fail", 20, 15);
    const token = String(body.token || "");
    const { data: t } = token.length >= 20
        ? await db.from("portal_tokens").select("*").eq("hash", await sha256(token)).eq("purpose", "invite").maybeSingle()
        : { data: null };
    if (!t || t.expires_at < nowIso()) {
        await log(null, "login_fail", { via: "invite" }, ip);
        fail(403, "Посилання недійсне або прострочене. Попросіть у менеджера нове.");
    }
    const { data: a } = await db.from("portal_accounts").select("*").eq("id", t!.account_id).maybeSingle();
    if (!a?.active) fail(403, "Доступ вимкнено. Зверніться до вашого менеджера.");
    await db.from("portal_tokens").update({ used_count: (t!.used_count || 0) + 1 }).eq("hash", t!.hash);
    return newSession(a, ip, "invite");
}

async function emailCode(body: Any, ip: string) {
    if (!RESEND_KEY || !MAIL_FROM) fail(503, "Вхід за e-mail ще не налаштовано. Попросіть у менеджера посилання для входу.");
    await limit("ip", ip, "email_code", 5, 15);
    const email = String(body.email || "").trim().toLowerCase();
    await log(null, "email_code", { email }, ip);
    const generic = { ok: true, message: "Якщо ця адреса є в нас, код уже надіслано. Перевірте пошту (і «Спам»)." };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return generic;
    const { data: acc } = await db.from("portal_accounts").select("*").eq("email", email).eq("active", true).limit(1);
    const a = acc?.[0];
    if (!a) return generic;
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    await db.from("portal_tokens").delete().eq("account_id", a.id).eq("purpose", "code");
    await db.from("portal_tokens").insert({ hash: await sha256(`${a.id}:${code}`), account_id: a.id, purpose: "code", expires_at: new Date(Date.now() + 10 * 60000).toISOString() });
    await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
            from: MAIL_FROM,
            to: [email],
            subject: `Код для входу в кабінет ${COMPANY}: ${code}`,
            text: `Ваш код для входу в кабінет ${COMPANY}: ${code}\n\nКод дійсний 10 хвилин. Якщо ви не намагалися увійти — просто проігноруйте цей лист.`,
        }),
    });
    return generic;
}

async function emailVerify(body: Any, ip: string) {
    await limit("ip", ip, "login_fail", 10, 15);
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").replace(/\D/g, "");
    const { data: acc } = await db.from("portal_accounts").select("*").eq("email", email).eq("active", true);
    for (const a of acc || []) {
        const { data: t } = await db.from("portal_tokens").select("*").eq("account_id", a.id).eq("purpose", "code").maybeSingle();
        if (!t || t.expires_at < nowIso() || t.attempts >= 5) continue;
        if (t.hash === (await sha256(`${a.id}:${code}`))) {
            await db.from("portal_tokens").delete().eq("hash", t.hash);
            return newSession(a, ip, "email");
        }
        await db.from("portal_tokens").update({ attempts: t.attempts + 1 }).eq("hash", t.hash);
    }
    await log(null, "login_fail", { via: "email", email }, ip);
    fail(403, "Код неправильний або прострочений. Запросіть новий.");
}

/* ------------------------------------------------------------------ */
/* Що показуємо: статуси, суми                                          */
/* ------------------------------------------------------------------ */

const TRIP_STAGE: Record<string, [string, number]> = {
    assigned: ["Машину призначено", 1],
    confirmed: ["Машину призначено", 1],
    to_loading: ["Їде на завантаження", 2],
    at_loading: ["На завантаженні", 2],
    loaded: ["В дорозі", 3],
    at_border: ["На кордоні", 4],
    crossed_border: ["Пройшов кордон", 4],
    at_unloading: ["На розвантаженні", 5],
    unloaded: ["Доставлено", 6],
};
const EVENT_LABELS: Record<string, string> = {
    assigned: "Машину призначено",
    confirmed: "Водій підтвердив рейс",
    arrived_loading: "Прибув на завантаження",
    loaded: "Завантажено, виїхав",
    arrived_border: "Прибув на кордон",
    crossed_border: "Пройшов кордон",
    arrived_unloading: "Прибув на розвантаження",
    unloaded: "Розвантажено",
    cancelled: "Рейс скасовано",
};

function dealStage(d: Any, trip: Any, queue: Any) {
    const today = new Date().toISOString().slice(0, 10);
    if (d.unload_date) return { key: "done", label: "Доставлено", step: 6 };
    if (trip && TRIP_STAGE[trip.status]) {
        const [label, step] = TRIP_STAGE[trip.status];
        return { key: step >= 6 ? "done" : step >= 2 ? "road" : "plan", label, step };
    }
    if (queue) return { key: "road", label: "На кордоні", step: 4 };
    if (d.load_date) return { key: "road", label: "В дорозі", step: 3 };
    if (d.load_date_plan && String(d.load_date_plan).slice(0, 10) < today) return { key: "road", label: "Очікує завантаження", step: 2 };
    return { key: "plan", label: "Заплановано", step: 1 };
}

// Сума по стороні угоди: in — клієнт платить Грандар, out — Грандар платить перевізнику
function sideSum(d: Any, side: "in" | "out") {
    const by: Record<string, number> = {};
    for (const r of Array.isArray(d.services) ? d.services : []) {
        const v = (Number(r.qty) || 1) * (Number(String(r[`${side}_rate`] ?? "").replace(",", ".")) || 0);
        if (!v) continue;
        const cur = r[`${side}_cur`] || "EUR";
        by[cur] = (by[cur] || 0) + v;
    }
    return Object.entries(by).map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));
}

async function tripsFor(deals: Any[]) {
    const ids = deals.map((d) => d.id);
    const map = new Map<string, Any>();
    if (!ids.length) return map;
    const { data } = await db.from("trips").select("id, deal_id, status, trip_no, created_at, last_lat, last_lon, last_point_at, load_lat, load_lon, unload_lat, unload_lon, eta_at").in("deal_id", ids).order("created_at", { ascending: true });
    for (const t of data || []) if (!["cancelled", "declined"].includes(t.status)) map.set(String(t.deal_id), t);
    return map;
}
async function queueFor(deals: Any[]) {
    const plates = [...new Set(deals.filter((d) => !d.unload_date && d.truck_plate).map((d) => plate(d.truck_plate)))];
    const map = new Map<string, Any>();
    if (!plates.length) return map;
    const { data } = await db.from("echerha_queue").select("tractor, checkpoint, queue_no, reg_at, entry_at").in("tractor", plates);
    for (const q of data || []) map.set(plate(q.tractor), { checkpoint: String(q.checkpoint || "").replace(/\s*\(.*\)\s*$/, ""), queue_no: q.queue_no, since: q.reg_at, entry: q.entry_at });
    return map;
}

function routeOf(x: Any, withAddress: boolean) {
    return {
        load_country: x.load_country || null,
        load_address: withAddress ? x.load_address || null : null,
        unload_country: x.unload_country || null,
        unload_address: withAddress ? x.unload_address || null : null,
        customs_export: x.customs_export || null,
        customs_export_country: x.customs_export_country || null,
        customs_import: x.customs_import || null,
        customs_import_country: x.customs_import_country || null,
        border_crossing: x.border_crossing || null,
    };
}

async function shapeDeals(deals: Any[], side: "in" | "out") {
    const [trips, queue] = await Promise.all([tripsFor(deals), queueFor(deals)]);
    return deals.map((d) => {
        const trip = trips.get(String(d.id));
        const q = d.truck_plate ? queue.get(plate(d.truck_plate)) : null;
        return {
            id: d.id,
            number: d.number,
            route: routeOf(d, true),
            cargo: d.cargo || null,
            trailer_type: d.trailer_type || null,
            load_date_plan: d.load_date_plan || null,
            load_date: d.load_date || null,
            unload_date_plan: d.unload_date_plan || null,
            unload_date: d.unload_date || null,
            stage: dealStage(d, trip, q),
            truck_plate: d.truck_plate || null,
            trailer_plate: d.trailer_plate || null,
            driver_name: d.driver_name || null,
            driver_phone: d.driver_phone || null,
            sum: sideSum(d, side),
            paid: side === "in" ? !!d.paid_by_client : !!d.paid_to_carrier,
            manager: { name: d.logist_name || null, phone: d.logist_phone || null },
            queue: q || null,
            has_trip: !!trip,
            // Для загальної карти: де машина зараз, точки A і B
            pos: trip
                ? {
                      last: trip.last_lat != null ? [trip.last_lat, trip.last_lon, trip.last_point_at] : null,
                      load: trip.load_lat != null ? [trip.load_lat, trip.load_lon] : null,
                      unload: trip.unload_lat != null ? [trip.unload_lat, trip.unload_lon] : null,
                      eta_at: trip.eta_at || null,
                  }
                : null,
        };
    });
}

// Статус запиту — так, як його бачить клієнт
function clientStatus(r: Any) {
    if (r.status === "Відмова") return { key: "cancelled", label: "Скасовано" };
    if (r.client_decision === "accepted") return { key: "accepted", label: "Ви погодили — оформлюємо перевезення" };
    if (r.client_price && r.client_decision === "discuss") return { key: "discuss", label: "Обговорюємо умови" };
    if (r.client_price) return { key: "offer", label: "Є пропозиція — погодьте" };
    if (r.status === "В роботі") return { key: "search", label: "Шукаємо машину" };
    if (r.status === "Відповідь") return { key: "quote", label: "Прораховуємо" };
    return { key: "new", label: "Прийнято" };
}

/* ------------------------------------------------------------------ */
/* Клієнт                                                              */
/* ------------------------------------------------------------------ */

const REQ_FIELDS =
    "id, created_at, status, client_price, client_currency, client_price_note, client_price_at, client_decision, client_decision_at, " +
    "load_country, load_address, unload_country, unload_address, customs_export, customs_export_country, customs_import, " +
    "customs_import_country, border_crossing, cargo, weight, transport_type, desired_date, desired_date_to, trucks_count, source";

function shapeRequest(r: Any) {
    return {
        id: r.id,
        created_at: r.created_at,
        status: clientStatus(r),
        route: routeOf(r, true),
        cargo: r.cargo || null,
        weight: r.weight || null,
        transport_type: r.transport_type || null,
        desired_date: r.desired_date || null,
        desired_date_to: r.desired_date_to || null,
        trucks_count: r.trucks_count || null,
        from_cabinet: r.source === "portal",
        offer: r.client_price ? { price: Number(r.client_price), currency: r.client_currency || "EUR", note: r.client_price_note || null, at: r.client_price_at } : null,
        decision: r.client_decision ? { value: r.client_decision, at: r.client_decision_at } : null,
    };
}

async function clientHome(a: Any) {
    const [reqs, deals] = await Promise.all([
        db.from("requests").select(REQ_FIELDS).eq("lead_id", a.lead_id).order("created_at", { ascending: false }).limit(100),
        db.from("deals").select("*").eq("lead_id", a.lead_id).order("number", { ascending: false }).limit(200),
    ]);
    const { data: unread } = await db.from("portal_messages").select("deal_id, request_id").eq("party", "client").eq("lead_id", String(a.lead_id)).eq("direction", "out").is("read_at", null);
    const count = (k: string, id: unknown) => (unread || []).filter((m: Any) => String(m[k]) === String(id)).length;
    return {
        account: await publicAccount(a),
        requests: (reqs.data || []).map((r: Any) => ({ ...shapeRequest(r), unread: count("request_id", r.id) })),
        deals: (await shapeDeals(deals.data || [], "in")).map((d: Any) => ({ ...d, unread: count("deal_id", d.id) })),
        unread: (unread || []).length,
        chat: true,
    };
}

async function dealEvents(dealId: Any) {
    const { data: t } = await db.from("trips").select("id, status").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(1);
    if (!t?.length) return [];
    const { data: ev } = await db.from("trip_events").select("type, at").eq("trip_id", t[0].id).order("at", { ascending: true });
    return (ev || []).filter((e: Any) => EVENT_LABELS[e.type]).map((e: Any) => ({ label: EVENT_LABELS[e.type], at: e.at }));
}

async function clientDeal(a: Any, body: Any) {
    const { data: d } = await db.from("deals").select("id, lead_id").eq("id", body.id).maybeSingle();
    if (!d || String(d.lead_id) !== String(a.lead_id)) fail(404, "Перевезення не знайдено.");
    return { events: await dealEvents(d!.id) };
}

async function clientNewRequest(a: Any, body: Any, ip: string) {
    await limit("account_id", a.id, "request_new", 30, 24 * 60);
    const f = body.request || {};
    const load_country = str(f.load_country, 60);
    const unload_country = str(f.unload_country, 60);
    const cargo = str(f.cargo, 300);
    const desired_date = isoDate(f.desired_date);
    if (!load_country || !unload_country) fail(400, "Вкажіть країну завантаження і розвантаження.");
    if (!cargo) fail(400, "Вкажіть, який вантаж.");
    if (!desired_date) fail(400, "Вкажіть дату завантаження.");
    const lead = await companyOf(a);
    if (!lead) fail(400, "Компанію не знайдено. Зверніться до менеджера.");
    const who = a.name ? ` (${a.name})` : "";
    const row = {
        client: lead!.name,
        lead_id: lead!.id,
        request_type: "Прорахунок",
        status: "Запит",
        source: "portal",
        portal_account_id: a.id,
        sales: lead!.sales || null,
        sales_id: lead!.sales_id || null,
        load_country,
        load_address: str(f.load_address, 300),
        unload_country,
        unload_address: str(f.unload_address, 300),
        customs_export: str(f.customs_export, 200),
        customs_import: str(f.customs_import, 200),
        cargo,
        weight: str(f.weight, 40),
        transport_type: str(f.transport_type, 40),
        trucks_count: Math.min(Math.max(Number(f.trucks_count) || 1, 1), 50),
        desired_date,
        desired_date_to: isoDate(f.desired_date_to),
        notes: [`🌐 З кабінету клієнта${who}`, str(f.notes, 1500)].filter(Boolean).join("\n"),
    };
    const { data, error } = await db.from("requests").insert(row).select(REQ_FIELDS).single();
    if (error) {
        console.error(error);
        fail(500, "Не вдалося зберегти запит. Спробуйте ще раз або напишіть менеджеру.");
    }
    await log(a.id, "request_new", { request_id: data.id }, ip);
    const to = lead!.sales_id ? [lead!.sales_id] : await headIds();
    await notifyStaff(
        to,
        `🌐 <b>Новий запит з кабінету клієнта</b>\n<b>${esc(lead!.name)}</b>${esc(who)}\n` +
            `${esc(load_country)} → ${esc(unload_country)} · ${esc(cargo)}\nДата: ${esc(desired_date)}\n\nПризначте логіста в CRM.`,
        `${APP_URL}/requests.html?open=${data.id}`,
    );
    return { request: shapeRequest(data) };
}

async function clientDecide(a: Any, body: Any, ip: string) {
    const decision = body.decision === "accepted" ? "accepted" : body.decision === "discuss" ? "discuss" : null;
    if (!decision) fail(400, "Невідома дія.");
    const { data: r } = await db.from("requests").select("id, lead_id, client, status, client_price, client_currency, sales_id, logistician_ids").eq("id", body.id).maybeSingle();
    if (!r || String(r.lead_id) !== String(a.lead_id)) fail(404, "Запит не знайдено.");
    if (!r!.client_price) fail(400, "Пропозиції ще немає.");
    if (r!.status === "Відмова") fail(400, "Запит скасовано.");
    const note = str(body.note, 1000);
    const { data, error } = await db
        .from("requests")
        .update({ client_decision: decision, client_decision_at: nowIso(), client_decision_note: note })
        .eq("id", r!.id)
        .select(REQ_FIELDS)
        .single();
    if (error) fail(500, "Не вдалося зберегти. Спробуйте ще раз.");
    await log(a.id, "request_decide", { request_id: r!.id, decision }, ip);
    const ids = [r!.sales_id, ...(Array.isArray(r!.logistician_ids) ? r!.logistician_ids : [])];
    await notifyStaff(
        r!.sales_id ? ids : [...ids, ...(await headIds())],
        `${decision === "accepted" ? "✅ <b>Клієнт погодив ціну</b>" : "💬 <b>Клієнт хоче обговорити ціну</b>"}\n` +
            `<b>${esc(r!.client)}</b> · ${esc(r!.client_price)} ${esc(r!.client_currency || "")}` +
            (note ? `\nКоментар: ${esc(note)}` : ""),
        `${APP_URL}/requests.html?open=${r!.id}`,
    );
    return { request: shapeRequest(data) };
}

async function clientCancel(a: Any, body: Any, ip: string) {
    const { data: r } = await db.from("requests").select("id, lead_id, client, status, sales_id, logistician_ids").eq("id", body.id).maybeSingle();
    if (!r || String(r.lead_id) !== String(a.lead_id)) fail(404, "Запит не знайдено.");
    if (r!.status !== "Запит" && r!.status !== "Відповідь") fail(400, "Запит уже в роботі — щоб скасувати, напишіть менеджеру.");
    const note = str(body.note, 500);
    const full = { status: "Відмова", refusal_reason: "Не актуально", refusal_comment: ["Скасовано клієнтом у кабінеті", note].filter(Boolean).join(": "), refused_at: nowIso() };
    let res = await db.from("requests").update(full).eq("id", r!.id).select(REQ_FIELDS).single();
    if (res.error) res = await db.from("requests").update({ status: "Відмова" }).eq("id", r!.id).select(REQ_FIELDS).single(); // немає колонок причини
    const data = res.data;
    await log(a.id, "request_cancel", { request_id: r!.id }, ip);
    await notifyStaff([r!.sales_id, ...(r!.logistician_ids || [])], `🚫 <b>Клієнт скасував запит</b>\n<b>${esc(r!.client)}</b>${note ? `\n${esc(note)}` : ""}`, `${APP_URL}/requests.html?open=${r!.id}`);
    return { request: data ? shapeRequest(data) : null };
}

/* ------------------------------------------------------------------ */
/* Перевізник                                                          */
/* ------------------------------------------------------------------ */

const OFFER_REQ_FIELDS =
    "id, status, created_at, load_country, unload_country, customs_export, customs_export_country, customs_import, customs_import_country, " +
    "border_crossing, cargo, weight, transport_type, temp_from, temp_to, desired_date, desired_date_to, trucks_count, loading_types";

async function carrierHome(a: Any) {
    const cid = String(a.carrier_id);
    const [bidsRes, dealsRes] = await Promise.all([
        db.from("carrier_bids").select("id, request_id, status, price, currency, load_date, note, truck_plate, created_at, answered_at").eq("carrier_id", cid).order("created_at", { ascending: false }).limit(60),
        db.from("deals").select("*").eq("carrier_id", cid).order("number", { ascending: false }).limit(200),
    ]);
    const bids = bidsRes.data || [];
    const reqIds = [...new Set(bids.map((b: Any) => b.request_id))];
    const { data: reqs } = reqIds.length ? await db.from("requests").select(OFFER_REQ_FIELDS).in("id", reqIds) : { data: [] };
    const byId = new Map((reqs || []).map((r: Any) => [String(r.id), r]));
    const oldLimit = Date.now() - 21 * DAY;
    const offers = bids
        .map((b: Any) => {
            const r = byId.get(String(b.request_id));
            if (!r) return null;
            const closed = r.status === "Відмова" || (r.status === "В роботі" && b.status !== "bid") || new Date(b.created_at).getTime() < oldLimit;
            if (closed && b.status === "asked") return null; // не встиг відповісти — рейс закрито, не показуємо
            return {
                id: b.id,
                status: b.status,
                closed,
                asked_at: b.created_at,
                my: { price: b.price, currency: b.currency, load_date: b.load_date, note: b.note, truck_plate: b.truck_plate, at: b.answered_at },
                request: {
                    route: routeOf(r, false),
                    cargo: r.cargo || null,
                    weight: r.weight || null,
                    transport_type: r.transport_type || null,
                    temp: r.temp_from != null || r.temp_to != null ? [r.temp_from, r.temp_to] : null,
                    desired_date: r.desired_date || null,
                    desired_date_to: r.desired_date_to || null,
                    trucks_count: r.trucks_count || null,
                    loading_types: r.loading_types || null,
                },
            };
        })
        .filter(Boolean);
    const deals = await shapeDeals(dealsRes.data || [], "out");
    const answered = bids.filter((b: Any) => b.status !== "asked").length;
    return {
        account: await publicAccount(a),
        offers,
        deals,
        stats: { trips: deals.length, active: deals.filter((d: Any) => d.stage.key !== "done").length, asked: bids.length, answered },
    };
}

async function carrierDeal(a: Any, body: Any) {
    const { data: d } = await db.from("deals").select("id, carrier_id").eq("id", body.id).maybeSingle();
    if (!d || String(d.carrier_id) !== String(a.carrier_id)) fail(404, "Рейс не знайдено.");
    return { events: await dealEvents(d!.id) };
}

async function carrierBid(a: Any, body: Any, ip: string) {
    await limit("account_id", a.id, "bid", 60, 60);
    const { data: b } = await db.from("carrier_bids").select("*").eq("id", body.id).maybeSingle();
    if (!b || String(b.carrier_id) !== String(a.carrier_id)) fail(404, "Пропозицію не знайдено.");
    const { data: r } = await db.from("requests").select("id, status, load_country, unload_country, desired_date, logistician_ids, sales_id").eq("id", b!.request_id).maybeSingle();
    if (!r || r.status === "Відмова") fail(400, "Цей рейс уже неактуальний.");
    const refuse = !!body.refuse;
    const note = str(body.note, 500);
    let patch: Any;
    if (refuse) {
        patch = { status: "refused", note, source: "portal", answered_at: nowIso(), updated_at: nowIso() };
    } else {
        const price = num(body.price);
        const currency = CURRENCIES.includes(String(body.currency)) ? String(body.currency) : "EUR";
        if (!price) fail(400, "Вкажіть ставку.");
        patch = {
            status: "bid",
            price,
            currency,
            load_date: isoDate(body.load_date),
            truck_plate: str(plate(body.truck_plate), 20),
            note,
            source: "portal",
            answered_at: nowIso(),
            updated_at: nowIso(),
        };
    }
    const { error } = await db.from("carrier_bids").update(patch).eq("id", b!.id);
    if (error) {
        console.error(error);
        fail(500, "Не вдалося зберегти. Спробуйте ще раз.");
    }
    await log(a.id, refuse ? "bid_refuse" : "bid", { bid_id: b!.id, request_id: r!.id, price: patch.price ?? null }, ip);
    const route = `${esc(r!.load_country || "?")} → ${esc(r!.unload_country || "?")}`;
    await notifyStaff(
        [b!.created_by, ...(Array.isArray(r!.logistician_ids) ? r!.logistician_ids : [])],
        refuse
            ? `🚫 <b>${esc(b!.carrier_name)}</b> не може взяти рейс ${route}${note ? `\n${esc(note)}` : ""}`
            : `💶 <b>Ставка з кабінету перевізника</b>\n<b>${esc(b!.carrier_name)}</b> · ${route}\n` +
                  `<b>${esc(patch.price)} ${esc(patch.currency)}</b>${patch.load_date ? ` · подача ${esc(patch.load_date)}` : ""}` +
                  `${patch.truck_plate ? ` · ${esc(patch.truck_plate)}` : ""}${note ? `\n${esc(note)}` : ""}`,
        `${APP_URL}/requests.html?open=${r!.id}`,
    );
    return carrierHome(a);
}

/* ------------------------------------------------------------------ */
/* Повна картка перевезення: карта, позиція, ETA, документи            */
/* ------------------------------------------------------------------ */

function thin<T>(list: T[], max: number): T[] {
    if (list.length <= max) return list;
    const step = list.length / max;
    const out: T[] = [];
    for (let i = 0; i < max; i++) out.push(list[Math.floor(i * step)]);
    out.push(list[list.length - 1]);
    return out;
}

async function dealFull(a: Any, body: Any) {
    const { data: d } = await db.from("deals").select("*").eq("id", body.id).maybeSingle();
    const mine = d && (a.kind === "client" ? String(d.lead_id) === String(a.lead_id) : String(d.carrier_id) === String(a.carrier_id));
    if (!mine) fail(404, "Перевезення не знайдено.");
    const [shaped] = await shapeDeals([d], a.kind === "client" ? "in" : "out");
    const { data: trips } = await db.from("trips").select("*").eq("deal_id", d.id).order("created_at", { ascending: false }).limit(3);
    const t = (trips || []).find((x: Any) => !["cancelled", "declined"].includes(x.status)) || null;
    let trip: Any = null;
    let events: Any[] = [];
    let docs: Any[] = [];
    if (t) {
        const [pos, ev, dc] = await Promise.all([
            db.from("trip_positions").select("recorded_at, lat, lon, speed_kmh").eq("trip_id", t.id).order("recorded_at", { ascending: true }).limit(5000),
            db.from("trip_events").select("type, at").eq("trip_id", t.id).order("at", { ascending: true }),
            db.from("trip_docs").select("path, kind, uploaded_at").eq("trip_id", t.id).order("uploaded_at", { ascending: true }),
        ]);
        const positions = (pos.data || []).filter((p: Any) => p.lat != null && p.lon != null);
        const last = positions[positions.length - 1];
        trip = {
            status: t.status,
            eta_at: t.eta_at || null,
            eta_remaining_km: t.eta_remaining_km ?? null,
            eta_delay_min: t.eta_traffic_delay_min ?? null,
            last: last
                ? { lat: last.lat, lon: last.lon, at: last.recorded_at, speed: last.speed_kmh }
                : t.last_lat != null
                  ? { lat: t.last_lat, lon: t.last_lon, at: t.last_point_at, speed: t.last_speed_kmh }
                  : null,
            track: thin(positions, 400).map((p: Any) => [p.lat, p.lon]),
            route: Array.isArray(t.route_line) ? thin(t.route_line, 400) : [],
            load: t.load_lat != null ? [t.load_lat, t.load_lon] : null,
            unload: t.unload_lat != null ? [t.unload_lat, t.unload_lon] : null,
            borders: Array.isArray(t.borders) ? t.borders.filter((b: Any) => b.lat != null).map((b: Any) => ({ name: b.name || "Кордон", lat: b.lat, lon: b.lon })) : [],
        };
        events = (ev.data || []).filter((e: Any) => EVENT_LABELS[e.type]).map((e: Any) => ({ label: EVENT_LABELS[e.type], at: e.at }));
        for (const x of dc.data || []) {
            const { data: u } = await db.storage.from("trip-docs").createSignedUrl(x.path, 3600);
            if (u?.signedUrl) docs.push({ kind: String(x.kind || "doc").toUpperCase(), at: x.uploaded_at, url: u.signedUrl });
        }
    }
    const messages = a.kind === "client" ? await readMessages(a, { deal_id: String(d.id) }) : [];
    return { deal: shaped, trip, events, docs, messages };
}

/* ------------------------------------------------------------------ */
/* Переписка клієнта з Грандар (portal_messages)                       */
/* ------------------------------------------------------------------ */

async function readMessages(a: Any, f: { deal_id?: string; request_id?: string }) {
    let q = db.from("portal_messages").select("id, request_id, deal_id, direction, author, text, created_at, read_at").eq("party", "client").eq("lead_id", String(a.lead_id));
    if (f.deal_id) q = q.eq("deal_id", f.deal_id);
    if (f.request_id) q = q.eq("request_id", f.request_id);
    const { data, error } = await q.order("created_at", { ascending: true }).limit(500);
    if (error) return []; // таблиці ще немає (portal_chat.sql не виконано)
    const unread = (data || []).filter((m: Any) => m.direction === "out" && !m.read_at).map((m: Any) => m.id);
    if (unread.length) await db.from("portal_messages").update({ read_at: nowIso() }).in("id", unread);
    // Підписи: № угоди / маршрут запиту
    const dealIds = [...new Set((data || []).map((m: Any) => m.deal_id).filter(Boolean))];
    const reqIds = [...new Set((data || []).map((m: Any) => m.request_id).filter(Boolean))];
    const [ds, rs] = await Promise.all([
        dealIds.length ? db.from("deals").select("id, number").in("id", dealIds) : { data: [] },
        reqIds.length ? db.from("requests").select("id, load_country, unload_country, created_at").in("id", reqIds) : { data: [] },
    ]);
    const dn = new Map((ds.data || []).map((x: Any) => [String(x.id), `Перевезення № ${x.number}`]));
    const rn = new Map((rs.data || []).map((x: Any) => [String(x.id), `Запит ${x.load_country || "?"} → ${x.unload_country || "?"}`]));
    return (data || []).map((m: Any) => ({
        id: m.id,
        mine: m.direction === "in",
        author: m.direction === "in" ? m.author || "Ви" : m.author || COMPANY,
        text: m.text,
        at: m.created_at,
        about: m.deal_id ? dn.get(String(m.deal_id)) || null : m.request_id ? rn.get(String(m.request_id)) || null : null,
        deal_id: m.deal_id,
        request_id: m.request_id,
    }));
}

async function clientMessages(a: Any, body: Any) {
    return { messages: await readMessages(a, { deal_id: str(body.deal_id, 60) || undefined, request_id: str(body.request_id, 60) || undefined }) };
}

async function clientSend(a: Any, body: Any, ip: string) {
    await limit("account_id", a.id, "message", 120, 60);
    const text = str(body.text, 4000);
    if (!text) fail(400, "Напишіть повідомлення.");
    const lead = await companyOf(a);
    let dealId: string | null = null;
    let requestId: string | null = null;
    let staffIds: unknown[] = [lead?.sales_id];
    let about = "";
    if (body.deal_id) {
        const { data: d } = await db.from("deals").select("id, number, lead_id, sales_id, logist_id").eq("id", body.deal_id).maybeSingle();
        if (!d || String(d.lead_id) !== String(a.lead_id)) fail(404, "Перевезення не знайдено.");
        dealId = String(d!.id);
        staffIds = [d!.logist_id, d!.sales_id];
        about = ` · перевезення № ${d!.number}`;
    } else if (body.request_id) {
        const { data: r } = await db.from("requests").select("id, lead_id, sales_id, logistician_ids, load_country, unload_country").eq("id", body.request_id).maybeSingle();
        if (!r || String(r.lead_id) !== String(a.lead_id)) fail(404, "Запит не знайдено.");
        requestId = r!.id;
        staffIds = [r!.sales_id, ...(Array.isArray(r!.logistician_ids) ? r!.logistician_ids : [])];
        about = ` · запит ${r!.load_country || "?"} → ${r!.unload_country || "?"}`;
    }
    const author = a.name || lead?.name || "Клієнт";
    const { error } = await db.from("portal_messages").insert({
        party: "client", lead_id: String(a.lead_id), deal_id: dealId, request_id: requestId,
        direction: "in", account_id: a.id, author, text,
    });
    if (error) {
        console.error(error);
        fail(500, "Чат ще не підключено. Напишіть менеджеру напряму.");
    }
    await log(a.id, "message", { deal_id: dealId, request_id: requestId }, ip);
    const ids = staffIds.filter(Boolean);
    await notifyStaff(
        ids.length ? ids : await headIds(),
        `💬 <b>Клієнт пише в кабінеті</b>\n<b>${esc(lead?.name || "")}</b> (${esc(author)})${esc(about)}\n\n${esc(text.slice(0, 1500))}`,
        dealId ? `${APP_URL}/deals.html?open=${dealId}` : requestId ? `${APP_URL}/requests.html?open=${requestId}` : `${APP_URL}/clients.html?open=${a.lead_id}`,
    );
    return { messages: await readMessages(a, { deal_id: dealId || undefined, request_id: requestId || undefined }) };
}

/* ------------------------------------------------------------------ */
/* Співробітник: видати / вимкнути доступ                              */
/* ------------------------------------------------------------------ */

async function staffFrom(req: Request) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) fail(401, "Потрібен вхід у CRM.");
    const { data } = await db.auth.getUser(jwt);
    const email = data?.user?.email?.toLowerCase();
    if (!email) fail(401, "Потрібен вхід у CRM.");
    const { data: s } = await db.from("staff").select("id, full_name, active").ilike("email", likeSafe(email!)).maybeSingle();
    if (!s?.active) fail(403, "Тільки для співробітників.");
    return s;
}

async function adminAccounts(body: Any) {
    const kind = body.kind === "carrier" ? "carrier" : "client";
    const col = kind === "client" ? "lead_id" : "carrier_id";
    const { data } = await db.from("portal_accounts").select("id, name, email, phone, tg_chat_id, active, created_at, last_login_at").eq("kind", kind).eq(col, String(body.ref_id)).order("created_at");
    return { accounts: data || [], bot: await botUsername() };
}

async function adminInvite(me: Any, body: Any, ip: string) {
    const kind = body.kind === "carrier" ? "carrier" : "client";
    const ref = String(body.ref_id || "");
    if (!ref) fail(400, "Немає компанії.");
    const email = str(body.email, 120)?.toLowerCase() || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, "Перевірте e-mail.");
    let account: Any = null;
    if (body.account_id) {
        const { data } = await db.from("portal_accounts").select("*").eq("id", body.account_id).maybeSingle();
        account = data;
    } else {
        const { data, error } = await db
            .from("portal_accounts")
            .insert({
                kind,
                lead_id: kind === "client" ? ref : null,
                carrier_id: kind === "carrier" ? ref : null,
                name: str(body.name, 120),
                email,
                phone: str(body.phone, 40),
                created_by: me.id,
            })
            .select("*")
            .single();
        if (error) fail(500, "Не вдалося створити доступ: " + error.message);
        account = data;
    }
    if (!account) fail(404, "Доступ не знайдено.");
    const token = randomToken();
    await db.from("portal_tokens").delete().eq("account_id", account.id).eq("purpose", "invite");
    await db.from("portal_tokens").insert({ hash: await sha256(token), account_id: account.id, purpose: "invite", expires_at: inDays(INVITE_DAYS) });
    await db.from("portal_accounts").update({ active: true }).eq("id", account.id);
    await log(account.id, "invite", { by: me.id }, ip);
    return { link: `${APP_URL}/cabinet.html#invite=${token}`, days: INVITE_DAYS, account_id: account.id };
}

async function adminToggle(me: Any, body: Any, ip: string) {
    const active = !!body.active;
    await db.from("portal_accounts").update({ active }).eq("id", body.account_id);
    if (!active) await db.from("portal_tokens").delete().eq("account_id", body.account_id);
    await log(String(body.account_id), active ? "enable" : "disable", { by: me.id }, ip);
    return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Вхідна точка                                                        */
/* ------------------------------------------------------------------ */

function json(status: number, data: unknown) {
    return new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } });
}

async function route(req: Request, body: Any) {
    const ip = ipOf(req);
    const action = String(body?.action || "");
    switch (action) {
        case "config":
            return { bot: await botUsername(), email_login: !!(RESEND_KEY && MAIL_FROM), company: COMPANY };
        case "login_tg":
            return loginTelegram(body, ip);
        case "login_invite":
            return loginInvite(body, ip);
        case "email_code":
            return emailCode(body, ip);
        case "email_verify":
            return emailVerify(body, ip);
    }
    if (action.startsWith("admin_")) {
        const me = await staffFrom(req);
        if (action === "admin_accounts") return adminAccounts(body);
        if (action === "admin_invite") return adminInvite(me, body, ip);
        if (action === "admin_toggle") return adminToggle(me, body, ip);
        fail(400, "Невідома дія.");
    }

    const a = await sessionAccount(req);
    if (action === "logout") {
        const token = req.headers.get("x-portal-token") || "";
        await db.from("portal_tokens").delete().eq("hash", await sha256(token));
        return { ok: true };
    }
    if (a.kind === "client") {
        if (action === "home") return clientHome(a);
        if (action === "deal") return clientDeal(a, body);
        if (action === "deal_full") return dealFull(a, body);
        if (action === "messages") return clientMessages(a, body);
        if (action === "message_send") return clientSend(a, body, ip);
        if (action === "request_new") return clientNewRequest(a, body, ip);
        if (action === "request_decide") return clientDecide(a, body, ip);
        if (action === "request_cancel") return clientCancel(a, body, ip);
    } else {
        if (action === "home") return carrierHome(a);
        if (action === "deal") return carrierDeal(a, body);
        if (action === "deal_full") return dealFull(a, body);
        if (action === "bid") return carrierBid(a, body, ip);
    }
    fail(400, "Невідома дія.");
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json(405, { error: "POST only" });
    let body: Any;
    try {
        body = await req.json();
    } catch {
        return json(400, { error: "bad request" });
    }
    try {
        return json(200, await route(req, body));
    } catch (e) {
        if (e instanceof Fail) return json(e.status, { error: e.message });
        console.error(e);
        return json(500, { error: "Помилка сервера. Спробуйте ще раз." });
    }
});
