-- FURA: розділ «Клієнти» — картка клієнта (ті самі записи, що в «Ліди»).
-- Клієнт = лід на етапі «Працюємо» або той, з ким уже є угоди.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.

alter table public.leads
    add column if not exists full_name     text,            -- повне найменування
    add column if not exists address       text,            -- фактична адреса
    add column if not exists legal_address text,            -- юридична адреса
    add column if not exists docs_address  text,            -- адреса для оригіналів документів
    add column if not exists contacts      jsonb not null default '[]';  -- додаткові контакти [{name, position, phone, email}]

-- Перевірка: має показати 5 рядків
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'leads'
   and column_name in ('full_name', 'address', 'legal_address', 'docs_address', 'contacts');
