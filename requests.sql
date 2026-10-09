-- Таблиця запитів для LogiCRM.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.

create table if not exists public.requests (
    id             uuid primary key default gen_random_uuid(),
    created_at     timestamptz not null default now(),
    client         text not null,
    load_country   text,
    unload_country text,
    status         text not null default 'Запит',
    desired_date   date,
    sales          text,
    logistician    text
);

-- Доступ тільки для залогінених користувачів
alter table public.requests enable row level security;

create policy "requests_select_authenticated"
    on public.requests for select to authenticated using (true);

create policy "requests_insert_authenticated"
    on public.requests for insert to authenticated with check (true);

create policy "requests_update_authenticated"
    on public.requests for update to authenticated using (true) with check (true);

create policy "requests_delete_authenticated"
    on public.requests for delete to authenticated using (true);