-- NOTIFICACIONES-02 · Package activation and password-reset producer hardening.

create or replace function private.notification_emit_package_activated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_today date;
begin
  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = new.studio_id;

  v_today := (clock_timestamp() at time zone coalesce(v_timezone, 'America/Mexico_City'))::date;

  if new.status = 'active'
     and new.refunded_at is null
     and (new.starts_on is null or new.starts_on <= v_today)
     and (
       tg_op = 'INSERT'
       or old.status is distinct from new.status
       or old.starts_on is distinct from new.starts_on
       or old.refunded_at is distinct from new.refunded_at
     ) then
    perform private.notification_try_emit_domain_event(
      new.studio_id,
      'package.activated',
      'product_acquisition',
      new.id,
      'notification:package.activated:' || new.id::text,
      jsonb_build_object(
        'student_id', new.student_id,
        'acquisition_id', new.id,
        'starts_on', new.starts_on,
        'expires_on', new.expires_on
      ),
      auth.uid(),
      clock_timestamp()
    );
  end if;

  return new;
end;
$$;

revoke all on function private.notification_emit_package_activated()
from public, anon, authenticated, service_role;

drop trigger if exists notification_package_activated on public.product_acquisitions;
create trigger notification_package_activated
after insert or update of status, starts_on, refunded_at
on public.product_acquisitions
for each row execute function private.notification_emit_package_activated();

create or replace function private.notification_emit_due_package_activations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select
      a.id,
      a.studio_id,
      a.student_id,
      a.starts_on,
      a.expires_on
    from public.product_acquisitions a
    join public.studios s on s.id = a.studio_id
    where a.status = 'active'
      and a.refunded_at is null
      and (a.starts_on is null or a.starts_on <=
        (clock_timestamp() at time zone coalesce(s.timezone, 'America/Mexico_City'))::date)
  loop
    if private.notification_try_emit_domain_event(
      v_row.studio_id,
      'package.activated',
      'product_acquisition',
      v_row.id,
      'notification:package.activated:' || v_row.id::text,
      jsonb_build_object(
        'student_id', v_row.student_id,
        'acquisition_id', v_row.id,
        'starts_on', v_row.starts_on,
        'expires_on', v_row.expires_on
      ),
      null,
      clock_timestamp()
    ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.notification_emit_due_package_activations()
from public, anon, authenticated, service_role;

select cron.schedule(
  'studio_flow_notification_package_activation_due',
  '5 * * * *',
  'select private.notification_emit_due_package_activations();'
);

update public.notification_rules
set event_type = 'package.activated',
    updated_at = clock_timestamp()
where rule_key = 'p0.package.activated'
  and archived_at is null;

drop trigger if exists notification_password_reset on public.user_accounts;
drop function if exists private.notification_emit_password_reset();
