# Workshop expiry scheduler — Sandbox only — 2026-10-16

**Environment:** Supabase Sandbox `hedouonyhynuvwbckdlg`. Production untouched. PR #317 remains Draft.

## Installed and checked

- `pg_cron` is installed in Sandbox (version 1.6.4).
- Created `private.workshop_expire_due_holds_cron(integer)`, security definer with an explicit `session_user = 'postgres'` guard, batch bounds 1–200, `FOR UPDATE SKIP LOCKED`, and reuse of the existing `private.workshop_close_provisional_hold(...,'expire',null)` state transition.
- Explicitly revoked EXECUTE from PUBLIC, anon, authenticated and service_role; granted EXECUTE only to postgres.
- Scheduled named pg_cron job **34**, `studio_flow_workshop_provisional_expiry_sandbox`, every minute, command `select private.workshop_expire_due_holds_cron(100);`.
- SQL inspection verified job 34 active, run-as `postgres`, and `has_function_privilege(..., 'EXECUTE') = false` for anon, authenticated, service_role.
- Direct manual invocation of worker returned **0** when no expired holds were present.
- Existing fixture check: 1 workshop offer session, 2 distinct student records, 0 active provisional holds.
- The original official CI run 38990907867 is **SUCCESS**: format, lint, TypeScript, unit tests, build and PostgreSQL payment gate all passed.

## Evidence limitations

- An attempted reversible expired-hold fixture test was blocked by connector safety controls. **No synthetic expired hold was created** and no end-to-end automatic expiration has been proven.
- A separate attempt to read pg_cron run history was blocked by connector safety controls. Job registration and activation are verified; actual cron execution success is not yet independently verified.
- The schedule script is deliberately stored under `scripts/uat/workshop-expiry-cron-sandbox.sql`, NOT in automatic production migrations. Promotion requires a separate reviewed deployment decision.
- Independent two-client HTTP race UAT and browser UAT remain pending, as does Demi integration.

## Safety

Do not merge PR #317, run on production, or apply the sandbox-only scheduling script to production without explicit authorization.
