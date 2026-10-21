-- FURA: відгуки після дзвінків перевізникам + «сховати з підбору».
-- Виконати один раз: Supabase → SQL Editor → New query → вставити все → Run.

-- 1) «Сховати з підбору» (з причиною; на час або назавжди)
alter table public.carriers add column if not exists match_hidden_reason text;        -- чому сховали
alter table public.carriers add column if not exists match_hidden_until  date;        -- до якої дати (порожньо = назавжди)
alter table public.carriers add column if not exists match_hidden_at     timestamptz; -- коли сховали

-- 2) Відгуки після дзвінків: хто дзвонив, що відповів перевізник
create table if not exists public.carrier_feedback (
    id           bigserial primary key,
    carrier_id   text not null,          -- carriers.id
    edrpou       text,
    outcome      text not null,          -- «Є машина», «Немає такого причепу», «Не відповів» …
    comment      text,
    author_email text,
    author_name  text,
    created_at   timestamptz not null default now()
);
create index if not exists carrier_feedback_carrier_idx on public.carrier_feedback (carrier_id, created_at desc);

-- 3) Доступ: читати й додавати — активні співробітники; видаляти — лише автор
alter table public.carrier_feedback enable row level security;
drop policy if exists "carrier_feedback_read" on public.carrier_feedback;
create policy "carrier_feedback_read" on public.carrier_feedback for select to authenticated
    using (exists (select 1 from public.staff s where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));
drop policy if exists "carrier_feedback_insert" on public.carrier_feedback;
create policy "carrier_feedback_insert" on public.carrier_feedback for insert to authenticated
    with check (exists (select 1 from public.staff s where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));
drop policy if exists "carrier_feedback_delete" on public.carrier_feedback;
create policy "carrier_feedback_delete" on public.carrier_feedback for delete to authenticated
    using (lower(author_email) = lower(auth.jwt() ->> 'email'));

-- Перевірка
select count(*) as feedback_rows from public.carrier_feedback;
