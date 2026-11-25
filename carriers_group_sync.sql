-- =====================================================================
-- FURA · Пов'язані компанії = одна інформація
-- Компанії однієї групи (🔗 Пов'язані компанії) мають спільні:
--   напрямки (закордон і Україна), тип причепа, тоннаж, об'єм, «Додатково»,
--   контакти, нотатки, оцінку, позначку «пробито».
-- Окремими залишаються: назва, ЄДРПОУ, директор, область, місто, фото, профіль Lardi, автопарк (митні дані).
--  • При зв'язуванні — все об'єднується (нічого не губиться: напрямки, типи, контакти складаються).
--  • Далі змінили в одній компанії — те саме поле змінюється в усіх пов'язаних.
-- Supabase → SQL Editor → New query → вставити → Run (можна повторно).
-- =====================================================================

-- Об'єднати списки без повторів: «ТЕНТ;РЕФ» + «РЕФ;МЕГА» → «ТЕНТ;РЕФ;МЕГА»
create or replace function public.fura_tokens(vals text[], sep text) returns text
language sql immutable as $$
    select nullif(string_agg(t, case when sep = ',' then ', ' else ';' end order by ord), '')
      from (select distinct on (lower(t)) t, ord
              from (select trim(x.t) as t, v.i * 10000 + x.j as ord
                      from unnest(vals) with ordinality as v(val, i),
                           regexp_split_to_table(coalesce(v.val, ''), case when sep = ',' then '\s*[,;]\s*' else '\s*;\s*' end) with ordinality as x(t, j)) a
             where t <> ''
             order by lower(t), ord) b
$$;

-- Об'єднати всю групу (при зв'язуванні)
create or replace function public.carriers_group_merge(p_gid text) returns int
language plpgsql security definer set search_path = public as $$
declare
    ms jsonb[];
    merged jsonb;
    best jsonb;
    contacts jsonb := '[]'::jsonb;
    seen text[] := '{}';
    x jsonb; e jsonb; nm text; ph text; k text;
    sets text;
begin
    if p_gid is null then return 0; end if;
    select array_agg(to_jsonb(c) order by c.id) into ms from public.carriers c where c.group_id = p_gid;
    if ms is null or array_length(ms, 1) < 2 then return 0; end if;

    merged := jsonb_build_object(
        'trailer_type',       public.fura_tokens(array(select y->>'trailer_type' from unnest(ms) y), ';'),
        'ukraine_directions', public.fura_tokens(array(select y->>'ukraine_directions' from unnest(ms) y), ';'),
        'destinations',       public.fura_tokens(array(select y->>'destinations' from unnest(ms) y), ';'),
        'additional',         public.fura_tokens(array(select y->>'additional' from unnest(ms) y), ','),
        'rating',             (select max(nullif(y->>'rating', '')::numeric) from unnest(ms) y),
        'notes',              (select nullif(string_agg(distinct trim(y->>'notes'), E'\n'), '') from unnest(ms) y where coalesce(trim(y->>'notes'), '') <> '')
    );
    -- тоннаж / об'єм — з першої компанії, де заповнено (разом з позначкою «вписала FURA»)
    select y into best from unnest(ms) y where coalesce(y->>'tonnage', '') <> '' limit 1;
    if best is not null then merged := merged || jsonb_build_object('tonnage', best->'tonnage', 'cap_auto_t', best->'cap_auto_t'); end if;
    select y into best from unnest(ms) y where coalesce(y->>'volume', '') <> '' limit 1;
    if best is not null then merged := merged || jsonb_build_object('volume', best->'volume', 'cap_auto_v', best->'cap_auto_v'); end if;
    -- «пробито» — найсвіжіше
    select y into best from unnest(ms) y where coalesce(y->>'checked_at', '') <> '' order by y->>'checked_at' desc limit 1;
    if best is not null then merged := merged || jsonb_build_object('checked_at', best->'checked_at', 'checked_by', best->'checked_by', 'checked_how', best->'checked_how'); end if;

    -- контакти всіх компаній без повторів (за останніми 9 цифрами телефону)
    foreach x in array ms loop
        for e in
            select jsonb_build_object('name', x->>'contact_person_1', 'phone', x->>'phone_1')
            union all select jsonb_build_object('name', x->>'contact_person_2', 'phone', x->>'phone_2')
            union all select el from jsonb_array_elements(case when jsonb_typeof(x->'extra_contacts') = 'array' then x->'extra_contacts' else '[]'::jsonb end) el
        loop
            nm := nullif(trim(coalesce(e->>'name', '')), '');
            ph := nullif(trim(coalesce(e->>'phone', '')), '');
            if nm is null and ph is null then continue; end if;
            k := coalesce(nullif(right(regexp_replace(coalesce(ph, ''), '\D', '', 'g'), 9), ''), 'n:' || lower(nm));
            if k = any(seen) then continue; end if;
            seen := seen || k;
            contacts := contacts || jsonb_build_array(jsonb_build_object('name', nm, 'phone', ph));
        end loop;
    end loop;
    merged := merged || jsonb_build_object(
        'contact_person_1', contacts->0->'name', 'phone_1', contacts->0->'phone',
        'contact_person_2', contacts->1->'name', 'phone_2', contacts->1->'phone',
        'extra_contacts', coalesce((select jsonb_agg(el order by i) from jsonb_array_elements(contacts) with ordinality t(el, i) where i > 2), '[]'::jsonb));

    -- лише колонки, які є в таблиці
    select string_agg(format('%I = r.%I', key, key), ', ') into sets
      from jsonb_object_keys(merged) key where ms[1] ? key;
    if sets is null then return 0; end if;
    execute format('update public.carriers t set %s from jsonb_populate_record(null::public.carriers, $1) r where t.group_id = $2', sets)
        using merged, p_gid;
    return array_length(ms, 1);
end $$;
revoke all on function public.carriers_group_merge(text) from anon;

-- Тригер: зв'язали → об'єднати; змінили спільне поле → те саме в усіх компаніях групи
create or replace function public.carriers_group_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    f text; sets text := ''; nj jsonb; oj jsonb;
    shared text[] := array['destinations', 'ukraine_directions', 'trailer_type', 'tonnage', 'volume', 'cap_auto_t', 'cap_auto_v',
                           'additional', 'contact_person_1', 'phone_1', 'contact_person_2', 'phone_2', 'extra_contacts',
                           'notes', 'notes_updated_at', 'rating', 'checked_at', 'checked_by', 'checked_how'];
begin
    if pg_trigger_depth() > 1 or new.group_id is null then return null; end if;
    if tg_op = 'INSERT' or old.group_id is distinct from new.group_id then
        perform public.carriers_group_merge(new.group_id);
        return null;
    end if;
    nj := to_jsonb(new); oj := to_jsonb(old);
    foreach f in array shared loop
        if nj ? f and (nj -> f) is distinct from (oj -> f) then
            sets := sets || case when sets = '' then '' else ', ' end || format('%I = r.%I', f, f);
        end if;
    end loop;
    if sets <> '' then
        execute format('update public.carriers t set %s from jsonb_populate_record(null::public.carriers, $1) r where t.group_id = $2 and t.id <> $3', sets)
            using nj, new.group_id, new.id;
    end if;
    return null;
end $$;

drop trigger if exists carriers_group_sync on public.carriers;
create trigger carriers_group_sync after insert or update on public.carriers
    for each row execute function public.carriers_group_sync();

-- Одразу об'єднати всі групи, які вже є
select count(*) as "груп об'єднано" from (
    select public.carriers_group_merge(group_id) from (select distinct group_id from public.carriers where group_id is not null) g
) z;
