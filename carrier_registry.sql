-- FURA: реєстр перевізників (ФОП і компанії з КВЕД 49.41 «Вантажний автомобільний транспорт»)
-- з телефонами, e-mail, областю й адресою. Звідки: файли «4941_…xlsx» (зведені в carrier_registry.csv).
--
-- Що робить:
--   1) таблиця carrier_registry — сам реєстр (~65 тис. записів);
--   2) у картці перевізника — блок «📇 Реєстр» з телефонами, поштою й областю;
--   3) перевізникам БЕЗ телефону телефон, область і місто дописуються самі:
--      за кодом ЄДРПОУ (точно) або за ПІБ ФОП, якщо в реєстрі рівно одна така людина;
--      нові перевізники (з «Черги», митних даних, вручну) — одразу при додаванні.
--
-- Порядок: КРОК 1 (цей файл, до рядка «КРОК 3») → КРОК 2 імпорт CSV → КРОК 3 (останній блок).

-- ======================= КРОК 1. Таблиця й функції =======================

-- Ключ для порівняння назв: великі літери (кирилицю переводимо явно — не залежить від налаштувань бази),
-- один апостроф, без «ФОП», лапок і зайвих пробілів, «ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ» → «ТОВ».
create or replace function public.fura_name_key(t text)
returns text
language sql
immutable
as $$
    select nullif(trim(regexp_replace(
        regexp_replace(
            regexp_replace(
                regexp_replace(
                    regexp_replace(
                        upper(translate(coalesce(t, ''),
                            'абвгґдеєжзиіїйклмнопрстуфхцчшщьюяё’ʼ`´‘',
                            'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯЁ' || repeat(chr(39), 5))),
                        'ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ', 'ТОВ', 'g'),
                    'ПРИВАТНЕ ПІДПРИЄМСТВО', 'ПП', 'g'),
                '^(ФОП|ФІЗИЧНА ОСОБА[- ]+ПІДПРИЄМЕЦЬ)\s+', ''),
            '["«»“”]', '', 'g'),
        '\s+', ' ', 'g')), '')
$$;

create table if not exists public.carrier_registry (
    id         bigserial primary key,
    name       text not null,        -- ПІБ ФОП або назва компанії
    code       text,                 -- ЄДРПОУ (лише для компаній)
    boss       text,                 -- керівник (компанії)
    contacts   text,                 -- контактні особи (компанії)
    phone      text,                 -- +380…, кілька через кому
    email      text,
    website    text,
    city       text,
    oblast     text,                 -- «ЛЬВІВСЬКА ОБЛ.», «М. КИЇВ» — як у «Перевізниках»
    address    text,
    reg_date   text,
    status     text,
    kved_main  text,
    kveds      text,
    name_key   text generated always as (public.fura_name_key(name)) stored
);
create index if not exists carrier_registry_key_idx  on public.carrier_registry (name_key);
create index if not exists carrier_registry_code_idx on public.carrier_registry (ltrim(code, '0'));

grant select on public.carrier_registry to authenticated;
grant select, insert, update, delete on public.carrier_registry to service_role;
grant usage, select on sequence public.carrier_registry_id_seq to service_role;
alter table public.carrier_registry enable row level security;
drop policy if exists "carrier_registry_read" on public.carrier_registry;
create policy "carrier_registry_read" on public.carrier_registry for select to authenticated
    using (exists (select 1 from public.staff s where lower(s.email) = lower(auth.jwt() ->> 'email') and s.active));

-- Записи реєстру для перевізника: спершу за кодом ЄДРПОУ, якщо нема — за назвою / ПІБ
create or replace function public.registry_match(p_code text, p_name text)
returns setof public.carrier_registry
language sql
stable
set search_path = ''
as $$
    with by_code as (
        select * from public.carrier_registry
         where nullif(ltrim(regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), '0'), '') = ltrim(code, '0')
    )
    select * from by_code
    union all
    select * from public.carrier_registry
     where not exists (select 1 from by_code)
       and name_key = public.fura_name_key(p_name)
     limit 20
$$;
grant execute on function public.registry_match(text, text) to authenticated;

-- Один найкращий збіг для автозаповнення: за кодом, або за ПІБ, якщо всі збіги — та сама людина (один телефон)
create or replace function public.registry_best(p_code text, p_name text)
returns public.carrier_registry
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    rows public.carrier_registry[];
    phones text[];
begin
    select array_agg(r) into rows from public.registry_match(p_code, p_name) r where coalesce(r.phone, '') <> '';
    if rows is null then return null; end if;
    select array_agg(distinct x.phone) into phones from unnest(rows) x;
    if array_length(phones, 1) = 1 then return rows[1]; end if;
    return null;  -- різні люди з однаковим ПІБ — не вгадуємо
end;
$$;

-- Дописати з реєстру одному перевізнику (лише порожні поля)
create or replace function public.registry_fill_row(c public.carriers, r public.carrier_registry, out res public.carriers)
language plpgsql
set search_path = ''
as $$
begin
    res := c;
    if r.id is null then return; end if;
    if coalesce(res.phone_1, '') = '' then
        res.phone_1 := split_part(r.phone, ',', 1);
        if coalesce(res.contact_person_1, '') = '' then
            res.contact_person_1 := coalesce(nullif(r.boss, ''), case when coalesce(r.code, '') = '' then initcap(r.name) end);
        end if;
        if coalesce(res.phone_2, '') = '' and position(',' in r.phone) > 0 then
            res.phone_2 := trim(split_part(r.phone, ',', 2));
        end if;
    end if;
    if coalesce(res.region_ukr, '') = '' and coalesce(r.oblast, '') <> '' then res.region_ukr := r.oblast; end if;
    if coalesce(res.city, '') = '' and coalesce(r.city, '') <> '' then res.city := r.city; end if;
    res.notes := concat_ws(E'\n', nullif(res.notes, ''),
        '📇 З реєстру (КВЕД 49.41) ' || to_char(now(), 'DD.MM.YYYY') || ': ' ||
        concat_ws(' · ', nullif(r.phone, ''), nullif(r.email, ''), nullif(r.oblast, ''), nullif(r.city, '')));
end;
$$;

-- Нові перевізники — одразу з телефоном і областю з реєстру
create or replace function public.carriers_registry_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r public.carrier_registry;
begin
    if coalesce(new.phone_1, '') <> '' and coalesce(new.region_ukr, '') <> '' then return new; end if;
    begin
        r := public.registry_best(new.edrpou, new.name);
        if r.id is not null then new := public.registry_fill_row(new, r); end if;
    exception when others then
        null;  -- реєстр не має заважати додаванню перевізника
    end;
    return new;
end;
$$;
drop trigger if exists carriers_registry_fill on public.carriers;
create trigger carriers_registry_fill before insert on public.carriers
    for each row execute function public.carriers_registry_fill();

-- Наявним перевізникам без телефону (запускається один раз у КРОЦІ 3, можна повторювати)
create or replace function public.fill_carriers_from_registry()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    c public.carriers;
    r public.carrier_registry;
    filled integer := 0;
    regions integer := 0;
begin
    for c in select * from public.carriers where coalesce(phone_1, '') = '' or coalesce(region_ukr, '') = '' loop
        r := public.registry_best(c.edrpou, c.name);
        if r.id is null then continue; end if;
        if coalesce(c.phone_1, '') = '' then filled := filled + 1;
        elsif coalesce(c.region_ukr, '') = '' and coalesce(r.oblast, '') <> '' then regions := regions + 1;
        else continue;
        end if;
        c := public.registry_fill_row(c, r);
        update public.carriers
           set phone_1 = c.phone_1, phone_2 = c.phone_2, contact_person_1 = c.contact_person_1,
               region_ukr = c.region_ukr, city = c.city, notes = c.notes
         where id = c.id;
    end loop;
    return jsonb_build_object('phones_added', filled, 'regions_added', regions);
end;
$$;
revoke all on function public.fill_carriers_from_registry() from public, anon, authenticated;
grant execute on function public.fill_carriers_from_registry() to service_role;

-- Перевірка кроку 1: таблиця є (поки 0 рядків)
select count(*) as registry_rows from public.carrier_registry;


-- ======================= КРОК 2. Імпорт =======================
-- Table Editor → carrier_registry → Insert → Import data from CSV → файл carrier_registry.csv.
-- (Колонку name_key не чіпайте — вона рахується сама.)


-- ======================= КРОК 3. Дописати наявним перевізникам =======================
-- Виконати ОКРЕМО, після імпорту. Покаже, скільком дописано телефон / область.
-- select public.fill_carriers_from_registry();
