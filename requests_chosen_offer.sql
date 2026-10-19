-- Запити: Sales обирає конкретний варіант ціни логіста (ціна, валюта, дата)
alter table public.requests
    add column if not exists chosen_offer jsonb;

select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'requests' and column_name = 'chosen_offer';
