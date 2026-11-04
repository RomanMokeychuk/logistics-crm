// FURA — переписка з клієнтами (Supabase Edge Function "fura-comms")
//
// Збирає в одну стрічку робочу переписку з корпоративних каналів:
//   • Outlook  — Microsoft Graph: підписка на нові листи в ящиках Sales і логістів (вхідні й надіслані)
//   • Telegram — режим Telegram Business: менеджер підключає бот FURA до свого акаунта
//                (оновлення приходять у fura-bot, а він пересилає їх сюди)
//   • WhatsApp — WhatsApp Business + Cloud API (coexistence): менеджер пише з телефона, копія — сюди
//   • Viber    — бот компанії: клієнт пише боту, менеджер відповідає зі сторінки «Переписка»
//
// Кожне повідомлення → розмова (comm_threads) → прив'язка до ліда за телефоном / e-mail.
// Раз на 10 хв (розклад) Claude розбирає нові повідомлення: клієнт просить ставку / скаржиться,
// чи назвали ставку у відповіді, тон відповіді. Ці позначки й час відповіді використовує агент РОП.
//
// Секрети (Supabase → Edge Functions → Secrets):
//   COMMS_SECRET        — будь-який довгий випадковий рядок (розклад, пересилання з fura-bot, вебхуки)
//   ANTHROPIC_API_KEY   — уже є
//   COMPANY_DOMAINS     — ваші поштові домени через кому, напр. "grandar.com.ua" (внутрішні листи не збираємо)
// Outlook:  MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET   (реєстрація програми в Microsoft Entra)
// WhatsApp: WA_VERIFY_TOKEN (будь-який рядок для підтвердження вебхука в Meta),
//           WA_APP_SECRET (App Secret з Meta — перевірка підпису; якщо підключаєте через провайдера без підпису,
//           додайте до адреси вебхука ?key=<COMMS_SECRET>)
// Viber:    VIBER_TOKEN, VIBER_SENDER_NAME (напр. "Грандар"), VIBER_WELCOME (необов'язково — привітання)
// Telegram: TELEGRAM_BOT_TOKEN — уже є (той самий бот, що у fura-bot)
// Необов'язково: COMMS_MODEL (типово claude-haiku-5-5)
//
// Розгортання: supabase functions deploy fura-comms --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Any = any;

const env = (k: string, d = "") => Deno.env.get(k) ?? d;

const SUPABASE_URL = env("SUPABASE_URL");
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/fura-comms`;
const SECRET = env("COMMS_SECRET");
const AI_KEY = env("ANTHROPIC_API_KEY");
const AI_MODEL = env("COMMS_MODEL", "claude-haiku-5-5");
const COMPANY_DOMAINS = env("COMPANY_DOMAINS").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const MS_TENANT = env("MS_TENANT_ID");
const MS_CLIENT = env("MS_CLIENT_ID");
const MS_SECRET = env("MS_CLIENT_SECRET");
const WA_VERIFY = env("WA_VERIFY_TOKEN");
const WA_APP_SECRET = env("WA_APP_SECRET");
const VIBER_TOKEN = env("VIBER_TOKEN");
const VIBER_NAME = env("VIBER_SENDER_NAME", "Грандар");
const VIBER_WELCOME = env("VIBER_WELCOME");
const TG_TOKEN = env("TELEGRAM_BOT_TOKEN");

const db = createClient(SUPABASE_URL, env("SUPABASE_SERVICE_ROLE_KEY"));

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info, x-comms-secret",
};

function json(status: number, data: unknown) {
    return new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } });
}
const ok = (data: Any = { ok: true }) => ({ status: 200, data });
const fail = (status: number, error: string) => ({ status, data: { error } });

const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
const nowIso = () => new Date().toISOString();
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
// Телефон для порівняння: останні 9 цифр (UA: 067… / 38067… / +38067… → однаково)
const phoneKey = (s: unknown) => {
    const d = digits(s);
    return d.length >= 9 ? d.slice(-9) : "";
};
const emailKey = (s: unknown) => String(s ?? "").trim().toLowerCase();

// Фонова робота: відповісти каналу одразу (Graph чекає ≤ 3 с), обробити потім
function background(p: Promise<unknown>) {
    const rt = (globalThis as Any).EdgeRuntime;
    const guarded = p.catch((e) => console.error("background:", e));
    if (rt?.waitUntil) rt.waitUntil(guarded);
    return guarded;
}

/* ================================================================== */
/* Підписи й секрети                                                   */
/* ================================================================== */

async function hmacHex(secret: string, body: string): Promise<string> {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}
function secretOk(req: Request, url: URL) {
    if (!SECRET) return false;
    const given = req.headers.get("x-comms-secret") || url.searchParams.get("key") || "";
    return safeEqual(given, SECRET);
}
// clientState для Microsoft Graph (до 128 символів) — похідний від COMMS_SECRET
const clientState = async () => (await hmacHex(SECRET, "outlook-client-state")).slice(0, 64);

/* ================================================================== */
/* Хто викликає (сайт)                                                 */
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
    const { data: me } = await db.from("staff").select("*")
        .ilike("email", email.replace(/[\\%_]/g, (ch) => "\\" + ch)).eq("active", true).maybeSingle();
    return me || null;
}

/* ================================================================== */
/* Збереження повідомлень                                              */
/* ================================================================== */

type Incoming = {
    channel: "outlook" | "telegram" | "whatsapp" | "viber";
    channelRow: Any | null;      // запис comm_channels
    account: string;             // наш акаунт (ящик / id підключення / phone_number_id / 'bot')
    contact: string;             // контакт клієнта
    contactName?: string | null;
    externalId: string;
    direction: "in" | "out";
    sentAt: string;
    text?: string | null;
    subject?: string | null;
    kind?: string;
    staffId?: string | null;     // для відповідей зі сторінки (Viber)
};

async function saveMessage(m: Incoming): Promise<{ saved: boolean; thread_id?: string }> {
    const key = `${m.channel}:${m.account}:${m.contact}`;
    let { data: th } = await db.from("comm_threads").select("*").eq("thread_key", key).maybeSingle();
    if (!th) {
        const { data: created, error } = await db.from("comm_threads").insert({
            thread_key: key,
            channel: m.channel,
            channel_id: m.channelRow?.id ?? null,
            staff_id: m.channelRow?.staff_id ?? null,
            staff_name: m.channelRow?.staff_name ?? null,
            contact_handle: m.contact,
            contact_name: clip(m.contactName, 200) || null,
        }).select("*").single();
        if (error) {
            // Паралельний вебхук міг створити ту саму розмову
            const again = await db.from("comm_threads").select("*").eq("thread_key", key).maybeSingle();
            th = again.data;
            if (!th) throw new Error("comm_threads: " + error.message);
        } else th = created;
    } else if (m.contactName && !th.contact_name) {
        await db.from("comm_threads").update({ contact_name: clip(m.contactName, 200) }).eq("id", th.id);
    }

    const { error } = await db.from("comm_messages").insert({
        thread_id: th.id,
        channel: m.channel,
        external_id: clip(m.externalId, 300),
        direction: m.direction,
        staff_id: m.direction === "out" ? (m.staffId ?? th.staff_id ?? null) : null,
        sent_at: m.sentAt,
        subject: clip(m.subject, 300) || null,
        text: clip(m.text, 6000) || null,
        kind: m.kind || "text",
    });
    if (error) {
        if (/duplicate|unique/i.test(error.message)) return { saved: false, thread_id: th.id }; // повтор від каналу
        throw new Error("comm_messages: " + error.message);
    }
    await recomputeThread(th.id);
    return { saved: true, thread_id: th.id };
}

// Підсумки розмови рахуємо з самих повідомлень — так історія, що приходить не по порядку, нічого не ламає
async function recomputeThread(threadId: string) {
    const { data: msgs } = await db.from("comm_messages").select("direction, sent_at, text, subject")
        .eq("thread_id", threadId).order("sent_at", { ascending: false }).limit(300);
    const list = msgs || [];
    if (!list.length) return;
    const lastIn = list.find((x: Any) => x.direction === "in");
    const lastOut = list.find((x: Any) => x.direction === "out");
    // Без відповіді з: найраніше вхідне після нашої останньої відповіді
    let unanswered: string | null = null;
    for (const x of list) {
        if (x.direction === "out") break;
        unanswered = x.sent_at;
    }
    const { count } = await db.from("comm_messages").select("id", { count: "exact", head: true }).eq("thread_id", threadId);
    const top = list[0];
    await db.from("comm_threads").update({
        last_message_at: top.sent_at,
        last_direction: top.direction,
        last_in_at: lastIn?.sent_at ?? null,
        last_out_at: lastOut?.sent_at ?? null,
        unanswered_since: unanswered,
        last_preview: clip(top.text || top.subject || "", 200),
        messages_count: count ?? list.length,
        updated_at: nowIso(),
    }).eq("id", threadId);
}

async function channelBy(channel: string, account: string): Promise<Any | null> {
    const { data } = await db.from("comm_channels").select("*").eq("channel", channel).eq("account", account).maybeSingle();
    return data || null;
}

/* ================================================================== */
/* Telegram Business (оновлення пересилає fura-bot)                    */
/* ================================================================== */

async function tgApi(method: string, params: Any) {
    if (!TG_TOKEN) return null;
    try {
        const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(params),
        });
        const j = await r.json();
        return j.ok ? j.result : null;
    } catch {
        return null;
    }
}

async function tgConnection(conn: Any): Promise<Any | null> {
    if (!conn?.id) return null;
    const ownerId = String(conn.user?.id ?? conn.user_chat_id ?? "");
    const { data: st } = await db.from("staff").select("id, full_name").eq("telegram_chat_id", conn.user_chat_id ?? conn.user?.id).maybeSingle();
    const label = conn.user?.username ? `@${conn.user.username}` : [conn.user?.first_name, conn.user?.last_name].filter(Boolean).join(" ");
    const row = {
        channel: "telegram",
        account: String(conn.id),
        account_label: clip(label, 120) || ownerId,
        staff_id: st?.id ? String(st.id) : null,
        staff_name: st?.full_name ?? null,
        active: conn.is_enabled !== false,
        meta: { owner_user_id: ownerId, can_reply: !!(conn.can_reply ?? conn.rights?.can_reply) },
        updated_at: nowIso(),
    };
    const { data } = await db.from("comm_channels").upsert(row, { onConflict: "channel,account" }).select("*").single();
    return data;
}

function tgText(msg: Any): { text: string; kind: string } {
    if (msg.text) return { text: msg.text, kind: "text" };
    const kinds: [string, string][] = [["photo", "image"], ["document", "document"], ["voice", "voice"], ["video", "other"], ["audio", "other"], ["sticker", "other"], ["location", "other"], ["contact", "other"]];
    for (const [k, kind] of kinds) if (msg[k]) return { text: msg.caption || `[${k}]`, kind };
    return { text: msg.caption || "[повідомлення]", kind: "other" };
}

async function handleTelegram(update: Any) {
    if (update.business_connection) {
        await tgConnection(update.business_connection);
        return;
    }
    const msg = update.business_message || update.edited_business_message;
    if (!msg?.business_connection_id || msg.chat?.type !== "private") return;

    let ch = await channelBy("telegram", String(msg.business_connection_id));
    if (!ch) ch = await tgConnection(await tgApi("getBusinessConnection", { business_connection_id: msg.business_connection_id }));
    if (!ch || !ch.active) return;

    const owner = String(ch.meta?.owner_user_id || "");
    const direction = String(msg.from?.id) === owner ? "out" : "in";
    const c = msg.chat;
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ") + (c.username ? ` (@${c.username})` : "");
    const { text, kind } = tgText(msg);
    const externalId = `${c.id}:${msg.message_id}`;

    if (update.edited_business_message) {
        const { data: ex } = await db.from("comm_messages").select("id, thread_id").eq("channel", "telegram").eq("external_id", externalId).maybeSingle();
        if (ex) {
            await db.from("comm_messages").update({ text: clip(text, 6000), ai_done: false }).eq("id", ex.id);
            await recomputeThread(ex.thread_id);
            return;
        }
    }
    await saveMessage({
        channel: "telegram", channelRow: ch, account: ch.account, contact: String(c.id), contactName: name,
        externalId, direction, sentAt: new Date((msg.date || Date.now() / 1000) * 1000).toISOString(), text, kind,
    });
}

/* ================================================================== */
/* WhatsApp Cloud API (+ coexistence з WhatsApp Business на телефоні)  */
/* ================================================================== */

function waText(m: Any): { text: string; kind: string } {
    switch (m?.type) {
        case "text": return { text: m.text?.body || "", kind: "text" };
        case "image": return { text: m.image?.caption || "[фото]", kind: "image" };
        case "document": return { text: m.document?.caption || `[документ ${m.document?.filename || ""}]`.trim(), kind: "document" };
        case "audio": return { text: "[голосове]", kind: "voice" };
        case "video": return { text: m.video?.caption || "[відео]", kind: "other" };
        case "location": return { text: "[локація]", kind: "other" };
        case "button": return { text: m.button?.text || "", kind: "text" };
        case "interactive": return { text: m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "[відповідь]", kind: "text" };
        default: return { text: m?.text?.body || `[${m?.type || "повідомлення"}]`, kind: "other" };
    }
}
const waTime = (t: unknown) => new Date(Number(t || Date.now() / 1000) * 1000).toISOString();

async function waChannel(value: Any): Promise<Any | null> {
    const pid = String(value?.metadata?.phone_number_id || "");
    if (!pid) return null;
    let ch = await channelBy("whatsapp", pid);
    if (!ch) {
        // Новий номер — додаємо без власника, керівник призначить на сторінці «Переписка»
        const { data } = await db.from("comm_channels").upsert({
            channel: "whatsapp", account: pid, account_label: value?.metadata?.display_phone_number ? `+${digits(value.metadata.display_phone_number)}` : pid,
            meta: { display_phone: digits(value?.metadata?.display_phone_number) },
        }, { onConflict: "channel,account" }).select("*").single();
        ch = data;
    }
    return ch?.active === false ? null : ch;
}

async function handleWhatsApp(body: Any) {
    for (const entry of body?.entry || []) {
        for (const change of entry?.changes || []) {
            const v = change?.value || {};
            const ch = await waChannel(v);
            if (!ch) continue;
            const ours = digits(v?.metadata?.display_phone_number || ch.meta?.display_phone);
            const names = new Map<string, string>((v.contacts || []).map((c: Any) => [digits(c.wa_id), c.profile?.name || ""]));

            if (change.field === "messages") {
                for (const m of v.messages || []) {
                    const { text, kind } = waText(m);
                    await saveMessage({ channel: "whatsapp", channelRow: ch, account: ch.account, contact: digits(m.from), contactName: names.get(digits(m.from)),
                        externalId: m.id, direction: "in", sentAt: waTime(m.timestamp), text, kind });
                }
            } else if (change.field === "smb_message_echoes") {
                // Менеджер написав з додатка WhatsApp Business на телефоні
                const echoes = v.message_echoes || v.smb_message_echoes || v.echoes || [];
                for (const m of echoes) {
                    if (m.type === "edit" || m.type === "revoke") continue;
                    const { text, kind } = waText(m);
                    await saveMessage({ channel: "whatsapp", channelRow: ch, account: ch.account, contact: digits(m.to),
                        externalId: m.id, direction: "out", sentAt: waTime(m.timestamp), text, kind });
                }
            } else if (change.field === "history") {
                // Історія за ~6 міс. при підключенні номера
                for (const h of v.history || []) {
                    for (const t of h.threads || []) {
                        for (const m of t.messages || []) {
                            const { text, kind } = waText(m);
                            const out = ours && digits(m.from) === ours;
                            await saveMessage({ channel: "whatsapp", channelRow: ch, account: ch.account, contact: digits(t.id),
                                externalId: m.id, direction: out ? "out" : "in", sentAt: waTime(m.timestamp), text, kind });
                        }
                    }
                }
            }
        }
    }
}

/* ================================================================== */
/* Viber (бот компанії)                                                */
/* ================================================================== */

async function viberChannel(): Promise<Any> {
    let ch = await channelBy("viber", "bot");
    if (!ch) {
        const { data } = await db.from("comm_channels").upsert({ channel: "viber", account: "bot", account_label: VIBER_NAME }, { onConflict: "channel,account" }).select("*").single();
        ch = data;
    }
    return ch;
}

async function handleViber(ev: Any): Promise<Response> {
    if (ev.event === "conversation_started" && VIBER_WELCOME) {
        // Привітання, коли клієнт відкрив чат (Viber дозволяє одне до підписки)
        return json(200, { sender: { name: VIBER_NAME }, type: "text", text: VIBER_WELCOME });
    }
    if (ev.event === "message" && ev.sender?.id) {
        const ch = await viberChannel();
        const m = ev.message || {};
        const text = m.type === "text" ? m.text : m.text || `[${m.type || "повідомлення"}]`;
        const res = await saveMessage({
            channel: "viber", channelRow: ch, account: "bot", contact: String(ev.sender.id), contactName: ev.sender.name,
            externalId: String(ev.message_token), direction: "in", sentAt: new Date(Number(ev.timestamp) || Date.now()).toISOString(),
            text, kind: m.type === "text" ? "text" : m.type === "picture" ? "image" : m.type === "file" ? "document" : "other",
        });
        // Розмова без менеджера → відповідальний за прив'язаним лідом
        if (res.thread_id) await assignByLead(res.thread_id);
    }
    return json(200, { ok: true });
}

async function viberSend(receiver: string, text: string) {
    const r = await fetch("https://chatapi.viber.com/pa/send_message", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Viber-Auth-Token": VIBER_TOKEN },
        body: JSON.stringify({ receiver, type: "text", text, sender: { name: VIBER_NAME } }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.status !== 0) throw new Error(`Viber: ${j.status_message || "помилка надсилання"}`);
    return String(j.message_token);
}

/* ================================================================== */
/* Outlook (Microsoft Graph)                                           */
/* ================================================================== */

let msToken: { value: string; exp: number } | null = null;
async function graphToken(): Promise<string> {
    if (msToken && msToken.exp > Date.now() + 60_000) return msToken.value;
    const r = await fetch(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: MS_CLIENT, client_secret: MS_SECRET, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error("Microsoft: " + (j.error_description || j.error || r.status));
    msToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return msToken.value;
}
async function graph(path: string, init: RequestInit = {}) {
    const r = await fetch(`https://graph.microsoft.com/v1.0/${path.replace(/^\//, "")}`, {
        ...init,
        headers: {
            authorization: `Bearer ${await graphToken()}`,
            "content-type": "application/json",
            prefer: 'outlook.body-content-type="text"',
            ...(init.headers || {}),
        },
    });
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: j };
}

const isInternal = (addr: string, mailbox: string) => {
    const dom = addr.split("@")[1] || "";
    return dom === (mailbox.split("@")[1] || "").toLowerCase() || COMPANY_DOMAINS.includes(dom);
};
const isRobot = (addr: string) => /(no-?reply|mailer-daemon|notification|newsletter|bounce|postmaster)/i.test(addr);

async function saveOutlookMessage(ch: Any, msg: Any) {
    if (!msg || msg.isDraft) return;
    const mailbox = emailKey(ch.account);
    const from = emailKey(msg.from?.emailAddress?.address);
    const out = from === mailbox;
    const recipients = [...(msg.toRecipients || []), ...(msg.ccRecipients || [])]
        .map((r: Any) => ({ addr: emailKey(r.emailAddress?.address), name: r.emailAddress?.name }))
        .filter((r: Any) => r.addr && !isInternal(r.addr, mailbox));
    const contact = out ? recipients[0] : { addr: from, name: msg.from?.emailAddress?.name };
    if (!contact?.addr || isInternal(contact.addr, mailbox) || isRobot(contact.addr)) return; // внутрішні й автоматичні листи — не клієнтські
    await saveMessage({
        channel: "outlook", channelRow: ch, account: mailbox, contact: contact.addr, contactName: contact.name,
        externalId: `${mailbox}:${msg.internetMessageId || msg.id}`, direction: out ? "out" : "in",
        sentAt: msg.sentDateTime || msg.receivedDateTime || nowIso(),
        subject: msg.subject, text: msg.uniqueBody?.content || msg.bodyPreview || "", kind: "text",
    });
}

const MSG_SELECT = "$select=id,internetMessageId,subject,uniqueBody,bodyPreview,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime,isDraft";

async function handleOutlookNotifications(body: Any) {
    const state = await clientState();
    for (const n of body?.value || []) {
        if (n.clientState !== state) continue;
        const { data: ch } = await db.from("comm_channels").select("*").eq("channel", "outlook").eq("meta->>subscription_id", n.subscriptionId).maybeSingle();
        if (!ch?.active) continue;
        const r = await graph(`${n.resource}?${MSG_SELECT}`);
        if (r.ok) await saveOutlookMessage(ch, r.data);
        else console.error("Graph message:", r.status, JSON.stringify(r.data).slice(0, 300));
    }
}

// Підписки Graph живуть ~3 доби — продовжуємо, нові ящики підписуємо й підтягуємо останні листи
async function outlookMaintain() {
    if (!(MS_TENANT && MS_CLIENT && MS_SECRET)) return { skipped: "Outlook не налаштовано" };
    const { data: list } = await db.from("comm_channels").select("*").eq("channel", "outlook").eq("active", true);
    const out: Any[] = [];
    for (const ch of list || []) {
        const meta = { ...(ch.meta || {}) };
        try {
            if (!meta.user_oid) {
                const u = await graph(`users/${encodeURIComponent(ch.account)}?$select=id`);
                if (!u.ok) throw new Error(`ящик не знайдено (${u.status})`);
                meta.user_oid = u.data.id;
            }
            const expires = new Date(Date.now() + 4200 * 60_000).toISOString();
            const needRenew = !meta.subscription_id || Date.parse(meta.expires_at || "") < Date.now() + 24 * 3600_000;
            if (needRenew && meta.subscription_id) {
                const r = await graph(`subscriptions/${meta.subscription_id}`, { method: "PATCH", body: JSON.stringify({ expirationDateTime: expires }) });
                if (r.ok) meta.expires_at = expires;
                else meta.subscription_id = null;
            }
            if (!meta.subscription_id) {
                const r = await graph("subscriptions", {
                    method: "POST",
                    body: JSON.stringify({
                        changeType: "created",
                        notificationUrl: `${FUNCTION_URL}?src=outlook`,
                        resource: `users/${meta.user_oid}/messages`,
                        expirationDateTime: expires,
                        clientState: await clientState(),
                    }),
                });
                if (!r.ok) throw new Error(`підписка: ${r.data?.error?.message || r.status}`);
                meta.subscription_id = r.data.id;
                meta.expires_at = expires;
            }
            if (!meta.backfilled) {
                for (const folder of ["inbox", "sentitems"]) {
                    const r = await graph(`users/${meta.user_oid}/mailFolders/${folder}/messages?$top=40&$orderby=receivedDateTime desc&${MSG_SELECT}`);
                    for (const m of r.data?.value || []) await saveOutlookMessage(ch, m);
                }
                meta.backfilled = true;
            }
            meta.error = null;
        } catch (e) {
            meta.error = String((e as Error).message || e);
        }
        await db.from("comm_channels").update({ meta, updated_at: nowIso() }).eq("id", ch.id);
        out.push({ mailbox: ch.account, error: meta.error });
    }
    return out;
}

/* ================================================================== */
/* Прив'язка розмов до лідів і перевізників                           */
/* ================================================================== */

async function linkThreads() {
    const since = new Date(Date.now() - 6 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");
    const { data: threads } = await db.from("comm_threads").select("id, channel, contact_handle, lead_id, carrier_id, link_checked_at, staff_id")
        .is("lead_id", null).is("carrier_id", null).or(`link_checked_at.is.null,link_checked_at.lt.${since}`).limit(300);
    if (!threads?.length) return 0;

    const [{ data: leads }, { data: carriers }] = await Promise.all([
        db.from("leads").select("*").neq("status", "Відмова").limit(10000),
        db.from("carriers").select("*").limit(20000),
    ]);
    const byKey = new Map<string, { type: "lead" | "carrier"; row: Any }>();
    const index = (row: Any, type: "lead" | "carrier") => {
        const add = (k: string) => k && !byKey.has(k) && byKey.set(k, { type, row });
        for (const [k, v] of Object.entries(row)) {
            if (/phone|tel/i.test(k) && v) String(v).split(/[,;/]/).forEach((p) => add("p:" + phoneKey(p)));
            if (/email/i.test(k) && v) String(v).split(/[,;\s]/).forEach((e) => e.includes("@") && add("e:" + emailKey(e)));
        }
        for (const c of Array.isArray(row.contacts) ? row.contacts : []) {
            if (c?.phone) add("p:" + phoneKey(c.phone));
            if (c?.email) add("e:" + emailKey(c.email));
        }
    };
    (leads || []).forEach((l: Any) => index(l, "lead"));
    (carriers || []).forEach((c: Any) => index(c, "carrier"));

    let linked = 0;
    for (const t of threads) {
        const h = t.contact_handle;
        const key = h.includes("@") ? "e:" + emailKey(h) : t.channel === "whatsapp" ? "p:" + phoneKey(h) : "";
        const hit = key ? byKey.get(key) : null;
        const upd: Any = { link_checked_at: nowIso() };
        if (hit?.type === "lead") {
            Object.assign(upd, { lead_id: String(hit.row.id), lead_name: hit.row.name, linked_by: "auto" });
            if (!t.staff_id && hit.row.sales_id) Object.assign(upd, { staff_id: String(hit.row.sales_id), staff_name: hit.row.sales || null });
            linked++;
        } else if (hit?.type === "carrier") {
            Object.assign(upd, { carrier_id: String(hit.row.id), lead_name: hit.row.name || hit.row.company || null, linked_by: "auto" });
            linked++;
        }
        await db.from("comm_threads").update(upd).eq("id", t.id);
    }
    return linked;
}

async function assignByLead(threadId: string) {
    const { data: t } = await db.from("comm_threads").select("id, staff_id, lead_id").eq("id", threadId).maybeSingle();
    if (!t || t.staff_id || !t.lead_id) return;
    const { data: l } = await db.from("leads").select("sales_id, sales").eq("id", t.lead_id).maybeSingle();
    if (l?.sales_id) await db.from("comm_threads").update({ staff_id: String(l.sales_id), staff_name: l.sales || null }).eq("id", t.id);
}

/* ================================================================== */
/* Claude: що в повідомленні                                           */
/* ================================================================== */

const CLASSIFY_SYSTEM = `Ти аналізуєш робочу переписку експедиторської компанії (міжнародні автоперевезення) з клієнтами.
Для кожного повідомлення поверни позначки. Повідомлення можуть бути українською, російською, англійською, польською.
Вхідні (dir = in, пише клієнт):
  intent: "quote_request" — просить ціну / ставку / розрахунок перевезення;
          "order" — підтверджує, дає заявку, погоджується на ставку;
          "complaint" — скарга, незадоволення, претензія, затримка, пошкодження;
          "question" — питання по поточному перевезенню, документах, статусу;
          "info" — інформація без питання (документи, «дякую», «ок»);
          "spam" — реклама, розсилка, не по роботі;
          "other".
Вихідні (dir = out, пише наш менеджер):
  has_rate: true, якщо в тексті названо конкретну ціну / ставку (число з валютою або «євро», «$», «грн» тощо);
  tone: "ok" — нормальний діловий; "cold" — сухо, без відповіді на питання, відписка; "rude" — грубо, роздратовано, неввічливо.
note — до 12 слів, лише якщо щось важливе (напр. «скарга на запізнення в Кракові»), інакше "".
Відповідь — ЛИШЕ JSON: {"items":[{"n":1,"intent":"...","has_rate":false,"tone":"ok","note":""}]} (для in — без has_rate/tone, для out — без intent).`;

async function classifyNew() {
    if (!AI_KEY) return { skipped: "немає ANTHROPIC_API_KEY" };
    const since = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
    const { data: msgs } = await db.from("comm_messages").select("id, direction, subject, text")
        .eq("ai_done", false).gte("sent_at", since).order("sent_at").limit(60);
    if (!msgs?.length) return { classified: 0 };
    let done = 0;
    for (let i = 0; i < msgs.length; i += 20) {
        const batch = msgs.slice(i, i + 20);
        const input = batch.map((m: Any, k: number) => ({ n: k + 1, dir: m.direction, text: clip(`${m.subject ? m.subject + "\n" : ""}${m.text || ""}`, 700) }));
        let parsed: Any = null;
        try {
            const r = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { "x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
                body: JSON.stringify({ model: AI_MODEL, max_tokens: 1500, system: CLASSIFY_SYSTEM, messages: [{ role: "user", content: JSON.stringify(input) }] }),
            });
            const j = await r.json();
            const text = (j.content || []).filter((b: Any) => b.type === "text").map((b: Any) => b.text).join("");
            const m = text.match(/\{[\s\S]*\}/);
            parsed = m ? JSON.parse(m[0]) : null;
        } catch (e) {
            console.error("classify:", e);
        }
        if (!parsed?.items) continue; // спробуємо наступного разу
        const byN = new Map<number, Any>(parsed.items.map((x: Any) => [Number(x.n), x]));
        const INTENTS = ["quote_request", "order", "complaint", "question", "info", "spam", "other"];
        for (let k = 0; k < batch.length; k++) {
            const x = byN.get(k + 1) || {};
            const m = batch[k];
            await db.from("comm_messages").update({
                ai_done: true,
                ai_intent: m.direction === "in" && INTENTS.includes(x.intent) ? x.intent : null,
                ai_has_rate: m.direction === "out" ? !!x.has_rate : null,
                ai_tone: m.direction === "out" && ["ok", "cold", "rude"].includes(x.tone) ? x.tone : null,
                ai_note: clip(x.note, 200) || null,
            }).eq("id", m.id);
            done++;
        }
    }
    return { classified: done };
}

async function tick() {
    const outlook = await outlookMaintain().catch((e) => ({ error: String(e) }));
    const linked = await linkThreads().catch((e) => (console.error(e), 0));
    const ai = await classifyNew().catch((e) => ({ error: String(e) }));
    return { outlook, linked, ai };
}

/* ================================================================== */
/* Дії з сайту                                                         */
/* ================================================================== */

async function actionLink(body: Any, me: Any) {
    const { data: t } = await db.from("comm_threads").select("*").eq("id", body.thread_id).maybeSingle();
    if (!t) return fail(404, "Розмову не знайдено");
    if (!isBoss(me) && String(t.staff_id) !== String(me.id)) return fail(403, "Це не ваша розмова");
    if (!body.lead_id) {
        await db.from("comm_threads").update({ lead_id: null, lead_name: null, carrier_id: null, linked_by: me.full_name, link_checked_at: nowIso() }).eq("id", t.id);
        return ok();
    }
    const { data: l } = await db.from("leads").select("id, name, sales_id, sales").eq("id", body.lead_id).maybeSingle();
    if (!l) return fail(404, "Лід не знайдено");
    const upd: Any = { lead_id: String(l.id), lead_name: l.name, carrier_id: null, linked_by: me.full_name, link_checked_at: nowIso() };
    if (!t.staff_id && l.sales_id) Object.assign(upd, { staff_id: String(l.sales_id), staff_name: l.sales || null });
    await db.from("comm_threads").update(upd).eq("id", t.id);
    return ok({ lead_name: l.name });
}

async function actionAssign(body: Any, me: Any) {
    if (!isBoss(me)) return fail(403, "Лише для керівника");
    const { data: st } = await db.from("staff").select("id, full_name, active").eq("id", body.staff_id).maybeSingle();
    if (!st?.active) return fail(400, "Співробітника не знайдено");
    await db.from("comm_threads").update({ staff_id: String(st.id), staff_name: st.full_name }).eq("id", body.thread_id);
    return ok();
}

async function actionReplyViber(body: Any, me: Any) {
    if (!VIBER_TOKEN) return fail(400, "Viber не підключено (немає VIBER_TOKEN)");
    const text = clip(body.text, 4000);
    if (!text) return fail(400, "Порожнє повідомлення");
    const { data: t } = await db.from("comm_threads").select("*").eq("id", body.thread_id).maybeSingle();
    if (!t || t.channel !== "viber") return fail(404, "Розмову не знайдено");
    if (!isBoss(me) && String(t.staff_id) !== String(me.id)) return fail(403, "Це не ваша розмова");
    const token = await viberSend(t.contact_handle, text);
    if (!t.staff_id) await db.from("comm_threads").update({ staff_id: String(me.id), staff_name: me.full_name }).eq("id", t.id);
    await saveMessage({
        channel: "viber", channelRow: await viberChannel(), account: "bot", contact: t.contact_handle,
        externalId: token, direction: "out", sentAt: nowIso(), text, staffId: String(me.id),
    });
    return ok();
}

async function actionChannelSave(body: Any, me: Any) {
    if (!isBoss(me)) return fail(403, "Лише для керівника");
    const channel = String(body.channel || "");
    let account = clip(body.account, 200);
    if (!["outlook", "whatsapp", "telegram", "viber"].includes(channel)) return fail(400, "Невідомий канал");
    if (channel === "outlook") {
        account = emailKey(account);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(account)) return fail(400, "Вкажіть e-mail ящика");
    }
    if (channel === "viber") account = "bot";
    if (!account) return fail(400, "Вкажіть акаунт");
    let staff: Any = null;
    if (body.staff_id) {
        const { data } = await db.from("staff").select("id, full_name").eq("id", body.staff_id).maybeSingle();
        staff = data;
    }
    const { data: ex } = await db.from("comm_channels").select("id, meta").eq("channel", channel).eq("account", account).maybeSingle();
    const row: Any = {
        channel, account,
        account_label: clip(body.account_label, 120) || account,
        staff_id: staff ? String(staff.id) : null,
        staff_name: staff?.full_name ?? null,
        active: body.active !== false,
        updated_at: nowIso(),
    };
    if (!ex) row.meta = {};
    const { error } = await db.from("comm_channels").upsert(row, { onConflict: "channel,account" });
    if (error) return fail(500, error.message);
    // Нові розмови цього акаунта без власника → новий власник
    if (staff) {
        const { data: ch } = await db.from("comm_channels").select("id").eq("channel", channel).eq("account", account).single();
        await db.from("comm_threads").update({ staff_id: String(staff.id), staff_name: staff.full_name }).eq("channel_id", ch!.id).is("staff_id", null);
    }
    if (channel === "outlook") background(outlookMaintain());
    return ok();
}

async function actionChannelDelete(body: Any, me: Any) {
    if (!isBoss(me)) return fail(403, "Лише для керівника");
    const { data: ch } = await db.from("comm_channels").select("*").eq("id", body.id).maybeSingle();
    if (!ch) return fail(404, "Не знайдено");
    if (ch.channel === "outlook" && ch.meta?.subscription_id && MS_TENANT) {
        await graph(`subscriptions/${ch.meta.subscription_id}`, { method: "DELETE" }).catch(() => null);
    }
    // Переписка лишається, лише канал більше не збирається
    await db.from("comm_channels").update({ active: false, updated_at: nowIso() }).eq("id", ch.id);
    return ok();
}

// Одноразове налаштування з кнопки на сторінці «Переписка» → «Підключення»
async function actionSetup(body: Any, me: Any) {
    if (!isBoss(me)) return fail(403, "Лише для керівника");
    if (body.channel === "viber") {
        if (!VIBER_TOKEN) return fail(400, "Спершу додайте секрет VIBER_TOKEN");
        const r = await fetch("https://chatapi.viber.com/pa/set_webhook", {
            method: "POST",
            headers: { "content-type": "application/json", "X-Viber-Auth-Token": VIBER_TOKEN },
            body: JSON.stringify({ url: `${FUNCTION_URL}?src=viber`, event_types: ["message", "conversation_started", "subscribed", "unsubscribed"], send_name: true }),
        });
        const j = await r.json().catch(() => ({}));
        if (j.status !== 0) return fail(400, `Viber: ${j.status_message || "не вдалося"}`);
        await viberChannel();
        return ok({ message: "Viber-бот підключено: повідомлення клієнтів надходитимуть у «Переписку»." });
    }
    if (body.channel === "telegram") {
        // Той самий вебхук fura-bot, лише додаємо типи оновлень Telegram Business
        const info = await tgApi("getWebhookInfo", {});
        if (!info?.url) return fail(400, "У бота немає вебхука — спершу підключіть fura-bot");
        const base = Array.isArray(info.allowed_updates) && info.allowed_updates.length ? info.allowed_updates : ["message", "edited_message", "callback_query", "my_chat_member"];
        const allowed = [...new Set([...base, "business_connection", "business_message", "edited_business_message", "deleted_business_messages"])];
        const params: Any = { url: info.url, allowed_updates: allowed };
        const wh = env("WEBHOOK_SECRET");
        if (wh) params.secret_token = wh;
        const res = await tgApi("setWebhook", params);
        if (!res) return fail(400, "Telegram не прийняв налаштування вебхука");
        return ok({ message: "Готово. Тепер кожен менеджер підключає бота: Telegram → Налаштування → Telegram для бізнесу → Чат-боти." });
    }
    if (body.channel === "outlook") {
        const r = await outlookMaintain();
        return ok({ message: "Перевірено ящики Outlook", result: r });
    }
    return fail(400, "Невідомий канал");
}

/* ================================================================== */

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const url = new URL(req.url);
    const src = url.searchParams.get("src");

    // Microsoft Graph: підтвердження адреси під час створення підписки
    if (src === "outlook" && url.searchParams.has("validationToken")) {
        return new Response(url.searchParams.get("validationToken") || "", { status: 200, headers: { "content-type": "text/plain" } });
    }
    // Meta: підтвердження вебхука WhatsApp
    if (src === "whatsapp" && req.method === "GET") {
        if (url.searchParams.get("hub.mode") === "subscribe" && WA_VERIFY && url.searchParams.get("hub.verify_token") === WA_VERIFY) {
            return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
        }
        return new Response("forbidden", { status: 403 });
    }
    if (req.method !== "POST") return new Response("FURA comms is running");

    const raw = await req.text();
    let body: Any;
    try {
        body = JSON.parse(raw || "{}");
    } catch {
        return json(400, { error: "bad request" });
    }

    try {
        if (src === "outlook") {
            background(handleOutlookNotifications(body));
            return new Response("", { status: 202 });
        }
        if (src === "whatsapp") {
            const sig = req.headers.get("x-hub-signature-256") || "";
            const signedOk = WA_APP_SECRET && sig && safeEqual(sig, "sha256=" + (await hmacHex(WA_APP_SECRET, raw)));
            if (!signedOk && !secretOk(req, url)) return new Response("forbidden", { status: 403 });
            background(handleWhatsApp(body));
            return new Response("ok");
        }
        if (src === "viber") {
            const sig = req.headers.get("x-viber-content-signature") || "";
            if (!VIBER_TOKEN || !safeEqual(sig, await hmacHex(VIBER_TOKEN, raw))) return new Response("forbidden", { status: 403 });
            return await handleViber(body);
        }
        if (src === "telegram") {
            if (!secretOk(req, url)) return new Response("forbidden", { status: 403 });
            await handleTelegram(body);
            return new Response("ok");
        }
        if (body.action === "tick") {
            if (!secretOk(req, url)) return json(403, { error: "forbidden" });
            return json(200, await tick());
        }

        const me = await staffFromRequest(req);
        if (!me) return json(403, { error: "Вас немає серед співробітників FURA" });
        let out: { status: number; data: Any };
        switch (body.action) {
            case "link": out = await actionLink(body, me); break;
            case "assign": out = await actionAssign(body, me); break;
            case "reply_viber": out = await actionReplyViber(body, me); break;
            case "channel_save": out = await actionChannelSave(body, me); break;
            case "channel_delete": out = await actionChannelDelete(body, me); break;
            case "setup": out = await actionSetup(body, me); break;
            case "status":
                out = ok({
                    boss: isBoss(me),
                    outlook: !!(MS_TENANT && MS_CLIENT && MS_SECRET),
                    telegram: !!TG_TOKEN,
                    whatsapp: !!(WA_VERIFY && (WA_APP_SECRET || SECRET)),
                    viber: !!VIBER_TOKEN,
                    ai: !!AI_KEY,
                    secret: !!SECRET,
                    webhook: FUNCTION_URL,
                });
                break;
            default: out = fail(400, "unknown action");
        }
        return json(out.status, out.data);
    } catch (e) {
        console.error(e);
        return json(500, { error: (e as Error).message?.startsWith("Viber") ? (e as Error).message : "Помилка сервера. Спробуйте ще раз." });
    }
});
