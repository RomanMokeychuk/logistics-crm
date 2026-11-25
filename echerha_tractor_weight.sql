-- FURA «Черга»: вага тягача (власна / повна маса, кг) — щоб точно рахувати, скільки вантажу бере автопоїзд.
-- Supabase → SQL Editor → вставити → Run (можна повторно).
alter table public.echerha_queue add column if not exists tractor_weight text;
