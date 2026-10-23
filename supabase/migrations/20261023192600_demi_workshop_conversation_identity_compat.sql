-- Production's legacy Demi schema has no assistant discriminator on conversations.
-- Sandbox already has this column. Preserve all existing conversation identities,
-- channels, content, profiles and financial data; the configuration fallback stays.
alter table public.assistant_conversations
  add column if not exists assistant_key text not null default 'demi'
  check (assistant_key in ('demi', 'polina'));
