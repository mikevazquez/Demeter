create or replace function private.promote_trial_student_from_enrollment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.status='active' and new.refunded_at is null then
    update public.students
    set student_type='regular',
        trial_status=case
          when student_type='trial' then 'converted'::public.trial_status
          else trial_status
        end,
        updated_at=now()
    where id=new.student_id
      and studio_id=new.studio_id
      and student_type='trial';

    update public.assistant_enrollment_intents aei
    set status='approved',
        updated_at=now()
    where aei.id=(
      select aei2.id
      from public.assistant_enrollment_intents aei2
      where aei2.studio_id=new.studio_id
        and aei2.student_id=new.student_id
        and aei2.status in ('cash_due','receipt_required','online_pending','human_review')
      order by aei2.created_at desc
      limit 1
    );
  end if;

  return new;
end;
$function$;
