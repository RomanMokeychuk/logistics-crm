-- FURA · «1-24» у полі «Додатково» перевізникам, чиї машини ЗАРАЗ у черзі «Товари 1-24 групи УКТЗЕД».
-- Одноразово для тих, хто вже стоїть; далі це робить сервер сам при кожному оновленні Черги.
-- Supabase → SQL Editor → New query → вставити → Run (можна повторно — не дублює).
with q as (
    select distinct regexp_replace(e.edrpou, '\D', '', 'g') as code
      from public.echerha_queue e
     where e.sync_id = (select sync_id from public.echerha_sync where id = 1)
       and concat_ws(' ', e.checkpoint, e.qtype, e.note) ~ '(^|[^0-9])1\s*[-–]\s*24([^0-9]|$)'
       and length(regexp_replace(coalesce(e.edrpou, ''), '\D', '', 'g')) >= 8
), upd as (
    update public.carriers c
       set additional = case when coalesce(trim(c.additional), '') = '' then '1-24'
                             else regexp_replace(trim(c.additional), '[;,]\s*$', '') || ', 1-24' end
      from q
     where regexp_replace(coalesce(c.edrpou, ''), '\D', '', 'g') = q.code
       and coalesce(c.additional, '') !~ '(^|[^0-9])1\s*[-–]\s*24([^0-9]|$)'
    returning c.id
)
select count(*) as "дописано 1-24" from upd;
