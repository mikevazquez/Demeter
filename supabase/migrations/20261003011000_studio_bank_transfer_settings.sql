-- Customer-facing bank transfer instructions per studio.
-- Read/write is restricted to authenticated admins with settings.write and service_role.

create table if not exists public.studio_bank_transfer_settings (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  enabled boolean not null default false,
  bank_name text,
  account_holder text,
  clabe text,
  account_number text,
  card_number text,
  instructions text,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  constraint studio_bank_transfer_clabe_format
    check (clabe is null or clabe ~ '^[0-9]{18}$'),
  constraint studio_bank_transfer_account_format
    check (account_number is null or account_number ~ '^[0-9]{4,20}$'),
  constraint studio_bank_transfer_card_format
    check (card_number is null or card_number ~ '^[0-9]{12,19}$')
);

alter table public.studio_bank_transfer_settings enable row level security;

revoke all on table public.studio_bank_transfer_settings from public, anon;
grant select, insert, update on table public.studio_bank_transfer_settings
to authenticated, service_role;

drop policy if exists studio_bank_transfer_settings_admin_read
on public.studio_bank_transfer_settings;
create policy studio_bank_transfer_settings_admin_read
on public.studio_bank_transfer_settings
for select
to authenticated
using (private.has_capability(studio_id, 'settings.write'));

drop policy if exists studio_bank_transfer_settings_admin_insert
on public.studio_bank_transfer_settings;
create policy studio_bank_transfer_settings_admin_insert
on public.studio_bank_transfer_settings
for insert
to authenticated
with check (private.has_capability(studio_id, 'settings.write'));

drop policy if exists studio_bank_transfer_settings_admin_update
on public.studio_bank_transfer_settings;
create policy studio_bank_transfer_settings_admin_update
on public.studio_bank_transfer_settings
for update
to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));

comment on table public.studio_bank_transfer_settings is
  'Customer-facing transfer instructions used by Studio Flow and Demi.';

create or replace function public.service_get_bank_transfer_settings(
  target_studio_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when s.studio_id is null or not s.enabled then
      jsonb_build_object('configured', false)
    when nullif(trim(coalesce(s.bank_name,'')), '') is null
      or nullif(trim(coalesce(s.account_holder,'')), '') is null
      or (
        nullif(trim(coalesce(s.clabe,'')), '') is null
        and nullif(trim(coalesce(s.account_number,'')), '') is null
        and nullif(trim(coalesce(s.card_number,'')), '') is null
      )
    then jsonb_build_object('configured', false)
    else jsonb_build_object(
      'configured', true,
      'bank_name', s.bank_name,
      'account_holder', s.account_holder,
      'clabe', s.clabe,
      'account_number', s.account_number,
      'card_number', s.card_number,
      'instructions', s.instructions
    )
  end
  from (select target_studio_id as studio_id) x
  left join public.studio_bank_transfer_settings s
    on s.studio_id=x.studio_id;
$function$;

revoke all on function public.service_get_bank_transfer_settings(uuid)
from public, anon, authenticated;
grant execute on function public.service_get_bank_transfer_settings(uuid)
to service_role;
