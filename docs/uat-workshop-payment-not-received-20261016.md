# Sandbox UAT: unverified-payment gate — 2026-10-16

Environment: Supabase Sandbox `hedouonyhynuvwbckdlg` only.

**Verified:** `workshop_provisional_holds` contained one historical rejected hold and no active provisional holds.

**Verified negative authorization test:** Within SQL a simulated authenticated staff context was selected from active users having both `sales.write` and `schedule.write` in the Sandbox studio. Calling `public.admin_confirm_workshop_provisional_hold` with `p_received=false` produced exactly `payment_not_verified` as expected. The invalid hold UUID was only a sentinel: validation of `p_received` precedes hold lookup. This test verifies the payment flag gate, **not** the full active-hold workflow.

**Earlier rollback test:** An attempted approval with unverified payment did not increase `payments`; the test rolled back its synthetic hold. The earlier check accepted either `forbidden` or `payment_not_verified`, so the stronger exact-error test above is the authoritative negative assertion.

**Pending:** race with two independently authenticated concurrent requests; authenticated browser UAT; Demi integration; periodic scheduling of expiry; complete regression UAT. Never promote to production without explicit authorization.
