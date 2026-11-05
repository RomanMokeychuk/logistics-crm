-- FURA: картинки й файли в переписці по запиту (Sales ↔ логіст).
-- Виконати один раз: Supabase → SQL Editor → New query → вставити весь файл → Run (можна повторно).

-- 1. До повідомлення можна прикріпити файли: [{ path, name, type, size }]
alter table public.request_messages
    add column if not exists files jsonb not null default '[]'::jsonb;

-- 2. Закрите сховище: бачать і завантажують лише активні співробітники
insert into storage.buckets (id, name, public, file_size_limit)
values ('request-files', 'request-files', false, 15728640)   -- до 15 МБ на файл
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "request_files_read"   on storage.objects;
drop policy if exists "request_files_insert" on storage.objects;

create policy "request_files_read" on storage.objects
    for select to authenticated
    using (bucket_id = 'request-files' and exists (
        select 1 from public.staff s
         where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

create policy "request_files_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'request-files' and exists (
        select 1 from public.staff s
         where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

-- Перевірка: має показати «files» і «request-files»
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'request_messages' and column_name = 'files'
union all
select id from storage.buckets where id = 'request-files';
