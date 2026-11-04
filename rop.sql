-- FURA: AI-агент «РОП» (керівник відділу продажів).
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run (можна запускати повторно).
-- Потрібна функція public.is_active_staff() з agent_bids.sql (вже виконаний).

-- 1. Хто керівник: роль «head» або «admin» (нова колонка roles або стара role)
create or replace function public.rop_is_boss()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.staff s
         where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
           and s.active
           and (
               -- roles може бути text[] або jsonb — порівнюємо як текст: {head,sales} / ["head","sales"]
               coalesce(s.roles::text, '') ~ '(^|[^a-z_])(head|admin)([^a-z_]|$)'
               or s.role in ('head', 'admin')
           )
    );
$$;

-- id поточного співробітника (для «моїх» задач)
create or replace function public.rop_my_staff_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select s.id::text from public.staff s
     where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       and s.active
     limit 1;
$$;

-- 2. Налаштування (один рядок). Пороги можна міняти на сторінці «РОП».
create table if not exists public.rop_settings (
    id          smallint primary key default 1 check (id = 1),
    settings    jsonb not null default '{}'::jsonb,
    updated_by  text,
    updated_at  timestamptz not null default now()
);

insert into public.rop_settings (id, settings) values (1, jsonb_build_object(
    'logist_reply_hours',   6,    -- логіст має відповісти на запит
    'sales_react_hours',    2,    -- Sales реагує на ставку логіста (статус «Відповідь»)
    'negotiation_days',     14,   -- лід на етапі «Переговори» не довше
    'new_lead_days',        7,    -- «Новий» / «Контакт» без жодного запису в історії
    'client_silent_days',   20,   -- клієнт «Працюємо» без запитів
    'payment_days',         14,   -- оплата клієнта після розвантаження
    'min_profit_usd',       50,   -- угода з профітом нижче — у ризики
    'draft_wait_hours',     24,   -- лист AI-продажів чекає схвалення
    'daily_hour',           8,    -- о котрій годині (Київ) готувати ранковий звіт
    'daily_minute',         30,
    'weekly_day',           1     -- 1 = понеділок: тижневий звіт
)) on conflict (id) do nothing;

-- 3. Звіти агента (ранковий, тижневий, «Оновити зараз»)
create table if not exists public.rop_reports (
    id          uuid primary key default gen_random_uuid(),
    kind        text not null check (kind in ('daily', 'weekly', 'manual')),
    report_date date not null,                              -- дата за Києвом
    metrics     jsonb not null default '{}'::jsonb,         -- усі цифри — порахував код
    summary     jsonb not null default '{}'::jsonb,         -- висновки Claude: головне, ризики, по менеджерах
    ai_ok       boolean not null default false,             -- чи відповів Claude (без нього — лише цифри)
    created_by  text,                                       -- «розклад» або ім'я співробітника
    created_at  timestamptz not null default now()
);
create index if not exists rop_reports_date_idx on public.rop_reports (report_date desc, created_at desc);

-- 4. Задачі від РОПа менеджерам і логістам
create table if not exists public.rop_tasks (
    id            uuid primary key default gen_random_uuid(),
    report_id     uuid references public.rop_reports(id) on delete set null,
    assignee_id   text,                                     -- staff.id (текстом, як leads.sales_id)
    assignee_name text,
    kind          text not null,                            -- logist_reply / sales_react / lead_overdue / lead_stale /
                                                            -- negotiation_long / client_silent / payment_late /
                                                            -- low_profit / deal_late / draft_wait / reply_waiting / assign_lead
    entity_type   text,                                     -- request / lead / deal / prospect
    entity_id     text,
    entity_label  text,                                     -- клієнт, № угоди…
    fingerprint   text not null,                            -- kind:entity — щоб не дублювати одну й ту саму задачу
    title         text not null,
    details       text,
    priority      smallint not null default 2 check (priority between 1 and 3),  -- 1 = терміново
    suggestion    jsonb,                                    -- для assign_lead: кому віддати лід
    link          text,                                     -- сторінка CRM: requests.html?open=…
    status        text not null default 'open' check (status in ('open', 'done', 'dismissed')),
    closed_by     text,
    closed_at     timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
alter table public.rop_tasks add column if not exists link text;  -- якщо таблицю створили раніше без неї

create unique index if not exists rop_tasks_open_fp_idx on public.rop_tasks (fingerprint) where status = 'open';
create index if not exists rop_tasks_assignee_idx on public.rop_tasks (assignee_id, status);
create index if not exists rop_tasks_status_idx   on public.rop_tasks (status, priority, created_at);

-- 5. Доступ.
--    Звіти й налаштування бачать лише керівник і адмін.
--    Задачу бачить той, кому її поставили, і керівник.
--    Змінювати все — тільки сервер (функція fura-rop).
alter table public.rop_settings enable row level security;
alter table public.rop_reports  enable row level security;
alter table public.rop_tasks    enable row level security;

drop policy if exists "rop_settings_select" on public.rop_settings;
create policy "rop_settings_select" on public.rop_settings
    for select to authenticated using (public.rop_is_boss());

drop policy if exists "rop_reports_select" on public.rop_reports;
create policy "rop_reports_select" on public.rop_reports
    for select to authenticated using (public.rop_is_boss());

drop policy if exists "rop_tasks_select" on public.rop_tasks;
create policy "rop_tasks_select" on public.rop_tasks
    for select to authenticated using (
        public.rop_is_boss()
        or (public.is_active_staff() and assignee_id = public.rop_my_staff_id())
    );

-- 6. Живе оновлення сторінки «РОП» і плитки задач на головній
do $$
declare t text;
begin
    foreach t in array array['rop_reports', 'rop_tasks'] loop
        if not exists (
            select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
        end if;
    end loop;
end $$;

-- 7. Розклад: кожні 15 хв з 04:00 до 09:59 UTC.
--    Функція сама дивиться на час у Києві й готує звіт один раз на день (о 08:30, з налаштувань),
--    тому літній / зимовий час нічого не ламає.
--    Потрібні pg_cron і pg_net (вже увімкнені для fura-sales).
--    Замініть <ROP_CRON_SECRET> на той самий рядок, що в секреті функції.
--
-- select cron.schedule(
--     'fura-rop-tick',
--     '*/15 4-9 * * *',
--     $$ select net.http_post(
--            url     := 'https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-rop',
--            headers := jsonb_build_object(
--                'content-type', 'application/json',
--                'x-rop-secret', '<ROP_CRON_SECRET>'),
--            body    := '{"action":"tick"}'::jsonb) $$
-- );

-- Перевірка: має показати 3 таблиці
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('rop_settings', 'rop_reports', 'rop_tasks')
 order by 1;
