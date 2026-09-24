import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ASISTIAN-SYNC-01 contact synchronization", () => {
  const migration = source(
    "supabase/migrations/20260924181500_asistian_sync01_student_contact.sql",
  );
  const processor = source("supabase/functions/process-contact-created/index.ts");
  const shared = source("supabase/functions/_shared/asistian-messaging.ts");
  const provisioning = source("supabase/functions/provision-student-access/index.ts");

  it("emits one canonical contact.created event from student creation", () => {
    expect(migration).toContain("create trigger asistian_sync01_emit_contact_from_student");
    expect(migration).toContain("after insert on public.students");
    expect(migration).toContain("p_event_type => 'contact.created'");
    expect(migration).toContain("'contact.created:person:' || new.person_id::text");
    expect(migration).toContain("'source', 'students.insert'");
  });

  it("emits the same canonical contact.created event from CRM contact creation", () => {
    expect(migration).toContain("create trigger asistian_sync01_emit_contact_from_crm");
    expect(migration).toContain("after insert on public.crm_contacts");
    expect(migration).toContain("'contact.created:person:' || new.person_id::text");
    expect(migration).toContain("'source', 'crm_contacts.insert'");
  });

  it("deduplicates student and CRM creation by person identity", () => {
    const dedupMatches = migration.match(/contact\.created:person:/g) ?? [];
    expect(dedupMatches.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("p_source_entity_type => 'person'");
  });

  it("dispatches contact sync asynchronously and retries pending contact events", () => {
    expect(migration).toContain("net.http_post(");
    expect(migration).toContain("'/functions/v1/process-contact-created'");
    expect(migration).toContain("after insert on public.domain_events");
    expect(migration).toContain("when (new.event_type = 'contact.created')");
    expect(migration).toContain("asistian-sync01-retry-contact");
    expect(migration).toContain("*/5 * * * *");
  });

  it("uses a contact upsert integration separate from student welcome", () => {
    expect(shared).toContain('"contact_upsert"');
    expect(processor).toContain('template: "contact_upsert"');
    expect(processor).toContain('operation: "upsert_contact"');
    expect(processor).toContain(
      'const CONSUMER_KEY = "integration.asistian.contact-upsert"',
    );
    expect(processor).not.toContain('template: "student_welcome"');
  });

  it("sends contact identity plus optional student/CRM context to Asistian", () => {
    for (const variable of [
      "contact_id",
      "crm_contact_id",
      "student_id",
      "nombre",
      "first_name",
      "last_name",
      "phone",
      "email",
      "lifecycle_status",
      "source",
      "active",
    ]) {
      expect(processor).toContain(variable);
    }
  });

  it("keeps student welcome tied only to portal activation", () => {
    expect(provisioning).toContain('template: "student_welcome"');
    expect(provisioning).toContain("activation_url: activationLink");
    expect(processor).not.toContain("activation_url");
  });

  it("only consumes contact.created after Asistian accepts the upsert", () => {
    const acceptedMarker = processor.indexOf('if (delivery.status !== "accepted")');
    const claimMarker = processor.indexOf('"claim_domain_event"');

    expect(acceptedMarker).toBeGreaterThan(-1);
    expect(claimMarker).toBeGreaterThan(acceptedMarker);
  });
});
