-- FURA: «Блокнот запитів» — особисті нотатки по запитах (як Google-таблиця «ЗАПРОСИ»).
-- Кожен бачить і змінює ЛИШЕ свої записи.
-- Supabase → SQL Editor → New query → вставити → Run.

create table if not exists public.my_requests (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
    direction   text,           -- Польща - Україна
    addresses   text,           -- Гданськ - Київ
    cargo       text,           -- сталь в рулонах 23т
    truck       text,           -- ТЕНТ
    comment     text,           -- дата / ставка / що завгодно
    status      text,           -- Актуальне / Прорахунок / Закрито / Відмова
    carriers    jsonb not null default '[]'::jsonb,  -- [{id, name, edrpou, price, note}]
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists my_requests_user_idx on public.my_requests (user_id, updated_at desc);

alter table public.my_requests enable row level security;
drop policy if exists "my_requests_own" on public.my_requests;
create policy "my_requests_own" on public.my_requests for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.my_requests_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists my_requests_touch on public.my_requests;
create trigger my_requests_touch before update on public.my_requests
    for each row execute function public.my_requests_touch();
