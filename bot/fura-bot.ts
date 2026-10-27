// FURA — Telegram-бот (Supabase Edge Function "fura-bot")
//
//  /start     — прив'язати Telegram до співробітника (за @ніком)
//  /new       — форма нового запиту (Mini App)
//  /requests  — запити без відповіді (кнопки "Відповісти")
//
//  Новий запит         → логісту, кнопка "💬 Відповісти" відкриває форму відповіді
//  Запит можна надіслати кільком логістам — кожен дає свої ціни
//  Відповідь логіста   → Sales, кнопки "✅ Обрати" / "❌ Відмова"
//  Зміна статусу       → Sales і логістам
//  Переписка по запиту → Sales і логістам запиту, кнопка "✍️ Відповісти"
//
//  Перевізник (через /start c_<код>) → його повідомлення читає AI-агент (функція fura-agent)
//
// Секрети: TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET
// Необов'язково: CRM_URL, APP_URL (адреса сайту на GitHub Pages)

import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const APP_URL = (
    Deno.env.get("APP_URL") ??
    "https://romanmokeychuk.github.io/logistics-crm"
).replace(/\/$/, "");
const CRM_URL = Deno.env.get("CRM_URL") ?? `${APP_URL}/requests.html`;

const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const MAX_OFFERS = 3;
const CURRENCIES = ["EUR", "USD", "UAH"];
const STATUS_NEW = "Запит";
const STATUS_QUOTE = "Відповідь"; // логіст дав ціни
const STATUS_OK = "В роботі"; // Sales обрав пропозицію
const STATUS_NO = "Відмова";

// Причини відмови (як у CRM). Код — у кнопці: "no:<запит>:<код>"
const REFUSAL_REASONS: Record<string, string> = {
    c: "💸 Знайшов дешевше",
    p: "🏷️ Не підійшла ціна",
    k: "🤝 Закрив клієнт",
    n: "🚫 Не актуально",
};
const reasonText = (code: string) => (REFUSAL_REASONS[code] || "").replace(/^\S+\s/, "");
const refusalLine = (r: Any) =>
    r.refusal_reason ? `\n<b>Причина:</b> ${esc(r.refusal_reason)}${r.refusal_comment ? ` — ${esc(r.refusal_comment)}` : ""}` : "";

// Тип запиту — обирає Sales
const REQUEST_TYPES = ["Прорахунок", "Пошук авто", "Завантаження"];
const TYPE_ICONS: Record<string, string> = {
    "Прорахунок": "🧮",
    "Пошук авто": "🔎",
    "Завантаження": "📦",
};

function typeLabel(type: unknown): string {
    const t = String(type || "");
    return t ? `${TYPE_ICONS[t] || "📄"} ${esc(t)}` : "";
}

// deno-lint-ignore no-explicit-any
type Any = any;

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
        "content-type, authorization, apikey, x-client-info",
};

/* ================================================================== */
/* Telegram                                                            */
/* ================================================================== */

async function tg(method: string, body: Record<string, unknown>) {
    const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        },
    );
    if (!res.ok) console.error(`Telegram ${method}:`, await res.text());
    return res;
}

type Button = {
    text: string;
    url?: string;
    callback_data?: string;
    web_app?: { url: string };
};

const crmButton: Button = { text: "📋 Відкрити в CRM", url: CRM_URL };
const newRequestButton: Button = {
    text: "➕ Новий запит",
    web_app: { url: `${APP_URL}/tg-request.html` },
};
const answerButton = (id: string): Button => ({
    text: "💬 Відповісти",
    web_app: { url: `${APP_URL}/tg-answer.html?id=${id}` },
});

const chatButton = (id: string, text = "✍️ Написати по запиту"): Button => ({
    text,
    callback_data: `chat:${id}`,
});
const crmOpenButton = (id: string): Button => ({
    text: "📋 Відкрити в CRM",
    url: `${CRM_URL}?open=${id}`,
});

function send(chatId: number, text: string, rows: Button[][] = []) {
    const body: Record<string, unknown> = {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
    };
    if (rows.length) body.reply_markup = { inline_keyboard: rows };
    return tg("sendMessage", body);
}

/* ================================================================== */
/* Форматування                                                        */
/* ================================================================== */

function esc(value: unknown): string {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function fmtDate(value: unknown): string {
    if (!value) return "";
    const [y, m, d] = String(value).slice(0, 10).split("-");
    return y && m && d ? `${d}.${m}.${y}` : "";
}

function fmtPeriod(from: unknown, to: unknown): string {
    const f = fmtDate(from);
    if (!f) return "";
    const t = fmtDate(to);
    if (!t || t === f) return f;
    const [fd, fm, fy] = f.split(".");
    const [td, tm, ty] = t.split(".");
    if (fy === ty && fm === tm) return `${fd}–${td}.${tm}.${ty}`;
    if (fy === ty) return `${fd}.${fm}–${td}.${tm}.${ty}`;
    return `${f} – ${t}`;
}

function fmtPrice(price: unknown): string {
    const s = String(price ?? "").trim();
    if (/^\d+([.,]\d+)?$/.test(s)) {
        return Number(s.replace(",", "."))
            .toLocaleString("uk-UA")
            .replace(/ /g, " ");
    }
    return s;
}

function place(country: unknown, address: unknown): string {
    const c = esc(country);
    const a = esc(address);
    if (c && a) return `${c} (${a})`;
    return c || a || "—";
}

function route(r: Any): string {
    return `${esc(r.load_country || "—")} → ${esc(r.unload_country || "—")}`;
}

function requestSummary(r: Any): string {
    const lines = [
        ...(r.request_type ? [`<b>Тип:</b> ${typeLabel(r.request_type)}`] : []),
        `<b>Клієнт:</b> ${esc(r.client)}`,
        `<b>Маршрут:</b> ${place(r.load_country, r.load_address)} → ${place(r.unload_country, r.unload_address)}`,
    ];
    const cargo = [r.cargo, r.transport_type, r.weight]
        .filter(Boolean)
        .map(esc)
        .join(" · ");
    if (cargo) lines.push(`<b>Вантаж:</b> ${cargo}`);
    const date = fmtPeriod(r.desired_date, r.desired_date_to);
    if (date) lines.push(`<b>Бажана дата:</b> ${date}`);
    const customs = [
        r.customs_export && `замитнення: ${esc(r.customs_export)}`,
        r.border_crossing && `кордон: ${esc(r.border_crossing)}`,
        r.customs_import && `розмитнення: ${esc(r.customs_import)}`,
    ].filter(Boolean);
    if (customs.length) lines.push(`<b>Митниця:</b> ${customs.join(" · ")}`);
    if (r.sales) lines.push(`<b>Sales:</b> ${esc(r.sales)}`);
    if (r.notes) lines.push(`<b>Нотатки:</b> ${esc(r.notes)}`);
    return lines.join("\n");
}

function offerLine(o: Any, i: number): string {
    const parts = [
        o.price
            ? `<b>${esc(fmtPrice(o.price))} ${esc(o.currency || "")}</b>`
            : "ціна не вказана",
    ];
    if (o.date_flexible) parts.push("плаваюча дата");
    else if (o.date) parts.push(`авто ${fmtPeriod(o.date, o.date_to)}`);
    if (o.comment) parts.push(esc(o.comment));
    if (o.carrier) parts.push(`🚚 ${esc(o.carrier)}`);
    return `${i + 1}) ${parts.join(" · ")}`;
}

// Обраний варіант ціни одним рядком (для повідомлень про вибір)
function chosenLine(r: Any): string {
    const c = r?.chosen_offer;
    if (!c || String(c.logist_id) !== String(r.logistician_id)) return "";
    return `\n<b>Обраний варіант:</b> ${offerLine(c, Number(c.index) || 0)}`;
}

function answerText(r: Any, a: Any): string {
    const lines = [
        `🟢 <b>Відповідь логіста${a.logist ? ` ${esc(a.logist)}` : ""}</b>`,
        ...(r.request_type ? [`<b>Тип:</b> ${typeLabel(r.request_type)}`] : []),
        `<b>Клієнт:</b> ${esc(r.client)}`,
        `<b>Маршрут:</b> ${route(r)}`,
        "",
        ...(a.offers || []).map(offerLine),
    ];
    if (a.notes) lines.push("", `💬 ${esc(a.notes)}`);
    return lines.join("\n");
}

/* ================================================================== */
/* Дані                                                                */
/* ================================================================== */

async function staffByChat(chatId: number) {
    const { data } = await db
        .from("staff")
        .select("*")
        .eq("telegram_chat_id", chatId)
        .eq("active", true)
        .maybeSingle();
    return data;
}

async function staffIdByChat(chatId: number): Promise<string | null> {
    const { data } = await db.from("staff").select("id").eq("telegram_chat_id", chatId).maybeSingle();
    return data?.id ? String(data.id) : null;
}

async function chatIdOf(staffId: unknown): Promise<number | null> {
    if (!staffId) return null;
    const { data } = await db
        .from("staff")
        .select("telegram_chat_id, active")
        .eq("id", staffId)
        .maybeSingle();
    return data?.active && data.telegram_chat_id
        ? Number(data.telegram_chat_id)
        : null;
}

async function getRequest(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { data } = await db
        .from("requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();
    return data;
}

// Усі логісти, кому надіслано запит
function logistIdsOf(r: Any): string[] {
    if (Array.isArray(r?.logistician_ids) && r.logistician_ids.length) {
        return r.logistician_ids.map(String);
    }
    return r?.logistician_id ? [String(r.logistician_id)] : [];
}

// Відповіді по логістах (старі запити — з offers / logist_notes)
function getAnswers(r: Any): Any[] {
    if (Array.isArray(r?.answers) && r.answers.length) return r.answers;
    const offers = Array.isArray(r?.offers) ? r.offers : [];
    if (!offers.length && !r?.logist_notes) return [];
    return [{
        logist_id: r.logistician_id || null,
        logist: r.logistician || "",
        offers,
        notes: r.logist_notes || null,
        at: r.answered_at || null,
    }];
}

// Ролі співробітника: roles (кілька, напр. логіст + sales) або стара role
function rolesOf(s: Any): string[] {
    return Array.isArray(s?.roles) && s.roles.length ? s.roles : s?.role ? [s.role] : [];
}
function hasRole(s: Any, ...list: string[]) {
    return rolesOf(s).some((r) => list.includes(r));
}

// Хто може відповідати / обирати
function canAnswer(me: Any, r: Any) {
    const ids = logistIdsOf(r);
    return (
        hasRole(me, "head", "admin") ||
        ids.includes(String(me.id)) ||
        (!ids.length && hasRole(me, "logist"))
    );
}

function canDecide(me: Any, r: Any) {
    return hasRole(me, "head", "admin") || String(r.sales_id || "") === String(me.id);
}

/* ================================================================== */
/* Перевірка, що форму відкрили саме з Telegram (initData)            */
/* ================================================================== */

const enc = new TextEncoder();

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
    const k = await crypto.subtle.importKey(
        "raw",
        key,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Повертає Telegram id користувача або null, якщо підпис неправильний
async function verifyInitData(initData: string): Promise<number | null> {
    if (!initData || !BOT_TOKEN) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    const pairs: string[] = [];
    params.forEach((value, key) => {
        if (key !== "hash") pairs.push(`${key}=${value}`);
    });
    pairs.sort();

    const secret = await hmac(enc.encode("WebAppData"), BOT_TOKEN);
    const check = toHex(await hmac(secret, pairs.join("\n")));
    if (check !== hash) return null;

    // Форма дійсна 24 години після відкриття
    const authDate = Number(params.get("auth_date") || 0);
    if (!authDate || Date.now() / 1000 - authDate > 24 * 3600) return null;

    try {
        const user = JSON.parse(params.get("user") || "{}");
        return user.id ? Number(user.id) : null;
    } catch {
        return null;
    }
}

/* ================================================================== */
/* Очищення даних з форм                                               */
/* ================================================================== */

function str(v: unknown, max = 300): string | null {
    const s = String(v ?? "").trim().slice(0, max);
    return s || null;
}

function isoDate(v: unknown): string | null {
    const s = String(v ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// Кінцева дата періоду — тільки якщо пізніше за початкову
function periodEnd(from: string | null, to: unknown): string | null {
    const t = isoDate(to);
    return from && t && t > from ? t : null;
}

/* ================================================================== */
/* API для форм (Mini App)                                             */
/* ================================================================== */

async function miniApi(body: Any): Promise<{ status: number; data: Any }> {
    const userId = await verifyInitData(String(body.initData || ""));
    if (!userId) {
        return {
            status: 401,
            data: { error: "Відкрийте форму через Telegram-бота FURA (або закрийте й відкрийте її знову)." },
        };
    }

    const me = await staffByChat(userId);
    if (!me) {
        return {
            status: 403,
            data: { error: "Вас немає у списку співробітників FURA. Натисніть /start у боті." },
        };
    }

    // Дані для форми нового запиту
    if (body.action === "bootstrap") {
        const { data: people } = await db
            .from("staff")
            .select("id, full_name, role, roles")
            .eq("active", true)
            .order("full_name");
        const logists = (people || [])
            .filter((x: Any) => hasRole(x, "logist", "head"))
            .map((x: Any) => ({ id: x.id, full_name: x.full_name }));
        return {
            status: 200,
            data: { me: { id: me.id, full_name: me.full_name, role: me.role, roles: rolesOf(me) }, logists },
        };
    }

    // Дані запиту для форми відповіді
    if (body.action === "get_request") {
        const r = await getRequest(String(body.id || ""));
        if (!r) return { status: 404, data: { error: "Запит не знайдено — можливо, його видалили." } };
        const myAnswer =
            getAnswers(r).find((a) => String(a.logist_id) === String(me.id)) || null;
        return {
            status: 200,
            data: {
                request: r,
                my_answer: myAnswer,
                can_answer: canAnswer(me, r),
                me: { full_name: me.full_name, role: me.role, roles: rolesOf(me) },
            },
        };
    }

    // Зберегти відповідь логіста
    if (body.action === "save_answer") {
        const r = await getRequest(String(body.id || ""));
        if (!r) return { status: 404, data: { error: "Запит не знайдено." } };
        if (!canAnswer(me, r)) return { status: 403, data: { error: "Цей запит призначено іншому логісту." } };

        const offers = (Array.isArray(body.offers) ? body.offers : [])
            .slice(0, MAX_OFFERS)
            .map((o: Any) => {
                const date = isoDate(o?.date);
                return {
                    price: str(o?.price, 40) || "",
                    currency: CURRENCIES.includes(o?.currency) ? o.currency : "EUR",
                    date,
                    date_to: periodEnd(date, o?.date_to),
                    comment: str(o?.comment, 300) || "",
                    carrier: str(o?.carrier, 200) || null,
                };
            })
            .filter((o: Any) => o.price || o.date || o.comment || o.carrier);

        const notes = str(body.notes, 1000);
        if (!offers.length && !notes) {
            return { status: 400, data: { error: "Вкажіть хоча б одну ціну або нотатку." } };
        }

        // Моя відповідь замінює тільки мою — відповіді інших логістів лишаються
        const answers = [
            ...getAnswers(r).filter((a) => String(a.logist_id) !== String(me.id)),
            { logist_id: me.id, logist: me.full_name, offers, notes, at: new Date().toISOString() },
        ];

        const update: Record<string, unknown> = {
            answers,
            offers: answers.flatMap((a) =>
                (a.offers || []).map((o: Any) => ({ ...o, logist: a.logist })),
            ),
            logist_notes:
                answers
                    .filter((a) => a.notes)
                    .map((a) => (answers.length > 1 ? `${a.logist}: ${a.notes}` : a.notes))
                    .join("\n") || null,
        };
        if (r.status === STATUS_NEW) update.status = STATUS_QUOTE;

        const ids = logistIdsOf(r);
        if (!ids.includes(String(me.id))) {
            update.logistician_ids = [...ids, me.id];
            if (!r.logistician_id) {
                update.logistician_id = me.id;
                update.logistician = me.full_name;
            }
        }

        const { error } = await db.from("requests").update(update).eq("id", r.id);
        if (error) {
            console.error(error);
            return { status: 500, data: { error: "Не вдалося зберегти. Спробуйте ще раз." } };
        }

        await send(
            userId,
            `✅ <b>Відповідь надіслано Sales</b>\n${esc(r.client)} · ${route(r)}\n\n${offers.map(offerLine).join("\n")}${notes ? `\n\n💬 ${esc(notes)}` : ""}`,
            [[crmButton]],
        );
        return { status: 200, data: { ok: true } };
    }

    // Створити новий запит
    if (body.action === "create_request") {
        const f = body.fields || {};
        const client = str(f.client, 200);
        if (!client) return { status: 400, data: { error: "Вкажіть клієнта." } };
        const requestType = REQUEST_TYPES.includes(f.request_type) ? f.request_type : null;
        if (!requestType) return { status: 400, data: { error: "Оберіть тип запиту." } };

        // Тільки справжні активні логісти зі списку співробітників
        const wanted = (Array.isArray(f.logistician_ids) ? f.logistician_ids : [])
            .map(String)
            .filter((id: string) => /^[0-9a-f-]{36}$/i.test(id))
            .slice(0, 50);
        let logists: Any[] = [];
        if (wanted.length) {
            const { data } = await db
                .from("staff")
                .select("id, full_name, role, roles, active")
                .in("id", wanted);
            logists = (data || [])
                .filter((x: Any) => x.active && hasRole(x, "logist", "head"))
                .sort((a: Any, b: Any) => wanted.indexOf(a.id) - wanted.indexOf(b.id));
        }

        const desired = isoDate(f.desired_date);
        const record = {
            client,
            request_type: requestType,
            cargo: str(f.cargo),
            transport_type: str(f.transport_type, 60),
            weight: str(f.weight, 60),
            load_country: str(f.load_country, 60),
            load_address: str(f.load_address),
            unload_country: str(f.unload_country, 60),
            unload_address: str(f.unload_address),
            customs_export: str(f.customs_export),
            border_crossing: str(f.border_crossing),
            customs_import: str(f.customs_import),
            desired_date: desired,
            desired_date_to: periodEnd(desired, f.desired_date_to),
            notes: str(f.notes, 1000),
            status: STATUS_NEW,
            sales_id: me.id,
            sales: me.full_name,
            logistician_ids: logists.map((x) => x.id),
            logistician_id: logists[0]?.id || null,
            logistician: logists.map((x) => x.full_name).join(", ") || null,
        };

        const { data: created, error } = await db
            .from("requests")
            .insert([record])
            .select()
            .maybeSingle();
        if (error || !created) {
            console.error(error);
            return { status: 500, data: { error: "Не вдалося створити запит. Спробуйте ще раз." } };
        }

        // Логісту сповіщення піде автоматично (тригер у базі)
        await send(
            userId,
            `✅ <b>Запит створено</b>${logists.length ? `\nНадіслано: <b>${esc(logists.map((x) => x.full_name).join(", "))}</b>` : ""}\n\n${requestSummary(created)}`,
            [[crmButton]],
        );
        return { status: 200, data: { ok: true } };
    }

    return { status: 400, data: { error: "Невідома дія." } };
}

/* ================================================================== */
/* Рішення Sales: підтвердити / відмова                                */
/* ================================================================== */

async function decide(
    chatId: number,
    me: Any,
    data: string, // "ok:<запит>:<логіст>[:<номер варіанту>]" або "no:<запит>"
    messageId?: number,
): Promise<string> {
    const [kind, requestId, logistPrefix, offerNo] = data.split(":");
    const r = await getRequest(requestId || "");
    if (!r) return "Запит не знайдено";
    if (!canDecide(me, r)) return "Це не ваш запит";

    // «❌ Відмова» без причини — спершу питаємо причину окремим повідомленням
    if (kind === "no" && !REFUSAL_REASONS[logistPrefix || ""]) {
        if (r.status === STATUS_NO) return "Відмову вже поставлено";
        await send(
            chatId,
            `❌ <b>Чому відмова?</b>\n${esc(r.client || "")} · ${route(r)}`,
            Object.entries(REFUSAL_REASONS).map(([code, text]) => [{ text, callback_data: `no:${r.id}:${code}` }]),
        );
        return "Оберіть причину";
    }

    const update: Record<string, unknown> = {};
    if (kind === "ok") {
        const a = getAnswers(r).find((x) =>
            String(x.logist_id || "").startsWith(logistPrefix || "-"),
        );
        if (!a) return "Відповідь логіста не знайдено";
        update.status = STATUS_OK;
        update.logistician_id = a.logist_id;
        update.logistician = a.logist;
        const idx = offerNo !== undefined ? Number(offerNo) : (a.offers || []).length === 1 ? 0 : NaN;
        const o = Number.isInteger(idx) ? (a.offers || [])[idx] : null;
        if (o) {
            update.chosen_offer = {
                logist_id: a.logist_id,
                logist: a.logist,
                index: idx,
                price: o.price ?? null,
                currency: o.currency || null,
                date: o.date || null,
                date_to: o.date_to || null,
                date_flexible: !!o.date_flexible,
                comment: o.comment || null,
                carrier: o.carrier || null,
                carrier_id: o.carrier_id || null,
                at: new Date().toISOString(),
            };
        }
    } else {
        update.status = STATUS_NO;
        update.refusal_reason = reasonText(logistPrefix || "");
        update.refused_at = new Date().toISOString();
        update.refused_by = me.full_name || null;
    }
    let { error } = await db.from("requests").update(update).eq("id", r.id);
    if (error && update.refusal_reason && /refus/.test(error.message || "")) {
        // Колонок причини ще немає (requests_refusal.sql) — ставимо відмову без причини
        delete update.refusal_reason;
        delete update.refused_at;
        delete update.refused_by;
        ({ error } = await db.from("requests").update(update).eq("id", r.id));
    }
    if (error && update.chosen_offer) {
        // Колонки chosen_offer ще немає — обираємо хоча б логіста
        delete update.chosen_offer;
        ({ error } = await db.from("requests").update(update).eq("id", r.id));
    }
    if (error) {
        console.error(error);
        return "Не вдалося зберегти, спробуйте ще раз";
    }

    // Прибираємо кнопки, щоб не натиснути двічі
    if (messageId) {
        await tg("editMessageReplyMarkup", {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[crmButton]] },
        });
    }
    // Повідомлення про новий статус прийдуть усім автоматично (тригер у базі)
    const co = update.chosen_offer as Any;
    return kind === "ok"
        ? `Обрано: ${update.logistician}${co ? ` · ${fmtPrice(co.price)} ${co.currency || ""}` : ""}`
        : `Відмова збережена${update.refusal_reason ? `: ${update.refusal_reason}` : ""}`;
}

/* ================================================================== */
/* /requests — запити без відповіді                                    */
/* ================================================================== */

async function listOpen(chatId: number, me: Any) {
    const q = db
        .from("requests")
        .select("id, client, load_country, unload_country, status, sales_id, logistician_id, logistician_ids, answers, offers, logist_notes, logistician, answered_at")
        .in("status", [STATUS_NEW, STATUS_QUOTE])
        .order("created_at", { ascending: true })
        .limit(60);
    const { data } = await q;

    const answeredByMe = (r: Any) =>
        getAnswers(r).some((a) => String(a.logist_id) === String(me.id));
    const isHead = hasRole(me, "head", "admin");
    const isLogist = hasRole(me, "logist");
    const isSales = hasRole(me, "sales");

    // Одна людина може мати кілька ролей — показуємо все, що її стосується
    const list = (data || [])
        .filter((r: Any) => {
            const ids = logistIdsOf(r);
            const mineAsLogist =
                (ids.includes(String(me.id)) || (!ids.length && isLogist)) && !answeredByMe(r);
            if ((isLogist || isHead) && mineAsLogist) return true;
            if (isHead && r.status === STATUS_NEW) return true;
            if (isSales && String(r.sales_id) === String(me.id) && r.status === STATUS_NEW) return true;
            return false;
        })
        .slice(0, 15);

    if (!list.length) {
        return send(chatId, "🎉 Запитів без відповіді немає.", [[crmButton]]);
    }

    const rows: Button[][] = list.map((r: Any) => {
        const label = `${r.client} · ${r.load_country || "—"} → ${r.unload_country || "—"}`;
        return [
            canAnswer(me, r)
                ? { ...answerButton(r.id), text: `💬 ${label}` }
                : { text: `🟡 ${label}`, url: CRM_URL },
        ];
    });
    rows.push([crmButton]);

    const canReply = hasRole(me, "logist", "head", "admin");
    return send(
        chatId,
        canReply
            ? `🟡 <b>Чекають вашої відповіді: ${list.length}</b>\nНатисніть запит, щоб відповісти:`
            : `🟡 <b>Ваші запити без відповіді: ${list.length}</b>`,
        rows,
    );
}

/* ================================================================== */
/* Повідомлення і кнопки в боті                                        */
/* ================================================================== */

async function handleStart(chatId: number, username: string) {
    if (!username) {
        return send(
            chatId,
            "❗ У вашому Telegram немає @ніка.\nДодайте його: Налаштування → Ім'я користувача, і натисніть /start ще раз.",
        );
    }

    const { data: staffList } = await db
        .from("staff")
        .select("id, full_name, telegram_username, active");
    const me = (staffList || []).find(
        (s: Any) =>
            s.active &&
            String(s.telegram_username || "").replace(/^@/, "").toLowerCase() ===
                username,
    );

    if (!me) {
        return send(
            chatId,
            `❌ @${esc(username)} немає у списку співробітників FURA.\nПопросіть керівника додати ваш Telegram на сторінці «Співробітники».`,
        );
    }

    await db.from("staff").update({ telegram_chat_id: chatId }).eq("id", me.id);

    // Меню команд і кнопка "Новий запит" біля поля вводу
    await tg("setMyCommands", {
        commands: [
            { command: "new", description: "Новий запит" },
            { command: "requests", description: "Запити без відповіді" },
        ],
    });
    await tg("setChatMenuButton", {
        chat_id: chatId,
        menu_button: {
            type: "web_app",
            text: "Новий запит",
            web_app: { url: `${APP_URL}/tg-request.html` },
        },
    });

    return send(
        chatId,
        `✅ Вітаю, <b>${esc(me.full_name)}</b>!\nБота підключено.\n\n/new — новий запит\n/requests — запити без відповіді`,
        [[newRequestButton], [crmButton]],
    );
}

// AI-агент ставок живе в окремій функції fura-agent (bot/fura-agent.ts)
async function callAgent(payload: Any): Promise<Any> {
    try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/fura-agent`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
                "x-webhook-secret": WEBHOOK_SECRET,
            },
            body: JSON.stringify(payload),
        });
        return await res.json().catch(() => null);
    } catch (e) {
        console.error("fura-agent:", e);
        return null;
    }
}

async function handleMessage(msg: Any) {
    const chatId = Number(msg.chat.id);
    const username = String(msg.from?.username || "").toLowerCase();
    const text = String(msg.text || "").trim();

    // Перевізник відкрив посилання-запрошення: /start c_<код>
    const invite = text.match(/^\/start\s+c_([A-Za-z0-9]+)/);
    if (invite) {
        await callAgent({ action: "link", chat_id: chatId, code: invite[1] });
        return;
    }

    if (text.startsWith("/start")) return handleStart(chatId, username);

    const me = await staffByChat(chatId);
    if (!me) {
        // Може, це перевізник — тоді повідомлення читає AI-агент ставок
        const agent = await callAgent({
            action: "inbound",
            chat_id: chatId,
            text: text || String(msg.caption || "").trim(),
            message_id: msg.message_id,
        });
        if (agent?.handled) return;
        return send(chatId, "❌ Вас немає у списку співробітників FURA. Натисніть /start.");
    }

    if (text.startsWith("/requests")) return listOpen(chatId, me);

    // Людина натиснула "✍️ Написати" — цей текст іде в переписку по запиту
    if (text && !text.startsWith("/")) {
        const sent = await saveChatFromBot(chatId, me, text);
        if (sent) return;
    }

    // /new або будь-який інший текст — пропонуємо форму
    return send(
        chatId,
        text.startsWith("/new")
            ? "Заповніть форму запиту 👇"
            : "Новий запит — кнопкою нижче, відповісти на запит — /requests.",
        [[newRequestButton], [crmButton]],
    );
}

async function handleCallback(cb: Any) {
    const chatId = Number(cb.message?.chat?.id);
    const messageId = cb.message?.message_id;
    const data = String(cb.data || "");

    const me = await staffByChat(chatId);
    let toast = "";
    if (!me) {
        toast = "Вас немає у списку співробітників FURA";
    } else if (data.startsWith("ok:") || data.startsWith("no:")) {
        toast = await decide(chatId, me, data, messageId);
    } else if (data.startsWith("chat:")) {
        toast = await startChat(chatId, me, data.slice(5));
    }

    // Telegram чекає підтвердження натискання (коротке спливаюче повідомлення)
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: toast });
}

/* ================================================================== */
/* Переписка по запиту (Sales ↔ логісти)                               */
/* ================================================================== */

const CHAT_WAIT_MS = 30 * 60 * 1000; // скільки бот чекає текст після "Написати"

// Логіста обрано (запит у роботі) — далі тільки Sales ↔ обраний логіст
function isChosen(r: Any): boolean {
    return !!r?.logistician_id && ![STATUS_NEW, STATUS_QUOTE].includes(r.status);
}

// Хто бере участь у переписці: Sales + логісти запиту (або тільки обраний)
function participantsOf(r: Any): string[] {
    const logists = isChosen(r) ? [String(r.logistician_id)] : logistIdsOf(r);
    return [...new Set([String(r.sales_id || ""), ...logists].filter(Boolean))];
}

function canChat(me: Any, r: Any) {
    return hasRole(me, "head", "admin") || participantsOf(r).includes(String(me.id)) ||
        (!logistIdsOf(r).length && hasRole(me, "logist"));
}

async function getSession(chatId: number): Promise<Any> {
    const { data } = await db.from("bot_sessions").select("state, updated_at").eq("chat_id", chatId).maybeSingle();
    return data || null;
}

async function setSession(chatId: number, state: Any) {
    await db.from("bot_sessions").upsert({ chat_id: chatId, state, updated_at: new Date().toISOString() });
}

async function startChat(chatId: number, me: Any, requestId: string): Promise<string> {
    const r = await getRequest(requestId);
    if (!r) return "Запит не знайдено";
    if (!canChat(me, r)) {
        return isChosen(r)
            ? "Sales обрав іншого логіста — переписка тепер тільки з ним"
            : "Ви не берете участі в цьому запиті";
    }
    await setSession(chatId, { mode: "chat", request_id: r.id });
    await tg("sendMessage", {
        chat_id: chatId,
        parse_mode: "HTML",
        text: `✍️ Напишіть повідомлення по запиту\n<b>${esc(r.client)}</b> · ${route(r)}\n\nНаступне ваше повідомлення побачать усі учасники запиту.`,
        reply_markup: { force_reply: true, input_field_placeholder: "Ваше повідомлення…" },
    });
    return "";
}

async function saveChatFromBot(chatId: number, me: Any, text: string): Promise<boolean> {
    const sess = await getSession(chatId);
    const st = sess?.state || {};
    if (st.mode !== "chat" || !st.request_id) return false;
    if (Date.now() - new Date(sess.updated_at).getTime() > CHAT_WAIT_MS) {
        await setSession(chatId, {});
        return false;
    }
    await setSession(chatId, {});
    const r = await getRequest(String(st.request_id));
    if (!r || !canChat(me, r)) {
        await send(chatId, "❌ Не надіслано: Sales обрав іншого логіста — переписка тепер тільки з ним.");
        return true;
    }
    const { error } = await db.from("request_messages").insert({
        request_id: st.request_id,
        author_id: me.id,
        author_name: me.full_name,
        text: text.slice(0, 2000),
        via: "telegram",
    });
    if (error) {
        console.error(error);
        await send(chatId, "❌ Не вдалося надіслати. Спробуйте ще раз.");
    } else {
        await send(chatId, "✅ Надіслано", [[chatButton(st.request_id, "✍️ Написати ще")]]);
    }
    return true;
}

// Нове повідомлення в переписці (від тригера) → усім учасникам, крім автора
async function handleChatMessage(payload: Any) {
    const m = payload.record;
    if (payload.type !== "INSERT" || !m?.request_id) return;
    const r = await getRequest(String(m.request_id));
    if (!r) return;

    let ids = participantsOf(r);
    // Запит ще нікому з логістів не надіслано — повідомляємо всіх логістів
    if (!logistIdsOf(r).length) {
        const { data } = await db.from("staff").select("id, roles, role").eq("active", true);
        ids = [...new Set([...ids, ...(data || []).filter((s: Any) => hasRole(s, "logist")).map((s: Any) => String(s.id))])];
    }
    ids = ids.filter((id) => id !== String(m.author_id || ""));

    const text = `💬 <b>${esc(m.author_name || "Співробітник")}</b> · ${esc(r.client)} · ${route(r)}\n\n${esc(m.text)}`;
    for (const id of ids) {
        const chatId = await chatIdOf(id);
        if (!chatId) continue;
        await send(chatId, text, [[chatButton(r.id, "✍️ Відповісти")], [crmOpenButton(r.id)]]);
    }
}

/* ================================================================== */
/* Зміни в таблиці запитів (від тригера в базі)                        */
/* ================================================================== */

async function handleRequestChange(payload: Any) {
    const r = payload.record;
    const old = payload.old_record;
    if (!r) return;

    // 1. Новий запит або додали логістів → кожному новому логісту
    const oldIds = payload.type === "UPDATE" ? logistIdsOf(old) : [];
    // (крім того, хто сам щойно відповів і так потрапив у список)
    const newLogists = logistIdsOf(r).filter(
        (id) =>
            !oldIds.includes(id) &&
            !getAnswers(r).some((a) => String(a.logist_id) === id),
    );
    for (const id of newLogists) {
        const chatId = await chatIdOf(id);
        if (!chatId) continue;
        const title =
            payload.type === "INSERT"
                ? `🟡 <b>Новий запит</b>${r.request_type ? ` · ${typeLabel(r.request_type)}` : ""}`
                : `🟡 <b>Вам надіслано запит</b>${r.request_type ? ` · ${typeLabel(r.request_type)}` : ""}`;
        await send(chatId, `${title}\n\n${requestSummary(r)}`, [
            [answerButton(r.id)],
            [chatButton(r.id, "❓ Питання до Sales")],
            [crmButton],
        ]);
    }

    if (payload.type !== "UPDATE" || !old) return;

    // 2. Логіст дав або змінив відповідь → Sales (тільки ця відповідь)
    const oldAt = new Map(
        getAnswers(old).map((a) => [String(a.logist_id), String(a.at || "")]),
    );
    const changed = getAnswers(r).filter(
        (a) =>
            ((a.offers || []).length || a.notes) &&
            oldAt.get(String(a.logist_id)) !== String(a.at || ""),
    );
    if (changed.length) {
        const salesChat = await chatIdOf(r.sales_id);
        const canStillChoose = [STATUS_NEW, STATUS_QUOTE].includes(r.status);
        if (salesChat) {
            for (const a of changed) {
                const rows: Button[][] = [];
                if (canStillChoose) {
                    const offers = a.offers || [];
                    const lid = String(a.logist_id || "").slice(0, 8);
                    if (a.logist_id && offers.length > 1) {
                        // Окрема кнопка на кожен варіант ціни
                        offers.forEach((o: Any, i: number) => {
                            rows.push([{
                                text: `✅ ${i + 1}) ${o.price ? `${fmtPrice(o.price)} ${o.currency || ""}` : "без ціни"}${o.date ? ` · ${fmtDate(o.date)}` : ""}`,
                                callback_data: `ok:${r.id}:${lid}:${i}`,
                            }]);
                        });
                        rows.push([{ text: "❌ Відмова", callback_data: `no:${r.id}` }]);
                    } else {
                        rows.push([
                            ...(a.logist_id ? [{ text: "✅ Обрати", callback_data: `ok:${r.id}:${lid}` }] : []),
                            { text: "❌ Відмова", callback_data: `no:${r.id}` },
                        ]);
                    }
                }
                rows.push([chatButton(r.id, "❓ Питання до логіста")]);
                rows.push([crmButton]);
                await send(salesChat, answerText(r, a), rows);
            }
        }
    }

    // 3. Статус змінився (крім першої відповіді) → Sales і всім логістам запиту
    if (old.status !== r.status && ![STATUS_NEW, STATUS_QUOTE].includes(r.status)) {
        const head = `${esc(r.client)} · ${route(r)}`;
        const messages = new Map<number, string>();

        const salesChat = await chatIdOf(r.sales_id);
        if (salesChat) {
            messages.set(
                salesChat,
                r.status === STATUS_OK
                    ? `✅ <b>${esc(STATUS_OK)}</b>\n${head}\n<b>Логіст:</b> ${esc(r.logistician || "—")}${chosenLine(r)}`
                    : r.status === STATUS_NO
                    ? `❌ <b>Відмова</b>\n${head}${refusalLine(r)}`
                    : `🔄 Статус: <b>${esc(r.status)}</b>\n${head}`,
            );
        }

        for (const id of logistIdsOf(r)) {
            const chatId = await chatIdOf(id);
            if (!chatId) continue;
            let text: string;
            if (r.status === STATUS_OK) {
                text =
                    String(r.logistician_id) === id
                        ? `✅ <b>Sales обрав вашу пропозицію — запит у роботі</b>\n${head}${chosenLine(r)}${r.sales ? `\n<b>Sales:</b> ${esc(r.sales)}` : ""}`
                        : `ℹ️ <b>Sales обрав іншого логіста</b> (${esc(r.logistician || "—")})\n${head}`;
            } else if (r.status === STATUS_NO) {
                text = `❌ <b>Sales відмовився від запиту</b>\n${head}${refusalLine(r)}`;
            } else {
                text = `🔄 Статус: <b>${esc(r.status)}</b>\n${head}`;
            }
            messages.set(chatId, text); // одна людина — одне повідомлення
        }

        // Обрали логіста — Sales і обраному логісту кнопка переписки
        const chatIds = new Set<number>();
        if (r.status === STATUS_OK) {
            for (const id of participantsOf(r)) {
                const c = await chatIdOf(id);
                if (c) chatIds.add(c);
            }
        }
        for (const [chatId, text] of messages) {
            const rows: Button[][] = chatIds.has(chatId)
                ? [[chatButton(r.id, String(r.sales_id) === String(await staffIdByChat(chatId)) ? "✍️ Написати логісту" : "✍️ Написати Sales")], [crmButton]]
                : [[crmButton]];
            await send(chatId, text, rows);
        }
    }
}

/* ================================================================== */
/* Вхід                                                                */
/* ================================================================== */

function json(status: number, data: unknown) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS, "content-type": "application/json" },
    });
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return new Response("FURA bot is running");

    const fromTelegram =
        !!WEBHOOK_SECRET &&
        req.headers.get("x-telegram-bot-api-secret-token") === WEBHOOK_SECRET;
    const fromDatabase =
        !!WEBHOOK_SECRET && req.headers.get("x-webhook-secret") === WEBHOOK_SECRET;

    let body: Any;
    try {
        body = await req.json();
    } catch {
        return json(400, { error: "bad request" });
    }

    // Форми (Mini App): перевірка через підпис Telegram
    if (!fromTelegram && !fromDatabase) {
        if (!body?.action) return json(403, { error: "forbidden" });
        try {
            const { status, data } = await miniApi(body);
            return json(status, data);
        } catch (e) {
            console.error(e);
            return json(500, { error: "Помилка сервера. Спробуйте ще раз." });
        }
    }

    try {
        if (fromTelegram) {
            if (body.callback_query) await handleCallback(body.callback_query);
            else if (body.message?.chat) await handleMessage(body.message);
        } else if (fromDatabase && body.table === "requests") {
            await handleRequestChange(body);
        } else if (fromDatabase && body.table === "request_messages") {
            await handleChatMessage(body);
        }
    } catch (e) {
        console.error(e);
    }

    // Завжди 200, щоб Telegram не повторював те саме
    return new Response("ok");
});
