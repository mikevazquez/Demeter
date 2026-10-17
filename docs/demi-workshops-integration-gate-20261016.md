# Demi × Talleres — Integration gate (Sandbox only)

Status: backend design in progress; NOT integrated or UAT-approved.

## Confirmed existing building blocks
- public.admin_create_workshop_provisional_hold(studio,offer,student,sessions,selection_mode,request_id,transfer_reference,amount,expiry): atomic provisional seats, no confirmed payment.
- public.admin_confirm_workshop_provisional_hold(studio,hold,true): staff-authenticated and sales.write/schedule.write; atomic verified checkout; idempotent replay.
- public.admin_reject_workshop_provisional_hold(studio,hold,reason): staff-authenticated; releases provisional seats.
- private.workshop_expire_due_holds_cron: Sandbox expiry scheduler.
- public.demi_receipt_review_notices and service_claim_demi_receipt_review_notices: existing WhatsApp delivery queue, source_kind constrained to enrollment/transfer and decision to approved/rejected.
- private.queue_demi_receipt_review_notice trigger currently handles enrollment/group receipts, not workshop holds.

## Important boundary
Do not add a direct unauthenticated WhatsApp/assistant caller to staff approval RPC. Service-side provisional hold creation requires a separate authenticated, tenant-scoped, idempotent contract; do not impersonate an administrator or accept client-supplied paid=true.

## Remaining implementation (single integration block)
1. Discover existing WhatsApp ingress, assistant tool router and delivery worker paths, and their service-role identity/authorization model.
2. Introduce a workshop-specific conversation-to-hold binding with studio-scoped FK and idempotency; avoid assuming student/conversation identity from phone text.
3. Add a safe service-facing provisional hold entrypoint that validates the authenticated conversation, student, workshop quote, receipt and amount server-side.
4. Add workshop-specific decision/expiry notices to existing deduplicated delivery queue, without changing existing enrollment/transfer notifications or falsely claiming verified payment.
5. Wire Demi's FAQ/selection/receipt handlers to the new entrypoint and review queue.
6. UAT: duplicate webhook, receipt replay, last seat, rejected/expired hold, staff approval, no payment on receipt, notification delivery once, unknown outcome, cross-tenant access and ordinary bookings.
7. Keep PR #317 Draft, CI green, Sandbox only. No merge or production without explicit authorization.

## Evidence limitations
The current repository PR #317 changes no WhatsApp/assistant ingress files. Database review proves workshop holds and existing Demi notices are separate. The integration is therefore not yet complete. No end-to-end Demi/WhatsApp test has been executed.
