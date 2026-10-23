# UAT Sandbox — pending-transfer review queue (2026-10-16)

Environment: Supabase Sandbox hedouonyhynuvwbckdlg. No production changes.

Executed a reversible SQL transaction with a simulated authenticated staff context holding sales.read and schedule.read. Created one provisional hold for the synthetic capacity-one workshop fixture. `admin_workshop_provisional_review_queue` returned an array containing that hold ID. After `private.workshop_close_provisional_hold(...,'reject',...)`, a repeated queue call no longer included the hold. The test deliberately rolled back all changes and returned without errors.

Post-run query: one historical rejected hold, zero active holds.

Vercel preview deployment `dpl_Gz5J9LX8wSNZanZNqT9pi6ktbnPs` for commit `66bde9eedcc670a51d402da1a06246dc78bba6c7` is READY. GitHub workflow runs for the commit: none.

This approves the SQL queue show/hide behavior under simulated staff context. It does **not** approve browser UAT, Vitest, concurrency across real independent HTTP clients, or Demi.
