-- FURA: напрямки перевізників з митних даних — для підбору «під запит».
-- Один рядок = перевізник (ЄДРПОУ) × напрямок (імпорт/експорт) × країна × область України × місяць.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.
-- Потім: Table Editor → carrier_routes → Insert → Import data from CSV → carrier_routes.csv

create table if not exists public.carrier_routes (
    id            bigserial primary key,
    edrpou        text not null,
    direction     text not null,          -- Імпорт / Експорт
    country       text not null,          -- країна відправлення (імпорт) або призначення (експорт)
    ua_region     text,                   -- область України (за митницею оформлення)
    month         text not null,          -- 2026-09
    trucks        integer,                -- різних машин (номерів)
    records       integer,                -- записів у митних деклараціях
    trailer_types text,                   -- ТЕНТ; РЕФ …
    border        text,                   -- основний пункт пропуску
    goods         text,                   -- що везли
    plates        text                    -- номери авто
);

create index if not exists carrier_routes_country_idx on public.carrier_routes (country, direction);
create index if not exists carrier_routes_edrpou_idx  on public.carrier_routes (edrpou);

-- Читати можуть тільки активні співробітники; змінювати — тільки з SQL Editor
alter table public.carrier_routes enable row level security;
drop policy if exists "carrier_routes_read" on public.carrier_routes;
create policy "carrier_routes_read" on public.carrier_routes
    for select to authenticated
    using (exists (select 1 from public.staff s
                    where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

-- Перевірка після завантаження CSV: має бути 31 176
select count(*) as routes, count(distinct edrpou) as carriers from public.carrier_routes;
