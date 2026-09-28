-- Meta WhatsApp notification channel hardening validated in Sandbox UAT 2026-09-28.
create table if not exists public.meta_whatsapp_webhook_events (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
 provider_event_id text, phone_number_id text, sender_wa_id text, event_kind text not null check (event_kind in ('message','status','verification','other')),
 payload jsonb not null default '{}'::jsonb, received_at timestamptz not null default now(), processed_at timestamptz, processing_result text
);
create unique index if not exists meta_whatsapp_webhook_events_provider_event_uidx on public.meta_whatsapp_webhook_events(studio_id,provider_event_id) where provider_event_id is not null;
create index if not exists meta_whatsapp_webhook_events_received_idx on public.meta_whatsapp_webhook_events(studio_id,received_at desc);
alter table public.meta_whatsapp_webhook_events enable row level security;
revoke all on public.meta_whatsapp_webhook_events from public, anon, authenticated;

create table if not exists public.meta_whatsapp_inbound_reply_state (
 studio_id uuid not null references public.studios(id) on delete cascade, sender_wa_id text not null,
 last_auto_reply_at timestamptz, last_inbound_at timestamptz not null default now(), inbound_count bigint not null default 0, updated_at timestamptz not null default now(),
 primary key(studio_id,sender_wa_id)
);
alter table public.meta_whatsapp_inbound_reply_state enable row level security;
revoke all on public.meta_whatsapp_inbound_reply_state from public, anon, authenticated;

create or replace function public.service_reservation_checkin_token(target_studio_id uuid,target_reservation_id uuid)
returns text language plpgsql security definer set search_path to '' as $$
declare v_res public.reservations%rowtype; v_tok public.reservation_checkin_tokens%rowtype;
begin
 select * into v_res from public.reservations where id=target_reservation_id and studio_id=target_studio_id;
 if not found then return null; end if;
 select * into v_tok from public.reservation_checkin_tokens where reservation_id=v_res.id and revoked_at is null;
 if not found then return null; end if;
 return private.checkin_token_value(v_res.id,v_tok.token_version);
end; $$;
revoke all on function public.service_reservation_checkin_token(uuid,uuid) from public, anon, authenticated;
grant execute on function public.service_reservation_checkin_token(uuid,uuid) to service_role;

-- Demeter Sandbox/UAT-specific provider and cancellation-channel config is intentionally studio-scoped.
insert into public.notification_studio_channel_providers(studio_id,channel_key,provider_key,adapter_key,enabled,is_default)
values ('9fe23cfa-fb47-4670-afeb-ed4a56433772','whatsapp','meta_whatsapp','meta_whatsapp',true,true)
on conflict (studio_id,channel_key,provider_key) do update set adapter_key=excluded.adapter_key,enabled=true,is_default=true;

insert into public.notification_rule_channels(studio_id,rule_id,version_number,channel_key,is_required,ordinal,channel_policy)
values ('9fe23cfa-fb47-4670-afeb-ed4a56433772','414e56f7-c753-4abf-82ac-551892031851',1,'whatsapp',false,2,'{"delivery_max_attempts":3}'::jsonb)
on conflict (rule_id,version_number,channel_key) do update set is_required=false,ordinal=2,channel_policy=excluded.channel_policy;


-- Studio-owned customer service destination used by notification-only inbound redirect.
create table if not exists public.studio_contact_channels (
 studio_id uuid primary key references public.studios(id) on delete cascade,
 whatsapp_attention_e164 text check (whatsapp_attention_e164 is null or whatsapp_attention_e164 ~ E'^\\+[1-9][0-9]{7,14}$'),
 updated_at timestamptz not null default now()
);
alter table public.studio_contact_channels enable row level security;
revoke all on public.studio_contact_channels from public, anon, authenticated;
insert into public.studio_contact_channels(studio_id,whatsapp_attention_e164)
values ('9fe23cfa-fb47-4670-afeb-ed4a56433772','+525665053888')
on conflict(studio_id) do update set whatsapp_attention_e164=excluded.whatsapp_attention_e164,updated_at=now();
