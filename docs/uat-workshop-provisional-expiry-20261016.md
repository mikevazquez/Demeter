# UAT Sandbox — expired holds and safe race cleanup (2026-10-16)

Environment: Supabase Sandbox `hedouonyhynuvwbckdlg`; branch `design/workshop-payment-contract-20261016`. Production untouched.

## Verified this run

- `public.workshop_expire_provisional_holds(integer)` is executable by `service_role` and not by `anon` or `authenticated`.
- A reversible PL/pgSQL test created a synthetic provisional hold, made its expiration past, invoked the expiry processor with a simulated service JWT, and asserted that exactly one hold moved to `expired`. The outer subtransaction rolled back the test data.
- Post-check: 0 provisional holds, 6 workshop purchases, 83 payments, 326 reservations. No persisted synthetic test rows.
- The concurrency runner `scripts/uat/workshop-provisional-concurrency-sandbox.mjs` was hardened to attempt cleanup of **every** unexpected successful hold (not only exactly one winner) and to verify zero active provisional holds at completion.

## Not verified

- True two-connection race **not executed**: it needs a real staff JWT and independent Supabase clients for the approved Sandbox fixture. A single SQL connection cannot demonstrate concurrency.
- The expired-hold batch is installed but not scheduled: pg_cron is not installed in the currently queried database.
- No browser/Demi end-to-end validation and no Vitest/CI run of this branch.
- Do not deploy/promote to production without explicit authorization.
