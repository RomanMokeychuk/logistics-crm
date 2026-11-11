-- FURA: скільки завгодно контактів у перевізника (3-й, 4-й… контакт) + поле «Директор».
-- Supabase → SQL Editor → New query → вставити → Run (можна повторно).
alter table public.carriers
    add column if not exists extra_contacts jsonb not null default '[]'::jsonb;  -- [{ "name": "...", "phone": "..." }]

-- Перевірка:
-- select id, name, extra_contacts from public.carriers where extra_contacts <> '[]'::jsonb limit 10;

-- Директор перевізника (ПІБ)
alter table public.carriers add column if not exists director text;
