-- FURA: видалений вручну перевізник більше НЕ повертається з «Черги».
-- Раніше: видалили → через ~30 хв «Черга» бачила його машину на кордоні і додавала знову.
-- Тепер при видаленні запам'ятовуємо його ЄДРПОУ, і «Черга» таких не додає.
-- (Якщо захочете повернути — просто додайте вручну через «Додати перевізника».)
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run (можна повторно).

-- 1. Журнал видалених: ще й ЄДРПОУ
alter table public.carriers_deleted add column if not exists edrpou text;
create index if not exists carriers_deleted_edrpou_idx on public.carriers_deleted (edrpou);

create or replace function public.carriers_log_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.carriers_deleted (id, deleted_at, edrpou)
    values (old.id::text, now(), nullif(ltrim(regexp_replace(coalesce(old.edrpou::text, ''), '\D', '', 'g'), '0'), ''))
    on conflict (id) do update set deleted_at = excluded.deleted_at, edrpou = excluded.edrpou;
    return old;
end;
$$;

-- 2. «Черга» не додає тих, кого видалили вручну
create or replace function public.sync_echerha_carriers()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    added   integer := 0;
    updated integer := 0;
    today   text := to_char(now() at time zone 'Europe/Kyiv', 'DD.MM.YYYY');
begin
    -- Перевізники з поточного знімка черги (тільки з кодом ЄДРПОУ / ІПН)
    create temp table if not exists _eq_carriers (
        code text primary key, name text, boss text, bodies text[], plates text[], cps text[]
    ) on commit drop;
    truncate _eq_carriers;

    insert into _eq_carriers (code, name, boss, bodies, plates, cps)
    select ltrim(regexp_replace(q.edrpou, '\D', '', 'g'), '0') as code,
           (array_agg(q.carrier order by length(q.carrier) desc))[1],
           max(q.boss),
           array_remove(array_agg(distinct case
               when lower(q.trailer_body) in ('інше', 'невідомо', '') then null
               when lower(q.trailer_body) = 'платформа' then 'ПЛАТФОРМА'
               else upper(q.trailer_body) end), null),
           (array_agg(distinct q.tractor || coalesce('/' || nullif(q.trailer, ''), '')))[1:15],
           array_agg(distinct split_part(split_part(q.checkpoint, ' (', 1), '. ', 1))
      from public.echerha_queue q
     where coalesce(q.edrpou, '') ~ '\d{6,}'
       and coalesce(q.carrier, '') <> ''
       and q.carrier !~* '^(іноземн|очікує)'
     group by 1;

    -- 1) Уже є в реєстрі — дописуємо тільки нові типи причепа
    with m as (
        select c.id, c.trailer_type, e.bodies
          from public.carriers c
          join _eq_carriers e on ltrim(regexp_replace(coalesce(c.edrpou::text, ''), '\D', '', 'g'), '0') = e.code
         where cardinality(e.bodies) > 0
    ), merged as (
        select m.id,
               array_to_string(array(
                   select x from (
                       select trim(x) as x, min(o) as o
                         from unnest(string_to_array(coalesce(m.trailer_type, ''), ';') || m.bodies) with ordinality as t(x, o)
                        where trim(x) <> ''
                        group by trim(x)
                   ) s order by o), '; ') as tt,
               m.trailer_type as old
          from m
    )
    update public.carriers c
       set trailer_type = merged.tt
      from merged
     where c.id = merged.id
       and coalesce(merged.old, '') <> merged.tt;
    get diagnostics updated = row_count;

    -- 2) Немає в реєстрі — додаємо
    insert into public.carriers (name, edrpou, contact_person_1, trailer_type, notes, notes_updated_at)
    select e.name,
           case when length(e.code) <= 8 then lpad(e.code, 8, '0') else e.code end,
           nullif(e.boss, ''),
           nullif(array_to_string(e.bodies, '; '), ''),
           'Додано автоматично з «Черги» ' || today || '.'
               || coalesce(E'\nКерівник: ' || nullif(e.boss, ''), '')
               || E'\nБачили на кордоні: ' || array_to_string(e.cps, ', ')
               || E'\nМашини: ' || array_to_string(e.plates, ', '),
           now()
      from _eq_carriers e
     where not exists (
         select 1 from public.carriers c
          where ltrim(regexp_replace(coalesce(c.edrpou::text, ''), '\D', '', 'g'), '0') = e.code
     )
       -- видалених вручну не повертаємо
       and not exists (select 1 from public.carriers_deleted d where d.edrpou = e.code);
    get diagnostics added = row_count;

    return jsonb_build_object('added', added, 'trailer_updated', updated);
end;
$$;

revoke all on function public.sync_echerha_carriers() from public, anon, authenticated;
grant execute on function public.sync_echerha_carriers() to service_role;

-- 3. Якщо додали перевізника вручну — знімаємо «заборону» з його ЄДРПОУ
create or replace function public.carriers_unban_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if coalesce(new.notes, '') !~ '^Додано автоматично з «Черги»' then
        update public.carriers_deleted set edrpou = null
         where edrpou = nullif(ltrim(regexp_replace(coalesce(new.edrpou::text, ''), '\D', '', 'g'), '0'), '');
    end if;
    return new;
end;
$$;
drop trigger if exists carriers_unban_on_insert on public.carriers;
create trigger carriers_unban_on_insert after insert on public.carriers
    for each row execute function public.carriers_unban_on_insert();
