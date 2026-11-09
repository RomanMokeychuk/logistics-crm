-- FURA: вкладка «Ларді» — моніторинг заявок на вантажі з Lardi-Trans (лише з ціною).
-- Дані збирає Edge Function "fura-lardi" (bot/fura-lardi.ts) через офіційний Lardi API
-- ключем компанії: щоранку за розкладом і по кнопці «Оновити зараз».
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.

-- 1. Заявки на вантажі з Lardi (одна заявка = один рядок; повторно знайдена — оновлюється)
create table if not exists public.lardi_cargo (
    id              bigint primary key,            -- id заявки на Lardi
    seen_first      timestamptz not null default now(),
    seen_last       timestamptz not null default now(),

    from_country    text,                          -- PL
    to_country      text,                          -- UA
    direction       text,                          -- «PL → UA» (напрямок пошуку)
    from_town       text,
    from_region     text,                          -- воєводство / область
    from_points     text,                          -- усі точки завантаження
    to_town         text,
    to_region       text,
    to_points       text,
    date_from       date,
    date_to         date,
    distance_km     numeric,

    cargo           text,                          -- товар
    mass_t          numeric,
    volume_m3       numeric,
    body_types      text,                          -- тент, реф…
    load_types      text,                          -- бічне, заднє…
    adr             text,
    groupage        boolean,

    price           numeric,                       -- сума за рейс
    price_per_km    numeric,
    currency        text,                          -- EUR / USD / UAH
    payment_unit    text,                          -- як вказав автор (за рейс / за км / за т)
    payment_raw     numeric,                       -- значення як на Lardi
    payment_forms   text,                          -- безготівка, з ПДВ…
    prepay          numeric,
    delay_days      numeric,

    owner_ref       bigint,                        -- id компанії на Lardi
    owner_name      text,
    owner_face      text,                          -- контактна особа
    owner_phone     text,
    owner_type      text,                          -- Вантажовласник / Перевізник / Експедиція чи інші
    owner_rating    numeric,

    raw             jsonb                          -- повна заявка з API (для дозаповнення полів)
);
create index if not exists lardi_cargo_last_idx  on public.lardi_cargo (seen_last desc);
create index if not exists lardi_cargo_dir_idx   on public.lardi_cargo (direction);
create index if not exists lardi_cargo_owner_idx on public.lardi_cargo (owner_ref);

-- 2. Напрямки, які моніторимо (керівник змінює на сторінці «Ларді»)
create table if not exists public.lardi_directions (
    id            bigserial primary key,
    from_country  text not null,
    to_country    text not null,
    active        boolean not null default true,
    created_at    timestamptz default now(),
    unique (from_country, to_country)
);
insert into public.lardi_directions (from_country, to_country) values
    ('PL','UA'), ('DE','UA'), ('CZ','UA'), ('LT','UA'), ('NL','UA'),
    ('BE','UA'), ('IT','UA'), ('HU','UA'), ('RO','UA'), ('TR','UA')
on conflict (from_country, to_country) do nothing;

-- 3. Журнал запусків (коли оновлено, скільки знайдено, помилки)
create table if not exists public.lardi_runs (
    id          bigserial primary key,
    started_at  timestamptz default now(),
    finished_at timestamptz,
    trigger     text,                              -- cron / manual
    started_by  text,
    found       integer default 0,                 -- заявок з ціною знайдено
    saved       integer default 0,
    requests    integer default 0,                 -- скільки запитів до Lardi
    error       text,
    details     jsonb
);

-- 4. Доступ: читати — усі співробітники; писати — лише функція (service_role).
--    Напрямки змінює керівник через функцію, тож з браузера — лише читання.
alter table public.lardi_cargo      enable row level security;
alter table public.lardi_directions enable row level security;
alter table public.lardi_runs       enable row level security;

grant select on public.lardi_cargo, public.lardi_directions, public.lardi_runs to authenticated;
grant select, insert, update, delete on public.lardi_cargo, public.lardi_directions, public.lardi_runs to service_role;
grant usage, select on sequence public.lardi_directions_id_seq, public.lardi_runs_id_seq to service_role;

drop policy if exists "lardi_cargo_read" on public.lardi_cargo;
create policy "lardi_cargo_read" on public.lardi_cargo for select to authenticated using (true);
drop policy if exists "lardi_directions_read" on public.lardi_directions;
create policy "lardi_directions_read" on public.lardi_directions for select to authenticated using (true);
drop policy if exists "lardi_runs_read" on public.lardi_runs;
create policy "lardi_runs_read" on public.lardi_runs for select to authenticated using (true);

-- 5. Розклад: щодня о 07:47 за Києвом (зимовий час = 05:47 UTC).
--    Потрібні pg_cron і pg_net (вже увімкнені для fura-sales / fura-rop).
--    Замініть <LARDI_CRON_SECRET> на той самий рядок, що в секреті функції.
--
-- select cron.schedule(
--     'fura-lardi-morning',
--     '47 5 * * *',
--     $$ select net.http_post(
--            url     := 'https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-lardi',
--            headers := jsonb_build_object(
--                'content-type', 'application/json',
--                'x-lardi-secret', '<LARDI_CRON_SECRET>'),
--            body    := '{"action":"tick"}'::jsonb,
--            timeout_milliseconds := 120000) $$
-- );

-- Перевірка: має показати 3 таблиці
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('lardi_cargo', 'lardi_directions', 'lardi_runs')
 order by 1;
