-- FURA: переписка з клієнтами — Outlook, Telegram, WhatsApp, Viber (етап 2 агента РОП).
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run (можна запускати повторно).
-- Потрібні is_active_staff() (agent_bids.sql) і rop_is_boss(), rop_my_staff_id() (rop.sql).

-- 1. Підключені канали: який ящик / номер / Telegram-акаунт належить якому співробітнику
create table if not exists public.comm_channels (
    id            uuid primary key default gen_random_uuid(),
    channel       text not null check (channel in ('outlook', 'telegram', 'whatsapp', 'viber')),
    account       text not null,        -- outlook: e-mail ящика · telegram: id бізнес-підключення ·
                                        -- whatsapp: phone_number_id з Meta · viber: 'bot'
    account_label text,                 -- як показувати: e-mail, @нік, +380…
    staff_id      text,                 -- staff.id власника (для viber — порожньо: бот спільний)
    staff_name    text,
    active        boolean not null default true,
    meta          jsonb not null default '{}'::jsonb,  -- outlook: user_oid, subscription_id, expires_at …
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (channel, account)
);

-- 2. Розмови: одна на пару «наш акаунт ↔ контакт»
create table if not exists public.comm_threads (
    id               uuid primary key default gen_random_uuid(),
    thread_key       text not null unique,   -- channel:account:contact
    channel          text not null,
    channel_id       uuid references public.comm_channels(id) on delete set null,
    staff_id         text,                   -- хто веде розмову
    staff_name       text,
    contact_handle   text not null,          -- телефон / e-mail / tg id / viber id
    contact_name     text,
    lead_id          text,                   -- прив'язка до «Ліди» (автоматично за телефоном / e-mail або вручну)
    lead_name        text,
    carrier_id       text,                   -- якщо це перевізник — у перевірки клієнтів не потрапляє
    linked_by        text,                   -- auto / ім'я співробітника
    link_checked_at  timestamptz,            -- коли востаннє шукали лід / перевізника за контактом
    last_message_at  timestamptz,
    last_direction   text,                   -- in / out
    last_in_at       timestamptz,
    last_out_at      timestamptz,
    unanswered_since timestamptz,            -- перше повідомлення клієнта після нашої останньої відповіді
    last_preview     text,
    messages_count   integer not null default 0,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);
create index if not exists comm_threads_staff_idx on public.comm_threads (staff_id, last_message_at desc);
create index if not exists comm_threads_lead_idx  on public.comm_threads (lead_id);
create index if not exists comm_threads_unans_idx on public.comm_threads (unanswered_since) where unanswered_since is not null;

-- 3. Повідомлення
create table if not exists public.comm_messages (
    id            uuid primary key default gen_random_uuid(),
    thread_id     uuid not null references public.comm_threads(id) on delete cascade,
    channel       text not null,
    external_id   text not null,             -- id у каналі — від повторів
    direction     text not null check (direction in ('in', 'out')),
    staff_id      text,
    sent_at       timestamptz not null,
    subject       text,                      -- лише для пошти
    text          text,
    kind          text not null default 'text',  -- text / image / document / voice / other
    ai_done       boolean not null default false,
    ai_intent     text,                      -- вхідні: quote_request / order / question / complaint / info / spam / other
    ai_has_rate   boolean,                   -- вихідні: чи названо ставку
    ai_tone       text,                      -- вихідні: ok / cold / rude
    ai_note       text,
    created_at    timestamptz not null default now(),
    unique (channel, external_id)
);
create index if not exists comm_messages_thread_idx on public.comm_messages (thread_id, sent_at);
create index if not exists comm_messages_ai_idx     on public.comm_messages (ai_done, sent_at) where ai_done = false;
create index if not exists comm_messages_sent_idx   on public.comm_messages (sent_at desc);

-- 4. Доступ.
--    Керівник і адмін бачать усю переписку.
--    Співробітник бачить розмову, якщо:
--      • веде її сам, або
--      • розмова прив'язана до клієнта, за яким він закріплений як Sales, або
--      • він логіст хоча б одного запиту цього клієнта.
--    Так логіст бачить, про що домовився Sales, а переписка не відкрита всьому офісу.
--    Змінювати — тільки сервер (функція fura-comms).
create or replace function public.comm_can_see(p_staff text, p_lead text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare me text;
begin
    if public.rop_is_boss() then return true; end if;
    if not public.is_active_staff() then return false; end if;
    me := public.rop_my_staff_id();
    if me is null then return false; end if;
    if p_staff = me then return true; end if;
    if p_lead is null then return false; end if;
    if exists (select 1 from public.leads l where l.id::text = p_lead and l.sales_id::text = me) then return true; end if;
    -- logistician_ids може бути масивом або jsonb — шукаємо id як текст
    return exists (
        select 1 from public.requests r
         where r.lead_id::text = p_lead
           and (r.logistician_id::text = me or coalesce(r.logistician_ids::text, '') like '%' || me || '%')
    );
end;
$$;

alter table public.comm_channels enable row level security;
alter table public.comm_threads  enable row level security;
alter table public.comm_messages enable row level security;

drop policy if exists "comm_channels_select" on public.comm_channels;
create policy "comm_channels_select" on public.comm_channels
    for select to authenticated using (
        public.rop_is_boss() or (public.is_active_staff() and staff_id = public.rop_my_staff_id())
    );

drop policy if exists "comm_threads_select" on public.comm_threads;
create policy "comm_threads_select" on public.comm_threads
    for select to authenticated using (public.comm_can_see(staff_id, lead_id));

drop policy if exists "comm_messages_select" on public.comm_messages;
create policy "comm_messages_select" on public.comm_messages
    for select to authenticated using (
        exists (select 1 from public.comm_threads t where t.id = thread_id and public.comm_can_see(t.staff_id, t.lead_id))
    );

-- 5. Живе оновлення сторінки «Переписка»
do $$
declare t text;
begin
    foreach t in array array['comm_threads', 'comm_messages'] loop
        if not exists (
            select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
        end if;
    end loop;
end $$;

-- 6. Розклад: кожні 10 хв — продовжити підписки Outlook, прив'язати нові розмови до лідів,
--    розібрати нові повідомлення (Claude: запит ставки / скарга / тон відповіді).
--    Замініть <COMMS_SECRET> на той самий рядок, що в секреті функції.
--
-- select cron.schedule(
--     'fura-comms-tick',
--     '*/10 * * * *',
--     $$ select net.http_post(
--            url     := 'https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-comms',
--            headers := jsonb_build_object(
--                'content-type', 'application/json',
--                'x-comms-secret', '<COMMS_SECRET>'),
--            body    := '{"action":"tick"}'::jsonb) $$
-- );

-- Перевірка: має показати 3 таблиці
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('comm_channels', 'comm_threads', 'comm_messages')
 order by 1;
