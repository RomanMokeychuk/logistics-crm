-- FURA: переписка клієнта з Грандар у кабінеті (Sales / логіст відповідають із CRM).
-- Це ОКРЕМИЙ канал від внутрішнього чату по запиту (request_messages) — внутрішнє листування клієнт не бачить.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run (можна повторно).
-- Після цього ще раз виконайте portal_security.sql — він закриє і нову таблицю правилом «тільки співробітники».

create table if not exists public.portal_messages (
    id          uuid primary key default gen_random_uuid(),
    party       text not null default 'client' check (party in ('client', 'carrier')),
    lead_id     text,                 -- клієнт (leads.id як текст)
    carrier_id  text,                 -- перевізник (на майбутнє)
    request_id  uuid,                 -- повідомлення по запиту (необов'язково)
    deal_id     text,                 -- повідомлення по перевезенню (необов'язково)
    direction   text not null check (direction in ('in', 'out')),  -- in — від клієнта, out — від Грандар
    account_id  uuid,                 -- хто з клієнта написав (portal_accounts.id)
    staff_id    uuid,                 -- хто з Грандар відповів (staff.id)
    author      text,
    text        text not null check (length(btrim(text)) between 1 and 4000),
    created_at  timestamptz not null default now(),
    read_at     timestamptz           -- коли прочитала інша сторона
);
create index if not exists portal_messages_lead_idx    on public.portal_messages (lead_id, created_at);
create index if not exists portal_messages_deal_idx    on public.portal_messages (deal_id) where deal_id is not null;
create index if not exists portal_messages_request_idx on public.portal_messages (request_id) where request_id is not null;

grant select, insert, update on public.portal_messages to authenticated;
grant select, insert, update, delete on public.portal_messages to service_role;

alter table public.portal_messages enable row level security;
drop policy if exists "portal_messages_staff_read"   on public.portal_messages;
drop policy if exists "portal_messages_staff_write"  on public.portal_messages;
drop policy if exists "portal_messages_staff_update" on public.portal_messages;
create policy "portal_messages_staff_read" on public.portal_messages for select to authenticated
    using ((select public.is_active_staff()));
-- Співробітник пише тільки «від Грандар»
create policy "portal_messages_staff_write" on public.portal_messages for insert to authenticated
    with check ((select public.is_active_staff()) and direction = 'out');
-- Позначити повідомлення клієнта прочитаним
create policy "portal_messages_staff_update" on public.portal_messages for update to authenticated
    using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

-- Перевірка: має показати 1 рядок
select table_name from information_schema.tables where table_schema = 'public' and table_name = 'portal_messages';
