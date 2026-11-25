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

-- ===== Фонове розпізнавання всіх міст з «Напрямків» (для фільтра «📍 Регіон / квадрат») =====
alter table public.geo_places add column if not exists cname text; -- назва країни як у «Напрямках» (ПОЛЬЩА…)
create index if not exists geo_places_cname_city on public.geo_places (cname, lower(city));

-- Міста з напрямків перевізників, яких ще немає в довіднику
create or replace function public.geo_missing(p_limit int default 40)
returns table(country text, city text) language sql stable security definer set search_path = '' as $$
    with pairs as (
        select upper(regexp_replace(trim(split_part(d, '-', 1)), '\s+', ' ', 'g')) as country,
               trim(c) as city
          from public.carriers,
               unnest(string_to_array(coalesce(destinations, ''), ';')) d,
               unnest(string_to_array(case when position('-' in d) > 0 then substring(d from position('-' in d) + 1) else '' end, ',')) c
    )
    select p.country, min(p.city)
      from pairs p
     where length(p.city) between 2 and 40 and p.city !~ '\d' and p.country not in ('', 'УКРАЇНА')
       and not exists (select 1 from public.geo_places g where g.cname = p.country and lower(g.city) = lower(p.city))
     group by p.country, lower(p.city)
     limit p_limit;
$$;
revoke all on function public.geo_missing(int) from anon, authenticated;

-- Токен для розкладу (той самий, що для сповіщень пошти; якщо ще немає — створюємо)
create table if not exists public.push_cron (id int primary key, token text not null);
insert into public.push_cron (id, token) values (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
    on conflict (id) do nothing;
alter table public.push_cron enable row level security;
revoke all on public.push_cron from anon, authenticated;

-- Кожні 2 хвилини — ~30 нових міст (правила OpenStreetMap: не частіше 1 запиту на секунду)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobname) from cron.job where jobname = 'fura-geo';
select cron.schedule(
    'fura-geo',
    '*/2 * * * *',
    $$ select net.http_post(
           url := 'https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-echerha',
           headers := jsonb_build_object('content-type', 'application/json', 'x-push-token', (select token from public.push_cron where id = 1)),
           body := '{"action":"geo_tick"}'::jsonb,
           timeout_milliseconds := 110000
       ) $$
);
select jobname, schedule, active from cron.job where jobname = 'fura-geo';
-- Скільки вже розпізнано:  select count(*) filter (where found) as знайдено, count(*) as всього from public.geo_places;
