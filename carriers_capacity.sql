-- FURA · Тоннаж і об'єм у картку перевізника з «Черги» (від–до).
-- FURA вписує їх сама при оновленні Черги — лише в порожні поля або ті, що сама вписала раніше
-- (ваші ручні дані не чіпає). Supabase → SQL Editor → вставити → Run (можна повторно).
alter table public.carriers add column if not exists cap_auto_t text; -- що FURA вписала в «Тоннаж» востаннє
alter table public.carriers add column if not exists cap_auto_v text; -- що FURA вписала в «Об'єм» востаннє
-- Якщо «Тоннаж» / «Об'єм» зберігаються як числа — переводимо в текст, щоб влазило «23.5–24.5»
do $$
begin
    if (select data_type from information_schema.columns where table_schema='public' and table_name='carriers' and column_name='tonnage') in ('numeric','double precision','real','integer') then
        alter table public.carriers alter column tonnage type text using tonnage::text;
    end if;
    if (select data_type from information_schema.columns where table_schema='public' and table_name='carriers' and column_name='volume') in ('numeric','double precision','real','integer') then
        alter table public.carriers alter column volume type text using volume::text;
    end if;
exception when others then
    raise notice 'Не вдалося змінити тип колонок: %', sqlerrm;
end $$;

-- Перевірка: tonnage і volume мають бути text
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'carriers' and column_name in ('tonnage', 'volume', 'cap_auto_t', 'cap_auto_v');
