create or replace function private.sync_admin_communication_window()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if pg_trigger_depth()>1 then return new; end if;
 if tg_table_name='notification_admin_settings' then
 insert into public.automation_communication_settings(studio_id,global_send_window,updated_by_user_id,updated_at)
 values(new.studio_id,new.non_urgent_send_window,(select auth.uid()),now())
 on conflict(studio_id) do update set global_send_window=excluded.global_send_window,updated_by_user_id=excluded.updated_by_user_id,updated_at=now();
 else
 update public.notification_admin_settings set non_urgent_send_window=new.global_send_window,updated_at=now() where studio_id=new.studio_id;
 end if;
 return new;
end; $$;
create trigger notification_window_sync after insert or update of non_urgent_send_window on public.notification_admin_settings for each row execute function private.sync_admin_communication_window();
create trigger automation_window_sync after insert or update of global_send_window on public.automation_communication_settings for each row execute function private.sync_admin_communication_window();
update public.notification_admin_settings n set non_urgent_send_window=coalesce(n.non_urgent_send_window,a.global_send_window) from public.automation_communication_settings a where n.studio_id=a.studio_id;

