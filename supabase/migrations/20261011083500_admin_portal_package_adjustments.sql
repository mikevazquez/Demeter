create table public.product_acquisition_admin_events(
id uuid primary key default gen_random_uuid(),studio_id uuid not null references public.studios(id),acquisition_id uuid not null references public.product_acquisitions(id),kind text not null check(kind in ('start_date','credits')),reason text not null,changes jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now());
alter table public.product_acquisition_admin_events enable row level security;
revoke all on public.product_acquisition_admin_events from public,anon,authenticated;
grant select on public.product_acquisition_admin_events to authenticated;
create policy acquisition_admin_events_read on public.product_acquisition_admin_events for select to authenticated using(private.has_capability(studio_id,'students.read'));
create or replace function public.admin_adjust_acquisition_credits(target_acquisition_id uuid,target_delta integer,target_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.product_acquisitions%rowtype;b integer;r text:=nullif(trim(target_reason),'');
begin
select * into a from public.product_acquisitions where id=target_acquisition_id for update;
if not found then raise exception 'acquisition_not_found';end if;
if auth.uid() is null or not (private.has_capability(a.studio_id,'products.write') or private.has_capability(a.studio_id,'sales.write')) then raise exception 'forbidden';end if;
if a.refunded_at is not null or a.status not in ('active','expired') then raise exception 'acquisition_not_editable';end if;
if a.unlimited then raise exception 'unlimited_acquisition';end if;
if r is null then raise exception 'adjustment_reason_required';end if;
if target_delta is null or abs(target_delta)>100000 then raise exception 'credits_invalid';end if;
select coalesce(sum(quantity),0)::integer into b from public.credit_ledger where acquisition_id=a.id;
if b+target_delta<0 then raise exception 'negative_credits';end if;
if target_delta<>0 then
insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note,created_by) values(a.studio_id,a.id,'adjustment',target_delta,'Ajuste de clases · '||left(r,500),auth.uid());
insert into public.product_acquisition_admin_events(studio_id,acquisition_id,kind,reason,changes,created_by) values(a.studio_id,a.id,'credits',left(r,500),jsonb_build_object('delta',target_delta,'previous',b,'available',b+target_delta),auth.uid());
end if;
return jsonb_build_object('available_credits',b+target_delta,'delta',target_delta);
end;$$;
create or replace function public.admin_change_acquisition_start(target_acquisition_id uuid,target_starts_on date,target_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.product_acquisitions%rowtype;v_end date;v_days integer;r text:=nullif(trim(target_reason),'');tz text;
begin
select * into a from public.product_acquisitions where id=target_acquisition_id for update;
if not found then raise exception 'acquisition_not_found';end if;
if auth.uid() is null or not (private.has_capability(a.studio_id,'products.write') or private.has_capability(a.studio_id,'sales.write')) then raise exception 'forbidden';end if;
if a.refunded_at is not null or a.status not in ('active','expired') then raise exception 'acquisition_not_editable';end if;
if r is null then raise exception 'adjustment_reason_required';end if;
if a.starts_on is null or target_starts_on is null or abs(target_starts_on-a.starts_on)>7 then raise exception 'start_date_outside_window';end if;
v_days:=coalesce(a.expires_on-a.starts_on,a.validity_days_snapshot);
if v_days is null then raise exception 'product_validity_missing';end if;
v_end:=target_starts_on+v_days;
select timezone into tz from public.studios where id=a.studio_id;
if exists(select 1 from public.reservations r join public.class_sessions s on s.id=r.session_id where r.acquisition_id=a.id and r.status in ('reserved','attended','no_show') and ((s.starts_at at time zone tz)::date<target_starts_on or (s.starts_at at time zone tz)::date>v_end)) then raise exception 'reservation_outside_validity';end if;
update public.product_acquisitions set starts_on=target_starts_on,expires_on=v_end,activation_mode='fixed_date',status=case when v_end<(now() at time zone tz)::date then 'expired'::public.product_acquisition_status else 'active'::public.product_acquisition_status end,updated_at=now() where id=a.id;
insert into public.product_acquisition_admin_events(studio_id,acquisition_id,kind,reason,changes,created_by) values(a.studio_id,a.id,'start_date',left(r,500),jsonb_build_object('previous_start',a.starts_on,'previous_end',a.expires_on,'starts_on',target_starts_on,'expires_on',v_end),auth.uid());
return jsonb_build_object('starts_on',target_starts_on,'expires_on',v_end);
end;$$;
revoke all on function public.admin_adjust_acquisition_credits(uuid,integer,text),public.admin_change_acquisition_start(uuid,date,text) from public,anon;
grant execute on function public.admin_adjust_acquisition_credits(uuid,integer,text),public.admin_change_acquisition_start(uuid,date,text) to authenticated;
