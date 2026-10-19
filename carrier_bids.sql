-- FURA: «Ставки перевізників» у картці запиту.
-- Логіст додає перевізників, пише їм у Viber/WhatsApp і вписує ставку й дату подачі.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run (можна запускати повторно).

create table if not exists public.carrier_bids (
    id            uuid primary key default gen_random_uuid(),
    request_id    uuid not null references public.requests(id) on delete cascade,
    carrier_id    text,                                  -- id перевізника з реєстру (як текст)
    carrier_name  text not null,
    phone         text,
    status        text not null default 'asked'
                  check (status in ('asked', 'bid', 'refused')),   -- запитали / є ставка / відмовився
    price         numeric(12, 2),
    currency      text not null default 'EUR' check (currency in ('EUR', 'USD', 'UAH')),
    load_date     date,                                  -- коли може подати авто
    note          text,
    created_by    uuid,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index if not exists carrier_bids_request_idx on public.carrier_bids (request_id, created_at);

-- Хто активний співробітник (така сама функція, як для AI-агента — тут на випадок, якщо її ще немає)
create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.staff
         where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
           and active
    );
$$;

-- Доступ: тільки активні співробітники FURA
alter table public.carrier_bids enable row level security;

drop policy if exists "carrier_bids_select" on public.carrier_bids;
drop policy if exists "carrier_bids_insert" on public.carrier_bids;
drop policy if exists "carrier_bids_update" on public.carrier_bids;
drop policy if exists "carrier_bids_delete" on public.carrier_bids;

create policy "carrier_bids_select" on public.carrier_bids for select to authenticated using (public.is_active_staff());
create policy "carrier_bids_insert" on public.carrier_bids for insert to authenticated with check (public.is_active_staff());
create policy "carrier_bids_update" on public.carrier_bids for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
create policy "carrier_bids_delete" on public.carrier_bids for delete to authenticated using (public.is_active_staff());

-- Перевірка: має показати 1 рядок «carrier_bids»
select table_name from information_schema.tables where table_schema = 'public' and table_name = 'carrier_bids';
