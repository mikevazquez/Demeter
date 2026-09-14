-- Studio Flow · RLS smoke test for students
-- Run against a disposable/dev database. The whole test rolls back.
-- Verifies: permitted own-tenant read, cross-tenant denial, unaffiliated denial.

begin;

create temp table rls_test_context as
select m.user_id as owner_user_id, m.studio_id as owner_studio_id
from public.studio_memberships m
where m.role = 'owner'::public.studio_role
  and m.active = true
order by m.created_at
limit 1;

insert into public.studios (id, name, slug, timezone)
values (
  '00000000-0000-4000-8000-0000000000f2',
  'RLS Fixture Foreign',
  'rls-fixture-foreign',
  'America/Mexico_City'
);

insert into public.students (id, studio_id, full_name, phone, active)
select
  '00000000-0000-4000-8000-0000000000a1'::uuid,
  owner_studio_id,
  'RLS Own Fixture',
  '+5211111111111',
  true
from rls_test_context;

insert into public.students (id, studio_id, full_name, phone, active)
values (
  '00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000f2',
  'RLS Foreign Fixture',
  '+5211111111112',
  true
);

select set_config(
  'request.jwt.claim.sub',
  (select owner_user_id::text from rls_test_context),
  true
);
set local role authenticated;

do $$
begin
  if (select count(*) from public.students where id = '00000000-0000-4000-8000-0000000000a1') <> 1 then
    raise exception 'RLS FAIL: owner cannot read own-tenant student';
  end if;

  if (select count(*) from public.students where id = '00000000-0000-4000-8000-0000000000a2') <> 0 then
    raise exception 'RLS FAIL: owner can read foreign-tenant student';
  end if;
end
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000099', true);

do $$
begin
  if (select count(*) from public.students where id in (
    '00000000-0000-4000-8000-0000000000a1',
    '00000000-0000-4000-8000-0000000000a2'
  )) <> 0 then
    raise exception 'RLS FAIL: unaffiliated authenticated user can read students';
  end if;
end
$$;

rollback;
