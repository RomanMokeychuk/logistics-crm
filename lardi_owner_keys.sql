-- Яке поле у профілі Lardi містить фото компанії? Виконайте і надішліть скрін результату.
select key, count(*) as "скільки разів", min(val) as "приклад"
from (
    select o.key, left(o.value::text, 120) as val
    from (select raw->'owner' as ow from public.lardi_cargo where raw ? 'owner' limit 300) t,
         jsonb_each(t.ow) o
) x
group by key
order by key;
