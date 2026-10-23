# UAT Sandbox: workshop remaining-seats visibility

Executed 2026-10-16 on Supabase Sandbox `hedouonyhynuvwbckdlg`, not production.

A single reversible SQL transaction simulated an authorized staff JWT with sales.read and schedule.read. The fixture session had capacity one and no active confirmed/provisional seats.

Verified via `private.admin_workshop_context(studio_id,offer_id)`:

1. Initial `capacityRemaining` was **1**.
2. Created a provisional hold for that session; `capacityRemaining` became **0**.
3. Rejected the hold; `capacityRemaining` returned to **1**.
4. Rolled back the test fixture by a deliberate exception consumed in a PL/pgSQL subtransaction. The SQL tool returned `[]` with no errors.

This verifies the database-side data supplied to the admin UI. It does **not** verify the rendered browser UI, nor concurrent HTTP requests. Browser UAT, parallel-client concurrency, Demi integration, and expiry scheduling are pending.

The `admin_workshop_context` body in Sandbox was previously updated to use `private.workshop_capacity_seats_taken` so provisional seats count. GitHub migration `20261016234000_workshop_context_includes_provisional.sql` records it.

Do not merge PR #317 or promote without the required approvals; PR #284 remains parallel.
