-- FURA: вкладка «Черга» — машини в черзі на кордоні з застосунку «Эчерга» (єЧерга + «Шлях» + carplates).
-- Дані приходять з Mac через Edge Function "fura-echerha" (bot/fura-echerha.ts) кожні ~30 хв.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.

-- Машини, що зараз у черзі (знімок; старі рядки видаляє сама функція після кожної відправки)
create table if not exists public.echerha_queue (
    id            bigserial primary key,
    sync_id       text not null,
    checkpoint    text not null,          -- «Ягодин – Дорогуськ (для вантажівок ≥ 7,5 тонн)»
    country       text,                   -- Польща / Румунія / … / Туреччина → Грузія
    qtype         text,                   -- з вантажем / порожні / …
    queue_no      text,
    entry_at      text,                   -- «2026-10-25 14:30» (орієнтовний в'їзд)
    reg_at        text,                   -- коли став у чергу
    tractor       text,
    trailer       text,
    ua            boolean default true,   -- тягач український
    carrier       text,                   -- назва з «Шляху» або «Іноземний (PL)» / «очікує перевірки»
    edrpou        text,
    boss          text,                   -- керівник
    trailer_model text,                   -- марка / опис причепа з carplates
    trailer_body  text,                   -- тент / реф / автовоз / …
    trailer_kind  text,
    note          text,                   -- статус (для стоянок Hopa)
    is_new        boolean default false,  -- новий перевізник у базі Эчерги
    updated_at    timestamptz default now()
);
create index if not exists echerha_queue_edrpou_idx on public.echerha_queue (edrpou);
create index if not exists echerha_queue_sync_idx   on public.echerha_queue (sync_id);

-- Пункти пропуску: скільки машин зараз і коли востаннє пройдено
create table if not exists public.echerha_checkpoints (
    name          text primary key,
    sync_id       text not null,
    country       text,
    qtype         text,
    in_queue      integer default 0,
    selected      boolean default false,  -- з галочкою в Эчерзі (оновлюються частіше)
    last_scraped  text
);

-- Коли Эчерга востаннє надсилала дані
create table if not exists public.echerha_sync (
    id         integer primary key default 1,
    synced_at  timestamptz,
    rows       integer,
    carriers   integer,
    started_at timestamptz,
    sync_id    text
);

-- Права (з 30.10.2026 Supabase не видає їх новим таблицям сам)
grant select on public.echerha_queue, public.echerha_checkpoints, public.echerha_sync to authenticated;
grant select, insert, update, delete on public.echerha_queue, public.echerha_checkpoints, public.echerha_sync to service_role;
grant usage, select on sequence public.echerha_queue_id_seq to service_role;

-- Читати можуть тільки активні співробітники; писати — тільки функція fura-echerha (service_role)
alter table public.echerha_queue       enable row level security;
alter table public.echerha_checkpoints enable row level security;
alter table public.echerha_sync        enable row level security;

drop policy if exists "echerha_queue_read" on public.echerha_queue;
create policy "echerha_queue_read" on public.echerha_queue for select to authenticated
    using (exists (select 1 from public.staff s where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

drop policy if exists "echerha_checkpoints_read" on public.echerha_checkpoints;
create policy "echerha_checkpoints_read" on public.echerha_checkpoints for select to authenticated
    using (exists (select 1 from public.staff s where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

drop policy if exists "echerha_sync_read" on public.echerha_sync;
create policy "echerha_sync_read" on public.echerha_sync for select to authenticated
    using (exists (select 1 from public.staff s where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

-- Перевірка: таблиці є (поки порожні — заповняться після першої відправки з Эчерги)
select (select count(*) from public.echerha_queue) as queue, (select count(*) from public.echerha_checkpoints) as checkpoints;
