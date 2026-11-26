-- FURA: «Цільова ставка перевізнику» в картці запиту.
-- Розрахунок (логісти + Lardi) працює і без цього файлу.
-- Цей SQL потрібен, щоб логіст міг зберегти СВОЮ цільову ставку.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.

alter table public.requests
    add column if not exists target_price    numeric,
    add column if not exists target_currency text,
    add column if not exists target_by       text,
    add column if not exists target_at       timestamptz;

-- Швидкий пошук схожих запитів і цін Lardi за напрямком
create index if not exists requests_dir_created_idx on public.requests (load_country, unload_country, created_at desc);
create index if not exists lardi_cargo_cc_last_idx  on public.lardi_cargo (from_country, to_country, seen_last desc);

select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'requests' and column_name like 'target_%';
