-- FURA: доступ до «Лідів» і «Клієнтів».
-- Виконати один раз: Supabase → SQL Editor → New query → вставити весь файл → Run (можна повторно).
-- Потрібні функції з agent_bids.sql (is_active_staff) і rop.sql (rop_is_boss, rop_my_staff_id) — вони вже виконані.
--
-- Хто що бачить у Лідах і Клієнтах (обидві сторінки — таблиця public.leads):
--   • Керівник (head) і Адмін (admin) — усіх.
--   • Sales / менеджер (навіть якщо ще й логіст) — ЛИШЕ тих, де саме він вказаний як Sales.
--   • Логіст без ролі Sales — НІКОГО (лідів і клієнтів не бачить; запити й угоди бачить як раніше —
--     назва клієнта зберігається в самому запиті/угоді).
--   • Ліди без Sales бачить лише керівник/адмін, поки не призначить Sales.
-- Обмеження працює в самій базі: чужих клієнтів не видно ні в таблиці, ні в пошуку, ні у звітах, ні в Помічнику.

-- 1. Чи поточний користувач — Sales без ролей head / admin (роль «Логіст» не розширює доступ)
create or replace function public.lead_is_restricted()
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
           and (coalesce(s.roles::text, '') ~ '(^|[^a-z_])sales([^a-z_]|$)' or s.role = 'sales')
           and not (coalesce(s.roles::text, '') ~ '(^|[^a-z_])(head|admin)([^a-z_]|$)')
           and coalesce(s.role, '') not in ('head', 'admin')
    );
$$;

-- 2. Чи можна бачити цей лід / клієнта
create or replace function public.lead_visible(p_sales_id text, p_created_by text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare me_id text; me_roles text; me_role text;
begin
    select s.id::text, coalesce(s.roles::text, ''), coalesce(s.role, '')
      into me_id, me_roles, me_role
      from public.staff s
     where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and s.active
     limit 1;
    if me_id is null then return false; end if;
    -- керівник / адмін — усіх
    if me_roles ~ '(^|[^a-z_])(head|admin)([^a-z_]|$)' or me_role in ('head', 'admin') then return true; end if;
    -- Sales — лише своїх
    if me_roles ~ '(^|[^a-z_])sales([^a-z_]|$)' or me_role = 'sales' then return coalesce(p_sales_id = me_id, false); end if;
    -- логіст та інші — нікого
    return false;
end;
$$;

-- 3. Правила доступу до таблиці leads (старі правила замінюємо)
alter table public.leads enable row level security;
do $$
declare p record;
begin
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'leads' loop
        execute format('drop policy %I on public.leads', p.policyname);
    end loop;
end $$;

create policy "leads_select" on public.leads for select to authenticated
    using (public.lead_visible(sales_id::text, created_by));
create policy "leads_insert" on public.leads for insert to authenticated
    with check (public.is_active_staff());
create policy "leads_update" on public.leads for update to authenticated
    using (public.lead_visible(sales_id::text, created_by))
    with check (public.is_active_staff());
create policy "leads_delete" on public.leads for delete to authenticated
    using (public.lead_visible(sales_id::text, created_by));

-- 4. Перевірка дублів: Sales не бачить чужих клієнтів, але має знати, що такий клієнт уже є
--    (і за ким закріплений), щоб не створити копію. Повертає лише назву й Sales.
create or replace function public.lead_find_duplicate(p_edrpou text, p_name text, p_exclude text default null)
returns table (id text, name text, sales text, visible boolean)
language sql
stable
security definer
set search_path = ''
as $$
    select l.id::text, l.name, l.sales, public.lead_visible(l.sales_id::text, l.created_by)
      from public.leads l
     where public.is_active_staff()
       and (p_exclude is null or l.id::text <> p_exclude)
       and (
            (nullif(trim(p_edrpou), '') is not null and regexp_replace(coalesce(l.edrpou, ''), '\D', '', 'g') = regexp_replace(p_edrpou, '\D', '', 'g'))
         or (nullif(trim(p_name), '') is not null and lower(trim(l.name)) = lower(trim(p_name)))
       )
     limit 1;
$$;
grant execute on function public.lead_find_duplicate(text, text, text) to authenticated;

-- Перевірка (під своїм логіном у FURA видно лише своїх):
-- select policyname, cmd from pg_policies where tablename = 'leads';

-- ================================================================== --
-- 5. СПИСОК УСІХ лідів/клієнтів для Sales — без контактів чужих клієнтів
--    Sales бачить усіх у списку (назва, ЄДРПОУ, місто, напрямки, вантаж, етап, хто веде),
--    але телефони, пошта, контактні особи, реквізити, договори, нотатки й історія
--    видно ЛИШЕ в своїх клієнтів (у чужих — порожньо). Редагувати чужих не можна (правила вище).
--    Логіст без ролі Sales список не бачить зовсім.
--    Якщо в таблицю leads додали нову колонку — запустіть цей файл ще раз.
-- ================================================================== --
create or replace function public.lead_can_list()
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
           and (coalesce(s.roles::text, '') ~ '(^|[^a-z_])(head|admin|sales)([^a-z_]|$)' or s.role in ('head', 'admin', 'sales'))
    );
$$;

do $$
declare
    -- ці поля видно в усіх клієнтів; РЕШТА (контакти, реквізити, договори, нотатки…) — лише у своїх
    open_cols text[] := array['id', 'name', 'full_name', 'edrpou', 'status', 'sales', 'sales_id', 'logist_id',
        'city', 'country', 'region_ukr', 'directions', 'destinations', 'trade_types', 'cargo', 'trailer_type',
        'routes', 'source', 'created_at', 'created_by', 'updated_at', 'rating'];
    cols text;
begin
    select string_agg(
             case when a.attname = any(open_cols) then format('l.%I', a.attname)
                  else format('case when v.mine then l.%I else %s end as %I', a.attname,
                       case when format_type(a.atttypid, a.atttypmod) = 'jsonb' then '''[]''::jsonb'
                            else 'null::' || format_type(a.atttypid, a.atttypmod) end,
                       a.attname)
             end, ', ' order by a.attnum)
      into cols
      from pg_attribute a
     where a.attrelid = 'public.leads'::regclass and a.attnum > 0 and not a.attisdropped;
    execute 'drop view if exists public.leads_dir';
    execute format(
        'create view public.leads_dir with (security_invoker = false) as
           select %s, v.mine as _mine
             from public.leads l
             cross join lateral (select public.lead_visible(l.sales_id::text, l.created_by) as mine) v
            where public.lead_can_list()', cols);
end $$;

revoke all on public.leads_dir from anon;
grant select on public.leads_dir to authenticated;

-- Перевірка: select name, sales, phone, _mine from public.leads_dir limit 10;
