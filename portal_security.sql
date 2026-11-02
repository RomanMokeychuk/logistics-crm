-- FURA: етап 1 брифу «Кабінети» — дані CRM бачать ТІЛЬКИ активні співробітники.
--
-- Зараз частина таблиць (напр., requests) відкрита для будь-кого, хто має акаунт Supabase:
-- політики using (true). Цей файл додає до КОЖНОЇ таблиці в public «обмежувальну» політику
-- (restrictive): що б не дозволяли старі політики, рядок видно лише, якщо людина є в «Співробітниках»
-- і активна. Для співробітників нічого не змінюється.
--
-- КРОК A (необов'язково, лише подивитися): виконайте тільки цей запит — список таблиць і чи увімкнено RLS.
--   select c.relname as table_name, c.relrowsecurity as rls_on
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1;
--
-- КРОК B: виконайте весь файл (Run). Можна запускати повторно — після створення нових таблиць теж.

-- Функція вже є (agent_bids.sql / carrier_bids.sql) — тут на випадок, якщо ні
create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.staff
         where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
           and active
    );
$$;

do $$
declare
    t record;
begin
    -- Таблиці з увімкненим RLS: + обмежувальна політика «тільки співробітники»
    for t in
        select c.relname
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
    loop
        execute format('drop policy if exists fura_staff_only on public.%I', t.relname);
        execute format(
            'create policy fura_staff_only on public.%I as restrictive for all to authenticated '
            'using ((select public.is_active_staff())) with check ((select public.is_active_staff()))',
            t.relname);
    end loop;

    -- Представлення (views): виконуються з правами того, хто читає, — тоді правило вище діє і через них
    for t in
        select c.relname
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'v'
    loop
        execute format('alter view public.%I set (security_invoker = true)', t.relname);
    end loop;
end $$;

-- Перевірка 1: таблиці БЕЗ RLS (їх бачить будь-хто з акаунтом). Має бути 0 рядків.
-- Якщо щось є — надішліть список, увімкнемо RLS з правильними правилами.
select c.relname as table_without_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
 order by 1;

-- Перевірка 2: скільки таблиць тепер під захистом
select count(*) as protected_tables from pg_policies
 where schemaname = 'public' and policyname = 'fura_staff_only';
