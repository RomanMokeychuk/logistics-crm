-- FURA · Перевізники в Telegram-боті: одне спільне посилання + автоматична розсилка запитів.
-- Supabase → SQL Editor → вставити весь файл → Run. Нічого міняти не треба.

-- Хто перейшов за спільним посиланням, але його номера немає в базі перевізників (логіст прив'яже вручну)
create table if not exists public.carrier_tg_pending (
    chat_id    bigint primary key,
    phone      text,
    name       text,
    username   text,
    created_at timestamptz not null default now()
);

-- Повідомлення, які бот розіслав перевізникам з Блокнота (щоб відповідь прийшла саме тому логісту)
create table if not exists public.bot_outbox (
    id          bigserial primary key,
    carrier_id  text not null,
    staff_id    uuid,
    my_request_id uuid,
    text        text not null,
    tg_message_id bigint,
    sent_at     timestamptz not null default now()
);
create index if not exists bot_outbox_carrier on public.bot_outbox (carrier_id, sent_at desc);

-- Пошук перевізника за номером телефону (номери в базі записані по-різному: +38 (067) 324-25-10, 0673242510…)
create or replace function public.carriers_by_phone(d9 text)
returns table (id text, name text) language sql stable as $$
    select c.id::text, c.name from public.carriers c
    where length(d9) >= 9
      and (regexp_replace(coalesce(c.phone_1, ''), '\D', '', 'g') like '%' || d9 || '%'
        or regexp_replace(coalesce(c.phone_2, ''), '\D', '', 'g') like '%' || d9 || '%')
    limit 20
$$;
revoke all on function public.carriers_by_phone(text) from anon, authenticated;

alter table public.carrier_tg_pending enable row level security;
alter table public.bot_outbox enable row level security;
revoke all on public.carrier_tg_pending, public.bot_outbox from anon, authenticated;

select 'carrier_bot готово' as status;
