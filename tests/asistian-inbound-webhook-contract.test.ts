import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Asistian -> Studio Flow receiver contract", () => {
  const receiver = source("supabase/functions/receive-asistian-webhook/index.ts");
  const migration = source("supabase/migrations/20260923041000_asistian_inbound_receiver.sql");

  it("verifies both current and compatibility HMAC signatures", () => {
    expect(receiver).toContain('request.headers.get("x-asistian-signature")');
    expect(receiver).toContain('request.headers.get("x-webhook-signature")');
    expect(receiver).toContain('parts.get("t")');
    expect(receiver).toContain('parts.get("v1")');
    expect(receiver).toContain("hmacSha256Hex(secret, rawBody)");
    expect(receiver).toContain('"x-webhook-signature-body"');
  });

  it("deduplicates the stable provider event id", () => {
    expect(receiver).toContain('request.headers.get("x-webhook-id")');
    expect(receiver).toContain("body.event_id");
    expect(receiver).toContain('insertError?.code === "23505"');
    expect(migration).toContain("unique (studio_id, provider_event_id)");
  });

  it("keeps captured customer payloads admin-only", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("private.has_capability(studio_id, 'settings.write')");
    expect(migration).toContain(
      "grant select on table public.asistian_webhook_events to authenticated",
    );
  });
});

describe("Asistian lifecycle synchronization contract", () => {
  const receiver = source("supabase/functions/receive-asistian-webhook/index.ts");
  const lifecycle = source("supabase/migrations/20260923051000_asistian_lifecycle_sync.sql");
  const serviceMapping = source("supabase/migrations/20260923061000_asistian_service_mapping.sql");

  it("classifies new Asistian contacts as trial students", () => {
    expect(lifecycle).toContain("student_type public.student_type not null default 'regular'");
    expect(lifecycle).toContain("'trial',");
    expect(lifecycle).toContain("'pending'");
  });

  it("keeps reservation status separate from commercial coverage", () => {
    expect(lifecycle).toContain("reservation_commercial_status");
    expect(lifecycle).toContain("'package_covered'");
    expect(lifecycle).toContain("'paid'");
    expect(lifecycle).toContain("'payment_pending'");
  });

  it("prefers Asistian's native event_type over custom automation labels", () => {
    expect(receiver).toContain("asRecord(body.data)?.event_type");
    expect(receiver).toContain("nativeEventName ??");
    expect(receiver).toContain(").toLowerCase()");
  });

  it("processes the full Asistian booking lifecycle", () => {
    for (const event of [
      "booking_created",
      "booking_confirmed",
      "booking_rescheduled",
      "booking_cancelled",
      "booking_completed",
      "booking_no_show",
      "booking_status_changed",
      "booking_updated",
    ]) {
      expect(receiver).toContain(`"${event}"`);
    }
    expect(receiver).toContain('"service_apply_asistian_booking_event"');
  });

  it("uses native Asistian service IDs for stable activity mapping", () => {
    expect(receiver).toContain("safeScalarText(service?.id)");
    expect(receiver).toContain("target_service_id: serviceId");
    expect(serviceMapping).toContain("create table if not exists public.asistian_service_mappings");
    expect(serviceMapping).toContain("admin_upsert_asistian_service_mapping");
    expect(serviceMapping).toContain("private.asistian_mapped_service_name");
  });

  it("keeps attendance ownership in Studio Flow", () => {
    expect(receiver).toContain('"attendance_owned_by_studio_flow"');
    expect(receiver).toContain('eventName === "booking_completed"');
    expect(receiver).toContain('eventName === "booking_no_show"');
  });

  it("does not silently auto-book resource-required sessions", () => {
    expect(lifecycle).toContain("'resource_selection_required'");
    expect(lifecycle).toContain("'requires_attention'");
  });

  it("restricts service synchronization RPCs to service_role", () => {
    expect(lifecycle).toContain("to service_role;");
    expect(lifecycle).toContain("from public, anon, authenticated;");
  });
});
