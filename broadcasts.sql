-- =====================================================================
-- FURA · Viber-розсилки (Київстар)
--   broadcasts            — одна розсилка (хто, кому: перевізникам/клієнтам, текст)
--   broadcast_recipients  — кожен отримувач і статус доставки
--   broadcast_optout      — номери, яким більше НЕ надсилати (попросили)
-- Пишуть сюди лише сервер (функція fura-broadcast). З сайту — тільки читати своє.
-- Запустити один раз у Supabase → SQL Editor → Run.
-- =====================================================================

create table if not exists public.broadcasts (
    id          bigserial primary key,
    created_at  timestamptz not null default now(),
    staff_id    text,                 -- staff.id автора
    staff_email text,
    staff_name  text,
    kind        text not null check (kind in ('carriers', 'clients')),
    request_id  bigint,               -- запит, з якого розсилали (для перевізників)
    text        text not null,
    total       int not null default 0,
    sent        int not null default 0,
    failed      int not null default 0,
    test        boolean not null default false,
    status      text not null default 'sending'
);

create table if not exists public.broadcast_recipients (
    id           bigserial primary key,
    broadcast_id bigint not null references public.broadcasts (id) on delete cascade,
    target_id    text,                -- carriers.id або leads.id
    name         text,
    phone        text not null,
    msg_id       text,
    status       text not null default 'queued',   -- queued / sent / delivered / read / failed / test / skipped
    error        text,
    updated_at   timestamptz not null default now()
);
create index if not exists broadcast_recipients_b on public.broadcast_recipients (broadcast_id);
create index if not exists broadcast_recipients_phone on public.broadcast_recipients (phone, updated_at desc);

create table if not exists public.broadcast_optout (
    phone      text primary key,
    note       text,
    created_at timestamptz not null default now(),
    created_by text
);

alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;
alter table public.broadcast_optout enable row level security;

-- читати: своє; керівник і адмін — усе
drop policy if exists broadcasts_read on public.broadcasts;
create policy broadcasts_read on public.broadcasts for select to authenticated
using (
    lower(staff_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or public.rop_is_boss()   -- керівник / адмін (з rop.sql)
);

drop policy if exists broadcast_recipients_read on public.broadcast_recipients;
create policy broadcast_recipients_read on public.broadcast_recipients for select to authenticated
using (exists (select 1 from public.broadcasts b where b.id = broadcast_id));

-- «не надсилати» — бачать усі співробітники (щоб розуміти, чому номер пропущено)
drop policy if exists broadcast_optout_read on public.broadcast_optout;
create policy broadcast_optout_read on public.broadcast_optout for select to authenticated
using (public.is_active_staff());

revoke insert, update, delete on public.broadcasts, public.broadcast_recipients, public.broadcast_optout from anon, authenticated;
