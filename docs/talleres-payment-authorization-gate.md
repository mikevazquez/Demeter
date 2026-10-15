# Workshop payment authorization gate — Sandbox

Status: manual-review gate implemented and tested locally on 2026-10-15; not applied to Sandbox or Production and not connected to UI, portal or Demi. Provider verification remains pending.

## Local implementation

`20261015120000_workshop_verified_manual_payment.sql` adds immutable authorizations for received cash and reviewed bank transfers. `admin_authorize_workshop_payment` requires an authenticated actor with `sales.write` in the target studio and an explicit received-funds attestation. The actor comes from `auth.uid()`. The function checks the student, offer, selection, database price, configured deposit, currency and active payment method before recording evidence. Cash needs a stable receipt identifier; transfers need a stable bank transaction reference. Reusing that reference in the same studio is rejected across checkout keys.

`workshop_checkout_confirm_authorized` accepts only studio, authorization and checkout IDs. Its service-only entrypoint locks and consumes the authorization in the transaction that creates the sale, payment, purchase and reservations. It rechecks capacity, price and enrollment requirements. Failures preserve the unconsumed authorization and roll back financial/reservation writes; they do not refund received money automatically. A sold-out purchase with received funds requires staff reconciliation.

Both old amount-taking confirmation RPCs lose execution privileges for `service_role`, `authenticated` and `anon`. Existing synthetic-payment UAT scripts that call these legacy RPCs will require adaptation before reuse after this migration. The new gate is not applied remotely, so current remote permissions are unchanged.

Authorizations bind the exact offer, student, canonical session selection, purchase mode, quoted total, received amount and currency. Only the first consumption may update the record; evidence edits and deletions are rejected. Identical retries return the original receipt, even if later payments change the purchase balance. Policy snapshots are still taken when the purchase is created.

This manual-review path records an authorized staff member's attestation. It does not establish bank API verification, verify webhook signatures or make a receipt upload/OCR result authoritative. No service-only API for minting arbitrary payment authorizations was added. Required enrollment continues to fail closed until the real enrollment subsystem is connected.

## Local verification and remaining prerequisites

Run `npm run test:workshops:db` with Docker. The runner creates an ephemeral PostgreSQL 17 container with networking disabled and no published ports, applies the actual v2 and new gate migrations over explicit reduced host fixtures, runs permission, atomicity, idempotency and concurrency scenarios, and removes the container. CI includes the same command. It never accepts remote connection strings or uses Sandbox fixtures.

The fixture includes catalog definitions of the legacy workshop RPCs, read from Sandbox on 2026-10-15. It supplies reduced host tables and the repository capability join; it does not replay all Demeter migrations, Supabase JWT verification, PostgREST, financial triggers or SaaS entitlement rules. The pre-existing workshop base schema is still absent from versioned migrations and must be reconciled before a clean deployment/replay. No UAT case is closed by these local checks.

Remaining release prerequisites: reconcile the base schema and complete migration replay, validate against the full Sandbox schema after reactivation, connect a trusted admin/backend flow with tenant resolution, implement provider signature/order matching if online payments are added, and execute the 18 functional UAT cases.

## Existing payment source reviewed

The Sandbox database contains `assistant_transfer_purchase_intents` with `status`, `validated_at`, `reviewed_by`, `amount_minor`, `currency`, `studio_id`, `student_id` and `sale_id`. It also has `payments`. A receipt upload or OCR amount is **not** proof of confirmed funds. The transfer-intent flow was designed for another commercial product, so it must not be reused for workshops without extending its identity and purpose constraints.

## Required replacement for unsafe checkout parameters

The current, unchanged Sandbox RPCs `workshop_checkout_confirm` and `workshop_checkout_confirm_v2` take caller-supplied `p_confirmed_amount_minor` and `p_payment_method`. They must **not** be exposed to Demi, students or a client-accessible API. A server using `service_role` must not pass unverified values to them.

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
