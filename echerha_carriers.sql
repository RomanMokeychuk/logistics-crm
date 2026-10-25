-- FURA: перевізники з «Черги» (Эчерга) автоматично потрапляють у «Перевізники».
--   • ЄДРПОУ ще немає в реєстрі → додаємо (назва, керівник, причепи, пункти, машини).
--   • Уже є → не дублюємо, тільки дописуємо нові типи причепа (тент, реф…).
-- Функцію викликає fura-echerha після кожної відправки з Эчерги (~кожні 30 хв).
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.

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
     );
    get diagnostics added = row_count;

    return jsonb_build_object('added', added, 'trailer_updated', updated);
end;
$$;

-- Викликати може тільки сервер (функція fura-echerha) і ви з SQL Editor
revoke all on function public.sync_echerha_carriers() from public, anon, authenticated;
grant execute on function public.sync_echerha_carriers() to service_role;

-- Одразу перенести тих, хто зараз у черзі (покаже, скільки додано і скільком дописано причепи)
select public.sync_echerha_carriers();
