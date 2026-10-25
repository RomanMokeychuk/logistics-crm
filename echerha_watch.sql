-- FURA «Черга»: обрані машини (зірочка ★) і сповіщення, коли машина проїхала кордон.
-- Кожен співробітник бачить і змінює лише свої обрані.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.

create table if not exists public.echerha_watch (
    id          bigserial primary key,
    user_id     uuid not null default auth.uid(),
    plate       text not null,                 -- номер тягача латиницею, без пробілів: BC1234AB
    status      text not null default 'pending',  -- pending = ще не в черзі · waiting = у черзі · passed = проїхав
    checkpoint  text,
    entry_at    text,
    queue_no    text,
    trailer     text,
    carrier     text,
    edrpou      text,
    note        text,
    last_seen   timestamptz,                   -- коли востаннє бачили в черзі
    passed_at   timestamptz,                   -- коли зникла з черги (проїхала)
    seen        boolean not null default false, -- сповіщення в CRM уже показано
    created_at  timestamptz not null default now(),
    unique (user_id, plate)
);
create index if not exists echerha_watch_status_idx on public.echerha_watch (status);

grant select, insert, update, delete on public.echerha_watch to authenticated;
grant select, insert, update, delete on public.echerha_watch to service_role;
grant usage, select on sequence public.echerha_watch_id_seq to authenticated, service_role;

alter table public.echerha_watch enable row level security;
drop policy if exists "echerha_watch_own" on public.echerha_watch;
create policy "echerha_watch_own" on public.echerha_watch for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Миттєві сповіщення в CRM (Supabase Realtime)
do $$ begin
    alter publication supabase_realtime add table public.echerha_watch;
exception when duplicate_object then null; end $$;

select 'echerha_watch готова' as ok;
