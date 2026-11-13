-- FURA: автооновлення «Ларді · Вантажі» і «Ларді · Авто» ~3 рази на день.
-- Як працює: з 06:00 до 19:00 (за Києвом) кожні 20 хв функція fura-lardi бере напрямки,
-- які не оновлювались понад 4 години, і оновлює порцію (~100 с). Тож кожен напрямок
-- оновлюється приблизно 3 рази за робочий день. Вантажі й авто — по черзі, щоб не заважали одне одному.
--
-- ПЕРЕД ЗАПУСКОМ: замініть ДВА рази <LARDI_CRON_SECRET> на значення секрету LARDI_CRON_SECRET
-- (Supabase → Edge Functions → Secrets). Якщо такого секрету ще немає — створіть його: будь-який
-- довгий рядок, напр. lardi-7f3k9q2m8x… (і вставте той самий сюди).
-- Потім: Supabase → SQL Editor → New query → вставити весь файл → Run (можна повторно).

-- Старі розклади Ларді (якщо були) — вимикаємо
select cron.unschedule(jobname) from cron.job
 where jobname in ('fura-lardi-morning', 'fura-lardi-batches', 'fura-lardi-cargo', 'fura-lardi-trucks');

-- Вантажі: о :05, :25, :45 щогодини з 06 до 18 за Києвом (04–16 UTC)
select cron.schedule(
    'fura-lardi-cargo',
    '5,25,45 4-16 * * *',
    $$ select net.http_post(
           url     := 'https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-lardi',
           headers := jsonb_build_object('content-type', 'application/json', 'x-lardi-secret', '<LARDI_CRON_SECRET>'),
           body    := '{"action":"tick","kind":"cargo","stale_hours":4}'::jsonb,
           timeout_milliseconds := 300000) $$
);

-- Авто (машини перевізників): о :15, :35, :55
select cron.schedule(
    'fura-lardi-trucks',
    '15,35,55 4-16 * * *',
    $$ select net.http_post(
           url     := 'https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-lardi',
           headers := jsonb_build_object('content-type', 'application/json', 'x-lardi-secret', '<LARDI_CRON_SECRET>'),
           body    := '{"action":"tick","kind":"truck","stale_hours":4}'::jsonb,
           timeout_milliseconds := 300000) $$
);

-- Перевірка: розклади
select jobname, schedule, active from cron.job where jobname like 'fura-lardi%';
-- Через годину: останні запуски
-- select started_at, kind, started_by, found, error from public.lardi_runs order by started_at desc limit 10;
