-- Відповідь логіста: варіанти ціни + нотатки.
-- Виконати один раз: Supabase → SQL Editor → New query → вставити → Run.

alter table public.requests
    -- До 3 варіантів: ціна, валюта, коли буде авто, коментар
    add column if not exists offers       jsonb not null default '[]'::jsonb,
    -- Нотатки логіста (окремо від нотаток Sales)
    add column if not exists logist_notes text;