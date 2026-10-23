-- Sandbox only. Run as postgres; synthetic Vault fixtures and all settings roll back.
-- No messages, account tokens, purchases, reservations, or real signing keys.
begin;

select set_config('demi_ig_uat.studio_a', gen_random_uuid()::text, true),
       set_config('demi_ig_uat.studio_b', gen_random_uuid()::text, true),
       set_config('demi_ig_uat.studio_c', gen_random_uuid()::text, true),
       set_config('demi_ig_uat.missing', gen_random_uuid()::text, true);

do $fixtures$
begin
  perform vault.create_secret('synthetic-instagram-signing-key-A',
    'meta_instagram_app_secret:' || current_setting('demi_ig_uat.studio_a'), 'Demi IG rollback UAT');
  perform vault.create_secret('synthetic-instagram-signing-key-C',
    'meta_instagram_app_secret:' || current_setting('demi_ig_uat.studio_c'), 'Demi IG rollback UAT');
  perform vault.create_secret('{"app_secret":"synthetic-messenger-key-never-used-for-instagram"}',
    'meta_inbox_connection:' || current_setting('demi_ig_uat.studio_b'), 'Demi IG rollback UAT');
end;
$fixtures$;

do $acl$
begin
  -- 01: PUBLIC cannot invoke the function, including a future role.
  if exists (
    select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.service_get_meta_instagram_app_secret(uuid)'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then raise exception '01 PUBLIC execute exposed'; end if;
  -- 02-04: role permissions, including inherited privileges.
  if has_function_privilege('anon', 'public.service_get_meta_instagram_app_secret(uuid)', 'execute')
    then raise exception '02 anon execute exposed'; end if;
  if has_function_privilege('authenticated', 'public.service_get_meta_instagram_app_secret(uuid)', 'execute')
    then raise exception '03 authenticated execute exposed'; end if;
  if not has_function_privilege('service_role', 'public.service_get_meta_instagram_app_secret(uuid)', 'execute')
    then raise exception '04 service_role execute missing'; end if;
end;
$acl$;

select set_config('request.jwt.claim.role', '', true), set_config('request.jwt.claims', '{}', true);
do $owner_guard$
begin
  -- 05: owner privileges must not bypass an absent service JWT claim.
  begin
    perform public.service_get_meta_instagram_app_secret(current_setting('demi_ig_uat.studio_a')::uuid);
    raise exception '05 missing JWT accepted';
  exception when insufficient_privilege then null;
  end;
end;
$owner_guard$;

-- A forged service_role claim cannot bypass the database role ACL.
select set_config('request.jwt.claim.role', 'service_role', true),
       set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role anon;
do $anon_guard$
begin
  begin
    perform public.service_get_meta_instagram_app_secret(current_setting('demi_ig_uat.studio_a')::uuid);
    raise exception '06 anon forged claim accepted';
  exception when insufficient_privilege then null;
  end;
end;
$anon_guard$;
reset role;
set local role authenticated;
do $authenticated_guard$
begin
  begin
    perform public.service_get_meta_instagram_app_secret(current_setting('demi_ig_uat.studio_a')::uuid);
    raise exception '07 authenticated forged claim accepted';
  exception when insufficient_privilege then null;
  end;
end;
$authenticated_guard$;
reset role;

select set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role service_role;
do $service_claim_guard$
begin
  begin
    perform public.service_get_meta_instagram_app_secret(current_setting('demi_ig_uat.studio_a')::uuid);
    raise exception '08 non-service JWT accepted';
  exception when insufficient_privilege then null;
  end;
end;
$service_claim_guard$;
reset role;

select set_config('request.jwt.claim.role', 'service_role', true),
       set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $studio_scope$
begin
  if public.service_get_meta_instagram_app_secret(current_setting('demi_ig_uat.studio_a')::uuid)
      is distinct from 'synthetic-instagram-signing-key-A'
    then raise exception '09 studio A secret mismatch'; end if;
  if public.service_get_meta_instagram_app_secret(current_setting('demi_ig_uat.studio_c')::uuid)
      is distinct from 'synthetic-instagram-signing-key-C'
    then raise exception '10 studio C secret mismatch'; end if;
  if public.service_get_meta_instagram_app_secret(current_setting('demi_ig_uat.studio_b')::uuid) is not null
    then raise exception '11 Messenger fallback exposed'; end if;
  if public.service_get_meta_instagram_app_secret(null) is not null
    then raise exception '12 null studio exposed a secret'; end if;
  if public.service_get_meta_instagram_app_secret(current_setting('demi_ig_uat.missing')::uuid) is not null
    then raise exception '13 missing studio exposed a secret'; end if;
end;
$studio_scope$;
reset role;

select 'PASS' as result, 13 as assertions, 'synthetic fixtures; transaction rolled back' as scope;
rollback;
