// FURA — AI-агент «РОП» (Supabase Edge Function "fura-rop")
//
// Щоранку (і по кнопці «Оновити зараз») агент:
//   1. Збирає дані FURA: запити, ліди, клієнти, угоди, AI-продажі, співробітники.
//   2. КОДОМ рахує всі цифри й знаходить проблеми за порогами з налаштувань:
//        • запит без відповіді логіста довше N год        • ставка без реакції Sales довше N год
//        • прострочений «наступний контакт» по ліду      • «Новий» / «Контакт» без жодної дії N днів
//        • «Переговори» довше N днів                     • клієнт «Працюємо» без запитів N днів
//        • немає оплати клієнта через N днів після розвантаження
//        • угода з мінусовим / низьким профітом          • машина не завантажилась у плановий день
//        • листи AI-продажів чекають схвалення           • клієнт відповів «цікаво», а Sales мовчить
//        • ліди без відповідального → пропозиція, кому віддати (вирішує керівник)
//   3. Ставить задачі відповідальним (rop_tasks). Вирішена проблема закриває задачу сама.
//   4. Claude формулює висновки: головне на сьогодні, ризики, оцінка кожного менеджера.
//      Claude НЕ рахує цифри — лише пояснює ті, що порахував код (так у звіті немає вигаданих чисел).
//   5. Записує звіт (rop_reports) — його бачать лише «Керівник» і «Адмін» на сторінці «РОП».
//
// Секрети (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   — ключ Claude API (вже є для fura-agent / fura-sales)
//   ROP_CRON_SECRET     — будь-який довгий випадковий рядок (той самий — у розкладі в rop.sql)
// Необов'язково:
//   ROP_MODEL           — типово claude-sonnet-5-5
//
// Розгортання: supabase functions deploy fura-rop --no-verify-jwt
// (перевірку робимо самі: співробітник — за входом на сайт; розклад — за секретом).

import { createClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Any = any;

const env = (k: string, d = "") => Deno.env.get(k) ?? d;

const AI_KEY = env("ANTHROPIC_API_KEY");
const MODEL = env("ROP_MODEL", "claude-sonnet-5-5");
const CRON_SECRET = env("ROP_CRON_SECRET");

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info, x-rop-secret",
};

function json(status: number, data: unknown) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS, "content-type": "application/json" },
    });
}

const ok = (data: Any = { ok: true }) => ({ status: 200, data });
const fail = (status: number, error: string) => ({ status, data: { error } });

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
const num = (v: unknown) => {
    const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
    return isFinite(n) ? n : 0;
};
const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
const ts = (v: unknown) => (v ? Date.parse(String(v)) : NaN);
const normName = (s: unknown) =>
    String(s ?? "").toLowerCase().replace(/[«»"'`ʼ’]/g, "").replace(/\b(тов|тзов|пп|фоп|llc|ltd|sp\.? z o\.?o\.?)\b/g, "").replace(/\s+/g, " ").trim();

/* ================================================================== */
/* Налаштування                                                        */
/* ================================================================== */

const DEFAULTS: Record<string, number> = {
    logist_reply_hours: 6,
    stale_request_days: 7,
    sales_react_hours: 2,
    negotiation_days: 14,
    new_lead_days: 7,
    client_silent_days: 20,
    payment_days: 14,
    min_profit_usd: 50,
    draft_wait_hours: 24,
    daily_hour: 8,
    daily_minute: 30,
    weekly_day: 1,
    // Переписка (етап 2): час рахуємо лише в робочі години за Києвом
    client_reply_minutes: 60,
    quote_reply_hours: 3,
    work_start: 9,
    work_end: 19,
    work_saturday: 0,
};
// Межі, щоб випадково не поставити «0 годин» або «10000 днів»
const LIMITS: Record<string, [number, number]> = {
    logist_reply_hours: [1, 72],
    stale_request_days: [2, 90],
    sales_react_hours: [1, 72],
    negotiation_days: [1, 120],
    new_lead_days: [1, 60],
    client_silent_days: [3, 180],
    payment_days: [1, 120],
    min_profit_usd: [0, 5000],
    draft_wait_hours: [1, 168],
    daily_hour: [5, 12],
    daily_minute: [0, 59],
    weekly_day: [1, 7],
    client_reply_minutes: [5, 1440],
    quote_reply_hours: [1, 48],
    work_start: [0, 23],
    work_end: [1, 24],
    work_saturday: [0, 1],
};

async function loadSettings(): Promise<Record<string, number>> {
    const { data } = await db.from("rop_settings").select("settings").eq("id", 1).maybeSingle();
    const s = { ...DEFAULTS };
    for (const [k, v] of Object.entries(data?.settings || {})) {
        if (k in DEFAULTS && isFinite(Number(v))) s[k] = Number(v);
    }
    return s;
}

/* ================================================================== */
/* Час у Києві                                                         */
/* ================================================================== */

function kyivNow(d = new Date()) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Kyiv",
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
        }).formatToParts(d).map((p) => [p.type, p.value]),
    );
    const dow = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[parts.weekday] || 1;
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
        dow,
    };
}

/* ================================================================== */
/* Хто викликає                                                        */
/* ================================================================== */

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
    return (req.headers.get("x-rop-secret") || url.searchParams.get("key")) === CRON_SECRET;
}

/* ================================================================== */
/* Claude API                                                          */
/* ================================================================== */

async function claude(system: string, user: string, maxTokens = 3000): Promise<string | null> {
    if (!AI_KEY) return null;
    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": AI_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: maxTokens,
                system,
                messages: [{ role: "user", content: user }],
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            console.error("Claude API:", JSON.stringify(data).slice(0, 500));
            return null;
        }
        return (data.content || []).filter((b: Any) => b.type === "text").map((b: Any) => b.text).join("").trim() || null;
    } catch (e) {
        console.error("Claude API:", e);
        return null;
    }
}

function parseJson(text: string | null): Any {
    if (!text) return null;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
        return JSON.parse(m[0]);
    } catch {
        return null;
    }
}

/* ================================================================== */
/* Дані FURA                                                           */
/* ================================================================== */

const warnings: string[] = [];

// Запит до таблиці, який не валить увесь звіт (таблиці може ще не бути, напр. AI-продажі)
async function rows(label: string, q: PromiseLike<{ data: Any; error: Any }>): Promise<Any[]> {
    try {
        const { data, error } = await q;
        if (error) {
            // Переписку / AI-продажі ще не підключено (таблиць немає) — це не помилка, просто без цих перевірок
            const missing = /does not exist|could not find the table|schema cache/i.test(String(error.message || ""));
            if (!(missing && /^(comm_|sales_messages)/.test(label))) warnings.push(`${label}: ${error.message}`);
            return [];
        }
        return data || [];
    } catch (e) {
        warnings.push(`${label}: ${String(e)}`);
        return [];
    }
}

// Беремо всі колонки: у різних версіях FURA набір колонок трохи відрізняється, а «*» не падає
const REQ_FIELDS = "*";

async function collect() {
    warnings.length = 0;
    const since = (days: number) => new Date(Date.now() - days * DAY).toISOString();

    const [staff, reqRecent, reqOpen, leads, deals, drafts, replies, threads, messages] = await Promise.all([
        rows("staff", db.from("staff").select("*").eq("active", true)),
        rows("requests", db.from("requests").select(REQ_FIELDS).gte("created_at", since(150)).limit(5000)),
        rows("requests (відкриті)", db.from("requests").select(REQ_FIELDS).in("status", ["Запит", "Відповідь", "В роботі"]).limit(3000)),
        rows("leads", db.from("leads").select("*").limit(10000)),
        rows("deals", db.from("deals").select("*").gte("created_at", since(200)).limit(5000)),
        rows("sales_messages (чернетки)", db.from("sales_messages").select("id, prospect_id, step, created_at").eq("status", "draft").eq("direction", "out").limit(2000)),
        rows(
            "sales_messages (відповіді)",
            db.from("sales_messages").select("id, prospect_id, classification, summary, created_at")
                .eq("direction", "in").in("classification", ["interest", "quote"]).gte("created_at", since(30)).limit(1000),
        ),
        // Переписка (comms.sql). Немає таблиць — просто без цих перевірок
        rows("comm_threads", db.from("comm_threads").select("*").gte("last_message_at", since(30)).limit(5000)),
        rows(
            "comm_messages",
            db.from("comm_messages").select("id, thread_id, channel, direction, staff_id, sent_at, ai_intent, ai_has_rate, ai_tone, ai_note")
                .gte("sent_at", since(30)).order("sent_at").limit(30000),
        ),
    ]);

    const reqMap = new Map<string, Any>();
    for (const r of [...reqRecent, ...reqOpen]) reqMap.set(String(r.id), r);

    const prospectIds = [...new Set([...drafts, ...replies].map((m) => m.prospect_id).filter(Boolean))];
    const prospects = prospectIds.length
        ? await rows("sales_prospects", db.from("sales_prospects").select("id, name, stage, owner_id, lead_id").in("id", prospectIds.slice(0, 1000)))
        : [];

    return { staff, requests: [...reqMap.values()], leads, deals, drafts, replies, prospects, threads, messages };
}

type Data = Awaited<ReturnType<typeof collect>>;

/* ================================================================== */
/* Розрахунки                                                          */
/* ================================================================== */

// Профіт угоди в $ — так само, як у картці угоди (deals.js → calcTotals)
function dealProfit(d: Any): { income: number; expense: number; profit: number; filled: boolean } {
    const list = Array.isArray(d.services) ? d.services : [];
    let income = 0, expense = 0, filled = false;
    for (const r of list) {
        const qty = num(r.qty) || 1;
        const inSum = qty * num(r.in_rate);
        const outSum = qty * num(r.out_rate);
        if (num(r.in_fx)) income += inSum / num(r.in_fx);
        if (num(r.out_fx)) expense += outSum / num(r.out_fx);
        if (num(r.in_rate) && num(r.in_fx)) filled = true;
    }
    return { income, expense, profit: income - expense, filled };
}

function requestLogists(r: Any): string[] {
    if (Array.isArray(r.logistician_ids) && r.logistician_ids.length) return r.logistician_ids.map(String);
    return r.logistician_id ? [String(r.logistician_id)] : [];
}
function answeredBy(r: Any): Set<string> {
    return new Set((Array.isArray(r.answers) ? r.answers : []).map((a: Any) => String(a.logist_id)));
}

// Остання «жива» дія по ліду: запис в історії не автоматичний
function lastTouch(l: Any): number {
    let t = ts(l.created_at);
    for (const h of Array.isArray(l.history) ? l.history : []) {
        if (h?.auto) continue;
        const v = ts(h?.at);
        if (isFinite(v) && (!isFinite(t) || v > t)) t = v;
    }
    return t;
}
// Коли лід перейшов на етап (за автоматичним записом «Етап: … → «X»»)
function stageSince(l: Any, stage: string): number {
    let t = NaN;
    for (const h of Array.isArray(l.history) ? l.history : []) {
        if (typeof h?.text === "string" && h.text.includes(`«${stage}»`)) {
            const v = ts(h.at);
            if (isFinite(v) && (!isFinite(t) || v > t)) t = v;
        }
    }
    return isFinite(t) ? t : ts(l.created_at);
}

type Finding = {
    kind: string;
    priority: 1 | 2 | 3;
    assignee_id: string | null; // null = керівнику
    assignee_name: string | null;
    entity_type: string;
    entity_id: string;
    entity_label: string;
    title: string;
    details: string;
    link: string;
    suggestion?: Any;
    fingerprint: string;
};

const KIND_LABEL: Record<string, string> = {
    logist_reply: "Запит без відповіді логіста",
    sales_react: "Ставка без реакції Sales",
    lead_overdue: "Прострочений контакт з лідом",
    lead_stale: "Лід без руху",
    negotiation_long: "Затяжні переговори",
    client_silent: "Клієнт затих",
    payment_late: "Немає оплати від клієнта",
    low_profit: "Низький профіт угоди",
    deal_late: "Машина не завантажилась вчасно",
    draft_wait: "Листи AI-продажів чекають схвалення",
    reply_waiting: "Клієнт відповів — Sales мовчить",
    client_unanswered: "Клієнт чекає відповіді в месенджері / пошті",
    quote_not_given: "Клієнт просив ставку — не назвали",
    client_complaint: "Скарга клієнта",
    rude_tone: "Грубий тон у відповіді",
    assign_lead: "Лід без відповідального",
};

/* ---- Робочий час (Київ) ---- */

// Зсув Києва від UTC на конкретну дату (зимовий / літній час)
function kyivOffsetMs(t: number): number {
    const p = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false })
            .formatToParts(new Date(t)).map((x) => [x.type, x.value]),
    );
    const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
    return asUtc - Math.floor(t / 60_000) * 60_000;
}

// Скільки робочих хвилин минуло між a і b (пн–пт, сб — якщо увімкнено; з work_start до work_end)
function businessMinutes(a: number, b: number, s: Record<string, number>): number {
    if (!isFinite(a) || !isFinite(b) || b <= a) return 0;
    let total = 0;
    const start = a + kyivOffsetMs(a);
    const day0 = Math.floor(start / DAY) * DAY; // опівночі за Києвом (у «місцевих» мс)
    for (let d = day0, i = 0; d <= b + kyivOffsetMs(b) && i < 62; d += DAY, i++) {
        const dow = new Date(d).getUTCDay(); // 0 = неділя
        if (dow === 0 || (dow === 6 && !s.work_saturday)) continue;
        const off = kyivOffsetMs(d + 12 * HOUR - 3 * HOUR);
        const ws = d + s.work_start * HOUR - off;
        const we = d + s.work_end * HOUR - off;
        const from = Math.max(a, ws), to = Math.min(b, we);
        if (to > from) total += to - from;
    }
    return Math.round(total / 60_000);
}

const CLIENT_INTENTS = new Set(["quote_request", "order", "question", "complaint"]);

function analyze(d: Data, s: Record<string, number>) {
    const now = Date.now();
    const today = kyivNow().date;
    const staffById = new Map<string, Any>(d.staff.map((x: Any) => [String(x.id), x]));
    const staffByName = new Map<string, Any>(d.staff.map((x: Any) => [normName(x.full_name), x]));
    const person = (id: unknown, name?: unknown) => {
        const st = (id != null && staffById.get(String(id))) || (name ? staffByName.get(normName(name)) : null);
        return st ? { id: String(st.id), name: String(st.full_name || "") } : { id: null, name: name ? String(name) : null };
    };
    const route = (r: Any) => [r.load_country, r.unload_country].filter(Boolean).join(" → ");
    const findings: Finding[] = [];
    const add = (f: Omit<Finding, "fingerprint"> & { fingerprint?: string }) =>
        findings.push({ ...f, fingerprint: f.fingerprint || `${f.kind}:${f.entity_id}:${f.assignee_id || "boss"}` });

    /* ---- Запити ---- */
    // Давні запити без руху («Запит» / «Відповідь» старші за N днів) — не засмічуємо кожним окремо,
    // а даємо Sales одну задачу «закрити або оновити»
    const staleBySales = new Map<string, { p: { id: string | null; name: string | null }; items: string[]; oldest: number }>();
    for (const r of d.requests) {
        const age = (now - ts(r.created_at)) / HOUR;
        const label = `${r.number ? `№ ${r.number} ` : ""}${r.client || "Без клієнта"}${route(r) ? " · " + route(r) : ""}`;

        if ((r.status === "Запит" || r.status === "Відповідь") && age > s.stale_request_days * 24) {
            const p = person(r.sales_id, r.sales);
            const key = p.id || p.name || "—";
            const g = staleBySales.get(key) || { p, items: [], oldest: 0 };
            g.items.push(`${label} (${Math.round(age / 24)} дн.)`);
            g.oldest = Math.max(g.oldest, age);
            staleBySales.set(key, g);
            continue;
        }

        if (r.status === "Запит" && age > s.logist_reply_hours) {
            const done = answeredBy(r);
            const logists = requestLogists(r).filter((id) => !done.has(id));
            const pr = age > s.logist_reply_hours * 2 ? 1 : 2;
            if (logists.length) {
                for (const id of logists) {
                    const p = person(id);
                    add({
                        kind: "logist_reply", priority: pr, assignee_id: p.id, assignee_name: p.name,
                        entity_type: "request", entity_id: String(r.id), entity_label: label,
                        title: `Дати ставку по запиту: ${label}`,
                        details: `Запит чекає ${round(age)} год (норма — ${s.logist_reply_hours} год).`,
                        link: `requests.html?open=${r.id}`,
                    });
                }
            } else if (!requestLogists(r).length) {
                const p = person(r.sales_id, r.sales);
                add({
                    kind: "logist_reply", priority: pr, assignee_id: p.id, assignee_name: p.name,
                    entity_type: "request", entity_id: String(r.id), entity_label: label,
                    title: `Призначити логіста на запит: ${label}`,
                    details: `Запит без логіста вже ${round(age)} год.`,
                    link: `requests.html?open=${r.id}`,
                });
            }
        }

        if (r.status === "Відповідь") {
            const since = (now - (ts(r.answered_at) || ts(r.created_at))) / HOUR;
            if (since > s.sales_react_hours) {
                const p = person(r.sales_id, r.sales);
                add({
                    kind: "sales_react", priority: since > s.sales_react_hours * 4 ? 1 : 2, assignee_id: p.id, assignee_name: p.name,
                    entity_type: "request", entity_id: String(r.id), entity_label: label,
                    title: `Передати ставку клієнту й отримати відповідь: ${label}`,
                    details: `Логіст дав ставку ${round(since, 1)} год тому, статус досі «Відповідь» (норма — ${s.sales_react_hours} год). Переведіть у «В роботі» або «Відмова» з причиною.`,
                    link: `requests.html?open=${r.id}`,
                });
            }
        }
    }

    for (const [key, g] of staleBySales) {
        add({
            kind: "stale_requests", priority: 2, assignee_id: g.p.id, assignee_name: g.p.name,
            entity_type: "requests_stale", entity_id: key, entity_label: `${g.items.length} старих запитів`,
            title: `Закрити старі запити без руху: ${g.items.length} шт.`,
            details: `Запити в статусі «Запит» / «Відповідь» довше ${s.stale_request_days} дн. Якщо клієнт уже не актуальний — «Відмова» з причиною; якщо досі в роботі — оновіть статус. ` +
                g.items.slice(0, 5).join("; ") + (g.items.length > 5 ? ` і ще ${g.items.length - 5}.` : "."),
            link: "requests.html",
        });
    }

    /* ---- Ліди й клієнти ---- */
    const lastReqByLead = new Map<string, number>();
    const lastReqByName = new Map<string, number>();
    for (const r of d.requests) {
        const t = ts(r.created_at);
        if (r.lead_id) lastReqByLead.set(String(r.lead_id), Math.max(lastReqByLead.get(String(r.lead_id)) || 0, t));
        const n = normName(r.client);
        if (n) lastReqByName.set(n, Math.max(lastReqByName.get(n) || 0, t));
    }
    for (const dl of d.deals) {
        const t = ts(dl.created_at);
        if (dl.lead_id) lastReqByLead.set(String(dl.lead_id), Math.max(lastReqByLead.get(String(dl.lead_id)) || 0, t));
        const n = normName(dl.client);
        if (n) lastReqByName.set(n, Math.max(lastReqByName.get(n) || 0, t));
    }

    const unassigned: Any[] = [];
    for (const l of d.leads) {
        const label = String(l.name || "Без назви");
        const p = person(l.sales_id, l.sales);
        const active = !["Працюємо", "Відмова"].includes(l.status);

        if (!l.sales_id && l.status !== "Відмова") unassigned.push(l);

        if (active && l.next_contact && String(l.next_contact).slice(0, 10) < today) {
            const late = Math.round((Date.parse(today) - Date.parse(String(l.next_contact).slice(0, 10))) / DAY);
            add({
                kind: "lead_overdue", priority: late > 3 ? 1 : 2, assignee_id: p.id, assignee_name: p.name,
                entity_type: "lead", entity_id: String(l.id), entity_label: label,
                title: `Зв'язатися з ${label}`,
                details: `Наступний контакт був запланований на ${String(l.next_contact).slice(0, 10)} — прострочено на ${late} дн. Етап: «${l.status}».`,
                link: `leads.html?open=${l.id}`,
            });
        }

        if (["Новий", "Контакт"].includes(l.status)) {
            const idle = (now - lastTouch(l)) / DAY;
            // Якщо стоїть дата наступного контакту — за нею стежить «Прострочений контакт», не дублюємо
            if (idle > s.new_lead_days && !l.next_contact) {
                add({
                    kind: "lead_stale", priority: idle > s.new_lead_days * 3 ? 2 : 3, assignee_id: p.id, assignee_name: p.name,
                    entity_type: "lead", entity_id: String(l.id), entity_label: label,
                    title: `Опрацювати лід ${label} або закрити`,
                    details: `Етап «${l.status}», жодної дії ${Math.round(idle)} дн. Зателефонуйте й запишіть результат або поставте «Відмова».`,
                    link: `leads.html?open=${l.id}`,
                });
            }
        }

        if (l.status === "Переговори") {
            const long = (now - stageSince(l, "Переговори")) / DAY;
            if (long > s.negotiation_days) {
                add({
                    kind: "negotiation_long", priority: long > s.negotiation_days * 2 ? 1 : 2, assignee_id: p.id, assignee_name: p.name,
                    entity_type: "lead", entity_id: String(l.id), entity_label: label,
                    title: `Дотиснути переговори з ${label}`,
                    details: `На етапі «Переговори» ${Math.round(long)} дн. (норма — ${s.negotiation_days}). Узгодьте перше перевезення або чесно закрийте лід.`,
                    link: `leads.html?open=${l.id}`,
                });
            }
        }

        if (l.status === "Працюємо") {
            const last = Math.max(lastReqByLead.get(String(l.id)) || 0, lastReqByName.get(normName(l.name)) || 0);
            const silent = last ? (now - last) / DAY : null;
            if (silent === null || silent > s.client_silent_days) {
                add({
                    kind: "client_silent", priority: silent === null ? 3 : silent > s.client_silent_days * 2 ? 1 : 2,
                    assignee_id: p.id, assignee_name: p.name,
                    entity_type: "lead", entity_id: String(l.id), entity_label: label,
                    title: `Клієнт ${label} затих — зателефонувати`,
                    details: silent === null
                        ? "Запитів і угод не було понад 5 місяців."
                        : `Останній запит / угода — ${Math.round(silent)} дн. тому (норма — ${s.client_silent_days}). Дізнайтесь, чи є вантажі й чи не пішов до конкурента.`,
                    link: `leads.html?open=${l.id}`,
                });
            }
        }
    }

    /* ---- Розподіл лідів без відповідального ---- */
    const salesStaff = d.staff.filter((x: Any) => rolesOf(x).includes("sales"));
    const load = new Map<string, number>(salesStaff.map((x: Any) => [String(x.id), 0]));
    for (const l of d.leads) {
        if (l.sales_id && load.has(String(l.sales_id)) && !["Відмова"].includes(l.status)) {
            load.set(String(l.sales_id), (load.get(String(l.sales_id)) || 0) + 1);
        }
    }
    for (const l of unassigned.slice(0, 30)) {
        const pick = [...load.entries()].sort((a, b) => a[1] - b[1])[0];
        const to = pick ? staffById.get(pick[0]) : null;
        if (pick) load.set(pick[0], pick[1] + 1);
        add({
            kind: "assign_lead", priority: 2, assignee_id: null, assignee_name: null,
            entity_type: "lead", entity_id: String(l.id), entity_label: String(l.name || "Без назви"),
            title: `Призначити відповідального: ${l.name || "лід без назви"}`,
            details: to
                ? `Пропоную ${to.full_name} — у нього найменше активних лідів (${pick![1]}). Джерело: ${l.source || "—"}.`
                : "Немає співробітників з роллю Sales — призначте вручну.",
            link: `leads.html?open=${l.id}`,
            suggestion: to ? { staff_id: String(to.id), staff_name: to.full_name } : null,
        });
    }

    /* ---- Угоди ---- */
    for (const dl of d.deals) {
        const label = `№ ${dl.number ?? "—"} · ${dl.client || ""}`.trim();
        const sp = person(dl.sales_id, dl.sales);
        const lp = person(dl.logist_id, dl.logist_name);

        if (dl.unload_date && !dl.paid_by_client) {
            const days = (now - ts(dl.unload_date)) / DAY;
            if (days > s.payment_days) {
                add({
                    kind: "payment_late", priority: days > s.payment_days * 2 ? 1 : 2, assignee_id: sp.id, assignee_name: sp.name,
                    entity_type: "deal", entity_id: String(dl.id), entity_label: label,
                    title: `Отримати оплату: угода ${label}`,
                    details: `Розвантаження ${String(dl.unload_date).slice(0, 10)}, оплати від клієнта немає вже ${Math.round(days)} дн. (норма — ${s.payment_days}).`,
                    link: `deals.html?open=${dl.id}`,
                });
            }
        }

        if (!dl.load_date && dl.load_date_plan) {
            const plan = String(dl.load_date_plan).slice(0, 10);
            const late = Math.round((Date.parse(today) - Date.parse(plan)) / DAY);
            if (plan < today && late <= 30) {
                add({
                    kind: "deal_late", priority: 1, assignee_id: lp.id, assignee_name: lp.name,
                    entity_type: "deal", entity_id: String(dl.id), entity_label: label,
                    title: `Перевірити завантаження: угода ${label}`,
                    details: `Планове завантаження ${plan}, фактичної дати немає (${late} дн.). Поставте дату або попередьте клієнта.`,
                    link: `deals.html?open=${dl.id}`,
                });
            }
        }

        const pr = dealProfit(dl);
        if (pr.filled && now - ts(dl.created_at) < 30 * DAY && pr.profit < s.min_profit_usd) {
            add({
                kind: "low_profit", priority: pr.profit < 0 ? 1 : 3, assignee_id: sp.id, assignee_name: sp.name,
                entity_type: "deal", entity_id: String(dl.id), entity_label: label,
                title: pr.profit < 0 ? `Мінусова угода ${label}` : `Низький профіт: угода ${label}`,
                details: `Профіт ${round(pr.profit)} $ (дохід ${round(pr.income)} $, витрати ${round(pr.expense)} $). Мінімум — ${s.min_profit_usd} $. Перевірте ставки й курси.`,
                link: `deals.html?open=${dl.id}`,
            });
        }
    }

    /* ---- Переписка з клієнтами (Outlook / Telegram / WhatsApp / Viber) ---- */
    const msgsByThread = new Map<string, Any[]>();
    for (const m of d.messages) {
        const k = String(m.thread_id);
        if (!msgsByThread.has(k)) msgsByThread.set(k, []);
        msgsByThread.get(k)!.push(m);
    }
    const CH_LABEL: Record<string, string> = { outlook: "Outlook", telegram: "Telegram", whatsapp: "WhatsApp", viber: "Viber" };
    for (const t of d.threads) {
        if (t.carrier_id) continue; // перевізники — не клієнти
        const msgs = msgsByThread.get(String(t.id)) || [];
        const who = person(t.staff_id, t.staff_name);
        const label = `${t.lead_name || t.contact_name || t.contact_handle} · ${CH_LABEL[t.channel] || t.channel}`;
        const link = `comms.html?t=${t.id}`;
        const isClient = !!t.lead_id || msgs.some((m) => m.direction === "in" && CLIENT_INTENTS.has(m.ai_intent));

        // Клієнт чекає відповіді
        if (t.unanswered_since && isClient) {
            const waiting = msgs.filter((m) => m.direction === "in" && ts(m.sent_at) >= ts(t.unanswered_since));
            const lastIn = waiting[waiting.length - 1];
            const needsReply = !lastIn || !["info", "spam"].includes(lastIn.ai_intent);
            const mins = businessMinutes(ts(t.unanswered_since), now, s);
            if (needsReply && mins > s.client_reply_minutes) {
                const hot = waiting.some((m) => m.ai_intent === "quote_request" || m.ai_intent === "complaint" || m.ai_intent === "order");
                add({
                    kind: "client_unanswered", priority: hot || mins > s.client_reply_minutes * 3 ? 1 : 2,
                    assignee_id: who.id, assignee_name: who.name,
                    entity_type: "thread", entity_id: String(t.id), entity_label: label,
                    title: `Відповісти клієнту: ${label}`,
                    details: `Клієнт чекає ${mins >= 120 ? round(mins / 60, 1) + " роб. год" : mins + " роб. хв"} (норма — ${s.client_reply_minutes} хв).` +
                        (t.last_preview ? ` Останнє: «${clip(t.last_preview, 120)}»` : ""),
                    link,
                });
            }
        }

        // Клієнт просив ставку — ставку так і не назвали
        const asks = msgs.filter((m) => m.direction === "in" && m.ai_intent === "quote_request" && now - ts(m.sent_at) < 7 * DAY);
        const lastAsk = asks[asks.length - 1];
        if (lastAsk) {
            const answered = msgs.some((m) => m.direction === "out" && m.ai_has_rate && ts(m.sent_at) > ts(lastAsk.sent_at));
            const hrs = businessMinutes(ts(lastAsk.sent_at), now, s) / 60;
            if (!answered && hrs > s.quote_reply_hours) {
                add({
                    kind: "quote_not_given", priority: hrs > s.quote_reply_hours * 2 ? 1 : 2,
                    assignee_id: who.id, assignee_name: who.name,
                    entity_type: "thread", entity_id: String(t.id), entity_label: label,
                    title: `Назвати ставку клієнту: ${label}`,
                    details: `Клієнт просив ціну ${round(hrs, 1)} роб. год тому, у відповідях ставки немає (норма — ${s.quote_reply_hours} год).` +
                        (lastAsk.ai_note ? ` ${clip(lastAsk.ai_note, 150)}` : "") + " Створіть запит логісту, якщо ще не створено.",
                    link,
                    fingerprint: `quote_not_given:${lastAsk.id}`,
                });
            }
        }

        // Скарга клієнта — керівнику
        for (const m of msgs) {
            if (m.direction !== "in" || m.ai_intent !== "complaint" || now - ts(m.sent_at) > 3 * DAY) continue;
            add({
                kind: "client_complaint", priority: 1, assignee_id: null, assignee_name: null,
                entity_type: "thread", entity_id: String(t.id), entity_label: label,
                title: `Скарга клієнта: ${label}`,
                details: `${m.ai_note ? clip(m.ai_note, 200) + ". " : ""}Веде: ${who.name || "не призначено"}. Перевірте, що проблему вирішують.`,
                link,
                fingerprint: `client_complaint:${m.id}`,
            });
        }

        // Грубий тон у відповіді — керівнику
        for (const m of msgs) {
            if (m.direction !== "out" || m.ai_tone !== "rude" || now - ts(m.sent_at) > 7 * DAY) continue;
            const author = person(m.staff_id || t.staff_id, t.staff_name);
            add({
                kind: "rude_tone", priority: 2, assignee_id: null, assignee_name: null,
                entity_type: "thread", entity_id: String(t.id), entity_label: label,
                title: `Тон відповіді: ${author.name || "менеджер"} → ${t.lead_name || t.contact_name || t.contact_handle}`,
                details: `${m.ai_note ? clip(m.ai_note, 200) + ". " : ""}Перегляньте переписку й поговоріть із співробітником.`,
                link,
                fingerprint: `rude_tone:${m.id}`,
            });
        }
    }

    /* ---- AI-продажі ---- */
    const prospectById = new Map<string, Any>(d.prospects.map((p: Any) => [String(p.id), p]));
    const draftsByOwner = new Map<string, number>();
    for (const m of d.drafts) {
        if ((now - ts(m.created_at)) / HOUR <= s.draft_wait_hours) continue;
        const owner = String(prospectById.get(String(m.prospect_id))?.owner_id || "");
        draftsByOwner.set(owner, (draftsByOwner.get(owner) || 0) + 1);
    }
    for (const [owner, n] of draftsByOwner) {
        const p = owner ? person(owner) : { id: null, name: null };
        add({
            kind: "draft_wait", priority: n >= 10 ? 1 : 2, assignee_id: p.id, assignee_name: p.name,
            entity_type: "prospect", entity_id: owner || "all", entity_label: "AI-продажі",
            title: `Схвалити листи AI-продажів (${n})`,
            details: `${n} лист(ів) чекають «Надіслати» довше ${s.draft_wait_hours} год. Клієнти не отримують першого контакту.`,
            link: "sales-agent.html",
            fingerprint: `draft_wait:${owner || "all"}`,
        });
    }
    const repliedSeen = new Set<string>();
    for (const m of d.replies) {
        const pr = prospectById.get(String(m.prospect_id));
        if (!pr || pr.stage !== "replied" || repliedSeen.has(String(pr.id))) continue;
        const hrs = (now - ts(m.created_at)) / HOUR;
        if (hrs < 24) continue;
        repliedSeen.add(String(pr.id));
        const p = person(pr.owner_id);
        add({
            kind: "reply_waiting", priority: 1, assignee_id: p.id, assignee_name: p.name,
            entity_type: "prospect", entity_id: String(pr.id), entity_label: String(pr.name || ""),
            title: `Клієнт ${pr.name} відповів з інтересом — зв'язатися`,
            details: `${m.classification === "quote" ? "Просить ставку" : "Цікавиться"} ${Math.round(hrs)} год тому, етап досі «Відповів».${m.summary ? " " + clip(m.summary, 200) : ""}`,
            link: `sales-agent.html?p=${pr.id}`,
        });
    }

    // Задачі без відповідального (немає Sales у картці) — керівнику
    for (const f of findings) if (!f.assignee_id) f.assignee_name = null;

    return findings;
}

/* ---- Цифри по команді й по кожному співробітнику ---- */

function metrics(d: Data, findings: Finding[], s: Record<string, number>) {
    const now = Date.now();
    const inLast = (v: unknown, days: number, offset = 0) => {
        const t = ts(v);
        return isFinite(t) && t > now - (days + offset) * DAY && t <= now - offset * DAY;
    };
    const won = (r: Any) => ["В роботі", "Виконано"].includes(r.status);
    const pct = (a: number, b: number) => (b ? round((a / b) * 100) : null);

    const period = (days: number, offset = 0) => {
        const req = d.requests.filter((r) => inLast(r.created_at, days, offset));
        const deals = d.deals.filter((x) => inLast(x.created_at, days, offset));
        const answered = req.filter((r) => r.answered_at);
        const respH = answered.map((r) => (ts(r.answered_at) - ts(r.created_at)) / HOUR).filter((h) => h >= 0);
        const refusals: Record<string, number> = {};
        for (const r of req.filter((x) => x.status === "Відмова")) {
            const k = r.refusal_reason || "без причини";
            refusals[k] = (refusals[k] || 0) + 1;
        }
        return {
            requests: req.length,
            won: req.filter(won).length,
            done: req.filter((r) => r.status === "Виконано").length,
            refused: req.filter((r) => r.status === "Відмова").length,
            conversion_pct: pct(req.filter(won).length, req.length),
            avg_logist_reply_h: respH.length ? round(respH.reduce((a, b) => a + b, 0) / respH.length, 1) : null,
            late_logist_replies: respH.filter((h) => h > s.logist_reply_hours).length,
            refusal_reasons: refusals,
            deals: deals.length,
            profit_usd: round(deals.reduce((a, x) => a + dealProfit(x).profit, 0)),
            new_leads: d.leads.filter((l) => inLast(l.created_at, days, offset)).length,
        };
    };

    const pipeline: Record<string, number> = {};
    for (const l of d.leads) pipeline[l.status || "—"] = (pipeline[l.status || "—"] || 0) + 1;

    const directions: Record<string, number> = {};
    for (const r of d.requests.filter((x) => inLast(x.created_at, 30))) {
        const k = [r.load_country, r.unload_country].filter(Boolean).join(" → ") || "—";
        directions[k] = (directions[k] || 0) + 1;
    }
    const topDirections = Object.entries(directions).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ route: k, requests: v }));

    const leadSources: Record<string, number> = {};
    for (const l of d.leads.filter((x) => inLast(x.created_at, 30))) leadSources[l.source || "—"] = (leadSources[l.source || "—"] || 0) + 1;

    // Переписка: час першої відповіді клієнту (робочі хвилини) по кожній розмові
    const clientThreads = new Set(d.threads.filter((t: Any) => !t.carrier_id).map((t: Any) => String(t.id)));
    const threadStaff = new Map<string, string>(d.threads.map((t: Any) => [String(t.id), String(t.staff_id || "")]));
    const replies: { staff: string; minutes: number; at: number; channel: string }[] = [];
    {
        const byThread = new Map<string, Any[]>();
        for (const m of d.messages) {
            if (!clientThreads.has(String(m.thread_id))) continue;
            const k = String(m.thread_id);
            if (!byThread.has(k)) byThread.set(k, []);
            byThread.get(k)!.push(m);
        }
        for (const [tid, list] of byThread) {
            let waitFrom: number | null = null;
            for (const m of list) {
                if (m.direction === "in") {
                    if (waitFrom === null) waitFrom = ts(m.sent_at);
                } else if (waitFrom !== null) {
                    replies.push({ staff: String(m.staff_id || threadStaff.get(tid) || ""), minutes: businessMinutes(waitFrom, ts(m.sent_at), s), at: ts(m.sent_at), channel: m.channel });
                    waitFrom = null;
                }
            }
        }
    }
    const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    const median = (xs: number[]) => {
        if (!xs.length) return null;
        const a = [...xs].sort((x, y) => x - y);
        return a[Math.floor(a.length / 2)];
    };
    const commFor = (staffId: string | null) => {
        const msgs = d.messages.filter((m: Any) => clientThreads.has(String(m.thread_id)) && (staffId === null || String(m.staff_id || threadStaff.get(String(m.thread_id)) || "") === staffId));
        const rep7 = replies.filter((r) => (staffId === null || r.staff === staffId) && r.at > now - 7 * DAY).map((r) => r.minutes);
        const rep30 = replies.filter((r) => (staffId === null || r.staff === staffId)).map((r) => r.minutes);
        const byChannel: Record<string, number> = {};
        for (const m of msgs.filter((x: Any) => inLast(x.sent_at, 7))) byChannel[m.channel] = (byChannel[m.channel] || 0) + 1;
        return {
            messages_in_7d: msgs.filter((m: Any) => m.direction === "in" && inLast(m.sent_at, 7)).length,
            messages_out_7d: msgs.filter((m: Any) => m.direction === "out" && inLast(m.sent_at, 7)).length,
            by_channel_7d: byChannel,
            avg_first_reply_min_7d: avg(rep7),
            median_first_reply_min_30d: median(rep30),
            late_replies_30d: rep30.filter((x) => x > s.client_reply_minutes).length,
            unanswered_now: findings.filter((f) => f.kind === "client_unanswered" && (staffId === null || f.assignee_id === staffId)).length,
            quote_requests_7d: msgs.filter((m: Any) => m.ai_intent === "quote_request" && inLast(m.sent_at, 7)).length,
            complaints_7d: msgs.filter((m: Any) => m.ai_intent === "complaint" && inLast(m.sent_at, 7)).length,
        };
    };

    // По людях
    const people = d.staff
        .filter((x: Any) => rolesOf(x).some((r) => r === "sales" || r === "logist"))
        .map((st: Any) => {
            const id = String(st.id);
            const roles = rolesOf(st);
            const out: Any = { staff_id: id, name: st.full_name, roles };
            if (roles.includes("sales")) {
                const mine = d.requests.filter((r) => String(r.sales_id) === id);
                const r30 = mine.filter((r) => inLast(r.created_at, 30));
                const r7 = mine.filter((r) => inLast(r.created_at, 7));
                const deals30 = d.deals.filter((x) => String(x.sales_id) === id && inLast(x.created_at, 30));
                const leads = d.leads.filter((l) => String(l.sales_id) === id);
                out.sales = {
                    requests_7d: r7.length,
                    requests_30d: r30.length,
                    conversion_30d_pct: pct(r30.filter(won).length, r30.length),
                    refused_30d: r30.filter((r) => r.status === "Відмова").length,
                    deals_30d: deals30.length,
                    profit_30d_usd: round(deals30.reduce((a, x) => a + dealProfit(x).profit, 0)),
                    leads_active: leads.filter((l) => !["Працюємо", "Відмова"].includes(l.status)).length,
                    clients_working: leads.filter((l) => l.status === "Працюємо").length,
                    new_leads_30d: leads.filter((l) => inLast(l.created_at, 30)).length,
                };
            }
            if (roles.includes("logist")) {
                const mine = d.requests.filter((r) => requestLogists(r).includes(id) || String(r.logistician_id) === id);
                const r30 = mine.filter((r) => inLast(r.created_at, 30));
                const answered = r30.filter((r) => r.answered_at);
                const resp = answered.map((r) => (ts(r.answered_at) - ts(r.created_at)) / HOUR).filter((h) => h >= 0);
                const deals30 = d.deals.filter((x) => String(x.logist_id) === id && inLast(x.created_at, 30));
                out.logist = {
                    requests_30d: r30.length,
                    answered_30d: answered.length,
                    avg_reply_h: resp.length ? round(resp.reduce((a, b) => a + b, 0) / resp.length, 1) : null,
                    late_replies_30d: resp.filter((h) => h > s.logist_reply_hours).length,
                    won_30d: r30.filter(won).length,
                    deals_30d: deals30.length,
                    profit_30d_usd: round(deals30.reduce((a, x) => a + dealProfit(x).profit, 0)),
                };
            }
            if (d.messages.length) out.comms = commFor(id);
            const tasks = findings.filter((f) => f.assignee_id === id);
            out.problems_now = tasks.length;
            out.problems_urgent = tasks.filter((f) => f.priority === 1).length;
            out.problems_by_kind = tasks.reduce((a: Any, f) => ((a[f.kind] = (a[f.kind] || 0) + 1), a), {});
            return out;
        });

    const byKind: Record<string, number> = {};
    for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;

    return {
        generated_at: new Date().toISOString(),
        thresholds: s,
        today: period(1),
        week: period(7),
        prev_week: period(7, 7),
        month: period(30),
        prev_month: period(30, 30),
        pipeline,
        top_directions_30d: topDirections,
        lead_sources_30d: leadSources,
        open_requests: {
            waiting_logist: d.requests.filter((r) => r.status === "Запит").length,
            waiting_sales: d.requests.filter((r) => r.status === "Відповідь").length,
            in_work: d.requests.filter((r) => r.status === "В роботі").length,
        },
        comms: d.messages.length ? commFor(null) : null,
        problems: { total: findings.length, urgent: findings.filter((f) => f.priority === 1).length, by_kind: byKind },
        people,
        data_warnings: [...warnings],
    };
}

/* ================================================================== */
/* Висновки Claude                                                     */
/* ================================================================== */

const SYSTEM = `Ти — досвідчений керівник відділу продажів (РОП) у компанії Грандар: міжнародні автоперевезення
(Україна — ЄС, Центральна Азія, Кавказ), експедирування. У відділі Sales-менеджери (продають, ведуть клієнтів),
логісти (шукають перевізника, дають ставку) і диспетчер.

Тобі дають цифри і список проблем, які ПОРАХУВАВ КОД з CRM FURA. Твоє завдання — як сильний РОП:
1) вибрати 5 найважливіших дій на сьогодні (гроші й клієнти — першими: оплати, клієнти що відповіли, ставки без реакції, клієнти що затихли);
2) назвати ризики й тренди, порівнюючи тиждень з попереднім і місяць з попереднім;
3) коротко і по-людськи оцінити кожного співробітника: що добре, що покращити — конкретно, з цифрами.
Якщо є metrics.comms і people[].comms — це переписка з клієнтами в Outlook / Telegram / WhatsApp / Viber:
час першої відповіді (робочі хвилини), скільки клієнтів чекають відповіді, запити ставок і скарги. Враховуй це в оцінці людей.

ЖОРСТКІ ПРАВИЛА:
- Використовуй ТІЛЬКИ цифри з даних. Нічого не вигадуй, не рахуй нових сум. Якщо цифри немає — не пиши її.
- Якщо даних мало (новий відділ, мало запитів) — так і скажи, без натягнутих висновків.
- Пиши українською, коротко, по-діловому, без води й без канцеляриту. Звертайся до керівника на «ви».
- Відповідь — ЛИШЕ JSON без пояснень довкола.

Формат:
{
  "headline": "одне речення — головне про стан відділу сьогодні",
  "top_actions": [ { "title": "що зробити", "why": "чому саме зараз (з цифрою)", "who": "ім'я або 'Керівник'", "link": "посилання з поля link проблеми або порожньо" } ],
  "risks": [ { "title": "ризик", "details": "пояснення з цифрами", "level": "high" | "medium" } ],
  "trends": [ "короткий тренд з цифрами" ],
  "managers": [ { "staff_id": "id з даних", "verdict": "1 речення", "good": "що добре", "improve": "що покращити" } ],
  "week_summary": "лише для тижневого звіту: 3–5 речень підсумку тижня; інакше порожньо"
}`;

async function aiSummary(kind: string, m: Any, findings: Finding[]) {
    const top = [...findings]
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 70)
        .map((f) => ({ kind: KIND_LABEL[f.kind] || f.kind, priority: f.priority, who: f.assignee_name || "Керівник", title: f.title, details: f.details, link: f.link }));
    const payload = { report: kind === "weekly" ? "тижневий" : "ранковий", metrics: m, problems: top };
    const text = await claude(SYSTEM, JSON.stringify(payload), 3500);
    const j = parseJson(text);
    if (!j || !Array.isArray(j.top_actions)) return null;
    return {
        headline: clip(j.headline, 400),
        top_actions: j.top_actions.slice(0, 5).map((a: Any) => ({ title: clip(a.title, 300), why: clip(a.why, 400), who: clip(a.who, 80), link: clip(a.link, 200) })),
        risks: (Array.isArray(j.risks) ? j.risks : []).slice(0, 8).map((r: Any) => ({ title: clip(r.title, 200), details: clip(r.details, 500), level: r.level === "high" ? "high" : "medium" })),
        trends: (Array.isArray(j.trends) ? j.trends : []).slice(0, 8).map((t: Any) => clip(t, 300)),
        managers: (Array.isArray(j.managers) ? j.managers : []).slice(0, 30).map((x: Any) => ({
            staff_id: clip(x.staff_id, 64), verdict: clip(x.verdict, 300), good: clip(x.good, 400), improve: clip(x.improve, 400),
        })),
        week_summary: clip(j.week_summary, 1500),
    };
}

// Без Claude (немає ключа / помилка) — звіт із цифр і найтерміновіших проблем
function plainSummary(m: Any, findings: Finding[]) {
    // Один запит з кількома логістами — одна дія, з усіма іменами
    const byEntity = new Map<string, { f: Finding; who: string[] }>();
    for (const f of [...findings].sort((a, b) => a.priority - b.priority)) {
        const k = `${f.kind}:${f.entity_type}:${f.entity_id}`;
        const g = byEntity.get(k);
        if (g) {
            if (f.assignee_name && !g.who.includes(f.assignee_name)) g.who.push(f.assignee_name);
        } else byEntity.set(k, { f, who: f.assignee_name ? [f.assignee_name] : [] });
    }
    const top = [...byEntity.values()].slice(0, 5);
    return {
        headline: `Проблем зараз: ${m.problems.total}, з них термінових: ${m.problems.urgent}.`,
        top_actions: top.map(({ f, who }) => ({ title: f.title, why: f.details, who: who.join(", ") || "Керівник", link: f.link })),
        risks: [],
        trends: [],
        managers: [],
        week_summary: "",
    };
}

/* ================================================================== */
/* Задачі                                                              */
/* ================================================================== */

async function syncTasks(findings: Finding[], reportId: string) {
    const nowIso = new Date().toISOString();
    const { data: open } = await db.from("rop_tasks").select("id, fingerprint, priority, details").eq("status", "open").limit(5000);
    // Відхилене керівником / менеджером не повертаємо 7 днів
    const { data: dismissed } = await db.from("rop_tasks").select("fingerprint")
        .eq("status", "dismissed").gte("closed_at", new Date(Date.now() - 7 * DAY).toISOString()).limit(5000);
    const openByFp = new Map<string, Any>((open || []).map((t: Any) => [t.fingerprint, t]));
    const skip = new Set((dismissed || []).map((t: Any) => t.fingerprint));
    const current = new Set<string>();

    const inserts: Any[] = [];
    for (const f of findings) {
        current.add(f.fingerprint);
        const ex = openByFp.get(f.fingerprint);
        if (ex) {
            if (ex.priority !== f.priority || ex.details !== f.details) {
                await db.from("rop_tasks").update({ priority: f.priority, details: f.details, title: f.title, link: f.link, updated_at: nowIso }).eq("id", ex.id);
            }
            continue;
        }
        if (skip.has(f.fingerprint)) continue;
        inserts.push({
            report_id: reportId,
            assignee_id: f.assignee_id,
            assignee_name: f.assignee_name,
            kind: f.kind,
            entity_type: f.entity_type,
            entity_id: f.entity_id,
            entity_label: clip(f.entity_label, 200),
            fingerprint: f.fingerprint,
            title: clip(f.title, 300),
            details: clip(f.details, 1000),
            link: clip(f.link, 300),
            priority: f.priority,
            suggestion: f.suggestion ?? null,
        });
    }
    for (let i = 0; i < inserts.length; i += 200) {
        const { error } = await db.from("rop_tasks").insert(inserts.slice(i, i + 200));
        if (error) console.error("rop_tasks insert:", error.message);
    }

    // Проблему вирішили в CRM — задача закривається сама
    const solved = (open || []).filter((t: Any) => !current.has(t.fingerprint)).map((t: Any) => t.id);
    for (let i = 0; i < solved.length; i += 200) {
        await db.from("rop_tasks").update({ status: "done", closed_by: "Агент: проблему вирішено", closed_at: nowIso, updated_at: nowIso })
            .in("id", solved.slice(i, i + 200));
    }
    return { created: inserts.length, auto_closed: solved.length };
}

/* ================================================================== */
/* Звіт                                                                */
/* ================================================================== */

async function buildReport(kind: "daily" | "weekly" | "manual", by: string) {
    const settings = await loadSettings();
    const data = await collect();
    const findings = analyze(data, settings);
    const m = metrics(data, findings, settings);
    const ai = await aiSummary(kind, m, findings);
    const summary = ai || plainSummary(m, findings);

    const { data: rep, error } = await db.from("rop_reports").insert({
        kind,
        report_date: kyivNow().date,
        metrics: m,
        summary,
        ai_ok: !!ai,
        created_by: by,
    }).select("id").single();
    if (error) throw new Error("rop_reports: " + error.message);

    const tasks = await syncTasks(findings, rep.id);
    return { report_id: rep.id, ai: !!ai, problems: findings.length, tasks, warnings: m.data_warnings };
}

// Розклад: раз на день після daily_hour:daily_minute за Києвом; у weekly_day — тижневий
async function tick() {
    const s = await loadSettings();
    const k = kyivNow();
    if (k.hour * 60 + k.minute < s.daily_hour * 60 + s.daily_minute) return { skipped: "ще рано" };
    const kind = k.dow === s.weekly_day ? "weekly" : "daily";
    const { data: exist } = await db.from("rop_reports").select("id").eq("report_date", k.date).in("kind", ["daily", "weekly"]).limit(1);
    if (exist?.length) return { skipped: "звіт за сьогодні вже є" };
    return await buildReport(kind, "розклад");
}

/* ================================================================== */
/* Дії з сайту                                                         */
/* ================================================================== */

async function actionTask(body: Any, me: Any) {
    const status = body.status === "dismissed" ? "dismissed" : body.status === "done" ? "done" : null;
    if (!status || !body.id) return fail(400, "Невірні дані");
    const { data: t } = await db.from("rop_tasks").select("id, assignee_id, status").eq("id", body.id).maybeSingle();
    if (!t) return fail(404, "Задачу не знайдено");
    const mine = t.assignee_id && String(t.assignee_id) === String(me.id);
    if (!mine && !isBoss(me)) return fail(403, "Це не ваша задача");
    const nowIso = new Date().toISOString();
    const comment = clip(body.comment, 300);
    await db.from("rop_tasks").update({
        status,
        closed_by: me.full_name + (comment ? `: ${comment}` : ""),
        closed_at: nowIso,
        updated_at: nowIso,
    }).eq("id", t.id);
    return ok();
}

async function actionAssign(body: Any, me: Any) {
    if (!isBoss(me)) return fail(403, "Лише для керівника");
    const { data: t } = await db.from("rop_tasks").select("*").eq("id", body.task_id).maybeSingle();
    if (!t || t.kind !== "assign_lead") return fail(404, "Задачу не знайдено");
    const staffId = String(body.staff_id || t.suggestion?.staff_id || "");
    const { data: st } = await db.from("staff").select("id, full_name, active").eq("id", staffId).maybeSingle();
    if (!st?.active) return fail(400, "Співробітника не знайдено");
    const { data: lead } = await db.from("leads").select("id, history").eq("id", t.entity_id).maybeSingle();
    if (!lead) return fail(404, "Лід не знайдено");
    const history = Array.isArray(lead.history) ? [...lead.history] : [];
    history.push({ at: new Date().toISOString(), author: me.full_name, text: `Відповідальний: ${st.full_name} (через РОП)`, auto: true });
    const { error } = await db.from("leads").update({ sales_id: st.id, sales: st.full_name, history }).eq("id", lead.id);
    if (error) return fail(500, "Не вдалося оновити лід: " + error.message);
    const nowIso = new Date().toISOString();
    await db.from("rop_tasks").update({ status: "done", closed_by: `${me.full_name}: призначено ${st.full_name}`, closed_at: nowIso, updated_at: nowIso }).eq("id", t.id);
    return ok({ staff_name: st.full_name });
}

async function actionSettings(body: Any, me: Any) {
    if (!isBoss(me)) return fail(403, "Лише для керівника");
    const cur = await loadSettings();
    for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
        if (body.settings?.[k] === undefined) continue;
        const v = Number(body.settings[k]);
        if (!isFinite(v)) continue;
        cur[k] = Math.min(hi, Math.max(lo, Math.round(v)));
    }
    const { error } = await db.from("rop_settings").upsert({ id: 1, settings: cur, updated_by: me.full_name, updated_at: new Date().toISOString() });
    if (error) return fail(500, error.message);
    return ok({ settings: cur });
}

/* ================================================================== */

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const url = new URL(req.url);
    if (req.method !== "POST") return new Response("FURA ROP agent is running");

    let body: Any;
    try {
        body = await req.json();
    } catch {
        return json(400, { error: "bad request" });
    }

    try {
        if (body.action === "tick") {
            if (!secretOk(req, url)) return json(403, { error: "forbidden" });
            return json(200, await tick());
        }

        const me = await staffFromRequest(req);
        if (!me) return json(403, { error: "Вас немає серед співробітників FURA" });

        let out: { status: number; data: Any };
        switch (body.action) {
            case "run":
                if (!isBoss(me)) return json(403, { error: "Лише для керівника" });
                out = ok(await buildReport(body.kind === "weekly" ? "weekly" : "manual", me.full_name));
                break;
            case "task": out = await actionTask(body, me); break;
            case "assign": out = await actionAssign(body, me); break;
            case "settings": out = await actionSettings(body, me); break;
            case "status":
                out = ok({ ai: !!AI_KEY, cron: !!CRON_SECRET, boss: isBoss(me), model: MODEL });
                break;
            default: out = fail(400, "unknown action");
        }
        return json(out.status, out.data);
    } catch (e) {
        console.error(e);
        return json(500, { error: "Помилка сервера. Спробуйте ще раз." });
    }
});
