import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ASISTIAN-SYNC-01 student contact synchronization", () => {
  const migration = source(
    "supabase/migrations/20260924181500_asistian_sync01_student_contact.sql",
  );
  const processor = source("supabase/functions/process-student-created/index.ts");
  const shared = source("supabase/functions/_shared/asistian-messaging.ts");
  const provisioning = source("supabase/functions/provision-student-access/index.ts");

  it("emits one idempotent student.created event for every new student row", () => {
    expect(migration).toContain("create trigger asistian_sync01_emit_student_created");
    expect(migration).toContain("after insert on public.students");
    expect(migration).toContain("p_event_type => 'student.created'");
    expect(migration).toContain("p_deduplication_key => 'student.created:' || new.id::text");
    expect(migration).toContain("'source', 'students.insert'");
    expect(migration).not.toContain("request_student_contact_sync(v_student_id)");
  });

  it("covers admin, walk-in, and integration-created students through one database trigger", () => {
    expect(migration).toContain("after insert on public.students");
    expect(migration).toContain("execute function private.emit_student_created_domain_event()");
    expect(migration).toContain("drop function if exists private.request_student_contact_sync(uuid)");
  });

  it("dispatches contact sync asynchronously without coupling student creation to Asistian", () => {
    expect(migration).toContain("net.http_post(");
    expect(migration).toContain("'/functions/v1/process-student-created'");
    expect(migration).toContain("after insert on public.domain_events");
    expect(migration).toContain("when (new.event_type = 'student.created')");
    expect(migration).toContain("asistian-sync01-retry-student-contact");
    expect(migration).toContain("*/5 * * * *");
  });

  it("uses contact upsert as a separate integration event", () => {
    expect(shared).toContain('"student_contact_upsert"');
    expect(processor).toContain('template: "student_contact_upsert"');
    expect(processor).toContain('operation: "upsert_contact"');
    expect(processor).toContain(
      'const CONSUMER_KEY = "integration.asistian.student-contact-upsert"',
    );
    expect(processor).not.toContain('template: "student_welcome"');
  });

  it("sends the canonical student identity needed for an Asistian upsert", () => {
    for (const variable of [
      "student_id",
      "nombre",
      "first_name",
      "last_name",
      "phone",
      "email",
      "student_type",
      "lifecycle_status",
      "active",
    ]) {
      expect(processor).toContain(variable);
    }
  });

  it("keeps the existing welcome flow tied to portal activation", () => {
    expect(provisioning).toContain('template: "student_welcome"');
    expect(provisioning).toContain("activation_url: activationLink");
    expect(processor).not.toContain("activation_url");
  });

  it("only marks the domain event consumed after Asistian accepts the contact upsert", () => {
    const acceptedMarker = processor.indexOf('if (delivery.status !== "accepted")');
    const claimMarker = processor.indexOf('"claim_domain_event"');

    expect(acceptedMarker).toBeGreaterThan(-1);
    expect(claimMarker).toBeGreaterThan(acceptedMarker);
  });
});
