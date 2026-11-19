-- FURA: пауза автоматичного обходу перевізників у Lardi.
-- Обхід не працює: 1) поки ви натиснули «⏸ Пауза» (до 1 год або до «▶ Продовжити»);
--                  2) 15 хв після будь-якої вашої дії з Lardi у FURA (пошук, «З Lardi», скріншот).
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run (можна повторно).
create table if not exists public.lardi_pause (
    id            int primary key default 1 check (id = 1),
    paused_until  timestamptz,
    paused_by     text,
    last_activity timestamptz
);
insert into public.lardi_pause (id) values (1) on conflict (id) do nothing;
alter table public.lardi_pause enable row level security;
grant select on public.lardi_pause to authenticated;
grant select, insert, update on public.lardi_pause to service_role;
drop policy if exists lardi_pause_read on public.lardi_pause;
create policy lardi_pause_read on public.lardi_pause for select to authenticated using (true);
