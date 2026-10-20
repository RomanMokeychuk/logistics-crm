-- FURA: «Клієнти» — договір (з файлами) і банківські реквізити.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.

-- 1. Нові поля картки клієнта
alter table public.leads
    add column if not exists contract_no    text,                         -- № договору
    add column if not exists contract_date  date,                         -- дата договору
    add column if not exists contract_until date,                         -- діє до
    add column if not exists contract_files jsonb not null default '[]',  -- скани підписаного договору
    add column if not exists bank_iban      text,                         -- розрахунковий рахунок (IBAN)
    add column if not exists bank_name      text,                         -- банк
    add column if not exists bank_mfo       text,                         -- МФО
    add column if not exists vat_number     text,                         -- ІПН платника ПДВ
    add column if not exists director       text;                         -- керівник / підписант

-- 2. Сховище файлів договорів (закрите: бачать тільки активні співробітники)
insert into storage.buckets (id, name, public)
values ('client-docs', 'client-docs', false)
on conflict (id) do nothing;

drop policy if exists "client_docs_read"   on storage.objects;
drop policy if exists "client_docs_insert" on storage.objects;
drop policy if exists "client_docs_delete" on storage.objects;

create policy "client_docs_read" on storage.objects
    for select to authenticated
    using (bucket_id = 'client-docs' and exists (
        select 1 from public.staff s
         where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

create policy "client_docs_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'client-docs' and exists (
        select 1 from public.staff s
         where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

create policy "client_docs_delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'client-docs' and exists (
        select 1 from public.staff s
         where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

-- Перевірка: має показати 9 рядків
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'leads'
   and column_name in ('contract_no','contract_date','contract_until','contract_files',
                       'bank_iban','bank_name','bank_mfo','vat_number','director');
