-- DEMI-BASE-03A · A Demi payment pending resolved through another channel is closed.
-- Decision D-PAY-04 (Mike, 2026-10-21): when the app, the team or another purchase resolves a
-- pending, Demi stops pursuing it. Only pendings WITHOUT a receipt are closed; anything already
-- received, under review or validated is never touched. Records are kept (status 'superseded').

-- 1. Allow the new terminal status and keep an audit trail.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.demi_group_bookings'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.demi_group_bookings drop constraint %I', c.conname);
  end loop;
  for c in
    select conname from pg_constraint
    where conrelid = 'public.assistant_transfer_purchase_intents'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.assistant_transfer_purchase_intents drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.demi_group_bookings
  add constraint demi_group_bookings_status_check check (status in (
    'awaiting_receipt','awaiting_participants','partial','provisional','validated','rejected','superseded'
  )),
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text;

alter table public.assistant_transfer_purchase_intents
  add constraint assistant_transfer_purchase_intents_status_check check (status in (
    'awaiting_receipt','provisional_active','validated','rejected','cancelled','expired','superseded'
  )),
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text;

-- 2. Close pendings when an operation resolves them.
create or replace function private.supersede_demi_pendings_on_operation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid;
  v_origin uuid;
  v_covers_classes boolean := false;
  v_reason text;
  v_session uuid;
begin
  if tg_table_name = 'reservations' then
    if new.status not in ('reserved','attended') then return new; end if;
    v_reason := 'reservation_exists';
    v_session := new.session_id;
  else
    if new.status <> 'active' or new.refunded_at is not null then return new; end if;
    v_reason := 'package_acquired';
    -- The purchase that this acquisition comes from (Demi transfer intents use the intent id
    -- as the sale idempotency key). That intent is being activated, not superseded.
    select s.idempotency_key into v_origin
    from public.sale_lines sl
    join public.sales s on s.id = sl.sale_id and s.studio_id = sl.studio_id
    where sl.id = new.sale_line_id and sl.studio_id = new.studio_id;
    v_covers_classes := coalesce(new.unlimited, false) or coalesce(new.credit_limit, 0) > 0;
  end if;

  select person_id into v_person
  from public.students
  where id = new.student_id and studio_id = new.studio_id;

  -- First-class / single-participant payment requests still waiting for a receipt.
  -- Covered by any package that grants classes, or by a reservation in the same session.
  if tg_table_name = 'reservations' or v_covers_classes then
    update public.demi_group_bookings g
    set status = 'superseded',
        superseded_at = clock_timestamp(),
        superseded_reason = v_reason
    where g.studio_id = new.studio_id
      and g.status = 'awaiting_receipt'
      and g.receipt_event_id is null
      and g.participant_count = 1
      and (v_session is null or g.session_id = v_session)
      -- A started online payment could still be completed; leave it to its own flow.
      and not exists (
        select 1 from public.demi_payment_requests r
        where r.group_id = g.id and r.status in ('order_created','pending','approved')
      )
      and (
        exists (
          select 1 from public.assistant_conversations c
          where c.id = g.conversation_id and c.studio_id = g.studio_id
            and c.student_id = new.student_id
        )
        or (
          v_person is not null
          and exists (
            select 1 from public.crm_contacts cc
            where cc.id = g.prospect_contact_id and cc.studio_id = g.studio_id
              and cc.person_id = v_person
          )
        )
      );
  end if;

  if tg_table_name = 'product_acquisitions' then
    update public.assistant_transfer_purchase_intents i
    set status = 'superseded',
        superseded_at = clock_timestamp(),
        superseded_reason = v_reason,
        updated_at = clock_timestamp()
    where i.studio_id = new.studio_id
      and i.student_id = new.student_id
      and i.status = 'awaiting_receipt'
      and i.receipt_event_id is null
      and i.id is distinct from v_origin
      and (
        -- Same product bought through another channel.
        (i.intent_kind = 'product_purchase' and i.product_template_id = new.product_template_id)
        -- A first-class charge is no longer needed once a class-granting package exists.
        or (i.intent_kind = 'trial_class' and v_covers_classes)
      );
  end if;

  return new;
end;
$$;

revoke all on function private.supersede_demi_pendings_on_operation() from public, anon, authenticated;

drop trigger if exists demi_pendings_reservation_supersede on public.reservations;
create trigger demi_pendings_reservation_supersede
  after insert or update of status on public.reservations
  for each row execute function private.supersede_demi_pendings_on_operation();

drop trigger if exists demi_pendings_package_supersede on public.product_acquisitions;
create trigger demi_pendings_package_supersede
  after insert or update of status on public.product_acquisitions
  for each row execute function private.supersede_demi_pendings_on_operation();
