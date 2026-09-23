
-- DOCUMENTOS-01 · domain persistence and transversal booking restrictions

insert into public.capabilities(key, description)
values
  ('documents.read', 'Consultar documentos, versiones y aceptaciones del estudio'),
  ('documents.manage', 'Crear, publicar, versionar y administrar documentos del estudio')
on conflict (key) do update set description = excluded.description;

insert into public.role_capabilities(role, capability_key)
values
  ('owner', 'documents.read'),
  ('owner', 'documents.manage'),
  ('admin', 'documents.read'),
  ('admin', 'documents.manage'),
  ('reception', 'documents.read')
on conflict do nothing;

create table if not exists public.studio_documents (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  document_type text not null check (
    document_type in ('contract','regulation','waiver','privacy','consent','notice','other')
  ),
  description text,
  created_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists studio_documents_studio_idx
  on public.studio_documents(studio_id, archived_at, created_at desc);

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  document_id uuid not null references public.studio_documents(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  status text not null default 'draft' check (
    status in ('draft','scheduled','active','superseded','retired')
  ),
  response_mode text not null default 'accept_required' check (
    response_mode in ('accept_required','decision_optional','informational')
  ),
  acceptance_party text not null default 'student' check (
    acceptance_party in ('student','guardian_if_minor','student_and_guardian','guardian_only')
  ),
  audience_scope text not null default 'all' check (
    audience_scope in ('all','adults','minors','activity','event','student')
  ),
  enforcement_scope text not null default 'global_booking' check (
    enforcement_scope in ('global_booking','activity_booking','event_registration','none')
  ),
  requires_reacceptance boolean not null default true,
  effective_at timestamptz,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  superseded_at timestamptz,
  retired_at timestamptz,
  retired_by uuid references auth.users(id) on delete set null,
  file_path text,
  file_name text,
  mime_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  content_sha256 text,
  affirmation_text text,
  change_summary text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_id, version_number)
);

create index if not exists document_versions_document_idx
  on public.document_versions(document_id, version_number desc);
create index if not exists document_versions_studio_status_idx
  on public.document_versions(studio_id, status, effective_at);

create table if not exists public.document_version_targets (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  version_id uuid not null references public.document_versions(id) on delete cascade,
  target_type text not null check (target_type in ('activity','event','student')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  unique(version_id, target_type, target_id)
);

create index if not exists document_version_targets_lookup_idx
  on public.document_version_targets(version_id, target_type, target_id);

create table if not exists public.student_guardians (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  email text,
  phone text,
  relationship text not null check (
    relationship in ('mother','father','legal_guardian','family','other')
  ),
  relationship_detail text,
  active boolean not null default true,
  verified_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists student_guardians_one_active_identity_idx
  on public.student_guardians(student_id, lower(coalesce(email,'')), lower(full_name))
  where active;

create index if not exists student_guardians_student_idx
  on public.student_guardians(studio_id, student_id, active);

create table if not exists public.guardian_document_invitations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  guardian_id uuid not null references public.student_guardians(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'pending' check (
    status in ('pending','completed','expired','revoked')
  ),
  delivery_channel text check (delivery_channel is null or delivery_channel in ('email','phone','manual')),
  destination_hint text,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists guardian_document_invitations_student_idx
  on public.guardian_document_invitations(studio_id, student_id, status, expires_at);

create table if not exists public.document_acceptances (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  version_id uuid not null references public.document_versions(id) on delete restrict,
  acceptor_kind text not null check (acceptor_kind in ('student','guardian')),
  guardian_id uuid references public.student_guardians(id) on delete restrict,
  decision text not null check (decision in ('accepted','declined')),
  method text not null check (method in ('student_portal','guardian_link','in_person','external')),
  affirmation_text text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  actor_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (
    (acceptor_kind = 'student' and guardian_id is null)
    or (acceptor_kind = 'guardian' and guardian_id is not null)
  )
);

create unique index if not exists document_acceptances_identity_idx
  on public.document_acceptances(
    version_id,
    student_id,
    acceptor_kind,
    coalesce(guardian_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists document_acceptances_student_idx
  on public.document_acceptances(studio_id, student_id, accepted_at desc);

create table if not exists public.document_acceptance_invalidations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  acceptance_id uuid not null references public.document_acceptances(id) on delete restrict,
  reason text not null check (char_length(trim(reason)) between 3 and 1000),
  invalidated_by uuid references auth.users(id) on delete set null,
  invalidated_at timestamptz not null default now(),
  unique(acceptance_id)
);

create table if not exists public.student_booking_restrictions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  code text not null,
  title text not null,
  detail text,
  action_kind text not null default 'contact_studio' check (
    action_kind in ('documents','payment','profile','contact_studio','custom')
  ),
  action_href text,
  source_type text not null default 'admin',
  source_id uuid,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists student_booking_restrictions_active_idx
  on public.student_booking_restrictions(studio_id, student_id, starts_at, expires_at)
  where resolved_at is null;

create table if not exists public.student_booking_exceptions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  restriction_code text,
  source_id uuid,
  reason text not null check (char_length(trim(reason)) between 3 and 1000),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  granted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

create index if not exists student_booking_exceptions_active_idx
  on public.student_booking_exceptions(studio_id, student_id, starts_at, expires_at)
  where revoked_at is null;

create table if not exists public.document_incidents (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  version_id uuid references public.document_versions(id) on delete set null,
  acceptance_id uuid references public.document_acceptances(id) on delete set null,
  guardian_id uuid references public.student_guardians(id) on delete set null,
  incident_type text not null check (
    incident_type in (
      'in_person_acceptance',
      'external_evidence',
      'acceptance_invalidation',
      'temporary_exception',
      'guardian_issue',
      'other'
    )
  ),
  status text not null default 'open' check (status in ('open','in_review','resolved','rejected')),
  reason text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_incidents_studio_idx
  on public.document_incidents(studio_id, status, created_at desc);

create table if not exists public.document_audit_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  document_id uuid references public.studio_documents(id) on delete set null,
  version_id uuid references public.document_versions(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  acceptance_id uuid references public.document_acceptances(id) on delete set null,
  event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now()
);

create index if not exists document_audit_events_studio_idx
  on public.document_audit_events(studio_id, occurred_at desc);

create or replace function private.document_guard_immutable_acceptance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'document_acceptance_immutable';
end;
$$;

drop trigger if exists document_acceptances_immutable on public.document_acceptances;
create trigger document_acceptances_immutable
before update or delete on public.document_acceptances
for each row execute function private.document_guard_immutable_acceptance();

create or replace function private.document_guard_published_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
    new.document_id is distinct from old.document_id
    or new.version_number is distinct from old.version_number
    or new.response_mode is distinct from old.response_mode
    or new.acceptance_party is distinct from old.acceptance_party
    or new.audience_scope is distinct from old.audience_scope
    or new.enforcement_scope is distinct from old.enforcement_scope
    or new.requires_reacceptance is distinct from old.requires_reacceptance
    or new.effective_at is distinct from old.effective_at
    or new.file_path is distinct from old.file_path
    or new.file_name is distinct from old.file_name
    or new.mime_type is distinct from old.mime_type
    or new.file_size_bytes is distinct from old.file_size_bytes
    or new.content_sha256 is distinct from old.content_sha256
    or new.affirmation_text is distinct from old.affirmation_text
    or new.change_summary is distinct from old.change_summary
  ) then
    raise exception 'published_document_version_immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists document_versions_published_immutable on public.document_versions;
create trigger document_versions_published_immutable
before update on public.document_versions
for each row execute function private.document_guard_published_version();

create or replace function private.student_birth_date(p_student_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value text;
begin
  select v.value #>> '{}'
    into v_value
  from public.students s
  join public.profile_field_definitions d
    on d.studio_id = s.studio_id
   and d.entity_type = 'student'
   and d.key = 'birth_date'
   and d.active = true
  join public.profile_field_values v
    on v.definition_id = d.id
   and v.person_id = s.person_id
   and v.studio_id = s.studio_id
  where s.id = p_student_id
  limit 1;

  if v_value is null or v_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;

  return v_value::date;
exception when others then
  return null;
end;
$$;

revoke all on function private.student_birth_date(uuid)
from public, anon, authenticated, service_role;

create or replace function private.student_is_minor(p_student_id uuid, p_as_of date default current_date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.student_birth_date(p_student_id) is null then null
    else private.student_birth_date(p_student_id) > (p_as_of - interval '18 years')::date
  end;
$$;

revoke all on function private.student_is_minor(uuid,date)
from public, anon, authenticated, service_role;

create or replace function private.document_acceptance_valid(
  p_version_id uuid,
  p_student_id uuid,
  p_acceptor_kind text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_acceptances a
    join public.document_versions v on v.id = a.version_id
    where a.version_id = p_version_id
      and a.student_id = p_student_id
      and a.acceptor_kind = p_acceptor_kind
      and (
        v.response_mode = 'decision_optional'
        or a.decision = 'accepted'
      )
      and not exists (
        select 1
        from public.document_acceptance_invalidations i
        where i.acceptance_id = a.id
      )
  );
$$;

revoke all on function private.document_acceptance_valid(uuid,uuid,text)
from public, anon, authenticated, service_role;

create or replace function private.document_prior_acceptance_valid(
  p_version_id uuid,
  p_student_id uuid,
  p_acceptor_kind text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_versions current_v
    join public.document_versions prior_v
      on prior_v.document_id = current_v.document_id
     and prior_v.version_number < current_v.version_number
     and prior_v.status in ('active','superseded','retired','scheduled')
    join public.document_acceptances a
      on a.version_id = prior_v.id
     and a.student_id = p_student_id
     and a.acceptor_kind = p_acceptor_kind
    where current_v.id = p_version_id
      and current_v.requires_reacceptance = false
      and (
        prior_v.response_mode = 'decision_optional'
        or a.decision = 'accepted'
      )
      and not exists (
        select 1
        from public.document_acceptance_invalidations i
        where i.acceptance_id = a.id
      )
  );
$$;

revoke all on function private.document_prior_acceptance_valid(uuid,uuid,text)
from public, anon, authenticated, service_role;

create or replace function private.document_party_satisfied(
  p_version_id uuid,
  p_student_id uuid,
  p_acceptor_kind text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.document_acceptance_valid(p_version_id, p_student_id, p_acceptor_kind)
    or private.document_prior_acceptance_valid(p_version_id, p_student_id, p_acceptor_kind);
$$;

revoke all on function private.document_party_satisfied(uuid,uuid,text)
from public, anon, authenticated, service_role;

create or replace function private.document_version_applies_to_student(
  p_version_id uuid,
  p_student_id uuid,
  p_session_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version public.document_versions%rowtype;
  v_student public.students%rowtype;
  v_minor boolean;
  v_template_id uuid;
begin
  select * into v_version
  from public.document_versions
  where id = p_version_id;

  if not found then return false; end if;

  select * into v_student
  from public.students
  where id = p_student_id
    and studio_id = v_version.studio_id;

  if not found then return false; end if;

  if v_version.status not in ('active','scheduled') then return false; end if;
  if v_version.published_at is null then return false; end if;
  if coalesce(v_version.effective_at, v_version.published_at) > now() then return false; end if;
  if v_version.retired_at is not null then return false; end if;

  if exists (
    select 1
    from public.document_versions newer
    where newer.document_id = v_version.document_id
      and newer.version_number > v_version.version_number
      and newer.status in ('active','scheduled')
      and newer.published_at is not null
      and coalesce(newer.effective_at, newer.published_at) <= now()
      and newer.retired_at is null
  ) then
    return false;
  end if;

  v_minor := private.student_is_minor(p_student_id, current_date);

  if v_version.audience_scope = 'adults' and coalesce(v_minor, false) then return false; end if;
  if v_version.audience_scope = 'minors' and v_minor is distinct from true then return false; end if;

  if v_version.audience_scope = 'student' then
    return exists (
      select 1 from public.document_version_targets t
      where t.version_id = v_version.id
        and t.target_type = 'student'
        and t.target_id = p_student_id
    );
  end if;

  if v_version.audience_scope = 'activity' then
    if p_session_id is null then return true; end if;

    select cs.template_id into v_template_id
    from public.class_sessions cs
    where cs.id = p_session_id
      and cs.studio_id = v_version.studio_id;

    return exists (
      select 1 from public.document_version_targets t
      where t.version_id = v_version.id
        and t.target_type = 'activity'
        and t.target_id = v_template_id
    );
  end if;

  if v_version.audience_scope = 'event' then
    return p_session_id is null;
  end if;

  return true;
end;
$$;

revoke all on function private.document_version_applies_to_student(uuid,uuid,uuid)
from public, anon, authenticated, service_role;

create or replace function private.document_requirement_satisfied(
  p_version_id uuid,
  p_student_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version public.document_versions%rowtype;
  v_minor boolean;
  v_student_ok boolean;
  v_guardian_ok boolean;
begin
  select * into v_version from public.document_versions where id = p_version_id;
  if not found then return true; end if;
  if v_version.response_mode = 'informational' then return true; end if;

  v_minor := private.student_is_minor(p_student_id, current_date);
  v_student_ok := private.document_party_satisfied(p_version_id, p_student_id, 'student');
  v_guardian_ok := private.document_party_satisfied(p_version_id, p_student_id, 'guardian');

  case v_version.acceptance_party
    when 'student' then
      return v_student_ok;
    when 'guardian_if_minor' then
      if v_minor is true then return v_guardian_ok; end if;
      if v_minor is null then return false; end if;
      return v_student_ok;
    when 'student_and_guardian' then
      if v_minor is true then return v_student_ok and v_guardian_ok; end if;
      if v_minor is null then return false; end if;
      return v_student_ok;
    when 'guardian_only' then
      return v_minor is true and v_guardian_ok;
    else
      return false;
  end case;
end;
$$;

revoke all on function private.document_requirement_satisfied(uuid,uuid)
from public, anon, authenticated, service_role;

create or replace function private.student_document_blockers(
  p_student_id uuid,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_version record;
  v_result jsonb := '[]'::jsonb;
  v_minor boolean;
  v_guardian_required boolean;
  v_has_guardian boolean;
  v_scope_ok boolean;
begin
  select * into v_student from public.students where id = p_student_id;
  if not found then return v_result; end if;

  if p_session_id is not null then
    select * into v_session
    from public.class_sessions
    where id = p_session_id
      and studio_id = v_student.studio_id;
  end if;

  v_minor := private.student_is_minor(p_student_id, current_date);

  for v_version in
    select dv.*, d.name as document_name
    from public.document_versions dv
    join public.studio_documents d on d.id = dv.document_id
    where dv.studio_id = v_student.studio_id
      and dv.status in ('active','scheduled')
      and dv.published_at is not null
      and coalesce(dv.effective_at, dv.published_at) <= now()
      and dv.retired_at is null
      and dv.response_mode <> 'informational'
      and d.archived_at is null
    order by dv.document_id, dv.version_number desc
  loop
    if exists (
      select 1
      from public.document_versions newer
      where newer.document_id = v_version.document_id
        and newer.version_number > v_version.version_number
        and newer.status in ('active','scheduled')
        and newer.published_at is not null
        and coalesce(newer.effective_at, newer.published_at) <= now()
        and newer.retired_at is null
    ) then
      continue;
    end if;

    if not private.document_version_applies_to_student(v_version.id, p_student_id, p_session_id) then
      continue;
    end if;

    v_scope_ok := v_version.enforcement_scope = 'global_booking'
      or (
        v_version.enforcement_scope = 'activity_booking'
        and p_session_id is not null
      );

    if not v_scope_ok then
      continue;
    end if;

    if private.document_requirement_satisfied(v_version.id, p_student_id) then
      continue;
    end if;

    v_guardian_required :=
      v_version.acceptance_party in ('guardian_if_minor','student_and_guardian','guardian_only')
      and (v_minor is true or v_minor is null);

    if v_guardian_required and v_minor is null then
      v_result := v_result || jsonb_build_array(
        jsonb_build_object(
          'code', 'birth_date_required',
          'type', 'profile',
          'title', 'Completa tu fecha de nacimiento',
          'detail', 'Necesitamos tu fecha de nacimiento para determinar quién debe aceptar los documentos obligatorios.',
          'action_kind', 'profile',
          'action_href', '/student/perfil',
          'action_label', 'Completar perfil',
          'version_id', v_version.id,
          'document_id', v_version.document_id,
          'document_name', v_version.document_name
        )
      );
      continue;
    end if;

    select exists (
      select 1 from public.student_guardians g
      where g.student_id = p_student_id
        and g.studio_id = v_student.studio_id
        and g.active
    ) into v_has_guardian;

    if v_guardian_required and not v_has_guardian then
      v_result := v_result || jsonb_build_array(
        jsonb_build_object(
          'code', 'guardian_required',
          'type', 'document',
          'title', 'Necesitamos a tu responsable',
          'detail', format('Tu responsable debe completar %s antes de que puedas reservar.', v_version.document_name),
          'action_kind', 'documents',
          'action_href', '/student/documentos/responsable',
          'action_label', 'Agregar responsable',
          'version_id', v_version.id,
          'document_id', v_version.document_id,
          'document_name', v_version.document_name
        )
      );
    else
      v_result := v_result || jsonb_build_array(
        jsonb_build_object(
          'code', 'document_required',
          'type', 'document',
          'title', format('%s pendiente', v_version.document_name),
          'detail', case
            when v_version.enforcement_scope = 'activity_booking'
              then 'Necesitas completar este documento antes de reservar esta actividad.'
            else 'Necesitas completar este documento antes de realizar nuevas reservas.'
          end,
          'action_kind', 'documents',
          'action_href', '/student/documentos/' || v_version.id::text,
          'action_label', 'Revisar documento',
          'version_id', v_version.id,
          'document_id', v_version.document_id,
          'document_name', v_version.document_name
        )
      );
    end if;
  end loop;

  return v_result;
end;
$$;

revoke all on function private.student_document_blockers(uuid,uuid)
from public, anon, authenticated, service_role;

create or replace function private.student_booking_blockers(
  p_student_id uuid,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_result jsonb := '[]'::jsonb;
  v_documents jsonb;
  v_row public.student_booking_restrictions%rowtype;
begin
  select * into v_student from public.students where id = p_student_id;
  if not found then return v_result; end if;

  v_documents := private.student_document_blockers(p_student_id, p_session_id);
  v_result := v_result || coalesce(v_documents, '[]'::jsonb);

  for v_row in
    select r.*
    from public.student_booking_restrictions r
    where r.studio_id = v_student.studio_id
      and r.student_id = p_student_id
      and r.resolved_at is null
      and r.starts_at <= now()
      and (r.expires_at is null or r.expires_at > now())
      and not exists (
        select 1
        from public.student_booking_exceptions e
        where e.studio_id = r.studio_id
          and e.student_id = r.student_id
          and e.revoked_at is null
          and e.starts_at <= now()
          and e.expires_at > now()
          and (
            e.source_id = r.id
            or (e.source_id is null and e.restriction_code = r.code)
            or (e.source_id is null and e.restriction_code is null)
          )
      )
    order by r.created_at
  loop
    v_result := v_result || jsonb_build_array(
      jsonb_build_object(
        'code', v_row.code,
        'type', v_row.source_type,
        'title', v_row.title,
        'detail', v_row.detail,
        'action_kind', v_row.action_kind,
        'action_href', v_row.action_href,
        'action_label', case v_row.action_kind
          when 'payment' then 'Realizar pago'
          when 'documents' then 'Revisar documentos'
          when 'profile' then 'Completar perfil'
          when 'contact_studio' then 'Contactar al estudio'
          else 'Resolver requisito'
        end,
        'restriction_id', v_row.id
      )
    );
  end loop;

  if exists (
    select 1
    from public.product_acquisitions pa
    where pa.studio_id = v_student.studio_id
      and pa.student_id = p_student_id
      and pa.status = 'active'
      and pa.access_blocked
  ) and not exists (
    select 1
    from public.student_booking_exceptions e
    where e.studio_id = v_student.studio_id
      and e.student_id = p_student_id
      and e.revoked_at is null
      and e.starts_at <= now()
      and e.expires_at > now()
      and e.restriction_code = 'payment_pending'
  ) then
    v_result := v_result || jsonb_build_array(
      jsonb_build_object(
        'code', 'payment_pending',
        'type', 'payment',
        'title', 'Tienes un pago pendiente',
        'detail', 'Hay un adeudo vencido o una condición de pago que debes resolver antes de realizar nuevas reservas.',
        'action_kind', 'payment',
        'action_href', '/student/paquete',
        'action_label', 'Revisar pago'
      )
    );
  end if;

  return v_result;
end;
$$;

revoke all on function private.student_booking_blockers(uuid,uuid)
from public, anon, authenticated, service_role;

create or replace function private.document_refresh_rewards_onboarding(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending jsonb;
begin
  v_pending := private.student_document_blockers(p_student_id, null);

  if jsonb_array_length(v_pending) = 0
     and to_regprocedure('private.reward_onboarding_mark_documents_complete(uuid,jsonb)') is not null then
    execute 'select private.reward_onboarding_mark_documents_complete($1,$2)'
      using p_student_id, jsonb_build_object('source','documents01','completed_at',now());
  end if;
end;
$$;

revoke all on function private.document_refresh_rewards_onboarding(uuid)
from public, anon, authenticated, service_role;

create or replace function private.document_acceptance_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.document_audit_events(
    studio_id, version_id, student_id, acceptance_id, event_type, actor_user_id, details
  )
  values (
    new.studio_id,
    new.version_id,
    new.student_id,
    new.id,
    'acceptance_recorded',
    new.actor_user_id,
    jsonb_build_object('acceptor_kind',new.acceptor_kind,'decision',new.decision,'method',new.method)
  );

  perform private.document_refresh_rewards_onboarding(new.student_id);
  return new;
end;
$$;

revoke all on function private.document_acceptance_audit()
from public, anon, authenticated, service_role;

drop trigger if exists document_acceptance_after_insert on public.document_acceptances;
create trigger document_acceptance_after_insert
after insert on public.document_acceptances
for each row execute function private.document_acceptance_audit();

alter table public.studio_documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_version_targets enable row level security;
alter table public.student_guardians enable row level security;
alter table public.guardian_document_invitations enable row level security;
alter table public.document_acceptances enable row level security;
alter table public.document_acceptance_invalidations enable row level security;
alter table public.student_booking_restrictions enable row level security;
alter table public.student_booking_exceptions enable row level security;
alter table public.document_incidents enable row level security;
alter table public.document_audit_events enable row level security;

drop policy if exists studio_documents_admin_read on public.studio_documents;
create policy studio_documents_admin_read on public.studio_documents
for select to authenticated
using (private.has_capability(studio_id,'documents.read'));

drop policy if exists document_versions_admin_read on public.document_versions;
create policy document_versions_admin_read on public.document_versions
for select to authenticated
using (private.has_capability(studio_id,'documents.read'));

drop policy if exists document_targets_admin_read on public.document_version_targets;
create policy document_targets_admin_read on public.document_version_targets
for select to authenticated
using (private.has_capability(studio_id,'documents.read'));

drop policy if exists guardians_admin_or_self_read on public.student_guardians;
create policy guardians_admin_or_self_read on public.student_guardians
for select to authenticated
using (
  private.has_capability(studio_id,'documents.read')
  or private.is_current_student(student_id,studio_id)
);

drop policy if exists guardian_invites_admin_or_self_read on public.guardian_document_invitations;
create policy guardian_invites_admin_or_self_read on public.guardian_document_invitations
for select to authenticated
using (
  private.has_capability(studio_id,'documents.read')
  or private.is_current_student(student_id,studio_id)
);

drop policy if exists acceptances_admin_or_self_read on public.document_acceptances;
create policy acceptances_admin_or_self_read on public.document_acceptances
for select to authenticated
using (
  private.has_capability(studio_id,'documents.read')
  or private.is_current_student(student_id,studio_id)
);

drop policy if exists acceptance_invalidations_admin_or_self_read on public.document_acceptance_invalidations;
create policy acceptance_invalidations_admin_or_self_read on public.document_acceptance_invalidations
for select to authenticated
using (
  private.has_capability(studio_id,'documents.read')
  or exists (
    select 1 from public.document_acceptances a
    where a.id = acceptance_id
      and private.is_current_student(a.student_id,a.studio_id)
  )
);

drop policy if exists booking_restrictions_admin_or_self_read on public.student_booking_restrictions;
create policy booking_restrictions_admin_or_self_read on public.student_booking_restrictions
for select to authenticated
using (
  private.has_capability(studio_id,'students.read')
  or private.is_current_student(student_id,studio_id)
);

drop policy if exists booking_exceptions_admin_or_self_read on public.student_booking_exceptions;
create policy booking_exceptions_admin_or_self_read on public.student_booking_exceptions
for select to authenticated
using (
  private.has_capability(studio_id,'students.read')
  or private.is_current_student(student_id,studio_id)
);

drop policy if exists document_incidents_admin_read on public.document_incidents;
create policy document_incidents_admin_read on public.document_incidents
for select to authenticated
using (private.has_capability(studio_id,'documents.read'));

drop policy if exists document_audit_admin_read on public.document_audit_events;
create policy document_audit_admin_read on public.document_audit_events
for select to authenticated
using (private.has_capability(studio_id,'documents.read'));

grant select on public.studio_documents to authenticated;
grant select on public.document_versions to authenticated;
grant select on public.document_version_targets to authenticated;
grant select on public.student_guardians to authenticated;
grant select on public.guardian_document_invitations to authenticated;
grant select on public.document_acceptances to authenticated;
grant select on public.document_acceptance_invalidations to authenticated;
grant select on public.student_booking_restrictions to authenticated;
grant select on public.student_booking_exceptions to authenticated;
grant select on public.document_incidents to authenticated;
grant select on public.document_audit_events to authenticated;

revoke insert, update, delete on public.studio_documents from anon, authenticated;
revoke insert, update, delete on public.document_versions from anon, authenticated;
revoke insert, update, delete on public.document_version_targets from anon, authenticated;
revoke insert, update, delete on public.student_guardians from anon, authenticated;
revoke insert, update, delete on public.guardian_document_invitations from anon, authenticated;
revoke insert, update, delete on public.document_acceptances from anon, authenticated;
revoke insert, update, delete on public.document_acceptance_invalidations from anon, authenticated;
revoke insert, update, delete on public.student_booking_restrictions from anon, authenticated;
revoke insert, update, delete on public.student_booking_exceptions from anon, authenticated;
revoke insert, update, delete on public.document_incidents from anon, authenticated;
revoke insert, update, delete on public.document_audit_events from anon, authenticated;
