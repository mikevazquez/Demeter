# Workshop seat contention — independent connector SQL requests — Sandbox

Date: 2026-10-16 (Mexico) / 2026-10-17 UTC
Environment: Supabase Sandbox `hedouonyhynuvwbckdlg` only.
Branch: `design/workshop-payment-contract-20261016`, PR #317 Draft.

## Scope
Test two independent Supabase SQL tool calls submitted via `Promise.allSettled` for the same future workshop session, capacity 1. The calls use the existing private capacity-locking helper and two distinct fixture students. Each round uses unique request and transfer references, with a 3-minute expiry.

Fixture:
- Studio `f76a76cb-d623-47eb-8bc1-9e74a2e7cdc7`
- Offer `ce031122-3892-4e63-8b7b-78394f7a6094`
- Session `ea9f5e96-080c-42cb-9b78-1d0f848fa1c9` (scheduled, capacity 1, seats_taken 0 at start)

## Observed results
**Round 1**, student A and B requests submitted together:
- A: successful hold `729ac3c4-66e0-485d-b264-6ee94ab235a4`.
- B: PostgreSQL `P0001: session_unavailable`.
- Winner rejected via `private.workshop_close_provisional_hold(...,'reject',...)` after the test.

**Round 2**, reversed submission order:
- B: successful hold `764b711c-223f-436c-92fc-f4848a30dd92`.
- A: PostgreSQL `P0001: session_unavailable`.
- Winner rejected via the same helper.

Post-test read: 0 active provisional holds, 0 occupied seats, both test winners have state `rejected`.

**Result: PASS for independent connector-submitted capacity contention**, 1 successful hold and 1 capacity rejection in each of two rounds. No sale or payment was created.

## Evidence boundaries
The connector can dispatch two tool requests concurrently, but does not expose SQL transaction overlap or precise request timing. This is **not** proof of lock contention with simultaneously overlapping transactions and is **not** the authenticated staff JWT + two HTTP PostgREST client test in `scripts/uat/workshop-provisional-concurrency-sandbox.mjs`. That full race UAT remains pending. Do not conflate these levels of evidence.

Only Sandbox fixture audit holds were created and then rejected. Production untouched, PR unmerged.
