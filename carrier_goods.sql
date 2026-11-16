-- FURA: хто що возив за митними даними (експорт/імпорт) — для пошуку за товаром.
-- Один рядок = перевізник (ЄДРПОУ) × напрямок × група товару (перші 4 цифри коду УКТЗЕД).
-- 1) Supabase → SQL Editor → New query → вставити цей файл → Run.
-- 2) Table Editor → carrier_goods → Insert → Import data from CSV → по черзі carrier_goods_1.csv, _2.csv, _3.csv.
-- Щоб оновити новим місяцем: спершу  truncate public.carrier_goods;  потім знову імпорт нових CSV.

create extension if not exists pg_trgm;

create table if not exists public.carrier_goods (
    id          bigserial primary key,
    edrpou      text not null,
    carrier     text,
    direction   text,          -- Експорт / Імпорт
    hs4         text,          -- код товару (4 цифри)
    goods       text,          -- найменування товару (скорочено, до 2 варіантів)
    groups      text,          -- група товару
    countries   text,          -- країни
    months      text,          -- «2026-07, 2026-08»
    last_month  text,
    records     integer,       -- записів у деклараціях
    weight_t    numeric
);
create index if not exists carrier_goods_goods_trgm on public.carrier_goods using gin (goods gin_trgm_ops);
create index if not exists carrier_goods_groups_trgm on public.carrier_goods using gin (groups gin_trgm_ops);
create index if not exists carrier_goods_edrpou_idx on public.carrier_goods (edrpou);

alter table public.carrier_goods enable row level security;
drop policy if exists "carrier_goods_read" on public.carrier_goods;
create policy "carrier_goods_read" on public.carrier_goods for select to authenticated using (public.is_active_staff());

-- Перевірка після імпорту (має бути 169 319):
-- select count(*), count(distinct edrpou) from public.carrier_goods;
