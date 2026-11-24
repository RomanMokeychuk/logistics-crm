-- =====================================================================
-- FURA · Пов'язані компанії перевізника (одна група власника)
-- Напр.: ТОВ «АВАНТОС» + ФОП Соболівський О. М. — це один перевізник.
-- У всіх компаній групи однаковий group_id.
-- Supabase → SQL Editor → New query → вставити → Run (можна повторно)
-- =====================================================================
alter table public.carriers
    add column if not exists group_id text;   -- спільний id групи (будь-який рядок, напр. uuid)

create index if not exists carriers_group_id on public.carriers (group_id) where group_id is not null;

-- Перевірка: має показати 1 рядок
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'carriers' and column_name = 'group_id';
