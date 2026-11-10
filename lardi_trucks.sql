-- FURA: «Ларді → Авто» — машини, які виставляють на Lardi-Trans.
-- Дані збирає та сама функція fura-lardi (bot/fura-lardi.ts) кнопкою «Оновити».
-- Перевізників, які вже є у «Перевізниках» FURA (збіг за телефоном або назвою),
-- функція позначає й дописує їм у картку напрямок: країну (з областю/воєводством) і область України.
-- Нових перевізників НЕ додає.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.

-- 1. Машини з Lardi (такі самі колонки, як у lardi_cargo) + посилання на картку перевізника
create table if not exists public.lardi_trucks (like public.lardi_cargo including defaults including indexes);
alter table public.lardi_trucks add column if not exists carrier_id bigint;   -- carriers.id, якщо перевізник є у FURA
create index if not exists lardi_trucks_last_idx    on public.lardi_trucks (seen_last desc);
create index if not exists lardi_trucks_carrier_idx on public.lardi_trucks (carrier_id);

-- 2. Окремий облік оновлень «Авто» по напрямках і в журналі
alter table public.lardi_directions add column if not exists truck_last_run_at timestamptz;
alter table public.lardi_directions add column if not exists truck_last_found  integer;
alter table public.lardi_runs       add column if not exists kind text not null default 'cargo';  -- cargo / truck

-- 3. Доступ: читати — усі співробітники; писати — лише функція (service_role)
alter table public.lardi_trucks enable row level security;
grant select on public.lardi_trucks to authenticated;
grant select, insert, update, delete on public.lardi_trucks to service_role;
drop policy if exists "lardi_trucks_read" on public.lardi_trucks;
create policy "lardi_trucks_read" on public.lardi_trucks for select to authenticated using (true);

-- функція читає перевізників і дописує їм напрямки
grant select, update on public.carriers to service_role;

-- Перевірка: має показати lardi_trucks
select table_name from information_schema.tables where table_schema = 'public' and table_name = 'lardi_trucks';
