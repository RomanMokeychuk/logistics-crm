-- FURA «Черга»: вага причепа (власна / повна маса, кг) — напр. «6160 / 39000».
-- Виконати один раз: Supabase → SQL Editor → вставити → Run.
alter table public.echerha_queue add column if not exists trailer_weight text;
