-- Нові поля для запитів.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.
-- Старі запити не зачіпаються, нові колонки просто будуть порожні.

alter table public.requests
    add column if not exists cargo           text,  -- Вантаж
    add column if not exists transport_type  text,  -- Тип транспорту
    add column if not exists weight          text,  -- Вага
    add column if not exists load_address    text,  -- Місто / адреса завантаження
    add column if not exists unload_address  text,  -- Місто / адреса розвантаження
    add column if not exists customs_export  text,  -- Замитнення
    add column if not exists border_crossing text,  -- Погран перехід
    add column if not exists customs_import  text,  -- Розмитнення
    add column if not exists desired_date_to date,  -- Кінець періоду бажаної дати
    add column if not exists notes           text;  -- Нотатки