import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260917031000_f15_online_checkout_model.sql",
  "utf8",
);
const aclHardening = readFileSync(
  "supabase/migrations/20260917032000_f15_online_checkout_acl_hardening.sql",
  "utf8",
);

describe("F15 online checkout model", () => {
  it("keeps checkout attempts separate from commercial activation", () => {
    expect(migration).toContain("create table public.online_checkout_attempts");
    expect(migration).not.toContain("insert into public.sales");
    expect(migration).not.toContain("insert into public.payments");
    expect(migration).not.toContain("insert into public.product_acquisitions");
    expect(migration).not.toContain("insert into public.credit_ledger");
  });

  it("freezes server-owned product and price data", () => {
    expect(migration).toContain("pt.studio_id = v_student.studio_id");
    expect(migration).toContain("pt.active = true");
    expect(migration).toContain("pt.online_purchasable = true");
    expect(migration).toContain("v_product.price_minor");
    expect(migration).not.toContain("target_amount_minor");
    expect(migration).not.toContain("target_student_id");
  });

  it("resolves the student from auth and makes request creation idempotent", () => {
    expect(migration).toContain("s.user_id = (select auth.uid())");
    expect(migration).toContain("private.is_current_student(s.id, s.studio_id)");
    expect(migration).toContain("unique (student_id, client_request_key)");
    expect(migration).toContain("on conflict (student_id, client_request_key) do nothing");
    expect(migration).toContain("request_key_reused_for_different_product");
  });

  it("reserves unique provider identifiers for later webhook idempotency", () => {
    expect(migration).toContain("unique (external_reference)");
    expect(migration).toContain("online_checkout_attempts_preference_unique");
    expect(migration).toContain("online_checkout_attempts_payment_unique");
    expect(migration).toContain("'STFLOW-MP-' || v_attempt_id::text");
  });

  it("blocks anonymous and direct authenticated mutation", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain(
      "revoke insert, update, delete on public.online_checkout_attempts from public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.student_create_online_checkout_attempt(uuid, uuid)",
    );
    expect(migration).toContain("from public, anon");
    expect(migration).toContain("to authenticated");
    expect(aclHardening).toContain(
      "revoke all on public.online_checkout_attempts from public, anon, authenticated",
    );
    expect(aclHardening).toContain(
      "grant select on public.online_checkout_attempts to authenticated",
    );
  });

  it("uses one scoped read policy for students and authorized staff", () => {
    expect(aclHardening).toContain("create policy online_checkout_attempts_scoped_read");
    expect(aclHardening).toContain("private.is_current_student(student_id, studio_id)");
    expect(aclHardening).toContain("private.has_capability(studio_id, 'sales.read')");
  });
});
