-- FURA «Ларді», крок 2: експорт, більше країн, індекси (квадрати), оновлення порціями.
-- Виконати один раз ПІСЛЯ lardi.sql: Supabase → SQL Editor → New query → вставити → Run.

-- 1. Індекси / квадрати точок (на Lardi «85 кв.» = перші цифри поштового індексу)
alter table public.lardi_cargo add column if not exists from_zone     text;  -- «50» (квадрат)
alter table public.lardi_cargo add column if not exists from_postcode text;  -- «50-001», якщо вказано
alter table public.lardi_cargo add column if not exists to_zone       text;
alter table public.lardi_cargo add column if not exists to_postcode   text;

-- 2. Коли напрямок оновлювали востаннє (функція бере найдавніші першими)
alter table public.lardi_directions add column if not exists last_run_at timestamptz;
alter table public.lardi_directions add column if not exists last_found  integer;

-- 3. Експорт з України + більше країн імпорту (вимкнути зайве можна в «Напрямки»)
insert into public.lardi_directions (from_country, to_country) values
    ('UA','PL'), ('UA','DE'), ('UA','CZ'), ('UA','LT'), ('UA','NL'), ('UA','BE'), ('UA','IT'),
    ('UA','HU'), ('UA','RO'), ('UA','TR'), ('UA','SK'), ('UA','AT'), ('UA','FR'), ('UA','ES'),
    ('UA','MD'), ('UA','GE'), ('UA','LV'), ('UA','EE'), ('UA','BG'), ('UA','GB'),
    ('SK','UA'), ('AT','UA'), ('FR','UA'), ('ES','UA'), ('LV','UA'), ('EE','UA'), ('BG','UA'), ('MD','UA'), ('GE','UA'), ('GB','UA')
on conflict (from_country, to_country) do nothing;

-- 4. Розклад: оновлення порціями — кожні 30 хв з 07:17 до 09:47 за Києвом (зимовий час: 05–07 UTC).
--    Кожен запуск бере напрямки, які довше не оновлювались, тож за ранок проходять усі.
--    Якщо розклад з lardi.sql уже увімкнено — спершу вимкніть його:
--      select cron.unschedule('fura-lardi-morning');
--    Замініть <LARDI_CRON_SECRET> на той самий рядок, що в секреті функції.
--
-- select cron.schedule(
--     'fura-lardi-batches',
--     '17,47 5-7 * * *',
--     $$ select net.http_post(
--            url     := 'https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-lardi',
--            headers := jsonb_build_object(
--                'content-type', 'application/json',
--                'x-lardi-secret', '<LARDI_CRON_SECRET>'),
--            body    := '{"action":"tick"}'::jsonb,
--            timeout_milliseconds := 300000) $$
-- );

-- Перевірка: скільки напрямків імпорту й експорту
select case when to_country = 'UA' then 'імпорт' when from_country = 'UA' then 'експорт' else 'інше' end as kind,
       count(*) filter (where active) as active, count(*) as total
  from public.lardi_directions group by 1 order by 1;
