-- FURA: заблоковані компанії Lardi — їхні заявки й машини не показуються на «Ларді · Вантажі» і «Ларді · Авто».
-- Supabase → SQL Editor → New query → вставити → Run (можна повторно).
create table if not exists public.lardi_blocked (
    key         text primary key,          -- r:<номер профілю Lardi> або n:<назва малими літерами>
    name        text,
    blocked_by  text,
    created_at  timestamptz not null default now()
);
alter table public.lardi_blocked enable row level security;
drop policy if exists "lardi_blocked_all" on public.lardi_blocked;
create policy "lardi_blocked_all" on public.lardi_blocked for all to authenticated
    using (public.is_active_staff()) with check (public.is_active_staff());
