-- FURA · Довідник міст: воєводство / регіон і «квадрат» (перші цифри поштового індексу)
-- Заповнюється сам, коли хтось відкриває картку перевізника (кожне місто шукається один раз).
-- Supabase → SQL Editor → New query → вставити → Run (можна повторно).
create table if not exists public.geo_places (
    key text primary key,          -- «pl|слупськ»
    country text,                  -- код країни: pl, de, tr…
    city text,
    state text,                    -- воєводство / земля / регіон
    postcode text,
    kv text,                       -- квадрат: «76», «44», «06»
    lat double precision,
    lon double precision,
    found boolean not null default true,
    updated_at timestamptz not null default now()
);
alter table public.geo_places enable row level security;
drop policy if exists geo_places_read on public.geo_places;
drop policy if exists geo_places_write on public.geo_places;
drop policy if exists geo_places_update on public.geo_places;
create policy geo_places_read on public.geo_places for select to authenticated using (true);
create policy geo_places_write on public.geo_places for insert to authenticated
    with check (exists (select 1 from public.staff s where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));
create policy geo_places_update on public.geo_places for update to authenticated
    using (exists (select 1 from public.staff s where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));
grant select, insert, update on public.geo_places to authenticated;

select 'geo_places' as ok, count(*) from public.geo_places;
