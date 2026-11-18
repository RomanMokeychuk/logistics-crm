-- FURA: кожен співробітник підключає СВОЮ пошту (e-mail + пароль) на сторінці «Пошта».
-- Пароль зберігається лише зашифрованим (ключ MAIL_ENC_KEY у секретах функції fura-sales).
-- Сайт і інші співробітники цю таблицю НЕ бачать — читає тільки функція на сервері.
-- Supabase → SQL Editor → New query → вставити → Run.

create table if not exists public.staff_mailboxes (
    staff_id    uuid primary key,          -- staff.id
    email       text not null,
    from_name   text,                      -- ім'я відправника, напр. «Mokeychuk Roman»
    pass_enc    text not null,             -- зашифрований пароль
    smtp_host   text not null,
    smtp_port   int  not null default 465,
    imap_host   text not null,
    imap_port   int  not null default 993,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
alter table public.staff_mailboxes enable row level security;
-- жодних політик: з сайту доступу немає зовсім, лише сервер (service role)
revoke all on public.staff_mailboxes from anon, authenticated;
