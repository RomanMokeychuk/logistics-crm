// =====================================================================
// FURA · fura-baf — обмін угодами з BAF (1С) ТОВ «ГРАНДАР»
//
// Хто кого кличе: програма BAF (регламентне завдання на сервері BAF) сама
// кожні кілька хвилин звертається сюди через інтернет. Сервер BAF назовні
// відкривати НЕ треба.
//
//   FURA → BAF:  action "pending"  — угоди, які логіст/Sales натиснули «Передати в BAF»
//                action "ack"      — BAF каже: «створив / оновив Сделку № …» або «помилка: …»
//   BAF → FURA:  action "update"   — статус угоди, рахунки, оплати, фактичний прибуток
//                action "ping"     — перевірка зв'язку
//
// Захист: кожен запит має заголовок  X-Baf-Token: <BAF_TOKEN>
// Секрети (Supabase → Edge Functions → Secrets):
//   BAF_TOKEN — довгий випадковий пароль (той самий вписується в BAF)
// Verify JWT для цієї функції — ВИМКНУТИ (BAF не має входу Supabase, перевіряємо BAF_TOKEN).
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Any = any;

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const TOKEN = env("BAF_TOKEN");
const FILE_URL_TTL = 24 * 3600; // посилання на файли живуть добу

const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

// порівняння паролів без витоку часу
function sameToken(a: string, b: string): boolean {
    if (!a || !b || a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}

const n = (v: unknown) => {
    const x = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
    return isFinite(x) ? x : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const vatRate = (v: unknown): number | null => {
    const s = String(v || "");
    if (/20/.test(s)) return 20;
    if (/0\s*%/.test(s)) return 0;
    return null; // «Без ПДВ» / «Не ПДВ» / порожньо
};
const city = (a: unknown) => String(a || "").split(",")[0].trim();

/* ---------- одна угода у форматі для BAF ---------- */
async function signed(bucket: string, path: string): Promise<string | null> {
    const { data } = await db.storage.from(bucket).createSignedUrl(path, FILE_URL_TTL);
    return data?.signedUrl || null;
}

async function payloadOf(d: Any, ctx: { leads: Map<string, Any>; carriers: Map<string, Any>; staff: Map<string, Any> }) {
    const lead = ctx.leads.get(String(d.lead_id)) || null;
    const carrier = ctx.carriers.get(String(d.carrier_id)) || null;
    const person = (id: unknown, name: unknown) => {
        const s = ctx.staff.get(String(id));
        return s || name ? { name: s?.full_name || name || null, email: s?.email || null } : null;
    };
    const carrierRef = { name: carrier?.name || d.carrier_name || null, edrpou: carrier?.edrpou || d.carrier_edrpou || null };

    const services: Any[] = Array.isArray(d.services) ? d.services : [];
    let inc = 0, exp = 0, incNo = 0, expNo = 0;
    const plan = services
        .filter((r) => r.title || n(r.in_rate) || n(r.out_rate))
        .map((r, i) => {
            const qty = n(r.qty) || 1;
            const inSum = qty * n(r.in_rate), outSum = qty * n(r.out_rate);
            const inUsd = n(r.in_fx) ? inSum / n(r.in_fx) : 0;
            const outUsd = n(r.out_fx) ? outSum / n(r.out_fx) : 0;
            inc += inUsd; exp += outUsd;
            incNo += vatRate(r.in_vat) === 20 ? inUsd / 1.2 : inUsd;
            expNo += vatRate(r.out_vat) === 20 ? outUsd / 1.2 : outUsd;
            const supName = String(r.supplier || "").trim();
            const supplier = !outSum ? null : !supName || supName === carrierRef.name ? carrierRef : { name: supName, edrpou: null };
            return {
                line: i + 1,
                article: r.title || null, // «Статья дохода» (Авто Саша 0%, Авто Саша з ПДВ, Додаткові витрати …)
                qty,
                income: inSum ? { rate: n(r.in_rate), vat: r.in_vat || null, vat_rate: vatRate(r.in_vat), sum: r2(inSum), currency: r.in_cur || null, fx: n(r.in_fx) || null, sum_usd: r2(inUsd), pay_account: r.in_pay || null } : null,
                expense: outSum ? { rate: n(r.out_rate), vat: r.out_vat || null, vat_rate: vatRate(r.out_vat), sum: r2(outSum), currency: r.out_cur || null, fx: n(r.out_fx) || null, sum_usd: r2(outUsd), pay_account: r.out_pay || null, supplier } : null,
                note: r.note || null,
            };
        });

    // файли: договори з картки клієнта / перевізника + файли угоди
    const files: Any[] = [];
    const add = async (list: Any[], kind: string | null, bucket: string) => {
        for (const f of Array.isArray(list) ? list : []) {
            if (!f?.path) continue;
            files.push({ kind: kind || f.kind || "Інше", name: f.name, size: f.size || null, uploaded_at: f.uploaded_at || null, url: await signed(f.bucket || bucket, f.path) });
        }
    };
    await add(lead?.contract_files, "Договір з клієнтом", "client-docs");
    await add(carrier?.contract_files, "Договір з перевізником", "deal-files");
    await add(d.files, null, "deal-files");

    const route = [city(d.load_address), city(d.unload_address)].filter(Boolean).join(" - ");
    return {
        fura_id: d.id,
        fura_number: d.number,
        version: d.baf_queued_at, // повернути в «ack» без змін
        baf_number: d.baf_number || null, // є — значить оновити існуючу Сделку, нема — створити нову
        baf_id: d.baf_id || null,
        created_at: d.created_at,
        header: {
            kind: d.deal_type || null, // Вид: Імпорт / Експорт / Внутрішнє …
            transit: !!d.transit,
            client: { name: lead?.name || d.client || null, edrpou: lead?.edrpou || null },
            manager: person(d.sales_id, d.sales), // Менеджер
            assistant: person(d.logist_id, d.logist_name), // Помощник
            op_manager: person(d.opmanager_id, d.opmanager_name), // Оперативный менеджер
            work_date: d.work_date || null, // Дата выполнения работ
        },
        general: {
            cargo: d.cargo || null,
            cargo_code: d.cargo_code || null,
            route, // «Львів - Єреван»
            km: d.route_km ?? null,
            from: { country: d.load_country || null, address: d.load_address || null, city: city(d.load_address) || null },
            to: { country: d.unload_country || null, address: d.unload_address || null, city: city(d.unload_address) || null },
            customs_export: d.customs_export === "По місцю" ? "по місцю завантаження" : [d.customs_export, d.customs_export_country].filter(Boolean).join(", ") || null,
            customs_import: d.customs_import === "По місцю" ? "по місцю розвантаження" : [d.customs_import, d.customs_import_country].filter(Boolean).join(", ") || null,
            border_crossing: d.border_crossing || null,
            customs_date: d.customs_date || null,
            client_supply: d.client_supply || null, // Подача клиенту
            qty: d.trucks_qty || 1,
            shipper: d.shipper || null,
            consignee: d.consignee || null,
            contract_client: { text: d.contract || null, number: lead?.contract_no || null, date: lead?.contract_date || null },
            contract_carrier: { text: d.carrier_contract || null, number: carrier?.contract_no || null, date: carrier?.contract_date || null },
            pay_form: d.pay_form || null,
            has_docs: !!d.has_docs,
            docs_date: d.docs_date || null,
            notes: d.notes || null,
        },
        carrier: { ...carrierRef, contact: d.carrier_contact || null, phone: d.carrier_phone || null },
        vehicles: [
            {
                truck: d.truck_plate || null,
                trailer: d.trailer_plate || null,
                number: [d.truck_plate, d.trailer_plate].filter(Boolean).join(" / ") || null, // «Номер ТС»
                trailer_type: d.trailer_type || null,
                driver: d.driver_name || null,
                phone: d.driver_phone || null,
                load_plan: d.load_date_plan || null, // Выезд предварительный
                load_fact: d.load_date || null, // Выезд
                unload_plan: d.unload_date_plan || null, // Возврат предварительный
                unload_fact: d.unload_date || null, // Возврат
            },
        ],
        plan, // «План / Калькуляция»
        totals: { income_usd: r2(inc), expense_usd: r2(exp), profit_usd: r2(inc - exp), profit_no_vat_usd: r2(incNo - expNo) },
        files,
    };
}

/* ---------- дії ---------- */
async function actPending(body: Any) {
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);
    const { data: deals, error } = await db.from("deals").select("*").eq("baf_state", "queued").order("baf_queued_at", { ascending: true }).limit(limit);
    if (error) return json(500, { ok: false, error: error.message });
    const ids = (k: string) => [...new Set((deals || []).map((d: Any) => d[k]).filter(Boolean).map(String))];
    const [l, c, s] = await Promise.all([
        ids("lead_id").length ? db.from("leads").select("id, name, edrpou, contract_no, contract_date, contract_files").in("id", ids("lead_id")) : { data: [] },
        ids("carrier_id").length ? db.from("carriers").select("id, name, edrpou, contract_no, contract_date, contract_files").in("id", ids("carrier_id")) : { data: [] },
        db.from("staff").select("id, full_name, email"),
    ]);
    const ctx = {
        leads: new Map((l.data || []).map((x: Any) => [String(x.id), x])),
        carriers: new Map((c.data || []).map((x: Any) => [String(x.id), x])),
        staff: new Map((s.data || []).map((x: Any) => [String(x.id), x])),
    };
    const out = [];
    for (const d of deals || []) out.push(await payloadOf(d, ctx));
    return json(200, { ok: true, count: out.length, deals: out });
}

async function findDeal(body: Any) {
    let q = db.from("deals").select("id, number, baf_queued_at, baf_number, baf_state");
    if (body.fura_id) q = q.eq("id", body.fura_id);
    else if (body.baf_number) q = q.eq("baf_number", String(body.baf_number));
    else if (body.baf_id) q = q.eq("baf_id", String(body.baf_id));
    else return null;
    const { data } = await q.maybeSingle();
    return data;
}

async function actAck(body: Any) {
    const d = await findDeal(body);
    if (!d) return json(404, { ok: false, error: "угоду не знайдено (fura_id)" });
    const now = new Date().toISOString();
    const patch: Any = { baf_synced_at: now };
    if (body.ok === false) {
        Object.assign(patch, { baf_state: "error", baf_error: String(body.error || "BAF не прийняв угоду").slice(0, 500) });
    } else {
        if (body.baf_number) patch.baf_number = String(body.baf_number);
        if (body.baf_id) patch.baf_id = String(body.baf_id);
        if (body.status) patch.baf_status = String(body.status);
        patch.baf_error = null;
        // поки BAF обробляв, угоду ще раз змінили у FURA — лишаємо в черзі, щоб BAF забрав нову версію
        const changed = body.version && d.baf_queued_at && new Date(d.baf_queued_at).getTime() !== new Date(body.version).getTime();
        patch.baf_state = changed ? "queued" : "sent";
    }
    const { error } = await db.from("deals").update(patch).eq("id", d.id);
    if (error) return json(500, { ok: false, error: error.message });
    return json(200, { ok: true, fura_id: d.id, state: patch.baf_state });
}

async function actUpdate(body: Any) {
    const d = await findDeal(body);
    if (!d) return json(404, { ok: false, error: "угоду не знайдено (fura_id / baf_number)" });
    const patch: Any = { baf_synced_at: new Date().toISOString() };
    if (body.status !== undefined) patch.baf_status = body.status ? String(body.status) : null;
    for (const k of ["paid_by_client", "paid_to_carrier", "originals_from_client", "originals_from_carrier"])
        if (typeof body[k] === "boolean") patch[k] = body[k];
    if (body.profit_fact_usd !== undefined) patch.profit_fact_usd = body.profit_fact_usd === null ? null : n(body.profit_fact_usd);
    if (Array.isArray(body.invoices))
        patch.baf_invoices = body.invoices.slice(0, 200).map((x: Any) => ({
            direction: x.direction === "in" ? "in" : "out",
            number: x.number ? String(x.number) : null,
            date: x.date ? String(x.date).slice(0, 10) : null,
            counterparty: x.counterparty ? String(x.counterparty) : null,
            amount: n(x.amount),
            paid: n(x.paid),
            currency: x.currency ? String(x.currency) : null,
        }));
    if (body.baf_number && !d.baf_number) patch.baf_number = String(body.baf_number);
    const { error } = await db.from("deals").update(patch).eq("id", d.id);
    if (error) return json(500, { ok: false, error: error.message });
    return json(200, { ok: true, fura_id: d.id });
}

Deno.serve(async (req) => {
    if (!TOKEN) return json(503, { ok: false, error: "BAF_TOKEN не задано в Secrets" });
    if (!sameToken(req.headers.get("x-baf-token") || "", TOKEN)) return json(401, { ok: false, error: "невірний X-Baf-Token" });
    let body: Any = {};
    if (req.method === "GET") body = Object.fromEntries(new URL(req.url).searchParams);
    else body = await req.json().catch(() => ({}));
    try {
        switch (body.action) {
            case "ping": return json(200, { ok: true, time: new Date().toISOString() });
            case "pending": return await actPending(body);
            case "ack": return await actAck(body);
            case "update": return await actUpdate(body);
            default: return json(400, { ok: false, error: "action: ping / pending / ack / update" });
        }
    } catch (e) {
        return json(500, { ok: false, error: String((e as Error)?.message || e).slice(0, 300) });
    }
});
