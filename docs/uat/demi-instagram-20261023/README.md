# Demi: Instagram signing key support

The existing Instagram receiver calls a service RPC which is absent in production.
Sandbox's RPC hardcoded its source studio, so copying it would reject production.
This migration allows trusted service callers to read the Instagram key explicitly
namespaced to the requested studio. PUBLIC, anon and authenticated cannot execute
it, even with a forged service claim. A missing service claim also fails closed.
There is no fallback to Messenger's signing key.

Base: `a7df0a20e4c536b4313f9dd5f15d5e67ca0a41e1`.
Branch: `codex/demi-instagram-production-20261023`.
Canonical definition and checkpoint: https://www.notion.so/402d78f7146381478eb7cd899a8afa10

## Verified

- Sandbox `hedouonyhynuvwbckdlg`: migration applied as `20261023132154`.
  Source file was generated earlier with CLI timestamp `20261023065724`;
  the apply-migration service assigned the recorded execution timestamp.
- SQL UAT: 13 assertions passed under actual database roles, including forged
  claims, missing claim, two distinct studio keys, null/missing studio and no
  Messenger fallback. Transaction rolled back; zero synthetic fixtures remain.
- Local: 34 tests across runtime configuration, multichannel contracts, audio and
  nine new HMAC cases passed. Targeted ESLint, TypeScript and diff checks passed.
- Actual Sandbox receiver: empty Instagram envelope signed using the saved IG key
  returned 200 with zero messages (request 196305); using the saved Messenger key
  returned 401 `invalid_signature` (196306). The body has no sender/messages and
  exits before runtime processing or outbound delivery. Keys stayed server-side.
  The deployed Sandbox receiver SHA was not independently resolved in this block;
  these probes attest to that URL plus the applied database migration.
- Saved account reads: profile 200 for `demeter_fitness_studio`, canonical user ID
  `17841468835993555`; subscribed_apps 200, app `17950277640294534`, `messages`.

## Still blocked

The account subscription does not expose the application's callback URL. Attempts
to administer the IG app using the saved IG ID/secret were rejected; later debugger
requests returned Facebook 400/code 2 and Instagram 403/code 10. These failures do
not invalidate the successful account-token reads. We have not proven which Meta
dashboard/application owns the current IG callback or whether the saved IG key
matches a real Meta-generated signature.

Available browser profiles have no recorded Meta login. A secure administrator
session in Meta is needed to inspect Instagram Login's configured callback,
application identity and subscriptions. Do not request passwords/tokens in chat.
Do not replace Page/WABA subscriptions or reuse their keys as an IG workaround.

Production was inspected read-only: Messenger configured; Instagram account/key
and getter absent. No production migration, secret, callback, deployment, budget
or business rule changed. No real Instagram message/response has been verified.
Instagram is **not approved or activated**. DEMI-PILOT-01 remains blocked.

## Next steps and production gate

1. Inspect the owning app's Instagram Login webhook settings with secure Meta
   admin access; record current callback and full subscription backup without keys.
2. Identify/validate the IG signing secret and production destination. Prepare the
   minimal configuration merge preserving Messenger fields and all Page/WABA data.
3. Obtain explicit production authorization for this migration and IG activation
   under Governance 2.0. The earlier Demi release/Messenger authorization does not
   itself approve a new Instagram production scope.
4. Apply the approved migration/config, verify health/HMAC failures and callback
   verification, then observe an externally initiated Instagram message, Demi's
   response and Meta delivery acceptance. Human visible receipt stays pending
   until confirmed. Preserve audit records; do not make purchases/reservations.

The getter is internal and requires no visual/business UAT by itself. Activating
the channel still requires external end-to-end verification and visible receipt.

## Rollback

Production has no getter before this change. If only the migration were promoted,
rollback is `drop function public.service_get_meta_instagram_app_secret(uuid);`.
If configuration/callback is later changed, restore only the backed-up Instagram
fields/callback/key record as identified before activation, preserving Messenger,
WhatsApp and audit data. No production rollback was executed.

Sandbox's previous definition and ACL, captured before the migration:

```sql
create or replace function public.service_get_meta_instagram_app_secret(target_studio_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare v_secret text;
begin
  if (select auth.role()) <> 'service_role'
     or target_studio_id <> '9fe23cfa-fb47-4670-afeb-ed4a56433772'::uuid
  then raise exception 'forbidden'; end if;
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s
  where s.name = 'meta_instagram_app_secret:' || target_studio_id::text limit 1;
  return v_secret;
end;
$function$;
revoke all on function public.service_get_meta_instagram_app_secret(uuid) from public, anon, authenticated;
grant execute on function public.service_get_meta_instagram_app_secret(uuid) to service_role;
```

Rollback of the old Sandbox function would also restore its historical nullable
claim guard; that behavior is intentionally fixed by the candidate migration.
Admin setter and Preview-only setup/diagnostic actions are unchanged in this PR.
Machine-readable redacted results and artifact hashes are in `evidence.json`.
