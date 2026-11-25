-- FURA · Хто скільки додає / редагує / пробиває перевізників.
-- Записує сама база (тригер), з будь-якої сторінки. Бачать лише керівник і адмін (head / admin).
-- Supabase → SQL Editor → New query → вставити весь файл → Run (можна повторно).
-- Спершу має бути виконаний carriers_checked.sql.

-- 1. Хто керівник (head / admin)
create or replace function public.fura_is_boss()
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.staff s
         where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
           and s.active
           and (coalesce(s.roles::text, '') ~ '(^|[^a-z_])(head|admin)([^a-z_]|$)' or s.role in ('head', 'admin'))
    );
$$;

-- 2. Журнал дій
create table if not exists public.carrier_activity (
    id bigserial primary key,
    carrier_id text,
    carrier_name text,
    edrpou text,
    action text not null,            -- add / edit / lardi
    by_email text,
    by_name text,
    at timestamptz not null default now()
);
create index if not exists carrier_activity_at on public.carrier_activity (at desc);
create index if not exists carrier_activity_who on public.carrier_activity (by_email, at desc);

alter table public.carrier_activity enable row level security;
revoke all on public.carrier_activity from anon, authenticated;
grant select on public.carrier_activity to authenticated;
drop policy if exists carrier_activity_boss on public.carrier_activity;
create policy carrier_activity_boss on public.carrier_activity for select to authenticated using (public.fura_is_boss());

-- 3. Тригер: дія людини на сайті (не автоматичний обхід Lardi / синхронізація) → рядок у журналі
create or replace function public.carrier_activity_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    em text := lower(coalesce(auth.jwt() ->> 'email', ''));
    nm text;
    act text;
    skip constant text[] := array['updated_at', 'checked_at', 'checked_by', 'checked_how', 'lardi_checked_at', 'lardi_found', 'notes_updated_at'];
    o jsonb; n jsonb; k text;
begin
    if em = '' then return new; end if;  -- сервер / розклад — не людина
    if tg_op = 'INSERT' then
        act := 'add';
    else
        o := to_jsonb(old); n := to_jsonb(new);
        foreach k in array skip loop o := o - k; n := n - k; end loop;
        if o is distinct from n then act := 'edit';
        elsif new.checked_how = 'lardi' and new.checked_at is distinct from old.checked_at then act := 'lardi';
        else return new;
        end if;
    end if;
    -- та сама людина, той самий перевізник, та сама дія за 3 хв — не дублюємо
    if exists (select 1 from public.carrier_activity a
                where a.carrier_id = new.id::text and a.by_email = em and a.action = act and a.at > now() - interval '3 minutes') then
        return new;
    end if;
    select s.full_name into nm from public.staff s where lower(s.email) = em limit 1;
    insert into public.carrier_activity (carrier_id, carrier_name, edrpou, action, by_email, by_name)
    values (new.id::text, new.name, new.edrpou, act, em, coalesce(nm, split_part(em, '@', 1)));
    return new;
end $$;

drop trigger if exists carrier_activity_trg on public.carriers;
create trigger carrier_activity_trg after insert or update on public.carriers
    for each row execute function public.carrier_activity_log();

-- 4. Те, що вже позначено «✓ пробито» сьогодні, — в журнал (один раз)
insert into public.carrier_activity (carrier_id, carrier_name, edrpou, action, by_email, by_name, at)
select c.id::text, c.name, c.edrpou, coalesce(c.checked_how, 'edit'), null, c.checked_by, c.checked_at
  from public.carriers c
 where c.checked_at is not null
   and not exists (select 1 from public.carrier_activity a where a.carrier_id = c.id::text and a.at = c.checked_at);

-- Перевірка
select action, by_name, count(*) from public.carrier_activity group by 1, 2 order by 3 desc;
