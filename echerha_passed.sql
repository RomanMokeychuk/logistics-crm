-- FURA: «Проїхали кордон» — машини, які зникли з черги (виїхали з України).
-- Потрібно для підбору перевізників під запит: машина, що щойно виїхала в ЄС з вантажем,
-- через 1–3 дні розвантажиться і шукатиме зворотний вантаж; порожня — їде під завантаження.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run (можна повторно).
-- Функцію викликає fura-echerha наприкінці кожної відправки, ДО видалення старого знімка.

create table if not exists public.echerha_passed (
    id            bigserial primary key,
    tractor       text not null,
    trailer       text,
    checkpoint    text,
    country       text,
    qtype         text,
    carrier       text,
    edrpou        text,
    boss          text,
    trailer_body  text,
    trailer_model text,
    ua            boolean,
    entry_at      text,                     -- орієнтовний в'їзд з останнього знімка, де машина ще була
    passed_at     timestamptz not null default now()   -- коли помітили, що машини вже немає в черзі
);
create index if not exists echerha_passed_time_idx   on public.echerha_passed (passed_at desc);
create index if not exists echerha_passed_edrpou_idx on public.echerha_passed (edrpou);
create index if not exists echerha_passed_tractor_idx on public.echerha_passed (tractor, passed_at desc);
-- щоб порівняння двох знімків черги (~10 тис. машин) займало долі секунди
create index if not exists echerha_queue_sync_tractor_idx    on public.echerha_queue (sync_id, tractor);
create index if not exists echerha_queue_sync_checkpoint_idx on public.echerha_queue (sync_id, checkpoint);

create or replace function public.record_echerha_passed(p_sync text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    prev_rows integer;
    new_rows  integer;
    added     integer := 0;
begin
    select count(*) into new_rows from public.echerha_queue where sync_id = p_sync;
    select count(*) into prev_rows from public.echerha_queue where sync_id <> p_sync;

    -- Захист від збою: якщо новий знімок підозріло малий — нікого не вважаємо таким, що проїхав
    if prev_rows = 0 or new_rows < prev_rows * 0.5 then
        return jsonb_build_object('added', 0, 'skipped', true, 'prev', prev_rows, 'new', new_rows);
    end if;

    -- Пункти, які в новому знімку не оновлювались, не чіпаємо (машини там не «проїхали», просто немає даних)
    insert into public.echerha_passed
        (tractor, trailer, checkpoint, country, qtype, carrier, edrpou, boss, trailer_body, trailer_model, ua, entry_at)
    select distinct on (o.tractor)
           o.tractor, o.trailer, o.checkpoint, o.country, o.qtype, o.carrier, o.edrpou, o.boss,
           o.trailer_body, o.trailer_model, o.ua, o.entry_at
      from public.echerha_queue o
     where o.sync_id <> p_sync
       and coalesce(o.tractor, '') <> ''
       and exists (select 1 from public.echerha_queue n where n.sync_id = p_sync and n.checkpoint = o.checkpoint)
       and not exists (select 1 from public.echerha_queue n where n.sync_id = p_sync and n.tractor = o.tractor)
       -- не дублюємо, якщо ту саму машину вже записали за останні 12 годин
       and not exists (select 1 from public.echerha_passed p
                        where p.tractor = o.tractor and p.passed_at > now() - interval '12 hours')
     order by o.tractor, o.updated_at desc;
    get diagnostics added = row_count;

    -- Історію тримаємо 21 день
    delete from public.echerha_passed where passed_at < now() - interval '21 days';

    return jsonb_build_object('added', added, 'skipped', false);
end;
$$;

revoke all on function public.record_echerha_passed(text) from public, anon, authenticated;
grant execute on function public.record_echerha_passed(text) to service_role;

grant select on public.echerha_passed to authenticated;
grant select, insert, delete on public.echerha_passed to service_role;
grant usage, select on sequence public.echerha_passed_id_seq to service_role;

alter table public.echerha_passed enable row level security;
drop policy if exists "echerha_passed_read" on public.echerha_passed;
create policy "echerha_passed_read" on public.echerha_passed for select to authenticated
    using (exists (select 1 from public.staff s where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

-- Перевірка: таблиця є (спочатку 0 рядків — наповниться з наступної відправки Черги)
select count(*) as passed_rows from public.echerha_passed;
