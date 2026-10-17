# Workshop seat contention — independent connector SQL requests — Sandbox

- Date: 2026-10-16 (Mexico) / 2026-10-17 UTC
- Environment: Supabase Sandbox `hedouonyhynuvwbckdlg` only
- Branch: `design/workshop-payment-contract-20261016`
- Pull request: #317 (Draft)

## Scope

- Two independent SQL connector calls submitted using `Promise.allSettled`
- Same future workshop session, capacity 1
- Two distinct students, unique request IDs and transfer references
- Three-minute expiry on synthetic holds

## Fixture

- Studio: `f76a76cb-d623-47eb-8bc1-9e74a2e7cdc7`
- Offer: `ce031122-3892-4e63-8b7b-78394f7a6094`
- Session: `ea9f5e96-080c-42cb-9b78-1d0f848fa1c9`
- Initial occupied seats: 0

## Round 1

- A: created hold `729ac3c4-66e0-485d-b264-6ee94ab235a4`
- B: PostgreSQL `P0001: session_unavailable`
- Cleanup: winner rejected using the private close helper

## Round 2

- B: created hold `764b711c-223f-436c-92fc-f4848a30dd92`
- A: PostgreSQL `P0001: session_unavailable`
- Cleanup: winner rejected using the private close helper

## Results

- One winner and one capacity rejection in each round: PASS
- Final active provisional holds: 0
- Final occupied seats: 0
- Both test winners rejected
- No sale or payment created
- Production untouched; PR not merged

## Evidence limitations

- The connector submitted independent requests.
- SQL transaction overlap and precise timing were not observable.
- This does not prove overlapping database lock waits.
- Signed staff-JWT HTTP concurrency UAT remains pending.
- Do not equate this test with the two-client PostgREST runner.
