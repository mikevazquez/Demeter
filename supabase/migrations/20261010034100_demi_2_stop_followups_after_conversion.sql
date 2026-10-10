create function private.stop_demi_trial_followups_on_conversion() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.student_type='regular' and old.student_type='trial' then
  update public.demi_followups set state='cancelled',reason_code='converted',lease_token=null,lease_until=null where studio_id=new.studio_id and person_id=new.person_id and kind in ('prospect','post_trial') and state in ('pending','processing');
 end if;
 return new;
end $$;
revoke all on function private.stop_demi_trial_followups_on_conversion() from public,anon,authenticated,service_role;
create trigger demi_trial_conversion_stops_followups after update of student_type on public.students for each row execute function private.stop_demi_trial_followups_on_conversion();
