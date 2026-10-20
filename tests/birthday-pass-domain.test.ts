import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261020021000_birthday_passes.sql"),
  "utf8",
);

describe("Cumpleaños Demeter · birthday pass domain contract", () => {
  it("creates exactly one pass per student and birthday year", () => {
    expect(migration).toContain("create table if not exists public.birthday_passes");
    expect(migration).toContain("unique (studio_id, student_id, birthday_year)");
    expect(migration).toContain("status in ('available','used')");
  });

  it("keeps birthday passes separate from packages and credits", () => {
    expect(migration).toContain("birthday_pass_id uuid null references public.birthday_passes");
    expect(migration).toContain("'reserved', 0, v_pass.id");
    expect(migration).not.toContain("insert into public.credit_ledger");
  });

  it("supports self use and transfer to a friend without double-consuming the pass", () => {
    expect(migration).toContain("target_for not in ('self','friend')");
    expect(migration).toContain("birthday_pass_already_used");
    expect(migration).toContain("reservations_birthday_pass_unique_idx");
    expect(migration).toContain("recipient_kind='friend'");
    expect(migration).toContain("recipient_kind='self'");
  });

  it("allows a birthday-sponsored guest reservation without inventing a package", () => {
    expect(migration).toContain("guest_person_id is null");
    expect(migration).toContain("or birthday_pass_id is not null");
    expect(migration).toContain("guest_person_id,");
    expect(migration).toContain("birthday_pass_id");
  });

  it("limits public RPCs to signed-in callers and keeps private helpers private", () => {
    expect(migration).toContain(
      "revoke all on function private.student_birth_date(uuid) from public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.student_birthday_pass_snapshot() from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.student_birthday_pass_snapshot() to authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.student_book_with_birthday_pass(uuid,text,text,text) to authenticated",
    );
  });

  it("enforces the birthday month and the pass validity window", () => {
    expect(migration).toContain("birthday_pass_not_in_month");
    expect(migration).toContain("birthday_pass_outside_validity");
    expect(migration).toContain("v_session_date < v_pass.period_start");
    expect(migration).toContain("v_session_date > v_pass.expires_on");
  });
});
