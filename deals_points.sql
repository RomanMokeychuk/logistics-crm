-- FURA: кілька точок завантаження і замитнення в угоді
-- Supabase → SQL Editor → New query → вставити → Run (можна запускати повторно)

alter table public.deals
    add column if not exists extra_loads   jsonb not null default '[]',  -- додаткові точки завантаження
    add column if not exists extra_customs jsonb not null default '[]';  -- додаткові замитнення

-- Перевірка: має показати 2 рядки
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'deals' and column_name in ('extra_loads', 'extra_customs');
