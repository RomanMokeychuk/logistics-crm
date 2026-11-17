-- FURA «Блокнот»: зв'язок із «Запитами» — запити, де ви логіст, з'являються в Блокноті самі.
-- Supabase → SQL Editor → New query → вставити → Run (можна повторно).
alter table public.my_requests add column if not exists request_id uuid;
create unique index if not exists my_requests_user_request_uq on public.my_requests (user_id, request_id) where request_id is not null;
