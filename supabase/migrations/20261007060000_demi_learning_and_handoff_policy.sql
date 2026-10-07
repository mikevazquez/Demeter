-- Demi learning proposals and configurable human handoff whitelist.
create table if not exists public.assistant_handoff_policies (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  reason_code text not null, label text not null, description text not null default '',
  enabled boolean not null default true, blocking boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(studio_id, reason_code)
);
create table if not exists public.assistant_learning_proposals (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  conversation_id uuid references public.assistant_conversations(id) on delete set null,
  source_turn_id uuid, category text not null default 'correction', title text not null,
  evidence text not null default '', proposed_instruction text not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  reviewed_at timestamptz, reviewed_by uuid,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index if not exists assistant_learning_proposals_review_idx on public.assistant_learning_proposals(studio_id,status,created_at desc);
alter table public.assistant_handoff_policies enable row level security;
alter table public.assistant_learning_proposals enable row level security;
revoke all on table public.assistant_handoff_policies from public, anon;
revoke all on table public.assistant_learning_proposals from public, anon;
grant select,insert,update,delete on table public.assistant_handoff_policies to authenticated, service_role;
grant select,insert,update,delete on table public.assistant_learning_proposals to authenticated, service_role;
drop policy if exists assistant_handoff_policies_admin on public.assistant_handoff_policies;
create policy assistant_handoff_policies_admin on public.assistant_handoff_policies for all to authenticated using(private.has_capability(studio_id,'settings.write')) with check(private.has_capability(studio_id,'settings.write'));
drop policy if exists assistant_learning_proposals_admin on public.assistant_learning_proposals;
create policy assistant_learning_proposals_admin on public.assistant_learning_proposals for all to authenticated using(private.has_capability(studio_id,'settings.write')) with check(private.has_capability(studio_id,'settings.write'));
insert into public.assistant_handoff_policies(studio_id,reason_code,label,description,enabled,blocking,sort_order)
select s.id,v.reason_code,v.label,v.description,true,v.blocking,v.sort_order from public.studios s cross join (values
('refund_request','Reembolso','Solicitud de devolución de dinero.',true,10),
('package_cancellation','Cancelar paquete','Cancelación o modificación excepcional de un paquete.',true,20),
('payment_dispute','Disputa de cobro','La persona desconoce o disputa un cargo.',true,30),
('receipt_validation_failed','Comprobante no validado','No fue posible asociar o validar un comprobante automáticamente.',false,40),
('human_requested','Pidió hablar con una persona','Solicitud explícita de atención humana.',true,50),
('safety_incident','Accidente o seguridad','Lesión, accidente o situación de seguridad.',true,60),
('serious_complaint','Queja grave','Conflicto o queja que requiere intervención del estudio.',true,70),
('policy_exception','Excepción de política','Requiere autorizar una excepción a las reglas del estudio.',true,80),
('technical_block','Bloqueo técnico','Demi agotó el intento operativo y no puede completar la acción.',true,90)
) as v(reason_code,label,description,blocking,sort_order)
on conflict(studio_id,reason_code) do nothing;