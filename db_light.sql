-- =====================================================================
-- FURA · Менше навантаження на базу (Disk IO). Нічого не видаляє з ваших даних.
-- Supabase → SQL Editor → New query → вставити → Run (можна повторно).
-- =====================================================================

-- 1) Індекси, щоб часті запити не перечитували всю таблицю
create index if not exists requests_created_at_idx on public.requests (created_at desc);
create index if not exists carriers_checked_at_idx on public.carriers (checked_at);
create index if not exists carriers_edrpou_idx on public.carriers (edrpou);

-- 2) Фонові завдання рідше (результат той самий, база відпочиває)
--    • розпізнавання міст: кожні 5 хв замість 2
--    • сповіщення про нові листи: кожні 2 хв замість 1
do $$
begin
    if exists (select 1 from cron.job where jobname = 'fura-geo') then
        perform cron.alter_job((select jobid from cron.job where jobname = 'fura-geo'), schedule := '*/5 * * * *');
    end if;
    if exists (select 1 from cron.job where jobname = 'fura-mail-push') then
        perform cron.alter_job((select jobid from cron.job where jobname = 'fura-mail-push'), schedule := '*/2 * * * *');
    end if;
end $$;

-- 3) Журнали фонових завдань ростуть щохвилини — чистимо щоночі (залишаємо 2 дні)
select cron.unschedule(jobname) from cron.job where jobname = 'fura-cleanup';
select cron.schedule('fura-cleanup', '13 3 * * *', $$
    delete from cron.job_run_details where end_time < now() - interval '2 days';
    delete from net._http_response where created < now() - interval '1 day';
$$);
-- одразу прибрати накопичене
delete from cron.job_run_details where end_time < now() - interval '2 days';
delete from net._http_response where created < now() - interval '1 day';

-- 4) Оновити статистику для планувальника запитів
analyze public.carriers;
analyze public.requests;
analyze public.echerha_queue;

-- Перевірка: розклад фонових завдань
select jobname, schedule, active from cron.job order by jobname;
