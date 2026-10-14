# B02 — Bounded Candidate Auth fixture and promotion control

The PO delegates technical reviews to the assistant and retains functional and
production-promotion approval. No human code-review request is required.

## Candidate fixture protocol

`candidate-auth-bootstrap.ts` is a server-only fixture operation, not an arbitrary
Auth administration endpoint. A deployment-specific wrapper supplies a random
256-bit nonce hash, an exact Git SHA and a window of at most ten minutes. The
nonce/password remain in private execution scratch files and must never be
committed, logged or written in evidence. Gateway JWT verification stays enabled.

The handler validates the exact Candidate origin, method, configuration window,
nonce and a bounded password-only body before creating an admin client. Neither
email, phone, role, tenant nor action can be selected by the caller. The only
operation is official Auth Admin `createUser` for
`sf-gov-b02-diagnostic@auth.studioflow.invalid`, with confirmed email, synthetic
app metadata and no business-role/membership assignments. It does not call
signup, invite, recovery, email, messaging or payment APIs. Duplicate fixture
creation is rejected; it does not reset an existing account's password.

Before execution, inspect existing fixture accounts and the `auth.users` trigger.
Candidate's current trigger creates only a user_accounts row and a profile; no
role or tenant is assigned. Do not write Auth tables directly or enable anonymous
sign-in merely to make a test pass.

After creation, replace the function with a new permanently deny-only version,
preserving its history. Confirm both a nonce replay and a no-nonce request fail.
Then use the synthetic user's signed-in session for the diagnostic and negative
routes, never using the service-role key as proof of a user session. Check Auth
claims server-side and verify that no role/tenant membership was created. Revoke
the test session after completion. Retain the synthetic identity for audit;
no user deletion is required.

Local tests exercise the real handler: fixed fixture/confirmed email, no role,
wrong environments/userinfo, wrong/missing nonce, malformed/privileged payloads,
expired/future/oversized windows, post-parse expiry, non-POST and safe duplicate
errors. This preparation alone is not remote UAT.

## Promotion control proposal

The former one-human-code-review proposal is superseded and remains historical.
`b02-promotion-freeze-proposal.json` instead preserves existing main rules and
adds an **update restriction with zero bypass actors**, leaving approving-review
count unchanged. It blocks main updates/merges until a separately authorized
release window is opened by a repository administrator. It introduces no
production deployment and no routine code-review request to the PO.

This is a fail-closed containment proposal, not a completed release controller.
Do not claim it is applied without readback. Administrative write permission is
required; the current integration previously returned 403. The PO's separate
`Autorizo promoción` must remain bound to SHA/manifest/destination before any
release window, direct Vercel promotion or production database/Edge operation.
Protection of direct deployment paths must also be verified: main restrictions
alone cannot certify all production routes.
