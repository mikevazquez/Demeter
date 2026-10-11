-- Capture the actor's display name and role at cancellation time so later
-- account or membership changes do not rewrite the audit shown in Hoy.
alter table public.class_sessions add column if not exists cancelled_by_label text;

create or replace function private.audit_admin_session_cancellation()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor_name text; actor_role text;
begin
 if new.status='cancelled' and old.status is distinct from new.status then
   new.cancelled_at:=clock_timestamp(); new.cancelled_by:=(select auth.uid());
   new.cancellation_source:=coalesce(new.cancellation_source,case when new.minimum_review_status='cancelled' then 'minimum' when new.holiday_override_id is not null then 'holiday' else 'manual' end);
   new.cancellation_reason:=coalesce(nullif(btrim(new.cancellation_reason),''),case when new.minimum_review_status='cancelled' then 'No alcanzó el mínimo de reservas' else 'Clase cancelada por el estudio' end);
   if new.cancelled_by is null then new.cancelled_by_label:='Automático';
   else
     select nullif(btrim(full_name),'') into actor_name from public.profiles where id=new.cancelled_by;
     select case role::text when 'owner' then 'Owner' when 'admin' then 'Admin' when 'reception' then 'Recepción' when 'instructor' then 'Coach' else null end
       into actor_role from public.studio_memberships where studio_id=new.studio_id and user_id=new.cancelled_by;
     new.cancelled_by_label:=coalesce(actor_name,'Equipo del estudio')||coalesce(' · '||actor_role,'');
   end if;
 elsif old.status='cancelled' and new.status<>'cancelled' then
   new.cancelled_at:=null; new.cancelled_by:=null; new.cancelled_by_label:=null; new.cancellation_source:=null; new.cancellation_reason:=null;
 end if;
 return new;
end;
$$;
revoke all on function private.audit_admin_session_cancellation() from public,anon,authenticated;

-- Historical rows retain the known actor's name, without inventing a past role.
update public.class_sessions cs set cancelled_by_label=p.full_name
from public.profiles p where cs.cancelled_by=p.id and cs.status='cancelled' and cs.cancelled_by_label is null;
update public.class_sessions set cancelled_by_label='Automático'
where status='cancelled' and cancelled_by is null and cancelled_by_label is null;
