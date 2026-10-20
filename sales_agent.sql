-- FURA: AI-продажі — агенти, що знаходять контакти клієнтів і готують перші листи.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run (можна запускати повторно).
-- Потрібна функція public.is_active_staff() — вона створюється в agent_bids.sql.

-- 1. Пул потенційних клієнтів (з митної бази або вручну)
create table if not exists public.sales_prospects (
    id            uuid primary key default gen_random_uuid(),
    edrpou        text not null,
    name          text not null,
    trade_type    text check (trade_type in ('Експорт', 'Імпорт', 'По Україні')),
    period        text,                                  -- напр. «2026-08» — місяць митної бази
    score         numeric(4,1),
    segment       text,                                  -- food/реф, збірні, Кавказ…
    facts         jsonb not null default '{}'::jsonb,    -- машин/міс, напрямки, вантаж, Incoterms, пункт пропуску…
    hook          text,                                  -- зачіпка для першого контакту (якщо є)
    stage         text not null default 'new'
                  check (stage in ('new', 'enriching', 'enriched', 'no_contacts', 'drafted',
                                   'contacted', 'replied', 'won', 'lost', 'skip')),
    website       text,
    domain        text,
    director      text,
    enrich_log    jsonb not null default '[]'::jsonb,    -- що агент шукав і де (для перевірки)
    enriched_at   timestamptz,
    lead_id       text,                                  -- id картки в «Ліди», коли клієнт перейшов у роботу
    owner_id      uuid,                                  -- Sales, якому належить клієнт (staff.id)
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create unique index if not exists sales_prospects_edrpou_idx on public.sales_prospects (edrpou);
create index if not exists sales_prospects_stage_idx on public.sales_prospects (stage, score desc);

-- 2. Знайдені контакти (кожен — з джерелом, щоб Sales бачив, звідки він)
create table if not exists public.sales_contacts (
    id            uuid primary key default gen_random_uuid(),
    prospect_id   uuid not null references public.sales_prospects(id) on delete cascade,
    kind          text not null check (kind in ('email', 'phone', 'person', 'website', 'linkedin')),
    value         text not null,
    person_name   text,
    position      text,
    source        text not null,                         -- registry / website / web_search / snov / apollo / rocketreach / manual
    source_url    text,
    confidence    smallint not null default 50 check (confidence between 0 and 100),
    verified      boolean,                               -- e-mail: домен має MX-запис
    is_primary    boolean not null default false,        -- кому пишемо
    created_at    timestamptz not null default now()
);
-- e-mail агент зберігає в нижньому регістрі, тому достатньо звичайного унікального ключа
create unique index if not exists sales_contacts_uniq_idx on public.sales_contacts (prospect_id, kind, value);
create index if not exists sales_contacts_value_idx on public.sales_contacts (lower(value));

-- 3. Листи (чернетки → схвалення → надіслано; відповіді клієнтів)
create table if not exists public.sales_messages (
    id            uuid primary key default gen_random_uuid(),
    prospect_id   uuid not null references public.sales_prospects(id) on delete cascade,
    contact_id    uuid references public.sales_contacts(id) on delete set null,
    direction     text not null check (direction in ('out', 'in')),
    step          smallint not null default 1,           -- 1 = перший лист, 2/3 = нагадування
    status        text not null default 'draft'
                  check (status in ('draft', 'scheduled', 'sent', 'rejected', 'failed', 'received', 'cancelled')),
    to_email      text,
    subject       text,
    body          text not null check (length(btrim(body)) between 1 and 8000),
    classification text,                                  -- для відповідей: interest / quote / later / refusal / unsubscribe / auto / other
    summary       text,                                   -- коротко для Sales
    provider_id   text,                                   -- id листа в поштовому сервісі
    error         text,
    created_by    uuid,
    approved_by   uuid,
    due_at        timestamptz,                            -- коли надсилати нагадування
    created_at    timestamptz not null default now(),
    sent_at       timestamptz
);
create index if not exists sales_messages_status_idx on public.sales_messages (status, due_at);
create index if not exists sales_messages_prospect_idx on public.sales_messages (prospect_id, created_at);

-- 4. Стоп-лист: відписалися або просили не писати — агент їм більше НІКОЛИ не пише
create table if not exists public.sales_suppression (
    email         text primary key,
    reason        text,
    created_at    timestamptz not null default now()
);

-- 5. Доступ: читати — активні співробітники. Змінювати — тільки сервер (функція fura-sales).
alter table public.sales_prospects   enable row level security;
alter table public.sales_contacts    enable row level security;
alter table public.sales_messages    enable row level security;
alter table public.sales_suppression enable row level security;

drop policy if exists "sales_prospects_select" on public.sales_prospects;
create policy "sales_prospects_select" on public.sales_prospects
    for select to authenticated using (public.is_active_staff());
drop policy if exists "sales_contacts_select" on public.sales_contacts;
create policy "sales_contacts_select" on public.sales_contacts
    for select to authenticated using (public.is_active_staff());
drop policy if exists "sales_messages_select" on public.sales_messages;
create policy "sales_messages_select" on public.sales_messages
    for select to authenticated using (public.is_active_staff());
drop policy if exists "sales_suppression_select" on public.sales_suppression;
create policy "sales_suppression_select" on public.sales_suppression
    for select to authenticated using (public.is_active_staff());

-- 6. Живе оновлення на сторінці «AI-продажі»
do $$
declare t text;
begin
    foreach t in array array['sales_prospects', 'sales_messages'] loop
        if not exists (
            select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
        end if;
    end loop;
end $$;

-- 7. Розклад: кожні 10 хвилин агент шукає контакти й готує нагадування.
--    Потрібні розширення pg_cron і pg_net (Database → Extensions → увімкнути обидва).
--    Замініть <SALES_CRON_SECRET> перед запуском цього блоку.
--    Службовий ключ (service_role) сюди НЕ потрібен: функція перевіряє розклад сама за секретом.
--
-- select cron.schedule(
--     'fura-sales-tick',
--     '*/10 * * * *',
--     $$ select net.http_post(
--            url     := 'https://prbfscwmemshwigiftha.supabase.co/functions/v1/fura-sales',
--            headers := jsonb_build_object(
--                'content-type', 'application/json',
--                'x-sales-secret', '<SALES_CRON_SECRET>'),
--            body    := '{"action":"tick"}'::jsonb) $$
-- );

-- Перевірка: має показати 4 таблиці
select table_name from information_schema.tables
 where table_schema = 'public' and table_name like 'sales\_%' order by 1;
