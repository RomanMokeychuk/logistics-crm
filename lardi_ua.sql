-- FURA: Ларді по Україні (вантажі й машини Україна → Україна).
-- Supabase → SQL Editor → New query → вставити → Run (можна повторно).
-- Напрямок оновлюватиметься автоматично разом з іншими (~3 рази на день), кнопкою «Оновити» — одразу.
insert into public.lardi_directions (from_country, to_country, active) values ('UA', 'UA', true)
on conflict (from_country, to_country) do update set active = true;

-- Перевірка
select from_country, to_country, active, last_run_at, truck_last_run_at from public.lardi_directions where from_country = 'UA' and to_country = 'UA';
