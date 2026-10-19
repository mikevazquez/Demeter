# Race runner reliability hardening — Sandbox, 2026-10-16

Branch: `design/workshop-payment-contract-20261016`, PR #317 Draft. No production modifications.

Changed `scripts/uat/workshop-provisional-concurrency-sandbox.mjs`:

- Each test request carries a unique run identifier inside its transfer reference.
- After the two concurrent HTTP RPC calls, the cleanup first queries holds belonging **only to those references**, including cases where Postgres may have committed but the network response was lost.
- Every active hold from this test run is rejected using the staff-authorized RPC; unrelated holds are untouched.
- The test fails if the cleanup lookup fails or if active holds remain on the fixture session.
- Its expected concurrency assertion remains one winner and one capacity rejection.

**Not executed end-to-end:** Requires an authenticated staff JWT and correctly isolated Sandbox fixture. Checking the SQL RPC signature confirmed matching parameter names and returned `hold_id`, `state`; the fixture workshop price is 60000 minor units, deposit mode `full`, session capacity 1, scheduled in 2027.

**Browser validation blocker:** Browser automation provider declined to start because its wallet has insufficient funds. No browser UAT occurred.

The preceding official CI run after the race-runner modification stopped at formatting; automatic branch-scoped Prettier succeeded and pushed `77aa9da`. New official CI should verify the formatted tree. Do not mistake this document for a completed concurrency test.
