-- FURA: вхід у кабінет за логіном і паролем + самореєстрація клієнтів і перевізників.
-- Виконати ПІСЛЯ portal.sql: Supabase → SQL Editor → New query → вставити весь файл → Run (можна повторно).
--
-- Як це працює:
--   • Людина сама реєструється в кабінеті (cabinet.html → «Зареєструватися»): компанія, ЄДРПОУ, контакти,
--     логін і пароль. Заявка має статус «pending» — поки її не підтвердить співробітник, людина бачить лише
--     екран «Заявка на перевірці» і НЕ бачить жодних рейсів (захист від того, хто впише чужий ЄДРПОУ).
--   • Співробітник у CRM (Клієнти / Реєстр перевізників → «Нові реєстрації») прив'язує заявку до наявної
--     компанії або створює нову — і людина отримує повний кабінет.
--   • Пароль зберігається лише як хеш (PBKDF2-SHA256, 100 000 ітерацій, з «сіллю»). Сам пароль ніде не лежить.

alter table public.portal_accounts
    add column if not exists login         text,          -- e-mail, телефон або будь-яке слово (малими літерами)
    add column if not exists password_hash text,
    add column if not exists status        text not null default 'active',
    add column if not exists reg           jsonb,         -- що людина вказала при реєстрації
    add column if not exists approved_by   uuid,
    add column if not exists approved_at   timestamptz;

-- Статуси: active — працює; pending — заявка на перевірці; rejected — відхилено
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'portal_accounts_status_chk') then
        alter table public.portal_accounts add constraint portal_accounts_status_chk check (status in ('active', 'pending', 'rejected'));
    end if;
end $$;

-- Раніше кожен доступ мусив бути прив'язаний до компанії. Тепер заявка може ще не мати компанії —
-- замінюємо стару перевірку на нову: прив'язка обов'язкова лише для активних доступів.
do $$
declare c record;
begin
    for c in
        select conname from pg_constraint
        where conrelid = 'public.portal_accounts'::regclass and contype = 'c'
          and pg_get_constraintdef(oid) ilike '%lead_id is not null%'
          and conname <> 'portal_accounts_ref_chk'
    loop
        execute format('alter table public.portal_accounts drop constraint %I', c.conname);
    end loop;
    if not exists (select 1 from pg_constraint where conname = 'portal_accounts_ref_chk') then
        alter table public.portal_accounts add constraint portal_accounts_ref_chk check (
            status <> 'active'
            or (kind = 'client' and lead_id is not null)
            or (kind = 'carrier' and carrier_id is not null)
        );
    end if;
end $$;

-- Один логін — одна людина
create unique index if not exists portal_accounts_login_uq on public.portal_accounts (lower(login)) where login is not null;
create index if not exists portal_accounts_pending_idx on public.portal_accounts (kind, created_at desc) where status = 'pending';

-- Перевірка:
-- select kind, status, login, reg->>'company' as company, created_at from public.portal_accounts order by created_at desc limit 20;
