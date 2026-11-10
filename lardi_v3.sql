-- FURA «Ларді», крок 3: усі робочі країни — імпорт (країна → UA) і експорт (UA → країна).
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.
-- Лишні напрямки можна вимкнути галочкою на сторінці «Ларді» → «Напрямки».

insert into public.lardi_directions (from_country, to_country)
select c, 'UA' from unnest(array[
    -- Центральна та Східна Європа, Балтія
    'PL','DE','CZ','SK','HU','RO','BG','MD','LT','LV','EE',
    -- Західна Європа
    'AT','CH','LI','IT','FR','ES','PT','NL','BE','LU',
    -- Скандинавія, Британія, Ірландія, Ісландія
    'DK','SE','NO','FI','IS','GB','IE',
    -- Балкани, Греція, Кіпр, Мальта
    'SI','HR','BA','RS','ME','MK','AL','XK','GR','CY','MT',
    -- Туреччина, Кавказ, Центральна Азія
    'TR','GE','AM','AZ','KZ','UZ','KG','TJ','TM'
]) as c
on conflict (from_country, to_country) do nothing;

insert into public.lardi_directions (from_country, to_country)
select 'UA', c from unnest(array[
    'PL','DE','CZ','SK','HU','RO','BG','MD','LT','LV','EE',
    'AT','CH','LI','IT','FR','ES','PT','NL','BE','LU',
    'DK','SE','NO','FI','IS','GB','IE',
    'SI','HR','BA','RS','ME','MK','AL','XK','GR','CY','MT',
    'TR','GE','AM','AZ','KZ','UZ','KG','TJ','TM'
]) as c
on conflict (from_country, to_country) do nothing;

update public.lardi_directions set active = true
 where (to_country = 'UA' or from_country = 'UA');

-- Оновлення — лише вручну, кнопкою «Оновити зараз» на сторінці «Ларді» (вона сама проходить усі напрямки порціями).

select case when to_country = 'UA' then 'імпорт' when from_country = 'UA' then 'експорт' else 'інше' end as kind,
       count(*) filter (where active) as active, count(*) as total
  from public.lardi_directions group by 1 order by 1;
