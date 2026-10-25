// FURA — приймає дані з застосунку «Черга» (Supabase Edge Function "fura-echerha")
//
// Черга на Mac кожні ~30 хв надсилає сюди знімок черги на кордоні частинами:
//   POST { sync_id, rows: [...] }                         — машини (по ~1000 за раз)
//   POST { sync_id, finish: true, checkpoints: [...] }    — кінець: старі рядки видаляються
// Поки нова відправка не завершена, у CRM видно попередню — без «порожніх» моментів.
//
// Секрети (Supabase → Edge Functions → Secrets):
//   ECHERHA_TOKEN — той самий токен, що в Черзі (Налаштування → FURA)
// У налаштуваннях функції вимкніть «Verify JWT» (Черга входить токеном, а не логіном).

import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN = Deno.env.get("ECHERHA_TOKEN") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

// deno-lint-ignore no-explicit-any
type Any = any;

const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const s = (v: unknown, max = 300) => (v === null || v === undefined ? null : String(v).slice(0, max));

const ROW_FIELDS = [
    "checkpoint", "country", "qtype", "queue_no", "entry_at", "reg_at", "tractor", "trailer", "carrier",
    "edrpou", "boss", "trailer_model", "trailer_body", "trailer_kind", "note",
];

/* ---------- Обрані машини (★): хто з'явився в черзі, хто проїхав ---------- */
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const APP_URL = (Deno.env.get("APP_URL") ?? "https://romanmokeychuk.github.io/logistics-crm").replace(/\/[^/]*\.html.*$/, "").replace(/\/$/, "");
const esc = (t: unknown) => String(t ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const cpShort = (n: unknown) => String(n ?? "").replace(/\s*\((для|Туреччина)[^)]*\)\s*$/i, "");

async function telegramFor(userId: string): Promise<number | null> {
    const { data } = await db.auth.admin.getUserById(userId);
    const email = data?.user?.email;
    if (!email) return null;
    const { data: st } = await db.from("staff").select("telegram_chat_id, active").ilike("email", email).limit(1);
    const s = st?.[0];
    return s?.active && s.telegram_chat_id ? Number(s.telegram_chat_id) : null;
}

async function checkWatched(syncId: string) {
    const { data: watch } = await db.from("echerha_watch").select("*").in("status", ["pending", "waiting"]);
    if (!watch?.length) return;

    // Захист: якщо цей знімок підозріло менший за попередній (збій, обрізана відправка) —
    // «проїхав» не ставимо, щоб не було хибних сповіщень
    const { count: now } = await db.from("echerha_queue").select("id", { count: "exact", head: true }).eq("sync_id", syncId);
    const { data: prev } = await db.from("echerha_sync").select("rows").eq("id", 1).maybeSingle();
    const safe = !prev?.rows || (now ?? 0) >= prev.rows * 0.5;

    const plates = [...new Set(watch.map((w: Any) => w.plate))];
    const found = new Map<string, Any>();
    for (let i = 0; i < plates.length; i += 200) {
        const { data } = await db
            .from("echerha_queue")
            .select("tractor, trailer, checkpoint, entry_at, queue_no, carrier, edrpou, note")
            .eq("sync_id", syncId)
            .in("tractor", plates.slice(i, i + 200));
        (data || []).forEach((r: Any) => found.set(r.tractor, r));
    }

    const stamp = new Date().toISOString();
    const passed: Any[] = [];
    for (const w of watch) {
        const f = found.get(w.plate);
        if (f) {
            await db.from("echerha_watch").update({
                status: "waiting", checkpoint: f.checkpoint, entry_at: f.entry_at, queue_no: f.queue_no,
                trailer: f.trailer, carrier: f.carrier, edrpou: f.edrpou, note: f.note, last_seen: stamp,
            }).eq("id", w.id);
        } else if (w.status === "waiting" && safe) {
            await db.from("echerha_watch").update({ status: "passed", passed_at: stamp, seen: false }).eq("id", w.id);
            passed.push(w);
        }
    }

    if (!BOT_TOKEN || !passed.length) return;
    const byUser = new Map<string, Any[]>();
    passed.forEach((w) => byUser.set(w.user_id, [...(byUser.get(w.user_id) || []), w]));
    for (const [uid, list] of byUser) {
        const chat = await telegramFor(uid).catch(() => null);
        if (!chat) continue;
        const lines = list.map((w) =>
            `🚚 <b>${esc(w.plate)}</b>${w.trailer ? " / " + esc(w.trailer) : ""} — ${esc(cpShort(w.checkpoint))}` +
            (w.carrier ? `\n    ${esc(w.carrier)}` : ""));
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                chat_id: chat,
                parse_mode: "HTML",
                disable_web_page_preview: true,
                text: `✅ <b>${list.length > 1 ? "Обрані машини пройшли кордон" : "Обрана машина пройшла кордон"}</b>\n\n${lines.join("\n")}`,
                reply_markup: { inline_keyboard: [[{ text: "📋 Відкрити «Чергу»", url: `${APP_URL}/echerha.html?view=watch` }]] },
            }),
        }).catch(() => {});
    }
}

Deno.serve(async (req) => {
    if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });
    if (!TOKEN || req.headers.get("x-echerha-token") !== TOKEN) return json(401, { ok: false, error: "невірний токен" });

    let body: Any;
    try {
        body = await req.json();
    } catch {
        return json(400, { ok: false, error: "не JSON" });
    }
    const syncId = s(body.sync_id, 64);
    if (!syncId) return json(400, { ok: false, error: "немає sync_id" });

    // 1) Частина машин
    if (Array.isArray(body.rows) && body.rows.length) {
        if (body.rows.length > 3000) return json(400, { ok: false, error: "забагато рядків за раз" });
        const rows = body.rows.map((r: Any) => {
            const o: Any = { sync_id: syncId, ua: r.ua !== false, is_new: !!r.is_new };
            for (const f of ROW_FIELDS) o[f] = s(r[f]);
            o.checkpoint = o.checkpoint || "—";
            return o;
        });
        const { error } = await db.from("echerha_queue").insert(rows);
        if (error) return json(500, { ok: false, error: error.message });
        if (body.first) await db.from("echerha_sync").upsert({ id: 1, started_at: new Date().toISOString() });
        return json(200, { ok: true, inserted: rows.length });
    }

    // 2) Кінець відправки: пункти, видалення старого знімка, час оновлення
    if (body.finish) {
        const cps = (Array.isArray(body.checkpoints) ? body.checkpoints : []).map((c: Any) => ({
            name: s(c.name) || "—",
            sync_id: syncId,
            country: s(c.country),
            qtype: s(c.qtype),
            in_queue: Number(c.in_queue) || 0,
            selected: !!c.selected,
            last_scraped: s(c.last_scraped, 40),
        }));
        if (cps.length) {
            const { error } = await db.from("echerha_checkpoints").upsert(cps, { onConflict: "name" });
            if (error) return json(500, { ok: false, error: error.message });
            await db.from("echerha_checkpoints").delete().neq("sync_id", syncId);
        }
        await checkWatched(syncId).catch((e) => console.error("watch:", e));
        const del = await db.from("echerha_queue").delete().neq("sync_id", syncId);
        if (del.error) return json(500, { ok: false, error: del.error.message });
        const { count } = await db.from("echerha_queue").select("id", { count: "exact", head: true });
        await db.from("echerha_sync").upsert({
            id: 1,
            synced_at: new Date().toISOString(),
            rows: count ?? 0,
            carriers: Number(body.carriers) || null,
            sync_id: syncId,
        });
        // Нових перевізників з черги — у «Перевізники», наявним — нові типи причепа (echerha_carriers.sql)
        const sync = await db.rpc("sync_echerha_carriers");
        if (sync.error) console.error("sync_echerha_carriers:", sync.error.message);
        return json(200, { ok: true, rows: count ?? 0, carriers: sync.data ?? null });
    }

    // Відправку перервали — прибираємо недовантажене
    if (body.abort) {
        await db.from("echerha_queue").delete().eq("sync_id", syncId);
        return json(200, { ok: true });
    }
    return json(400, { ok: false, error: "порожній запит" });
});
