-- FURA: список перевізників знову завантажується швидко.
-- Причина: автоматичний обхід Lardi щоразу ставив позначку «перевірено» —
-- і кожен перевірений перевізник вважався «зміненим». За ніч їх тисячі →
-- сайт щоразу перезавантажував увесь список (10 700 рядків).
-- Тепер позначка «перевірено в Lardi» сама по собі НЕ рахується зміною.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.
create or replace function public.carriers_touch()
returns trigger
language plpgsql
as $$
begin
    -- нічого суттєвого не змінилось (лише технічні позначки обходу) — дату зміни не чіпаємо
    if (to_jsonb(new) - 'updated_at' - 'lardi_checked_at' - 'lardi_found')
       = (to_jsonb(old) - 'updated_at' - 'lardi_checked_at' - 'lardi_found') then
        new.updated_at := old.updated_at;
    else
        new.updated_at := now();
    end if;
    return new;
end;
$$;
