-- FURA: переписка по запиту (Sales ↔ логісти) — на сайті і в Telegram-боті.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.

-- 1. Повідомлення
create table if not exists public.request_messages (
    id          uuid primary key default gen_random_uuid(),
    request_id  uuid not null references public.requests(id) on delete cascade,
    author_id   uuid,
    author_name text,
    text        text not null check (length(btrim(text)) between 1 and 2000),
    via         text not null default 'site',          -- site / telegram
    created_at  timestamptz not null default now()
);

create index if not exists request_messages_request_idx
    on public.request_messages (request_id, created_at);

-- 2. Автор — завжди той, хто увійшов (підробити ім'я з сайту не можна).
--    Бот пише зі службовим ключем і вказує автора сам.
create or replace function public.set_request_message_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    s record;
begin
    if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
        return new;
    end if;
    select id, full_name into s
      from public.staff
     where lower(email) = lower(auth.jwt() ->> 'email') and active
     limit 1;
    if s.id is null then
        raise exception 'Вас немає серед співробітників FURA';
    end if;
    new.author_id   := s.id;
    new.author_name := s.full_name;
    new.via         := 'site';
    new.created_at  := now();
    return new;
end;
$$;

drop trigger if exists trg_request_message_author on public.request_messages;
create trigger trg_request_message_author
    before insert on public.request_messages
    for each row execute function public.set_request_message_author();

-- 3. Доступ: читати і писати — залогінені співробітники; змінювати/видаляти — ні
alter table public.request_messages enable row level security;

drop policy if exists "request_messages_select" on public.request_messages;
drop policy if exists "request_messages_insert" on public.request_messages;

create policy "request_messages_select"
    on public.request_messages for select to authenticated using (true);

create policy "request_messages_insert"
    on public.request_messages for insert to authenticated with check (true);

-- 4. Живе оновлення на сайті
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'request_messages'
    ) then
        alter publication supabase_realtime add table public.request_messages;
    end if;
end $$;

-- 5. Бот: нове повідомлення → Telegram учасникам запиту
--    (та сама функція notify_fura_bot, що вже працює для запитів — секрет не потрібен)
drop trigger if exists trg_notify_fura_bot_msg on public.request_messages;
create trigger trg_notify_fura_bot_msg
    after insert on public.request_messages
    for each row execute function public.notify_fura_bot();

-- 6. Пам'ять бота (на якому кроці людина) — якщо ще немає
create table if not exists public.bot_sessions (
    chat_id    bigint primary key,
    state      jsonb not null default '{}',
    updated_at timestamptz not null default now()
);
alter table public.bot_sessions enable row level security;

-- Перевірка: має показати 1 рядок «request_messages»
select tablename from pg_publication_tables
 where pubname = 'supabase_realtime' and tablename = 'request_messages';
