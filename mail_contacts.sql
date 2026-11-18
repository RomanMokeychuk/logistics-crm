-- FURA · Пошта → «Адреси»: свої e-mail контакти (чия адреса, компанія, телефон, підпис).
-- Кожен бачить і змінює тільки свої записи.
create table if not exists public.mail_contacts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    email text not null,
    name text default '',
    company text default '',
    position text default '',
    phone text default '',
    signature text default '',
    note text default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create unique index if not exists mail_contacts_user_email on public.mail_contacts (user_id, lower(email));

alter table public.mail_contacts enable row level security;
drop policy if exists mail_contacts_own on public.mail_contacts;
create policy mail_contacts_own on public.mail_contacts for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.mail_contacts from anon;
grant select, insert, update, delete on public.mail_contacts to authenticated;

create or replace function public.mail_contacts_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists mail_contacts_touch on public.mail_contacts;
create trigger mail_contacts_touch before update on public.mail_contacts
    for each row execute function public.mail_contacts_touch();

select 'mail_contacts готово' as status;
