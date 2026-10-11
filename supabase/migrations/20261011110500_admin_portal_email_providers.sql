create table private.studio_email_connections(
 studio_id uuid primary key references public.studios(id) on delete cascade,provider text not null check(provider in ('resend','sendgrid','ses')),
 from_email text not null,region text,secret_id uuid not null,tested_at timestamptz not null,updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now());
revoke all on private.studio_email_connections from public,anon,authenticated;
create or replace function public.service_save_email_connection(p_studio_id uuid,p_actor_id uuid,p_provider text,p_from_email text,p_region text,p_secret text)
returns void language plpgsql security definer set search_path='' as $$
declare secret uuid;
begin
 if not exists(select 1 from public.studio_memberships where studio_id=p_studio_id and user_id=p_actor_id and active and role in ('owner','admin')) then raise exception 'forbidden'; end if;
 if p_provider not in ('resend','sendgrid','ses') or nullif(trim(p_secret),'') is null then raise exception 'email_connection_invalid'; end if;
 select vault.create_secret(p_secret) into secret;
 insert into private.studio_email_connections(studio_id,provider,from_email,region,secret_id,tested_at,updated_by)
 values(p_studio_id,p_provider,p_from_email,p_region,secret,now(),p_actor_id)
 on conflict(studio_id) do update set provider=excluded.provider,from_email=excluded.from_email,region=excluded.region,secret_id=excluded.secret_id,tested_at=now(),updated_by=excluded.updated_by,updated_at=now();
 update public.notification_studio_channel_providers set enabled=false,is_default=false where studio_id=p_studio_id and channel_key='email';
 insert into public.notification_studio_channel_providers(studio_id,channel_key,provider_key,adapter_key,enabled,is_default)
 values(p_studio_id,'email',p_provider,'email_provider',true,true)
 on conflict(studio_id,channel_key,provider_key) do update set enabled=true,is_default=true,updated_at=now();
end; $$;
create or replace function public.service_get_email_connection(p_studio_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('provider',c.provider,'from_email',c.from_email,'region',c.region,'secret',s.decrypted_secret)
 from private.studio_email_connections c join vault.decrypted_secrets s on s.id=c.secret_id
 where c.studio_id=p_studio_id and exists(select 1 from public.notification_studio_channel_providers p where p.studio_id=c.studio_id and p.channel_key='email' and p.provider_key=c.provider and p.enabled and p.is_default);
$$;
create or replace function public.admin_email_connection_snapshot(p_studio_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_capability(p_studio_id,'settings.write') and not private.has_capability(p_studio_id,'automations.read') then raise exception 'forbidden'; end if;
 return (select jsonb_build_object('provider',c.provider,'from_email',c.from_email,'region',c.region,'tested_at',c.tested_at) from private.studio_email_connections c where c.studio_id=p_studio_id);
end; $$;
revoke all on function public.service_save_email_connection(uuid,uuid,text,text,text,text),public.service_get_email_connection(uuid),public.admin_email_connection_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.service_save_email_connection(uuid,uuid,text,text,text,text),public.service_get_email_connection(uuid) to service_role;
grant execute on function public.admin_email_connection_snapshot(uuid) to authenticated;
