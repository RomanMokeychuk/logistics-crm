-- =====================================================================
-- FURA · Угоди як у BAF (Документы Сделки) + файли + обмін з BAF
-- Supabase → SQL Editor → New query → вставити весь файл → Run (можна повторно)
-- =====================================================================

-- 1. Поля угоди, як у BAF «Общая информация»
alter table public.deals
    add column if not exists transit         boolean not null default false, -- Транзит
    add column if not exists assistant_id    text,                            -- Помічник (staff.id)
    add column if not exists assistant_name  text,
    add column if not exists opmanager_id    text,                            -- Оперативний менеджер
    add column if not exists opmanager_name  text,
    add column if not exists work_date       date,                            -- Дата виконання робіт
    add column if not exists cargo_code      text,                            -- Код вантажу (УКТЗЕД)
    add column if not exists route_km        int,                             -- км
    add column if not exists trucks_qty      int not null default 1,          -- Кількість авто
    add column if not exists shipper         text,                            -- Вантажовідправник
    add column if not exists consignee       text,                            -- Вантажоодержувач
    add column if not exists customs_date    date,                            -- Дата митного оформлення
    add column if not exists client_supply   date,                            -- Подача клієнту
    add column if not exists pay_form        text,                            -- Форма розрахунку
    add column if not exists carrier_contract text,                           -- Договір з перевізником (№ і дата)
    add column if not exists has_docs        boolean not null default false,  -- Є документи
    add column if not exists docs_date       date,
    add column if not exists files           jsonb not null default '[]',     -- файли угоди [{path,name,kind,size,uploaded_at,by}]
    -- обмін з BAF
    add column if not exists baf_state       text not null default 'none',    -- none / queued / sent / error
    add column if not exists baf_number      text,                            -- № угоди в BAF (00002202)
    add column if not exists baf_id          text,                            -- внутрішній ідентифікатор BAF (GUID)
    add column if not exists baf_status      text,                            -- статус у BAF (Выполняется …)
    add column if not exists baf_error       text,
    add column if not exists baf_queued_at   timestamptz,
    add column if not exists baf_synced_at   timestamptz,
    add column if not exists baf_invoices    jsonb not null default '[]',     -- рахунки з BAF (для показу)
    add column if not exists profit_fact_usd numeric;                         -- фактичний прибуток з BAF

create index if not exists deals_baf_state on public.deals (baf_state) where baf_state in ('queued', 'error');

-- 2. Договір з перевізником — у картці перевізника (як у BAF: Контрагент → Договора → Файли)
alter table public.carriers
    add column if not exists contract_no    text,
    add column if not exists contract_date  date,
    add column if not exists contract_files jsonb not null default '[]';

-- 3. Закрите сховище файлів угод: бачать лише активні співробітники
insert into storage.buckets (id, name, public, file_size_limit)
values ('deal-files', 'deal-files', false, 26214400)   -- до 25 МБ на файл
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "deal_files_read"   on storage.objects;
drop policy if exists "deal_files_insert" on storage.objects;
drop policy if exists "deal_files_delete" on storage.objects;

create policy "deal_files_read" on storage.objects
    for select to authenticated
    using (bucket_id = 'deal-files' and exists (
        select 1 from public.staff s
         where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

create policy "deal_files_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'deal-files' and exists (
        select 1 from public.staff s
         where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

create policy "deal_files_delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'deal-files' and exists (
        select 1 from public.staff s
         where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

-- Перевірка: має показати 3 рядки (files, baf_state, contract_files) і «deal-files»
select table_name || '.' || column_name from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'deals' and column_name in ('files', 'baf_state'))
     or (table_name = 'carriers' and column_name = 'contract_files'))
union all
select 'bucket ' || id from storage.buckets where id = 'deal-files';
