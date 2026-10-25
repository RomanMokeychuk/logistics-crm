// FURA — приймає дані з застосунку «Эчерга» (Supabase Edge Function "fura-echerha")
//
// Эчерга на Mac кожні ~30 хв надсилає сюди знімок черги на кордоні частинами:
//   POST { sync_id, rows: [...] }                         — машини (по ~1000 за раз)
//   POST { sync_id, finish: true, checkpoints: [...] }    — кінець: старі рядки видаляються
// Поки нова відправка не завершена, у CRM видно попередню — без «порожніх» моментів.
//
// Секрети (Supabase → Edge Functions → Secrets):
//   ECHERHA_TOKEN — той самий токен, що в Эчерзі (Налаштування → FURA)
// У налаштуваннях функції вимкніть «Verify JWT» (Эчерга входить токеном, а не логіном).

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
