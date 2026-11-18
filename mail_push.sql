-- FURA · Сповіщення про нові листи на телефон і комп'ютер (навіть коли FURA закрита).
-- Supabase → SQL Editor → New query → вставити ВЕСЬ файл → Run. Нічого міняти не треба.
-- Унизу має бути рядок fura-mail-push.

-- Пристрої, куди слати сповіщення (кожен браузер / телефон окремо)
create table if not exists public.push_subs (
    id bigserial primary key,
    staff_id uuid not null,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    device text default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists push_subs_staff on public.push_subs (staff_id);

-- Останній лист, про який уже сповістили (щоб не повторювати)
create table if not exists public.mail_push_state (
    staff_id uuid primary key,
    box text,
    last_uid bigint default 0,
    updated_at timestamptz default now()
);

-- Ключі для сповіщень (створюються функцією самі)
create table if not exists public.push_config (
    id int primary key,
    public_key text not null,
    private_d text not null
);

-- Пароль для розкладу: створюється тут сам, розклад бере його з бази
create table if not exists public.push_cron (id int primary key, token text not null);
insert into public.push_cron (id, token) values (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
    on conflict (id) do nothing;
alter table public.push_cron enable row level security;
revoke all on public.push_cron from anon, authenticated;

-- Доступ лише в сервера (функція fura-sales): з сайту напряму ці таблиці не читаються
alter table public.push_subs enable row level security;
alter table public.mail_push_state enable row level security;
alter table public.push_config enable row level security;
revoke all on public.push_subs, public.mail_push_state, public.push_config from anon, authenticated;

-- Перевірка нових листів щохвилини
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobname) from cron.job where jobname = 'fura-mail-push';
select cron.schedule(
    'fura-mail-push',
    '* * * * *',
    $$ select net.http_post(
           url := 'https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-sales',
           headers := jsonb_build_object('content-type', 'application/json', 'x-push-token', (select token from public.push_cron where id = 1)),
           body := '{"action":"mail_push"}'::jsonb,
           timeout_milliseconds := 55000
       ) $$
);

select jobname, schedule, active from cron.job where jobname = 'fura-mail-push';
