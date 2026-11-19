-- FURA · Вимкнути АВТОМАТИЧНИЙ обхід перевізників на Lardi.
-- Після цього дані з Lardi оновлюються ЛИШЕ коли ви самі натискаєте «З Lardi» в картці перевізника.
-- (Збір вантажів і машин для сторінки «Ларді» працює як і раніше.)
select cron.unschedule(jobname) from cron.job where jobname = 'fura-lardi-enrich';

-- перевірка: рядка fura-lardi-enrich більше не має бути
select jobname, schedule, active from cron.job where jobname like 'fura-lardi%';
