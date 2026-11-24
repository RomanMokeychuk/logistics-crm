// =====================================================================
// FURA · fura-broadcast — Viber-розсилки через Київстар (Business Messages)
//
//   Логіст  → перевізникам (опис вантажу з запиту, без клієнта і цін)
//   Sales   → клієнтам (свої ліди / клієнти)
//
// Номери телефонів сервер бере САМ з бази за id (з сайту приходять лише id) —
// тож розіслати на довільні номери чи чужим клієнтам не вийде.
//
// Секрети (Supabase → Edge Functions → Secrets):
//   KYIVSTAR_CLIENT_ID, KYIVSTAR_CLIENT_SECRET — з API-порталу Київстар
//   KYIVSTAR_SENDER                           — погоджене ім'я відправника у Viber (напр. GRANDAR)
//   (необов'язково) KYIVSTAR_BASE             — за замовч. https://api-gateway.kyivstar.ua/rest/v1
//                                               (пісочниця: https://api-gateway.kyivstar.ua/sandbox/rest/v1)
//   (необов'язково) KYIVSTAR_TOKEN_URL        — за замовч. https://api-gateway.kyivstar.ua/idp/oauth2/token
//   (необов'язково) BROADCAST_DAILY_LIMIT     — скільки повідомлень на день на людину (за замовч. 1000)
// Поки немає KYIVSTAR_CLIENT_ID — працює ТЕСТОВИЙ режим: усе як по-справжньому, але нічого не надсилається.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Any = any;

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const KS_ID = env("KYIVSTAR_CLIENT_ID");
const KS_SECRET = env("KYIVSTAR_CLIENT_SECRET");
const KS_SENDER = env("KYIVSTAR_SENDER");
const KS_BASE = (env("KYIVSTAR_BASE") || "https://api-gateway.kyivstar.ua/rest/v1").replace(/\/+$/, "");
const KS_TOKEN_URL = env("KYIVSTAR_TOKEN_URL") || "https://api-gateway.kyivstar.ua/idp/oauth2/token";
const DAILY_LIMIT = Number(env("BROADCAST_DAILY_LIMIT") || 1000);
const MAX_PER_BROADCAST = 500;
const TEST = !KS_ID || !KS_SECRET || !KS_SENDER;

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};
const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } });

/* ---------- хто питає ---------- */
async function staffOf(req: Request): Promise<Any | null> {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return null;
    const { data } = await db.auth.getUser(jwt);
    const email = data?.user?.email;
    if (!email) return null;
    const { data: me } = await db.from("staff").select("*").ilike("email", email.replace(/[\\%_]/g, (c) => "\\" + c)).eq("active", true).maybeSingle();
    return me || null;
}
const rolesOf = (me: Any): string[] => {
    const r = me?.roles;
    const list = Array.isArray(r) ? r : typeof r === "string" ? r.replace(/[{}\[\]"]/g, "").split(",") : [];
    return [...list, me?.role].map((x) => String(x || "").trim()).filter(Boolean);
};
const isBoss = (me: Any) => rolesOf(me).some((r) => r === "head" || r === "admin");

/* ---------- телефони ---------- */
// лише українські мобільні: 380XXXXXXXXX
function normPhone(v: unknown): string {
    let d = String(v ?? "").replace(/\D/g, "");
    if (d.length === 10 && d.startsWith("0")) d = "38" + d;
    if (d.length === 9) d = "380" + d;
    if (d.length === 11 && d.startsWith("80")) d = "3" + d;
    return /^380\d{9}$/.test(d) ? d : "";
}

/* ---------- Київстар ---------- */
let token = "", tokenUntil = 0;
async function ksToken(): Promise<string> {
    if (token && Date.now() < tokenUntil - 60_000) return token;
    const res = await fetch(KS_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + btoa(`${KS_ID}:${KS_SECRET}`) },
        body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(`Київстар: не вдалося увійти (${res.status}) ${String(data.error_description || data.error || "").slice(0, 120)}`);
    token = data.access_token;
    tokenUntil = Date.now() + Number(data.expires_in || 3000) * 1000;
    return token;
}
async function ksSend(phone: string, text: string): Promise<{ id?: string; error?: string }> {
    const res = await fetch(`${KS_BASE}/viber/promotion`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${await ksToken()}` },
        body: JSON.stringify({ from: KS_SENDER, to: phone, text, messageTtlSec: 86400 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: `${res.status} ${String(data.errorMsg || data.message || data.error || "").slice(0, 160)}` };
    const id = data.mid || data.msgId || data.messageId || data.id;
    return id ? { id: String(id) } : { error: "Київстар не повернув номер повідомлення" };
}
async function ksStatus(id: string): Promise<string> {
    const res = await fetch(`${KS_BASE}/viber/status/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${await ksToken()}` } });
    const data = await res.json().catch(() => ({}));
    return String(data.status || data.state || "").toLowerCase();
}
const mapStatus = (s: string) =>
    /read|seen/.test(s) ? "read" : /deliver/.test(s) ? "delivered" : /reject|fail|undeliver|expire|error/.test(s) ? "failed" : s ? "sent" : "";

/* ---------- кому ---------- */
async function targets(me: Any, kind: string, ids: string[]): Promise<{ target_id: string; name: string; phone: string }[]> {
    const out: { target_id: string; name: string; phone: string }[] = [];
    if (kind === "carriers") {
        for (let i = 0; i < ids.length; i += 200) {
            const { data } = await db.from("carriers").select("id, name, phone_1, phone_2, contact_person_1, contact_person_2").in("id", ids.slice(i, i + 200));
            (data || []).forEach((c: Any) => {
                // одне повідомлення на перевізника: перший робочий номер
                const p = normPhone(c.phone_1) || normPhone(c.phone_2);
                if (p) out.push({ target_id: String(c.id), name: String(c.name || ""), phone: p });
            });
        }
    } else {
        const boss = isBoss(me);
        for (let i = 0; i < ids.length; i += 200) {
            const { data } = await db.from("leads").select("*").in("id", ids.slice(i, i + 200));
            (data || []).forEach((l: Any) => {
                if (!boss && String(l.sales_id || "") !== String(me.id)) return; // лише свої клієнти
                const list = [l.phone, ...(Array.isArray(l.contacts) ? l.contacts.map((c: Any) => c?.phone) : [])].map(normPhone).filter(Boolean);
                const p = list[0];
                if (p) out.push({ target_id: String(l.id), name: String(l.name || ""), phone: p });
            });
        }
    }
    return out;
}

/* ---------- дії ---------- */
async function actSend(me: Any, body: Any) {
    const kind = body.kind === "clients" ? "clients" : "carriers";
    const roles = rolesOf(me);
    if (kind === "carriers" && !roles.some((r) => ["logist", "head", "admin"].includes(r))) return json(403, { error: "Розсилка перевізникам — лише для логістів." });
    if (kind === "clients" && !roles.some((r) => ["sales", "head", "admin"].includes(r))) return json(403, { error: "Розсилка клієнтам — лише для Sales." });
    const text = String(body.text || "").trim().slice(0, 1000);
    if (text.length < 10) return json(400, { error: "Напишіть текст розсилки." });
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))].slice(0, MAX_PER_BROADCAST);
    if (!ids.length) return json(400, { error: "Оберіть, кому надіслати." });

    // ліміт на день
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: mine } = await db.from("broadcasts").select("total").eq("staff_id", String(me.id)).eq("test", false).gte("created_at", since);
    const used = (mine || []).reduce((n: number, b: Any) => n + (b.total || 0), 0);

    let list = await targets(me, kind, ids);
    const seen = new Set<string>();
    list = list.filter((t) => (seen.has(t.phone) ? false : (seen.add(t.phone), true)));
    const { data: opt } = await db.from("broadcast_optout").select("phone").in("phone", list.map((t) => t.phone));
    const blocked = new Set((opt || []).map((o: Any) => o.phone));
    const skipped = list.filter((t) => blocked.has(t.phone)).length;
    list = list.filter((t) => !blocked.has(t.phone));
    if (!list.length) return json(400, { error: "У вибраних немає українських мобільних номерів (або вони просили не надсилати)." });
    if (!TEST && used + list.length > DAILY_LIMIT) return json(400, { error: `Денний ліміт ${DAILY_LIMIT} повідомлень: сьогодні вже ${used}. Зменшіть список.` });

    const { data: b, error } = await db.from("broadcasts").insert({
        staff_id: String(me.id), staff_email: me.email, staff_name: me.full_name, kind,
        request_id: body.request_id ? Number(body.request_id) : null, text, total: list.length, test: TEST, status: "sending",
    }).select().single();
    if (error) return json(500, { error: "Не вдалося зберегти розсилку: " + error.message });
    const rows = list.map((t) => ({ broadcast_id: b.id, ...t, status: "queued" }));
    const { data: recs } = await db.from("broadcast_recipients").insert(rows).select("id, phone");

    let sent = 0, failed = 0;
    const queue = [...(recs || [])];
    async function worker() {
        while (queue.length) {
            const r = queue.shift();
            let upd: Any;
            if (TEST) upd = { status: "test" };
            else {
                try {
                    const res = await ksSend(r.phone, text);
                    upd = res.id ? { status: "sent", msg_id: res.id } : { status: "failed", error: res.error };
                } catch (e) { upd = { status: "failed", error: String((e as Error).message || e).slice(0, 200) }; }
            }
            if (upd.status === "failed") failed++; else sent++;
            await db.from("broadcast_recipients").update({ ...upd, updated_at: new Date().toISOString() }).eq("id", r.id);
        }
    }
    await Promise.all(Array.from({ length: 5 }, worker));
    await db.from("broadcasts").update({ sent, failed, status: "done" }).eq("id", b.id);
    return json(200, { id: b.id, total: list.length, sent, failed, skipped, test: TEST });
}

async function actStatus(me: Any, body: Any) {
    const id = Number(body.id);
    const { data: b } = await db.from("broadcasts").select("*").eq("id", id).maybeSingle();
    if (!b || (String(b.staff_id) !== String(me.id) && !isBoss(me))) return json(404, { error: "Розсилку не знайдено" });
    const { data: recs } = await db.from("broadcast_recipients").select("*").eq("broadcast_id", id).order("id");
    if (!TEST) {
        const stale = Date.now() - 60_000;
        const todo = (recs || []).filter((r: Any) => r.msg_id && ["sent", "delivered"].includes(r.status) && new Date(r.updated_at).getTime() < stale).slice(0, 150);
        await Promise.all(todo.map(async (r: Any) => {
            try {
                const s = mapStatus(await ksStatus(r.msg_id));
                const now = new Date().toISOString();
                if (s && s !== r.status) { r.status = s; await db.from("broadcast_recipients").update({ status: s, updated_at: now }).eq("id", r.id); }
                else await db.from("broadcast_recipients").update({ updated_at: now }).eq("id", r.id);
            } catch (_) { /* спробуємо наступного разу */ }
        }));
    }
    return json(200, { broadcast: b, recipients: recs || [] });
}

async function actOptout(me: Any, body: Any) {
    const p = normPhone(body.phone);
    if (!p) return json(400, { error: "Невірний номер" });
    if (body.undo) await db.from("broadcast_optout").delete().eq("phone", p);
    else await db.from("broadcast_optout").upsert({ phone: p, note: String(body.note || "").slice(0, 200), created_by: me.full_name || me.email });
    return json(200, { ok: true });
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    try {
        const me = await staffOf(req);
        if (!me) return json(401, { error: "Увійдіть у FURA." });
        const body = await req.json().catch(() => ({}));
        switch (body.action) {
            case "config": return json(200, { test: TEST, sender: KS_SENDER || null, max: MAX_PER_BROADCAST, daily: DAILY_LIMIT, roles: rolesOf(me), boss: isBoss(me) });
            case "send": return await actSend(me, body);
            case "status": return await actStatus(me, body);
            case "optout": return await actOptout(me, body);
            default: return json(400, { error: "unknown action" });
        }
    } catch (e) {
        console.error(e);
        return json(500, { error: "Помилка сервера розсилок: " + String((e as Error)?.message || e).slice(0, 200) });
    }
});
