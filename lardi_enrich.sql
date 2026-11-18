-- FURA: перевізники ↔ Lardi (кнопка «З Lardi» і автоматичний обхід усіх перевізників)
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run (можна повторно).
--
-- ПЕРЕД ЗАПУСКОМ: замініть <LARDI_CRON_SECRET> на значення секрету LARDI_CRON_SECRET
-- (той самий, що вже стоїть у розкладі lardi_schedule.sql).

-- 1. Нові поля в картці перевізника
alter table public.carriers add column if not exists lardi_ref          bigint;      -- номер профілю в Lardi
alter table public.carriers add column if not exists lardi_rating       numeric;     -- рейтинг Lardi (0–10)
alter table public.carriers add column if not exists lardi_reviews_pos  integer;     -- позитивні відгуки
alter table public.carriers add column if not exists lardi_reviews_neg  integer;     -- негативні відгуки
alter table public.carriers add column if not exists lardi_checked_at   timestamptz; -- коли перевіряли
alter table public.carriers add column if not exists lardi_found        boolean;     -- знайшли в Lardi чи ні
create index if not exists carriers_lardi_checked_idx on public.carriers (lardi_checked_at nulls first);

-- 2. Розклад: кожні 5 хвилин — порція до 30 перевізників (~1 запит до Lardi на кожного).
--    Усі ~10 700 перевізників — приблизно за 1,5–2 доби; далі кожен перевіряється раз на тиждень.
select cron.unschedule(jobname) from cron.job where jobname = 'fura-lardi-enrich';
select cron.schedule(
    'fura-lardi-enrich',
    '*/5 * * * *',
    $$ select net.http_post(
           url     := 'https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-lardi',
           headers := jsonb_build_object('content-type', 'application/json', 'x-lardi-secret', '<LARDI_CRON_SECRET>'),
           body    := '{"action":"enrich_tick","limit":30}'::jsonb,
           timeout_milliseconds := 180000) $$
);

-- Перевірка (через годину): скільки вже перевірено і знайдено
-- select count(*) filter (where lardi_checked_at is not null) as checked,
--        count(*) filter (where lardi_found) as found, count(*) as total from public.carriers;
