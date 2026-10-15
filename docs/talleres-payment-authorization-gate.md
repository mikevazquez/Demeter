# Workshop payment authorization gate — Sandbox

Status: design guardrail; not wired to checkout. Production remains untouched.

## Existing payment source reviewed

The Sandbox database contains `assistant_transfer_purchase_intents` with `status`, `validated_at`, `reviewed_by`, `amount_minor`, `currency`, `studio_id`, `student_id` and `sale_id`. It also has `payments`. A receipt upload or OCR amount is **not** proof of confirmed funds. The transfer-intent flow was designed for another commercial product, so it must not be reused for workshops without extending its identity and purpose constraints.

## Required replacement for unsafe checkout parameters

The current Sandbox RPC `workshop_checkout_confirm` takes caller-supplied `p_confirmed_amount_minor` and `p_payment_method`. It must **not** be exposed to Demi, students or a client-accessible API. A server using `service_role` must not pass unverified values to it.

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

This document is not evidence that payment verification is implemented.
