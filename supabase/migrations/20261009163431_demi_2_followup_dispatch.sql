-- Reuse the existing vault dispatch credential; never include its value in source.
select cron.schedule('studio_flow_demi_followups','*/5 * * * *',$cron$
 select net.http_post(
  url:=rtrim((select decrypted_secret from vault.decrypted_secrets where name='studio_flow_project_url' limit 1),'/')||'/functions/v1/demi-followup-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-studio-flow-dispatch-token',(select decrypted_secret from vault.decrypted_secrets where name='studio_flow_automation_dispatch_token' limit 1)),
  body:=jsonb_build_object('studio_id',s.studio_id),timeout_milliseconds:=30000
 ) from public.demi_followup_settings s where s.enabled
 and not exists(select 1 from public.demi_uat_runs r where r.studio_id=s.studio_id);
$cron$);
