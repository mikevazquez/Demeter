import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const file = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("phone uniqueness by studio and role", () => {
  const migration = file("supabase/migrations/20261008124500_phone_unique_per_role.sql");
  const hardening = file("supabase/migrations/20261008125500_phone_role_policy_hardening.sql");
  const actions = file("app/admin/instructores/actions.ts");
  const list = file("app/admin/instructores/page.tsx");
  const profile = file("app/admin/instructores/[instructorId]/page.tsx");
  const notifications = file("supabase/functions/notification-engine-worker/index.ts");

  it("uniquely identifies phone within a role and studio, not across roles", () => {
    expect(migration).toContain("person_contacts_phone_unique_per_role");
    expect(migration).toContain("studio_id,phone_role,private.phone_identity_key(value)");
    expect(migration).toContain("where kind='phone'");
    expect(migration).toContain("person_contacts_email_unique_per_studio");
    expect(migration).toContain("students_studio_phone_identity_unique");
  });

  it("does not merge existing student and instructor identities", () => {
    expect(migration).toContain("update public.person_contacts pc set phone_role='coach'");
    expect(migration).toContain("not exists (select 1 from public.students s");
    expect(migration).not.toMatch(/update public.students\s+set\s+person_id/i);
  });

  it("stores and edits coach phones under the coach role only", () => {
    expect(migration).toContain("true,'coach'");
    expect(migration).toContain("phone_role='coach'");
    expect(migration).toContain("and phone_role='coach'");
    expect(list).toContain('item.phone_role === "coach"');
    expect(profile).toContain('item.phone_role === "coach"');
    expect(notifications).toContain('contact.phone_role === "coach"');
  });

  it("preserves student-only identity resolution for inbound WhatsApp", () => {
    expect(migration).toContain("and pc.phone_role='student'");
    expect(migration).toContain("pc.kind = 'phone' and pc.phone_role='student'");
  });

  it("prevents student staff from editing coach phone contacts", () => {
    expect(hardening).toContain("phone_role='student'");
    expect(hardening).toContain("person_contacts_student_staff_write");
    expect(migration).toContain("person_contacts_coach_phone_write");
    expect(migration).toContain("private.has_capability(studio_id,'instructors.write')");
  });

  it("explains duplicate coach phones without leaking a phone number", () => {
    expect(actions).toContain('error.code === "23505" ? "phone_in_use"');
    expect(profile).toContain("otro coach");
  });
});
