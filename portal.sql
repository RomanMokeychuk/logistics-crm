-- FURA: кабінети клієнта і перевізника (етап 1 + MVP кабінетів).
-- Виконати один раз: Supabase → SQL Editor → New query → вставити весь файл → Run (можна повторно).
--
-- Як це влаштовано:
--   • Клієнти й перевізники НЕ отримують акаунтів Supabase і не читають таблиці напряму.
--     Усе йде через серверну функцію fura-portal: вона перевіряє, хто зайшов,
--     і віддає лише дозволені поля (без маржі, ставок інших, назви клієнта / перевізника).
--   • Вхід: перевізник — через Telegram (бот Грандар), клієнт — за посиланням-запрошенням
--     або кодом на e-mail. Сесії живуть у portal_tokens (зберігається лише хеш).
--   • Таблиці кабінетів читають тільки співробітники; змінює тільки сервер.

-- 1. Хто має доступ до кабінету
create table if not exists public.portal_accounts (
    id            uuid primary key default gen_random_uuid(),
    kind          text not null check (kind in ('client', 'carrier')),
    lead_id       text,                 -- клієнт: leads.id (як текст)
    carrier_id    text,                 -- перевізник: carriers.id (як текст)
    name          text,                 -- ім'я людини, якій дали доступ
    email         text,
    phone         text,
    tg_chat_id    bigint,               -- перевізник: Telegram, з якого заходить
    active        boolean not null default true,
    created_by    uuid,                 -- staff.id
    created_at    timestamptz not null default now(),
    last_login_at timestamptz,
    check ((kind = 'client' and lead_id is not null) or (kind = 'carrier' and carrier_id is not null))
);
create index if not exists portal_accounts_lead_idx    on public.portal_accounts (lead_id)    where lead_id is not null;
create index if not exists portal_accounts_carrier_idx on public.portal_accounts (carrier_id) where carrier_id is not null;
create index if not exists portal_accounts_email_idx   on public.portal_accounts (lower(email)) where email is not null;
create index if not exists portal_accounts_tg_idx      on public.portal_accounts (tg_chat_id) where tg_chat_id is not null;

-- 2. Запрошення, сесії, коди з e-mail (лише хеш — сам код ніде не зберігається)
create table if not exists public.portal_tokens (
    hash        text primary key,
    account_id  uuid not null references public.portal_accounts(id) on delete cascade,
    purpose     text not null check (purpose in ('invite', 'session', 'code')),
    expires_at  timestamptz not null,
    used_count  integer not null default 0,
    attempts    integer not null default 0,
    created_at  timestamptz not null default now()
);
create index if not exists portal_tokens_account_idx on public.portal_tokens (account_id, purpose);

-- 3. Журнал дій у кабінетах (хто, коли, що)
create table if not exists public.portal_log (
    id          bigserial primary key,
    account_id  uuid,
    action      text not null,
    details     jsonb,
    ip          text,
    at          timestamptz not null default now()
);
create index if not exists portal_log_account_idx on public.portal_log (account_id, at desc);
create index if not exists portal_log_ip_idx      on public.portal_log (ip, action, at desc);

-- 4. Запити: звідки прийшов + ціна для клієнта і його рішення
alter table public.requests
    add column if not exists source              text,          -- 'portal' — створив клієнт у кабінеті
    add column if not exists portal_account_id   uuid,
    add column if not exists client_price        numeric(12, 2),-- ціна Грандар для клієнта (бачить у кабінеті)
    add column if not exists client_currency     text,
    add column if not exists client_price_note   text,
    add column if not exists client_price_at     timestamptz,
    add column if not exists client_decision     text,          -- 'accepted' / 'discuss'
    add column if not exists client_decision_at  timestamptz,
    add column if not exists client_decision_note text;

-- 5. Ставки перевізників: відповідь з кабінету
alter table public.carrier_bids
    add column if not exists source       text,                -- 'portal' — перевізник відповів сам
    add column if not exists truck_plate  text,
    add column if not exists answered_at  timestamptz;

-- 6. Доступ
grant select on public.portal_accounts, public.portal_log to authenticated;
grant select, insert, update, delete on public.portal_accounts, public.portal_tokens, public.portal_log to service_role;
grant usage, select on sequence public.portal_log_id_seq to service_role;
revoke all on public.portal_tokens from anon, authenticated;

alter table public.portal_accounts enable row level security;
alter table public.portal_tokens   enable row level security;
alter table public.portal_log      enable row level security;

drop policy if exists "portal_accounts_staff_read" on public.portal_accounts;
create policy "portal_accounts_staff_read" on public.portal_accounts for select to authenticated
    using ((select public.is_active_staff()));
drop policy if exists "portal_log_staff_read" on public.portal_log;
create policy "portal_log_staff_read" on public.portal_log for select to authenticated
    using ((select public.is_active_staff()));
-- portal_tokens: політик немає навмисно — читає й пише тільки сервер

-- Перевірка: має показати 3 рядки
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('portal_accounts', 'portal_tokens', 'portal_log');
