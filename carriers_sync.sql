-- FURA: швидке завантаження «Перевізників».
-- Браузер зберігає всіх перевізників у себе і щоразу тягне з бази лише ЗМІНИ (а не 20 000 рядків).
-- Виконати один раз: Supabase → SQL Editor → New query → вставити весь файл → Run (можна повторно).

-- 1. Час останньої зміни рядка (ставиться автоматично)
alter table public.carriers add column if not exists updated_at timestamptz not null default now();
create index if not exists carriers_updated_at_idx on public.carriers (updated_at);

create or replace function public.carriers_touch()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;
drop trigger if exists carriers_touch on public.carriers;
create trigger carriers_touch before update on public.carriers
    for each row execute function public.carriers_touch();

-- 2. Журнал видалених перевізників (щоб браузер прибрав їх у себе)
create table if not exists public.carriers_deleted (
    id          text primary key,
    deleted_at  timestamptz not null default now()
);
create index if not exists carriers_deleted_at_idx on public.carriers_deleted (deleted_at);

create or replace function public.carriers_log_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.carriers_deleted (id, deleted_at) values (old.id::text, now())
    on conflict (id) do update set deleted_at = excluded.deleted_at;
    return old;
end;
$$;
drop trigger if exists carriers_log_delete on public.carriers;
create trigger carriers_log_delete after delete on public.carriers
    for each row execute function public.carriers_log_delete();

alter table public.carriers_deleted enable row level security;
drop policy if exists "carriers_deleted_select" on public.carriers_deleted;
create policy "carriers_deleted_select" on public.carriers_deleted
    for select to authenticated using (public.is_active_staff());

-- Перевірка:
-- select count(*), max(updated_at) from public.carriers;
