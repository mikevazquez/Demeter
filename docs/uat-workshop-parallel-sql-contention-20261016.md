# Workshop capacity contention — Sandbox

**Date:** 2026-10-16 (Mexico) / 2026-10-17 (UTC)

**Environment:** Supabase Sandbox `hedouonyhynuvwbckdlg` only.

**Branch:** `design/workshop-payment-contract-20261016`

**PR:** #317 (Draft)

## Scope

Two independent SQL connector calls were dispatched together using
`Promise.allSettled`. Both targeted the same future workshop session,
which has a capacity of one. Distinct fixture students and request IDs
were used. The hold expiration was set to three minutes.

## Fixture

- Studio: `f76a76cb-d623-47eb-8bc1-9e74a2e7cdc7`
- Offer: `ce031122-3892-4e63-8b7b-78394f7a6094`
- Session: `ea9f5e96-080c-42cb-9b78-1d0f848fa1c9`
- Initial occupied seats: 0
- Session capacity: 1

## Observed results

### Round 1

- Student A succeeded.
- Hold: `729ac3c4-66e0-485d-b264-6ee94ab235a4`
- Student B received PostgreSQL `P0001: session_unavailable`.
- The successful hold was rejected using the existing close helper.

### Round 2 (reverse submission order)

- Student B succeeded.
- Hold: `764b711c-223f-436c-92fc-f4848a30dd92`
- Student A received PostgreSQL `P0001: session_unavailable`.
- The successful hold was rejected using the existing close helper.

## Final database check

- Active provisional holds: **0**
- Occupied seats: **0**
- Both successful test holds: **rejected**
- No sales or payments were created.

## Result and limitations

**PASS:** Independent connector-submitted requests produced one winner
and one capacity rejection in each round.

The connector does not expose transaction overlap or lock-wait timing.
This does **not** prove concurrent PostgreSQL lock contention and is
**not** the two-client authenticated HTTP test. That test remains pending.

The synthetic holds were cleaned up. Production was not touched.
PR #317 remains Draft and unmerged.
