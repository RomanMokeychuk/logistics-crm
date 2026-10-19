-- FURA: AI-агент ставок (Telegram).
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run (можна запускати повторно).

-- 1. Перевізник ↔ Telegram
alter table public.carriers
    add column if not exists tg_chat_id   bigint,          -- чат перевізника з ботом
    add column if not exists tg_invite    text,            -- код із посилання-запрошення
    add column if not exists tg_linked_at timestamptz;     -- коли підключився

create unique index if not exists carriers_tg_invite_idx  on public.carriers (tg_invite)  where tg_invite  is not null;
create index        if not exists carriers_tg_chat_idx    on public.carriers (tg_chat_id) where tg_chat_id is not null;

-- 2. Повідомлення агента (чернетки, надіслані, відповіді перевізників)
create table if not exists public.agent_messages (
    id            uuid primary key default gen_random_uuid(),
    request_id    uuid not null references public.requests(id) on delete cascade,
    carrier_id    text not null,                        -- id перевізника (carriers.id як текст)
    carrier_name  text,
    direction     text not null check (direction in ('out', 'in')),
    status        text not null default 'draft'
                  check (status in ('draft', 'sent', 'rejected', 'failed', 'received')),
    text          text not null check (length(btrim(text)) between 1 and 4000),
    extracted     jsonb,                                -- що агент зрозумів із відповіді: ставка, дата...
    created_by    uuid,                                 -- хто попросив агента (staff.id)
    approved_by   uuid,                                 -- хто натиснув «Надіслати» (staff.id)
    tg_message_id bigint,
    error         text,
    created_at    timestamptz not null default now(),
    sent_at       timestamptz
);

create index if not exists agent_messages_request_idx on public.agent_messages (request_id, created_at);
create index if not exists agent_messages_status_idx  on public.agent_messages (status, created_at);
create index if not exists agent_messages_carrier_idx on public.agent_messages (carrier_id, created_at);

-- 3. Хто активний співробітник (сайт заходить під email співробітника)
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

-- 4. Доступ: читати — активні співробітники.
--    Створювати, надсилати й змінювати — тільки сервер (функція fura-agent), щоб ніхто
--    не міг з браузера «надіслати» повідомлення в обхід перевірок.
alter table public.agent_messages enable row level security;

drop policy if exists "agent_messages_select" on public.agent_messages;
create policy "agent_messages_select"
    on public.agent_messages for select to authenticated using (public.is_active_staff());

-- 5. Живе оновлення на сторінці «AI-агенти»
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_messages'
    ) then
        alter publication supabase_realtime add table public.agent_messages;
    end if;
end $$;

-- Перевірка: має показати 1 рядок «agent_messages»
select tablename from pg_publication_tables
 where pubname = 'supabase_realtime' and tablename = 'agent_messages';
