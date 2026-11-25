/* ================================================================= *
 * FURA — ПОВ'ЯЗАНІ КОМПАНІЇ ПЕРЕВІЗНИКА                               *
 * Один власник часто має кілька компаній (ТОВ + ФОП, кілька ФОП).     *
 * У картці — блок «🔗 Пов'язані компанії»: список, «+ Пов'язати»       *
 * (знайти в реєстрі або додати нову), «Відв'язати».                   *
 * Компанії групи мають спільний carriers.group_id (carriers_group.sql)*
 * ================================================================= */
(function () {
    const db = typeof sbClient !== "undefined" ? sbClient : null;
    if (!db) return;
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
    const safeQ = (q) => String(q || "").replace(/[,()%*\\"]/g, " ").trim();
    const newId = () => (crypto.randomUUID ? crypto.randomUUID() : "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    const POPUP = new URLSearchParams(location.search).get("cpop") === "1";

    async function membersOf(item) {
        if (!item?.group_id) return [];
        const { data } = await db.from("carriers").select("id, name, edrpou, city, region_ukr, profile_url, group_id").eq("group_id", item.group_id).neq("id", item.id).order("name");
        return data || [];
    }
    function patchCache(id, patch) {
        const c = (typeof allCarriersCache !== "undefined" ? allCarriersCache : []).find((x) => String(x.id) === String(id));
        if (c) Object.assign(c, patch);
    }

    // Пов'язати дві компанії: якщо вже є групи — зливаємо в одну
    async function link(a, b) {
        if (String(a.id) === String(b.id)) return;
        let gid = a.group_id || b.group_id || newId();
        const other = a.group_id && b.group_id && a.group_id !== b.group_id ? b.group_id : null;
        const ids = [a.id, b.id].filter((id, i) => !(i === 0 ? a.group_id === gid : b.group_id === gid));
        if (ids.length) {
            const { error } = await db.from("carriers").update({ group_id: gid }).in("id", ids);
            if (error) throw error;
        }
        if (other) {
            const { error } = await db.from("carriers").update({ group_id: gid }).eq("group_id", other);
            if (error) throw error;
        }
        [a, b].forEach((x) => { x.group_id = gid; patchCache(x.id, { group_id: gid }); });
        return gid;
    }
    async function unlink(item, m) {
        await db.from("carriers").update({ group_id: null }).eq("id", m.id);
        patchCache(m.id, { group_id: null });
        // залишилась одна компанія — група більше не потрібна
        const rest = await membersOf(item);
        if (!rest.length) {
            await db.from("carriers").update({ group_id: null }).eq("id", item.id);
            item.group_id = null;
            patchCache(item.id, { group_id: null });
        }
    }
    // Знайти компанію в реєстрі (за ЄДРПОУ / точною назвою) або створити
    async function findOrCreate({ name, edrpou, city, profile_url }) {
        const code = String(edrpou || "").replace(/\D/g, "");
        if (code) {
            const { data } = await db.from("carriers").select("*").eq("edrpou", code).limit(1);
            if (data?.[0]) return data[0];
        }
        if (name) {
            const { data } = await db.from("carriers").select("*").ilike("name", safeQ(name)).limit(1);
            if (data?.[0]) return data[0];
        }
        const row = { name: String(name || "").trim() };
        if (code) row.edrpou = code;
        if (city) row.city = city;
        if (profile_url) row.profile_url = profile_url;
        const { data, error } = await db.from("carriers").insert([row]).select().single();
        if (error) throw error;
        if (typeof allCarriersCache !== "undefined") allCarriersCache.push(data);
        return data;
    }
    window.furaCarrierGroup = { link, findOrCreate, membersOf };

    function openCarrier(id) {
        if (POPUP) return (location.href = `carriers.html?cpop=1&open=${encodeURIComponent(id)}`);
        const inCache = typeof allCarriersCache !== "undefined" && allCarriersCache.some((c) => String(c.id) === String(id));
        if (inCache && typeof openCarrierCard === "function") openCarrierCard(id);
        else location.href = `carriers.html?open=${encodeURIComponent(id)}`;
    }

    let seq = 0;
    async function renderCard(item) {
        const body = document.getElementById("carrierCardBody");
        if (!body || !item) return;
        const my = ++seq;
        body.querySelector("#carrierGroup")?.remove();
        body.querySelectorAll(".cg-chk").forEach((x) => x.remove());
        const box = document.createElement("div");
        box.id = "carrierGroup";
        box.className = "cg";
        // одразу під шапкою картки
        const head = body.querySelector(".card-header-block");
        if (head) head.after(box);
        else body.prepend(box);
        // ✓ хто і коли пробивав цього перевізника (Lardi / редагування) — свіже з бази
        sbClient.from("carriers").select("checked_at, checked_by, checked_how").eq("id", item.id).maybeSingle().then(({ data: ck }) => { // eslint-disable-line no-undef
            if (my !== seq || !ck?.checked_at) return;
            const el = document.createElement("div");
            el.className = "cg-chk";
            el.innerHTML = `✓ ${ck.checked_how === "lardi" ? "Пробито через Lardi" : "Відредаговано"}: <b>${esc(ck.checked_by || "—")}</b> · ${esc(new Date(ck.checked_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }))}`;
            box.before(el);
        }).catch(() => {});
        const members = await membersOf(item);
        if (my !== seq) return;
        draw(box, item, members);
    }

    function draw(box, item, members) {
        box.innerHTML = `
            <div class="cg-head"><b>🔗 Пов'язані компанії</b>${members.length ? `<span class="cg-n">${members.length + 1} у групі</span>` : `<span class="cg-hint">той самий власник: ТОВ + ФОП, кілька ФОП…</span>`}
                <button type="button" class="cg-add" data-cg="add">+ Пов'язати</button></div>
            ${members.length ? `<div class="cg-list">${members.map((m) => `
                <div class="cg-item"><a href="#" data-cg-open="${esc(m.id)}">${esc(m.name || "—")}</a>
                    <span class="cg-sub">${esc([m.edrpou, m.city || m.region_ukr].filter(Boolean).join(" · "))}</span>
                    ${m.profile_url ? `<a class="cg-lardi" href="${esc(m.profile_url)}" target="_blank" rel="noopener">Lardi ↗</a>` : ""}
                    <button type="button" class="cg-x" data-cg-un="${esc(m.id)}" title="Відв'язати">✕</button></div>`).join("")}</div>` : ""}
            <div class="cg-form" hidden>
                <input type="text" class="cg-q" placeholder="Назва, ЄДРПОУ або ПІБ ФОП…" autocomplete="off" />
                <div class="cg-sg"></div>
            </div>`;
        const form = box.querySelector(".cg-form"), q = box.querySelector(".cg-q"), sg = box.querySelector(".cg-sg");
        let t = 0, found = [];
        box.addEventListener("click", async (e) => {
            const op = e.target.closest("[data-cg-open]");
            if (op) { e.preventDefault(); return openCarrier(op.dataset.cgOpen); }
            const un = e.target.closest("[data-cg-un]");
            if (un) {
                const m = members.find((x) => String(x.id) === un.dataset.cgUn);
                if (!m || !confirm(`Відв'язати «${m.name}»? Компанія залишиться в реєстрі, просто не в цій групі.`)) return;
                await unlink(item, m);
                return renderCard(item);
            }
            if (e.target.closest("[data-cg=add]")) { form.hidden = !form.hidden; if (!form.hidden) q.focus(); return; }
            const pick = e.target.closest("[data-cg-pick]");
            if (pick) {
                try {
                    const v = pick.dataset.cgPick;
                    const other = v === "new" ? await findOrCreate(parseNew(q.value)) : found[Number(v)];
                    if (!other) return;
                    if (String(other.id) === String(item.id)) return alert("Це та сама компанія.");
                    await link(item, other);
                    renderCard(item);
                } catch (err) {
                    alert(/group_id/.test(err?.message || "") ? "Один раз запустіть carriers_group.sql у Supabase." : "Не вдалося: " + (err?.message || err));
                }
            }
        });
        q.addEventListener("input", () => {
            clearTimeout(t);
            const s = safeQ(q.value);
            if (s.length < 2) return (sg.innerHTML = "");
            t = setTimeout(async () => {
                const { data } = await db.from("carriers").select("id, name, edrpou, city, region_ukr, group_id").or(`name.ilike.%${s}%,edrpou.ilike.%${s}%,director.ilike.%${s}%`).limit(8);
                found = (data || []).filter((x) => String(x.id) !== String(item.id) && !members.some((m) => String(m.id) === String(x.id)));
                sg.innerHTML = found.map((x, i) => `<button type="button" class="cg-opt" data-cg-pick="${i}"><b>${esc(x.name)}</b><span>${esc([x.edrpou, x.city || x.region_ukr, x.group_id ? "уже в іншій групі — об'єднаю" : ""].filter(Boolean).join(" · "))}</span></button>`).join("")
                    + `<button type="button" class="cg-opt cg-new" data-cg-pick="new"><b>+ Додати нову: «${esc(q.value.trim())}»</b><span>якщо цієї компанії ще немає в реєстрі (напр. ФОП). Можна дописати ЄДРПОУ через кому</span></button>`;
            }, 250);
        });
    }
    // «ФОП Петренко Іван Іванович, 1234567890» → назва + ЄДРПОУ/ІПН
    function parseNew(v) {
        const m = String(v || "").match(/(\d{8,10})/);
        return { name: String(v || "").replace(/,?\s*\d{8,10}\s*/, " ").replace(/\s+/g, " ").trim(), edrpou: m ? m[1] : "" };
    }
    window.furaCarrierGroup.renderCard = renderCard;

    const css = document.createElement("style");
    css.textContent = `
    .cg-chk { margin: 0 0 8px; padding: 6px 12px; border-radius: 10px; background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; font-size: 13px; }
    .cg { margin: 0 0 14px; padding: 10px 14px; border: 1px solid #ece7dc; border-radius: 14px; background: #fffdf8; }
    .cg-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 14px; }
    .cg-n { font-size: 12px; font-weight: 700; color: #8a6412; background: #fff3d6; border-radius: 999px; padding: 1px 8px; }
    .cg-hint { font-size: 12px; color: #9ca3af; }
    .cg-add { margin-left: auto; border: 1px dashed #d9a944; background: #fffaf0; color: #8a6412; border-radius: 9px; padding: 5px 11px; font: 600 13px inherit; cursor: pointer; }
    .cg-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .cg-item { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 7px 10px; background: #fff; border: 1px solid #eef0f3; border-radius: 10px; }
    .cg-item > a[data-cg-open] { font-weight: 700; color: #1d4ed8; text-decoration: none; }
    .cg-sub { font-size: 12px; color: #6b7280; }
    .cg-lardi { font-size: 12px; color: #8a6412; }
    .cg-x { margin-left: auto; border: 0; background: none; color: #9ca3af; cursor: pointer; font-size: 14px; }
    .cg-x:hover { color: #b91c1c; }
    .cg-form { margin-top: 8px; }
    .cg-q { width: 100%; box-sizing: border-box; padding: 9px 12px; border: 1px solid #e5e7eb; border-radius: 10px; font: inherit; }
    .cg-sg { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
    .cg-opt { text-align: left; border: 1px solid #eef0f3; background: #fff; border-radius: 9px; padding: 7px 10px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; font: inherit; }
    .cg-opt span { font-size: 12px; color: #6b7280; }
    .cg-opt:hover { border-color: #d9a944; background: #fffaf0; }
    .cg-new b { color: #8a6412; }`;
    document.head.appendChild(css);
})();
