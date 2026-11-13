-- FURA: перевірка — скільки лідів/клієнтів бачить кожен співробітник.
-- Supabase → SQL Editor → New query → вставити → Run. Нічого не змінює.
-- Якщо буде помилка «function public.lead_visible does not exist» — спершу виконайте leads_access.sql.

create or replace function pg_temp.fura_sees(p_email text)
returns bigint
language plpgsql
as $$
declare n bigint;
begin
    perform set_config('request.jwt.claims', json_build_object('email', p_email)::text, true);
    select count(*) into n from public.leads l where public.lead_visible(l.sales_id::text, l.created_by);
    return n;
end;
$$;

select s.full_name                                  as "Співробітник",
       coalesce(nullif(s.roles::text, '{}'), s.role) as "Ролі",
       pg_temp.fura_sees(s.email)                   as "Бачить лідів/клієнтів",
       (select count(*) from public.leads)          as "Усього в базі"
  from public.staff s
 where s.active
 order by 3 desc, 1;
