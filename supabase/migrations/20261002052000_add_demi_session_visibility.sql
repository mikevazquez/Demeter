alter table public.class_sessions
  add column if not exists assistant_visible boolean not null default true;

comment on column public.class_sessions.assistant_visible is
  'Controls whether this session can be surfaced by the Demi conversational assistant.';

create index if not exists class_sessions_studio_assistant_visible_idx
  on public.class_sessions(studio_id, assistant_visible, starts_at)
  where status='scheduled';
