-- Запити: кілька точок завантаження / розвантаження / замитнення / розмитнення
alter table public.requests
    add column if not exists extra_loads          jsonb not null default '[]',
    add column if not exists extra_unloads        jsonb not null default '[]',
    add column if not exists extra_customs_export jsonb not null default '[]',
    add column if not exists extra_customs_import jsonb not null default '[]';

select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'requests' and column_name like 'extra_%';
