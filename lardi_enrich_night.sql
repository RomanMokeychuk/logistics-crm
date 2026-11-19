-- FURA: обхід перевізників у Lardi — лише вночі (20:00–07:00 за Києвом), раз на 10 хв.
-- Вдень увесь ліміт ключа Lardi лишається для вашої роботи («З Lardi», пошук вантажів).
-- Виконати: Supabase → SQL Editor → New query → вставити → Run.
select cron.alter_job(
    job_id   := (select jobid from cron.job where jobname = 'fura-lardi-enrich'),
    schedule := '*/10 18-23,0-4 * * *'   -- час у UTC = 20:00–06:59 за Києвом
);

-- Перевірка: що розклад змінився
select jobname, schedule, active from cron.job where jobname like 'fura-lardi%';

-- Останні помилки Lardi (пошук вантажів/машин) — надішліть скрін, якщо «З Lardi» і далі пише «зачекайте»
select started_at, trigger, requests, error from public.lardi_runs order by started_at desc limit 10;
