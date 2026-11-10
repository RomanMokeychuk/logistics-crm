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

-- Розклад: напрямків близько сотні, тож оновлюємо порціями кожні 30 хв з 07:17 до 10:47 за Києвом
-- (зимовий час: 05–08 UTC). Кожен запуск бере ті напрямки, що довше не оновлювались.
-- Якщо раніше вмикали інший розклад Ларді — спершу вимкніть його:
--   select cron.unschedule('fura-lardi-morning');
--   select cron.unschedule('fura-lardi-batches');
-- Замініть <LARDI_CRON_SECRET> на той самий рядок, що в секреті функції.
--
-- select cron.schedule(
--     'fura-lardi-batches',
--     '17,47 5-8 * * *',
--     $$ select net.http_post(
--            url     := 'https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-lardi',
--            headers := jsonb_build_object(
--                'content-type', 'application/json',
--                'x-lardi-secret', '<LARDI_CRON_SECRET>'),
--            body    := '{"action":"tick"}'::jsonb,
--            timeout_milliseconds := 300000) $$
-- );

select case when to_country = 'UA' then 'імпорт' when from_country = 'UA' then 'експорт' else 'інше' end as kind,
       count(*) filter (where active) as active, count(*) as total
  from public.lardi_directions group by 1 order by 1;
