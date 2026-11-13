-- FURA: кожен Sales бачить лише СВОЇХ лідів і клієнтів.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити весь файл → Run (можна повторно).
-- Потрібні функції з agent_bids.sql (is_active_staff) і rop.sql (rop_is_boss, rop_my_staff_id) — вони вже виконані.
--
-- Хто що бачить у Лідах і Клієнтах (обидві сторінки — таблиця public.leads):
--   • Керівник (роль head) і Адмін (admin) — усіх.
--   • Логіст (без ролі Sales) — усіх (йому потрібні клієнти для запитів і угод).
--   • Якщо в людини є роль Sales (навіть разом із «Логіст») — вона бачить лише своїх.
--   • Sales / менеджер — ЛИШЕ тих, де саме він вказаний як Sales (менеджер).
--     Інший Sales цих клієнтів не бачить. Передали клієнта колезі — він зникає зі списку того, хто передав.
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
declare me_id text; me_name text;
begin
    if not public.is_active_staff() then return false; end if;
    if not public.lead_is_restricted() then return true; end if;
    select s.id::text, lower(trim(s.full_name)) into me_id, me_name
      from public.staff s
     where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and s.active
     limit 1;
    if me_id is null then return false; end if;
    return p_sales_id = me_id;
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
