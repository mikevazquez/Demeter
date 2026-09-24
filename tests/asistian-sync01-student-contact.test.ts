import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ASISTIAN-SYNC-01 student contact synchronization", () => {
  const bootstrapMigration = source(
    "supabase/migrations/20260924181500_asistian_sync01_student_contact.sql",
  );
  const universalMigration = source(
    "supabase/migrations/20260924183500_asistian_sync01_universal_student_created.sql",
  );
  const processor = source("supabase/functions/process-student-created/index.ts");
  const shared = source("supabase/functions/_shared/asistian-messaging.ts");
  const provisioning = source("supabase/functions/provision-student-access/index.ts");

  it("emits student.created from the canonical students table for every creation path", () => {
    expect(universalMigration).toContain(
      "create trigger asistian_sync01_emit_student_created",
    );
    expect(universalMigration).toContain("after insert on public.students");
    expect(universalMigration).toContain(
      "execute function private.emit_student_created_event()",
    );
    expect(universalMigration).toContain("p_event_type => 'student.created'");
    expect(universalMigration).toContain(
      "p_deduplication_key => 'student.created:' || new.id::text",
    );
    expect(universalMigration).toContain("'source', 'student_record_insert'");
  });

  it("removes the admin-specific event hook so there is only one canonical event source", () => {
    expect(universalMigration).not.toContain(
      "perform private.request_student_contact_sync(v_student_id)",
    );
    expect(universalMigration).toContain(
      "drop function if exists private.request_student_contact_sync(uuid)",
    );
  });

  it("dispatches contact sync asynchronously without coupling student creation to Asistian", () => {
    expect(bootstrapMigration).toContain("net.http_post(");
    expect(bootstrapMigration).toContain("'/functions/v1/process-student-created'");
    expect(bootstrapMigration).toContain("after insert on public.domain_events");
    expect(bootstrapMigration).toContain("when (new.event_type = 'student.created')");
    expect(bootstrapMigration).toContain("asistian-sync01-retry-student-contact");
    expect(bootstrapMigration).toContain("*/5 * * * *");
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
