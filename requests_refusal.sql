-- FURA: причина відмови від запиту (кнопка «❌ Відмова» в картці запиту і в Telegram).
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run (можна повторно).

alter table public.requests add column if not exists refusal_reason  text;        -- Знайшов дешевше / Не підійшла ціна / Закрив клієнт / Не актуально
alter table public.requests add column if not exists refusal_comment text;        -- уточнення (необов'язково)
alter table public.requests add column if not exists refused_at      timestamptz; -- коли відмовились
alter table public.requests add column if not exists refused_by      text;        -- хто поставив відмову

-- Перевірка: скільки відмов за причинами
select coalesce(refusal_reason, '— без причини') as причина, count(*) as запитів
  from public.requests
 where status = 'Відмова'
 group by 1
 order by 2 desc;
