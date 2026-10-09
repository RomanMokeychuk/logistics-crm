-- "Світлофор" запитів: час відповіді логіста.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.

-- 1. Нова колонка: коли логіст відповів на запит
alter table public.requests
    add column if not exists answered_at timestamptz;

-- 2. Час відповіді ставить сама база — у момент, коли статус
--    змінюється з "Запит" на будь-який інший. Повернули статус
--    назад на "Запит" — час відповіді скидається.
create or replace function public.set_request_answered_at()
returns trigger
language plpgsql
as $$
begin
    if new.status = 'Запит' then
        new.answered_at := null;
    elsif new.answered_at is null then
        new.answered_at := now();
    end if;
    return new;
end;
$$;

drop trigger if exists trg_request_answered_at on public.requests;

create trigger trg_request_answered_at
    before insert or update on public.requests
    for each row execute function public.set_request_answered_at();

-- 3. Запити, на які вже відповіли раніше, теж стають "зеленими"
update public.requests
set answered_at = created_at
where status <> 'Запит' and answered_at is null;