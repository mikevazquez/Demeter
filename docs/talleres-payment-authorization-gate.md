# Workshop payment authorization gate — Sandbox

Status: replacement manual-review gate implemented and tested locally on 2026-10-15; not applied to Sandbox or Production and not connected to UI, portal or Demi. Provider verification remains pending.

## Reconciled Sandbox history — 2026-10-15

A read-only migration-history/catalog review found an existing private authorization table and `admin_confirm_workshop_payment` in Sandbox, applied as `20261014143639_workshop_trusted_admin_payment`. That implementation already requires sales/schedule permissions and active user/studio status, and already revokes both raw amount-taking confirmation RPCs from client roles. The earlier review of public workshop tables missed this private implementation; earlier statements that Sandbox had no workshop authorization gate were incomplete.

Six original workshop migrations are now versioned from their stored statements, including the base schema, integrity guards, v1 RPCs, explicit purchase mode and trusted-admin payment. Their actual history versions are preserved. The local v2 filename was corrected from `20261014064453` to the recorded `20261014064556`; its SQL is unchanged. No remote history was repaired or rewritten. `supabase/tests/fixtures/workshop-migration-history-20261015.json` records provenance and checksums.

The replacement migration retires both the public and private historical review entrypoints, preserves their private authorization records/purchase links, and rejects attempts to reuse a historical request ID or received-payment reference. It retains the existing sales/schedule and active-account/studio requirements. The historical and replacement paths must not be exposed concurrently. Drain existing checkout transactions before any future controlled application of the replacement; no remote application is authorized or performed by this reconciliation.

## Local implementation

`20261015120000_workshop_verified_manual_payment.sql` adds immutable authorizations for received cash and reviewed bank transfers. `admin_authorize_workshop_payment` requires an authenticated actor with `sales.write` and `schedule.write` in the target studio, active user/studio status, and an explicit received-funds attestation. The actor comes from `auth.uid()`. The function checks the student, offer, selection, database price, configured deposit, currency and active payment method before recording evidence. Cash needs a stable receipt identifier; transfers need a stable bank transaction reference. Reusing that reference in the same studio is rejected across checkout keys and against historical private authorizations.

`workshop_checkout_confirm_authorized` accepts only studio, authorization and checkout IDs. Its service-only entrypoint locks and consumes the authorization in the transaction that creates the sale, payment, purchase and reservations. It rechecks capacity, price and enrollment requirements. Failures preserve the unconsumed authorization and roll back financial/reservation writes; they do not refund received money automatically. A sold-out purchase with received funds requires staff reconciliation.

Both old amount-taking confirmation RPCs lose execution privileges for `service_role`, `authenticated` and `anon`. Existing synthetic-payment UAT scripts that call these legacy RPCs will require adaptation before reuse after this migration. The new gate is not applied remotely, so current remote permissions are unchanged.

Authorizations bind the exact offer, student, canonical session selection, purchase mode, quoted total, received amount and currency. Only the first consumption may update the record; evidence edits and deletions are rejected. Identical retries return the original receipt, even if later payments change the purchase balance. Policy snapshots are still taken when the purchase is created.

This manual-review path records an authorized staff member's attestation. It does not establish bank API verification, verify webhook signatures or make a receipt upload/OCR result authoritative. No service-only API for minting arbitrary payment authorizations was added. Required enrollment continues to fail closed until the real enrollment subsystem is connected.

## Local verification and remaining prerequisites

Run `npm run test:workshops:db` with Docker. The runner creates an ephemeral PostgreSQL 17 container with networking disabled and no published ports, reconstructs the module from all six historical migrations, compares its catalog to the metadata-only Sandbox snapshot, creates a local historical purchase, and applies the replacement. It then verifies historical evidence preservation, permissions, atomicity, idempotency and concurrency, and removes the container. CI includes the same command. It never accepts remote connection strings or uses remote business records.

No workshop tables or RPCs are mocked. Local replay matches the captured six tables, twelve indexes, seven functions, columns, constraints, RLS, policies and client grants before the replacement. The external host fixture still supplies reduced Auth, studio, student, Agenda and sales tables plus the repository capability join. This is not a replay of all Demeter migrations or verification of Supabase JWTs, PostgREST, financial triggers and SaaS entitlement rules. No UAT case is closed by these local checks.

Remaining release prerequisites: complete full-application migration/integration verification, validate against the full Sandbox schema after reactivation, connect a trusted admin/backend flow with tenant resolution, implement provider signature/order matching if online payments are added, and execute the 18 functional UAT cases. Current replay evidence is in `docs/talleres-schema-replay-evidence-20261015.json`; the earlier payment evidence remains a record of the previous local iteration.

## Existing payment source reviewed

The Sandbox database contains `assistant_transfer_purchase_intents` with `status`, `validated_at`, `reviewed_by`, `amount_minor`, `currency`, `studio_id`, `student_id` and `sale_id`. It also has `payments`. A receipt upload or OCR amount is **not** proof of confirmed funds. The transfer-intent flow was designed for another commercial product, so it must not be reused for workshops without extending its identity and purpose constraints.

## Required replacement for unsafe checkout parameters

The underlying Sandbox RPCs `workshop_checkout_confirm` and `workshop_checkout_confirm_v2` still take `p_confirmed_amount_minor` and `p_payment_method`, but their client execution privileges are already revoked by the historical trusted-admin migration. Preserve that restriction. They must never be re-exposed to Demi, students or an API that forwards unverified amounts.

Implement a dedicated immutable workshop payment authorization record (or equivalent existing verified provider event) with:

- `studio_id`, `offer_id`, `student_id`, `idempotency_key`, `amount_minor`, `currency`, `provider`, `provider_event_id`, `verified_at`, `verified_by`/provider signature verification, and `consumed_purchase_id`.
- Unique provider event per provider and studio; unique checkout consumption; RLS denied to untrusted roles.
- Provider webhook signature and amount/currency/order matching verified **server-side**; for bank transfers require explicit approved review with trusted actor, not receipt presence.
- In the same transaction, lock the authorization record, validate tenant/student/offer/amount, consume it once, create sale/payment/purchase/reservations, and return an idempotent result.
- Never treat payment method or amount from a browser, chat or model response as authoritative.
- Reject mismatched authorization, pending transfers, duplicate consumption, cross-tenant events and replay with changed parameters.

## Safety release gate

1. Remove or revoke execution of the old amount-taking RPC before connecting any public-facing route.
2. Add transactional tests for confirmed vs pending evidence, forged amount, cross-tenant access, replay and simultaneous buyers.
3. Keep 0/18 UAT formally approved until end-to-end evidence exists.

The local manual-review implementation covers part of this contract. It is not evidence of deployed payment verification or functional UAT acceptance.
