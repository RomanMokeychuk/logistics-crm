-- FURA: «Час очікування» з єЧерги для кожного пункту.
-- Supabase → SQL Editor → New query → вставити → Run (можна повторно).
alter table public.echerha_checkpoints add column if not exists wait_min  integer;  -- хвилини
alter table public.echerha_checkpoints add column if not exists wait_text text;     -- «4 дн 3 год»
