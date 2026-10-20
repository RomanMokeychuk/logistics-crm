-- FURA: «Клієнти» — кілька напрямків перевезень (імпорт / експорт / по Україні, звідки → куди)
alter table public.leads
    add column if not exists routes jsonb not null default '[]';
