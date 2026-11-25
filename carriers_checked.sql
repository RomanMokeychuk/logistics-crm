-- FURA · «✓ Пробито»: коли і хто перевіряв перевізника через Lardi або редагував картку.
-- Supabase → SQL Editor → New query → вставити весь файл → Run (можна повторно).
alter table public.carriers add column if not exists checked_at  timestamptz; -- коли пробивали / редагували
alter table public.carriers add column if not exists checked_by  text;        -- хто (ім'я співробітника)
alter table public.carriers add column if not exists checked_how text;        -- lardi / edit
create index if not exists carriers_checked_at_idx on public.carriers (checked_at);

-- Перевірка: має показати 3 рядки
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'carriers' and column_name in ('checked_at', 'checked_by', 'checked_how');
