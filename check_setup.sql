-- FURA · ПЕРЕВІРКА: що вже запущено в базі, а що ні
-- Supabase → SQL Editor → New query → вставити весь файл → Run.
-- Нічого не змінює, лише показує. ✅ — є, ❌ — запустіть файл з колонки «файл».
with c(n, file, what, ok) as (values
  (1, 'carriers_group.sql',   '🔗 Пов''язані компанії',              exists(select 1 from information_schema.columns where table_schema='public' and table_name='carriers' and column_name='group_id')),
  (2, 'deals_baf.sql',        'Угоди як у BAF + файли',              exists(select 1 from information_schema.columns where table_schema='public' and table_name='deals' and column_name='baf_state')),
  (3, 'carriers_checked.sql', '✓ Пробито (хто і коли)',              exists(select 1 from information_schema.columns where table_schema='public' and table_name='carriers' and column_name='checked_at')),
  (4, 'carrier_activity.sql', '📊 Активність колег',                 to_regclass('public.carrier_activity') is not null and exists(select 1 from pg_trigger where tgname='carrier_activity_trg')),
  (5, 'mail_push.sql',        '🔔 Сповіщення пошти (таблиці)',       to_regclass('public.push_subs') is not null and to_regclass('public.push_config') is not null),
  (6, 'mail_push.sql',        '⏰ Нагадування про листи',            to_regclass('public.mail_reminders') is not null),
  (7, 'mail_push.sql',        '🔔 Щохвилинна перевірка пошти',       case when to_regclass('cron.job') is null then false
        else (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from cron.job where jobname = 'fura-mail-push'$q$, false, true, '')))[1]::text::int > 0 end),
  (8, 'mail_contacts.sql',    '📒 Адресна книга пошти',              to_regclass('public.mail_contacts') is not null),
  (9, 'staff_mailboxes.sql',  '✉️ Підключення пошти співробітників', to_regclass('public.staff_mailboxes') is not null)
)
select n as "№", case when ok then '✅' else '❌' end as "стан", what as "що", file as "файл"
from c order by n;
